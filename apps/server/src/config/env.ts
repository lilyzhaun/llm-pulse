import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type NodeEnv = "development" | "test" | "production";

/**
 * Minimal .env loader for non-production environments. Supports only simple
 * KEY=VALUE lines (no quotes, no multi-line, no escaping). For complex .env
 * files, use a dedicated dotenv package instead.
 */
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

const parseBoolean = (
  name: string,
  value: string | undefined,
  fallback: boolean,
): boolean => {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "") {
    return fallback;
  }

  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new Error(`${name} must be boolean-like`);
};

const parseSnapshotPath = (value: string | undefined): string => {
  const trimmed = value?.trim();
  if (trimmed) {
    return trimmed;
  }

  const currentDir = dirname(fileURLToPath(import.meta.url));
  return resolve(currentDir, "../../data/pulse-snapshot.sqlite");
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

const parseBindHost = (value: string | undefined): string => {
  const host = value?.trim();

  return host || "127.0.0.1";
};

const parseRequiredString = (
  name: string,
  value: string | undefined,
): string => {
  if (!value?.trim()) {
    throw new Error(`${name} is required`);
  }

  return value.trim();
};

const currentEnv = {
  nodeEnv,
  port,
  bindHost: parseBindHost(process.env.BFF_BIND_HOST),
  logLevel: process.env.LOG_LEVEL,
  databaseUrl: parseRequiredString("DATABASE_URL", process.env.DATABASE_URL),
  snapshotEnabled: parseBoolean(
    "PULSE_SNAPSHOT_ENABLED",
    process.env.PULSE_SNAPSHOT_ENABLED,
    false,
  ),
  snapshotPath: parseSnapshotPath(process.env.PULSE_SNAPSHOT_PATH),
  refreshIntervalMs: parsePositiveInteger(
    "PULSE_REFRESH_INTERVAL_MS",
    process.env.PULSE_REFRESH_INTERVAL_MS ?? process.env.POLL_INTERVAL_MS,
    20_000,
  ),
  availabilityWindowSeconds: parsePositiveInteger(
    "AVAILABILITY_WINDOW_SECONDS",
    process.env.AVAILABILITY_WINDOW_SECONDS,
    3_600,
  ),
  queryTimeoutMs: parsePositiveInteger(
    "PULSE_QUERY_TIMEOUT_MS",
    process.env.PULSE_QUERY_TIMEOUT_MS,
    5_000,
  ),
  dbPoolMax: parsePositiveInteger(
    "PULSE_DB_POOL_MAX",
    process.env.PULSE_DB_POOL_MAX,
    5,
  ),
  dbIdleTimeoutMs: parsePositiveInteger(
    "PULSE_DB_IDLE_TIMEOUT_MS",
    process.env.PULSE_DB_IDLE_TIMEOUT_MS,
    30_000,
  ),
  dbConnTimeoutMs: parsePositiveInteger(
    "PULSE_DB_CONN_TIMEOUT_MS",
    process.env.PULSE_DB_CONN_TIMEOUT_MS,
    2_000,
  ),
  reconcileSeconds: parsePositiveInteger(
    "PULSE_RECONCILE_SECONDS",
    process.env.PULSE_RECONCILE_SECONDS,
    120,
  ),
  bootstrapBatchSize: parsePositiveInteger(
    "PULSE_BOOTSTRAP_BATCH_SIZE",
    process.env.PULSE_BOOTSTRAP_BATCH_SIZE,
    1_000,
  ),
} as const;

export const env = currentEnv;

export const isProduction = env.nodeEnv === "production";
