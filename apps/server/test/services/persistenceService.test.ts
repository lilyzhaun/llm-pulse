import { mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sqlite", () => require(`node:${"sqlite"}`));

interface TestDatabase {
  prepare(statement: string): {
    all(): unknown[];
    get(): unknown;
  };
  exec(statement: string): void;
  close(): void;
}

const require = createRequire(import.meta.url);

const openDatabase = (path: string) => {
  const { DatabaseSync } = require("node:sqlite") as {
    DatabaseSync: new (path: string) => TestDatabase;
  };

  return new DatabaseSync(path);
};

import {
  type PersistedPulseLog,
  type PersistedPulseState,
  PersistenceService,
} from "../../src/services/persistenceService.js";
import { logger } from "../../src/lib/logger.js";

const state = (
  overrides: Partial<Omit<PersistedPulseState, "version" | "savedAt">> = {},
): Omit<PersistedPulseState, "version" | "savedAt"> => ({
  recentLogs: [
    log({
      id: 2,
      created_at: 1_704_067_260,
      type: 5,
      model_name: "gpt-4o-mini",
      use_time: 2.5,
      channel: 20,
      channel_name: "backup",
    }),
    log({
      id: 1,
      created_at: 1_704_067_200,
      type: 2,
      model_name: "gpt-4o-mini",
      use_time: 1.25,
      channel: 10,
      channel_name: "primary",
    }),
  ],
  cursor: {
    lastSeenTimestamp: 1_704_067_260,
  },
  bootstrap: {
    backfillCompletedAt: "2024-01-01T00:04:20.000Z",
  },
  pollStatus: {
    lastPollAt: "2024-01-01T00:05:00.000Z",
    lastPollSucceeded: true,
    lastErrorMessage: null,
  },
  ...overrides,
});

const log = (
  overrides: Partial<PersistedPulseLog> = {},
): PersistedPulseLog => ({
  id: 1,
  created_at: 1_704_067_200,
  type: 2,
  model_name: "gpt-4o-mini",
  use_time: 1,
  channel: 10,
  channel_name: "primary",
  ...overrides,
});

describe("PersistenceService", () => {
  let tempDir: string;
  let statePath: string;

  beforeEach(async () => {
    tempDir = join(
      tmpdir(),
      `llm-pulse-persistence-${process.pid}-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`,
    );
    await mkdir(tempDir, { recursive: true });
    statePath = join(tempDir, "pulse-state.sqlite");
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tempDir, { force: true, recursive: true });
  });

  it("returns null when the database has no persisted rows", async () => {
    const service = new PersistenceService(statePath);

    await expect(service.loadPulseState()).resolves.toBeNull();
  });

  it("returns restored state with recentLogs, cursor, bootstrap, and pollStatus after save", async () => {
    const service = new PersistenceService(statePath);
    const savedState = state();

    await service.savePulseState(savedState);

    const loadedState = await service.loadPulseState();
    expect(loadedState).toMatchObject({
      version: 1,
      recentLogs: savedState.recentLogs,
      cursor: savedState.cursor,
      bootstrap: savedState.bootstrap,
      pollStatus: savedState.pollStatus,
    });
    expect(loadedState?.savedAt).toEqual(expect.any(String));
  });

  it("sets SQLite PRAGMA values when initializing the database", async () => {
    const service = new PersistenceService(statePath);

    await service.savePulseState(state());
    const database = (service as unknown as { database: TestDatabase })
      .database;
    try {
      const journalMode = database.prepare("PRAGMA journal_mode").get() as {
        journal_mode: string;
      };
      const busyTimeout = database.prepare("PRAGMA busy_timeout").get() as {
        timeout: number;
      };
      const foreignKeys = database.prepare("PRAGMA foreign_keys").get() as {
        foreign_keys: number;
      };

      expect(journalMode.journal_mode).toBe("wal");
      expect(busyTimeout.timeout).toBe(5_000);
      expect(foreignKeys.foreign_keys).toBe(1);
    } finally {
      service.close();
    }
  });

  it("records the initial migration and does not reapply it on repeated initialization", async () => {
    const service = new PersistenceService(statePath);

    await service.savePulseState(state());
    service.close();
    await expect(service.loadPulseState()).resolves.toMatchObject(state());
    service.close();

    const database = openDatabase(statePath);
    try {
      const appliedMigrations = database
        .prepare("SELECT version, name FROM schema_migrations ORDER BY version")
        .all();

      expect(appliedMigrations).toEqual([
        {
          version: 1,
          name: "initial-schema",
        },
      ]);
    } finally {
      database.close();
    }
  });

  it("upgrades an existing database without schema_migrations", async () => {
    const database = openDatabase(statePath);
    try {
      database.exec(`
        CREATE TABLE pulse_logs (
          id INTEGER PRIMARY KEY,
          created_at INTEGER NOT NULL,
          type INTEGER NOT NULL,
          model_name TEXT NOT NULL,
          use_time REAL NOT NULL,
          channel INTEGER NOT NULL,
          channel_name TEXT NOT NULL
        );

        CREATE TABLE pulse_state (
          state_key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          saved_at TEXT NOT NULL
        );

        INSERT INTO pulse_logs (id, created_at, type, model_name, use_time, channel, channel_name)
        VALUES (42, 1704067200, 2, 'legacy-model', 1.5, 7, 'legacy-channel');

        INSERT INTO pulse_state (state_key, value, saved_at)
        VALUES ('last_seen_timestamp', '1704067200', '2024-01-01T00:00:00.000Z');
      `);
    } finally {
      database.close();
    }

    const service = new PersistenceService(statePath);
    const loadedState = await service.loadPulseState();

    expect(loadedState).toMatchObject({
      recentLogs: [
        {
          id: 42,
          created_at: 1_704_067_200,
          type: 2,
          model_name: "legacy-model",
          use_time: 1.5,
          channel: 7,
          channel_name: "legacy-channel",
        },
      ],
      cursor: {
        lastSeenTimestamp: 1_704_067_200,
      },
    });
    service.close();

    const upgradedDatabase = openDatabase(statePath);
    try {
      expect(
        upgradedDatabase
          .prepare("SELECT COUNT(*) AS count FROM schema_migrations")
          .get(),
      ).toEqual({ count: 1 });
    } finally {
      upgradedDatabase.close();
    }
  });

  it("closes the persistent database connection idempotently", async () => {
    const service = new PersistenceService(statePath);
    const savedState = state();

    await service.savePulseState(savedState);
    service.close();
    service.close();

    await expect(service.loadPulseState()).resolves.toMatchObject(savedState);
  });

  it("persists recentLogs, cursor, bootstrap, and pollStatus correctly", async () => {
    const service = new PersistenceService(statePath);
    const savedState = state({
      recentLogs: [
        log({
          id: 3,
          created_at: 1_704_067_320,
          type: 2,
          model_name: "claude-3-5-sonnet",
          use_time: 3.75,
          channel: 30,
          channel_name: "tertiary",
        }),
        log({
          id: 2,
          created_at: 1_704_067_260,
          type: 5,
          model_name: "gpt-4o-mini",
          use_time: 2.5,
          channel: 20,
          channel_name: "backup",
        }),
        log({
          id: 1,
          created_at: 1_704_067_200,
          type: 2,
          model_name: "gpt-4o-mini",
          use_time: 1.25,
          channel: 10,
          channel_name: "primary",
        }),
      ],
      cursor: {
        lastSeenTimestamp: 1_704_067_320,
      },
      bootstrap: {
        backfillCompletedAt: "2024-01-01T00:05:20.000Z",
      },
      pollStatus: {
        lastPollAt: "2024-01-01T00:06:00.000Z",
        lastPollSucceeded: false,
        lastErrorMessage: "upstream timeout",
      },
    });

    await service.savePulseState(savedState);

    const loadedState = await service.loadPulseState();
    expect(loadedState?.recentLogs).toEqual(savedState.recentLogs);
    expect(loadedState?.cursor).toEqual(savedState.cursor);
    expect(loadedState?.bootstrap).toEqual(savedState.bootstrap);
    expect(loadedState?.pollStatus).toEqual(savedState.pollStatus);
  });

  it("preserves a null cursor lastSeenTimestamp across save and load", async () => {
    const service = new PersistenceService(statePath);
    const savedState = state({
      cursor: {
        lastSeenTimestamp: null,
      },
    });

    await service.savePulseState(savedState);

    await expect(service.loadPulseState()).resolves.toMatchObject({
      cursor: {
        lastSeenTimestamp: null,
      },
    });
  });

  it("returns null when the state file does not exist", async () => {
    const service = new PersistenceService(statePath);

    await expect(service.loadPulseState()).resolves.toBeNull();
    expect(vi.spyOn(logger, "error")).not.toHaveBeenCalled();
  });

  it("returns a failure signal and logs an error when loading a corrupted database", async () => {
    const errorSpy = vi
      .spyOn(logger, "error")
      .mockImplementation(() => undefined);
    await writeFile(statePath, "not a sqlite database");
    const service = new PersistenceService(statePath);

    const loadedState = await service.loadPulseState();
    expect(loadedState).toMatchObject({
      kind: "persistence-load-failure",
      statePath,
      errorMessage: expect.any(String),
      recentLogs: [],
      cursor: {
        lastSeenTimestamp: null,
      },
      bootstrap: {
        backfillCompletedAt: null,
      },
      pollStatus: null,
    });
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.any(Error),
        statePath,
      }),
      "Failed to load llm-pulse state",
    );
  });

  it("incrementally upserts logs across multiple save and load roundtrips", async () => {
    const service = new PersistenceService(statePath);
    const firstState = state({
      recentLogs: [log({ id: 1, created_at: 1_704_067_200 })],
      cursor: {
        lastSeenTimestamp: 1_704_067_200,
      },
      pollStatus: null,
    });
    const secondState = state({
      recentLogs: [
        log({
          id: 1,
          created_at: 1_704_067_440,
          type: 5,
          model_name: "gpt-4o-mini",
          use_time: 5,
          channel: 50,
          channel_name: "updated-primary",
        }),
        log({
          id: 4,
          created_at: 1_704_067_380,
          type: 5,
          model_name: "claude-3-haiku",
          use_time: 4,
          channel: 40,
          channel_name: "quaternary",
        }),
      ],
      cursor: {
        lastSeenTimestamp: 1_704_067_380,
      },
      bootstrap: {
        backfillCompletedAt: null,
      },
      pollStatus: {
        lastPollAt: "2024-01-01T00:07:00.000Z",
        lastPollSucceeded: false,
        lastErrorMessage: "rate limited",
      },
    });

    await service.savePulseState(firstState);
    expect(await service.loadPulseState()).toMatchObject(firstState);

    await service.savePulseState(secondState);
    expect(await service.loadPulseState()).toMatchObject(secondState);

    await service.savePulseState(
      state({
        recentLogs: [
          log({
            id: 5,
            created_at: 1_704_067_500,
            type: 2,
            model_name: "gpt-4o-mini",
            use_time: 1,
            channel: 10,
            channel_name: "primary",
          }),
        ],
      }),
    );

    expect(
      (await service.loadPulseState())?.recentLogs.map(({ id }) => id),
    ).toEqual([5, 1, 4]);
  });

  it("prunes logs beyond MODEL_BUCKET_RETENTION_COUNT per model", async () => {
    const service = new PersistenceService(statePath);
    const retainedModelLogs = Array.from({ length: 61 }, (_, index) =>
      log({
        id: index + 1,
        created_at: 1_704_067_200 + index * 60,
        model_name: "gpt-4o-mini",
      }),
    );
    const otherModelLog = log({
      id: 100,
      created_at: 1_704_067_200,
      model_name: "claude-3-5-sonnet",
      channel: 20,
      channel_name: "backup",
    });

    await service.savePulseState(
      state({
        recentLogs: [...retainedModelLogs, otherModelLog],
      }),
    );

    const loadedState = await service.loadPulseState();
    const gptLogs = loadedState?.recentLogs.filter(
      (recentLog) => recentLog.model_name === "gpt-4o-mini",
    );
    const otherModelLogs = loadedState?.recentLogs.filter(
      (recentLog) => recentLog.model_name === "claude-3-5-sonnet",
    );

    expect(gptLogs).toHaveLength(60);
    expect(gptLogs?.map((recentLog) => recentLog.id)).not.toContain(1);
    expect(gptLogs?.[0]?.id).toBe(61);
    expect(otherModelLogs).toEqual([otherModelLog]);
  });
});
