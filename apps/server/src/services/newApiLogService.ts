import type {
  NewApiLogItem,
  NewApiLogQuery,
  NewApiLogResponse,
} from "@llm-pulse/shared";
import { env } from "../config/env.js";
import { UpstreamError } from "../errors/AppError.js";
import {
  type NewApiAuthService,
  newApiAuthService,
} from "./newApiAuthService.js";

export interface FetchRecentLogsOptions {
  startTimestamp?: number;
  pageSize?: number;
  maxPages?: number;
}

const buildLogUrl = (query: NewApiLogQuery): URL => {
  if (!env.newApiBaseUrl) {
    throw new UpstreamError(
      "NEW_API_BASE_URL is required for new-api log fetch",
    );
  }

  const url = new URL("/api/log/", env.newApiBaseUrl);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  return url;
};

const isNewApiLogResponse = (value: unknown): value is NewApiLogResponse => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const response = value as Partial<NewApiLogResponse>;
  return Boolean(
    typeof response.success === "boolean" &&
      typeof response.message === "string" &&
      response.data &&
      typeof response.data.page === "number" &&
      typeof response.data.page_size === "number" &&
      typeof response.data.total === "number" &&
      Array.isArray(response.data.items),
  );
};

export const dedupeLogs = (logs: NewApiLogItem[]): NewApiLogItem[] => {
  const seenIds = new Set<number>();

  return logs.filter((log) => {
    if (seenIds.has(log.id)) {
      return false;
    }

    seenIds.add(log.id);
    return true;
  });
};

export class NewApiLogService {
  private lastSeenTimestamp: number | undefined;

  constructor(
    private readonly authService: NewApiAuthService = newApiAuthService,
  ) {}

  async fetchRecentLogs(
    options: FetchRecentLogsOptions = {},
  ): Promise<NewApiLogItem[]> {
    const pageSize = options.pageSize ?? env.logPageSize;
    const maxPages = options.maxPages ?? env.logMaxPagesPerPoll;
    const startTimestamp =
      options.startTimestamp ?? this.getIncrementalStartTimestamp();
    const logs: NewApiLogItem[] = [];

    await this.authService.ensureSession();

    for (let page = 0; page < maxPages; page += 1) {
      const query: NewApiLogQuery = {
        p: page,
        page_size: pageSize,
      };
      if (startTimestamp !== undefined) {
        query.start_timestamp = startTimestamp;
      }

      const response = await this.fetchLogPage(query);

      logs.push(...response.data.items);

      if (
        response.data.items.length < pageSize ||
        logs.length >= response.data.total
      ) {
        break;
      }
    }

    const dedupedLogs = dedupeLogs(logs).sort(
      (left, right) => right.created_at - left.created_at || right.id - left.id,
    );
    this.rememberNewestTimestamp(dedupedLogs);

    return dedupedLogs;
  }

  getLastSeenTimestamp(): number | null {
    return this.lastSeenTimestamp ?? null;
  }

  restoreLastSeenTimestamp(lastSeenTimestamp: number | null): void {
    if (lastSeenTimestamp === null) {
      return;
    }

    this.lastSeenTimestamp = lastSeenTimestamp;
  }

  private async fetchLogPage(
    query: NewApiLogQuery,
  ): Promise<NewApiLogResponse> {
    const response = await this.authService.fetchWithAuth(buildLogUrl(query), {
      method: "GET",
    });

    const payload = (await response.json()) as unknown;
    if (!response.ok) {
      const message =
        payload && typeof payload === "object" && "message" in payload
          ? String(payload.message)
          : response.statusText;
      throw new UpstreamError(`new-api log fetch failed: ${message}`);
    }

    if (!isNewApiLogResponse(payload) || !payload.success) {
      throw new UpstreamError(
        `new-api log response was invalid: ${isNewApiLogResponse(payload) ? payload.message : "unexpected shape"}`,
      );
    }

    return payload;
  }

  private getIncrementalStartTimestamp(): number | undefined {
    if (this.lastSeenTimestamp === undefined) {
      return undefined;
    }

    return Math.max(0, this.lastSeenTimestamp - env.logRewindSeconds);
  }

  private rememberNewestTimestamp(logs: NewApiLogItem[]): void {
    const newestTimestamp = logs[0]?.created_at;
    if (newestTimestamp === undefined) {
      return;
    }

    this.lastSeenTimestamp = Math.max(
      this.lastSeenTimestamp ?? 0,
      newestTimestamp,
    );
  }
}

export const newApiLogService = new NewApiLogService();
