import type { NewApiLogItem, NewApiLogResponse } from "@llm-pulse/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
  newApiBaseUrl: "http://localhost:3000",
  logPageSize: 2,
  logMaxPagesPerPoll: 3,
  logRewindSeconds: 30,
}));

vi.mock("../../src/config/env.js", () => ({
  env: mockEnv,
}));

import { UpstreamError } from "../../src/errors/AppError.js";
import {
  type FetchRecentLogsOptions,
  NewApiLogService,
} from "../../src/services/newApiLogService.js";

type MockAuthService = ConstructorParameters<typeof NewApiLogService>[0] & {
  ensureSession: ReturnType<typeof vi.fn>;
  fetchWithAuth: ReturnType<typeof vi.fn>;
};

const logItem = (overrides: Partial<NewApiLogItem>): NewApiLogItem => ({
  id: 1,
  user_id: 1001,
  created_at: 1_700_000_000,
  type: 2,
  content: "example content",
  username: "admin",
  token_name: "token-1",
  model_name: "model-a",
  quota: 10,
  prompt_tokens: 4,
  completion_tokens: 6,
  use_time: 1.2,
  is_stream: false,
  channel: 1,
  channel_name: "channel-1",
  token_id: 2001,
  group: "default",
  ip: "127.0.0.1",
  request_id: "req-example-001",
  other: "",
  ...overrides,
});

const logResponse = (
  items: NewApiLogItem[],
  overrides: Partial<NewApiLogResponse["data"]> = {},
): NewApiLogResponse => ({
  success: true,
  message: "ok",
  data: {
    page: 0,
    page_size: mockEnv.logPageSize,
    total: items.length,
    items,
    ...overrides,
  },
});

const response = (payload: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Bad Gateway",
    json: () => Promise.resolve(payload),
  }) as Response;

const createAuthService = (): MockAuthService =>
  ({
    ensureSession: vi.fn().mockResolvedValue(undefined),
    fetchWithAuth: vi.fn(),
  }) as MockAuthService;

const createService = () => {
  const authService = createAuthService();
  const service = new NewApiLogService(authService);
  return { authService, service };
};

const fetchedUrl = (authService: MockAuthService, index = 0): URL => {
  const url = authService.fetchWithAuth.mock.calls[index]?.[0];
  expect(url).toBeInstanceOf(URL);
  return url as URL;
};

const fetchRecentLogs = (
  service: NewApiLogService,
  options?: FetchRecentLogsOptions,
) => service.fetchRecentLogs(options);

describe("NewApiLogService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockEnv.newApiBaseUrl = "http://localhost:3000";
    mockEnv.logPageSize = 2;
    mockEnv.logMaxPagesPerPoll = 3;
    mockEnv.logRewindSeconds = 30;
  });

  it("fetchRecentLogs fetches a single page and remembers the newest timestamp", async () => {
    const { authService, service } = createService();
    authService.fetchWithAuth.mockResolvedValue(
      response(
        logResponse(
          [
            logItem({ id: 1, created_at: 100 }),
            logItem({ id: 2, created_at: 120 }),
          ],
          { total: 2 },
        ),
      ),
    );

    const logs = await fetchRecentLogs(service, { pageSize: 5, maxPages: 3 });

    expect(authService.ensureSession).toHaveBeenCalledTimes(1);
    expect(authService.fetchWithAuth).toHaveBeenCalledTimes(1);
    expect(logs.map((log) => log.id)).toEqual([2, 1]);
    expect(service.getLastSeenTimestamp()).toBe(120);
    const url = fetchedUrl(authService);
    expect(url.pathname).toBe("/api/log/");
    expect(url.searchParams.get("p")).toBe("0");
    expect(url.searchParams.get("page_size")).toBe("5");
    expect(url.searchParams.has("start_timestamp")).toBe(false);
  });

  it("fetchRecentLogs fetches multiple pages and stops when total is reached", async () => {
    const { authService, service } = createService();
    authService.fetchWithAuth
      .mockResolvedValueOnce(
        response(
          logResponse(
            [
              logItem({ id: 1, created_at: 100 }),
              logItem({ id: 2, created_at: 110 }),
            ],
            { page: 0, page_size: 2, total: 3 },
          ),
        ),
      )
      .mockResolvedValueOnce(
        response(
          logResponse([logItem({ id: 3, created_at: 120 })], {
            page: 1,
            page_size: 2,
            total: 3,
          }),
        ),
      );

    const logs = await fetchRecentLogs(service, { pageSize: 2, maxPages: 5 });

    expect(authService.fetchWithAuth).toHaveBeenCalledTimes(2);
    expect(fetchedUrl(authService, 0).searchParams.get("p")).toBe("0");
    expect(fetchedUrl(authService, 1).searchParams.get("p")).toBe("1");
    expect(logs.map((log) => log.id)).toEqual([3, 2, 1]);
  });

  it("fetchRecentLogs deduplicates logs by id before sorting", async () => {
    const { authService, service } = createService();
    authService.fetchWithAuth.mockResolvedValue(
      response(
        logResponse(
          [
            logItem({ id: 1, created_at: 100, request_id: "first" }),
            logItem({ id: 1, created_at: 200, request_id: "duplicate" }),
            logItem({ id: 2, created_at: 150, request_id: "second" }),
          ],
          { total: 3 },
        ),
      ),
    );

    const logs = await fetchRecentLogs(service, { pageSize: 10 });

    expect(logs.map((log) => log.id)).toEqual([2, 1]);
    expect(logs.find((log) => log.id === 1)?.request_id).toBe("first");
    expect(service.getLastSeenTimestamp()).toBe(150);
  });

  it("fetchRecentLogs uses restored timestamp minus rewind seconds for incremental polling", async () => {
    const { authService, service } = createService();
    mockEnv.logRewindSeconds = 45;
    service.restoreLastSeenTimestamp(1_000);
    authService.fetchWithAuth.mockResolvedValue(
      response(logResponse([logItem({ id: 1, created_at: 1_010 })])),
    );

    await fetchRecentLogs(service);

    expect(fetchedUrl(authService).searchParams.get("start_timestamp")).toBe(
      "955",
    );
    expect(service.getLastSeenTimestamp()).toBe(1_010);
  });

  it("fetchRecentLogs clamps incremental start timestamp to zero when rewind is larger", async () => {
    const { authService, service } = createService();
    mockEnv.logRewindSeconds = 300;
    service.restoreLastSeenTimestamp(100);
    authService.fetchWithAuth.mockResolvedValue(
      response(logResponse([logItem({ id: 1, created_at: 100 })])),
    );

    await fetchRecentLogs(service);

    expect(fetchedUrl(authService).searchParams.get("start_timestamp")).toBe(
      "0",
    );
  });

  it("fetchRecentLogs throws UpstreamError when new-api returns a non-2xx response", async () => {
    const { authService, service } = createService();
    authService.fetchWithAuth.mockResolvedValue(
      response({ message: "database unavailable" }, 502),
    );

    await expect(fetchRecentLogs(service)).rejects.toThrow(UpstreamError);
    await expect(fetchRecentLogs(service)).rejects.toThrow(
      "new-api log fetch failed: database unavailable",
    );
  });

  it("fetchRecentLogs throws UpstreamError when new-api response shape is invalid", async () => {
    const { authService, service } = createService();
    authService.fetchWithAuth.mockResolvedValue(
      response({ success: true, message: "ok", data: { items: [] } }),
    );

    await expect(fetchRecentLogs(service)).rejects.toThrow(UpstreamError);
    await expect(fetchRecentLogs(service)).rejects.toThrow(
      "new-api log response was invalid: unexpected shape",
    );
  });
});
