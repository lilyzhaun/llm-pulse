import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { MODEL_BUCKET_RETENTION_COUNT } from "../config/constants.js";
import { logger } from "../lib/logger.js";

const STATE_VERSION = 1;

const currentDir = dirname(fileURLToPath(import.meta.url));
const defaultStatePath = resolve(currentDir, "../../data/pulse-state.sqlite");

export interface PersistedPulseLog {
  id: number;
  created_at: number;
  type: number;
  model_name: string;
  use_time: number;
  channel: number;
  channel_name: string;
}

export interface PersistedPollStatus {
  lastPollAt: string;
  lastPollSucceeded: boolean;
  lastErrorMessage: string | null;
}

export interface PersistedPulseState {
  version: number;
  savedAt: string;
  recentLogs: PersistedPulseLog[];
  cursor: {
    lastSeenTimestamp: number | null;
  };
  bootstrap: {
    backfillCompletedAt: string | null;
  };
  pollStatus: PersistedPollStatus | null;
}

export class PersistenceService {
  private database: DatabaseSync | null = null;

  constructor(
    private readonly statePath = process.env.PULSE_DB_FILE ?? defaultStatePath,
  ) {}

  async loadPulseState(): Promise<PersistedPulseState | null> {
    try {
      const database = await this.getDatabase();

      const stateRow = database
        .prepare("SELECT saved_at FROM pulse_state WHERE state_key = ?")
        .get("state_meta") as { saved_at: string } | undefined;

      const cursorRow = database
        .prepare("SELECT value FROM pulse_state WHERE state_key = ?")
        .get("last_seen_timestamp") as { value: string } | undefined;

      const bootstrapRow = database
        .prepare("SELECT value FROM pulse_state WHERE state_key = ?")
        .get("backfill_completed_at") as { value: string } | undefined;

      const pollStatusRow = database
        .prepare("SELECT value FROM pulse_state WHERE state_key = ?")
        .get("poll_status") as { value: string } | undefined;

      const recentLogs = database
        .prepare(
          `SELECT id, created_at, type, model_name, use_time, channel, channel_name
           FROM pulse_logs
           ORDER BY created_at DESC, id DESC`,
        )
        .all() as PersistedPulseLog[];

      if (
        !stateRow &&
        !cursorRow &&
        !pollStatusRow &&
        recentLogs.length === 0
      ) {
        return null;
      }

      return {
        version: STATE_VERSION,
        savedAt: stateRow?.saved_at ?? new Date().toISOString(),
        recentLogs,
        cursor: {
          lastSeenTimestamp: cursorRow ? Number(cursorRow.value) : null,
        },
        bootstrap: {
          backfillCompletedAt: bootstrapRow?.value ? bootstrapRow.value : null,
        },
        pollStatus: pollStatusRow
          ? (JSON.parse(pollStatusRow.value) as PersistedPollStatus)
          : null,
      };
    } catch (error) {
      logger.warn(
        { error, statePath: this.statePath },
        "Failed to load llm-pulse state",
      );
      return null;
    }
  }

  async savePulseState(
    state: Omit<PersistedPulseState, "version" | "savedAt">,
  ): Promise<void> {
    const database = await this.getDatabase();

    const savedAt = new Date().toISOString();
    database.exec("BEGIN");
    try {
      const insertLogStatement = database.prepare(
        `INSERT INTO pulse_logs (id, created_at, type, model_name, use_time, channel, channel_name)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           created_at = excluded.created_at,
           type = excluded.type,
           model_name = excluded.model_name,
           use_time = excluded.use_time,
           channel = excluded.channel,
           channel_name = excluded.channel_name`,
      );

      for (const log of state.recentLogs) {
        insertLogStatement.run(
          log.id,
          log.created_at,
          log.type,
          log.model_name,
          log.use_time,
          log.channel,
          log.channel_name,
        );
      }

      database.exec(`
        DELETE FROM pulse_logs
        WHERE id IN (
          SELECT id FROM (
            SELECT id,
                   DENSE_RANK() OVER (
                     PARTITION BY model_name
                     ORDER BY CAST(created_at / 60 AS INTEGER) DESC
                   ) AS bucket_rank
            FROM pulse_logs
          ) ranked
          WHERE ranked.bucket_rank > ${MODEL_BUCKET_RETENTION_COUNT}
        )
      `);

      const upsertState = database.prepare(
        `INSERT INTO pulse_state (state_key, value, saved_at)
         VALUES (?, ?, ?)
         ON CONFLICT(state_key) DO UPDATE SET value = excluded.value, saved_at = excluded.saved_at`,
      );

      upsertState.run("state_meta", String(STATE_VERSION), savedAt);
      upsertState.run(
        "last_seen_timestamp",
        String(state.cursor.lastSeenTimestamp ?? ""),
        savedAt,
      );
      upsertState.run(
        "backfill_completed_at",
        state.bootstrap.backfillCompletedAt ?? "",
        savedAt,
      );
      upsertState.run("poll_status", JSON.stringify(state.pollStatus), savedAt);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    if (!this.database) {
      return;
    }

    this.database.close();
    this.database = null;
  }

  private async getDatabase(): Promise<DatabaseSync> {
    if (this.database) {
      return this.database;
    }

    await mkdir(dirname(this.statePath), { recursive: true });
    this.database = new DatabaseSync(this.statePath);
    this.initializeSchema(this.database);
    return this.database;
  }

  private initializeSchema(database: DatabaseSync): void {
    database.exec(`
      CREATE TABLE IF NOT EXISTS pulse_logs (
        id INTEGER PRIMARY KEY,
        created_at INTEGER NOT NULL,
        type INTEGER NOT NULL,
        model_name TEXT NOT NULL,
        use_time REAL NOT NULL,
        channel INTEGER NOT NULL,
        channel_name TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS pulse_state (
        state_key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        saved_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_pulse_logs_created_at ON pulse_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_pulse_logs_model_name ON pulse_logs(model_name);
      CREATE INDEX IF NOT EXISTS idx_pulse_logs_model_created_at ON pulse_logs(model_name, created_at DESC);
    `);
  }
}

export const persistenceService = new PersistenceService();
