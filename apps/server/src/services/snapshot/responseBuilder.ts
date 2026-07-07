import type { ChannelAvailability, HeartbeatBucket } from "@llm-pulse/shared";
import { HEARTBEAT_BUCKET_SECONDS } from "../../config/constants.js";
import { buildHeartbeatSummary } from "../../lib/heartbeatSummary.js";
import { statusFromCounts } from "../../lib/status.js";
import {
  type ExtendedAvailabilityResponse,
  type ExtendedModelAvailability,
  type LocalAvailabilityDataSource,
  type QueryWindow,
  averageLatency,
  buildHeartbeatWindow,
  buildResponseWindow,
  buildSummary,
  compareChannels,
  compareModels,
  successRate,
} from "../shared/availabilityHelpers.js";
import type {
  ChannelBucketRow,
  ModelBucketRow,
  SnapshotData,
} from "./types.js";

export type {
  ExtendedAvailabilityResponse,
  ExtendedModelAvailability,
  LocalAvailabilityDataSource,
  QueryWindow,
};

const toIso = (epochSeconds: number | null): string | null =>
  epochSeconds === null ? null : new Date(epochSeconds * 1000).toISOString();

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
    window: buildResponseWindow(window),
    heartbeat: buildHeartbeatWindow(
      allBuckets.map((bucket) => bucket.bucketStart),
      window.generatedAt,
    ),
    summary: buildSummary(models),
    models,
  };
};
