import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type EnvModule = typeof import("../../src/config/env.js");

const ORIGINAL_ENV = process.env;

const loadEnv = async (
  overrides: NodeJS.ProcessEnv = {},
): Promise<EnvModule> => {
  vi.resetModules();
  process.env = {
    DATABASE_URL: "postgres://user:pass@localhost:5432/pulse",
    ...overrides,
  };

  return import("../../src/config/env.js");
};

describe("env config", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { DATABASE_URL: "postgres://user:pass@localhost:5432/pulse" };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.resetModules();
  });

  it("falls back to default values for PORT, BFF_PORT, BFF_BIND_HOST, and NODE_ENV", async () => {
    const { env } = await loadEnv();

    expect(env.port).toBe(3001);
    expect(env.bindHost).toBe("127.0.0.1");
    expect(env.nodeEnv).toBe("development");
  });

  it("parses BFF_BIND_HOST values", async () => {
    const { env } = await loadEnv({ BFF_BIND_HOST: "0.0.0.0" });

    expect(env.bindHost).toBe("0.0.0.0");
  });

  it("falls back to loopback when BFF_BIND_HOST is blank", async () => {
    const { env } = await loadEnv({ BFF_BIND_HOST: "   " });

    expect(env.bindHost).toBe("127.0.0.1");
  });

  it("parses valid PORT and BFF_PORT values", async () => {
    const fromPort = await loadEnv({ PORT: "43130" });
    expect(fromPort.env.port).toBe(43130);

    const fromBffPort = await loadEnv({ BFF_PORT: "3002" });
    expect(fromBffPort.env.port).toBe(3002);

    const portTakesPrecedence = await loadEnv({
      PORT: "4000",
      BFF_PORT: "5000",
    });
    expect(portTakesPrecedence.env.port).toBe(4000);
  });

  it.each([
    ["zero", "0"],
    ["negative", "-1"],
    ["too large", "65536"],
    ["decimal", "3001.5"],
    ["text", "abc"],
  ])("throws for invalid PORT values: %s", async (_caseName, value) => {
    await expect(loadEnv({ PORT: value })).rejects.toThrow(
      "PORT must be an integer between 1 and 65535",
    );
  });

  it("parses valid refresh interval and PostgreSQL settings", async () => {
    const { env } = await loadEnv({
      PULSE_REFRESH_INTERVAL_MS: "15000",
      AVAILABILITY_WINDOW_SECONDS: "3600",
      DATABASE_URL: "postgres://user:pass@localhost:5432/pulse",
    });

    expect(env.refreshIntervalMs).toBe(15_000);
    expect(env.availabilityWindowSeconds).toBe(3_600);
    expect(env.databaseUrl).toBe("postgres://user:pass@localhost:5432/pulse");
  });

  it.each([
    [
      "PULSE_REFRESH_INTERVAL_MS",
      {
        PULSE_REFRESH_INTERVAL_MS: "0",
        DATABASE_URL: "postgres://localhost/db",
      },
      "PULSE_REFRESH_INTERVAL_MS must be a positive integer",
    ],
    [
      "AVAILABILITY_WINDOW_SECONDS",
      {
        AVAILABILITY_WINDOW_SECONDS: "-5",
        DATABASE_URL: "postgres://localhost/db",
      },
      "AVAILABILITY_WINDOW_SECONDS must be a positive integer",
    ],
    ["DATABASE_URL missing", { DATABASE_URL: "" }, "DATABASE_URL is required"],
  ])(
    "throws for invalid configuration: %s",
    async (_caseName, overrides, message) => {
      await expect(loadEnv(overrides)).rejects.toThrow(message);
    },
  );

  it.each(["development", "test", "production"])(
    "allows NODE_ENV=%s",
    async (nodeEnv) => {
      const { env } = await loadEnv({ NODE_ENV: nodeEnv });

      expect(env.nodeEnv).toBe(nodeEnv);
    },
  );

  it("falls back to development for unsupported NODE_ENV values", async () => {
    const { env } = await loadEnv({ NODE_ENV: "staging" });

    expect(env.nodeEnv).toBe("development");
  });

  it("provides snapshot defaults", async () => {
    const { env } = await loadEnv();

    expect(env.snapshotEnabled).toBe(false);
    expect(env.snapshotPath).toMatch(
      /apps\/server\/data\/pulse-snapshot\.sqlite$/,
    );
    expect(env.reconcileSeconds).toBe(120);
    expect(env.bootstrapBatchSize).toBe(1_000);
  });

  it("accepts custom snapshot env values", async () => {
    const { env } = await loadEnv({
      PULSE_SNAPSHOT_ENABLED: "yes",
      PULSE_SNAPSHOT_PATH: "/tmp/custom.sqlite",
      PULSE_RECONCILE_SECONDS: "300",
      PULSE_BOOTSTRAP_BATCH_SIZE: "2000",
    });

    expect(env.snapshotEnabled).toBe(true);
    expect(env.snapshotPath).toBe("/tmp/custom.sqlite");
    expect(env.reconcileSeconds).toBe(300);
    expect(env.bootstrapBatchSize).toBe(2_000);
  });

  it.each(["true", "1", "yes", "on"])(
    "accepts truthy PULSE_SNAPSHOT_ENABLED value: %s",
    async (value) => {
      const { env } = await loadEnv({ PULSE_SNAPSHOT_ENABLED: value });

      expect(env.snapshotEnabled).toBe(true);
    },
  );

  it.each(["false", "0", "no", "off"])(
    "accepts falsy PULSE_SNAPSHOT_ENABLED value: %s",
    async (value) => {
      const { env } = await loadEnv({ PULSE_SNAPSHOT_ENABLED: value });

      expect(env.snapshotEnabled).toBe(false);
    },
  );

  it("rejects non-boolean PULSE_SNAPSHOT_ENABLED", async () => {
    await expect(loadEnv({ PULSE_SNAPSHOT_ENABLED: "maybe" })).rejects.toThrow(
      "PULSE_SNAPSHOT_ENABLED must be boolean-like",
    );
  });

  it.each([
    ["PULSE_RECONCILE_SECONDS", { PULSE_RECONCILE_SECONDS: "0" }],
    ["PULSE_BOOTSTRAP_BATCH_SIZE", { PULSE_BOOTSTRAP_BATCH_SIZE: "-10" }],
    ["PULSE_RECONCILE_SECONDS", { PULSE_RECONCILE_SECONDS: "abc" }],
    ["PULSE_BOOTSTRAP_BATCH_SIZE", { PULSE_BOOTSTRAP_BATCH_SIZE: "12.5" }],
  ])("rejects invalid snapshot numeric value: %s", async (_name, envVars) => {
    await expect(loadEnv(envVars as NodeJS.ProcessEnv)).rejects.toThrow(
      /must be (a positive integer|an integer)/,
    );
  });
});
