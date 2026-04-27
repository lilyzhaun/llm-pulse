import express, { type Request, type Response } from "express";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { healthRouter } from "./routes/health.js";
import { pulseRouter } from "./routes/pulse.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const frontendDistDir = resolve(currentDir, "../../frontend/dist");
const frontendIndexPath = resolve(frontendDistDir, "index.html");
const hasFrontendDist = existsSync(frontendIndexPath);

export const createApp = () => {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json());

  app.use("/status/api/health", healthRouter);
  app.use("/status/api/pulse", pulseRouter);

  if (hasFrontendDist) {
    app.use(
      "/status/assets",
      express.static(resolve(frontendDistDir, "assets")),
    );
    app.use(
      "/status",
      express.static(frontendDistDir, { index: "index.html" }),
    );

    app.get("/status", (_request: Request, response: Response) => {
      response.sendFile(frontendIndexPath);
    });

    app.get("/status/*", (_request: Request, response: Response) => {
      response.sendFile(frontendIndexPath);
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
