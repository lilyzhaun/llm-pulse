import { describe, expect, it } from "vitest";
import { extractCacheTokens } from "../../../src/services/snapshot/extractCacheTokens.js";

describe("extractCacheTokens", () => {
  it("returns 0 for empty values", () => {
    expect(extractCacheTokens(null)).toBe(0);
    expect(extractCacheTokens(undefined)).toBe(0);
    expect(extractCacheTokens("   ")).toBe(0);
  });

  it("reads numeric cache_tokens from JSON", () => {
    expect(extractCacheTokens('{"cache_tokens":123}')).toBe(123);
    expect(extractCacheTokens('{"cache_tokens":"456"}')).toBe(456);
    expect(extractCacheTokens('{"cache_tokens":-7}')).toBe(-7);
  });

  it("falls back to regex for malformed JSON", () => {
    expect(extractCacheTokens('{"cache_tokens":42')).toBe(42);
    expect(extractCacheTokens('prefix "cache_tokens": "99" suffix')).toBe(99);
  });

  it("returns 0 when cache_tokens is absent or non-finite", () => {
    expect(extractCacheTokens('{"other":1}')).toBe(0);
    expect(extractCacheTokens('{"cache_tokens":"abc"}')).toBe(0);
    expect(extractCacheTokens('{"cache_tokens":null}')).toBe(0);
  });
});
