import { extractCacheTokens } from "./extractCacheTokens.js";
import type { NormalizedLog } from "./types.js";

export interface RawLogRow {
  id: number | string;
  created_at: number | string;
  type: number | string;
  model_name: string | null;
  channel_id: number | string | null;
  channel_name: string | null;
  prompt_tokens: number | string | null;
  completion_tokens: number | string | null;
  quota: number | string | null;
  use_time: number | string | null;
  other?: string | null;
}

const toFiniteNumber = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toRequiredString = (value: unknown, fallback: string): string => {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed || fallback;
};

export const normalizeLogRow = (row: RawLogRow): NormalizedLog => ({
  id: Math.trunc(toFiniteNumber(row.id)),
  createdAt: Math.trunc(toFiniteNumber(row.created_at)),
  type: Math.trunc(toFiniteNumber(row.type)),
  modelName: toRequiredString(row.model_name, ""),
  channelId: Math.trunc(toFiniteNumber(row.channel_id)),
  channelName: toRequiredString(row.channel_name, "unknown"),
  promptTokens: Math.trunc(toFiniteNumber(row.prompt_tokens)),
  cacheTokens: Math.trunc(extractCacheTokens(row.other)),
  completionTokens: Math.trunc(toFiniteNumber(row.completion_tokens)),
  quota: toFiniteNumber(row.quota),
  useTimeSeconds: toFiniteNumber(row.use_time),
});
