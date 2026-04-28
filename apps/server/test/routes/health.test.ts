import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";

describe("health routes", () => {
  it("returns health status and core service fields", async () => {
    const response = await request(createApp())
      .get("/status/api/health")
      .expect(200);

    expect(response.body).toMatchObject({
      status: "ok",
      service: "llm-pulse-bff",
    });
    expect(response.body.uptimeSeconds).toEqual(expect.any(Number));
  });

  it("returns the expected error shape for unknown routes", async () => {
    const response = await request(createApp())
      .get("/unknown-route")
      .expect(404);

    expect(response.body).toEqual({
      error: {
        message: "Route GET /unknown-route not found",
      },
    });
  });
});
