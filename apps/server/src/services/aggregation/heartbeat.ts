import type {
  HeartbeatBucket,
  HeartbeatSummary,
  HeartbeatWindow,
} from "@llm-pulse/shared";
import {
  HEARTBEAT_BUCKET_COUNT,
  HEARTBEAT_BUCKET_SECONDS,
} from "../../config/constants.js";
import type { AggregationLog } from "./merge.js";
import { getMinuteBucketStart, isRequestLog } from "./merge.js";
import { statusFromCounts } from "./status.js";

export interface AvailabilityAccumulator {
  successCount: number;
  errorCount: number;
  totalCount: number;
  latencyTotal: number;
  latencySamples: number;
  lastSeenAt: number | null;
}

export const createAccumulator = (): AvailabilityAccumulator => ({
  successCount: 0,
  errorCount: 0,
  totalCount: 0,
  latencyTotal: 0,
  latencySamples: 0,
  lastSeenAt: null,
});

export const isoFromSeconds = (value: number | null): string | null => {
  if (value === null) {
    return null;
  }

  return new Date(value * 1000).toISOString();
};

export const averageLatency = (
  accumulator: AvailabilityAccumulator,
): number | null => {
  if (accumulator.latencySamples === 0) {
    return null;
  }

  return accumulator.latencyTotal / accumulator.latencySamples;
};

const observedRequestCount = (accumulator: AvailabilityAccumulator): number =>
  accumulator.successCount + accumulator.errorCount;

export const successRateFromAccumulator = (
  accumulator: AvailabilityAccumulator,
): number => {
  const observedCount = observedRequestCount(accumulator);
  if (observedCount === 0) {
    return 0;
  }

  return accumulator.successCount / observedCount;
};

export const applyLogToAccumulator = (
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

export const collectLatestObservedBucketStarts = (
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

export const buildHeartbeatWindow = (
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

const createHeartbeatAccumulators = (
  bucketCount: number,
): AvailabilityAccumulator[] =>
  Array.from({ length: bucketCount }, () => createAccumulator());

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

export const buildHeartbeatBucketsForLogs = (
  logs: AggregationLog[],
): HeartbeatBucket[] => {
  const bucketStarts = collectLatestObservedBucketStarts(logs);
  const bucketIndexMap = new Map<number, number>(
    bucketStarts.map((bucketStart, index) => [bucketStart, index]),
  );
  const accumulators = createHeartbeatAccumulators(bucketStarts.length);

  for (const log of logs) {
    applyLogToHeartbeatAccumulators(accumulators, log, bucketIndexMap);
  }

  return buildHeartbeatBuckets(accumulators, bucketStarts);
};

export const buildHeartbeatSummary = (
  beats: HeartbeatBucket[],
): HeartbeatSummary => {
  let healthyBuckets = 0;
  let degradedBuckets = 0;
  let unavailableBuckets = 0;
  let unknownBuckets = 0;
  let lastObservedBeat: HeartbeatBucket | null = null;

  for (const beat of beats) {
    if (beat.status === "available") {
      healthyBuckets += 1;
    } else if (beat.status === "degraded") {
      degradedBuckets += 1;
    } else if (beat.status === "unavailable") {
      unavailableBuckets += 1;
    } else {
      unknownBuckets += 1;
    }

    if (beat.totalCount > 0) {
      lastObservedBeat = beat;
    }
  }

  const observedBuckets = beats.length;

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
