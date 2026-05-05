import type Database from "better-sqlite3";

interface MetaRow {
  value: string;
}

export class MetaStore {
  constructor(private readonly db: Database.Database) {}

  getMeta(key: string): string | null {
    const row = this.db
      .prepare<[string], MetaRow>("SELECT value FROM snapshot_meta WHERE key = ?")
      .get(key);
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO snapshot_meta (key, value) VALUES (?, ?)
        ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }
}
