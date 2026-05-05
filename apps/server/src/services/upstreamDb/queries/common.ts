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

export const MINUTE_BUCKET_INDEX_SQL =
  `FLOOR(logs.created_at::numeric / ${MINUTE_SECONDS})`;
export const MINUTE_BUCKET_START_SQL =
  `FLOOR(logs.created_at::numeric / ${MINUTE_SECONDS}) * ${MINUTE_SECONDS}`;
