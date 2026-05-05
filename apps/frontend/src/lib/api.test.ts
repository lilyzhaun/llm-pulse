import type { AvailabilityResponse } from "@llm-pulse/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAvailabilitySnapshot } from "./api";

function createSnapshot(
  overrides: Partial<AvailabilityResponse> = {},
): AvailabilityResponse {
  return {
    generatedAt: "2026-04-29T10:00:00.000Z",
    dataSource: {
      kind: "upstream-postgres",
      lastQueryAt: "2026-04-29T10:00:00.000Z",
      lastQueryDurationMs: 42,
      lastErrorMessage: null,
    },
    window: {
      from: "2026-04-29T09:00:00.000Z",
      to: "2026-04-29T10:00:00.000Z",
      seconds: 3600,
    },
    heartbeat: {
      bucketSeconds: 60,
      bucketCount: 60,
      from: "2026-04-29T09:00:00.000Z",
      to: "2026-04-29T10:00:00.000Z",
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
        modelName: "gpt-4.1",
        status: "available",
        successCount: 1,
        errorCount: 0,
        totalCount: 1,
        successRate: 1,
        averageLatencySeconds: 1,
        lastSeenAt: "2026-04-29T10:00:00.000Z",
        tokens: {
          input: 1,
          cacheInput: 0,
          output: 2,
          total: 3,
        },
        cost: {
          quota: 0.1,
        },
        rpm: {
          average: 1,
          peak: 2,
        },
        tpm: {
          average: 3,
          peak: 4,
        },
        heartbeat: {
          healthyBuckets: 1,
          degradedBuckets: 0,
          unavailableBuckets: 0,
          unknownBuckets: 0,
          observedBuckets: 1,
          availabilityRate: 1,
          lastStatus: "available",
          lastBeatAt: "2026-04-29T10:00:00.000Z",
        },
        beats: [],
        channels: [],
      },
    ],
    ...overrides,
  };
}

describe("getAvailabilitySnapshot", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
  });

  it("fetches the pulse API and returns a validated snapshot", async () => {
    const snapshot = createSnapshot();
    const signal = new AbortController().signal;
    const fetchMock = vi.mocked(fetch);

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(snapshot), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(getAvailabilitySnapshot(signal)).resolves.toEqual(snapshot);
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:3000/api/pulse", {
      headers: {
        Accept: "application/json",
      },
      signal,
    });
  });

  it("throws a status-specific error for failed HTTP responses", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: "nope" }), { status: 503 }),
    );

    await expect(getAvailabilitySnapshot()).rejects.toThrow(
      "Pulse API 返回 503",
    );
  });

  it("rejects malformed response payloads", async () => {
    const malformedModel = {
      ...createSnapshot().models[0]!,
      tokens: { input: Number.NaN, cacheInput: 0, output: 0, total: 0 },
    };

    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify(
          createSnapshot({
            models: [malformedModel],
          }),
        ),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(getAvailabilitySnapshot()).rejects.toThrow(
      "Pulse API 返回格式不正确。",
    );
  });
});
