import type { Logger } from "pino";
import { logger as defaultLogger } from "../../lib/logger.js";
import { META_KEYS } from "./schema.js";
import type { SnapshotStore } from "./store.js";
import { normalizeLogRow, type RawLogRow } from "./normalize.js";
import {
  selectBootstrapUpperWatermarkQuery,
  selectEnabledModelsQuery,
  selectLogsForBootstrapQuery,
  selectLogsInWindowQuery,
} from "./queries.js";

export interface QueryResult<T> {
  rows: T[];
}

export interface SnapshotQueryClient {
  query<T>(text: string, values?: readonly unknown[]): Promise<QueryResult<T>>;
}

export interface SnapshotRefreshDeps {
  store: SnapshotStore;
  pgClient: SnapshotQueryClient;
  logger?: Logger;
  reconcileSeconds: number;
  bootstrapBatchSize: number;
  now?: () => number;
}

export interface BootstrapResult {
  processed: number;
  remainingModels: string[];
  coveredUntilCreatedAt: number;
  coveredUntilId: number;
  durationMs: number;
}

export interface RefreshResult {
  processed: number;
  skipped: number;
  touchedModels: number;
  coveredUntilCreatedAt: number;
  coveredUntilId: number;
  durationMs: number;
}

interface EnabledModelRow {
  model: string;
}

interface UpperWatermarkRow {
  max_id: number | string;
  max_created_at: number | string;
}

export class NoEnabledModelsError extends Error {
  constructor() {
    super("No enabled models returned from abilities table");
    this.name = "NoEnabledModelsError";
  }
}

export class SnapshotNotReadyError extends Error {
  constructor() {
    super("Snapshot bootstrap has not completed yet");
    this.name = "SnapshotNotReadyError";
  }
}

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

const toInt = (value: unknown): number => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
};

const waitForNextTick = async (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

const loadEnabledModels = async (
  pgClient: SnapshotQueryClient,
): Promise<string[]> => {
  const query = selectEnabledModelsQuery();
  const result = await pgClient.query<EnabledModelRow>(
    query.text,
    query.values,
  );
  return result.rows
    .map((row) => row.model?.trim() ?? "")
    .filter((model): model is string => model.length > 0);
};

const setRefreshMeta = (
  store: SnapshotStore,
  createdAt: number,
  id: number,
  timestamp: string,
): void => {
  store.setMeta(META_KEYS.COVERED_UNTIL_CREATED_AT, String(createdAt));
  store.setMeta(META_KEYS.COVERED_UNTIL_ID, String(id));
  store.setMeta(META_KEYS.LAST_REFRESH_AT, timestamp);
  store.setMeta(META_KEYS.LAST_SUCCESS_AT, timestamp);
};

export const bootstrapSnapshot = async (
  deps: SnapshotRefreshDeps,
): Promise<BootstrapResult> => {
  const startedAt = Date.now();
  const currentTime = (deps.now ?? nowSeconds)();
  const currentLogger = deps.logger ?? defaultLogger;
  const enabledModels = await loadEnabledModels(deps.pgClient);
  if (enabledModels.length === 0) {
    throw new NoEnabledModelsError();
  }

  deps.store.seedEnabledModels(enabledModels);
  deps.store.setMeta(
    META_KEYS.RECONCILE_SECONDS,
    String(deps.reconcileSeconds),
  );

  const upperWatermarkQuery = selectBootstrapUpperWatermarkQuery(currentTime);
  const upperWatermarkResult = await deps.pgClient.query<UpperWatermarkRow>(
    upperWatermarkQuery.text,
    upperWatermarkQuery.values,
  );
  const upperRow = upperWatermarkResult.rows[0];
  const coveredUntilCreatedAt = toInt(upperRow?.max_created_at);
  const coveredUntilId = toInt(upperRow?.max_id);

  const remainingModels = new Set(enabledModels);
  const seenBuckets = new Map<string, Set<number>>();
  let processed = 0;
  let cursorCreatedAt: number | null = null;
  let cursorId: number | null = null;

  while (remainingModels.size > 0) {
    const query = selectLogsForBootstrapQuery({
      modelNames: [...remainingModels],
      upperCreatedAt: coveredUntilCreatedAt,
      upperId: coveredUntilId,
      cursorCreatedAt,
      cursorId,
      batchSize: deps.bootstrapBatchSize,
    });
    const result = await deps.pgClient.query<RawLogRow>(
      query.text,
      query.values,
    );
    if (result.rows.length === 0) {
      break;
    }

    deps.store.runInTransaction(() => {
      for (const row of result.rows) {
        const log = normalizeLogRow(row);
        if (!remainingModels.has(log.modelName)) {
          continue;
        }
        if (!deps.store.applyLogDelta(log)) {
          continue;
        }
        processed += 1;
        const bucketStart = Math.floor(log.createdAt / 60) * 60;
        const buckets = seenBuckets.get(log.modelName) ?? new Set<number>();
        buckets.add(bucketStart);
        seenBuckets.set(log.modelName, buckets);
        if (buckets.size >= 60) {
          remainingModels.delete(log.modelName);
        }
      }
    });

    const lastRow = result.rows.at(-1);
    if (!lastRow) {
      break;
    }
    cursorCreatedAt = toInt(lastRow.created_at);
    cursorId = toInt(lastRow.id);
    await waitForNextTick();
  }

  for (const modelName of enabledModels) {
    deps.store.pruneOldBuckets(modelName, 60);
  }

  const finishedAt = new Date().toISOString();
  deps.store.setMeta(
    META_KEYS.COVERED_UNTIL_CREATED_AT,
    String(coveredUntilCreatedAt),
  );
  deps.store.setMeta(META_KEYS.COVERED_UNTIL_ID, String(coveredUntilId));
  deps.store.setMeta(META_KEYS.BOOTSTRAP_COMPLETED_AT, finishedAt);
  deps.store.setMeta(META_KEYS.LAST_REFRESH_AT, finishedAt);
  deps.store.setMeta(META_KEYS.LAST_SUCCESS_AT, finishedAt);
  currentLogger.info(
    {
      processed,
      remainingModels: [...remainingModels],
      coveredUntilCreatedAt,
      coveredUntilId,
    },
    "Snapshot bootstrap completed",
  );

  return {
    processed,
    remainingModels: [...remainingModels],
    coveredUntilCreatedAt,
    coveredUntilId,
    durationMs: Date.now() - startedAt,
  };
};

export const refreshIncremental = async (
  deps: SnapshotRefreshDeps,
): Promise<RefreshResult> => {
  const startedAt = Date.now();
  const currentLogger = deps.logger ?? defaultLogger;
  const bootstrapCompletedAt = deps.store.getMeta(
    META_KEYS.BOOTSTRAP_COMPLETED_AT,
  );
  if (!bootstrapCompletedAt) {
    throw new SnapshotNotReadyError();
  }

  const coveredUntilCreatedAt = toInt(
    deps.store.getMeta(META_KEYS.COVERED_UNTIL_CREATED_AT),
  );
  const coveredUntilId = toInt(deps.store.getMeta(META_KEYS.COVERED_UNTIL_ID));
  const upperCreatedAt = (deps.now ?? nowSeconds)();
  const lowerCreatedAt = Math.max(
    0,
    coveredUntilCreatedAt - deps.reconcileSeconds,
  );

  let targetModels = deps.store.getEnabledModels();
  try {
    const refreshedModels = await loadEnabledModels(deps.pgClient);
    if (refreshedModels.length === 0) {
      currentLogger.warn(
        "abilities query returned empty result; keeping last-known-good enabled models",
      );
    } else {
      deps.store.replaceEnabledModels(refreshedModels);
      targetModels = refreshedModels;
    }
  } catch (error) {
    currentLogger.warn(
      { error },
      "Failed to refresh enabled models; keeping last-known-good snapshot visibility",
    );
  }

  let cursorCreatedAt: number | null = null;
  let cursorId: number | null = null;
  let processed = 0;
  let skipped = 0;
  const touchedModels = new Set<string>();
  let observedMaxCreatedAt = coveredUntilCreatedAt;
  let observedMaxId = coveredUntilId;

  try {
    while (true) {
      const query = selectLogsInWindowQuery({
        modelNames: targetModels,
        lowerCreatedAt,
        upperCreatedAt,
        cursorCreatedAt,
        cursorId,
        batchSize: deps.bootstrapBatchSize,
      });
      const result = await deps.pgClient.query<RawLogRow>(
        query.text,
        query.values,
      );
      if (result.rows.length === 0) {
        break;
      }

      deps.store.runInTransaction(() => {
        for (const row of result.rows) {
          const log = normalizeLogRow(row);
          if (!targetModels.includes(log.modelName)) {
            continue;
          }
          if (deps.store.applyLogDelta(log)) {
            processed += 1;
            touchedModels.add(log.modelName);
          } else {
            skipped += 1;
          }
          observedMaxCreatedAt = Math.max(observedMaxCreatedAt, log.createdAt);
          observedMaxId = Math.max(observedMaxId, log.id);
        }
      });

      const lastRow = result.rows.at(-1);
      if (!lastRow) {
        break;
      }
      cursorCreatedAt = toInt(lastRow.created_at);
      cursorId = toInt(lastRow.id);
    }

    for (const modelName of touchedModels) {
      deps.store.pruneOldBuckets(modelName, 60);
    }
    deps.store.pruneProcessedLogs(lowerCreatedAt - 60);
    const finishedAt = new Date().toISOString();
    setRefreshMeta(deps.store, observedMaxCreatedAt, observedMaxId, finishedAt);

    return {
      processed,
      skipped,
      touchedModels: touchedModels.size,
      coveredUntilCreatedAt: observedMaxCreatedAt,
      coveredUntilId: observedMaxId,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    deps.store.setMeta(META_KEYS.LAST_REFRESH_AT, new Date().toISOString());
    throw error;
  }
};
