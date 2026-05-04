import type {
  AvailabilityResponse,
  ChannelAvailability,
  HeartbeatBucket,
  ModelAvailability,
  NewApiLogItem,
} from "@llm-pulse/shared";
import { env } from "../config/env.js";
import {
  HEARTBEAT_BUCKET_COUNT,
  HEARTBEAT_BUCKET_SECONDS,
} from "../config/constants.js";
import { logger } from "../lib/logger.js";
import {
  incrementUpstreamDbQueryErrors,
  observeAggregationDurationSeconds,
  observeUpstreamDbQueryDurationSeconds,
} from "../routes/metrics.js";
import { buildHeartbeatSummary } from "./aggregation/heartbeat.js";
import { statusFromCounts, statusOrder } from "./aggregation/status.js";
import {
  type ChannelAggregate,
  type ModelAggregate,
  type UpstreamHeartbeatBucket,
  getChannelAggregates,
  getHeartbeatBuckets,
  getModelAggregates,
  scrubPgError,
} from "./upstreamDb/index.js";

const nowIso = () => new Date().toISOString();
const elapsedSecondsSince = (startedAt: bigint) =>
  Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
const elapsedMsSince = (startedAt: bigint) =>
  Math.round(Number(process.hrtime.bigint() - startedAt) / 1_000_000);
const toIso = (epochMs: number | null): string | null =>
  epochMs === null ? null : new Date(epochMs).toISOString();

interface QueryStatusSnapshot {
  lastQueryAt: string | null;
  lastQuerySucceeded: boolean | null;
  lastErrorMessage: string | null;
  lastQueryDurationMs: number | null;
  lastPollAt: string | null;
  lastPollSucceeded: boolean | null;
}

interface StateCursorSnapshot {
  lastSeenTimestamp: number | null;
}

interface QueryWindow {
  toEpochSeconds: number;
  generatedAt: string;
}

interface LocalAvailabilityDataSource {
  kind: "upstream-postgres" | "memory-snapshot" | "empty";
  lastQueryAt: string | null;
  lastQueryDurationMs: number | null;
  lastErrorMessage: string | null;
}

interface ExtendedModelAvailability extends ModelAvailability {
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

interface ExtendedAvailabilityResponse extends AvailabilityResponse {
  dataSource: LocalAvailabilityDataSource;
  models: ExtendedModelAvailability[];
}

export class AggregationService {
  private lastSnapshot: ExtendedAvailabilityResponse | null = null;
  private lastQueryAt: string | null = null;
  private lastQuerySucceeded: boolean | null = null;
  private lastErrorMessage: string | null = null;
  private lastQueryDurationMs: number | null = null;

  async restoreFromState(_state: unknown): Promise<void> {
    this.lastSnapshot = null;
  }

  async ingestLogs(
    _logs: NewApiLogItem[],
    _cursor: StateCursorSnapshot,
  ): Promise<AvailabilityResponse> {
    return this.refresh();
  }

  async markPollingFailure(
    error: unknown,
    _cursor: StateCursorSnapshot,
  ): Promise<void> {
    this.recordQueryFailure(error, nowIso(), null);
  }

  markStartupQueryFailure(error: unknown): void {
    if (this.lastQuerySucceeded === true) {
      return;
    }

    this.recordQueryFailure(error, nowIso(), null);
  }

  getPollingStatus(): QueryStatusSnapshot | null {
    if (
      this.lastQueryAt === null &&
      this.lastQuerySucceeded === null &&
      this.lastErrorMessage === null
    ) {
      return null;
    }

    return {
      lastQueryAt: this.lastQueryAt,
      lastQuerySucceeded: this.lastQuerySucceeded,
      lastErrorMessage: this.lastErrorMessage,
      lastQueryDurationMs: this.lastQueryDurationMs,
      lastPollAt: this.lastQueryAt,
      lastPollSucceeded: this.lastQuerySucceeded,
    };
  }

  async getAggregatedPulse(): Promise<AvailabilityResponse> {
    return this.refresh();
  }

  async refresh(): Promise<AvailabilityResponse> {
    const queryStartedAt = process.hrtime.bigint();
    const window = this.buildQueryWindow();

    try {
      const [models, channels, heartbeatBuckets] = await Promise.all([
        getModelAggregates(window.toEpochSeconds),
        getChannelAggregates(window.toEpochSeconds),
        getHeartbeatBuckets(window.toEpochSeconds),
      ]);
      const durationMs = elapsedMsSince(queryStartedAt);
      observeUpstreamDbQueryDurationSeconds(durationMs / 1000);
      const response = this.buildAvailabilityResponse(
        models,
        channels,
        heartbeatBuckets,
        window,
        {
          kind: "upstream-postgres",
          lastQueryAt: window.generatedAt,
          lastQueryDurationMs: durationMs,
          lastErrorMessage: null,
        },
      );

      this.lastSnapshot = response;
      this.lastQueryAt = window.generatedAt;
      this.lastQuerySucceeded = true;
      this.lastErrorMessage = null;
      this.lastQueryDurationMs = durationMs;

      return response;
    } catch (error) {
      const durationMs = elapsedMsSince(queryStartedAt);
      observeUpstreamDbQueryDurationSeconds(durationMs / 1000);
      incrementUpstreamDbQueryErrors();
      this.recordQueryFailure(error, window.generatedAt, durationMs);
      logger.warn(
        { error: scrubPgError(error) },
        "Failed to query upstream PostgreSQL for pulse snapshot",
      );
      return this.buildFallbackResponse(window.generatedAt);
    } finally {
      observeAggregationDurationSeconds(elapsedSecondsSince(queryStartedAt));
    }
  }

  private buildQueryWindow(): QueryWindow {
    const toEpochSeconds = Math.floor(Date.now() / 1000);
    const fromEpochSeconds = Math.max(
      0,
      toEpochSeconds - env.availabilityWindowSeconds,
    );

    return {
      toEpochSeconds,
      generatedAt: new Date(toEpochSeconds * 1000).toISOString(),
    };
  }

  private buildAvailabilityResponse(
    modelAggregates: ModelAggregate[],
    channelAggregates: ChannelAggregate[],
    heartbeatBuckets: UpstreamHeartbeatBucket[],
    window: QueryWindow,
    dataSource: LocalAvailabilityDataSource,
  ): ExtendedAvailabilityResponse {
    const beatsByModel = this.groupHeartbeatBuckets(heartbeatBuckets);
    const channelsByModel = this.groupChannels(channelAggregates, beatsByModel);
    const models = modelAggregates
      .map((model) =>
        this.buildModelAvailability(
          model,
          channelsByModel.get(model.modelName) ?? [],
          beatsByModel.get(model.modelName) ?? [],
        ),
      )
      .sort(this.compareModels);

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
      heartbeat: this.buildResponseHeartbeat(
        heartbeatBuckets,
        window.generatedAt,
      ),
      summary: this.buildSummary(models),
      models,
    };
  }

  private buildModelAvailability(
    model: ModelAggregate,
    channels: ChannelAvailability[],
    beats: HeartbeatBucket[],
  ): ExtendedModelAvailability {
    return {
      modelName: model.modelName,
      status: statusFromCounts(model.successCount, model.errorCount),
      successCount: model.successCount,
      errorCount: model.errorCount,
      totalCount: model.totalCount,
      successRate: this.successRate(model.successCount, model.errorCount),
      averageLatencySeconds: model.latencyAvgSeconds,
      lastSeenAt: toIso(model.lastSeenAtMs),
      tokens: {
        input: model.inputTokens,
        cacheInput: model.cacheInputTokens,
        output: model.outputTokens,
        total: model.totalTokens,
      },
      cost: {
        quota: model.quotaSum,
      },
      rpm: {
        average: model.rpmAvg,
        peak: model.rpmPeak,
      },
      tpm: {
        average: model.tpmAvg,
        peak: model.tpmPeak,
      },
      heartbeat: buildHeartbeatSummary(beats),
      beats,
      channels,
    };
  }

  private groupChannels(
    channelAggregates: ChannelAggregate[],
    beatsByModel: Map<string, HeartbeatBucket[]>,
  ): Map<string, ChannelAvailability[]> {
    const channelsByModel = new Map<string, ChannelAvailability[]>();

    for (const channel of channelAggregates) {
      const channels = channelsByModel.get(channel.modelName) ?? [];
      channels.push({
        channelId: channel.channelId,
        channelName: channel.channelName,
        status: statusFromCounts(channel.successCount, channel.errorCount),
        successCount: channel.successCount,
        errorCount: channel.errorCount,
        totalCount: channel.totalCount,
        successRate: this.successRate(channel.successCount, channel.errorCount),
        averageLatencySeconds: channel.latencyAvgSeconds,
        lastSeenAt: toIso(channel.lastSeenAtMs),
        heartbeat: buildHeartbeatSummary(
          beatsByModel.get(channel.modelName) ?? [],
        ),
        beats: [],
      });
      channelsByModel.set(channel.modelName, channels);
    }

    for (const channels of channelsByModel.values()) {
      channels.sort(
        (left, right) =>
          right.totalCount - left.totalCount ||
          left.channelName.localeCompare(right.channelName),
      );
    }

    return channelsByModel;
  }

  private groupHeartbeatBuckets(
    heartbeatBuckets: UpstreamHeartbeatBucket[],
  ): Map<string, HeartbeatBucket[]> {
    const beatsByModel = new Map<string, HeartbeatBucket[]>();

    for (const bucket of heartbeatBuckets) {
      const beats = beatsByModel.get(bucket.modelName) ?? [];
      beats.push({
        start: new Date(bucket.bucketStartMs).toISOString(),
        end: new Date(
          bucket.bucketStartMs + HEARTBEAT_BUCKET_SECONDS * 1000,
        ).toISOString(),
        status: statusFromCounts(bucket.successCount, bucket.errorCount),
        successCount: bucket.successCount,
        errorCount: bucket.errorCount,
        totalCount: bucket.totalCount,
        successRate: this.successRate(bucket.successCount, bucket.errorCount),
        averageLatencySeconds: bucket.latencyAvgSeconds,
      });
      beatsByModel.set(bucket.modelName, beats);
    }

    for (const beats of beatsByModel.values()) {
      beats.sort(
        (left, right) => Date.parse(left.start) - Date.parse(right.start),
      );
    }

    return beatsByModel;
  }

  private buildResponseHeartbeat(
    heartbeatBuckets: UpstreamHeartbeatBucket[],
    generatedAt: string,
  ): AvailabilityResponse["heartbeat"] {
    const observedBucketStarts = [
      ...new Set(
        heartbeatBuckets.map((bucket) =>
          Math.floor(bucket.bucketStartMs / 1000),
        ),
      ),
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
  }

  private buildSummary(
    models: ExtendedModelAvailability[],
  ): AvailabilityResponse["summary"] {
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
  }

  private buildFallbackResponse(
    generatedAt: string,
  ): ExtendedAvailabilityResponse {
    const dataSource: LocalAvailabilityDataSource = {
      kind: this.lastSnapshot ? "memory-snapshot" : "empty",
      lastQueryAt: this.lastQueryAt,
      lastQueryDurationMs: this.lastQueryDurationMs,
      lastErrorMessage: this.lastErrorMessage,
    };

    if (this.lastSnapshot) {
      return {
        ...this.lastSnapshot,
        generatedAt,
        dataSource,
        summary: this.markSummaryDegraded(this.lastSnapshot.summary),
      };
    }

    return this.buildEmptyResponse(generatedAt, dataSource);
  }

  private buildEmptyResponse(
    generatedAt: string,
    dataSource: LocalAvailabilityDataSource,
  ): ExtendedAvailabilityResponse {
    return {
      generatedAt,
      dataSource,
      window: {
        from: generatedAt,
        to: generatedAt,
        seconds: 0,
      },
      heartbeat: {
        bucketSeconds: HEARTBEAT_BUCKET_SECONDS,
        bucketCount: 0,
        from: generatedAt,
        to: generatedAt,
      },
      summary: {
        totalModels: 0,
        availableModels: 0,
        degradedModels: 0,
        unavailableModels: 0,
        unknownModels: 0,
      },
      models: [],
    };
  }

  private markSummaryDegraded(
    summary: AvailabilityResponse["summary"],
  ): AvailabilityResponse["summary"] {
    if (summary.totalModels === 0) {
      return summary;
    }

    return {
      totalModels: summary.totalModels,
      availableModels: 0,
      degradedModels: summary.totalModels,
      unavailableModels: 0,
      unknownModels: 0,
    };
  }

  private recordQueryFailure(
    error: unknown,
    attemptedAt: string,
    durationMs: number | null,
  ): void {
    const scrubbed = scrubPgError(error);
    const message =
      scrubbed && typeof scrubbed === "object" && "message" in scrubbed
        ? String(scrubbed.message)
        : "Upstream PostgreSQL query failed";

    this.lastQueryAt = attemptedAt;
    this.lastQuerySucceeded = false;
    this.lastErrorMessage = message;
    this.lastQueryDurationMs = durationMs;
  }

  private successRate(successCount: number, errorCount: number): number {
    const totalCount = successCount + errorCount;
    return totalCount === 0 ? 0 : successCount / totalCount;
  }

  private compareModels(
    left: ModelAvailability,
    right: ModelAvailability,
  ): number {
    const rightLastSeenAt = right.lastSeenAt ? Date.parse(right.lastSeenAt) : 0;
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
  }
}

export const aggregationService = new AggregationService();
