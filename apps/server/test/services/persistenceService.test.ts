import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sqlite", () => require(`node:${"sqlite"}`));

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

  it("returns null and logs a warning when loading a corrupted database", async () => {
    const warnSpy = vi
      .spyOn(logger, "warn")
      .mockImplementation(() => undefined);
    await writeFile(statePath, "not a sqlite database");
    const service = new PersistenceService(statePath);

    await expect(service.loadPulseState()).resolves.toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
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

    expect((await service.loadPulseState())?.recentLogs.map(({ id }) => id)).toEqual([
      5, 1, 4,
    ]);
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
