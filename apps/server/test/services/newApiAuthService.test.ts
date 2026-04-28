import { beforeEach, describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({
  newApiBaseUrl: "http://localhost:3000",
  newApiAdminUsername: "admin",
  newApiAdminPassword: "password",
}));

vi.mock("../../src/config/env.js", () => ({
  env: mockEnv,
}));

import { NewApiAuthService } from "../../src/services/newApiAuthService.js";

const loginResponse = (overrides: Partial<Response> = {}): Response =>
  ({
    ok: true,
    status: 200,
    headers: new Headers({
      "set-cookie": "session=abc123; Path=/; HttpOnly",
      "content-type": "application/json",
    }),
    json: () => Promise.resolve({ data: { id: 1 } }),
    ...overrides,
  }) as Response;

const response = (status: number): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: () => Promise.resolve({}),
  }) as Response;

const fetchMock = (): ReturnType<typeof vi.fn> => {
  const mockFetch = vi.fn();
  globalThis.fetch = mockFetch as unknown as typeof fetch;
  return mockFetch;
};

describe("NewApiAuthService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockEnv.newApiBaseUrl = "http://localhost:3000";
    mockEnv.newApiAdminUsername = "admin";
    mockEnv.newApiAdminPassword = "password";
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  it("logs in with admin credentials and stores the session cookie and user id", async () => {
    const mockFetch = fetchMock().mockResolvedValue(loginResponse());
    const service = new NewApiAuthService();

    await service.login();

    expect(mockFetch).toHaveBeenCalledWith(
      new URL("/api/user/login", mockEnv.newApiBaseUrl),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          username: mockEnv.newApiAdminUsername,
          password: mockEnv.newApiAdminPassword,
        }),
      },
    );
    await expect(service.getRequestHeaders()).resolves.toEqual({
      Cookie: "session=abc123",
      "New-Api-User": "1",
    });
  });

  it("clears the session and throws when login returns a failed response", async () => {
    const mockFetch = fetchMock()
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(response(500))
      .mockResolvedValueOnce(loginResponse());
    const service = new NewApiAuthService();

    await service.login();
    await expect(service.login()).rejects.toThrow(
      "new-api login failed with status 500",
    );
    mockFetch.mockClear();

    await service.ensureSession();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("clears the session and throws when login response has no cookie", async () => {
    const mockFetch = fetchMock()
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(
        loginResponse({
          headers: new Headers({
            "content-type": "application/json",
          }),
        }),
      )
      .mockResolvedValueOnce(loginResponse());
    const service = new NewApiAuthService();

    await service.login();
    await expect(service.login()).rejects.toThrow(
      "new-api login response did not include a session cookie and user id",
    );
    mockFetch.mockClear();

    await service.ensureSession();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("clears the session and throws when login response has no user id", async () => {
    const mockFetch = fetchMock()
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(
        loginResponse({
          json: () => Promise.resolve({ data: {} }),
        }),
      )
      .mockResolvedValueOnce(loginResponse());
    const service = new NewApiAuthService();

    await service.login();
    await expect(service.login()).rejects.toThrow(
      "new-api login response did not include a session cookie and user id",
    );
    mockFetch.mockClear();

    await service.ensureSession();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("ensureSession logs in when no session exists", async () => {
    const mockFetch = fetchMock().mockResolvedValue(loginResponse());
    const service = new NewApiAuthService();

    await service.ensureSession();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("ensureSession skips login when a session already exists", async () => {
    const mockFetch = fetchMock().mockResolvedValue(loginResponse());
    const service = new NewApiAuthService();

    await service.ensureSession();
    await service.ensureSession();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("fetchWithAuth sends Cookie and New-Api-User headers", async () => {
    const mockFetch = fetchMock()
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(response(200));
    const service = new NewApiAuthService();

    const result = await service.fetchWithAuth(
      "http://localhost:3000/api/logs",
      {
        headers: {
          Accept: "application/json",
        },
      },
    );

    expect(result.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const init = mockFetch.mock.calls[1]?.[1] as RequestInit;
    const headers = init.headers as Headers;
    expect(headers.get("Cookie")).toBe("session=abc123");
    expect(headers.get("New-Api-User")).toBe("1");
    expect(headers.get("Accept")).toBe("application/json");
  });

  it("fetchWithAuth refreshes the session and retries on 401", async () => {
    const mockFetch = fetchMock()
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(response(401))
      .mockResolvedValueOnce(
        loginResponse({
          headers: new Headers({
            "set-cookie": "session=refreshed; Path=/; HttpOnly",
          }),
          json: () => Promise.resolve({ data: { id: 2 } }),
        }),
      )
      .mockResolvedValueOnce(response(200));
    const service = new NewApiAuthService();

    const result = await service.fetchWithAuth(
      "http://localhost:3000/api/logs",
    );

    expect(result.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(4);
    const retriedInit = mockFetch.mock.calls[3]?.[1] as RequestInit;
    const retriedHeaders = retriedInit.headers as Headers;
    expect(retriedHeaders.get("Cookie")).toBe("session=refreshed");
    expect(retriedHeaders.get("New-Api-User")).toBe("2");
  });

  it("fetchWithAuth refreshes the session and retries on 403", async () => {
    const mockFetch = fetchMock()
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(response(403))
      .mockResolvedValueOnce(
        loginResponse({
          headers: new Headers({
            "set-cookie": "session=refreshed403; Path=/; HttpOnly",
          }),
          json: () => Promise.resolve({ data: { id: 3 } }),
        }),
      )
      .mockResolvedValueOnce(response(204));
    const service = new NewApiAuthService();

    const result = await service.fetchWithAuth(
      "http://localhost:3000/api/logs",
    );

    expect(result.status).toBe(204);
    expect(mockFetch).toHaveBeenCalledTimes(4);
    const retriedInit = mockFetch.mock.calls[3]?.[1] as RequestInit;
    const retriedHeaders = retriedInit.headers as Headers;
    expect(retriedHeaders.get("Cookie")).toBe("session=refreshed403");
    expect(retriedHeaders.get("New-Api-User")).toBe("3");
  });

  it("fetchWithAuth returns non-401 and non-403 responses without refresh", async () => {
    const mockFetch = fetchMock()
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(response(500));
    const service = new NewApiAuthService();

    const result = await service.fetchWithAuth(
      "http://localhost:3000/api/logs",
    );

    expect(result.status).toBe(500);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("getRequestHeaders logs in and returns auth headers", async () => {
    const mockFetch = fetchMock().mockResolvedValue(loginResponse());
    const service = new NewApiAuthService();

    await expect(service.getRequestHeaders()).resolves.toEqual({
      Cookie: "session=abc123",
      "New-Api-User": "1",
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("getRequestHeaders throws when session is still unavailable after login", async () => {
    fetchMock().mockResolvedValue(
      loginResponse({
        headers: new Headers(),
        json: () => Promise.resolve({ data: {} }),
      }),
    );
    const service = new NewApiAuthService();

    await expect(service.getRequestHeaders()).rejects.toThrow(
      "new-api login response did not include a session cookie and user id",
    );
  });

  it("deduplicates concurrent ensureSession calls through a single login", async () => {
    let resolveLogin: (response: Response) => void = () => undefined;
    const loginPromise = new Promise<Response>((resolve) => {
      resolveLogin = resolve;
    });
    const mockFetch = fetchMock().mockReturnValue(loginPromise);
    const service = new NewApiAuthService();

    const firstEnsure = service.ensureSession();
    const secondEnsure = service.ensureSession();
    resolveLogin(loginResponse());

    await Promise.all([firstEnsure, secondEnsure]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("refreshSession clears the existing session and logs in again", async () => {
    const mockFetch = fetchMock()
      .mockResolvedValueOnce(loginResponse())
      .mockResolvedValueOnce(
        loginResponse({
          headers: new Headers({
            "set-cookie": "session=new; Path=/; HttpOnly",
          }),
          json: () => Promise.resolve({ data: { id: 4 } }),
        }),
      );
    const service = new NewApiAuthService();

    await service.ensureSession();
    await service.refreshSession();

    expect(mockFetch).toHaveBeenCalledTimes(2);
    await expect(service.getRequestHeaders()).resolves.toEqual({
      Cookie: "session=new",
      "New-Api-User": "4",
    });
  });

  it("clearSession removes the session cookie and user id", async () => {
    const mockFetch = fetchMock().mockResolvedValue(loginResponse());
    const service = new NewApiAuthService();

    await service.login();
    service.clearSession();
    mockFetch.mockClear();
    await service.ensureSession();

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
