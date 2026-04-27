import { Router } from "express";
import { isProduction } from "../config/env.js";
import { aggregationService } from "../services/aggregationService.js";

export const healthRouter = Router();

const safePollingStatus = (
  pollingStatus: ReturnType<typeof aggregationService.getPollingStatus>,
) => {
  if (!pollingStatus || !isProduction || !pollingStatus.lastErrorMessage) {
    return pollingStatus;
  }

  return {
    ...pollingStatus,
    lastErrorMessage: "Polling failed; see server logs",
  };
};

healthRouter.get("/", (_request, response) => {
  const pollingStatus = aggregationService.getPollingStatus();
  const healthStatus =
    pollingStatus?.lastPollSucceeded === false ? "degraded" : "ok";

  response.json({
    status: healthStatus,
    service: "llm-pulse-bff",
    uptimeSeconds: Math.round(process.uptime()),
    polling: safePollingStatus(pollingStatus),
  });
});
