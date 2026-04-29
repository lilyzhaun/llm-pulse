import type { NewApiLogItem } from "@llm-pulse/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AggregationService,
  type AggregationLog,
  buildAvailabilityResponseForLogs,
} from "../../src/services/aggregationService.js";
import { cacheService } from "../../src/services/cacheService.js";

vi.mock("../../src/services/persistenceService.js", () => ({
  persistenceService: {
    savePulseState: vi.fn(),
    loadPulseState: vi.fn(),
  },
}));

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

const newApiLog = (overrides: Partial<NewApiLogItem> = {}): NewApiLogItem => ({
  id: 1,
  user_id: 100,
  created_at: 1_704_067_200,
  type: 2,
  content: "redacted request body",
  username: "user@example.com",
  token_name: "token",
  model_name: "gpt-4o-mini",
  quota: 1,
  prompt_tokens: 1,
  completion_tokens: 1,
  use_time: 1,
  is_stream: false,
  channel: 10,
  channel_name: "primary",
  token_id: 200,
  group: "default",
  ip: "127.0.0.1",
  request_id: "request-1",
  other: "ignored metadata",
  ...overrides,
});

describe("buildAvailabilityResponseForLogs", () => {
  beforeEach(() => {
    cacheService.clear();
  });

  it("returns an empty response shape when no logs are present", () => {
    const response = buildAvailabilityResponseForLogs([], GENERATED_AT);

    expect(response).toEqual({
      generatedAt: GENERATED_AT,
      window: {
        from: GENERATED_AT,
        to: GENERATED_AT,
        seconds: 0,
      },
      heartbeat: {
        bucketSeconds: 60,
        bucketCount: 0,
        from: GENERATED_AT,
        to: GENERATED_AT,
      },
      summary: {
        totalModels: 0,
        availableModels: 0,
        degradedModels: 0,
        unavailableModels: 0,
        unknownModels: 0,
      },
      models: [],
    });
  });

  it("marks a single successful model and channel as available", () => {
    const response = buildAvailabilityResponseForLogs(
      [log({ use_time: 2 })],
      GENERATED_AT,
    );

    expect(response.summary).toEqual({
      totalModels: 1,
      availableModels: 1,
      degradedModels: 0,
      unavailableModels: 0,
      unknownModels: 0,
    });
    expect(response.models).toHaveLength(1);
    expect(response.models[0]).toEqual({
      modelName: "gpt-4o-mini",
      status: "available",
      successCount: 1,
      errorCount: 0,
      totalCount: 1,
      successRate: 1,
      averageLatencySeconds: 2,
      lastSeenAt: "2024-01-01T00:00:00.000Z",
      heartbeat: {
        healthyBuckets: 1,
        degradedBuckets: 0,
        unavailableBuckets: 0,
        unknownBuckets: 0,
        observedBuckets: 1,
        availabilityRate: 1,
        lastStatus: "available",
        lastBeatAt: "2024-01-01T00:00:00.000Z",
      },
      beats: [
        {
          start: "2024-01-01T00:00:00.000Z",
          end: "2024-01-01T00:01:00.000Z",
          status: "available",
          successCount: 1,
          errorCount: 0,
          totalCount: 1,
          successRate: 1,
          averageLatencySeconds: 2,
        },
      ],
      channels: [
        {
          channelId: 10,
          channelName: "primary",
          status: "available",
          successCount: 1,
          errorCount: 0,
          totalCount: 1,
          successRate: 1,
          averageLatencySeconds: 2,
          lastSeenAt: "2024-01-01T00:00:00.000Z",
          heartbeat: {
            healthyBuckets: 1,
            degradedBuckets: 0,
            unavailableBuckets: 0,
            unknownBuckets: 0,
            observedBuckets: 1,
            availabilityRate: 1,
            lastStatus: "available",
            lastBeatAt: "2024-01-01T00:00:00.000Z",
          },
          beats: [
            {
              start: "2024-01-01T00:00:00.000Z",
              end: "2024-01-01T00:01:00.000Z",
              status: "available",
              successCount: 1,
              errorCount: 0,
              totalCount: 1,
              successRate: 1,
              averageLatencySeconds: 2,
            },
          ],
        },
      ],
    });
  });

  it("marks a model and channel with only failures as unavailable", () => {
    const response = buildAvailabilityResponseForLogs(
      [
        log({ id: 2, created_at: 1_704_067_260, type: 5, use_time: 4 }),
        log({ id: 1, type: 5, use_time: 2 }),
      ],
      GENERATED_AT,
    );

    expect(response.summary).toEqual({
      totalModels: 1,
      availableModels: 0,
      degradedModels: 0,
      unavailableModels: 1,
      unknownModels: 0,
    });
    expect(response.models[0]).toMatchObject({
      modelName: "gpt-4o-mini",
      status: "unavailable",
      successCount: 0,
      errorCount: 2,
      totalCount: 2,
      successRate: 0,
      averageLatencySeconds: 3,
      lastSeenAt: "2024-01-01T00:01:00.000Z",
    });
    expect(response.models[0]?.channels[0]).toMatchObject({
      channelId: 10,
      channelName: "primary",
      status: "unavailable",
      successCount: 0,
      errorCount: 2,
      totalCount: 2,
      successRate: 0,
      averageLatencySeconds: 3,
      lastSeenAt: "2024-01-01T00:01:00.000Z",
    });
  });

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

  it("sorts mixed models and channels while preserving per-channel structures", () => {
    const response = buildAvailabilityResponseForLogs(
      [
        log({
          id: 7,
          created_at: 1_704_067_380,
          model_name: "beta-model",
          channel: 21,
          channel_name: "b-channel",
        }),
        log({
          id: 6,
          created_at: 1_704_067_350,
          type: 5,
          model_name: "alpha-model",
          channel: 12,
          channel_name: "zeta",
        }),
        log({
          id: 5,
          created_at: 1_704_067_340,
          model_name: "alpha-model",
          channel: 11,
          channel_name: "alpha",
        }),
        log({
          id: 4,
          created_at: 1_704_067_330,
          model_name: "alpha-model",
          channel: 11,
          channel_name: "alpha",
        }),
        log({
          id: 3,
          created_at: 1_704_067_320,
          type: 5,
          model_name: "alpha-model",
          channel: 12,
          channel_name: "zeta",
        }),
        log({
          id: 2,
          created_at: 1_704_067_310,
          model_name: "alpha-model",
          channel: 12,
          channel_name: "zeta",
        }),
        log({
          id: 1,
          created_at: 1_704_067_300,
          model_name: "alpha-model",
          channel: 11,
          channel_name: "alpha",
        }),
      ],
      GENERATED_AT,
    );

    expect(response.summary).toEqual({
      totalModels: 2,
      availableModels: 1,
      degradedModels: 1,
      unavailableModels: 0,
      unknownModels: 0,
    });
    expect(response.models.map((model) => model.modelName)).toEqual([
      "beta-model",
      "alpha-model",
    ]);
    expect(response.models.map((model) => model.status)).toEqual([
      "available",
      "degraded",
    ]);

    const alpha = response.models[1];
    expect(alpha).toMatchObject({
      modelName: "alpha-model",
      status: "degraded",
      successCount: 4,
      errorCount: 2,
      totalCount: 6,
      successRate: 2 / 3,
      lastSeenAt: "2024-01-01T00:02:30.000Z",
    });
    expect(alpha?.channels.map((channel) => channel.channelName)).toEqual([
      "alpha",
      "zeta",
    ]);
    expect(alpha?.channels[0]).toMatchObject({
      channelId: 11,
      channelName: "alpha",
      status: "available",
      successCount: 3,
      errorCount: 0,
      totalCount: 3,
      successRate: 1,
    });
    expect(alpha?.channels[1]).toMatchObject({
      channelId: 12,
      channelName: "zeta",
      status: "unavailable",
      successCount: 1,
      errorCount: 2,
      totalCount: 3,
      successRate: 1 / 3,
    });
  });

  it("orders same-timestamp merged logs by descending id", async () => {
    const service = new AggregationService();

    await service.ingestLogs(
      [
        newApiLog({ id: 1, created_at: 1_704_067_200 }),
        newApiLog({ id: 3, created_at: 1_704_067_200 }),
        newApiLog({ id: 2, created_at: 1_704_067_200 }),
      ],
      { lastSeenTimestamp: null },
    );

    const recentLogs = cacheService.get<AggregationLog[]>("recent-logs");
    expect(recentLogs?.map((recentLog) => recentLog.id)).toEqual([3, 2, 1]);
    expect(recentLogs?.map((recentLog) => recentLog.created_at)).toEqual([
      1_704_067_200, 1_704_067_200, 1_704_067_200,
    ]);
  });

  it("returns null average latency when request logs have no positive use_time", () => {
    const response = buildAvailabilityResponseForLogs(
      [
        log({ id: 2, created_at: 1_704_067_260, use_time: 0 }),
        log({ id: 1, use_time: -1 }),
      ],
      GENERATED_AT,
    );

    expect(response.models[0]).toMatchObject({
      modelName: "gpt-4o-mini",
      status: "available",
      successCount: 2,
      errorCount: 0,
      totalCount: 2,
      averageLatencySeconds: null,
    });
    expect(response.models[0]?.channels[0]).toMatchObject({
      channelName: "primary",
      averageLatencySeconds: null,
    });
    expect(response.models[0]?.beats).toEqual([
      {
        start: "2024-01-01T00:00:00.000Z",
        end: "2024-01-01T00:01:00.000Z",
        status: "available",
        successCount: 1,
        errorCount: 0,
        totalCount: 1,
        successRate: 1,
        averageLatencySeconds: null,
      },
      {
        start: "2024-01-01T00:01:00.000Z",
        end: "2024-01-01T00:02:00.000Z",
        status: "available",
        successCount: 1,
        errorCount: 0,
        totalCount: 1,
        successRate: 1,
        averageLatencySeconds: null,
      },
    ]);
  });

  it("characterizes status thresholds at 0, 50, 89, 90, and 100 percent success", () => {
    const logs: AggregationLog[] = [];
    const addThresholdLogs = (
      modelName: string,
      bucketStart: number,
      successCount: number,
      errorCount: number,
    ) => {
      for (let index = 0; index < successCount; index += 1) {
        logs.push(
          log({
            id: logs.length + 1,
            created_at: bucketStart,
            model_name: modelName,
            type: 2,
          }),
        );
      }
      for (let index = 0; index < errorCount; index += 1) {
        logs.push(
          log({
            id: logs.length + 1,
            created_at: bucketStart,
            model_name: modelName,
            type: 5,
          }),
        );
      }
    };

    addThresholdLogs("rate-0", 1_704_067_200, 0, 1);
    addThresholdLogs("rate-50", 1_704_067_260, 1, 1);
    addThresholdLogs("rate-89", 1_704_067_320, 89, 11);
    addThresholdLogs("rate-90", 1_704_067_380, 9, 1);
    addThresholdLogs("rate-100", 1_704_067_440, 1, 0);

    const response = buildAvailabilityResponseForLogs(logs, GENERATED_AT);

    const byName = new Map(
      response.models.map((model) => [model.modelName, model]),
    );
    expect(byName.get("rate-0")).toMatchObject({
      status: "unavailable",
      successRate: 0,
      successCount: 0,
      errorCount: 1,
    });
    expect(byName.get("rate-50")).toMatchObject({
      status: "degraded",
      successRate: 0.5,
      successCount: 1,
      errorCount: 1,
    });
    expect(byName.get("rate-89")).toMatchObject({
      status: "degraded",
      successRate: 0.89,
      successCount: 89,
      errorCount: 11,
    });
    expect(byName.get("rate-90")).toMatchObject({
      status: "available",
      successRate: 0.9,
      successCount: 9,
      errorCount: 1,
    });
    expect(byName.get("rate-100")).toMatchObject({
      status: "available",
      successRate: 1,
      successCount: 1,
      errorCount: 0,
    });
  });

  it("assigns boundary timestamps to minute heartbeat buckets and reports the latest observed window", () => {
    const response = buildAvailabilityResponseForLogs(
      [
        log({ id: 4, created_at: 1_704_067_320, type: 2 }),
        log({ id: 3, created_at: 1_704_067_319, type: 2 }),
        log({ id: 2, created_at: 1_704_067_260, type: 5 }),
        log({ id: 1, created_at: 1_704_067_259, type: 2 }),
      ],
      GENERATED_AT,
    );

    expect(response.window).toEqual({
      from: "2024-01-01T00:00:59.000Z",
      to: "2024-01-01T00:02:00.000Z",
      seconds: 61,
    });
    expect(response.heartbeat).toEqual({
      bucketSeconds: 60,
      bucketCount: 3,
      from: "2024-01-01T00:00:00.000Z",
      to: "2024-01-01T00:03:00.000Z",
    });
    expect(response.models[0]?.beats).toEqual([
      {
        start: "2024-01-01T00:00:00.000Z",
        end: "2024-01-01T00:01:00.000Z",
        status: "available",
        successCount: 1,
        errorCount: 0,
        totalCount: 1,
        successRate: 1,
        averageLatencySeconds: 1,
      },
      {
        start: "2024-01-01T00:01:00.000Z",
        end: "2024-01-01T00:02:00.000Z",
        status: "degraded",
        successCount: 1,
        errorCount: 1,
        totalCount: 2,
        successRate: 0.5,
        averageLatencySeconds: 1,
      },
      {
        start: "2024-01-01T00:02:00.000Z",
        end: "2024-01-01T00:03:00.000Z",
        status: "available",
        successCount: 1,
        errorCount: 0,
        totalCount: 1,
        successRate: 1,
        averageLatencySeconds: 1,
      },
    ]);
  });

  it("deduplicates unordered ingested logs by id with existing entries winning and keeps newest logs first", async () => {
    const service = new AggregationService();

    await service.ingestLogs(
      [
        newApiLog({ id: 1, created_at: 1_704_067_200, model_name: "older" }),
        newApiLog({ id: 2, created_at: 1_704_067_260, model_name: "updated" }),
      ],
      { lastSeenTimestamp: null },
    );
    await service.ingestLogs(
      [
        newApiLog({ id: 3, created_at: 1_704_067_320, model_name: "newest" }),
        newApiLog({
          id: 2,
          created_at: 1_704_067_380,
          type: 5,
          model_name: "incoming-wins",
        }),
        newApiLog({ id: 4, created_at: 1_704_067_260, model_name: "tie" }),
      ],
      { lastSeenTimestamp: 1_704_067_260 },
    );

    const recentLogs = cacheService.get<AggregationLog[]>("recent-logs");
    expect(recentLogs).toEqual([
      log({ id: 3, created_at: 1_704_067_320, model_name: "newest" }),
      log({ id: 4, created_at: 1_704_067_260, model_name: "tie" }),
      log({ id: 2, created_at: 1_704_067_260, model_name: "updated" }),
      log({ id: 1, created_at: 1_704_067_200, model_name: "older" }),
    ]);
  });
});
