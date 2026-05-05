export interface NormalizedLog {
  id: number;
  createdAt: number;
  type: number;
  modelName: string;
  channelId: number;
  channelName: string;
  promptTokens: number;
  cacheTokens: number;
  completionTokens: number;
  quota: number;
  useTimeSeconds: number;
}

export interface ModelBucketRow {
  modelName: string;
  bucketStart: number;
  successCount: number;
  errorCount: number;
  totalCount: number;
  latencySumSeconds: number;
  latencySamples: number;
  promptTokens: number;
  cacheTokens: number;
  completionTokens: number;
  quotaSum: number;
  lastSeenAt: number | null;
}

export interface ChannelBucketRow {
  modelName: string;
  channelId: number;
  channelName: string;
  bucketStart: number;
  successCount: number;
  errorCount: number;
  totalCount: number;
  latencySumSeconds: number;
  latencySamples: number;
  promptTokens: number;
  cacheTokens: number;
  completionTokens: number;
  quotaSum: number;
  lastSeenAt: number | null;
}

export interface SnapshotData {
  bootstrapCompletedAt: string | null;
  coveredUntilCreatedAt: number | null;
  coveredUntilId: number | null;
  lastRefreshAt: string | null;
  lastSuccessAt: string | null;
  enabledModels: Set<string>;
  models: Map<string, ModelBucketRow[]>;
  channels: Map<string, ChannelBucketRow[]>;
  processedLogCount: number;
}

export class SchemaMismatchError extends Error {
  readonly expected: number;
  readonly actual: number;

  constructor(expected: number, actual: number) {
    super(
      `Snapshot schema version mismatch: expected ${expected}, found ${actual}. Snapshot disabled until manual reset.`,
    );
    this.name = "SchemaMismatchError";
    this.expected = expected;
    this.actual = actual;
  }
}
