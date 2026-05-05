import { scrubPgError } from "../upstreamDb/index.js";

export interface QueryStatusSnapshot {
  lastQueryAt: string | null;
  lastQuerySucceeded: boolean | null;
  lastErrorMessage: string | null;
  lastQueryDurationMs: number | null;
  lastPollAt: string | null;
  lastPollSucceeded: boolean | null;
}

export interface QueryStateBase {
  lastQueryAt: string | null;
  lastQueryDurationMs: number | null;
  lastErrorMessage: string | null;
}

export class PulseQueryState {
  private lastQueryAt: string | null = null;
  private lastQuerySucceeded: boolean | null = null;
  private lastErrorMessage: string | null = null;
  private lastQueryDurationMs: number | null = null;

  getPollingStatus(): QueryStatusSnapshot | null {
    if (
      this.lastQueryAt === null &&
      this.lastQuerySucceeded === null &&
      this.lastErrorMessage === null
    ) {
      return null;
    }

    return {
      lastQueryAt: this.lastQueryAt,
      lastQuerySucceeded: this.lastQuerySucceeded,
      lastErrorMessage: this.lastErrorMessage,
      lastQueryDurationMs: this.lastQueryDurationMs,
      lastPollAt: this.lastQueryAt,
      lastPollSucceeded: this.lastQuerySucceeded,
    };
  }

  markStartupQueryFailure(error: unknown, attemptedAt: string): void {
    if (this.lastQuerySucceeded === true) {
      return;
    }

    this.recordQueryFailure(error, attemptedAt, null);
  }

  recordQuerySuccess(attemptedAt: string, durationMs: number): void {
    this.lastQueryAt = attemptedAt;
    this.lastQuerySucceeded = true;
    this.lastErrorMessage = null;
    this.lastQueryDurationMs = durationMs;
  }

  recordQueryFailure(
    error: unknown,
    attemptedAt: string,
    durationMs: number | null,
  ): void {
    const scrubbed = scrubPgError(error);
    const message =
      scrubbed && typeof scrubbed === "object" && "message" in scrubbed
        ? String(scrubbed.message)
        : "Upstream PostgreSQL query failed";

    this.lastQueryAt = attemptedAt;
    this.lastQuerySucceeded = false;
    this.lastErrorMessage = message;
    this.lastQueryDurationMs = durationMs;
  }

  getDataSourceBase(): QueryStateBase {
    return {
      lastQueryAt: this.lastQueryAt,
      lastQueryDurationMs: this.lastQueryDurationMs,
      lastErrorMessage: this.lastErrorMessage,
    };
  }
}
