import type { QueryResult } from "pg";
import { upstreamPool } from "../pool.js";
import type { UpstreamQueryClient } from "./modelAggregates.js";

export interface HeartbeatBucketRow {
  model_name: string;
  bucket_start: string | number;
  success_count: string | number;
  error_count: string | number;
  total_count: string | number;
  latency_avg_seconds: string | number | null;
}

export interface UpstreamHeartbeatBucket {
  modelName: string;
  bucketStartMs: number;
  successCount: number;
  errorCount: number;
  totalCount: number;
  latencyAvgSeconds: number | null;
}

const toNumber = (value: string | number): number => Number(value);
const toNullableNumber = (value: string | number | null): number | null =>
  value === null ? null : Number(value);

const MINUTE_SECONDS = 60;
const BUCKET_LIMIT = 60;

export const HEARTBEAT_SQL = `
WITH bucketed_logs AS (
  SELECT
    logs.model_name,
    logs.type,
    COALESCE(logs.use_time, 0) AS use_time,
    FLOOR(logs.created_at::numeric / ${MINUTE_SECONDS}) * ${MINUTE_SECONDS} AS bucket_start
  FROM logs
  WHERE logs.created_at < $1::bigint
    AND logs.type IN (2, 5)
    AND logs.model_name IS NOT NULL
    AND logs.model_name <> ''
), ranked_buckets AS (
  SELECT
    model_name,
    bucket_start,
    ROW_NUMBER() OVER (
      PARTITION BY model_name
      ORDER BY bucket_start DESC
    ) AS bucket_rank
  FROM (
    SELECT DISTINCT model_name, bucket_start
    FROM bucketed_logs
  ) distinct_buckets
), scoped_logs AS (
  SELECT bucketed_logs.*
  FROM bucketed_logs
  JOIN ranked_buckets
    ON ranked_buckets.model_name = bucketed_logs.model_name
   AND ranked_buckets.bucket_start = bucketed_logs.bucket_start
  WHERE ranked_buckets.bucket_rank <= ${BUCKET_LIMIT}
)
SELECT
  scoped_logs.model_name,
  scoped_logs.bucket_start,
  COUNT(*) FILTER (WHERE scoped_logs.type = 2) AS success_count,
  COUNT(*) FILTER (WHERE scoped_logs.type = 5) AS error_count,
  COUNT(*) FILTER (WHERE scoped_logs.type IN (2, 5)) AS total_count,
  AVG(scoped_logs.use_time) FILTER (
    WHERE scoped_logs.type IN (2, 5) AND scoped_logs.use_time > 0
  ) AS latency_avg_seconds
FROM scoped_logs
GROUP BY scoped_logs.model_name, scoped_logs.bucket_start
ORDER BY scoped_logs.bucket_start ASC, scoped_logs.model_name ASC
`;

export const mapHeartbeatBucketRow = (
  row: HeartbeatBucketRow,
): UpstreamHeartbeatBucket => ({
  modelName: row.model_name,
  bucketStartMs: toNumber(row.bucket_start) * 1000,
  successCount: toNumber(row.success_count),
  errorCount: toNumber(row.error_count),
  totalCount: toNumber(row.total_count),
  latencyAvgSeconds: toNullableNumber(row.latency_avg_seconds),
});

export const getHeartbeatBuckets = async (
  toEpochSeconds: number,
  client: UpstreamQueryClient = upstreamPool,
): Promise<UpstreamHeartbeatBucket[]> => {
  const result: QueryResult<HeartbeatBucketRow> = await client.query(
    HEARTBEAT_SQL,
    [toEpochSeconds],
  );
  return result.rows.map(mapHeartbeatBucketRow);
};
