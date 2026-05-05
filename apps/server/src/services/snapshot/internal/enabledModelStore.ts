import type Database from "better-sqlite3";

interface EnabledModelRow {
  model_name: string;
}

export class EnabledModelStore {
  constructor(private readonly db: Database.Database) {}

  getEnabledModels(): string[] {
    const rows = this.db
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
    this.writeEnabledModels(names);
  }

  seedEnabledModels(names: readonly string[]): void {
    this.writeEnabledModels(names);
  }

  private writeEnabledModels(names: readonly string[]): void {
    const now = Math.floor(Date.now() / 1000);
    const tx = this.db.transaction((items: readonly string[]) => {
      this.db.prepare("DELETE FROM enabled_models").run();
      const insert = this.db.prepare(
        "INSERT INTO enabled_models (model_name, updated_at) VALUES (?, ?)",
      );
      for (const name of items) {
        insert.run(name, now);
      }
    });
    tx(names);
  }
}
