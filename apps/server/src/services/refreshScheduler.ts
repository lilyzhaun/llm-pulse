import { logger } from "../lib/logger.js";
import { scrubPgError } from "./upstreamDb/pool.js";
import type { AggregationService } from "./aggregationService.js";

interface SchedulerHandle {
  stop: () => void;
}

interface StartOptions {
  intervalMs: number;
  service: AggregationService;
}

export const startRefreshScheduler = ({
  intervalMs,
  service,
}: StartOptions): SchedulerHandle => {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async () => {
    if (stopped) {
      return;
    }

    try {
      await service.refresh();
    } catch (error) {
      logger.warn(
        { error: scrubPgError(error) },
        "Scheduled pulse refresh failed",
      );
    } finally {
      if (!stopped) {
        timer = setTimeout(tick, intervalMs);
      }
    }
  };

  timer = setTimeout(tick, intervalMs);

  return {
    stop: () => {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
};
