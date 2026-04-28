import type { ModelAvailability } from "@llm-pulse/shared";

/**
 * 预留的模型归一化扩展点，当前直接透传输入数据。
 */
export class NormalizationService {
  normalizeModels(models: ModelAvailability[]): ModelAvailability[] {
    return models;
  }
}

export const normalizationService = new NormalizationService();
