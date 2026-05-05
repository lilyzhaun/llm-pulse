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
  ChannelAggregate,
  ModelAggregate,
  UpstreamHeartbeatBucket,
} from "../upstreamDb/index.js";
import type {
  ExtendedAvailabilityResponse,
  LocalAvailabilityDataSource,
  QueryWindow,
} from "../snapshot/responseBuilder.js";

const toIso = (epochMs: number | null): string | null =>
  epochMs === null ? null : new Date(epochMs).toISOString();

export class PulseResponseFactory {
  buildAvailabilityResponse(
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

  buildFallbackResponse(
    generatedAt: string,
    lastSnapshot: ExtendedAvailabilityResponse | null,
    dataSourceBase: {
      lastQueryAt: string | null;
      lastQueryDurationMs: number | null;
      lastErrorMessage: string | null;
    },
  ): ExtendedAvailabilityResponse {
    const dataSource: LocalAvailabilityDataSource = {
      kind: lastSnapshot ? "memory-snapshot" : "empty",
      ...dataSourceBase,
    };

    if (lastSnapshot) {
      return {
        ...lastSnapshot,
        generatedAt,
        dataSource,
        summary: this.markSummaryDegraded(lastSnapshot.summary),
      };
    }

    return this.buildEmptyResponse(generatedAt, dataSource);
  }

  private buildModelAvailability(
    model: ModelAggregate,
    channels: ChannelAvailability[],
    beats: HeartbeatBucket[],
  ): ExtendedAvailabilityResponse["models"][number] {
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
    models: ExtendedAvailabilityResponse["models"],
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
