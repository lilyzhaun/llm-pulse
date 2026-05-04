import { beforeEach, describe, expect, it, vi } from "vitest";
import { AggregationService } from "../../src/services/aggregationService.js";
import type {
  ChannelAggregate,
  ModelAggregate,
  UpstreamHeartbeatBucket,
} from "../../src/services/upstreamDb/index.js";

const mockUpstreamDb = vi.hoisted(() => ({
  getModelAggregates: vi.fn(),
  getChannelAggregates: vi.fn(),
  getHeartbeatBuckets: vi.fn(),
  scrubPgError: vi.fn((error: unknown) => {
    if (error instanceof Error) {
      return { message: error.message };
    }

    return { message: "Upstream PostgreSQL query failed" };
  }),
}));

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://pulse:test@localhost:5432/pulse_test";
});

vi.mock("../../src/services/upstreamDb/index.js", () => mockUpstreamDb);

const GENERATED_AT = "2024-01-01T00:05:00.000Z";
const NEXT_GENERATED_AT = "2024-01-01T00:06:00.000Z";

const modelAggregate = (
  overrides: Partial<ModelAggregate> = {},
): ModelAggregate => ({
  modelName: "gpt-4o-mini",
  totalCount: 4,
  successCount: 3,
  errorCount: 1,
  latencyAvgSeconds: 1.5,
  lastSeenAtMs: Date.parse("2024-01-01T00:04:30.000Z"),
  inputTokens: 100,
  cacheInputTokens: 20,
  outputTokens: 30,
  totalTokens: 150,
  quotaSum: 42,
  rpmAvg: 0.1,
  rpmPeak: 3,
  tpmAvg: 2.5,
  tpmPeak: 120,
  ...overrides,
});

const channelAggregate = (
  overrides: Partial<ChannelAggregate> = {},
): ChannelAggregate => ({
  modelName: "gpt-4o-mini",
  channelId: 10,
  channelName: "primary",
  totalCount: 4,
  successCount: 3,
  errorCount: 1,
  latencyAvgSeconds: 1.5,
  lastSeenAtMs: Date.parse("2024-01-01T00:04:30.000Z"),
  ...overrides,
});

const heartbeatBucket = (
  overrides: Partial<UpstreamHeartbeatBucket> = {},
): UpstreamHeartbeatBucket => ({
  modelName: "gpt-4o-mini",
  bucketStartMs: Date.parse("2024-01-01T00:04:00.000Z"),
  successCount: 3,
  errorCount: 1,
  totalCount: 4,
  latencyAvgSeconds: 1.5,
  ...overrides,
});

const mockSuccessfulQuery = () => {
  mockUpstreamDb.getModelAggregates.mockResolvedValue([modelAggregate()]);
  mockUpstreamDb.getChannelAggregates.mockResolvedValue([channelAggregate()]);
  mockUpstreamDb.getHeartbeatBuckets.mockResolvedValue([heartbeatBucket()]);
};

const mockFailedQuery = () => {
  mockUpstreamDb.getModelAggregates.mockRejectedValue(
    new Error("connection refused for password=[redacted]"),
  );
  mockUpstreamDb.getChannelAggregates.mockResolvedValue([]);
  mockUpstreamDb.getHeartbeatBuckets.mockResolvedValue([]);
};

describe("AggregationService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(GENERATED_AT));
    vi.clearAllMocks();
  });

  it("queries upstream PostgreSQL and maps additive model fields", async () => {
    mockSuccessfulQuery();
    const service = new AggregationService();

    const response = await service.refresh();

    expect(mockUpstreamDb.getModelAggregates).toHaveBeenCalledWith(
      1_704_067_500,
    );
    expect(response).toMatchObject({
      generatedAt: GENERATED_AT,
      dataSource: {
        kind: "upstream-postgres",
        lastQueryAt: GENERATED_AT,
        lastErrorMessage: null,
      },
      summary: {
        totalModels: 1,
        degradedModels: 1,
      },
    });
    expect(response.dataSource?.lastQueryDurationMs).toEqual(
      expect.any(Number),
    );
    expect(response.models[0]).toMatchObject({
      modelName: "gpt-4o-mini",
      status: "degraded",
      successCount: 3,
      errorCount: 1,
      totalCount: 4,
      successRate: 0.75,
      averageLatencySeconds: 1.5,
      lastSeenAt: "2024-01-01T00:04:30.000Z",
      tokens: {
        input: 100,
        cacheInput: 20,
        output: 30,
        total: 150,
      },
      cost: {
        quota: 42,
      },
      rpm: {
        average: 0.1,
        peak: 3,
      },
      tpm: {
        average: 2.5,
        peak: 120,
      },
      channels: [
        {
          channelId: 10,
          channelName: "primary",
          status: "degraded",
        },
      ],
    });
    expect(response.models[0]?.beats).toEqual([
      {
        start: "2024-01-01T00:04:00.000Z",
        end: "2024-01-01T00:05:00.000Z",
        status: "degraded",
        successCount: 3,
        errorCount: 1,
        totalCount: 4,
        successRate: 0.75,
        averageLatencySeconds: 1.5,
      },
    ]);
    expect(service.getPollingStatus()).toMatchObject({
      lastQueryAt: GENERATED_AT,
      lastQuerySucceeded: true,
      lastErrorMessage: null,
      lastPollAt: GENERATED_AT,
      lastPollSucceeded: true,
    });
  });

  it("returns degraded memory snapshot when PostgreSQL fails after a successful refresh", async () => {
    mockSuccessfulQuery();
    const service = new AggregationService();
    const snapshot = await service.refresh();

    vi.setSystemTime(new Date(NEXT_GENERATED_AT));
    mockFailedQuery();

    const response = await service.getAggregatedPulse();

    expect(response.generatedAt).toBe(NEXT_GENERATED_AT);
    expect(response.dataSource).toMatchObject({
      kind: "memory-snapshot",
      lastQueryAt: NEXT_GENERATED_AT,
      lastErrorMessage: "connection refused for password=[redacted]",
    });
    expect(response.models).toEqual(snapshot.models);
    expect(response.summary).toEqual({
      totalModels: 1,
      availableModels: 0,
      degradedModels: 1,
      unavailableModels: 0,
      unknownModels: 0,
    });
    expect(service.getPollingStatus()).toMatchObject({
      lastQueryAt: NEXT_GENERATED_AT,
      lastQuerySucceeded: false,
      lastPollAt: NEXT_GENERATED_AT,
      lastPollSucceeded: false,
    });
  });

  it("returns degraded empty snapshot when PostgreSQL fails before any successful refresh", async () => {
    mockFailedQuery();
    const service = new AggregationService();

    const response = await service.getAggregatedPulse();

    expect(response).toEqual({
      generatedAt: GENERATED_AT,
      dataSource: {
        kind: "empty",
        lastQueryAt: GENERATED_AT,
        lastQueryDurationMs: expect.any(Number),
        lastErrorMessage: "connection refused for password=[redacted]",
      },
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

  it("records startup query failure before any refresh", () => {
    const service = new AggregationService();

    service.markStartupQueryFailure(
      new Error("Upstream PostgreSQL sanity ping failed"),
    );

    expect(service.getPollingStatus()).toEqual({
      lastQueryAt: GENERATED_AT,
      lastQuerySucceeded: false,
      lastErrorMessage: "Upstream PostgreSQL sanity ping failed",
      lastQueryDurationMs: null,
      lastPollAt: GENERATED_AT,
      lastPollSucceeded: false,
    });
  });

  it("does not let a late startup failure override a successful query", async () => {
    mockSuccessfulQuery();
    const service = new AggregationService();
    await service.refresh();

    service.markStartupQueryFailure(
      new Error("Upstream PostgreSQL sanity ping failed"),
    );

    expect(service.getPollingStatus()).toMatchObject({
      lastQueryAt: GENERATED_AT,
      lastQuerySucceeded: true,
      lastErrorMessage: null,
      lastPollAt: GENERATED_AT,
      lastPollSucceeded: true,
    });
  });
});
