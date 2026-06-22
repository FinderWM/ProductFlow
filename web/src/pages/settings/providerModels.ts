// 供应商模型列表相关纯逻辑：查询 key、状态文案、模型过滤。从 SettingsPage.tsx 抽出，行为不变。

import { ApiError } from "../../lib/api";
import type { TranslateFunction } from "../../lib/preferences";
import type { ProviderModel } from "../../lib/types";
import type { ProviderModelKind } from "./types";

export function providerModelsQueryKey(profileId: string, providerKind: ProviderModelKind) {
  return ["provider-models", profileId, providerKind] as const;
}

export function providerModelsStatusText(models: ProviderModel[], error: unknown, t: TranslateFunction): string {
  if (error) {
    return error instanceof ApiError ? error.detail : t("settings.provider.modelsLoadFailed");
  }
  if (models.length > 0) {
    return t("settings.provider.modelsLoaded", { count: models.length });
  }
  return t("settings.provider.modelsEmpty");
}

export function filterProviderModels(models: ProviderModel[], query: string): ProviderModel[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return models;
  }
  return models.filter((model) => {
    const normalizedId = model.id.toLowerCase();
    const normalizedLabel = model.label.toLowerCase();
    return normalizedId.includes(normalizedQuery) || normalizedLabel.includes(normalizedQuery);
  });
}
