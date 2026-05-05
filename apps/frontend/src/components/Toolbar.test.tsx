import { fireEvent, render, screen } from "@testing-library/react";
import type { AvailabilityResponse } from "@llm-pulse/shared";
import { describe, expect, it, vi } from "vitest";
import { Toolbar } from "./Toolbar";

function createSnapshot(
  overrides: Partial<AvailabilityResponse> = {},
): AvailabilityResponse {
  return {
    generatedAt: "2026-04-29T10:00:00.000Z",
    window: {
      from: "2026-04-29T09:00:00.000Z",
      to: "2026-04-29T10:00:00.000Z",
      seconds: 3600,
    },
    heartbeat: {
      bucketSeconds: 60,
      bucketCount: 45,
      from: "2026-04-29T09:15:00.000Z",
      to: "2026-04-29T10:00:00.000Z",
    },
    summary: {
      totalModels: 12,
      availableModels: 8,
      degradedModels: 2,
      unavailableModels: 1,
      unknownModels: 1,
    },
    models: [],
    ...overrides,
  };
}

describe("Toolbar", () => {
  it("renders snapshot metadata and updates the model search query", () => {
    const onModelSearchQueryChange = vi.fn();
    const onRefresh = vi.fn();

    render(
      <Toolbar
        snapshot={createSnapshot()}
        modelSearchQuery="gpt"
        onModelSearchQueryChange={onModelSearchQueryChange}
        isRefreshing={false}
        canRefresh={true}
        onRefresh={onRefresh}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "dammapi状态监控" }),
    ).not.toBeNull();
    expect(screen.getByText("12")).not.toBeNull();
    expect(screen.getByText("近 45 分钟")).not.toBeNull();

    fireEvent.change(screen.getByLabelText("搜索 Model"), {
      target: { value: "claude" },
    });
    fireEvent.click(screen.getByRole("button", { name: /点击刷新/ }));

    expect(onModelSearchQueryChange).toHaveBeenCalledWith("claude");
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("disables refresh while waiting and falls back for invalid snapshots", () => {
    const onRefresh = vi.fn();

    render(
      <Toolbar
        snapshot={createSnapshot({ generatedAt: "不是时间" })}
        modelSearchQuery=""
        onModelSearchQueryChange={vi.fn()}
        isRefreshing={true}
        canRefresh={true}
        onRefresh={onRefresh}
      />,
    );

    const refreshButton = screen.getByRole("button", { name: /刷新中/ });

    expect(refreshButton).toBeDisabled();
    expect(refreshButton).toHaveTextContent("无 Snapshot");
    fireEvent.click(refreshButton);
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
