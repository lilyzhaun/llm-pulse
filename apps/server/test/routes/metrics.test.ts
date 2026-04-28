import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";

describe("metrics routes", () => {
  it("returns Prometheus metrics text with default and app metrics", async () => {
    const response = await request(createApp())
      .get("/status/api/metrics")
      .expect(200);

    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.headers["content-type"]).toContain("version=0.0.4");
    expect(response.text).toContain("# HELP process_cpu_user_seconds_total");
    expect(response.text).toContain("# TYPE process_cpu_user_seconds_total");
    expect(response.text).toContain("# HELP llm_pulse_uptime_seconds");
    expect(response.text).toContain("# TYPE llm_pulse_uptime_seconds gauge");
  });
});
