import {
  HEARTBEAT_BUCKET_COUNT,
  HEARTBEAT_BUCKET_SECONDS,
} from "../../../config/constants.js";

export const MINUTE_SECONDS = HEARTBEAT_BUCKET_SECONDS;
export const BUCKET_LIMIT = HEARTBEAT_BUCKET_COUNT;

export const REQUEST_LOG_FILTER_SQL = `
  logs.created_at < $1::bigint
    AND logs.type IN (2, 5)
    AND logs.model_name IS NOT NULL
    AND logs.model_name <> ''
    AND EXISTS (
      SELECT 1
      FROM abilities
      WHERE abilities.model = logs.model_name
        AND abilities.enabled = true
    )
`;

export const MINUTE_BUCKET_INDEX_SQL = `FLOOR(logs.created_at::numeric / ${MINUTE_SECONDS})`;
export const MINUTE_BUCKET_START_SQL = `FLOOR(logs.created_at::numeric / ${MINUTE_SECONDS}) * ${MINUTE_SECONDS}`;

export const RANKED_BUCKETS_CTE = (bucketColumnName: string): string => `
), ranked_buckets AS (
  SELECT
    model_name,
    ${bucketColumnName},
    ROW_NUMBER() OVER (
      PARTITION BY model_name
      ORDER BY ${bucketColumnName} DESC
    ) AS bucket_rank
  FROM (
    SELECT DISTINCT model_name, ${bucketColumnName}
    FROM bucketed_logs
  ) distinct_buckets
`;

export const SCOPED_LOGS_CTE = (bucketColumnName: string): string => `
), scoped_logs AS (
  SELECT bucketed_logs.*
  FROM bucketed_logs
  JOIN ranked_buckets
    ON ranked_buckets.model_name = bucketed_logs.model_name
   AND ranked_buckets.${bucketColumnName} = bucketed_logs.${bucketColumnName}
  WHERE ranked_buckets.bucket_rank <= ${BUCKET_LIMIT}
`;
