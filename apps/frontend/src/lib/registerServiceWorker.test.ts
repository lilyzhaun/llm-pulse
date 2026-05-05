import { afterEach, describe, expect, it, vi } from "vitest";

describe("registerServiceWorker", () => {
  const originalServiceWorker = Object.getOwnPropertyDescriptor(
    navigator,
    "serviceWorker",
  );

  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();

    if (originalServiceWorker) {
      Object.defineProperty(navigator, "serviceWorker", originalServiceWorker);
    }
  });

  it("registers the production service worker on window load", async () => {
    vi.stubEnv("DEV", false);
    const register = vi.fn(() =>
      Promise.resolve({} as ServiceWorkerRegistration),
    );
    const listeners: EventListener[] = [];
    const addEventListenerSpy = vi
      .spyOn(window, "addEventListener")
      .mockImplementation((type, listener) => {
        if (type === "load" && typeof listener === "function") {
          listeners.push(listener);
        }
      });

    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register },
    });

    const { registerServiceWorker } = await import("./registerServiceWorker");

    registerServiceWorker();
    expect(addEventListenerSpy).toHaveBeenCalledWith(
      "load",
      expect.any(Function),
    );
    listeners[0]?.(new Event("load"));

    expect(register).toHaveBeenCalledWith("/status/sw.js", {
      scope: "/status/",
    });
  });

  it("does not register during development", async () => {
    vi.stubEnv("DEV", true);
    const register = vi.fn(() =>
      Promise.resolve({} as ServiceWorkerRegistration),
    );
    const addEventListenerSpy = vi.spyOn(window, "addEventListener");

    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register },
    });

    const { registerServiceWorker } = await import("./registerServiceWorker");

    registerServiceWorker();

    expect(addEventListenerSpy).not.toHaveBeenCalledWith(
      "load",
      expect.any(Function),
    );
    expect(register).not.toHaveBeenCalled();
  });

  it("warns when production registration fails", async () => {
    vi.stubEnv("DEV", false);
    const error = new Error("registration failed");
    const register = vi.fn(() => Promise.reject(error));
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const listeners: EventListener[] = [];
    vi.spyOn(window, "addEventListener").mockImplementation(
      (type, listener) => {
        if (type === "load" && typeof listener === "function") {
          listeners.push(listener);
        }
      },
    );

    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register },
    });

    const { registerServiceWorker } = await import("./registerServiceWorker");

    registerServiceWorker();
    listeners[0]?.(new Event("load"));
    await Promise.resolve();

    expect(warnSpy).toHaveBeenCalledWith(
      "Failed to register service worker",
      error,
    );
  });
});
