import type { DatabaseSync } from "node:sqlite";

export const initialSchemaMigration = {
  version: 1,
  name: "initial-schema",
  up(database: DatabaseSync): void {
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
  },
};
