import { describe, expect, it } from "vitest";
import {
  buildAvailabilityResponseForLogs,
  type AggregationLog,
} from "../../src/services/aggregationService.js";

const GENERATED_AT = "2024-01-01T00:05:00.000Z";

const log = (overrides: Partial<AggregationLog> = {}): AggregationLog => ({
  id: 1,
  created_at: 1_704_067_200,
  type: 2,
  model_name: "gpt-4o-mini",
  use_time: 1,
  channel: 10,
  channel_name: "primary",
  ...overrides,
});

describe("buildAvailabilityResponseForLogs", () => {
  it("aggregates model, channel, status, and heartbeat counts from request logs", () => {
    const response = buildAvailabilityResponseForLogs(
      [
        log({
          id: 6,
          created_at: 1_704_067_325,
          type: 5,
          model_name: "only-errors",
          channel: 30,
          channel_name: "backup",
        }),
        log({
          id: 5,
          created_at: 1_704_067_300,
          type: 2,
          model_name: "mostly-good",
          use_time: 4,
        }),
        log({
          id: 4,
          created_at: 1_704_067_260,
          type: 5,
          model_name: "mostly-good",
          use_time: 2,
        }),
        log({
          id: 3,
          created_at: 1_704_067_220,
          type: 2,
          model_name: "mostly-good",
          use_time: 0,
        }),
        log({
          id: 2,
          created_at: 1_704_067_205,
          type: 2,
          model_name: "mostly-good",
          use_time: 1,
        }),
        log({
          id: 1,
          created_at: 1_704_067_200,
          type: 2,
          model_name: "mostly-good",
          use_time: 3,
        }),
      ],
      GENERATED_AT,
    );

    expect(response.summary).toEqual({
      totalModels: 2,
      availableModels: 0,
      degradedModels: 1,
      unavailableModels: 1,
      unknownModels: 0,
    });
    expect(response.window).toEqual({
      from: "2024-01-01T00:00:00.000Z",
      to: "2024-01-01T00:02:05.000Z",
      seconds: 125,
    });
    expect(response.heartbeat).toEqual({
      bucketSeconds: 60,
      bucketCount: 3,
      from: "2024-01-01T00:00:00.000Z",
      to: "2024-01-01T00:03:00.000Z",
    });

    const mostlyGood = response.models.find(
      (model) => model.modelName === "mostly-good",
    );
    expect(mostlyGood).toMatchObject({
      status: "degraded",
      successCount: 4,
      errorCount: 1,
      totalCount: 5,
      successRate: 0.8,
      averageLatencySeconds: 2.5,
      lastSeenAt: "2024-01-01T00:01:40.000Z",
    });
    expect(mostlyGood?.heartbeat).toEqual({
      healthyBuckets: 1,
      degradedBuckets: 1,
      unavailableBuckets: 0,
      unknownBuckets: 0,
      observedBuckets: 2,
      availabilityRate: 0.5,
      lastStatus: "degraded",
      lastBeatAt: "2024-01-01T00:01:00.000Z",
    });
    expect(mostlyGood?.beats.map((beat) => beat.status)).toEqual([
      "available",
      "degraded",
    ]);
    expect(mostlyGood?.channels).toHaveLength(1);
    expect(mostlyGood?.channels[0]).toMatchObject({
      channelId: 10,
      channelName: "primary",
      status: "degraded",
      successCount: 4,
      errorCount: 1,
      totalCount: 5,
      successRate: 0.8,
      averageLatencySeconds: 2.5,
    });

    const onlyErrors = response.models.find(
      (model) => model.modelName === "only-errors",
    );
    expect(onlyErrors).toMatchObject({
      status: "unavailable",
      successCount: 0,
      errorCount: 1,
      totalCount: 1,
      successRate: 0,
      averageLatencySeconds: 1,
      lastSeenAt: "2024-01-01T00:02:05.000Z",
    });
  });

  it("keeps non-request log types from affecting counts while preserving redacted shape", () => {
    const response = buildAvailabilityResponseForLogs(
      [
        log({
          id: 2,
          created_at: 1_704_067_260,
          type: 3,
          model_name: "audit-only",
          use_time: 30,
          channel: 99,
          channel_name: "ignored",
        }),
      ],
      GENERATED_AT,
    );

    expect(response.summary).toEqual({
      totalModels: 1,
      availableModels: 0,
      degradedModels: 0,
      unavailableModels: 0,
      unknownModels: 1,
    });
    expect(response.heartbeat).toEqual({
      bucketSeconds: 60,
      bucketCount: 0,
      from: GENERATED_AT,
      to: GENERATED_AT,
    });
    expect(response.models[0]).toMatchObject({
      modelName: "audit-only",
      status: "unknown",
      successCount: 0,
      errorCount: 0,
      totalCount: 0,
      successRate: 0,
      averageLatencySeconds: null,
      lastSeenAt: null,
      beats: [],
    });
    expect(response.models[0]?.channels[0]).toMatchObject({
      channelId: 99,
      channelName: "ignored",
      status: "unknown",
      successCount: 0,
      errorCount: 0,
      totalCount: 0,
      averageLatencySeconds: null,
      beats: [],
    });
  });
});
