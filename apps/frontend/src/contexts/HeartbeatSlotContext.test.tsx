import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { useEffect } from "react";
import {
  HeartbeatSlotProvider,
  useHeartbeatSlotCount,
} from "./HeartbeatSlotContext";

function createMatchMediaMock(matches: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const mediaQueryList = {
    matches,
    media: "(max-width: 720px)",
    onchange: null,
    addEventListener: vi.fn((...args: unknown[]) => {
      const listener = args[1] as
        | ((event: MediaQueryListEvent) => void)
        | undefined;

      if (listener) {
        listeners.add(listener);
      }
    }),
    removeEventListener: vi.fn((...args: unknown[]) => {
      const listener = args[1] as
        | ((event: MediaQueryListEvent) => void)
        | undefined;

      if (listener) {
        listeners.delete(listener);
      }
    }),
    dispatchEvent: vi.fn(() => true),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    trigger(nextMatches: boolean) {
      const event = { matches: nextMatches } as MediaQueryListEvent;

      for (const listener of listeners) {
        listener(event);
      }
    },
  } as unknown as MediaQueryList & {
    trigger(nextMatches: boolean): void;
  };

  return mediaQueryList;
}

describe("HeartbeatSlotContext", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    try {
      act(() => {
        root.unmount();
      });
    } catch {
      // 已在测试中卸载时忽略二次卸载。
    }
    container.remove();
    vi.unstubAllGlobals();
  });

  it("多个消费者共享相同的 slot count", () => {
    const mediaQueryList = createMatchMediaMock(true);
    const values: Array<number> = [];

    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => mediaQueryList),
    );

    function Consumer({ index }: { index: number }) {
      const slotCount = useHeartbeatSlotCount();

      useEffect(() => {
        values[index] = slotCount;
      }, [index, slotCount]);

      return <div data-slot-count={slotCount} />;
    }

    act(() => {
      root.render(
        <HeartbeatSlotProvider>
          <Consumer index={0} />
          <Consumer index={1} />
        </HeartbeatSlotProvider>,
      );
    });

    expect(values).toEqual([30, 30]);
    expect(mediaQueryList.addEventListener).toHaveBeenCalledTimes(1);
  });

  it("matchMedia 不存在时回退到 desktop 默认值", () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      window,
      "matchMedia",
    );

    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: undefined,
    });

    let observedSlotCount = 0;

    function Consumer() {
      observedSlotCount = useHeartbeatSlotCount();
      return null;
    }

    act(() => {
      root.render(
        <HeartbeatSlotProvider>
          <Consumer />
        </HeartbeatSlotProvider>,
      );
    });

    expect(observedSlotCount).toBe(60);

    if (originalDescriptor) {
      Object.defineProperty(window, "matchMedia", originalDescriptor);
    }
  });

  it("卸载后会清理 listener", () => {
    const mediaQueryList = createMatchMediaMock(false);

    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => mediaQueryList),
    );

    act(() => {
      root.render(
        <HeartbeatSlotProvider>
          <div />
        </HeartbeatSlotProvider>,
      );
    });

    expect(mediaQueryList.addEventListener).toHaveBeenCalledTimes(1);

    act(() => {
      root.unmount();
    });

    expect(mediaQueryList.removeEventListener).toHaveBeenCalledTimes(1);
  });
});
