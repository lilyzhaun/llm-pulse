import { Router } from "express";
import { aggregationService } from "../services/aggregationService.js";

export const healthRouter = Router();

const safePollingStatus = (
  pollingStatus: ReturnType<typeof aggregationService.getPollingStatus>,
) => {
  if (!pollingStatus || !pollingStatus.lastErrorMessage) {
    return pollingStatus;
  }

  return {
    ...pollingStatus,
    lastErrorMessage: "Polling failed; see server logs",
  };
};

const upstreamDbStatus = (
  pollingStatus: ReturnType<typeof aggregationService.getPollingStatus>,
) => ({
  reachable: pollingStatus?.lastQuerySucceeded !== false,
  lastSuccessAt:
    pollingStatus?.lastQuerySucceeded === true
      ? pollingStatus.lastQueryAt
      : null,
});

healthRouter.get("/", (_request, response) => {
  const pollingStatus = aggregationService.getPollingStatus();
  const snapshot = aggregationService.getSnapshotStatus();
  const upstreamDb = upstreamDbStatus(pollingStatus);
  const healthStatus = upstreamDb.reachable ? "ok" : "degraded";

  response.json({
    status: healthStatus,
    service: "llm-pulse-bff",
    uptimeSeconds: Math.round(process.uptime()),
    polling: safePollingStatus(pollingStatus),
    upstreamDb,
    snapshot,
  });
});
