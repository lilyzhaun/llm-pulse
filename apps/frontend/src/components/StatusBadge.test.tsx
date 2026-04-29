import { render, screen } from "@testing-library/react";
import type { AvailabilityStatus } from "@llm-pulse/shared";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it.each<[AvailabilityStatus, string]>([
    ["available", "可用"],
    ["degraded", "降级"],
    ["unavailable", "不可用"],
    ["unknown", "暂无"],
  ])("renders %s status", (status, label) => {
    render(<StatusBadge status={status} />);

    const badge = screen.getByText(label);

    expect(badge).not.toBeNull();
    expect(badge.classList.contains("status-badge")).toBe(true);
    expect(badge.classList.contains(`status-badge--${status}`)).toBe(true);
  });
});
