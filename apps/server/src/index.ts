import type { Server as HttpServer } from "node:http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { incrementSnapshotErrors } from "./routes/metrics.js";
import { aggregationService } from "./services/aggregationService.js";
import { bootstrapSnapshot } from "./services/snapshot/refreshService.js";
import { SnapshotStore } from "./services/snapshot/store.js";
import { startRefreshScheduler } from "./services/refreshScheduler.js";
import {
  closeUpstreamPool,
  pingUpstreamDb,
  scrubPgError,
  upstreamPool,
} from "./services/upstreamDb/pool.js";

const app = createApp();
let snapshotStore: SnapshotStore | null = null;

if (env.snapshotEnabled) {
  try {
    snapshotStore = new SnapshotStore(env.snapshotPath);
    snapshotStore.open();
    aggregationService.configureSnapshotStore(snapshotStore);

    if (!snapshotStore.isReady()) {
      logger.info({ path: env.snapshotPath }, "Starting snapshot bootstrap");
      void bootstrapSnapshot({
        store: snapshotStore,
        pgClient: upstreamPool,
        logger,
        reconcileSeconds: env.reconcileSeconds,
        bootstrapBatchSize: env.bootstrapBatchSize,
      })
        .then(() => {
          logger.info("Snapshot bootstrap finished successfully");
        })
        .catch((error) => {
          incrementSnapshotErrors("bootstrap");
          aggregationService.disableSnapshotForProcess();
          logger.warn(
            { error: scrubPgError(error) },
            "Snapshot bootstrap failed; snapshot path disabled for this process",
          );
        });
    }
  } catch (error) {
    incrementSnapshotErrors("open");
    aggregationService.disableSnapshotForProcess();
    logger.warn(
      { error: scrubPgError(error) },
      "Failed to open snapshot store; snapshot path disabled for this process",
    );
  }
}

void pingUpstreamDb().then(async (reachable) => {
  if (!reachable) {
    logger.warn(
      "Upstream PostgreSQL sanity ping failed; startup will continue",
    );
    aggregationService.markStartupQueryFailure(
      new Error("Upstream PostgreSQL sanity ping failed"),
    );
    return;
  }

  logger.info("Upstream PostgreSQL sanity ping succeeded");
  try {
    await aggregationService.refresh();
  } catch (error) {
    logger.warn(
      { error: scrubPgError(error) },
      "Initial pulse refresh failed; will retry on schedule",
    );
  }
});

const refreshScheduler = startRefreshScheduler({
  intervalMs: env.refreshIntervalMs,
  service: aggregationService,
});

const server = app.listen(env.port, env.bindHost, () => {
  logger.info(
    { host: env.bindHost, port: env.port },
    "llm-pulse BFF listening",
  );
}) as unknown as HttpServer;

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    logger.error(
      { host: env.bindHost, port: env.port },
      "Failed to start llm-pulse BFF: address is already in use",
    );
    process.exit(1);
  }

  logger.error({ error }, "Failed to start llm-pulse BFF");
  process.exit(1);
});

const shutdown = (signal: NodeJS.Signals) => {
  logger.info({ signal }, "Received shutdown signal, shutting down server");
  refreshScheduler.stop();
  server.close((error) => {
    void (async () => {
      snapshotStore?.close();
      await closeUpstreamPool();

      if (error) {
        logger.error({ error }, "Failed to shut down server cleanly");
        process.exit(1);
      }

      process.exit(0);
    })().catch((shutdownError) => {
      logger.error(
        { error: shutdownError },
        "Failed to close upstream pool cleanly",
      );
      process.exit(1);
    });
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
