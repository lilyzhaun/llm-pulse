import type {
  AvailabilityResponse,
  AvailabilityStatus,
  ChannelAvailability,
  HeartbeatBucket,
  HeartbeatSummary,
  HeartbeatWindow,
  ModelAvailability,
  NewApiLogItem,
} from "@llm-pulse/shared";
import { cacheService } from "./cacheService.js";
import { normalizationService } from "./normalizationService.js";
import {
  type PersistedPulseLog,
  type PersistedPulseState,
  persistenceService,
} from "./persistenceService.js";

const nowIso = () => new Date().toISOString();

const AGGREGATED_PULSE_CACHE_KEY = "aggregated-pulse";
const RECENT_LOGS_CACHE_KEY = "recent-logs";
const POLL_STATUS_CACHE_KEY = "poll-status";
const HEARTBEAT_BUCKET_SECONDS = 60;
const HEARTBEAT_BUCKET_COUNT = 60;
const MODEL_LOG_RETENTION_COUNT = 60;

interface PollStatusSnapshot {
  lastPollAt: string;
  lastPollSucceeded: boolean;
  lastErrorMessage: string | null;
}

interface StateCursorSnapshot {
  lastSeenTimestamp: number | null;
}

interface StateBootstrapSnapshot {
  backfillCompletedAt: string | null;
}

export type AggregationLog = PersistedPulseLog;

interface AvailabilityAccumulator {
  successCount: number;
  errorCount: number;
  totalCount: number;
  latencyTotal: number;
  latencySamples: number;
  lastSeenAt: number | null;
}

const createAccumulator = (): AvailabilityAccumulator => ({
  successCount: 0,
  errorCount: 0,
  totalCount: 0,
  latencyTotal: 0,
  latencySamples: 0,
  lastSeenAt: null,
});

const isoFromSeconds = (value: number | null): string | null => {
  if (value === null) {
    return null;
  }

  return new Date(value * 1000).toISOString();
};

const statusFromCounts = (
  successCount: number,
  errorCount: number,
): AvailabilityStatus => {
  const totalCount = successCount + errorCount;

  if (totalCount === 0) {
    return "unknown";
  }

  const successRate = successCount / totalCount;

  if (successCount > 0 && errorCount === 0) {
    return "available";
  }

  if (successCount === 0 && errorCount > 0) {
    return "unavailable";
  }

  if (successRate >= 0.9) {
    return "available";
  }

  if (successRate >= 0.5) {
    return "degraded";
  }

  return "unavailable";
};

const averageLatency = (
  accumulator: AvailabilityAccumulator,
): number | null => {
  if (accumulator.latencySamples === 0) {
    return null;
  }

  return accumulator.latencyTotal / accumulator.latencySamples;
};

const observedRequestCount = (accumulator: AvailabilityAccumulator): number =>
  accumulator.successCount + accumulator.errorCount;

const successRateFromAccumulator = (
  accumulator: AvailabilityAccumulator,
): number => {
  const observedCount = observedRequestCount(accumulator);
  if (observedCount === 0) {
    return 0;
  }

  return accumulator.successCount / observedCount;
};

const sanitizeLog = (log: NewApiLogItem): AggregationLog => ({
  id: log.id,
  created_at: log.created_at,
  type: log.type,
  model_name: log.model_name,
  use_time: log.use_time,
  channel: log.channel,
  channel_name: log.channel_name,
});

const buildResponseWindow = (
  logs: AggregationLog[],
  generatedAtIso: string,
): AvailabilityResponse["window"] => {
  if (logs.length === 0) {
    return {
      from: generatedAtIso,
      to: generatedAtIso,
      seconds: 0,
    };
  }

  const newest = logs[0]?.created_at ?? Math.floor(Date.now() / 1000);
  const oldest = logs[logs.length - 1]?.created_at ?? newest;

  return {
    from: new Date(oldest * 1000).toISOString(),
    to: new Date(newest * 1000).toISOString(),
    seconds: Math.max(0, newest - oldest),
  };
};

const getMinuteBucketStart = (timestampSeconds: number): number =>
  Math.floor(timestampSeconds / HEARTBEAT_BUCKET_SECONDS) *
  HEARTBEAT_BUCKET_SECONDS;

const isRequestLog = (log: AggregationLog): boolean =>
  log.type === 2 || log.type === 5;

const collectLatestObservedBucketStarts = (
  logs: AggregationLog[],
): number[] => {
  const bucketStarts = new Set<number>();

  for (const log of logs) {
    if (!isRequestLog(log)) {
      continue;
    }
    bucketStarts.add(getMinuteBucketStart(log.created_at));
  }

  return [...bucketStarts]
    .sort((left, right) => left - right)
    .slice(-HEARTBEAT_BUCKET_COUNT);
};

const trimLogsPerModel = (logs: AggregationLog[]): AggregationLog[] => {
  if (logs.length === 0) {
    return [];
  }

  const retainedLogs: AggregationLog[] = [];
  const bucketsByModel = new Map<string, Set<number>>();

  for (const log of logs) {
    if (!isRequestLog(log)) {
      continue;
    }

    const bucketStart = getMinuteBucketStart(log.created_at);
    const modelBuckets =
      bucketsByModel.get(log.model_name) ?? new Set<number>();

    if (
      !modelBuckets.has(bucketStart) &&
      modelBuckets.size >= MODEL_LOG_RETENTION_COUNT
    ) {
      continue;
    }

    modelBuckets.add(bucketStart);
    bucketsByModel.set(log.model_name, modelBuckets);
    retainedLogs.push(log);
  }

  return retainedLogs;
};

const buildHeartbeatWindow = (
  bucketStarts: number[],
  generatedAtIso: string,
): HeartbeatWindow => {
  if (bucketStarts.length === 0) {
    return {
      bucketSeconds: HEARTBEAT_BUCKET_SECONDS,
      bucketCount: 0,
      from: generatedAtIso,
      to: generatedAtIso,
    };
  }

  const firstBucketStart = bucketStarts[0] ?? Math.floor(Date.now() / 1000);
  const lastBucketStart =
    bucketStarts[bucketStarts.length - 1] ?? firstBucketStart;

  return {
    bucketSeconds: HEARTBEAT_BUCKET_SECONDS,
    bucketCount: bucketStarts.length,
    from: new Date(firstBucketStart * 1000).toISOString(),
    to: new Date(
      (lastBucketStart + HEARTBEAT_BUCKET_SECONDS) * 1000,
    ).toISOString(),
  };
};

const getHeartbeatBucketIndex = (
  log: AggregationLog,
  bucketIndexMap: Map<number, number>,
): number | null => {
  const bucketIndex = bucketIndexMap.get(getMinuteBucketStart(log.created_at));

  return bucketIndex ?? null;
};

const applyLogToHeartbeatAccumulators = (
  accumulators: AvailabilityAccumulator[],
  log: AggregationLog,
  bucketIndexMap: Map<number, number>,
): void => {
  const bucketIndex = getHeartbeatBucketIndex(log, bucketIndexMap);
  if (bucketIndex === null) {
    return;
  }

  const accumulator = accumulators[bucketIndex];
  if (!accumulator) {
    return;
  }

  applyLogToAccumulator(accumulator, log);
};

const buildHeartbeatBucket = (
  startSeconds: number,
  endSeconds: number,
  accumulator: AvailabilityAccumulator,
): HeartbeatBucket => ({
  start: new Date(startSeconds * 1000).toISOString(),
  end: new Date(endSeconds * 1000).toISOString(),
  status: statusFromCounts(accumulator.successCount, accumulator.errorCount),
  successCount: accumulator.successCount,
  errorCount: accumulator.errorCount,
  totalCount: accumulator.totalCount,
  successRate: successRateFromAccumulator(accumulator),
  averageLatencySeconds: averageLatency(accumulator),
});

const buildHeartbeatBuckets = (
  accumulators: AvailabilityAccumulator[],
  bucketStarts: number[],
): HeartbeatBucket[] => {
  const beats: HeartbeatBucket[] = [];

  for (const [index, accumulator] of accumulators.entries()) {
    const startSeconds = bucketStarts[index];
    if (startSeconds === undefined) {
      continue;
    }

    const beat = buildHeartbeatBucket(
      startSeconds,
      startSeconds + HEARTBEAT_BUCKET_SECONDS,
      accumulator,
    );
    if (beat.successCount === 0 && beat.errorCount === 0) {
      continue;
    }

    beats.push(beat);
  }

  return beats;
};

const buildHeartbeatBucketsForLogs = (
  logs: AggregationLog[],
): HeartbeatBucket[] => {
  const bucketStarts = collectLatestObservedBucketStartsForLogs(logs);
  const bucketIndexMap = new Map<number, number>(
    bucketStarts.map((bucketStart, index) => [bucketStart, index]),
  );
  const accumulators = createHeartbeatAccumulators(bucketStarts.length);

  for (const log of logs) {
    applyLogToHeartbeatAccumulators(accumulators, log, bucketIndexMap);
  }

  return buildHeartbeatBuckets(accumulators, bucketStarts);
};

const collectLatestObservedBucketStartsForLogs = (
  logs: AggregationLog[],
): number[] => {
  const bucketStarts = new Set<number>();

  for (const log of logs) {
    if (!isRequestLog(log)) {
      continue;
    }
    bucketStarts.add(getMinuteBucketStart(log.created_at));
  }

  return [...bucketStarts]
    .sort((left, right) => left - right)
    .slice(-HEARTBEAT_BUCKET_COUNT);
};

const buildHeartbeatSummary = (beats: HeartbeatBucket[]): HeartbeatSummary => {
  const healthyBuckets = beats.filter(
    (beat) => beat.status === "available",
  ).length;
  const degradedBuckets = beats.filter(
    (beat) => beat.status === "degraded",
  ).length;
  const unavailableBuckets = beats.filter(
    (beat) => beat.status === "unavailable",
  ).length;
  const unknownBuckets = beats.filter(
    (beat) => beat.status === "unknown",
  ).length;
  const observedBuckets = beats.length;
  const lastObservedBeat =
    [...beats].reverse().find((beat) => beat.totalCount > 0) ?? null;

  return {
    healthyBuckets,
    degradedBuckets,
    unavailableBuckets,
    unknownBuckets,
    observedBuckets,
    availabilityRate:
      observedBuckets === 0 ? null : healthyBuckets / observedBuckets,
    lastStatus: lastObservedBeat?.status ?? "unknown",
    lastBeatAt: lastObservedBeat?.start ?? null,
  };
};

const createHeartbeatAccumulators = (
  bucketCount: number,
): AvailabilityAccumulator[] =>
  Array.from({ length: bucketCount }, () => createAccumulator());

const mergeLogs = (
  existingLogs: AggregationLog[],
  incomingLogs: AggregationLog[],
): AggregationLog[] => {
  const dedupedById = new Map<number, AggregationLog>();

  for (const log of [...incomingLogs, ...existingLogs]) {
    dedupedById.set(log.id, log);
  }

  return trimLogsPerModel(
    [...dedupedById.values()].sort(
      (left, right) => right.created_at - left.created_at || right.id - left.id,
    ),
  );
};

const applyLogToAccumulator = (
  accumulator: AvailabilityAccumulator,
  log: AggregationLog,
): void => {
  if (log.type === 2) {
    accumulator.totalCount += 1;
    accumulator.successCount += 1;
  } else if (log.type === 5) {
    accumulator.totalCount += 1;
    accumulator.errorCount += 1;
  } else {
    return;
  }

  if (log.use_time > 0) {
    accumulator.latencyTotal += log.use_time;
    accumulator.latencySamples += 1;
  }

  accumulator.lastSeenAt =
    accumulator.lastSeenAt === null
      ? log.created_at
      : Math.max(accumulator.lastSeenAt, log.created_at);
};

const buildChannelAvailability = (
  channelId: number,
  channelName: string,
  accumulator: AvailabilityAccumulator,
  beats: HeartbeatBucket[],
): ChannelAvailability => ({
  channelId,
  channelName,
  status: statusFromCounts(accumulator.successCount, accumulator.errorCount),
  successCount: accumulator.successCount,
  errorCount: accumulator.errorCount,
  totalCount: accumulator.totalCount,
  successRate: successRateFromAccumulator(accumulator),
  averageLatencySeconds: averageLatency(accumulator),
  lastSeenAt: isoFromSeconds(accumulator.lastSeenAt),
  heartbeat: buildHeartbeatSummary(beats),
  beats,
});

const buildModelAvailability = (
  modelName: string,
  modelAccumulator: AvailabilityAccumulator,
  channels: ChannelAvailability[],
  beats: HeartbeatBucket[],
): ModelAvailability => {
  const heartbeat = buildHeartbeatSummary(beats);

  return {
    modelName,
    status: heartbeat.lastStatus,
    successCount: modelAccumulator.successCount,
    errorCount: modelAccumulator.errorCount,
    totalCount: modelAccumulator.totalCount,
    successRate: successRateFromAccumulator(modelAccumulator),
    averageLatencySeconds: averageLatency(modelAccumulator),
    lastSeenAt: isoFromSeconds(modelAccumulator.lastSeenAt),
    heartbeat,
    beats,
    channels: channels.sort(
      (left, right) =>
        right.totalCount - left.totalCount ||
        left.channelName.localeCompare(right.channelName),
    ),
  };
};

export class AggregationService {
  async restoreFromState(state: PersistedPulseState | null): Promise<void> {
    if (!state) {
      return;
    }

    const restoredLogs = trimLogsPerModel(
      state.recentLogs.sort(
        (left, right) =>
          right.created_at - left.created_at || right.id - left.id,
      ),
    );
    cacheService.set(RECENT_LOGS_CACHE_KEY, restoredLogs);
    if (state.pollStatus) {
      cacheService.set<PollStatusSnapshot>(
        POLL_STATUS_CACHE_KEY,
        state.pollStatus,
      );
    }

    cacheService.set(
      AGGREGATED_PULSE_CACHE_KEY,
      this.buildAvailabilityResponse(restoredLogs),
    );
  }

  async ingestLogs(
    logs: NewApiLogItem[],
    cursor: StateCursorSnapshot,
  ): Promise<AvailabilityResponse> {
    return this.ingestLogsWithState(logs, cursor, {
      backfillCompletedAt: null,
    });
  }

  async ingestLogsWithState(
    logs: NewApiLogItem[],
    cursor: StateCursorSnapshot,
    bootstrap: StateBootstrapSnapshot,
  ): Promise<AvailabilityResponse> {
    const existingLogs =
      cacheService.get<AggregationLog[]>(RECENT_LOGS_CACHE_KEY) ?? [];
    const mergedLogs = mergeLogs(existingLogs, logs.map(sanitizeLog));
    cacheService.set(RECENT_LOGS_CACHE_KEY, mergedLogs);

    const aggregated = this.buildAvailabilityResponse(mergedLogs);
    cacheService.set(AGGREGATED_PULSE_CACHE_KEY, aggregated);
    cacheService.set<PollStatusSnapshot>(POLL_STATUS_CACHE_KEY, {
      lastPollAt: aggregated.generatedAt,
      lastPollSucceeded: true,
      lastErrorMessage: null,
    });
    await this.persistState(cursor, bootstrap);

    return aggregated;
  }

  async markPollingFailure(
    error: unknown,
    cursor: StateCursorSnapshot,
  ): Promise<void> {
    cacheService.set<PollStatusSnapshot>(POLL_STATUS_CACHE_KEY, {
      lastPollAt: nowIso(),
      lastPollSucceeded: false,
      lastErrorMessage:
        error instanceof Error ? error.message : "Unknown polling error",
    });
    await this.persistState(cursor, { backfillCompletedAt: null });
  }

  getPollingStatus(): PollStatusSnapshot | null {
    return cacheService.get<PollStatusSnapshot>(POLL_STATUS_CACHE_KEY) ?? null;
  }

  async getAggregatedPulse(): Promise<AvailabilityResponse> {
    const cached = cacheService.get<AvailabilityResponse>(
      AGGREGATED_PULSE_CACHE_KEY,
    );
    if (cached) {
      return cached;
    }

    const response = this.buildAvailabilityResponse(
      cacheService.get<AggregationLog[]>(RECENT_LOGS_CACHE_KEY) ?? [],
    );
    cacheService.set(AGGREGATED_PULSE_CACHE_KEY, response);
    return response;
  }

  private async persistState(
    cursor: StateCursorSnapshot,
    bootstrap: StateBootstrapSnapshot,
  ): Promise<void> {
    const recentLogs =
      cacheService.get<AggregationLog[]>(RECENT_LOGS_CACHE_KEY) ?? [];
    const pollStatus =
      cacheService.get<PollStatusSnapshot>(POLL_STATUS_CACHE_KEY) ?? null;

    try {
      await persistenceService.savePulseState({
        recentLogs,
        cursor,
        bootstrap,
        pollStatus,
      });
    } catch (error) {
      console.warn("Failed to persist llm-pulse state", error);
    }
  }

  private buildAvailabilityResponse(
    logs: AggregationLog[],
  ): AvailabilityResponse {
    return buildAvailabilityResponseForLogs(logs);
  }
}

export const buildAvailabilityResponseForLogs = (
  logs: AggregationLog[],
  generatedAt: string = nowIso(),
): AvailabilityResponse => {
  const heartbeatBucketStarts = collectLatestObservedBucketStarts(logs);
  const heartbeatWindow = buildHeartbeatWindow(
    heartbeatBucketStarts,
    generatedAt,
  );
  const modelMap = new Map<
    string,
    {
      modelAccumulator: AvailabilityAccumulator;
      logs: AggregationLog[];
      channels: Map<
        string,
        {
          channelId: number;
          channelName: string;
          accumulator: AvailabilityAccumulator;
          logs: AggregationLog[];
        }
      >;
    }
  >();

  for (const log of logs) {
    const modelEntry = modelMap.get(log.model_name) ?? {
      modelAccumulator: createAccumulator(),
      logs: [],
      channels: new Map<
        string,
        {
          channelId: number;
          channelName: string;
          accumulator: AvailabilityAccumulator;
          logs: AggregationLog[];
        }
      >(),
    };

    applyLogToAccumulator(modelEntry.modelAccumulator, log);
    modelEntry.logs.push(log);

    const channelKey = `${log.channel}:${log.channel_name}`;
    const channelEntry = modelEntry.channels.get(channelKey) ?? {
      channelId: log.channel,
      channelName: log.channel_name,
      accumulator: createAccumulator(),
      logs: [],
    };
    applyLogToAccumulator(channelEntry.accumulator, log);
    channelEntry.logs.push(log);
    modelEntry.channels.set(channelKey, channelEntry);
    modelMap.set(log.model_name, modelEntry);
  }

  const models = normalizationService
    .normalizeModels(
      [...modelMap.entries()].map(([modelName, modelEntry]) =>
        buildModelAvailability(
          modelName,
          modelEntry.modelAccumulator,
          [...modelEntry.channels.values()].map((channelEntry) =>
            buildChannelAvailability(
              channelEntry.channelId,
              channelEntry.channelName,
              channelEntry.accumulator,
              buildHeartbeatBucketsForLogs(channelEntry.logs),
            ),
          ),
          buildHeartbeatBucketsForLogs(modelEntry.logs),
        ),
      ),
    )
    .sort((left, right) => {
      const rightLastSeenAt = right.lastSeenAt
        ? Date.parse(right.lastSeenAt)
        : 0;
      const leftLastSeenAt = left.lastSeenAt ? Date.parse(left.lastSeenAt) : 0;

      if (rightLastSeenAt !== leftLastSeenAt) {
        return rightLastSeenAt - leftLastSeenAt;
      }

      const statusRank = statusOrder(left.status) - statusOrder(right.status);
      if (statusRank !== 0) {
        return statusRank;
      }

      return (
        right.totalCount - left.totalCount ||
        left.modelName.localeCompare(right.modelName)
      );
    });

  return {
    generatedAt,
    window: buildResponseWindow(logs, generatedAt),
    heartbeat: heartbeatWindow,
    summary: {
      totalModels: models.length,
      availableModels: models.filter((model) => model.status === "available")
        .length,
      degradedModels: models.filter((model) => model.status === "degraded")
        .length,
      unavailableModels: models.filter(
        (model) => model.status === "unavailable",
      ).length,
      unknownModels: models.filter((model) => model.status === "unknown")
        .length,
    },
    models,
  };
};

const statusOrder = (status: AvailabilityStatus): number => {
  if (status === "unavailable") {
    return 0;
  }

  if (status === "degraded") {
    return 1;
  }

  if (status === "available") {
    return 2;
  }

  return 3;
};

export const aggregationService = new AggregationService();
