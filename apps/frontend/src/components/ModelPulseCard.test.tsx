import { fireEvent, render, screen, within } from "@testing-library/react";
import type { HeartbeatBucket, ModelAvailability } from "@llm-pulse/shared";
import { describe, expect, it } from "vitest";
import { HeartbeatSlotProvider } from "../contexts/HeartbeatSlotContext";
import { ModelPulseCard } from "./ModelPulseCard";

function createBeat(overrides: Partial<HeartbeatBucket> = {}): HeartbeatBucket {
  return {
    start: "2026-04-29T09:59:00.000Z",
    end: "2026-04-29T10:00:00.000Z",
    status: "available",
    successCount: 9,
    errorCount: 1,
    totalCount: 10,
    successRate: 0.9,
    averageLatencySeconds: 1.2,
    ...overrides,
  };
}

function createModel(
  overrides: Partial<ModelAvailability> = {},
): ModelAvailability {
  return {
    modelName: "gpt-4.1",
    status: "available",
    successCount: 18,
    errorCount: 2,
    totalCount: 20,
    successRate: 0.9,
    averageLatencySeconds: 1.2,
    lastSeenAt: "2026-04-29T09:58:00.000Z",
    tokens: {
      input: 1234,
      cacheInput: 56,
      output: 789,
      total: 2079,
    },
    cost: {
      quota: 12.34,
    },
    rpm: {
      average: 2.5,
      peak: 9,
    },
    tpm: {
      average: 1200,
      peak: 3456,
    },
    heartbeat: {
      healthyBuckets: 3,
      degradedBuckets: 1,
      unavailableBuckets: 1,
      unknownBuckets: 0,
      observedBuckets: 5,
      availabilityRate: 0.6,
      lastStatus: "available",
      lastBeatAt: "2026-04-29T10:00:00.000Z",
    },
    beats: [createBeat()],
    channels: [],
    ...overrides,
  };
}

function renderCard(model: ModelAvailability) {
  return render(
    <HeartbeatSlotProvider>
      <ModelPulseCard model={model} />
    </HeartbeatSlotProvider>,
  );
}

describe("ModelPulseCard", () => {
  it("renders model health metrics and expands usage details", () => {
    renderCard(createModel());

    expect(screen.getByRole("heading", { name: "gpt-4.1" })).not.toBeNull();
    expect(screen.getByText("60%", { selector: "strong" })).not.toBeNull();
    expect(screen.getByText("20", { selector: "strong" })).not.toBeNull();

    const heartbeatBoard = screen.getByLabelText("gpt-4.1 最近 Heartbeat");
    expect(heartbeatBoard).toHaveAttribute("data-beat-count", "1");
    expect(heartbeatBoard).toHaveAttribute("data-slot-count", "60");

    fireEvent.click(screen.getByRole("button", { name: /gpt-4.1/i }));

    expect(screen.getByText("输入 tokens")).not.toBeNull();
    expect(screen.getByText("1,234 (1.2K)")).not.toBeNull();
    expect(screen.getByText("Quota")).not.toBeNull();
    expect(screen.getByText("12.34")).not.toBeNull();
    expect(screen.getByText("异常分钟")).not.toBeNull();
    expect(screen.getByText("2")).not.toBeNull();
  });

  it("shows selected heartbeat details and toggles them off", () => {
    renderCard(
      createModel({
        beats: [
          createBeat({
            start: "2026-04-29T09:58:00.000Z",
            end: "2026-04-29T09:59:00.000Z",
            status: "degraded",
            totalCount: 4,
            successRate: 0.5,
            averageLatencySeconds: null,
          }),
        ],
      }),
    );

    const beatButton = screen.getByRole("button", {
      name: /降级\nRequests 4\n成功率 50%\nLatency 暂无/,
    });

    fireEvent.click(beatButton);
    const detail = screen.getByText("Requests 4").closest("div");

    expect(detail).not.toBeNull();
    expect(within(detail as HTMLElement).getByText("降级")).not.toBeNull();
    expect(
      within(detail as HTMLElement).getByText("成功率 50%"),
    ).not.toBeNull();

    fireEvent.click(beatButton);

    expect(screen.queryByText("Requests 4", { selector: "span" })).toBeNull();
  });

  it("renders empty fallbacks for missing heartbeat and usage values", () => {
    const modelWithUsage = createModel({
      averageLatencySeconds: null,
      lastSeenAt: null,
      heartbeat: {
        healthyBuckets: 0,
        degradedBuckets: 0,
        unavailableBuckets: 0,
        unknownBuckets: 60,
        observedBuckets: 0,
        availabilityRate: null,
        lastStatus: "unknown",
        lastBeatAt: null,
      },
      beats: [],
    });
    const {
      tokens: _tokens,
      cost: _cost,
      rpm: _rpm,
      tpm: _tpm,
      ...model
    } = modelWithUsage;

    renderCard(model);

    expect(screen.getByText("暂无 Request")).not.toBeNull();
    expect(screen.getByText("暂无", { selector: "strong" })).not.toBeNull();
    expect(screen.getByText("Latency 暂无")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /gpt-4.1/i }));

    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
  });
});
