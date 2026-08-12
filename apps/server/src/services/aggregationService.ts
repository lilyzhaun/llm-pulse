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
  type LocalAvailabilityDataSource,
  type QueryWindow,
} from "./snapshot/responseBuilder.js";
import { refreshIncremental } from "./snapshot/refreshService.js";
import type { SnapshotStore } from "./snapshot/store.js";
import {
  getChannelAggregates,
  getHeartbeatBuckets,
  getModelAggregates,
  getSystemName,
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
  private cachedSystemName: string | null = null;

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

    await this.materializeSnapshotFallback(
      {
        toEpochSeconds: Math.floor(Date.now() / 1000),
        generatedAt: nowIso(),
      },
      null,
    );

    if (this.lastSnapshot) {
      return this.lastSnapshot;
    }

    const fallback = this.responseFactory.buildFallbackResponse(
      nowIso(),
      this.lastSnapshot,
      this.queryState.getDataSourceBase(),
    );

    return {
      ...fallback,
      dashboardTitle: this.buildDashboardTitle(),
    };
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
      if (
        response.dataSource.kind === "memory-snapshot" &&
        response.dataSource.lastErrorMessage
      ) {
        this.queryState.recordQueryFailure(
          new Error(response.dataSource.lastErrorMessage),
          window.generatedAt,
          durationMs,
        );
      } else {
        this.queryState.recordQuerySuccess(window.generatedAt, durationMs);
      }
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
      await this.materializeSnapshotFallback(window, durationMs);
      const fallback = this.responseFactory.buildFallbackResponse(
        window.generatedAt,
        this.lastSnapshot,
        this.queryState.getDataSourceBase(),
      );
      this.lastSnapshot = {
        ...fallback,
        dashboardTitle: this.buildDashboardTitle(),
      };
      return this.lastSnapshot;
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

      const systemName = await this.fetchSystemName();
      if (systemName) {
        this.cachedSystemName = systemName;
      }

      return this.buildSnapshotOutcome(
        store,
        window,
        {
          kind: "upstream-postgres",
          lastQueryAt: window.generatedAt,
          lastQueryDurationMs: durationMs,
          lastErrorMessage: null,
        },
        durationMs,
      );
    } catch (error) {
      incrementSnapshotErrors("refresh");
      this.snapshotState.markSnapshotRefreshResult(false);
      const scrubbed = scrubPgError(error);
      logger.warn(
        { error: scrubbed },
        "Snapshot refresh failed; serving local snapshot data",
      );

      if (store.isReady()) {
        const durationMs = elapsedMsSince(queryStartedAt);
        const lastErrorMessage =
          scrubbed &&
          typeof scrubbed === "object" &&
          "message" in scrubbed &&
          typeof scrubbed.message === "string"
            ? scrubbed.message
            : "Snapshot refresh failed";

        return this.buildSnapshotOutcome(
          store,
          window,
          {
            kind: "memory-snapshot",
            lastQueryAt: window.generatedAt,
            lastQueryDurationMs: durationMs,
            lastErrorMessage,
          },
          durationMs,
        );
      }

      throw error;
    }
  }

  private buildSnapshotOutcome(
    store: SnapshotStore,
    window: QueryWindow,
    dataSource: LocalAvailabilityDataSource,
    durationMs: number,
  ): RefreshOutcome {
    const snapshotResponse = buildSnapshotAvailabilityResponse(
      store.readSnapshot(),
      window,
      dataSource,
    );

    return {
      durationMs,
      response: {
        ...snapshotResponse,
        dashboardTitle: this.buildDashboardTitle(),
      },
    };
  }

  private async runUpstreamRefresh(
    window: QueryWindow,
    queryStartedAt: bigint,
  ): Promise<RefreshOutcome> {
    const [models, channels, heartbeatBuckets, systemName] = await Promise.all([
      getModelAggregates(window.toEpochSeconds),
      getChannelAggregates(window.toEpochSeconds),
      getHeartbeatBuckets(window.toEpochSeconds),
      this.fetchSystemName(),
    ]);

    if (systemName) {
      this.cachedSystemName = systemName;
    }

    const durationMs = elapsedMsSince(queryStartedAt);
    observeUpstreamDbQueryDurationSeconds(durationMs / 1000);

    const response = this.responseFactory.buildAvailabilityResponse(
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
    );

    return {
      durationMs,
      response: {
        ...response,
        dashboardTitle: this.buildDashboardTitle(),
      },
    };
  }

  private async fetchSystemName(): Promise<string | null> {
    try {
      return await getSystemName(upstreamPool);
    } catch {
      return null;
    }
  }

  private buildDashboardTitle(): string {
    return this.cachedSystemName
      ? `${this.cachedSystemName}状态监控`
      : "状态监控";
  }

  private buildQueryWindow(): QueryWindow {
    const toEpochSeconds = Math.floor(Date.now() / 1000);

    return {
      toEpochSeconds,
      generatedAt: new Date(toEpochSeconds * 1000).toISOString(),
    };
  }

  private async materializeSnapshotFallback(
    window: QueryWindow,
    durationMs: number | null,
  ): Promise<void> {
    if (this.lastSnapshot) {
      return;
    }

    if (!this.snapshotState.shouldUseSnapshotPath()) {
      return;
    }

    const store = this.snapshotState.getStore();
    if (!store) {
      return;
    }

    const systemName = await this.fetchSystemName();
    if (systemName) {
      this.cachedSystemName = systemName;
    }

    this.lastSnapshot = {
      ...buildSnapshotAvailabilityResponse(store.readSnapshot(), window, {
        kind: "memory-snapshot",
        lastQueryAt: window.generatedAt,
        lastQueryDurationMs: durationMs,
        lastErrorMessage: this.queryState.getDataSourceBase().lastErrorMessage,
      }),
      dashboardTitle: this.buildDashboardTitle(),
    };
  }
}

export const aggregationService = new AggregationService();
