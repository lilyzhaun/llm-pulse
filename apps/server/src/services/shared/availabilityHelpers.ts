import type {
  AvailabilityResponse,
  ChannelAvailability,
  ModelAvailability,
} from "@llm-pulse/shared";
import {
  HEARTBEAT_BUCKET_COUNT,
  HEARTBEAT_BUCKET_SECONDS,
} from "../../config/constants.js";
import { statusOrder } from "../../lib/status.js";

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

export const successRate = (
  successCount: number,
  errorCount: number,
): number => {
  const totalCount = successCount + errorCount;
  return totalCount === 0 ? 0 : successCount / totalCount;
};

export const averageLatency = (
  latencySumSeconds: number,
  latencySamples: number,
): number | null => {
  if (latencySamples === 0) {
    return null;
  }

  return latencySumSeconds / latencySamples;
};

export const compareModels = (
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

export const compareChannels = (
  left: ChannelAvailability,
  right: ChannelAvailability,
): number =>
  right.totalCount - left.totalCount ||
  left.channelName.localeCompare(right.channelName);

export const buildSummary = (
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

export const buildResponseWindow = (
  window: QueryWindow,
): AvailabilityResponse["window"] => ({
  from: new Date(
    Math.max(
      0,
      window.toEpochSeconds - HEARTBEAT_BUCKET_COUNT * HEARTBEAT_BUCKET_SECONDS,
    ) * 1000,
  ).toISOString(),
  to: new Date(window.toEpochSeconds * 1000).toISOString(),
  seconds: HEARTBEAT_BUCKET_COUNT * HEARTBEAT_BUCKET_SECONDS,
});

/**
 * Build the response-level heartbeat window from a set of observed bucket
 * start epoch-seconds. Both the snapshot path (ModelBucketRow) and the
 * upstream path (UpstreamHeartbeatBucket) reduce to the same shape once
 * bucket starts are expressed in epoch seconds.
 */
export const buildHeartbeatWindow = (
  bucketStartsSeconds: readonly number[],
  generatedAt: string,
): AvailabilityResponse["heartbeat"] => {
  const observed = [...new Set(bucketStartsSeconds)]
    .sort((left, right) => left - right)
    .slice(-HEARTBEAT_BUCKET_COUNT);

  if (observed.length === 0) {
    return {
      bucketSeconds: HEARTBEAT_BUCKET_SECONDS,
      bucketCount: 0,
      from: generatedAt,
      to: generatedAt,
    };
  }

  const firstBucketStart = observed[0] ?? 0;
  const lastBucketStart = observed.at(-1) ?? firstBucketStart;

  return {
    bucketSeconds: HEARTBEAT_BUCKET_SECONDS,
    bucketCount: observed.length,
    from: new Date(firstBucketStart * 1000).toISOString(),
    to: new Date(
      (lastBucketStart + HEARTBEAT_BUCKET_SECONDS) * 1000,
    ).toISOString(),
  };
};

export const buildEmptySummary = (): AvailabilityResponse["summary"] => ({
  totalModels: 0,
  availableModels: 0,
  degradedModels: 0,
  unavailableModels: 0,
  unknownModels: 0,
});

export const markSummaryDegraded = (
  summary: AvailabilityResponse["summary"],
): AvailabilityResponse["summary"] => {
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
};
