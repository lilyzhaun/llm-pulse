export const SCHEMA_VERSION = 1;

export const META_KEYS = {
  SCHEMA_VERSION: "schema_version",
  BUCKET_SECONDS: "bucket_seconds",
  BUCKET_LIMIT: "bucket_limit",
  RECONCILE_SECONDS: "reconcile_seconds",
  COVERED_UNTIL_CREATED_AT: "covered_until_created_at",
  COVERED_UNTIL_ID: "covered_until_id",
  BOOTSTRAP_COMPLETED_AT: "bootstrap_completed_at",
  LAST_REFRESH_AT: "last_refresh_at",
  LAST_SUCCESS_AT: "last_success_at",
} as const;

/**
 * SQLite PRAGMA settings applied on every open. Order matters:
 * journal_mode must be set before any writes.
 */
export const PRAGMA_STATEMENTS: readonly string[] = [
  "PRAGMA journal_mode = WAL",
  "PRAGMA synchronous = NORMAL",
  "PRAGMA busy_timeout = 5000",
  "PRAGMA foreign_keys = ON",
  "PRAGMA temp_store = MEMORY",
];

/**
 * Idempotent DDL run on every open. Token column names mirror the
 * raw `logs` table (prompt_tokens, cache_tokens, completion_tokens)
 * to keep accumulation arithmetic obvious; API-level renaming to
 * inputTokens/cacheInputTokens/outputTokens happens in responseBuilder.
 */
export const DDL_STATEMENTS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS snapshot_meta (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL
	)`,
  `CREATE TABLE IF NOT EXISTS enabled_models (
		model_name TEXT PRIMARY KEY,
		updated_at INTEGER NOT NULL
	)`,
  `CREATE TABLE IF NOT EXISTS model_buckets (
		model_name TEXT NOT NULL,
		bucket_start INTEGER NOT NULL,
		success_count INTEGER NOT NULL DEFAULT 0,
		error_count INTEGER NOT NULL DEFAULT 0,
		total_count INTEGER NOT NULL DEFAULT 0,
		latency_sum_seconds REAL NOT NULL DEFAULT 0,
		latency_samples INTEGER NOT NULL DEFAULT 0,
		prompt_tokens INTEGER NOT NULL DEFAULT 0,
		cache_tokens INTEGER NOT NULL DEFAULT 0,
		completion_tokens INTEGER NOT NULL DEFAULT 0,
		quota_sum REAL NOT NULL DEFAULT 0,
		last_seen_at INTEGER,
		PRIMARY KEY (model_name, bucket_start)
	)`,
  `CREATE INDEX IF NOT EXISTS idx_model_buckets_time
		ON model_buckets (model_name, bucket_start DESC)`,
  `CREATE TABLE IF NOT EXISTS channel_buckets (
		model_name TEXT NOT NULL,
		channel_id INTEGER NOT NULL,
		channel_name TEXT NOT NULL,
		bucket_start INTEGER NOT NULL,
		success_count INTEGER NOT NULL DEFAULT 0,
		error_count INTEGER NOT NULL DEFAULT 0,
		total_count INTEGER NOT NULL DEFAULT 0,
		latency_sum_seconds REAL NOT NULL DEFAULT 0,
		latency_samples INTEGER NOT NULL DEFAULT 0,
		prompt_tokens INTEGER NOT NULL DEFAULT 0,
		cache_tokens INTEGER NOT NULL DEFAULT 0,
		completion_tokens INTEGER NOT NULL DEFAULT 0,
		quota_sum REAL NOT NULL DEFAULT 0,
		last_seen_at INTEGER,
		PRIMARY KEY (model_name, channel_id, channel_name, bucket_start)
	)`,
  `CREATE INDEX IF NOT EXISTS idx_channel_buckets_time
		ON channel_buckets (model_name, bucket_start DESC)`,
  `CREATE TABLE IF NOT EXISTS processed_logs (
		log_id INTEGER PRIMARY KEY,
		created_at INTEGER NOT NULL,
		bucket_start INTEGER NOT NULL
	)`,
  `CREATE INDEX IF NOT EXISTS idx_processed_logs_created
		ON processed_logs (created_at)`,
];
