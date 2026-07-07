import type { ChannelAvailability, HeartbeatBucket } from "@llm-pulse/shared";
import { HEARTBEAT_BUCKET_SECONDS } from "../../config/constants.js";
import { buildHeartbeatSummary } from "../../lib/heartbeatSummary.js";
import { statusFromCounts } from "../../lib/status.js";
import type {
  ChannelAggregate,
  ModelAggregate,
  UpstreamHeartbeatBucket,
} from "../upstreamDb/index.js";
import {
  type ExtendedAvailabilityResponse,
  type LocalAvailabilityDataSource,
  type QueryWindow,
  buildEmptySummary,
  buildHeartbeatWindow,
  buildResponseWindow,
  buildSummary,
  compareChannels,
  compareModels,
  markSummaryDegraded,
  successRate,
} from "../shared/availabilityHelpers.js";

export type {
  ExtendedAvailabilityResponse,
  LocalAvailabilityDataSource,
  QueryWindow,
};

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
      .sort(compareModels);

    return {
      generatedAt: window.generatedAt,
      dataSource,
      window: buildResponseWindow(window),
      heartbeat: buildHeartbeatWindow(
        heartbeatBuckets.map((bucket) =>
          Math.floor(bucket.bucketStartMs / 1000),
        ),
        window.generatedAt,
      ),
      summary: buildSummary(models),
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
        summary: markSummaryDegraded(lastSnapshot.summary),
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
      successRate: successRate(model.successCount, model.errorCount),
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
        successRate: successRate(channel.successCount, channel.errorCount),
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
      channels.sort(compareChannels);
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
        successRate: successRate(bucket.successCount, bucket.errorCount),
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
      summary: buildEmptySummary(),
      models: [],
    };
  }
}
