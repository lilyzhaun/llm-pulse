import type { AvailabilityStatus } from "@llm-pulse/shared";

export const statusFromCounts = (
  successCount: number,
  errorCount: number,
): AvailabilityStatus => {
  const totalCount = successCount + errorCount;

  if (totalCount === 0) {
    return "unknown";
  }

  const successRate = successCount / totalCount;

  if (successCount > 0 && errorCount === 0) {
    return "available";
  }

  if (successCount === 0 && errorCount > 0) {
    return "unavailable";
  }

  if (successRate >= 0.9) {
    return "available";
  }

  if (successRate >= 0.5) {
    return "degraded";
  }

  return "unavailable";
};

export const statusOrder = (status: AvailabilityStatus): number => {
  if (status === "unavailable") {
    return 0;
  }

  if (status === "degraded") {
    return 1;
  }

  if (status === "available") {
    return 2;
  }

  return 3;
};
