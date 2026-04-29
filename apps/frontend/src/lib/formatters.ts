export function formatLatency(value: number | null): string {
  return value === null ? "暂无" : `${value.toFixed(1)}s`;
}

export function formatLatencyWithLabel(value: number | null): string {
  return value === null ? "Latency 暂无" : `Latency ${value.toFixed(1)}s`;
}
