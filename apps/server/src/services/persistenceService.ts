import { access, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { MODEL_BUCKET_RETENTION_COUNT } from "../config/constants.js";
import { logger } from "../lib/logger.js";
import { incrementPersistenceLoadErrors } from "../routes/metrics.js";
import { runMigrations } from "./migrations/runner.js";

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

export interface PersistedPulseStateLoadFailure
  extends Pick<
    PersistedPulseState,
    "version" | "savedAt" | "recentLogs" | "cursor" | "bootstrap" | "pollStatus"
  > {
  kind: "persistence-load-failure";
  statePath: string;
  errorMessage: string;
}

export type PersistedPulseStateLoadResult =
  | PersistedPulseState
  | PersistedPulseStateLoadFailure
  | null;

export class PersistenceService {
  private database: DatabaseSync | null = null;

  constructor(
    private readonly statePath = process.env.PULSE_DB_FILE ?? defaultStatePath,
  ) {}

  async loadPulseState(): Promise<PersistedPulseStateLoadResult> {
    try {
      await access(this.statePath);
    } catch (error) {
      if (this.isMissingStateFileError(error)) {
        return null;
      }

      logger.error(
        { error, statePath: this.statePath },
        "Failed to load llm-pulse state",
      );

      incrementPersistenceLoadErrors();
      return this.createLoadFailure(error);
    }

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
        !bootstrapRow &&
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
          lastSeenTimestamp: cursorRow?.value ? Number(cursorRow.value) : null,
        },
        bootstrap: {
          backfillCompletedAt: bootstrapRow?.value ? bootstrapRow.value : null,
        },
        pollStatus: pollStatusRow
          ? (JSON.parse(pollStatusRow.value) as PersistedPollStatus)
          : null,
      };
    } catch (error) {
      logger.error(
        { error, statePath: this.statePath },
        "Failed to load llm-pulse state",
      );
      incrementPersistenceLoadErrors();
      return this.createLoadFailure(error);
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
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA busy_timeout = 5000");
    database.exec("PRAGMA foreign_keys = ON");
    runMigrations(database);
  }

  private createLoadFailure(error: unknown): PersistedPulseStateLoadFailure {
    return {
      kind: "persistence-load-failure",
      version: STATE_VERSION,
      savedAt: new Date().toISOString(),
      recentLogs: [],
      cursor: {
        lastSeenTimestamp: null,
      },
      bootstrap: {
        backfillCompletedAt: null,
      },
      pollStatus: null,
      statePath: this.statePath,
      errorMessage:
        error instanceof Error ? error.message : "Unknown persistence error",
    };
  }

  private isMissingStateFileError(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "ENOENT"
    );
  }
}

export const persistenceService = new PersistenceService();
