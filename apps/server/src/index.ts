import type { Server as HttpServer } from "node:http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { aggregationService } from "./services/aggregationService.js";
import {
  closeUpstreamPool,
  pingUpstreamDb,
} from "./services/upstreamDb/pool.js";

void aggregationService;

const app = createApp();

void pingUpstreamDb().then((reachable) => {
  if (reachable) {
    logger.info("Upstream PostgreSQL sanity ping succeeded");
    return;
  }

  logger.warn("Upstream PostgreSQL sanity ping failed; startup will continue");
  aggregationService.markStartupQueryFailure(
    new Error("Upstream PostgreSQL sanity ping failed"),
  );
});

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
  server.close((error) => {
    void (async () => {
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
