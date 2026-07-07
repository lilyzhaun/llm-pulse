import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import {
  HEARTBEAT_BUCKET_COUNT,
  HEARTBEAT_BUCKET_SECONDS,
} from "../../config/constants.js";
import {
  DDL_STATEMENTS,
  META_KEYS,
  PRAGMA_STATEMENTS,
  SCHEMA_VERSION,
} from "./schema.js";
import {
  type NormalizedLog,
  SchemaMismatchError,
  type SnapshotData,
} from "./types.js";
import { BucketStore } from "./internal/bucketStore.js";
import { EnabledModelStore } from "./internal/enabledModelStore.js";
import { readSnapshotFromStores } from "./internal/readSnapshot.js";
import { MetaStore } from "./internal/metaStore.js";
import { ProcessedLogStore } from "./internal/processedLogStore.js";

export class SnapshotStore {
  private readonly filePath: string;
  private db: Database.Database | null = null;
  private metaStore: MetaStore | null = null;
  private enabledModelStore: EnabledModelStore | null = null;
  private bucketStore: BucketStore | null = null;
  private processedLogStore: ProcessedLogStore | null = null;

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

    this.metaStore = new MetaStore(db);
    this.enabledModelStore = new EnabledModelStore(db);
    this.bucketStore = new BucketStore(db);
    this.processedLogStore = new ProcessedLogStore(db);

    this.assertSchemaVersion();
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.metaStore = null;
    this.enabledModelStore = null;
    this.bucketStore = null;
    this.processedLogStore = null;
  }

  isReady(): boolean {
    if (!this.db) {
      return false;
    }
    return this.getMeta(META_KEYS.BOOTSTRAP_COMPLETED_AT) !== null;
  }

  getMeta(key: string): string | null {
    return this.requireMetaStore().getMeta(key);
  }

  setMeta(key: string, value: string): void {
    this.requireMetaStore().setMeta(key, value);
  }

  getEnabledModels(): string[] {
    return this.requireEnabledModelStore().getEnabledModels();
  }

  replaceEnabledModels(names: readonly string[]): void {
    this.requireEnabledModelStore().replaceEnabledModels(names);
  }

  seedEnabledModels(names: readonly string[]): void {
    this.requireEnabledModelStore().seedEnabledModels(names);
  }

  applyLogDelta(log: NormalizedLog): boolean {
    const bucketStart =
      Math.floor(log.createdAt / HEARTBEAT_BUCKET_SECONDS) *
      HEARTBEAT_BUCKET_SECONDS;
    const inserted = this.requireProcessedLogStore().insertIfNew(
      log.id,
      log.createdAt,
      bucketStart,
    );
    if (!inserted) {
      return false;
    }

    this.requireBucketStore().applyLogDelta(log);
    return true;
  }

  pruneOldBuckets(modelName: string, keepCount = HEARTBEAT_BUCKET_COUNT): void {
    this.requireBucketStore().pruneOldBuckets(modelName, keepCount);
  }

  pruneProcessedLogs(olderThan: number): void {
    this.requireProcessedLogStore().pruneProcessedLogs(olderThan);
  }

  processedLogCount(): number {
    return this.requireProcessedLogStore().processedLogCount();
  }

  readSnapshot(): SnapshotData {
    return readSnapshotFromStores({
      metaStore: this.requireMetaStore(),
      enabledModelStore: this.requireEnabledModelStore(),
      bucketStore: this.requireBucketStore(),
      processedLogStore: this.requireProcessedLogStore(),
    });
  }

  runInTransaction<T>(fn: () => T): T {
    const db = this.requireDb();
    const tx = db.transaction(fn);
    return tx();
  }

  private assertSchemaVersion(): void {
    const stored = this.getMeta(META_KEYS.SCHEMA_VERSION);
    if (stored === null) {
      this.setMeta(META_KEYS.SCHEMA_VERSION, String(SCHEMA_VERSION));
      this.setMeta(META_KEYS.BUCKET_SECONDS, String(HEARTBEAT_BUCKET_SECONDS));
      this.setMeta(META_KEYS.BUCKET_LIMIT, String(HEARTBEAT_BUCKET_COUNT));
      return;
    }

    const parsed = Number(stored);
    if (parsed !== SCHEMA_VERSION) {
      throw new SchemaMismatchError(SCHEMA_VERSION, parsed);
    }
  }

  private requireDb(): Database.Database {
    if (!this.db) {
      throw new Error("SnapshotStore is not open");
    }
    return this.db;
  }

  private requireMetaStore(): MetaStore {
    if (!this.metaStore) {
      throw new Error("SnapshotStore is not open");
    }
    return this.metaStore;
  }

  private requireEnabledModelStore(): EnabledModelStore {
    if (!this.enabledModelStore) {
      throw new Error("SnapshotStore is not open");
    }
    return this.enabledModelStore;
  }

  private requireBucketStore(): BucketStore {
    if (!this.bucketStore) {
      throw new Error("SnapshotStore is not open");
    }
    return this.bucketStore;
  }

  private requireProcessedLogStore(): ProcessedLogStore {
    if (!this.processedLogStore) {
      throw new Error("SnapshotStore is not open");
    }
    return this.processedLogStore;
  }
}
