import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  META_KEYS,
  SCHEMA_VERSION,
} from "../../../src/services/snapshot/schema.js";
import { SnapshotStore } from "../../../src/services/snapshot/store.js";
import type { NormalizedLog } from "../../../src/services/snapshot/types.js";
import { SchemaMismatchError } from "../../../src/services/snapshot/types.js";

const createTempDbPath = (): { dir: string; filePath: string } => {
  const dir = mkdtempSync(join(tmpdir(), "llm-pulse-snapshot-"));
  return { dir, filePath: join(dir, `${randomUUID()}.sqlite`) };
};

const createLog = (overrides: Partial<NormalizedLog> = {}): NormalizedLog => ({
  id: 1,
  createdAt: 1_704_067_200,
  type: 2,
  modelName: "gpt-4o-mini",
  channelId: 10,
  channelName: "primary",
  promptTokens: 100,
  cacheTokens: 20,
  completionTokens: 30,
  quota: 42,
  useTimeSeconds: 1.5,
  ...overrides,
});

describe("SnapshotStore", () => {
  it("opens idempotently and seeds schema metadata", () => {
    const { dir, filePath } = createTempDbPath();
    const store = new SnapshotStore(filePath);

    try {
      store.open();
      store.open();

      expect(store.getMeta(META_KEYS.SCHEMA_VERSION)).toBe(
        String(SCHEMA_VERSION),
      );
      expect(store.getMeta(META_KEYS.BUCKET_SECONDS)).toBe("60");
      expect(store.getMeta(META_KEYS.BUCKET_LIMIT)).toBe("60");
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads and writes metadata", () => {
    const { dir, filePath } = createTempDbPath();
    const store = new SnapshotStore(filePath);

    try {
      store.open();
      store.setMeta(META_KEYS.LAST_REFRESH_AT, "2026-05-06T00:00:00.000Z");

      expect(store.getMeta(META_KEYS.LAST_REFRESH_AT)).toBe(
        "2026-05-06T00:00:00.000Z",
      );
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("applies log deltas and deduplicates by log id", () => {
    const { dir, filePath } = createTempDbPath();
    const store = new SnapshotStore(filePath);

    try {
      store.open();
      const first = createLog();
      const second = createLog({
        id: 2,
        createdAt: first.createdAt + 10,
        type: 5,
        promptTokens: 999,
        cacheTokens: 999,
        completionTokens: 999,
        useTimeSeconds: 2.25,
      });

      expect(store.applyLogDelta(first)).toBe(true);
      expect(store.applyLogDelta(first)).toBe(false);
      expect(store.applyLogDelta(second)).toBe(true);

      const snapshot = store.readSnapshot();
      const buckets = snapshot.models.get("gpt-4o-mini");
      expect(buckets).toHaveLength(1);
      expect(buckets?.[0]).toMatchObject({
        totalCount: 2,
        successCount: 1,
        errorCount: 1,
        promptTokens: 100,
        cacheTokens: 20,
        completionTokens: 30,
        quotaSum: 84,
      });
      expect(buckets?.[0].latencySamples).toBe(2);
      expect(buckets?.[0].latencySumSeconds).toBeCloseTo(3.75);
      expect(snapshot.processedLogCount).toBe(2);

      const channels = snapshot.channels.get("gpt-4o-mini");
      expect(channels).toHaveLength(1);
      expect(channels?.[0]).toMatchObject({
        channelId: 10,
        channelName: "primary",
        totalCount: 2,
      });
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps latency samples for errors but not token counts", () => {
    const { dir, filePath } = createTempDbPath();
    const store = new SnapshotStore(filePath);

    try {
      store.open();
      store.applyLogDelta(
        createLog({
          type: 5,
          promptTokens: 500,
          cacheTokens: 500,
          completionTokens: 500,
          useTimeSeconds: 4,
        }),
      );

      const bucket = store.readSnapshot().models.get("gpt-4o-mini")?.[0];
      expect(bucket).toBeDefined();
      expect(bucket?.successCount).toBe(0);
      expect(bucket?.errorCount).toBe(1);
      expect(bucket?.promptTokens).toBe(0);
      expect(bucket?.cacheTokens).toBe(0);
      expect(bucket?.completionTokens).toBe(0);
      expect(bucket?.latencySamples).toBe(1);
      expect(bucket?.latencySumSeconds).toBe(4);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prunes old buckets while preserving the most recent 60 non-empty buckets", () => {
    const { dir, filePath } = createTempDbPath();
    const store = new SnapshotStore(filePath);

    try {
      store.open();
      for (let index = 0; index < 65; index += 1) {
        store.applyLogDelta(
          createLog({
            id: index + 1,
            createdAt: 1_700_000_000 + index * 86_400,
            channelId: index % 2,
            channelName: index % 2 === 0 ? "primary" : "secondary",
          }),
        );
      }

      store.pruneOldBuckets("gpt-4o-mini", 60);

      const snapshot = store.readSnapshot();
      const buckets = snapshot.models.get("gpt-4o-mini") ?? [];
      expect(buckets).toHaveLength(60);
      expect(Math.max(...buckets.map((bucket) => bucket.bucketStart))).toBe(
        Math.floor((1_700_000_000 + 64 * 86_400) / 60) * 60,
      );
      expect(Math.min(...buckets.map((bucket) => bucket.bucketStart))).toBe(
        Math.floor((1_700_000_000 + 5 * 86_400) / 60) * 60,
      );

      const channels = snapshot.channels.get("gpt-4o-mini") ?? [];
      expect(channels).toHaveLength(60);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not prune when fewer than the keep count exist", () => {
    const { dir, filePath } = createTempDbPath();
    const store = new SnapshotStore(filePath);

    try {
      store.open();
      for (let index = 0; index < 3; index += 1) {
        store.applyLogDelta(
          createLog({ id: index + 1, createdAt: 1_704_067_200 + index * 60 }),
        );
      }

      store.pruneOldBuckets("gpt-4o-mini", 60);

      expect(store.readSnapshot().models.get("gpt-4o-mini")).toHaveLength(3);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prunes processed logs by created_at threshold", () => {
    const { dir, filePath } = createTempDbPath();
    const store = new SnapshotStore(filePath);

    try {
      store.open();
      store.applyLogDelta(createLog({ id: 1, createdAt: 100 }));
      store.applyLogDelta(createLog({ id: 2, createdAt: 200 }));
      store.applyLogDelta(createLog({ id: 3, createdAt: 300 }));

      store.pruneProcessedLogs(250);

      expect(store.processedLogCount()).toBe(1);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects empty replaceEnabledModels but allows empty seedEnabledModels", () => {
    const { dir, filePath } = createTempDbPath();
    const store = new SnapshotStore(filePath);

    try {
      store.open();
      expect(() => store.replaceEnabledModels([])).toThrow(/last-known-good/);
      expect(() => store.seedEnabledModels([])).not.toThrow();
      expect(store.getEnabledModels()).toEqual([]);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads enabled models and snapshot metadata together", () => {
    const { dir, filePath } = createTempDbPath();
    const store = new SnapshotStore(filePath);

    try {
      store.open();
      store.seedEnabledModels(["gpt-4o-mini", "gpt-5.5"]);
      store.setMeta(META_KEYS.COVERED_UNTIL_CREATED_AT, "1704067500");
      store.setMeta(META_KEYS.COVERED_UNTIL_ID, "99");
      store.setMeta(
        META_KEYS.BOOTSTRAP_COMPLETED_AT,
        "2026-05-06T00:00:00.000Z",
      );
      store.setMeta(META_KEYS.LAST_REFRESH_AT, "2026-05-06T00:01:00.000Z");
      store.setMeta(META_KEYS.LAST_SUCCESS_AT, "2026-05-06T00:01:00.000Z");

      const snapshot = store.readSnapshot();
      expect(snapshot.enabledModels).toEqual(
        new Set(["gpt-4o-mini", "gpt-5.5"]),
      );
      expect(snapshot.coveredUntilCreatedAt).toBe(1_704_067_500);
      expect(snapshot.coveredUntilId).toBe(99);
      expect(snapshot.bootstrapCompletedAt).toBe("2026-05-06T00:00:00.000Z");
      expect(snapshot.lastRefreshAt).toBe("2026-05-06T00:01:00.000Z");
      expect(snapshot.lastSuccessAt).toBe("2026-05-06T00:01:00.000Z");
      expect(store.isReady()).toBe(true);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws SchemaMismatchError when an existing database has the wrong version", () => {
    const { dir, filePath } = createTempDbPath();
    const store = new SnapshotStore(filePath);

    try {
      store.open();
      store.close();

      const raw = new Database(filePath);
      raw
        .prepare(
          "INSERT INTO snapshot_meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        )
        .run(META_KEYS.SCHEMA_VERSION, String(SCHEMA_VERSION + 1));
      raw.close();

      expect(() => store.open()).toThrow(SchemaMismatchError);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
