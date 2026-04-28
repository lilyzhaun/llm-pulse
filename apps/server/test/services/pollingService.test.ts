import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PollingService } from "../../src/services/pollingService.js";

const flushPromises = async (): Promise<void> => {
  await Promise.resolve();
};

describe("PollingService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("start creates exactly one interval", () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const service = new PollingService();
    const onTick = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    service.start(onTick, 1_000);

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 1_000);
  });

  it("stop clears the active interval", () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const service = new PollingService();
    const onTick = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    service.start(onTick, 1_000);
    const timer = setIntervalSpy.mock.results[0]?.value;
    service.stop();

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    expect(clearIntervalSpy).toHaveBeenCalledWith(timer);
  });

  it("runNow executes a tick immediately", async () => {
    const service = new PollingService();
    const onTick = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    await service.runNow(onTick);

    expect(onTick).toHaveBeenCalledTimes(1);
  });

  it("skips a scheduled tick while another tick is still running", async () => {
    const service = new PollingService();
    let finishTick: (() => void) | undefined;
    const onTick = vi.fn<() => Promise<void>>(
      () =>
        new Promise<void>((resolve) => {
          finishTick = resolve;
        }),
    );

    const runningTick = service.runNow(onTick);
    await flushPromises();

    service.start(onTick, 1_000);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(onTick).toHaveBeenCalledTimes(1);

    finishTick?.();
    await runningTick;
    await vi.advanceTimersByTimeAsync(1_000);

    expect(onTick).toHaveBeenCalledTimes(2);
  });

  it("repeated start calls do not register multiple timers", () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const service = new PollingService();
    const onTick = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

    service.start(onTick, 1_000);
    service.start(onTick, 500);
    service.start(onTick, 250);

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 1_000);
  });
});
