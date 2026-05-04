import type { AvailabilityResponse } from "@llm-pulse/shared";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

const mockAggregationService = vi.hoisted(() => ({
  getAggregatedPulse: vi.fn(),
}));

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://pulse:test@localhost:5432/pulse_test";
});

vi.mock("../../src/services/aggregationService.js", () => ({
  aggregationService: mockAggregationService,
}));

import { createApp } from "../../src/app.js";

const pulseResponse = (): AvailabilityResponse => ({
  generatedAt: "2024-01-01T00:05:00.000Z",
  dataSource: {
    kind: "upstream-postgres",
    lastQueryAt: "2024-01-01T00:05:00.000Z",
    lastQueryDurationMs: 12,
    lastErrorMessage: null,
  },
  window: {
    from: "2024-01-01T00:00:00.000Z",
    to: "2024-01-01T00:05:00.000Z",
    seconds: 300,
  },
  heartbeat: {
    bucketSeconds: 60,
    bucketCount: 5,
    from: "2024-01-01T00:00:00.000Z",
    to: "2024-01-01T00:05:00.000Z",
  },
  summary: {
    totalModels: 1,
    availableModels: 1,
    degradedModels: 0,
    unavailableModels: 0,
    unknownModels: 0,
  },
  models: [
    {
      modelName: "gpt-4o-mini",
      status: "available",
      successCount: 3,
      errorCount: 0,
      totalCount: 3,
      successRate: 1,
      averageLatencySeconds: 1.2,
      lastSeenAt: "2024-01-01T00:04:00.000Z",
      tokens: {
        input: 10,
        cacheInput: 2,
        output: 3,
        total: 15,
      },
      cost: {
        quota: 7,
      },
      rpm: {
        average: 0.2,
        peak: 2,
      },
      tpm: {
        average: 1.5,
        peak: 15,
      },
      heartbeat: {
        healthyBuckets: 1,
        degradedBuckets: 0,
        unavailableBuckets: 0,
        unknownBuckets: 0,
        observedBuckets: 1,
        availabilityRate: 1,
        lastStatus: "available",
        lastBeatAt: "2024-01-01T00:04:00.000Z",
      },
      beats: [],
      channels: [],
    },
  ],
});

describe("pulse routes", () => {
  it("returns aggregated pulse response structure", async () => {
    const expectedPulse = pulseResponse();
    mockAggregationService.getAggregatedPulse.mockResolvedValue(expectedPulse);

    const response = await request(createApp())
      .get("/status/api/pulse")
      .expect(200);

    expect(mockAggregationService.getAggregatedPulse).toHaveBeenCalledTimes(1);
    expect(response.body).toMatchObject({
      generatedAt: expectedPulse.generatedAt,
      window: expectedPulse.window,
      heartbeat: expectedPulse.heartbeat,
      summary: expectedPulse.summary,
      dataSource: expectedPulse.dataSource,
    });
    expect(response.body.models).toHaveLength(1);
    expect(response.body.models[0]).toMatchObject({
      modelName: "gpt-4o-mini",
      status: "available",
      successCount: 3,
      totalCount: 3,
      tokens: {
        input: 10,
        cacheInput: 2,
        output: 3,
        total: 15,
      },
      cost: {
        quota: 7,
      },
      rpm: {
        average: 0.2,
        peak: 2,
      },
      tpm: {
        average: 1.5,
        peak: 15,
      },
    });
    expect(response.body.dataSource).toEqual({
      kind: "upstream-postgres",
      lastQueryAt: "2024-01-01T00:05:00.000Z",
      lastQueryDurationMs: 12,
      lastErrorMessage: null,
    });
    expect(response.body.models[0]).toHaveProperty("tokens.cacheInput", 2);
    expect(response.body.models[0]).toHaveProperty("cost.quota", 7);
    expect(response.body.models[0]).toHaveProperty("rpm.peak", 2);
    expect(response.body.models[0]).toHaveProperty("tpm.peak", 15);
  });
});
