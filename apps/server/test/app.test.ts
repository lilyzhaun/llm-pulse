import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clientIpForRateLimit, createApp } from "../src/app.js";
import { AppError } from "../src/errors/AppError.js";
import { logger } from "../src/lib/logger.js";
import { errorHandler } from "../src/middleware/errorHandler.js";

vi.mock("../src/lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
  },
}));

const loggerInfo = vi.mocked(logger.info);

describe("app middleware", () => {
  beforeEach(() => {
    loggerInfo.mockClear();
  });

  it("sets baseline security headers without defining app-level CSP", async () => {
    const response = await request(createApp())
      .get("/status/api/health")
      .expect(200);

    expect(response.headers["x-powered-by"]).toBeUndefined();
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(response.headers["content-security-policy"]).toBeUndefined();
  });

  it("echoes an incoming request id and writes an access log", async () => {
    const response = await request(createApp())
      .get("/status/api/health")
      .set("x-request-id", "req-test-123")
      .expect(200);

    expect(response.headers["x-request-id"]).toBe("req-test-123");
    expect(loggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        path: "/status/api/health",
        status: 200,
        durationMs: expect.any(Number),
        requestId: "req-test-123",
      }),
      "HTTP request completed",
    );
  });

  it("generates a request id when the caller does not provide one", async () => {
    const response = await request(createApp())
      .get("/status/api/health")
      .expect(200);

    expect(response.headers["x-request-id"]).toEqual(expect.any(String));
    expect(response.headers["x-request-id"]).not.toHaveLength(0);
  });

  it("generates a request id instead of trusting a blank incoming header", async () => {
    const response = await request(createApp())
      .get("/status/api/health")
      .set("x-request-id", "   ")
      .expect(200);

    expect(response.headers["x-request-id"]).toEqual(expect.any(String));
    expect(response.headers["x-request-id"]).not.toBe("   ");
    expect(response.headers["x-request-id"].trim()).not.toHaveLength(0);
  });

  it("rate limits repeated API requests", async () => {
    const agent = request(createApp());
    let rateLimitedResponse: request.Response | null = null;

    for (let index = 0; index < 121; index += 1) {
      const response = await agent.get("/status/api/health");

      if (response.status === 429) {
        rateLimitedResponse = response;
        break;
      }
    }

    expect(rateLimitedResponse?.status).toBe(429);
    expect(rateLimitedResponse?.headers["ratelimit-limit"]).toBe("120");
  });

  it("uses X-Forwarded-For from the local reverse proxy to avoid global IP collapse", async () => {
    const agent = request(createApp());

    for (let index = 0; index < 120; index += 1) {
      await agent
        .get("/status/api/health")
        .set("X-Forwarded-For", "198.51.100.10")
        .expect(200);
    }

    await agent
      .get("/status/api/health")
      .set("X-Forwarded-For", "198.51.100.10")
      .expect(429);

    const distinctClientResponse = await agent
      .get("/status/api/health")
      .set("X-Forwarded-For", "203.0.113.20")
      .expect(200);

    expect(distinctClientResponse.headers["ratelimit-remaining"]).toBe("119");
  });

  it("only trusts X-Forwarded-For for loopback reverse proxy connections", () => {
    expect(
      clientIpForRateLimit({
        fallbackIp: "127.0.0.1",
        forwardedFor: "198.51.100.11, 10.0.0.2",
        remoteAddress: "127.0.0.1",
      }),
    ).toBe("198.51.100.11");

    expect(
      clientIpForRateLimit({
        fallbackIp: "198.51.100.99",
        forwardedFor: "203.0.113.30",
        remoteAddress: "198.51.100.99",
      }),
    ).toBe("198.51.100.99");
  });

  it("rejects JSON bodies above the explicit limit", async () => {
    const oversizedBody = {
      payload: "x".repeat(101 * 1024),
    };

    const response = await request(createApp())
      .post("/status/api/health")
      .send(oversizedBody)
      .expect(413);

    expect(response.body).toEqual({
      error: {
        message: "Bad request",
      },
    });
  });

  it("does not leak JSON parser internals for malformed API requests", async () => {
    const response = await request(createApp())
      .post("/status/api/health")
      .set("Content-Type", "application/json")
      .send('{"password":"db.internal.local"')
      .expect(400);

    expect(response.body).toEqual({
      error: {
        message: "Bad request",
      },
    });
    expect(JSON.stringify(response.body)).not.toContain("db.internal.local");
    expect(JSON.stringify(response.body)).not.toContain("Unexpected");
  });

  it("does not apply the API rate limiter to non-API routes", async () => {
    const agent = request(createApp());

    for (let index = 0; index < 121; index += 1) {
      const response = await agent.get("/unknown-route");
      expect(response.status).toBe(404);
      expect(response.headers["ratelimit-limit"]).toBeUndefined();
    }
  });
});

describe("error handler", () => {
  it("does not expose unexpected 5xx error messages", async () => {
    const app = express();

    app.get("/boom", () => {
      throw new Error("database host db.internal.local rejected password");
    });
    app.use(errorHandler);

    const response = await request(app).get("/boom").expect(500);

    expect(response.body).toEqual({
      error: {
        message: "Internal server error",
      },
    });
    expect(JSON.stringify(response.body)).not.toContain("db.internal.local");
  });

  it("does not expose AppError messages for 5xx responses", async () => {
    const app = express();

    app.get("/app-error", () => {
      throw new AppError(
        "upstream token expired for host db.internal.local",
        502,
      );
    });
    app.use(errorHandler);

    const response = await request(app).get("/app-error").expect(502);

    expect(response.body).toEqual({
      error: {
        message: "Internal server error",
      },
    });
  });

  it("keeps AppError messages for non-5xx responses", async () => {
    const app = express();

    app.get("/bad-request", () => {
      throw new AppError("Invalid request", 400);
    });
    app.use(errorHandler);

    const response = await request(app).get("/bad-request").expect(400);

    expect(response.body).toEqual({
      error: {
        message: "Invalid request",
      },
    });
  });
});
