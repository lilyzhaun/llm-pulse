import type { QueryResult } from "pg";
import { upstreamPool } from "../pool.js";
import {
  MINUTE_BUCKET_INDEX_SQL,
  RANKED_BUCKETS_CTE,
  REQUEST_LOG_FILTER_SQL,
  SCOPED_LOGS_CTE,
} from "./common.js";
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

export const CHANNEL_AGGREGATES_SQL = `
WITH bucketed_logs AS (
  SELECT
    logs.model_name,
    logs.channel_id,
    logs.channel_name,
    logs.type,
    COALESCE(logs.use_time, 0) AS use_time,
    logs.created_at,
    ${MINUTE_BUCKET_INDEX_SQL} AS minute_bucket
  FROM logs
  WHERE ${REQUEST_LOG_FILTER_SQL}
${RANKED_BUCKETS_CTE("minute_bucket")}
${SCOPED_LOGS_CTE("minute_bucket")}
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
