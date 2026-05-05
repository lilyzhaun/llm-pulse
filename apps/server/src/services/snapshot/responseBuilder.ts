import type {
  AvailabilityResponse,
  ChannelAvailability,
  HeartbeatBucket,
  ModelAvailability,
} from "@llm-pulse/shared";
import {
  HEARTBEAT_BUCKET_COUNT,
  HEARTBEAT_BUCKET_SECONDS,
} from "../../config/constants.js";
import { buildHeartbeatSummary } from "../aggregation/heartbeat.js";
import { statusFromCounts, statusOrder } from "../aggregation/status.js";
import type {
  ChannelBucketRow,
  ModelBucketRow,
  SnapshotData,
} from "./types.js";

export interface LocalAvailabilityDataSource {
  kind: "upstream-postgres" | "memory-snapshot" | "empty";
  lastQueryAt: string | null;
  lastQueryDurationMs: number | null;
  lastErrorMessage: string | null;
}

export interface QueryWindow {
  toEpochSeconds: number;
  generatedAt: string;
}

export interface ExtendedModelAvailability extends ModelAvailability {
  tokens: {
    input: number;
    cacheInput: number;
    output: number;
    total: number;
  };
  cost: {
    quota: number;
  };
  rpm: {
    average: number;
    peak: number;
  };
  tpm: {
    average: number;
    peak: number;
  };
}

export interface ExtendedAvailabilityResponse extends AvailabilityResponse {
  dataSource: LocalAvailabilityDataSource;
  models: ExtendedModelAvailability[];
}

const toIso = (epochSeconds: number | null): string | null =>
  epochSeconds === null ? null : new Date(epochSeconds * 1000).toISOString();

const successRate = (successCount: number, errorCount: number): number => {
  const totalCount = successCount + errorCount;
  return totalCount === 0 ? 0 : successCount / totalCount;
};

const averageLatency = (
  latencySumSeconds: number,
  latencySamples: number,
): number | null => {
  if (latencySamples === 0) {
    return null;
  }

  return latencySumSeconds / latencySamples;
};

const buildBeat = (bucket: ModelBucketRow): HeartbeatBucket => ({
  start: new Date(bucket.bucketStart * 1000).toISOString(),
  end: new Date(
    (bucket.bucketStart + HEARTBEAT_BUCKET_SECONDS) * 1000,
  ).toISOString(),
  status: statusFromCounts(bucket.successCount, bucket.errorCount),
  successCount: bucket.successCount,
  errorCount: bucket.errorCount,
  totalCount: bucket.totalCount,
  successRate: successRate(bucket.successCount, bucket.errorCount),
  averageLatencySeconds: averageLatency(
    bucket.latencySumSeconds,
    bucket.latencySamples,
  ),
});

const compareModels = (
  left: ModelAvailability,
  right: ModelAvailability,
): number => {
  const rightLastSeenAt = right.lastSeenAt ? Date.parse(right.lastSeenAt) : 0;
  const leftLastSeenAt = left.lastSeenAt ? Date.parse(left.lastSeenAt) : 0;

  if (rightLastSeenAt !== leftLastSeenAt) {
    return rightLastSeenAt - leftLastSeenAt;
  }

  const rank = statusOrder(left.status) - statusOrder(right.status);
  if (rank !== 0) {
    return rank;
  }

  return (
    right.totalCount - left.totalCount ||
    left.modelName.localeCompare(right.modelName)
  );
};

const compareChannels = (
  left: ChannelAvailability,
  right: ChannelAvailability,
): number =>
  right.totalCount - left.totalCount ||
  left.channelName.localeCompare(right.channelName);

const buildResponseHeartbeat = (
  allBuckets: readonly ModelBucketRow[],
  generatedAt: string,
): AvailabilityResponse["heartbeat"] => {
  const observedBucketStarts = [
    ...new Set(allBuckets.map((bucket) => bucket.bucketStart)),
  ]
    .sort((left, right) => left - right)
    .slice(-HEARTBEAT_BUCKET_COUNT);

  if (observedBucketStarts.length === 0) {
    return {
      bucketSeconds: HEARTBEAT_BUCKET_SECONDS,
      bucketCount: 0,
      from: generatedAt,
      to: generatedAt,
    };
  }

  const firstBucketStart = observedBucketStarts[0] ?? 0;
  const lastBucketStart = observedBucketStarts.at(-1) ?? firstBucketStart;

  return {
    bucketSeconds: HEARTBEAT_BUCKET_SECONDS,
    bucketCount: observedBucketStarts.length,
    from: new Date(firstBucketStart * 1000).toISOString(),
    to: new Date(
      (lastBucketStart + HEARTBEAT_BUCKET_SECONDS) * 1000,
    ).toISOString(),
  };
};

const buildSummary = (
  models: readonly ExtendedModelAvailability[],
): AvailabilityResponse["summary"] => {
  let availableModels = 0;
  let degradedModels = 0;
  let unavailableModels = 0;
  let unknownModels = 0;

  for (const model of models) {
    if (model.status === "available") {
      availableModels += 1;
    } else if (model.status === "degraded") {
      degradedModels += 1;
    } else if (model.status === "unavailable") {
      unavailableModels += 1;
    } else {
      unknownModels += 1;
    }
  }

  return {
    totalModels: models.length,
    availableModels,
    degradedModels,
    unavailableModels,
    unknownModels,
  };
};

const aggregateChannel = (
  rows: readonly ChannelBucketRow[],
): ChannelAvailability => {
  let successCount = 0;
  let errorCount = 0;
  let totalCount = 0;
  let latencySumSeconds = 0;
  let latencySamples = 0;
  let lastSeenAt: number | null = null;

  for (const row of rows) {
    successCount += row.successCount;
    errorCount += row.errorCount;
    totalCount += row.totalCount;
    latencySumSeconds += row.latencySumSeconds;
    latencySamples += row.latencySamples;
    lastSeenAt =
      lastSeenAt === null
        ? row.lastSeenAt
        : Math.max(lastSeenAt, row.lastSeenAt ?? 0);
  }

  const first = rows[0];
  return {
    channelId: first?.channelId ?? 0,
    channelName: first?.channelName ?? "unknown",
    status: statusFromCounts(successCount, errorCount),
    successCount,
    errorCount,
    totalCount,
    successRate: successRate(successCount, errorCount),
    averageLatencySeconds: averageLatency(latencySumSeconds, latencySamples),
    lastSeenAt: toIso(lastSeenAt),
    heartbeat: buildHeartbeatSummary([]),
    beats: [],
  };
};

const buildChannels = (
  modelName: string,
  channelsByModel: Map<string, ChannelBucketRow[]>,
  beats: readonly HeartbeatBucket[],
): ChannelAvailability[] => {
  const rows = channelsByModel.get(modelName) ?? [];
  const grouped = new Map<string, ChannelBucketRow[]>();

  for (const row of rows) {
    const key = `${row.channelId}:${row.channelName}`;
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }

  return [...grouped.values()]
    .map((channelRows) => ({
      ...aggregateChannel(channelRows),
      heartbeat: buildHeartbeatSummary([...beats]),
    }))
    .sort(compareChannels);
};

const buildModelAvailability = (
  modelName: string,
  buckets: readonly ModelBucketRow[],
  channelsByModel: Map<string, ChannelBucketRow[]>,
): ExtendedModelAvailability => {
  const ascendingBuckets = [...buckets].sort(
    (left, right) => left.bucketStart - right.bucketStart,
  );
  const beats = ascendingBuckets.map(buildBeat);

  let successCount = 0;
  let errorCount = 0;
  let totalCount = 0;
  let latencySumSeconds = 0;
  let latencySamples = 0;
  let promptTokens = 0;
  let cacheTokens = 0;
  let completionTokens = 0;
  let quotaSum = 0;
  let lastSeenAt: number | null = null;
  let rpmPeak = 0;
  let tpmPeak = 0;

  for (const bucket of buckets) {
    successCount += bucket.successCount;
    errorCount += bucket.errorCount;
    totalCount += bucket.totalCount;
    latencySumSeconds += bucket.latencySumSeconds;
    latencySamples += bucket.latencySamples;
    promptTokens += bucket.promptTokens;
    cacheTokens += bucket.cacheTokens;
    completionTokens += bucket.completionTokens;
    quotaSum += bucket.quotaSum;
    lastSeenAt =
      lastSeenAt === null
        ? bucket.lastSeenAt
        : Math.max(lastSeenAt, bucket.lastSeenAt ?? 0);
    rpmPeak = Math.max(rpmPeak, bucket.totalCount);
    tpmPeak = Math.max(
      tpmPeak,
      bucket.promptTokens + bucket.cacheTokens + bucket.completionTokens,
    );
  }

  const bucketCount = Math.max(buckets.length, 1);
  const totalTokens = promptTokens + cacheTokens + completionTokens;

  return {
    modelName,
    status: statusFromCounts(successCount, errorCount),
    successCount,
    errorCount,
    totalCount,
    successRate: successRate(successCount, errorCount),
    averageLatencySeconds: averageLatency(latencySumSeconds, latencySamples),
    lastSeenAt: toIso(lastSeenAt),
    tokens: {
      input: promptTokens,
      cacheInput: cacheTokens,
      output: completionTokens,
      total: totalTokens,
    },
    cost: {
      quota: quotaSum,
    },
    rpm: {
      average: totalCount / bucketCount,
      peak: rpmPeak,
    },
    tpm: {
      average: totalTokens / bucketCount,
      peak: tpmPeak,
    },
    heartbeat: buildHeartbeatSummary(beats),
    beats,
    channels: buildChannels(modelName, channelsByModel, beats),
  };
};

export const buildSnapshotAvailabilityResponse = (
  snapshot: SnapshotData,
  window: QueryWindow,
  dataSource: LocalAvailabilityDataSource,
): ExtendedAvailabilityResponse => {
  const modelNames = [...snapshot.enabledModels].filter((modelName) => {
    const buckets = snapshot.models.get(modelName);
    return Array.isArray(buckets) && buckets.length > 0;
  });

  const models = modelNames
    .map((modelName) =>
      buildModelAvailability(
        modelName,
        snapshot.models.get(modelName) ?? [],
        snapshot.channels,
      ),
    )
    .sort(compareModels);

  const allBuckets = modelNames.flatMap(
    (modelName) => snapshot.models.get(modelName) ?? [],
  );

  return {
    generatedAt: window.generatedAt,
    dataSource,
    window: {
      from: new Date(
        Math.max(
          0,
          window.toEpochSeconds -
            HEARTBEAT_BUCKET_COUNT * HEARTBEAT_BUCKET_SECONDS,
        ) * 1000,
      ).toISOString(),
      to: new Date(window.toEpochSeconds * 1000).toISOString(),
      seconds: HEARTBEAT_BUCKET_COUNT * HEARTBEAT_BUCKET_SECONDS,
    },
    heartbeat: buildResponseHeartbeat(allBuckets, window.generatedAt),
    summary: buildSummary(models),
    models,
  };
};
