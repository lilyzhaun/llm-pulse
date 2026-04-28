import type { ModelAvailability } from "@llm-pulse/shared";
import { describe, expect, it } from "vitest";
import { NormalizationService } from "../../src/services/normalizationService.js";

const model = (
  overrides: Partial<ModelAvailability> = {},
): ModelAvailability => ({
  modelName: "gpt-4o-mini",
  status: "available",
  successCount: 3,
  errorCount: 0,
  totalCount: 3,
  successRate: 1,
  averageLatencySeconds: 1.2,
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
      successCount: 3,
      errorCount: 0,
      totalCount: 3,
      successRate: 1,
      averageLatencySeconds: 1.2,
    },
  ],
  channels: [
    {
      channelId: 10,
      channelName: "primary",
      status: "available",
      successCount: 3,
      errorCount: 0,
      totalCount: 3,
      successRate: 1,
      averageLatencySeconds: 1.2,
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
          successCount: 3,
          errorCount: 0,
          totalCount: 3,
          successRate: 1,
          averageLatencySeconds: 1.2,
        },
      ],
    },
  ],
  ...overrides,
});

describe("NormalizationService", () => {
  it("passes through non-empty model arrays without changing reference or content", () => {
    const service = new NormalizationService();
    const models = [model(), model({ modelName: "claude-3-5-sonnet" })];

    const normalized = service.normalizeModels(models);

    expect(normalized).toBe(models);
    expect(normalized).toEqual(models);
  });

  it("passes through empty model arrays as the same empty array", () => {
    const service = new NormalizationService();
    const models: ModelAvailability[] = [];

    const normalized = service.normalizeModels(models);

    expect(normalized).toBe(models);
    expect(normalized).toEqual([]);
  });
});
