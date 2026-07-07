import { describe, expect, it } from "vitest";
import {
  formatLatency,
  formatLatencyWithLabel,
  formatQuota,
  formatRate,
  formatTokens,
} from "./format";

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

describe("formatTokens", () => {
  it.each([
    [0, "0"],
    [999, "999"],
    [1234, "1,234 (1.2K)"],
    [1_250_000, "1,250,000 (1.3M)"],
  ])("formats %s as %s", (value, expected) => {
    expect(formatTokens(value)).toBe(expected);
  });
});

describe("formatQuota", () => {
  it.each([
    [12.34, "12.34"],
    [1234.56, "1,234.56 (1.2K)"],
    [-2500, "-2,500 (-2.5K)"],
  ])("formats %s as %s without currency symbol", (value, expected) => {
    expect(formatQuota(value)).toBe(expected);
  });
});

describe("formatRate", () => {
  it.each([
    [12.3, "RPM", "12.3 RPM"],
    [1234, "TPM", "1.2K TPM"],
  ] as const)("formats %s %s as %s", (value, unit, expected) => {
    expect(formatRate(value, unit)).toBe(expected);
  });
});
