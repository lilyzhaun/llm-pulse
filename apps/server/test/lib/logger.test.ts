import { afterEach, describe, expect, it, vi } from "vitest";

describe("logger redaction", () => {
  const writes: string[] = [];
  const writeSpy = vi
    .spyOn(process.stdout, "write")
    .mockImplementation((chunk: string | Uint8Array) => {
      writes.push(chunk.toString());
      return true;
    });

  afterEach(() => {
    writes.length = 0;
    writeSpy.mockClear();
  });

  it("redacts sensitive top-level and nested fields while keeping safe fields intact", async () => {
    vi.resetModules();
    const { logger } = await import("../../src/lib/logger.js");

    logger.info(
      {
        authorization: "Bearer secret",
        password: "pw-123",
        token: "token-123",
        apiKey: "key-123",
        secret: "secret-123",
        keepMe: "visible",
        nested: {
          authorization: "nested-secret",
          password: "nested-password",
          token: "nested-token",
          apiKey: "nested-key",
          secret: "nested-secret-value",
          keepNested: "still-visible",
        },
        error: {
          config: {
            headers: {
              authorization: "header-secret",
              Authorization: "header-secret-upper",
              cookie: "session=abc123",
              keepHeader: "header-visible",
            },
          },
        },
      },
      "logger redact test",
    );

    const output = writes.join("");

    expect(output).toContain('"authorization":"[REDACTED]"');
    expect(output).toContain('"password":"[REDACTED]"');
    expect(output).toContain('"token":"[REDACTED]"');
    expect(output).toContain('"apiKey":"[REDACTED]"');
    expect(output).toContain('"secret":"[REDACTED]"');
    expect(output).toContain('"nested":{"authorization":"[REDACTED]"');
    expect(output).toContain(
      '"error":{"config":{"headers":{"authorization":"[REDACTED]"',
    );
    expect(output).toContain('"Authorization":"[REDACTED]"');
    expect(output).toContain('"cookie":"[REDACTED]"');
    expect(output).toContain('"keepMe":"visible"');
    expect(output).toContain('"keepNested":"still-visible"');
    expect(output).toContain('"keepHeader":"header-visible"');
  });
});
