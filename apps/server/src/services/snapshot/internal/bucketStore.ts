import type Database from "better-sqlite3";
import type {
  ChannelBucketRow,
  ModelBucketRow,
  NormalizedLog,
} from "../types.js";

interface ModelBucketSqlRow {
  model_name: string;
  bucket_start: number;
  success_count: number;
  error_count: number;
  total_count: number;
  latency_sum_seconds: number;
  latency_samples: number;
  prompt_tokens: number;
  cache_tokens: number;
  completion_tokens: number;
  quota_sum: number;
  last_seen_at: number | null;
}

interface ChannelBucketSqlRow extends ModelBucketSqlRow {
  channel_id: number;
  channel_name: string;
}

interface BucketStartRow {
  bucket_start: number;
}

const UPSERT_MODEL_BUCKET_SQL = `
  INSERT INTO model_buckets (
    model_name, bucket_start,
    success_count, error_count, total_count,
    latency_sum_seconds, latency_samples,
    prompt_tokens, cache_tokens, completion_tokens,
    quota_sum, last_seen_at
  ) VALUES (
    @modelName, @bucketStart,
    @successDelta, @errorDelta, @totalDelta,
    @latencyDelta, @latencySamplesDelta,
    @promptDelta, @cacheDelta, @completionDelta,
    @quotaDelta, @lastSeenAt
  )
  ON CONFLICT (model_name, bucket_start) DO UPDATE SET
    success_count = success_count + excluded.success_count,
    error_count = error_count + excluded.error_count,
    total_count = total_count + excluded.total_count,
    latency_sum_seconds = latency_sum_seconds + excluded.latency_sum_seconds,
    latency_samples = latency_samples + excluded.latency_samples,
    prompt_tokens = prompt_tokens + excluded.prompt_tokens,
    cache_tokens = cache_tokens + excluded.cache_tokens,
    completion_tokens = completion_tokens + excluded.completion_tokens,
    quota_sum = quota_sum + excluded.quota_sum,
    last_seen_at = MAX(COALESCE(last_seen_at, 0), COALESCE(excluded.last_seen_at, 0))
`;

const UPSERT_CHANNEL_BUCKET_SQL = `
  INSERT INTO channel_buckets (
    model_name, channel_id, channel_name, bucket_start,
    success_count, error_count, total_count,
    latency_sum_seconds, latency_samples,
    prompt_tokens, cache_tokens, completion_tokens,
    quota_sum, last_seen_at
  ) VALUES (
    @modelName, @channelId, @channelName, @bucketStart,
    @successDelta, @errorDelta, @totalDelta,
    @latencyDelta, @latencySamplesDelta,
    @promptDelta, @cacheDelta, @completionDelta,
    @quotaDelta, @lastSeenAt
  )
  ON CONFLICT (model_name, channel_id, channel_name, bucket_start) DO UPDATE SET
    success_count = success_count + excluded.success_count,
    error_count = error_count + excluded.error_count,
    total_count = total_count + excluded.total_count,
    latency_sum_seconds = latency_sum_seconds + excluded.latency_sum_seconds,
    latency_samples = latency_samples + excluded.latency_samples,
    prompt_tokens = prompt_tokens + excluded.prompt_tokens,
    cache_tokens = cache_tokens + excluded.cache_tokens,
    completion_tokens = completion_tokens + excluded.completion_tokens,
    quota_sum = quota_sum + excluded.quota_sum,
    last_seen_at = MAX(COALESCE(last_seen_at, 0), COALESCE(excluded.last_seen_at, 0))
`;

export class BucketStore {
  constructor(private readonly db: Database.Database) {}

  applyLogDelta(log: NormalizedLog): void {
    const bucketStart = Math.floor(log.createdAt / 60) * 60;
    const isSuccess = log.type === 2;
    const isError = log.type === 5;
    const isCounted = isSuccess || isError;
    const hasLatency = isCounted && log.useTimeSeconds > 0;

    const params = {
      modelName: log.modelName,
      bucketStart,
      successDelta: isSuccess ? 1 : 0,
      errorDelta: isError ? 1 : 0,
      totalDelta: isCounted ? 1 : 0,
      latencyDelta: hasLatency ? log.useTimeSeconds : 0,
      latencySamplesDelta: hasLatency ? 1 : 0,
      promptDelta: isSuccess ? log.promptTokens : 0,
      cacheDelta: isSuccess ? log.cacheTokens : 0,
      completionDelta: isSuccess ? log.completionTokens : 0,
      quotaDelta: isCounted ? log.quota : 0,
      lastSeenAt: log.createdAt,
    };

    this.db.prepare(UPSERT_MODEL_BUCKET_SQL).run(params);
    this.db.prepare(UPSERT_CHANNEL_BUCKET_SQL).run({
      ...params,
      channelId: log.channelId,
      channelName: log.channelName,
    });
  }

  pruneOldBuckets(modelName: string, keepCount = 60): void {
    const recent = this.db
      .prepare<[string, number], BucketStartRow>(
        "SELECT bucket_start FROM model_buckets WHERE model_name = ? ORDER BY bucket_start DESC LIMIT ?",
      )
      .all(modelName, keepCount);

    if (recent.length < keepCount) {
      return;
    }

    const oldestRow = recent.at(-1);
    if (!oldestRow) {
      return;
    }

    const oldest = oldestRow.bucket_start;
    this.db
      .prepare(
        "DELETE FROM model_buckets WHERE model_name = ? AND bucket_start < ?",
      )
      .run(modelName, oldest);
    this.db
      .prepare(
        "DELETE FROM channel_buckets WHERE model_name = ? AND bucket_start < ?",
      )
      .run(modelName, oldest);
  }

  readModelRows(): Map<string, ModelBucketRow[]> {
    const rows = this.db
      .prepare<[], ModelBucketSqlRow>(
        `SELECT model_name, bucket_start, success_count, error_count, total_count,
          latency_sum_seconds, latency_samples,
          prompt_tokens, cache_tokens, completion_tokens,
          quota_sum, last_seen_at
        FROM model_buckets
        ORDER BY model_name ASC, bucket_start DESC`,
      )
      .all();

    const models = new Map<string, ModelBucketRow[]>();
    for (const row of rows) {
      const list = models.get(row.model_name) ?? [];
      list.push({
        modelName: row.model_name,
        bucketStart: row.bucket_start,
        successCount: row.success_count,
        errorCount: row.error_count,
        totalCount: row.total_count,
        latencySumSeconds: row.latency_sum_seconds,
        latencySamples: row.latency_samples,
        promptTokens: row.prompt_tokens,
        cacheTokens: row.cache_tokens,
        completionTokens: row.completion_tokens,
        quotaSum: row.quota_sum,
        lastSeenAt: row.last_seen_at,
      });
      models.set(row.model_name, list);
    }

    return models;
  }

  readChannelRows(): Map<string, ChannelBucketRow[]> {
    const rows = this.db
      .prepare<[], ChannelBucketSqlRow>(
        `SELECT model_name, channel_id, channel_name, bucket_start,
          success_count, error_count, total_count,
          latency_sum_seconds, latency_samples,
          prompt_tokens, cache_tokens, completion_tokens,
          quota_sum, last_seen_at
        FROM channel_buckets
        ORDER BY model_name ASC, channel_id ASC, channel_name ASC, bucket_start DESC`,
      )
      .all();

    const channels = new Map<string, ChannelBucketRow[]>();
    for (const row of rows) {
      const list = channels.get(row.model_name) ?? [];
      list.push({
        modelName: row.model_name,
        channelId: row.channel_id,
        channelName: row.channel_name,
        bucketStart: row.bucket_start,
        successCount: row.success_count,
        errorCount: row.error_count,
        totalCount: row.total_count,
        latencySumSeconds: row.latency_sum_seconds,
        latencySamples: row.latency_samples,
        promptTokens: row.prompt_tokens,
        cacheTokens: row.cache_tokens,
        completionTokens: row.completion_tokens,
        quotaSum: row.quota_sum,
        lastSeenAt: row.last_seen_at,
      });
      channels.set(row.model_name, list);
    }

    return channels;
  }
}
