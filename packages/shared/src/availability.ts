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
