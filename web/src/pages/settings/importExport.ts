import type { SettingsExportPayload, SettingsImportPreviewResponse } from "../../lib/types";

export interface SettingsImportSummaryCounts {
  runtimeConfigCount: number;
  providerProfileCount: number;
  providerBindingCount: number;
  generationConfigCount: number;
  canvasTemplateCategoryCount: number;
  canvasTemplateCount: number;
  providerProfilesWithApiKeyCount: number;
}

export function settingsExportFilename(exportedAt: string | null | undefined): string {
  if (!exportedAt) {
    return "productflow-settings.json";
  }
  const date = new Date(exportedAt);
  if (Number.isNaN(date.getTime())) {
    return "productflow-settings.json";
  }
  return `productflow-settings-${date.toISOString().slice(0, 19).replace("T", "-").replace(/:/g, "")}.json`;
}

export function settingsImportSummaryCounts(preview: SettingsImportPreviewResponse): SettingsImportSummaryCounts {
  return {
    runtimeConfigCount: preview.runtime_config_count,
    providerProfileCount: preview.provider_profile_count,
    providerBindingCount: preview.provider_binding_count,
    generationConfigCount: preview.generation_config_count,
    canvasTemplateCategoryCount: preview.canvas_template_category_count,
    canvasTemplateCount: preview.canvas_template_count,
    providerProfilesWithApiKeyCount: preview.provider_profiles_with_api_key_count,
  };
}

export function downloadSettingsExport(payload: SettingsExportPayload): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = settingsExportFilename(payload.metadata.exported_at);
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

export function isSettingsExportPayload(value: unknown): value is SettingsExportPayload {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isRecord(value.metadata) &&
    isRecord(value.runtime_config) &&
    Array.isArray(value.provider_profiles) &&
    Array.isArray(value.provider_bindings) &&
    Array.isArray(value.generation_configs) &&
    Array.isArray(value.canvas_template_categories) &&
    Array.isArray(value.canvas_templates)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
