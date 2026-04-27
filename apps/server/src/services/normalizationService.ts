import type { ModelAvailability } from "@llm-pulse/shared";

export class NormalizationService {
  normalizeModels(models: ModelAvailability[]): ModelAvailability[] {
    return models.map((model) => ({
      modelName: model.modelName,
      status: model.status,
      successCount: model.successCount,
      errorCount: model.errorCount,
      totalCount: model.totalCount,
      successRate: model.successRate,
      averageLatencySeconds: model.averageLatencySeconds,
      lastSeenAt: model.lastSeenAt,
      heartbeat: model.heartbeat,
      beats: model.beats.map((beat) => ({
        start: beat.start,
        end: beat.end,
        status: beat.status,
        successCount: beat.successCount,
        errorCount: beat.errorCount,
        totalCount: beat.totalCount,
        successRate: beat.successRate,
        averageLatencySeconds: beat.averageLatencySeconds,
      })),
      channels: model.channels.map((channel) => ({
        channelId: channel.channelId,
        channelName: channel.channelName,
        status: channel.status,
        successCount: channel.successCount,
        errorCount: channel.errorCount,
        totalCount: channel.totalCount,
        successRate: channel.successRate,
        averageLatencySeconds: channel.averageLatencySeconds,
        lastSeenAt: channel.lastSeenAt,
        heartbeat: channel.heartbeat,
        beats: channel.beats.map((beat) => ({
          start: beat.start,
          end: beat.end,
          status: beat.status,
          successCount: beat.successCount,
          errorCount: beat.errorCount,
          totalCount: beat.totalCount,
          successRate: beat.successRate,
          averageLatencySeconds: beat.averageLatencySeconds,
        })),
      })),
    }));
  }
}

export const normalizationService = new NormalizationService();
