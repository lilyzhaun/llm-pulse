import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { incrementPersistenceSaveErrors } from "../../src/routes/metrics.js";

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
    expect(response.text).toContain("llm_pulse_poll_duration_seconds");
    expect(response.text).toContain("llm_pulse_aggregation_duration_seconds");
    expect(response.text).toContain("llm_pulse_upstream_request_errors_total");
    expect(response.text).toContain("llm_pulse_persistence_save_errors_total");
    expect(response.text).toContain("llm_pulse_persistence_load_errors_total");
    expect(response.text).toContain("llm_pulse_poll_duration_seconds_count 0");
    expect(response.text).toContain(
      "llm_pulse_aggregation_duration_seconds_count 0",
    );
    expect(response.text).toContain(
      "llm_pulse_upstream_request_errors_total 0",
    );
    expect(response.text).toContain(
      "llm_pulse_persistence_load_errors_total 0",
    );
  });

  it("increments a persistence save error counter", async () => {
    incrementPersistenceSaveErrors();

    const response = await request(createApp())
      .get("/status/api/metrics")
      .expect(200);

    expect(response.text).toMatch(
      /llm_pulse_persistence_save_errors_total\s+[1-9]\d*/,
    );
  });
});
