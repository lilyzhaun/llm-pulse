import { describe, expect, it } from "vitest";
import { buildSnapshotAvailabilityResponse } from "../../../src/services/snapshot/responseBuilder.js";
import type { SnapshotData } from "../../../src/services/snapshot/types.js";

const buildFixtureSnapshot = (): SnapshotData => {
  const models = new Map();
  const channels = new Map();

  models.set("model-a", [
    {
      modelName: "model-a",
      bucketStart: 1_704_067_200,
      successCount: 2,
      errorCount: 1,
      totalCount: 3,
      latencySumSeconds: 4,
      latencySamples: 2,
      promptTokens: 100,
      cacheTokens: 20,
      completionTokens: 30,
      quotaSum: 10,
      lastSeenAt: 1_704_067_250,
    },
    {
      modelName: "model-a",
      bucketStart: 1_704_067_260,
      successCount: 1,
      errorCount: 0,
      totalCount: 1,
      latencySumSeconds: 1,
      latencySamples: 1,
      promptTokens: 40,
      cacheTokens: 10,
      completionTokens: 5,
      quotaSum: 4,
      lastSeenAt: 1_704_067_300,
    },
  ]);
  models.set("model-b", [
    {
      modelName: "model-b",
      bucketStart: 1_704_000_000,
      successCount: 0,
      errorCount: 2,
      totalCount: 2,
      latencySumSeconds: 3,
      latencySamples: 1,
      promptTokens: 0,
      cacheTokens: 0,
      completionTokens: 0,
      quotaSum: 7,
      lastSeenAt: 1_704_000_030,
    },
    {
      modelName: "model-b",
      bucketStart: 1_704_050_000,
      successCount: 1,
      errorCount: 1,
      totalCount: 2,
      latencySumSeconds: 2,
      latencySamples: 2,
      promptTokens: 50,
      cacheTokens: 5,
      completionTokens: 15,
      quotaSum: 3,
      lastSeenAt: 1_704_050_030,
    },
  ]);

  channels.set("model-a", [
    {
      modelName: "model-a",
      channelId: 1,
      channelName: "primary",
      bucketStart: 1_704_067_200,
      successCount: 2,
      errorCount: 1,
      totalCount: 3,
      latencySumSeconds: 4,
      latencySamples: 2,
      promptTokens: 100,
      cacheTokens: 20,
      completionTokens: 30,
      quotaSum: 10,
      lastSeenAt: 1_704_067_250,
    },
    {
      modelName: "model-a",
      channelId: 1,
      channelName: "primary",
      bucketStart: 1_704_067_260,
      successCount: 1,
      errorCount: 0,
      totalCount: 1,
      latencySumSeconds: 1,
      latencySamples: 1,
      promptTokens: 40,
      cacheTokens: 10,
      completionTokens: 5,
      quotaSum: 4,
      lastSeenAt: 1_704_067_300,
    },
  ]);
  channels.set("model-b", [
    {
      modelName: "model-b",
      channelId: 0,
      channelName: "unknown",
      bucketStart: 1_704_000_000,
      successCount: 0,
      errorCount: 2,
      totalCount: 2,
      latencySumSeconds: 3,
      latencySamples: 1,
      promptTokens: 0,
      cacheTokens: 0,
      completionTokens: 0,
      quotaSum: 7,
      lastSeenAt: 1_704_000_030,
    },
    {
      modelName: "model-b",
      channelId: 2,
      channelName: "backup",
      bucketStart: 1_704_050_000,
      successCount: 1,
      errorCount: 1,
      totalCount: 2,
      latencySumSeconds: 2,
      latencySamples: 2,
      promptTokens: 50,
      cacheTokens: 5,
      completionTokens: 15,
      quotaSum: 3,
      lastSeenAt: 1_704_050_030,
    },
  ]);

  return {
    bootstrapCompletedAt: "2026-05-06T00:00:00.000Z",
    coveredUntilCreatedAt: 1_704_067_500,
    coveredUntilId: 99,
    lastRefreshAt: "2026-05-06T00:01:00.000Z",
    lastSuccessAt: "2026-05-06T00:01:00.000Z",
    enabledModels: new Set(["model-a", "model-b", "model-c"]),
    models,
    channels,
    processedLogCount: 4,
  };
};

describe("buildSnapshotAvailabilityResponse", () => {
  it("matches the existing API semantics for totals, rates, sorting, and sparse enabled models", () => {
    const response = buildSnapshotAvailabilityResponse(
      buildFixtureSnapshot(),
      {
        toEpochSeconds: 1_704_067_500,
        generatedAt: "2024-01-01T00:05:00.000Z",
      },
      {
        kind: "upstream-postgres",
        lastQueryAt: "2024-01-01T00:05:00.000Z",
        lastQueryDurationMs: 12,
        lastErrorMessage: null,
      },
    );

    expect(response.dataSource.kind).toBe("upstream-postgres");
    expect(response.window.seconds).toBe(3600);
    expect(response.summary).toEqual({
      totalModels: 2,
      availableModels: 0,
      degradedModels: 1,
      unavailableModels: 1,
      unknownModels: 0,
    });
    expect(response.models.map((model) => model.modelName)).toEqual([
      "model-a",
      "model-b",
    ]);
    expect(response.models[0]).toMatchObject({
      modelName: "model-a",
      status: "degraded",
      successCount: 3,
      errorCount: 1,
      totalCount: 4,
      successRate: 0.75,
      averageLatencySeconds: 5 / 3,
      lastSeenAt: "2024-01-01T00:01:40.000Z",
      tokens: {
        input: 140,
        cacheInput: 30,
        output: 35,
        total: 205,
      },
      cost: { quota: 14 },
      rpm: {
        average: 2,
        peak: 3,
      },
      tpm: {
        average: 102.5,
        peak: 150,
      },
    });
    expect(response.models[0]?.channels).toHaveLength(1);
    expect(response.models[1]).toMatchObject({
      modelName: "model-b",
      status: "unavailable",
      successCount: 1,
      errorCount: 3,
      totalCount: 4,
      successRate: 0.25,
      averageLatencySeconds: 5 / 3,
      tokens: {
        input: 50,
        cacheInput: 5,
        output: 15,
        total: 70,
      },
      cost: { quota: 10 },
      rpm: {
        average: 2,
        peak: 2,
      },
      tpm: {
        average: 35,
        peak: 70,
      },
    });
    expect(
      response.models[1]?.channels.map((channel) => channel.channelName),
    ).toEqual(["backup", "unknown"]);
    expect(response.models.some((model) => model.modelName === "model-c")).toBe(
      false,
    );
    expect(response.heartbeat.bucketCount).toBe(4);
  });

  it("keeps model and channel tie-breaker sorting stable", () => {
    const models = new Map<
      string,
      SnapshotData["models"] extends Map<string, infer T> ? T[number][] : never
    >();
    const channels = new Map<
      string,
      SnapshotData["channels"] extends Map<string, infer T>
        ? T[number][]
        : never
    >();

    const sameLastSeen = 1_704_067_300;
    models.set("model-z", [
      {
        modelName: "model-z",
        bucketStart: 1_704_067_260,
        successCount: 1,
        errorCount: 1,
        totalCount: 2,
        latencySumSeconds: 2,
        latencySamples: 2,
        promptTokens: 20,
        cacheTokens: 2,
        completionTokens: 5,
        quotaSum: 1,
        lastSeenAt: sameLastSeen,
      },
    ]);
    models.set("model-a", [
      {
        modelName: "model-a",
        bucketStart: 1_704_067_260,
        successCount: 2,
        errorCount: 0,
        totalCount: 2,
        latencySumSeconds: 2,
        latencySamples: 2,
        promptTokens: 20,
        cacheTokens: 2,
        completionTokens: 5,
        quotaSum: 1,
        lastSeenAt: sameLastSeen,
      },
    ]);

    channels.set("model-z", [
      {
        modelName: "model-z",
        channelId: 2,
        channelName: "zeta",
        bucketStart: 1_704_067_260,
        successCount: 1,
        errorCount: 0,
        totalCount: 2,
        latencySumSeconds: 1,
        latencySamples: 1,
        promptTokens: 20,
        cacheTokens: 2,
        completionTokens: 5,
        quotaSum: 1,
        lastSeenAt: sameLastSeen,
      },
      {
        modelName: "model-z",
        channelId: 1,
        channelName: "alpha",
        bucketStart: 1_704_067_260,
        successCount: 1,
        errorCount: 0,
        totalCount: 2,
        latencySumSeconds: 1,
        latencySamples: 1,
        promptTokens: 20,
        cacheTokens: 2,
        completionTokens: 5,
        quotaSum: 1,
        lastSeenAt: sameLastSeen,
      },
    ]);

    const response = buildSnapshotAvailabilityResponse(
      {
        bootstrapCompletedAt: "2026-05-06T00:00:00.000Z",
        coveredUntilCreatedAt: 1_704_067_500,
        coveredUntilId: 99,
        lastRefreshAt: "2026-05-06T00:01:00.000Z",
        lastSuccessAt: "2026-05-06T00:01:00.000Z",
        enabledModels: new Set(["model-a", "model-z"]),
        models,
        channels,
        processedLogCount: 3,
      },
      {
        toEpochSeconds: 1_704_067_500,
        generatedAt: "2024-01-01T00:05:00.000Z",
      },
      {
        kind: "upstream-postgres",
        lastQueryAt: "2024-01-01T00:05:00.000Z",
        lastQueryDurationMs: 12,
        lastErrorMessage: null,
      },
    );

    expect(response.models.map((model) => model.modelName)).toEqual([
      "model-z",
      "model-a",
    ]);
    expect(
      response.models[0]?.channels.map((channel) => channel.channelName),
    ).toEqual(["alpha", "zeta"]);
  });

  it("caps response-level heartbeat bucket count to latest 60 observed buckets", () => {
    const modelBuckets = Array.from({ length: 70 }, (_, index) => ({
      modelName: "model-cap",
      bucketStart: 1_700_000_000 + index * 60,
      successCount: 1,
      errorCount: 0,
      totalCount: 1,
      latencySumSeconds: 1,
      latencySamples: 1,
      promptTokens: 1,
      cacheTokens: 0,
      completionTokens: 1,
      quotaSum: 1,
      lastSeenAt: 1_700_000_000 + index * 60,
    }));

    const response = buildSnapshotAvailabilityResponse(
      {
        bootstrapCompletedAt: "2026-05-06T00:00:00.000Z",
        coveredUntilCreatedAt: 1_704_067_500,
        coveredUntilId: 99,
        lastRefreshAt: "2026-05-06T00:01:00.000Z",
        lastSuccessAt: "2026-05-06T00:01:00.000Z",
        enabledModels: new Set(["model-cap"]),
        models: new Map([["model-cap", modelBuckets]]),
        channels: new Map(),
        processedLogCount: 70,
      },
      {
        toEpochSeconds: 1_704_067_500,
        generatedAt: "2024-01-01T00:05:00.000Z",
      },
      {
        kind: "upstream-postgres",
        lastQueryAt: "2024-01-01T00:05:00.000Z",
        lastQueryDurationMs: 12,
        lastErrorMessage: null,
      },
    );

    expect(response.heartbeat.bucketCount).toBe(60);
  });
});
