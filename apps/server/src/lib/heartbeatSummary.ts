import type { HeartbeatBucket, HeartbeatSummary } from "@llm-pulse/shared";

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
