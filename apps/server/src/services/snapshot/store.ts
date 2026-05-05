import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import {
  DDL_STATEMENTS,
  META_KEYS,
  PRAGMA_STATEMENTS,
  SCHEMA_VERSION,
} from "./schema.js";
import {
  type ChannelBucketRow,
  type ModelBucketRow,
  type NormalizedLog,
  SchemaMismatchError,
  type SnapshotData,
} from "./types.js";

interface MetaRow {
  value: string;
}

interface EnabledModelRow {
  model_name: string;
}

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

interface CountRow {
  count: number;
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

export class SnapshotStore {
  private readonly filePath: string;
  private db: Database.Database | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  open(): void {
    if (this.db) {
      return;
    }

    mkdirSync(dirname(this.filePath), { recursive: true });
    const db = new Database(this.filePath);
    this.db = db;

    for (const pragma of PRAGMA_STATEMENTS) {
      db.exec(pragma);
    }
    for (const ddl of DDL_STATEMENTS) {
      db.exec(ddl);
    }

    this.assertSchemaVersion();
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  isReady(): boolean {
    if (!this.db) {
      return false;
    }
    return this.getMeta(META_KEYS.BOOTSTRAP_COMPLETED_AT) !== null;
  }

  getMeta(key: string): string | null {
    const db = this.requireDb();
    const row = db
      .prepare<[string], MetaRow>(
        "SELECT value FROM snapshot_meta WHERE key = ?",
      )
      .get(key);
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    const db = this.requireDb();
    db.prepare(
      `INSERT INTO snapshot_meta (key, value) VALUES (?, ?)
			ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    ).run(key, value);
  }

  getEnabledModels(): string[] {
    const db = this.requireDb();
    const rows = db
      .prepare<[], EnabledModelRow>(
        "SELECT model_name FROM enabled_models ORDER BY model_name ASC",
      )
      .all();
    return rows.map((row) => row.model_name);
  }

  replaceEnabledModels(names: readonly string[]): void {
    if (names.length === 0) {
      throw new Error(
        "replaceEnabledModels rejects empty list to preserve last-known-good. Use seedEnabledModels for first-run.",
      );
    }
    const db = this.requireDb();
    const now = Math.floor(Date.now() / 1000);
    const tx = db.transaction((items: readonly string[]) => {
      db.prepare("DELETE FROM enabled_models").run();
      const insert = db.prepare(
        "INSERT INTO enabled_models (model_name, updated_at) VALUES (?, ?)",
      );
      for (const name of items) {
        insert.run(name, now);
      }
    });
    tx(names);
  }

  seedEnabledModels(names: readonly string[]): void {
    const db = this.requireDb();
    const now = Math.floor(Date.now() / 1000);
    const tx = db.transaction((items: readonly string[]) => {
      db.prepare("DELETE FROM enabled_models").run();
      const insert = db.prepare(
        "INSERT INTO enabled_models (model_name, updated_at) VALUES (?, ?)",
      );
      for (const name of items) {
        insert.run(name, now);
      }
    });
    tx(names);
  }

  applyLogDelta(log: NormalizedLog): boolean {
    const db = this.requireDb();
    const result = db
      .prepare(
        "INSERT OR IGNORE INTO processed_logs (log_id, created_at, bucket_start) VALUES (?, ?, ?)",
      )
      .run(log.id, log.createdAt, Math.floor(log.createdAt / 60) * 60);
    if (result.changes === 0) {
      return false;
    }

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

    db.prepare(UPSERT_MODEL_BUCKET_SQL).run(params);
    db.prepare(UPSERT_CHANNEL_BUCKET_SQL).run({
      ...params,
      channelId: log.channelId,
      channelName: log.channelName,
    });

    return true;
  }

  pruneOldBuckets(modelName: string, keepCount = 60): void {
    const db = this.requireDb();
    const recent = db
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
    db.prepare(
      "DELETE FROM model_buckets WHERE model_name = ? AND bucket_start < ?",
    ).run(modelName, oldest);
    db.prepare(
      "DELETE FROM channel_buckets WHERE model_name = ? AND bucket_start < ?",
    ).run(modelName, oldest);
  }

  pruneProcessedLogs(olderThan: number): void {
    const db = this.requireDb();
    db.prepare("DELETE FROM processed_logs WHERE created_at < ?").run(
      olderThan,
    );
  }

  processedLogCount(): number {
    const db = this.requireDb();
    const row = db
      .prepare<[], CountRow>("SELECT COUNT(*) AS count FROM processed_logs")
      .get();
    return row?.count ?? 0;
  }

  readSnapshot(): SnapshotData {
    const db = this.requireDb();

    const modelRows = db
      .prepare<[], ModelBucketSqlRow>(
        `SELECT model_name, bucket_start, success_count, error_count, total_count,
					latency_sum_seconds, latency_samples,
					prompt_tokens, cache_tokens, completion_tokens,
					quota_sum, last_seen_at
				FROM model_buckets
				ORDER BY model_name ASC, bucket_start DESC`,
      )
      .all();

    const channelRows = db
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

    const models = new Map<string, ModelBucketRow[]>();
    for (const row of modelRows) {
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

    const channels = new Map<string, ChannelBucketRow[]>();
    for (const row of channelRows) {
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

    const coveredCreatedAt = this.getMeta(META_KEYS.COVERED_UNTIL_CREATED_AT);
    const coveredId = this.getMeta(META_KEYS.COVERED_UNTIL_ID);

    return {
      bootstrapCompletedAt: this.getMeta(META_KEYS.BOOTSTRAP_COMPLETED_AT),
      coveredUntilCreatedAt: coveredCreatedAt ? Number(coveredCreatedAt) : null,
      coveredUntilId: coveredId ? Number(coveredId) : null,
      lastRefreshAt: this.getMeta(META_KEYS.LAST_REFRESH_AT),
      lastSuccessAt: this.getMeta(META_KEYS.LAST_SUCCESS_AT),
      enabledModels: new Set(this.getEnabledModels()),
      models,
      channels,
      processedLogCount: this.processedLogCount(),
    };
  }

  runInTransaction<T>(fn: () => T): T {
    const db = this.requireDb();
    const tx = db.transaction(fn);
    return tx();
  }

  private requireDb(): Database.Database {
    if (!this.db) {
      throw new Error("SnapshotStore is not open");
    }
    return this.db;
  }

  private assertSchemaVersion(): void {
    const stored = this.getMeta(META_KEYS.SCHEMA_VERSION);
    if (stored === null) {
      this.setMeta(META_KEYS.SCHEMA_VERSION, String(SCHEMA_VERSION));
      this.setMeta(META_KEYS.BUCKET_SECONDS, "60");
      this.setMeta(META_KEYS.BUCKET_LIMIT, "60");
      return;
    }
    const parsed = Number(stored);
    if (parsed !== SCHEMA_VERSION) {
      throw new SchemaMismatchError(SCHEMA_VERSION, parsed);
    }
  }
}
