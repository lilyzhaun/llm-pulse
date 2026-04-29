import type {
  AvailabilityResponse,
  ChannelAvailability,
  HeartbeatBucket,
  ModelAvailability,
} from "@llm-pulse/shared";
import { normalizationService } from "../normalizationService.js";
import {
  type AvailabilityAccumulator,
  applyLogToAccumulator,
  averageLatency,
  buildHeartbeatBucketsForLogs,
  buildHeartbeatSummary,
  buildHeartbeatWindow,
  collectLatestObservedBucketStarts,
  createAccumulator,
  isoFromSeconds,
  successRateFromAccumulator,
} from "./heartbeat.js";
import type { AggregationLog } from "./merge.js";
import { statusFromCounts, statusOrder } from "./status.js";

export const buildResponseWindow = (
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

export const buildChannelAvailability = (
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

export const buildModelAvailability = (
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

export const buildAvailabilityResponseForLogs = (
  logs: AggregationLog[],
  generatedAt: string = new Date().toISOString(),
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
    generatedAt,
    window: buildResponseWindow(logs, generatedAt),
    heartbeat: heartbeatWindow,
    summary: {
      totalModels: models.length,
      availableModels,
      degradedModels,
      unavailableModels,
      unknownModels,
    },
    models,
  };
};
