import type { NewApiLogItem } from "@llm-pulse/shared";
import {
  HEARTBEAT_BUCKET_SECONDS,
  MODEL_LOG_RETENTION_COUNT,
} from "../../config/constants.js";
import { compareByCreatedAtDescThenIdDesc } from "../../lib/comparators.js";
import type { PersistedPulseLog } from "../persistenceService.js";

export type AggregationLog = PersistedPulseLog;

export const sanitizeLog = (log: NewApiLogItem): AggregationLog => ({
  id: log.id,
  created_at: log.created_at,
  type: log.type,
  model_name: log.model_name,
  use_time: log.use_time,
  channel: log.channel,
  channel_name: log.channel_name,
});

export const getMinuteBucketStart = (timestampSeconds: number): number =>
  Math.floor(timestampSeconds / HEARTBEAT_BUCKET_SECONDS) *
  HEARTBEAT_BUCKET_SECONDS;

export const isRequestLog = (log: AggregationLog): boolean =>
  log.type === 2 || log.type === 5;

export const trimLogsPerModel = (logs: AggregationLog[]): AggregationLog[] => {
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

export const mergeLogs = (
  existingLogs: AggregationLog[],
  incomingLogs: AggregationLog[],
): AggregationLog[] => {
  const dedupedById = new Map<number, AggregationLog>();

  for (const log of [...incomingLogs, ...existingLogs]) {
    dedupedById.set(log.id, log);
  }

  return trimLogsPerModel(
    [...dedupedById.values()].sort(compareByCreatedAtDescThenIdDesc),
  );
};
