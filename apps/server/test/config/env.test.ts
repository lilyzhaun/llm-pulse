import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type EnvModule = typeof import("../../src/config/env.js");

const ORIGINAL_ENV = process.env;

const loadEnv = async (
  overrides: NodeJS.ProcessEnv = {},
): Promise<EnvModule> => {
  vi.resetModules();
  process.env = { ...overrides };

  return import("../../src/config/env.js");
};

describe("env config", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = {};
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.resetModules();
  });

  it("falls back to default values for PORT, BFF_PORT, and NODE_ENV", async () => {
    const { env } = await loadEnv();

    expect(env.port).toBe(3001);
    expect(env.nodeEnv).toBe("development");
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

  it("parses valid positive integer configuration values", async () => {
    const { env } = await loadEnv({
      POLL_INTERVAL_MS: "15000",
      LOG_PAGE_SIZE: "100",
    });

    expect(env.pollIntervalMs).toBe(15_000);
    expect(env.logPageSize).toBe(100);
  });

  it.each([
    [
      "POLL_INTERVAL_MS",
      { POLL_INTERVAL_MS: "0" },
      "POLL_INTERVAL_MS must be a positive integer",
    ],
    [
      "LOG_PAGE_SIZE",
      { LOG_PAGE_SIZE: "-5" },
      "LOG_PAGE_SIZE must be a positive integer",
    ],
    [
      "LOG_PAGE_SIZE decimal",
      { LOG_PAGE_SIZE: "10.5" },
      "LOG_PAGE_SIZE must be an integer",
    ],
  ])(
    "throws for invalid positive integer config: %s",
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
});
