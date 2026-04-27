import type { AvailabilityStatus } from "@llm-pulse/shared";

const LABELS: Record<AvailabilityStatus, string> = {
  available: "正常",
  degraded: "异常偏高",
  unavailable: "异常",
  unknown: "无数据",
};

export interface StatusBadgeProps {
  status: AvailabilityStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={`status-badge status-badge--${status}`}>
      <span className="status-badge__dot" aria-hidden="true" />
      {LABELS[status]}
    </span>
  );
}
