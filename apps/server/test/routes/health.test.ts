import request from "supertest";
import { describe, expect, it, vi } from "vitest";

const mockAggregationService = vi.hoisted(() => ({
  getPollingStatus: vi.fn(),
  getSnapshotStatus: vi.fn(),
}));

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://pulse:test@localhost:5432/pulse_test";
});

vi.mock("../../src/services/aggregationService.js", () => ({
  aggregationService: mockAggregationService,
}));

import { createApp } from "../../src/app.js";

describe("health routes", () => {
  it("returns health status and core service fields", async () => {
    mockAggregationService.getPollingStatus.mockReturnValue(null);
    mockAggregationService.getSnapshotStatus.mockReturnValue({
      enabled: false,
      ready: false,
      bootstrapCompletedAt: null,
      lastRefreshAt: null,
      coveredUntil: null,
      lagSeconds: null,
      lastRefreshSucceeded: null,
      processedLogCount: null,
    });

    const response = await request(createApp())
      .get("/status/api/health")
      .expect(200);

    expect(response.body).toMatchObject({
      status: "ok",
      service: "llm-pulse-bff",
      polling: null,
      upstreamDb: {
        reachable: true,
        lastSuccessAt: null,
      },
      snapshot: {
        enabled: false,
        ready: false,
        bootstrapCompletedAt: null,
        lastRefreshAt: null,
        coveredUntil: null,
        lagSeconds: null,
        lastRefreshSucceeded: null,
        processedLogCount: null,
      },
    });
    expect(response.body.uptimeSeconds).toEqual(expect.any(Number));
  });

  it("returns degraded upstream-db status with sanitized polling error", async () => {
    mockAggregationService.getPollingStatus.mockReturnValue({
      lastQueryAt: "2024-01-01T00:05:00.000Z",
      lastQuerySucceeded: false,
      lastErrorMessage:
        "password authentication failed for host=db.internal.local",
      lastQueryDurationMs: 25,
      lastPollAt: "2024-01-01T00:05:00.000Z",
      lastPollSucceeded: false,
    });
    mockAggregationService.getSnapshotStatus.mockReturnValue({
      enabled: true,
      ready: true,
      bootstrapCompletedAt: "2024-01-01T00:00:00.000Z",
      lastRefreshAt: "2024-01-01T00:05:00.000Z",
      coveredUntil: 1704067500,
      lagSeconds: 12,
      lastRefreshSucceeded: true,
      processedLogCount: 2,
    });

    const response = await request(createApp())
      .get("/status/api/health")
      .expect(200);

    expect(response.body).toMatchObject({
      status: "degraded",
      polling: {
        lastQueryAt: "2024-01-01T00:05:00.000Z",
        lastQuerySucceeded: false,
        lastErrorMessage: "Polling failed; see server logs",
        lastQueryDurationMs: 25,
        lastPollAt: "2024-01-01T00:05:00.000Z",
        lastPollSucceeded: false,
      },
      upstreamDb: {
        reachable: false,
        lastSuccessAt: null,
      },
    });
  });

  it("returns reachable upstream-db status and last success timestamp", async () => {
    mockAggregationService.getPollingStatus.mockReturnValue({
      lastQueryAt: "2024-01-01T00:06:00.000Z",
      lastQuerySucceeded: true,
      lastErrorMessage: null,
      lastQueryDurationMs: 12,
      lastPollAt: "2024-01-01T00:06:00.000Z",
      lastPollSucceeded: true,
    });
    mockAggregationService.getSnapshotStatus.mockReturnValue({
      enabled: true,
      ready: false,
      bootstrapCompletedAt: null,
      lastRefreshAt: null,
      coveredUntil: null,
      lagSeconds: null,
      lastRefreshSucceeded: false,
      processedLogCount: 0,
    });

    const response = await request(createApp())
      .get("/status/api/health")
      .expect(200);

    expect(response.body.upstreamDb).toEqual({
      reachable: true,
      lastSuccessAt: "2024-01-01T00:06:00.000Z",
    });
  });

  it("returns the expected error shape for unknown routes", async () => {
    const response = await request(createApp())
      .get("/unknown-route")
      .expect(404);

    expect(response.body).toEqual({
      error: {
        message: "Route GET /unknown-route not found",
      },
    });
  });
});
