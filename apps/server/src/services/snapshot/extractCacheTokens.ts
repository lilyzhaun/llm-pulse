export const CACHE_TOKENS_PATTERN =
  /"cache_tokens"\s*:\s*"?(-?\d+(?:\.\d+)?)"?/;

export const extractCacheTokens = (
  other: string | null | undefined,
): number => {
  if (!other?.trim()) {
    return 0;
  }

  try {
    const parsed = JSON.parse(other) as { cache_tokens?: unknown };
    const value = Number(parsed.cache_tokens);
    if (Number.isFinite(value)) {
      return value;
    }
  } catch {
    // fall through to regex fallback
  }

  const match = other.match(CACHE_TOKENS_PATTERN);
  if (!match) {
    return 0;
  }

  const value = Number(match[1]);
  return Number.isFinite(value) ? value : 0;
};
