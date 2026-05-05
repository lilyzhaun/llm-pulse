import type Database from "better-sqlite3";

interface CountRow {
  count: number;
}

export class ProcessedLogStore {
  constructor(private readonly db: Database.Database) {}

  insertIfNew(logId: number, createdAt: number, bucketStart: number): boolean {
    const result = this.db
      .prepare(
        "INSERT OR IGNORE INTO processed_logs (log_id, created_at, bucket_start) VALUES (?, ?, ?)",
      )
      .run(logId, createdAt, bucketStart);
    return result.changes > 0;
  }

  pruneProcessedLogs(olderThan: number): void {
    this.db.prepare("DELETE FROM processed_logs WHERE created_at < ?").run(olderThan);
  }

  processedLogCount(): number {
    const row = this.db
      .prepare<[], CountRow>("SELECT COUNT(*) AS count FROM processed_logs")
      .get();
    return row?.count ?? 0;
  }
}
