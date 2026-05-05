import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  AvailabilityResponse,
  ModelAvailability,
} from "@llm-pulse/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HeartbeatSlotProvider } from "../contexts/HeartbeatSlotContext";
import { getAvailabilitySnapshot } from "../lib/api";
import { Dashboard } from "./Dashboard";

vi.mock("../lib/api", () => ({
  getAvailabilitySnapshot: vi.fn(),
}));

const getAvailabilitySnapshotMock = vi.mocked(getAvailabilitySnapshot);

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
    averageLatencySeconds: 1.5,
    lastSeenAt: "2026-04-29T10:00:00.000Z",
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
      healthyBuckets: 1,
      degradedBuckets: 0,
      unavailableBuckets: 0,
      unknownBuckets: 0,
      observedBuckets: 1,
      availabilityRate: 1,
      lastStatus: "available",
      lastBeatAt: "2026-04-29T10:00:00.000Z",
    },
    beats: [
      {
        start: "2026-04-29T09:59:00.000Z",
        end: "2026-04-29T10:00:00.000Z",
        status: "available",
        successCount: 9,
        errorCount: 0,
        totalCount: 9,
        successRate: 1,
        averageLatencySeconds: 1.5,
      },
    ],
    channels: [],
    ...overrides,
  };
}

function createSnapshot(
  overrides: Partial<AvailabilityResponse> = {},
): AvailabilityResponse {
  const models = overrides.models ?? [];

  return {
    generatedAt: "2026-04-29T10:00:00.000Z",
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
      totalModels: models.length,
      availableModels: models.filter((model) => model.status === "available")
        .length,
      degradedModels: models.filter((model) => model.status === "degraded")
        .length,
      unavailableModels: models.filter(
        (model) => model.status === "unavailable",
      ).length,
      unknownModels: models.filter((model) => model.status === "unknown")
        .length,
    },
    models,
    ...overrides,
  };
}

function renderDashboard() {
  return render(
    <HeartbeatSlotProvider>
      <Dashboard />
    </HeartbeatSlotProvider>,
  );
}

describe("Dashboard", () => {
  beforeEach(() => {
    getAvailabilitySnapshotMock.mockReset();
  });

  it("renders loading state while snapshot is pending", () => {
    getAvailabilitySnapshotMock.mockReturnValue(new Promise(() => undefined));

    renderDashboard();

    expect(
      screen.getByRole("heading", { name: "正在读取 Model 状态…" }),
    ).not.toBeNull();
    expect(screen.getByText("请稍等。")).not.toBeNull();
  });

  it("renders error state when snapshot loading fails", async () => {
    getAvailabilitySnapshotMock.mockRejectedValue(new Error("API 暂不可用"));

    renderDashboard();

    expect(
      await screen.findByRole("heading", { name: "无法读取 Model 状态" }),
    ).not.toBeNull();
    expect(screen.getByText("API 暂不可用")).not.toBeNull();
    expect(screen.getByRole("button", { name: "重试" })).not.toBeNull();
  });

  it("renders empty state when snapshot has no models", async () => {
    getAvailabilitySnapshotMock.mockResolvedValue(createSnapshot());

    renderDashboard();

    expect(
      await screen.findByRole("heading", { name: "dammapi状态监控" }),
    ).not.toBeNull();
    expect(screen.getByText("Models")).not.toBeNull();
    expect(screen.getByText("0")).not.toBeNull();
    expect(
      screen.getByRole("heading", { name: "未找到符合关键词的 Model" }),
    ).not.toBeNull();
  });

  it("renders model data from a loaded snapshot", async () => {
    getAvailabilitySnapshotMock.mockResolvedValue(
      createSnapshot({ models: [createModel()] }),
    );

    renderDashboard();

    expect(
      await screen.findByRole("heading", { name: "gpt-4.1" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("heading", { name: "dammapi状态监控" }),
    ).not.toBeNull();
    expect(screen.getByText("按最近 Request 排序")).not.toBeNull();
    expect(
      screen
        .getByLabelText("gpt-4.1 最近 Heartbeat")
        .getAttribute("data-beat-count"),
    ).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: /gpt-4.1/i }));
    expect(screen.getByText("输入 tokens")).not.toBeNull();
    expect(screen.getByText("1,234 (1.2K)")).not.toBeNull();
    expect(screen.getByText("Quota")).not.toBeNull();
    expect(screen.getByText("12.34")).not.toBeNull();
    expect(screen.getByText("RPM avg / peak")).not.toBeNull();
    expect(screen.getByText("1.2K TPM / 3.5K TPM")).not.toBeNull();

    await waitFor(() => {
      expect(getAvailabilitySnapshotMock).toHaveBeenCalledTimes(1);
    });
  });
});
