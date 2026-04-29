import type { AvailabilityResponse, NewApiLogItem } from "@llm-pulse/shared";
import { cacheService } from "./cacheService.js";
import { compareByCreatedAtDescThenIdDesc } from "../lib/comparators.js";
import { logger } from "../lib/logger.js";
import {
  type PersistedPulseStateLoadFailure,
  type PersistedPulseStateLoadResult,
  persistenceService,
} from "./persistenceService.js";
import {
  type AggregationLog,
  buildAvailabilityResponseForLogs,
  mergeLogs,
  sanitizeLog,
  trimLogsPerModel,
} from "./aggregation/index.js";
import {
  incrementPersistenceSaveErrors,
  observeAggregationDurationSeconds,
  observePollDurationSeconds,
} from "../routes/metrics.js";

export { buildAvailabilityResponseForLogs } from "./aggregation/index.js";
export type { AggregationLog } from "./aggregation/index.js";

const nowIso = () => new Date().toISOString();
const elapsedSecondsSince = (startedAt: bigint) =>
  Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;

const AGGREGATED_PULSE_CACHE_KEY = "aggregated-pulse";
const RECENT_LOGS_CACHE_KEY = "recent-logs";
const POLL_STATUS_CACHE_KEY = "poll-status";
interface PollStatusSnapshot {
  lastPollAt: string;
  lastPollSucceeded: boolean;
  lastErrorMessage: string | null;
}

interface StateCursorSnapshot {
  lastSeenTimestamp: number | null;
}

interface StateBootstrapSnapshot {
  backfillCompletedAt: string | null;
}

export class AggregationService {
  async restoreFromState(state: PersistedPulseStateLoadResult): Promise<void> {
    if (!state) {
      return;
    }

    if (this.isPersistenceLoadFailure(state)) {
      logger.error(
        { errorMessage: state.errorMessage, statePath: state.statePath },
        "Failed to restore llm-pulse state",
      );
      cacheService.clear();
      return;
    }

    const restoredLogs = trimLogsPerModel(
      state.recentLogs.sort(compareByCreatedAtDescThenIdDesc),
    );
    cacheService.set(RECENT_LOGS_CACHE_KEY, restoredLogs);
    if (state.pollStatus) {
      cacheService.set<PollStatusSnapshot>(
        POLL_STATUS_CACHE_KEY,
        state.pollStatus,
      );
    }

    cacheService.set(
      AGGREGATED_PULSE_CACHE_KEY,
      this.buildAvailabilityResponse(restoredLogs),
    );
  }

  async ingestLogs(
    logs: NewApiLogItem[],
    cursor: StateCursorSnapshot,
  ): Promise<AvailabilityResponse> {
    return this.ingestLogsWithState(logs, cursor, {
      backfillCompletedAt: null,
    });
  }

  async ingestLogsWithState(
    logs: NewApiLogItem[],
    cursor: StateCursorSnapshot,
    bootstrap: StateBootstrapSnapshot,
  ): Promise<AvailabilityResponse> {
    const pollStartedAt = process.hrtime.bigint();

    try {
      const existingLogs =
        cacheService.get<AggregationLog[]>(RECENT_LOGS_CACHE_KEY) ?? [];
      const mergedLogs = mergeLogs(existingLogs, logs.map(sanitizeLog));
      cacheService.set(RECENT_LOGS_CACHE_KEY, mergedLogs);

      const aggregated = this.buildAvailabilityResponse(mergedLogs);
      cacheService.set(AGGREGATED_PULSE_CACHE_KEY, aggregated);
      cacheService.set<PollStatusSnapshot>(POLL_STATUS_CACHE_KEY, {
        lastPollAt: aggregated.generatedAt,
        lastPollSucceeded: true,
        lastErrorMessage: null,
      });
      await this.persistState(cursor, bootstrap);

      return aggregated;
    } finally {
      observePollDurationSeconds(elapsedSecondsSince(pollStartedAt));
    }
  }

  async markPollingFailure(
    error: unknown,
    cursor: StateCursorSnapshot,
  ): Promise<void> {
    const pollStartedAt = process.hrtime.bigint();

    try {
      cacheService.set<PollStatusSnapshot>(POLL_STATUS_CACHE_KEY, {
        lastPollAt: nowIso(),
        lastPollSucceeded: false,
        lastErrorMessage:
          error instanceof Error ? error.message : "Unknown polling error",
      });
      await this.persistState(cursor, { backfillCompletedAt: null });
    } finally {
      observePollDurationSeconds(elapsedSecondsSince(pollStartedAt));
    }
  }

  getPollingStatus(): PollStatusSnapshot | null {
    return cacheService.get<PollStatusSnapshot>(POLL_STATUS_CACHE_KEY) ?? null;
  }

  async getAggregatedPulse(): Promise<AvailabilityResponse> {
    const cached = cacheService.get<AvailabilityResponse>(
      AGGREGATED_PULSE_CACHE_KEY,
    );
    if (cached) {
      return cached;
    }

    const response = this.buildAvailabilityResponse(
      cacheService.get<AggregationLog[]>(RECENT_LOGS_CACHE_KEY) ?? [],
    );
    cacheService.set(AGGREGATED_PULSE_CACHE_KEY, response);
    return response;
  }

  private async persistState(
    cursor: StateCursorSnapshot,
    bootstrap: StateBootstrapSnapshot,
  ): Promise<void> {
    const recentLogs =
      cacheService.get<AggregationLog[]>(RECENT_LOGS_CACHE_KEY) ?? [];
    const pollStatus =
      cacheService.get<PollStatusSnapshot>(POLL_STATUS_CACHE_KEY) ?? null;

    try {
      await persistenceService.savePulseState({
        recentLogs,
        cursor,
        bootstrap,
        pollStatus,
      });
    } catch (error) {
      incrementPersistenceSaveErrors();
      logger.warn({ error }, "Failed to persist llm-pulse state");
    }
  }

  private buildAvailabilityResponse(
    logs: AggregationLog[],
  ): AvailabilityResponse {
    const aggregationStartedAt = process.hrtime.bigint();

    try {
      return buildAvailabilityResponseForLogs(logs);
    } finally {
      observeAggregationDurationSeconds(
        elapsedSecondsSince(aggregationStartedAt),
      );
    }
  }

  private isPersistenceLoadFailure(
    state: Exclude<PersistedPulseStateLoadResult, null>,
  ): state is PersistedPulseStateLoadFailure {
    return "kind" in state && state.kind === "persistence-load-failure";
  }
}

export const aggregationService = new AggregationService();
