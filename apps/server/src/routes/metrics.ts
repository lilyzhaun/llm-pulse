import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client";
import { Router } from "express";

const register = new Registry();

collectDefaultMetrics({ register });

const pulseUptimeSeconds = new Gauge({
  name: "llm_pulse_uptime_seconds",
  help: "LLM Pulse BFF process uptime in seconds.",
  registers: [register],
});

const pulsePollingHealthy = new Gauge({
  name: "llm_pulse_polling_healthy",
  help: "Whether the latest LLM Pulse polling cycle succeeded: 1 for healthy, 0 for degraded.",
  registers: [register],
});

const pulsePollingLastTimestampSeconds = new Gauge({
  name: "llm_pulse_polling_last_timestamp_seconds",
  help: "Unix timestamp in seconds for the latest LLM Pulse polling cycle.",
  registers: [register],
});

const pulsePollDurationSeconds = new Histogram({
  name: "llm_pulse_poll_duration_seconds",
  help: "Duration of LLM Pulse polling orchestration in seconds.",
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [register],
});

const pulseAggregationDurationSeconds = new Histogram({
  name: "llm_pulse_aggregation_duration_seconds",
  help: "Duration of LLM Pulse availability aggregation in seconds.",
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [register],
});

const pulseUpstreamDbQueryDurationSeconds = new Histogram({
  name: "llm_pulse_upstream_db_query_duration_seconds",
  help: "Duration of upstream PostgreSQL pulse queries in seconds.",
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

const pulseUpstreamDbQueryErrorsTotal = new Counter({
  name: "llm_pulse_upstream_db_query_errors_total",
  help: "Total number of failed upstream PostgreSQL pulse queries.",
  registers: [register],
});

const pulseUpstreamDbReachable = new Gauge({
  name: "llm_pulse_upstream_db_reachable",
  help: "Whether the upstream PostgreSQL database is currently reachable: 1 for reachable, 0 for degraded.",
  registers: [register],
});

const pulseSnapshotEnabled = new Gauge({
  name: "llm_pulse_snapshot_enabled",
  help: "Whether the SQLite incremental snapshot path is configured and enabled.",
  registers: [register],
});

const pulseSnapshotReady = new Gauge({
  name: "llm_pulse_snapshot_ready",
  help: "Whether the SQLite incremental snapshot has completed bootstrap and is ready to serve.",
  registers: [register],
});

const pulseSnapshotRefreshDurationSeconds = new Histogram({
  name: "llm_pulse_snapshot_refresh_duration_seconds",
  help: "Duration of SQLite snapshot refresh cycles in seconds.",
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

const pulseSnapshotLagSeconds = new Gauge({
  name: "llm_pulse_snapshot_lag_seconds",
  help: "Current lag between now and the snapshot covered-until watermark in seconds.",
  registers: [register],
});

const pulseSnapshotProcessedLogs = new Gauge({
  name: "llm_pulse_snapshot_processed_logs",
  help: "Current number of dedupe rows retained in the SQLite processed_logs table.",
  registers: [register],
});

const pulseSnapshotErrorsTotal = new Counter({
  name: "llm_pulse_snapshot_errors_total",
  help: "Total number of SQLite snapshot errors grouped by stage.",
  labelNames: ["stage"],
  registers: [register],
});

pulsePollDurationSeconds.zero({});
pulseAggregationDurationSeconds.zero({});
pulseUpstreamDbQueryDurationSeconds.zero({});
pulseUpstreamDbQueryErrorsTotal.inc(0);
pulseSnapshotRefreshDurationSeconds.zero({});
pulseSnapshotErrorsTotal.inc({ stage: "open" }, 0);
pulseSnapshotErrorsTotal.inc({ stage: "bootstrap" }, 0);
pulseSnapshotErrorsTotal.inc({ stage: "refresh" }, 0);

export const observePollDurationSeconds = (durationSeconds: number): void => {
  pulsePollDurationSeconds.observe(durationSeconds);
};

export const observeAggregationDurationSeconds = (
  durationSeconds: number,
): void => {
  pulseAggregationDurationSeconds.observe(durationSeconds);
};

export const observeUpstreamDbQueryDurationSeconds = (
  durationSeconds: number,
): void => {
  pulseUpstreamDbQueryDurationSeconds.observe(durationSeconds);
};

export const incrementUpstreamDbQueryErrors = (): void => {
  pulseUpstreamDbQueryErrorsTotal.inc();
};

export const observeSnapshotRefreshDurationSeconds = (
  durationSeconds: number,
): void => {
  pulseSnapshotRefreshDurationSeconds.observe(durationSeconds);
};

export const incrementSnapshotErrors = (
  stage: "open" | "bootstrap" | "refresh",
): void => {
  pulseSnapshotErrorsTotal.inc({ stage });
};

export const incrementUpstreamRequestErrors = incrementUpstreamDbQueryErrors;

export const metricsRouter = Router();

metricsRouter.get("/", async (_request, response, next) => {
  try {
    const { aggregationService } = await import(
      "../services/aggregationService.js"
    );
    const pollingStatus = aggregationService.getPollingStatus();
    const snapshotStatus = aggregationService.getSnapshotStatus();

    pulseUptimeSeconds.set(process.uptime());
    pulsePollingHealthy.set(
      pollingStatus?.lastQuerySucceeded === false ? 0 : 1,
    );
    pulseUpstreamDbReachable.set(
      pollingStatus?.lastQuerySucceeded === false ? 0 : 1,
    );

    if (pollingStatus?.lastQueryAt) {
      pulsePollingLastTimestampSeconds.set(
        Date.parse(pollingStatus.lastQueryAt) / 1000,
      );
    }

    pulseSnapshotEnabled.set(snapshotStatus.enabled ? 1 : 0);
    pulseSnapshotReady.set(snapshotStatus.ready ? 1 : 0);
    pulseSnapshotLagSeconds.set(snapshotStatus.lagSeconds ?? 0);
    pulseSnapshotProcessedLogs.set(snapshotStatus.processedLogCount ?? 0);

    response.type(register.contentType);
    response.send(await register.metrics());
  } catch (error) {
    next(error);
  }
});
