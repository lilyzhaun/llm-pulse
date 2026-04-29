import { render, screen, within } from "@testing-library/react";
import type { ChannelAvailability } from "@llm-pulse/shared";
import { describe, expect, it } from "vitest";
import { PulseRow } from "./PulseRow";

function createChannel(
  overrides: Partial<ChannelAvailability> = {},
): ChannelAvailability {
  return {
    channelId: 1,
    channelName: "OpenAI 主通道",
    status: "available",
    successCount: 9,
    errorCount: 1,
    totalCount: 10,
    successRate: 0.9,
    averageLatencySeconds: 1.23,
    lastSeenAt: "2026-04-29T10:00:00.000Z",
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
    ...overrides,
  };
}

describe("PulseRow", () => {
  it("renders channel metrics for normal data", () => {
    render(<PulseRow channel={createChannel()} />);

    expect(
      screen.getByRole("heading", { name: "OpenAI 主通道" }),
    ).not.toBeNull();
    expect(screen.getByText("可用")).not.toBeNull();
    expect(screen.getByText("90%")).not.toBeNull();
    expect(screen.getByText("10")).not.toBeNull();
    expect(screen.getByText("1.2s")).not.toBeNull();
  });

  it("renders fallback text for null latency", () => {
    render(
      <PulseRow
        channel={createChannel({
          channelName: "备用通道",
          averageLatencySeconds: null,
        })}
      />,
    );

    const latencyMetric = screen.getByText("Latency").closest("div");

    expect(screen.getByRole("heading", { name: "备用通道" })).not.toBeNull();
    expect(latencyMetric).not.toBeNull();
    expect(
      within(latencyMetric as HTMLElement).getByText("暂无"),
    ).not.toBeNull();
  });
});
