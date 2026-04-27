import type { AvailabilityStatus } from "@llm-pulse/shared";

const LABELS: Record<AvailabilityStatus, string> = {
  available: "可用",
  degraded: "降级",
  unavailable: "不可用",
  unknown: "暂无",
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
