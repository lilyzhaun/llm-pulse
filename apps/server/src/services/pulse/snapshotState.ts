import type { SnapshotStore } from "../snapshot/store.js";

export interface SnapshotStatus {
  enabled: boolean;
  ready: boolean;
  bootstrapCompletedAt: string | null;
  lastRefreshAt: string | null;
  coveredUntil: number | null;
  lagSeconds: number | null;
  lastRefreshSucceeded: boolean | null;
  processedLogCount: number | null;
}

export class PulseSnapshotState {
  private snapshotStore: SnapshotStore | null = null;
  private snapshotEnabledForProcess: boolean;
  private snapshotLastRefreshSucceeded: boolean | null = null;

  constructor(snapshotEnabled: boolean) {
    this.snapshotEnabledForProcess = snapshotEnabled;
  }

  configureSnapshotStore(store: SnapshotStore | null): void {
    this.snapshotStore = store;
  }

  disableSnapshotForProcess(): void {
    this.snapshotEnabledForProcess = false;
  }

  shouldUseSnapshotPath(): boolean {
    return Boolean(
      this.snapshotEnabledForProcess &&
        this.snapshotStore &&
        this.snapshotStore.isReady(),
    );
  }

  getStore(): SnapshotStore | null {
    return this.snapshotStore;
  }

  markSnapshotRefreshResult(succeeded: boolean): void {
    this.snapshotLastRefreshSucceeded = succeeded;
  }

  getSnapshotStatus(): SnapshotStatus {
    if (!this.snapshotEnabledForProcess || !this.snapshotStore) {
      return {
        enabled: false,
        ready: false,
        bootstrapCompletedAt: null,
        lastRefreshAt: null,
        coveredUntil: null,
        lagSeconds: null,
        lastRefreshSucceeded: this.snapshotLastRefreshSucceeded,
        processedLogCount: null,
      };
    }

    const snapshot = this.snapshotStore.readSnapshot();
    const lagSeconds =
      snapshot.coveredUntilCreatedAt === null
        ? null
        : Math.max(
            0,
            Math.floor(Date.now() / 1000) - snapshot.coveredUntilCreatedAt,
          );

    return {
      enabled: true,
      ready: this.snapshotStore.isReady(),
      bootstrapCompletedAt: snapshot.bootstrapCompletedAt,
      lastRefreshAt: snapshot.lastRefreshAt,
      coveredUntil: snapshot.coveredUntilCreatedAt,
      lagSeconds,
      lastRefreshSucceeded: this.snapshotLastRefreshSucceeded,
      processedLogCount: snapshot.processedLogCount,
    };
  }
}
