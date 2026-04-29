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

const pulseUpstreamRequestErrorsTotal = new Counter({
  name: "llm_pulse_upstream_request_errors_total",
  help: "Total number of failed upstream new-api requests observed by LLM Pulse.",
  registers: [register],
});

const pulsePersistenceSaveErrorsTotal = new Counter({
  name: "llm_pulse_persistence_save_errors_total",
  help: "Total number of failed LLM Pulse persistence save attempts.",
  registers: [register],
});

const pulsePersistenceLoadErrorsTotal = new Counter({
  name: "llm_pulse_persistence_load_errors_total",
  help: "Total number of failed LLM Pulse persistence load attempts.",
  registers: [register],
});

pulsePollDurationSeconds.zero({});
pulseAggregationDurationSeconds.zero({});
pulseUpstreamRequestErrorsTotal.inc(0);
pulsePersistenceSaveErrorsTotal.inc(0);
pulsePersistenceLoadErrorsTotal.inc(0);

export const observePollDurationSeconds = (durationSeconds: number): void => {
  pulsePollDurationSeconds.observe(durationSeconds);
};

export const observeAggregationDurationSeconds = (
  durationSeconds: number,
): void => {
  pulseAggregationDurationSeconds.observe(durationSeconds);
};

export const incrementUpstreamRequestErrors = (): void => {
  pulseUpstreamRequestErrorsTotal.inc();
};

export const incrementPersistenceSaveErrors = (): void => {
  pulsePersistenceSaveErrorsTotal.inc();
};

export const incrementPersistenceLoadErrors = (): void => {
  pulsePersistenceLoadErrorsTotal.inc();
};

export const metricsRouter = Router();

metricsRouter.get("/", async (_request, response, next) => {
  try {
    const { aggregationService } = await import(
      "../services/aggregationService.js"
    );
    const pollingStatus = aggregationService.getPollingStatus();

    pulseUptimeSeconds.set(process.uptime());
    pulsePollingHealthy.set(pollingStatus?.lastPollSucceeded === false ? 0 : 1);

    if (pollingStatus?.lastPollAt) {
      pulsePollingLastTimestampSeconds.set(
        Date.parse(pollingStatus.lastPollAt) / 1000,
      );
    }

    response.type(register.contentType);
    response.send(await register.metrics());
  } catch (error) {
    next(error);
  }
});
