import "@testing-library/jest-dom/vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, vi } from "vitest";

expect.extend(matchers);
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function installMatchMediaMock() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => {
      const listeners = new Set<(event: MediaQueryListEvent) => void>();
      const mediaQueryList = {
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(
          (eventName: string, listener: EventListener) => {
            if (eventName === "change") {
              listeners.add(listener as (event: MediaQueryListEvent) => void);
            }
          },
        ),
        removeEventListener: vi.fn(
          (eventName: string, listener: EventListener) => {
            if (eventName === "change") {
              listeners.delete(
                listener as (event: MediaQueryListEvent) => void,
              );
            }
          },
        ),
        dispatchEvent: vi.fn((event: Event) => {
          for (const listener of listeners) {
            listener(event as MediaQueryListEvent);
          }
          return true;
        }),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      } satisfies MediaQueryList;

      return mediaQueryList;
    }),
  });
}

function installViewTransitionMock() {
  Object.defineProperty(document, "startViewTransition", {
    configurable: true,
    writable: true,
    value: (callback: () => void | Promise<void>) => {
      const updateCallbackDone = Promise.resolve(callback()).then(
        () => undefined,
      );

      return {
        ready: Promise.resolve(),
        updateCallbackDone,
        finished: updateCallbackDone,
        skipTransition: vi.fn(),
      };
    },
  });
}

function installServiceWorkerMock() {
  if ("serviceWorker" in navigator) {
    return;
  }

  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      register: vi.fn(),
      ready: Promise.resolve(),
    },
  });
}

beforeEach(() => {
  if (typeof window.matchMedia !== "function") {
    installMatchMediaMock();
  }

  if (!("startViewTransition" in document)) {
    installViewTransitionMock();
  }

  installServiceWorkerMock();

  if (!("fetch" in globalThis)) {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("fetch mock 未配置"))),
    );
  }
});

afterEach(() => {
  cleanup();
});
