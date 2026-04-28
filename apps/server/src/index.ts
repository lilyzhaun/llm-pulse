import type { Server as HttpServer } from "node:http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { aggregationService } from "./services/aggregationService.js";
import { newApiLogService } from "./services/newApiLogService.js";
import { persistenceService } from "./services/persistenceService.js";
import { pollingService } from "./services/pollingService.js";

const backfillStartTimestamp = (): number =>
  Math.max(
    0,
    Math.floor(Date.now() / 1000) - env.initialBackfillHours * 60 * 60,
  );

const syncLatestLogs = async (): Promise<void> => {
  try {
    const logs = await newApiLogService.fetchRecentLogs();
    await aggregationService.ingestLogs(logs, {
      lastSeenTimestamp: newApiLogService.getLastSeenTimestamp(),
    });
  } catch (error) {
    await aggregationService.markPollingFailure(error, {
      lastSeenTimestamp: newApiLogService.getLastSeenTimestamp(),
    });
    throw error;
  }
};

const restoredState = await persistenceService.loadPulseState();
newApiLogService.restoreLastSeenTimestamp(
  restoredState?.cursor.lastSeenTimestamp ?? null,
);
await aggregationService.restoreFromState(restoredState);

const app = createApp();

const runStartupBackfill = async (): Promise<void> => {
  if (restoredState?.bootstrap.backfillCompletedAt) {
    return;
  }

  const logs = await newApiLogService.fetchRecentLogs({
    startTimestamp: backfillStartTimestamp(),
    maxPages: env.initialBackfillMaxPages,
  });

  await aggregationService.ingestLogsWithState(
    logs,
    {
      lastSeenTimestamp: newApiLogService.getLastSeenTimestamp(),
    },
    {
      backfillCompletedAt: new Date().toISOString(),
    },
  );
};

void runStartupBackfill()
  .catch((error) => {
    logger.error({ error }, "Initial backfill failed");
  })
  .finally(() => {
    void pollingService.runNow(syncLatestLogs).catch((error) => {
      logger.error({ error }, "Initial new-api sync failed");
    });
  });

pollingService.start(async () => {
  try {
    await syncLatestLogs();
  } catch (error) {
    logger.error({ error }, "Scheduled new-api sync failed");
  }
}, env.pollIntervalMs);

const server = app.listen(env.port, () => {
  logger.info({ port: env.port }, "llm-pulse BFF listening");
}) as unknown as HttpServer;

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    logger.error(
      { port: env.port },
      "Failed to start llm-pulse BFF: port is already in use",
    );
    process.exit(1);
  }

  logger.error({ error }, "Failed to start llm-pulse BFF");
  process.exit(1);
});

const shutdown = (signal: NodeJS.Signals) => {
  logger.info({ signal }, "Received shutdown signal, shutting down server");
  pollingService.stop();
  server.close((error) => {
    persistenceService.close();

    if (error) {
      logger.error({ error }, "Failed to shut down server cleanly");
      process.exit(1);
    }

    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
