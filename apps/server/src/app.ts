import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import helmet from "helmet";
import { logger } from "./lib/logger.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { healthRouter } from "./routes/health.js";
import { metricsRouter } from "./routes/metrics.js";
import { pulseRouter } from "./routes/pulse.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const frontendDistDir = resolve(currentDir, "../../frontend/dist");
const frontendIndexPath = resolve(frontendDistDir, "index.html");
const hasFrontendDist = existsSync(frontendIndexPath);

const requestIdHeader = "x-request-id";
const jsonBodyLimit = "100kb";

type RateLimitClientIpInput = {
  fallbackIp: string;
  forwardedFor: string | undefined;
  remoteAddress: string | undefined;
};

const isLoopbackAddress = (remoteAddress: string | undefined): boolean => {
  if (!remoteAddress) {
    return false;
  }

  return (
    remoteAddress === "::1" ||
    remoteAddress.startsWith("127.") ||
    remoteAddress.startsWith("::ffff:127.")
  );
};

const firstForwardedForAddress = (forwardedFor: string | undefined) => {
  const firstAddress = forwardedFor
    ?.split(",")
    .map((value) => value.trim())
    .find((value) => value.length > 0);

  return firstAddress;
};

export const clientIpForRateLimit = ({
  fallbackIp,
  forwardedFor,
  remoteAddress,
}: RateLimitClientIpInput): string => {
  const forwardedAddress = firstForwardedForAddress(forwardedFor);

  if (isLoopbackAddress(remoteAddress) && forwardedAddress) {
    return forwardedAddress;
  }

  return fallbackIp;
};

const createApiRateLimiter = () =>
  rateLimit({
    windowMs: 60_000,
    limit: 120,
    keyGenerator: (request) =>
      ipKeyGenerator(
        clientIpForRateLimit({
          fallbackIp: request.ip ?? request.socket.remoteAddress ?? "unknown",
          forwardedFor: request.get("x-forwarded-for"),
          remoteAddress: request.socket.remoteAddress,
        }),
      ),
    standardHeaders: true,
    legacyHeaders: false,
  });

const requestIdMiddleware = (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  const incomingRequestId = request.get(requestIdHeader)?.trim();
  const requestId = incomingRequestId || randomUUID();

  response.locals.requestId = requestId;
  response.setHeader(requestIdHeader, requestId);
  next();
};

const accessLogMiddleware = (
  request: Request,
  response: Response,
  next: NextFunction,
) => {
  const startedAt = process.hrtime.bigint();

  response.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    logger.info(
      {
        method: request.method,
        path: request.originalUrl || request.path,
        status: response.statusCode,
        durationMs: Math.round(durationMs),
        requestId: response.locals.requestId,
      },
      "HTTP request completed",
    );
  });

  next();
};

export const createApp = () => {
  const app = express();

  app.disable("x-powered-by");
  app.use(
    helmet({
      contentSecurityPolicy: false,
    }),
  );
  app.use(express.json({ limit: jsonBodyLimit }));
  app.use(requestIdMiddleware);
  app.use(accessLogMiddleware);

  app.use("/status/api", createApiRateLimiter());
  app.use("/status/api/health", healthRouter);
  app.use("/status/api/metrics", metricsRouter);
  app.use("/status/api/pulse", pulseRouter);

  if (hasFrontendDist) {
    app.use((request: Request, response: Response, next: NextFunction) => {
      if (request.path === "/status/sw.js") {
        response.setHeader("Cache-Control", "no-cache");
        response.setHeader("Service-Worker-Allowed", "/status/");
      } else if (request.path === "/status/manifest.webmanifest") {
        response.setHeader(
          "Content-Type",
          "application/manifest+json; charset=utf-8",
        );
        response.setHeader("Cache-Control", "public, max-age=300");
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
