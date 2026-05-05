import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { describe, expect, it, vi } from "vitest";
import { META_KEYS } from "../../../src/services/snapshot/schema.js";
import {
  NoEnabledModelsError,
  SnapshotNotReadyError,
  bootstrapSnapshot,
  refreshIncremental,
  type SnapshotQueryClient,
} from "../../../src/services/snapshot/refreshService.js";
import { SnapshotStore } from "../../../src/services/snapshot/store.js";

const createTempDbPath = (): { dir: string; filePath: string } => {
  const dir = mkdtempSync(join(tmpdir(), "llm-pulse-refresh-"));
  return { dir, filePath: join(dir, `${randomUUID()}.sqlite`) };
};

type QueryInvocation = { text: string; values?: readonly unknown[] };

const makeLogger = () =>
  ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  }) as unknown as Logger;

const logRow = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  created_at: 1_704_067_200,
  type: 2,
  model_name: "gpt-4o-mini",
  channel_id: 10,
  channel_name: "primary",
  prompt_tokens: 100,
  completion_tokens: 30,
  quota: 42,
  use_time: 1.5,
  other: '{"cache_tokens":20}',
  ...overrides,
});

const createQueryClient = (
  handlers: {
    enabledModels?: string[];
    upperWatermark?: { max_id: number; max_created_at: number };
    bootstrapBatches?: Array<Array<Record<string, unknown>>>;
    windowBatches?: Array<Array<Record<string, unknown>>>;
    throwOnWindowQuery?: Error;
  },
  invocations: QueryInvocation[] = [],
): SnapshotQueryClient => {
  let bootstrapIndex = 0;
  let windowIndex = 0;

  return {
    query: async <T>(text: string, values?: readonly unknown[]) => {
      invocations.push({ text, values });
      if (text.includes("FROM abilities")) {
        return {
          rows: (handlers.enabledModels ?? []).map((model) => ({
            model,
          })) as T[],
        };
      }
      if (text.includes("MAX(id)")) {
        return {
          rows: [
            handlers.upperWatermark ?? { max_id: 0, max_created_at: 0 },
          ] as T[],
        };
      }
      if (text.includes("ORDER BY logs.created_at DESC, logs.id DESC")) {
        const rows = handlers.bootstrapBatches?.[bootstrapIndex] ?? [];
        bootstrapIndex += 1;
        return { rows: rows as T[] };
      }
      if (text.includes("ORDER BY logs.created_at ASC, logs.id ASC")) {
        if (handlers.throwOnWindowQuery) {
          throw handlers.throwOnWindowQuery;
        }
        const rows = handlers.windowBatches?.[windowIndex] ?? [];
        windowIndex += 1;
        return { rows: rows as T[] };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  };
};

describe("refreshService", () => {
  it("bootstraps sparse models across multiple batches", async () => {
    const { dir, filePath } = createTempDbPath();
    const store = new SnapshotStore(filePath);
    store.open();
    const logger = makeLogger();

    try {
      const result = await bootstrapSnapshot({
        store,
        pgClient: createQueryClient({
          enabledModels: ["gpt-4o-mini", "gpt-5.5"],
          upperWatermark: { max_id: 99, max_created_at: 1_704_067_500 },
          bootstrapBatches: [
            [
              logRow({
                id: 1,
                model_name: "gpt-4o-mini",
                created_at: 1_704_067_200,
              }),
              logRow({
                id: 2,
                model_name: "gpt-5.5",
                created_at: 1_704_067_140,
              }),
            ],
            [
              logRow({
                id: 3,
                model_name: "gpt-4o-mini",
                created_at: 1_703_980_800,
              }),
              logRow({
                id: 4,
                model_name: "gpt-5.5",
                created_at: 1_703_894_400,
              }),
            ],
            [],
          ],
        }),
        logger,
        reconcileSeconds: 120,
        bootstrapBatchSize: 1000,
        now: () => 1_704_067_500,
      });

      expect(result.processed).toBe(4);
      expect(result.coveredUntilCreatedAt).toBe(1_704_067_500);
      expect(result.coveredUntilId).toBe(99);
      expect(store.isReady()).toBe(true);
      expect(store.getEnabledModels()).toEqual(["gpt-4o-mini", "gpt-5.5"]);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("throws when bootstrap sees no enabled models", async () => {
    const { dir, filePath } = createTempDbPath();
    const store = new SnapshotStore(filePath);
    store.open();

    try {
      await expect(
        bootstrapSnapshot({
          store,
          pgClient: createQueryClient({ enabledModels: [] }),
          reconcileSeconds: 120,
          bootstrapBatchSize: 1000,
        }),
      ).rejects.toThrow(NoEnabledModelsError);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects incremental refresh before bootstrap completes", async () => {
    const { dir, filePath } = createTempDbPath();
    const store = new SnapshotStore(filePath);
    store.open();

    try {
      await expect(
        refreshIncremental({
          store,
          pgClient: createQueryClient({ enabledModels: ["gpt-4o-mini"] }),
          reconcileSeconds: 120,
          bootstrapBatchSize: 1000,
        }),
      ).rejects.toThrow(SnapshotNotReadyError);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("re-runs reconcile idempotently and captures late-arriving logs in window", async () => {
    const { dir, filePath } = createTempDbPath();
    const store = new SnapshotStore(filePath);
    store.open();
    store.seedEnabledModels(["gpt-4o-mini"]);
    store.setMeta(META_KEYS.BOOTSTRAP_COMPLETED_AT, "2026-05-06T00:00:00.000Z");
    store.setMeta(META_KEYS.COVERED_UNTIL_CREATED_AT, "1704067500");
    store.setMeta(META_KEYS.COVERED_UNTIL_ID, "10");

    const windowRow = logRow({ id: 11, created_at: 1_704_067_490 });
    const lateRow = logRow({
      id: 12,
      created_at: 1_704_067_450,
      type: 5,
      use_time: 2,
    });
    const queryClient = createQueryClient({
      enabledModels: ["gpt-4o-mini"],
      windowBatches: [[windowRow, lateRow], []],
    });

    try {
      const first = await refreshIncremental({
        store,
        pgClient: queryClient,
        reconcileSeconds: 120,
        bootstrapBatchSize: 1000,
        now: () => 1_704_067_560,
      });
      expect(first.processed).toBe(2);
      expect(first.skipped).toBe(0);

      const second = await refreshIncremental({
        store,
        pgClient: createQueryClient({
          enabledModels: ["gpt-4o-mini"],
          windowBatches: [[windowRow, lateRow], []],
        }),
        reconcileSeconds: 120,
        bootstrapBatchSize: 1000,
        now: () => 1_704_067_620,
      });
      expect(second.processed).toBe(0);
      expect(second.skipped).toBe(2);
      expect(store.readSnapshot().processedLogCount).toBe(2);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps last-known-good enabled models when abilities returns empty", async () => {
    const { dir, filePath } = createTempDbPath();
    const store = new SnapshotStore(filePath);
    store.open();
    store.seedEnabledModels(["gpt-4o-mini"]);
    store.setMeta(META_KEYS.BOOTSTRAP_COMPLETED_AT, "2026-05-06T00:00:00.000Z");
    store.setMeta(META_KEYS.COVERED_UNTIL_CREATED_AT, "1704067500");
    store.setMeta(META_KEYS.COVERED_UNTIL_ID, "10");
    const logger = makeLogger();

    try {
      await refreshIncremental({
        store,
        pgClient: createQueryClient({ enabledModels: [], windowBatches: [[]] }),
        logger,
        reconcileSeconds: 120,
        bootstrapBatchSize: 1000,
        now: () => 1_704_067_560,
      });
      expect(store.getEnabledModels()).toEqual(["gpt-4o-mini"]);
      expect(logger.warn).toHaveBeenCalled();
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not advance covered_until when refresh query fails", async () => {
    const { dir, filePath } = createTempDbPath();
    const store = new SnapshotStore(filePath);
    store.open();
    store.seedEnabledModels(["gpt-4o-mini"]);
    store.setMeta(META_KEYS.BOOTSTRAP_COMPLETED_AT, "2026-05-06T00:00:00.000Z");
    store.setMeta(META_KEYS.COVERED_UNTIL_CREATED_AT, "1704067500");
    store.setMeta(META_KEYS.COVERED_UNTIL_ID, "10");

    try {
      await expect(
        refreshIncremental({
          store,
          pgClient: createQueryClient({
            enabledModels: ["gpt-4o-mini"],
            throwOnWindowQuery: new Error("upstream offline"),
          }),
          reconcileSeconds: 120,
          bootstrapBatchSize: 1000,
          now: () => 1_704_067_560,
        }),
      ).rejects.toThrow("upstream offline");
      expect(store.getMeta(META_KEYS.COVERED_UNTIL_CREATED_AT)).toBe(
        "1704067500",
      );
      expect(store.getMeta(META_KEYS.COVERED_UNTIL_ID)).toBe("10");
      expect(store.getMeta(META_KEYS.LAST_SUCCESS_AT)).toBeNull();
      expect(store.getMeta(META_KEYS.LAST_REFRESH_AT)).not.toBeNull();
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses cursor predicates for paginated incremental scans", async () => {
    const { dir, filePath } = createTempDbPath();
    const store = new SnapshotStore(filePath);
    store.open();
    store.seedEnabledModels(["gpt-4o-mini"]);
    store.setMeta(META_KEYS.BOOTSTRAP_COMPLETED_AT, "2026-05-06T00:00:00.000Z");
    store.setMeta(META_KEYS.COVERED_UNTIL_CREATED_AT, "1704067500");
    store.setMeta(META_KEYS.COVERED_UNTIL_ID, "10");
    const invocations: QueryInvocation[] = [];

    try {
      await refreshIncremental({
        store,
        pgClient: createQueryClient(
          {
            enabledModels: ["gpt-4o-mini"],
            windowBatches: [[logRow({ id: 11 })], []],
          },
          invocations,
        ),
        reconcileSeconds: 120,
        bootstrapBatchSize: 1000,
        now: () => 1_704_067_560,
      });
      expect(
        invocations.some((call) => call.text.includes("logs.id > $5::bigint")),
      ).toBe(true);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
