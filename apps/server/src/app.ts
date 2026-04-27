import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
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
    app.use((request: Request, _response: Response, next: NextFunction) => {
      const responseLike = _response as unknown as {
        setHeader: (name: string, value: string) => void;
      };
      if (request.path === "/status/sw.js") {
        responseLike.setHeader("Cache-Control", "no-cache");
        responseLike.setHeader("Service-Worker-Allowed", "/status/");
      } else if (request.path === "/status/manifest.webmanifest") {
        responseLike.setHeader(
          "Content-Type",
          "application/manifest+json; charset=utf-8",
        );
        responseLike.setHeader("Cache-Control", "public, max-age=300");
      }
      next();
    });

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
