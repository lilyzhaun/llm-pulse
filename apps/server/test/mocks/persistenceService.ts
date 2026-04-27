export interface PersistedPulseLog {
  id: number;
  created_at: number;
  type: number;
  model_name: string;
  use_time: number;
  channel: number;
  channel_name: string;
}

export interface PersistedPollStatus {
  lastPollAt: string;
  lastPollSucceeded: boolean;
  lastErrorMessage: string | null;
}

export interface PersistedPulseState {
  version: number;
  savedAt: string;
  recentLogs: PersistedPulseLog[];
  cursor: {
    lastSeenTimestamp: number | null;
  };
  bootstrap: {
    backfillCompletedAt: string | null;
  };
  pollStatus: PersistedPollStatus | null;
}

export const persistenceService = {
  async loadPulseState(): Promise<PersistedPulseState | null> {
    return null;
  },
  async savePulseState(): Promise<void> {
    return undefined;
  },
};
