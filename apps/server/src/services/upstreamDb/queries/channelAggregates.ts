import type { QueryResult } from "pg";
import { upstreamPool } from "../pool.js";
import type { UpstreamQueryClient } from "./modelAggregates.js";

export interface ChannelAggregateRow {
  model_name: string;
  channel_id: string | number | null;
  channel_name: string | null;
  total_count: string | number;
  success_count: string | number;
  error_count: string | number;
  latency_avg_seconds: string | number | null;
  last_seen_at: string | number | null;
}

export interface ChannelAggregate {
  modelName: string;
  channelId: number;
  channelName: string;
  totalCount: number;
  successCount: number;
  errorCount: number;
  latencyAvgSeconds: number | null;
  lastSeenAtMs: number | null;
}

const toNumber = (value: string | number | null): number =>
  value === null ? 0 : Number(value);
const toNullableNumber = (value: string | number | null): number | null =>
  value === null ? null : Number(value);

const MINUTE_SECONDS = 60;
const BUCKET_LIMIT = 60;

export const CHANNEL_AGGREGATES_SQL = `
WITH bucketed_logs AS (
  SELECT
    logs.model_name,
    logs.channel_id,
    logs.channel_name,
    logs.type,
    COALESCE(logs.use_time, 0) AS use_time,
    logs.created_at,
    FLOOR(logs.created_at::numeric / ${MINUTE_SECONDS}) AS minute_bucket
  FROM logs
  WHERE logs.created_at < $1::bigint
    AND logs.type IN (2, 5)
    AND logs.model_name IS NOT NULL
    AND logs.model_name <> ''
    AND EXISTS (
      SELECT 1
      FROM abilities
      WHERE abilities.model = logs.model_name
        AND abilities.enabled = true
    )
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
)
SELECT
  scoped_logs.model_name,
  COALESCE(scoped_logs.channel_id, 0) AS channel_id,
  COALESCE(NULLIF(scoped_logs.channel_name, ''), 'unknown') AS channel_name,
  COUNT(*) AS total_count,
  COUNT(*) FILTER (WHERE scoped_logs.type = 2) AS success_count,
  COUNT(*) FILTER (WHERE scoped_logs.type = 5) AS error_count,
  AVG(scoped_logs.use_time) FILTER (
    WHERE scoped_logs.type IN (2, 5) AND scoped_logs.use_time > 0
  ) AS latency_avg_seconds,
  MAX(scoped_logs.created_at) AS last_seen_at
FROM scoped_logs
GROUP BY
  scoped_logs.model_name,
  COALESCE(scoped_logs.channel_id, 0),
  COALESCE(NULLIF(scoped_logs.channel_name, ''), 'unknown')
ORDER BY scoped_logs.model_name ASC, last_seen_at DESC, channel_name ASC
`;

export const mapChannelAggregateRow = (
  row: ChannelAggregateRow,
): ChannelAggregate => ({
  modelName: row.model_name,
  channelId: toNumber(row.channel_id),
  channelName: row.channel_name ?? "unknown",
  totalCount: toNumber(row.total_count),
  successCount: toNumber(row.success_count),
  errorCount: toNumber(row.error_count),
  latencyAvgSeconds: toNullableNumber(row.latency_avg_seconds),
  lastSeenAtMs:
    row.last_seen_at === null ? null : toNumber(row.last_seen_at) * 1000,
});

export const getChannelAggregates = async (
  toEpochSeconds: number,
  client: UpstreamQueryClient = upstreamPool,
): Promise<ChannelAggregate[]> => {
  const result: QueryResult<ChannelAggregateRow> = await client.query(
    CHANNEL_AGGREGATES_SQL,
    [toEpochSeconds],
  );
  return result.rows.map(mapChannelAggregateRow);
};
