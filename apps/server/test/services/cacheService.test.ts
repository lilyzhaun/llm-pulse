import { describe, expect, it } from "vitest";
import { CacheService } from "../../src/services/cacheService.js";

describe("CacheService", () => {
  it("returns a value after it is set", () => {
    const service = new CacheService();

    service.set("pulse", { status: "ok" });

    expect(service.get<{ status: string }>("pulse")).toEqual({ status: "ok" });
  });

  it("returns undefined for a missing key", () => {
    const service = new CacheService();

    expect(service.get("missing")).toBeUndefined();
  });

  it("does not return stored values after clear", () => {
    const service = new CacheService();
    service.set("pulse", "cached");

    service.clear();

    expect(service.get("pulse")).toBeUndefined();
  });

  it("reads different value types with generic callers", () => {
    const service = new CacheService();
    service.set("count", 3);
    service.set("model", { name: "gpt-4o-mini", available: true });

    expect(service.get<number>("count")).toBe(3);
    expect(service.get<{ name: string; available: boolean }>("model")).toEqual({
      name: "gpt-4o-mini",
      available: true,
    });
  });
});
