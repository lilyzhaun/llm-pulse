import type { NewApiLogItem, NewApiLogResponse } from "@llm-pulse/shared";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { aggregationService } from "../services/aggregationService.js";
import { compareByCreatedAtDescThenIdDesc } from "../lib/comparators.js";
import { newApiAuthService } from "../services/newApiAuthService.js";
import { persistenceService } from "../services/persistenceService.js";
import { dedupeLogs } from "../services/newApiLogService.js";

interface BackfillCliOptions {
  hours: number;
  pageSize: number;
  maxPages: number;
  delayMs: number;
  retryLimit: number;
}

const DEFAULTS: BackfillCliOptions = {
  hours: 72,
  pageSize: 100,
  maxPages: 300,
  delayMs: 800,
  retryLimit: 6,
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const fetchLogPage = async (
  page: number,
  options: BackfillCliOptions,
  startTimestamp: number,
): Promise<NewApiLogItem[]> => {
  const url = new URL("/api/log/", env.newApiBaseUrl);
  url.searchParams.set("p", String(page));
  url.searchParams.set("page_size", String(options.pageSize));
  url.searchParams.set("start_timestamp", String(startTimestamp));

  for (let attempt = 0; attempt <= options.retryLimit; attempt += 1) {
    const response = await newApiAuthService.fetchWithAuth(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    const payload = (await response.json()) as
      | NewApiLogResponse
      | { message?: string };
    if (response.ok && "data" in payload && payload.data) {
      return payload.data.items ?? [];
    }

    const message =
      "message" in payload && payload.message
        ? payload.message
        : response.statusText;
    if (response.status !== 429 || attempt === options.retryLimit) {
      throw new Error(`new-api backfill page ${page} failed: ${message}`);
    }

    const waitMs = options.delayMs * (attempt + 1) * 2;
    logger.warn({ page, waitMs }, "Hit 429 on page, retrying");
    await sleep(waitMs);
  }

  return [];
};

const parseArgs = (): BackfillCliOptions => {
  const args = process.argv.slice(2);
  const options = { ...DEFAULTS };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    const value = args[index + 1];

    if (argument === "--hours" && value) {
      options.hours = Number(value);
      index += 1;
    } else if (argument === "--page-size" && value) {
      options.pageSize = Number(value);
      index += 1;
    } else if (argument === "--max-pages" && value) {
      options.maxPages = Number(value);
      index += 1;
    } else if (argument === "--delay-ms" && value) {
      options.delayMs = Number(value);
      index += 1;
    } else if (argument === "--retry-limit" && value) {
      options.retryLimit = Number(value);
      index += 1;
    } else if (argument === "--help") {
      printHelp();
      process.exit(0);
    }
  }

  return options;
};

const printHelp = (): void => {
  logger.info(`
LLM Pulse one-shot backfill

Usage:
  npm run backfill --workspace @llm-pulse/server -- --hours 72 --page-size 100 --max-pages 300 --delay-ms 800 --retry-limit 6

Options:
  --hours        回补最近多少小时，默认 72
  --page-size    每页抓取数量，默认 100
  --max-pages    最大抓取页数，默认 300
  --delay-ms     每页之间等待毫秒数，默认 800
  --retry-limit  遇到 429 时最大重试次数，默认 6
`);
};

const fetchBackfillLogs = async (options: BackfillCliOptions) => {
  const startTimestamp = Math.max(
    0,
    Math.floor(Date.now() / 1000) - options.hours * 60 * 60,
  );
  const logs: NewApiLogItem[] = [];

  await newApiAuthService.ensureSession();

  for (let page = 0; page < options.maxPages; page += 1) {
    const pageLogs = await fetchLogPage(page, options, startTimestamp);

    if (pageLogs.length === 0) {
      break;
    }

    logs.push(...pageLogs);

    if (pageLogs.length < options.pageSize) {
      break;
    }

    await sleep(options.delayMs);
  }

  return dedupeLogs(logs).sort(compareByCreatedAtDescThenIdDesc);
};

const main = async () => {
  const options = parseArgs();
  const restoredState = await persistenceService.loadPulseState();
  await aggregationService.restoreFromState(restoredState);

  logger.info(
    { hours: options.hours },
    "Starting one-shot backfill for recent hours",
  );
  const logs = await fetchBackfillLogs(options);

  await aggregationService.ingestLogsWithState(
    logs,
    {
      lastSeenTimestamp:
        logs[0]?.created_at ?? restoredState?.cursor.lastSeenTimestamp ?? null,
    },
    {
      backfillCompletedAt: new Date().toISOString(),
    },
  );

  logger.info({ importedLogs: logs.length }, "Backfill complete");
};

void main().catch((error) => {
  logger.error({ error }, "Backfill failed");
  process.exit(1);
});
