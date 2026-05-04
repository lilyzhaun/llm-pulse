export function formatLatency(value: number | null): string {
  return value === null ? "暂无" : `${value.toFixed(1)}s`;
}

export function formatLatencyWithLabel(value: number | null): string {
  return value === null ? "Latency 暂无" : `Latency ${value.toFixed(1)}s`;
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  }).format(value);
}

function formatReadableNumber(value: number): string {
  const absoluteValue = Math.abs(value);

  if (absoluteValue >= 1_000_000) {
    return `${formatCompactNumber(value / 1_000_000)}M`;
  }

  if (absoluteValue >= 1_000) {
    return `${formatCompactNumber(value / 1_000)}K`;
  }

  return formatCompactNumber(value);
}

export function formatTokens(value: number): string {
  const rawValue = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
  const readableValue = formatReadableNumber(value);

  return rawValue === readableValue
    ? rawValue
    : `${rawValue} (${readableValue})`;
}

export function formatQuota(value: number): string {
  const rawValue = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
  }).format(value);

  if (Math.abs(value) < 1_000) {
    return rawValue;
  }

  const readableValue = formatReadableNumber(value);

  return rawValue === readableValue
    ? rawValue
    : `${rawValue} (${readableValue})`;
}

export function formatRate(value: number, unit: "RPM" | "TPM"): string {
  return `${formatReadableNumber(value)} ${unit}`;
}
