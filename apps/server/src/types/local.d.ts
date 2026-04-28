declare namespace NodeJS {
  interface ProcessEnv {
    NODE_ENV?: string;
    PORT?: string;
    BFF_PORT?: string;
    NEW_API_BASE_URL?: string;
    NEW_API_ADMIN_USERNAME?: string;
    NEW_API_ADMIN_PASSWORD?: string;
    POLL_INTERVAL_MS?: string;
    LOG_PAGE_SIZE?: string;
    LOG_MAX_PAGES_PER_POLL?: string;
    LOG_REWIND_SECONDS?: string;
    AVAILABILITY_WINDOW_SECONDS?: string;
    INITIAL_BACKFILL_HOURS?: string;
    INITIAL_BACKFILL_MAX_PAGES?: string;
    PULSE_DB_FILE?: string;
  }
}

declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string);
    close(): void;
    exec(sql: string): void;
    prepare(sql: string): {
      run: (...params: unknown[]) => unknown;
      get: (...params: unknown[]) => unknown;
      all: (...params: unknown[]) => unknown[];
    };
  }
}

declare module "@llm-pulse/shared" {
  export type AvailabilityStatus =
    | "available"
    | "degraded"
    | "unavailable"
    | "unknown";

  export interface AvailabilityResponse {
    generatedAt: string;
    window: AvailabilityWindow;
    heartbeat: HeartbeatWindow;
    summary: AvailabilitySummary;
    models: ModelAvailability[];
  }

  export interface AvailabilityWindow {
    from: string;
    to: string;
    seconds: number;
  }

  export interface AvailabilitySummary {
    totalModels: number;
    availableModels: number;
    degradedModels: number;
    unavailableModels: number;
    unknownModels: number;
  }

  export interface ModelAvailability {
    modelName: string;
    status: AvailabilityStatus;
    successCount: number;
    errorCount: number;
    totalCount: number;
    successRate: number;
    averageLatencySeconds: number | null;
    lastSeenAt: string | null;
    heartbeat: HeartbeatSummary;
    beats: HeartbeatBucket[];
    channels: ChannelAvailability[];
  }

  export interface ChannelAvailability {
    channelId: number;
    channelName: string;
    status: AvailabilityStatus;
    successCount: number;
    errorCount: number;
    totalCount: number;
    successRate: number;
    averageLatencySeconds: number | null;
    lastSeenAt: string | null;
    heartbeat: HeartbeatSummary;
    beats: HeartbeatBucket[];
  }

  export interface HeartbeatWindow {
    bucketSeconds: number;
    bucketCount: number;
    from: string;
    to: string;
  }

  export interface HeartbeatSummary {
    healthyBuckets: number;
    degradedBuckets: number;
    unavailableBuckets: number;
    unknownBuckets: number;
    observedBuckets: number;
    availabilityRate: number | null;
    lastStatus: AvailabilityStatus;
    lastBeatAt: string | null;
  }

  export interface HeartbeatBucket {
    start: string;
    end: string;
    status: AvailabilityStatus;
    successCount: number;
    errorCount: number;
    totalCount: number;
    successRate: number;
    averageLatencySeconds: number | null;
  }

  export type NewApiLogType = 2 | 5 | (number & {});

  export interface NewApiLogQuery {
    p?: number;
    page_size?: number;
    start_timestamp?: number;
  }

  export interface NewApiLogResponse {
    success: boolean;
    message: string;
    data: {
      page: number;
      page_size: number;
      total: number;
      items: NewApiLogItem[];
    };
  }

  export interface NewApiLogItem {
    id: number;
    user_id: number;
    created_at: number;
    type: NewApiLogType;
    content: string;
    username: string;
    token_name: string;
    model_name: string;
    quota: number;
    prompt_tokens: number;
    completion_tokens: number;
    use_time: number;
    is_stream: boolean;
    channel: number;
    channel_name: string;
    token_id: number;
    group: string;
    ip: string;
    request_id: string;
    other: string;
  }
}
