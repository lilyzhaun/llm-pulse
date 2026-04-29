import type { DatabaseSync } from "node:sqlite";

import { initialSchemaMigration } from "./001-initial-schema.js";

interface Migration {
  version: number;
  name: string;
  up(database: DatabaseSync): void;
}

const migrations: Migration[] = [initialSchemaMigration].sort(
  (left, right) => left.version - right.version,
);

export function runMigrations(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const appliedVersions = new Set(
    (
      database.prepare("SELECT version FROM schema_migrations").all() as {
        version: number;
      }[]
    ).map(({ version }) => version),
  );

  const insertMigration = database.prepare(
    `INSERT INTO schema_migrations (version, name, applied_at)
     VALUES (?, ?, ?)`,
  );

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) {
      continue;
    }

    database.exec("BEGIN");
    try {
      migration.up(database);
      insertMigration.run(
        migration.version,
        migration.name,
        new Date().toISOString(),
      );
      database.exec("COMMIT");
      appliedVersions.add(migration.version);
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}
