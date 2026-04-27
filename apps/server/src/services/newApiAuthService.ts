import { env } from "../config/env.js";
import { UpstreamError, ValidationError } from "../errors/AppError.js";

export interface NewApiRequestHeaders {
  Cookie: string;
  "New-Api-User": string;
}

export class NewApiAuthService {
  private sessionCookie: string | null = null;
  private userId: number | null = null;
  private loginPromise: Promise<void> | null = null;

  async login(): Promise<void> {
    if (!env.newApiBaseUrl) {
      throw new ValidationError(
        "NEW_API_BASE_URL is required for new-api login",
      );
    }

    if (!env.newApiAdminUsername || !env.newApiAdminPassword) {
      throw new ValidationError(
        "NEW_API_ADMIN_USERNAME and NEW_API_ADMIN_PASSWORD are required for new-api login",
      );
    }

    const loginUrl = new URL("/api/user/login", env.newApiBaseUrl);
    const response = await fetch(loginUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        username: env.newApiAdminUsername,
        password: env.newApiAdminPassword,
      }),
    });

    if (!response.ok) {
      this.clearSession();
      throw new UpstreamError(
        `new-api login failed with status ${response.status}`,
      );
    }

    const cookie = this.extractSessionCookie(response.headers);
    const body = (await response.json()) as NewApiLoginResponse;
    const userId = body.data?.id;

    if (!cookie || typeof userId !== "number") {
      this.clearSession();
      throw new UpstreamError(
        "new-api login response did not include a session cookie and user id",
      );
    }

    this.sessionCookie = cookie;
    this.userId = userId;
  }

  async ensureSession(): Promise<void> {
    if (this.sessionCookie && this.userId !== null) {
      return;
    }

    await this.withSingleLogin();
  }

  async getRequestHeaders(): Promise<NewApiRequestHeaders> {
    await this.ensureSession();

    if (!this.sessionCookie || this.userId === null) {
      throw new UpstreamError("new-api session is not available");
    }

    return {
      Cookie: this.sessionCookie,
      "New-Api-User": String(this.userId),
    };
  }

  async fetchWithAuth(
    input: Parameters<typeof fetch>[0],
    init: RequestInit = {},
  ): Promise<Response> {
    const response = await fetch(input, await this.withAuthHeaders(init));
    if (response.status !== 401 && response.status !== 403) {
      return response;
    }

    await this.refreshSession();
    return fetch(input, await this.withAuthHeaders(init));
  }

  async refreshSession(): Promise<void> {
    this.clearSession();
    await this.withSingleLogin();
  }

  clearSession(): void {
    this.sessionCookie = null;
    this.userId = null;
  }

  private async withSingleLogin(): Promise<void> {
    if (!this.loginPromise) {
      this.loginPromise = this.login().finally(() => {
        this.loginPromise = null;
      });
    }

    await this.loginPromise;
  }

  private async withAuthHeaders(init: RequestInit): Promise<RequestInit> {
    const requestHeaders = await this.getRequestHeaders();
    const headers = new Headers(init.headers);
    headers.set("Cookie", requestHeaders.Cookie);
    headers.set("New-Api-User", requestHeaders["New-Api-User"]);

    return {
      ...init,
      headers,
    };
  }

  private extractSessionCookie(headers: Headers): string | null {
    const setCookieHeaders = getSetCookieHeaders(headers);
    if (setCookieHeaders.length === 0) {
      return null;
    }

    return setCookieHeaders.map((cookie) => cookie.split(";", 1)[0]).join("; ");
  }
}

interface NewApiLoginResponse {
  data?: {
    id?: number;
  };
}

const getSetCookieHeaders = (headers: Headers): string[] => {
  const headersWithGetSetCookie = headers as Headers & {
    getSetCookie?: () => string[];
    raw?: () => Record<string, string[]>;
  };

  const getSetCookieResult = headersWithGetSetCookie.getSetCookie?.();
  if (getSetCookieResult && getSetCookieResult.length > 0) {
    return getSetCookieResult;
  }

  const rawSetCookie = headersWithGetSetCookie.raw?.()["set-cookie"];
  if (rawSetCookie && rawSetCookie.length > 0) {
    return rawSetCookie;
  }

  const setCookie = headers.get("set-cookie");
  return setCookie ? [setCookie] : [];
};

export const newApiAuthService = new NewApiAuthService();
