import { Pool } from "pg";
import { env } from "../../config/env.js";

type ScrubbedPgError = {
  message: string;
  code?: string;
};

export const upstreamPool = new Pool({
  connectionString: env.databaseUrl,
  max: env.dbPoolMax,
  idleTimeoutMillis: env.dbIdleTimeoutMs,
  connectionTimeoutMillis: env.dbConnTimeoutMs,
  statement_timeout: env.queryTimeoutMs,
});

const scrubMessage = (message: string): string => {
  let scrubbed = message.replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted]");
  scrubbed = scrubbed.replace(/password\s*[:=]\s*\S+/gi, "password=[redacted]");
  scrubbed = scrubbed.replace(
    /\b(?:\d{1,3}\.){3}\d{1,3}:\d+\b/g,
    "[redacted-host]",
  );
  scrubbed = scrubbed.replace(
    /\b[a-z0-9.-]+\.[a-z]{2,}:\d+\b/gi,
    "[redacted-host]",
  );
  return scrubbed;
};

const isPgErrorLike = (error: unknown): error is Record<string, unknown> =>
  Boolean(error && typeof error === "object");

export const scrubPgError = (error: unknown): ScrubbedPgError | unknown => {
  if (!isPgErrorLike(error)) {
    return error;
  }

  const message =
    typeof error.message === "string" ? error.message : "PostgreSQL error";
  const scrubbed: ScrubbedPgError = {
    message: scrubMessage(message),
  };

  if (typeof error.code === "string") {
    scrubbed.code = error.code;
  }

  return scrubbed;
};

export const pingUpstreamDb = async (): Promise<boolean> => {
  try {
    await upstreamPool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
};

export const closeUpstreamPool = async (): Promise<void> => {
  await upstreamPool.end();
};
