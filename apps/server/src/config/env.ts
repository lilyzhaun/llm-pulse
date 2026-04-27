import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type NodeEnv = "development" | "test" | "production";

const loadLocalEnv = (): void => {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(currentDir, "../../../../.env");

  if (!existsSync(envPath)) {
    return;
  }

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
};

const parseInteger = (
  name: string,
  value: string | undefined,
  fallback: number,
): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} must be an integer`);
  }

  return parsed;
};

const parsePositiveInteger = (
  name: string,
  value: string | undefined,
  fallback: number,
): number => {
  const parsed = parseInteger(name, value, fallback);
  if (parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
};

const parseNonNegativeInteger = (
  name: string,
  value: string | undefined,
  fallback: number,
): number => {
  const parsed = parseInteger(name, value, fallback);
  if (parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }

  return parsed;
};

const parsePort = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return port;
};

const parseNodeEnv = (value: string | undefined): NodeEnv => {
  if (value === "production" || value === "test" || value === "development") {
    return value;
  }

  return "development";
};

const nodeEnv = parseNodeEnv(process.env.NODE_ENV);

if (nodeEnv !== "production") {
  loadLocalEnv();
}

const port = parsePort(process.env.PORT ?? process.env.BFF_PORT, 3001);

export const env = {
  nodeEnv,
  port,
  newApiBaseUrl: process.env.NEW_API_BASE_URL ?? "",
  newApiAdminUsername: process.env.NEW_API_ADMIN_USERNAME ?? "",
  newApiAdminPassword: process.env.NEW_API_ADMIN_PASSWORD ?? "",
  pollIntervalMs: parsePositiveInteger(
    "POLL_INTERVAL_MS",
    process.env.POLL_INTERVAL_MS,
    20_000,
  ),
  availabilityWindowSeconds: parsePositiveInteger(
    "AVAILABILITY_WINDOW_SECONDS",
    process.env.AVAILABILITY_WINDOW_SECONDS,
    3_600,
  ),
  logPageSize: parsePositiveInteger(
    "LOG_PAGE_SIZE",
    process.env.LOG_PAGE_SIZE,
    50,
  ),
  logMaxPagesPerPoll: parsePositiveInteger(
    "LOG_MAX_PAGES_PER_POLL",
    process.env.LOG_MAX_PAGES_PER_POLL,
    5,
  ),
  logRewindSeconds: parseNonNegativeInteger(
    "LOG_REWIND_SECONDS",
    process.env.LOG_REWIND_SECONDS,
    60,
  ),
  initialBackfillHours: parsePositiveInteger(
    "INITIAL_BACKFILL_HOURS",
    process.env.INITIAL_BACKFILL_HOURS,
    24,
  ),
  initialBackfillMaxPages: parsePositiveInteger(
    "INITIAL_BACKFILL_MAX_PAGES",
    process.env.INITIAL_BACKFILL_MAX_PAGES,
    100,
  ),
} as const;

export const isProduction = env.nodeEnv === "production";
