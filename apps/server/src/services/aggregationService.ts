import type { AvailabilityResponse } from "@llm-pulse/shared";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import {
  incrementSnapshotErrors,
  incrementUpstreamDbQueryErrors,
  observeAggregationDurationSeconds,
  observeSnapshotRefreshDurationSeconds,
  observeUpstreamDbQueryDurationSeconds,
} from "../routes/metrics.js";
import {
  buildSnapshotAvailabilityResponse,
  type ExtendedAvailabilityResponse,
  type QueryWindow,
} from "./snapshot/responseBuilder.js";
import { refreshIncremental } from "./snapshot/refreshService.js";
import type { SnapshotStore } from "./snapshot/store.js";
import {
  getChannelAggregates,
  getHeartbeatBuckets,
  getModelAggregates,
  scrubPgError,
} from "./upstreamDb/index.js";
import { upstreamPool } from "./upstreamDb/pool.js";
import { PulseQueryState } from "./pulse/queryState.js";
import { PulseResponseFactory } from "./pulse/responseFactory.js";
import {
  PulseSnapshotState,
  type SnapshotStatus,
} from "./pulse/snapshotState.js";

const nowIso = () => new Date().toISOString();
const elapsedSecondsSince = (startedAt: bigint) =>
  Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
const elapsedMsSince = (startedAt: bigint) =>
  Math.round(Number(process.hrtime.bigint() - startedAt) / 1_000_000);

interface RefreshOutcome {
  response: ExtendedAvailabilityResponse;
  durationMs: number;
}

export class AggregationService {
  private lastSnapshot: ExtendedAvailabilityResponse | null = null;
  private inflightRefresh: Promise<AvailabilityResponse> | null = null;
  private readonly queryState = new PulseQueryState();
  private readonly snapshotState = new PulseSnapshotState(env.snapshotEnabled);
  private readonly responseFactory = new PulseResponseFactory();

  configureSnapshotStore(store: SnapshotStore | null): void {
    this.snapshotState.configureSnapshotStore(store);
  }

  disableSnapshotForProcess(): void {
    this.snapshotState.disableSnapshotForProcess();
  }

  markStartupQueryFailure(error: unknown): void {
    this.queryState.markStartupQueryFailure(error, nowIso());
  }

  getPollingStatus() {
    return this.queryState.getPollingStatus();
  }

  getSnapshotStatus(): SnapshotStatus {
    return this.snapshotState.getSnapshotStatus();
  }

  async getAggregatedPulse(): Promise<AvailabilityResponse> {
    if (this.lastSnapshot) {
      return this.lastSnapshot;
    }

    if (this.inflightRefresh) {
      return this.inflightRefresh;
    }

    return this.responseFactory.buildFallbackResponse(
      nowIso(),
      this.lastSnapshot,
      this.queryState.getDataSourceBase(),
    );
  }

  async refresh(): Promise<AvailabilityResponse> {
    if (this.inflightRefresh) {
      return this.inflightRefresh;
    }

    const refreshPromise = this.runRefresh();
    this.inflightRefresh = refreshPromise;

    try {
      return await refreshPromise;
    } finally {
      if (this.inflightRefresh === refreshPromise) {
        this.inflightRefresh = null;
      }
    }
  }

  private async runRefresh(): Promise<AvailabilityResponse> {
    const queryStartedAt = process.hrtime.bigint();
    const window = this.buildQueryWindow();

    try {
      const { response, durationMs } =
        this.snapshotState.shouldUseSnapshotPath()
          ? await this.runSnapshotRefresh(window, queryStartedAt)
          : await this.runUpstreamRefresh(window, queryStartedAt);

      this.lastSnapshot = response;
      this.queryState.recordQuerySuccess(window.generatedAt, durationMs);
      return response;
    } catch (error) {
      const durationMs = elapsedMsSince(queryStartedAt);
      observeUpstreamDbQueryDurationSeconds(durationMs / 1000);
      incrementUpstreamDbQueryErrors();
      this.queryState.recordQueryFailure(error, window.generatedAt, durationMs);
      logger.warn(
        { error: scrubPgError(error) },
        "Failed to query upstream PostgreSQL for pulse snapshot",
      );
      const fallback = this.responseFactory.buildFallbackResponse(
        window.generatedAt,
        this.lastSnapshot,
        this.queryState.getDataSourceBase(),
      );
      this.lastSnapshot = fallback;
      return fallback;
    } finally {
      observeAggregationDurationSeconds(elapsedSecondsSince(queryStartedAt));
    }
  }

  private async runSnapshotRefresh(
    window: QueryWindow,
    queryStartedAt: bigint,
  ): Promise<RefreshOutcome> {
    const store = this.snapshotState.getStore();
    if (!store) {
      throw new Error("Snapshot store is not configured");
    }

    try {
      await refreshIncremental({
        store,
        pgClient: upstreamPool,
        logger,
        reconcileSeconds: env.reconcileSeconds,
        bootstrapBatchSize: env.bootstrapBatchSize,
      });
      const durationMs = elapsedMsSince(queryStartedAt);
      observeSnapshotRefreshDurationSeconds(durationMs / 1000);
      this.snapshotState.markSnapshotRefreshResult(true);

      return {
        durationMs,
        response: buildSnapshotAvailabilityResponse(
          store.readSnapshot(),
          window,
          {
            kind: "upstream-postgres",
            lastQueryAt: window.generatedAt,
            lastQueryDurationMs: durationMs,
            lastErrorMessage: null,
          },
        ),
      };
    } catch (error) {
      incrementSnapshotErrors("refresh");
      this.snapshotState.markSnapshotRefreshResult(false);
      logger.warn(
        { error: scrubPgError(error) },
        "Snapshot refresh failed; serving fallback response",
      );
      throw error;
    }
  }

  private async runUpstreamRefresh(
    window: QueryWindow,
    queryStartedAt: bigint,
  ): Promise<RefreshOutcome> {
    const [models, channels, heartbeatBuckets] = await Promise.all([
      getModelAggregates(window.toEpochSeconds),
      getChannelAggregates(window.toEpochSeconds),
      getHeartbeatBuckets(window.toEpochSeconds),
    ]);

    const durationMs = elapsedMsSince(queryStartedAt);
    observeUpstreamDbQueryDurationSeconds(durationMs / 1000);

    return {
      durationMs,
      response: this.responseFactory.buildAvailabilityResponse(
        models,
        channels,
        heartbeatBuckets,
        window,
        {
          kind: "upstream-postgres",
          lastQueryAt: window.generatedAt,
          lastQueryDurationMs: durationMs,
          lastErrorMessage: null,
        },
      ),
    };
  }

  private buildQueryWindow(): QueryWindow {
    const toEpochSeconds = Math.floor(Date.now() / 1000);

    return {
      toEpochSeconds,
      generatedAt: new Date(toEpochSeconds * 1000).toISOString(),
    };
  }
}

export const aggregationService = new AggregationService();
