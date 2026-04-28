import { Gauge, Registry, collectDefaultMetrics } from "prom-client";
import { Router } from "express";
import { aggregationService } from "../services/aggregationService.js";

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

export const metricsRouter = Router();

metricsRouter.get("/", async (_request, response, next) => {
  try {
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
