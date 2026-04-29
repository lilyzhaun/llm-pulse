import { describe, expect, it } from "vitest";
import { formatLatency, formatLatencyWithLabel } from "./formatters";

describe("formatLatency", () => {
  it.each([
    [null, "暂无"],
    [0, "0.0s"],
    [1.5, "1.5s"],
    [999.99, "1000.0s"],
  ])("formats %s as %s", (value, expected) => {
    expect(formatLatency(value)).toBe(expected);
  });
});

describe("formatLatencyWithLabel", () => {
  it.each([
    [null, "Latency 暂无"],
    [0, "Latency 0.0s"],
    [1.5, "Latency 1.5s"],
    [999.99, "Latency 1000.0s"],
  ])("formats %s as %s", (value, expected) => {
    expect(formatLatencyWithLabel(value)).toBe(expected);
  });
});
