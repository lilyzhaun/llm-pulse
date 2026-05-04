import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AggregationService } from "../../src/services/aggregationService.js";
import { startRefreshScheduler } from "../../src/services/refreshScheduler.js";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://pulse:test@localhost:5432/pulse_test";
});

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const stubService = (
  refresh: AggregationService["refresh"],
): AggregationService =>
  ({
    refresh,
  }) as unknown as AggregationService;

describe("startRefreshScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("invokes refresh on each interval tick", async () => {
    const refresh = vi.fn(async () => ({}) as never);
    const handle = startRefreshScheduler({
      intervalMs: 20_000,
      service: stubService(refresh),
    });

    await vi.advanceTimersByTimeAsync(20_000);
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(20_000);
    await flushMicrotasks();

    expect(refresh).toHaveBeenCalledTimes(2);
    handle.stop();
  });

  it("keeps ticking after a refresh failure", async () => {
    const refresh = vi
      .fn<AggregationService["refresh"]>()
      .mockRejectedValueOnce(new Error("upstream offline"))
      .mockResolvedValue({} as never);
    const handle = startRefreshScheduler({
      intervalMs: 1_000,
      service: stubService(refresh),
    });

    await vi.advanceTimersByTimeAsync(1_000);
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(1_000);
    await flushMicrotasks();

    expect(refresh).toHaveBeenCalledTimes(2);
    handle.stop();
  });

  it("stops scheduling further ticks after stop is called", async () => {
    const refresh = vi.fn(async () => ({}) as never);
    const handle = startRefreshScheduler({
      intervalMs: 5_000,
      service: stubService(refresh),
    });

    handle.stop();
    await vi.advanceTimersByTimeAsync(20_000);

    expect(refresh).not.toHaveBeenCalled();
  });
});
