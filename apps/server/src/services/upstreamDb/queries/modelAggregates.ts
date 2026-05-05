import type { QueryResult, QueryResultRow } from "pg";
import { upstreamPool } from "../pool.js";
import {
  BUCKET_LIMIT,
  MINUTE_BUCKET_INDEX_SQL,
  REQUEST_LOG_FILTER_SQL,
} from "./common.js";
import { CACHE_TOKENS_SQL } from "./safeJsonExtract.js";

export interface UpstreamQueryClient {
  query<T extends QueryResultRow>(
    text: string,
    values: readonly unknown[],
  ): Promise<QueryResult<T>>;
}

export interface ModelAggregateRow {
  model_name: string;
  total_count: string | number;
  success_count: string | number;
  error_count: string | number;
  latency_avg_seconds: string | number | null;
  last_seen_at: string | number | Date | null;
  input_tokens: string | number | null;
  cache_input_tokens: string | number | null;
  output_tokens: string | number | null;
  quota_sum: string | number | null;
  rpm_avg: string | number | null;
  rpm_peak: string | number | null;
  tpm_avg: string | number | null;
  tpm_peak: string | number | null;
}

export interface ModelAggregate {
  modelName: string;
  totalCount: number;
  successCount: number;
  errorCount: number;
  latencyAvgSeconds: number | null;
  lastSeenAtMs: number | null;
  inputTokens: number;
  cacheInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  quotaSum: number;
  rpmAvg: number;
  rpmPeak: number;
  tpmAvg: number;
  tpmPeak: number;
}

const toFiniteNumber = (value: string | number | null): number => {
  if (value === null) {
    return 0;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toNullableFiniteNumber = (
  value: string | number | null,
): number | null => {
  if (value === null) {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toEpochMs = (value: string | number | Date | null): number | null => {
  if (value === null) {
    return null;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed * 1000 : null;
};

export const mapModelAggregateRow = (
  row: ModelAggregateRow,
): ModelAggregate => {
  const inputTokens = toFiniteNumber(row.input_tokens);
  const cacheInputTokens = toFiniteNumber(row.cache_input_tokens);
  const outputTokens = toFiniteNumber(row.output_tokens);

  return {
    modelName: row.model_name,
    totalCount: toFiniteNumber(row.total_count),
    successCount: toFiniteNumber(row.success_count),
    errorCount: toFiniteNumber(row.error_count),
    latencyAvgSeconds: toNullableFiniteNumber(row.latency_avg_seconds),
    lastSeenAtMs: toEpochMs(row.last_seen_at),
    inputTokens,
    cacheInputTokens,
    outputTokens,
    totalTokens: inputTokens + cacheInputTokens + outputTokens,
    quotaSum: toFiniteNumber(row.quota_sum),
    rpmAvg: toFiniteNumber(row.rpm_avg),
    rpmPeak: toFiniteNumber(row.rpm_peak),
    tpmAvg: toFiniteNumber(row.tpm_avg),
    tpmPeak: toFiniteNumber(row.tpm_peak),
  };
};

export const MODEL_AGGREGATES_SQL = `
WITH bucketed_logs AS (
  SELECT
    logs.model_name,
    logs.type,
    COALESCE(logs.use_time, 0) AS use_time,
    logs.created_at,
    COALESCE(logs.prompt_tokens, 0) AS prompt_tokens,
    COALESCE(logs.completion_tokens, 0) AS completion_tokens,
    COALESCE(logs.quota, 0) AS quota,
    ${CACHE_TOKENS_SQL} AS cache_tokens,
    ${MINUTE_BUCKET_INDEX_SQL} AS minute_bucket
  FROM logs
  WHERE ${REQUEST_LOG_FILTER_SQL}
), ranked_buckets AS (
  SELECT
    model_name,
    minute_bucket,
    ROW_NUMBER() OVER (
      PARTITION BY model_name
      ORDER BY minute_bucket DESC
    ) AS bucket_rank
  FROM (
    SELECT DISTINCT model_name, minute_bucket
    FROM bucketed_logs
  ) distinct_buckets
), scoped_logs AS (
  SELECT bucketed_logs.*
  FROM bucketed_logs
  JOIN ranked_buckets
    ON ranked_buckets.model_name = bucketed_logs.model_name
   AND ranked_buckets.minute_bucket = bucketed_logs.minute_bucket
  WHERE ranked_buckets.bucket_rank <= ${BUCKET_LIMIT}
), bucket_counts AS (
  SELECT
    model_name,
    COUNT(*) AS bucket_count
  FROM ranked_buckets
  WHERE bucket_rank <= ${BUCKET_LIMIT}
  GROUP BY model_name
), model_totals AS (
  SELECT
    model_name,
    COUNT(*) AS total_count,
    COUNT(*) FILTER (WHERE type = 2) AS success_count,
    COUNT(*) FILTER (WHERE type = 5) AS error_count,
    AVG(use_time) FILTER (WHERE type IN (2, 5) AND use_time > 0) AS latency_avg_seconds,
    MAX(created_at) AS last_seen_at,
    SUM(prompt_tokens) FILTER (WHERE type = 2) AS input_tokens,
    SUM(cache_tokens) FILTER (WHERE type = 2) AS cache_input_tokens,
    SUM(completion_tokens) FILTER (WHERE type = 2) AS output_tokens,
    SUM(quota) AS quota_sum
  FROM scoped_logs
  GROUP BY model_name
), minute_totals AS (
  SELECT
    model_name,
    minute_bucket,
    COUNT(*) AS rpm,
    SUM(prompt_tokens + completion_tokens + cache_tokens) FILTER (WHERE type = 2) AS tpm
  FROM scoped_logs
  GROUP BY model_name, minute_bucket
), rate_totals AS (
  SELECT
    model_name,
    MAX(rpm) AS rpm_peak,
    MAX(COALESCE(tpm, 0)) AS tpm_peak
  FROM minute_totals
  GROUP BY model_name
)
SELECT
  model_totals.model_name,
  model_totals.total_count,
  model_totals.success_count,
  model_totals.error_count,
  model_totals.latency_avg_seconds,
  model_totals.last_seen_at,
  COALESCE(model_totals.input_tokens, 0) AS input_tokens,
  COALESCE(model_totals.cache_input_tokens, 0) AS cache_input_tokens,
  COALESCE(model_totals.output_tokens, 0) AS output_tokens,
  COALESCE(model_totals.quota_sum, 0) AS quota_sum,
  model_totals.total_count::numeric
    / GREATEST(bucket_counts.bucket_count::numeric, 1) AS rpm_avg,
  COALESCE(rate_totals.rpm_peak, 0) AS rpm_peak,
  (
    COALESCE(model_totals.input_tokens, 0)
    + COALESCE(model_totals.cache_input_tokens, 0)
    + COALESCE(model_totals.output_tokens, 0)
  ) / GREATEST(bucket_counts.bucket_count::numeric, 1) AS tpm_avg,
  COALESCE(rate_totals.tpm_peak, 0) AS tpm_peak
FROM model_totals
JOIN bucket_counts ON bucket_counts.model_name = model_totals.model_name
LEFT JOIN rate_totals ON rate_totals.model_name = model_totals.model_name
ORDER BY model_totals.last_seen_at DESC, model_totals.model_name ASC
`;

export const getModelAggregates = async (
  toEpochSeconds: number,
  client: UpstreamQueryClient = upstreamPool,
): Promise<ModelAggregate[]> => {
  const result = await client.query<ModelAggregateRow>(MODEL_AGGREGATES_SQL, [
    toEpochSeconds,
  ]);
  return result.rows.map(mapModelAggregateRow);
};
