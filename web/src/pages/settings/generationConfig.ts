// 生成配置（文本/图像）的纯逻辑层：草稿模型、载荷转换、供应商能力映射、测试结果展示。
// 从 SettingsPage.tsx 抽出，行为不变。内部 helper 不导出，组件/测试所用的对外导出。

import type { TranslationKey } from "../../lib/i18n";
import type { TranslateFunction } from "../../lib/preferences";
import type {
  GenerationConfig,
  GenerationConfigCreateRequest,
  GenerationConfigTestResult,
  GenerationConfigUpdateRequest,
  ProviderCapability,
  ProviderConfigResponse,
  ProviderProfile,
} from "../../lib/types";
import { numberDraftValue, optionalNumberDraftValue } from "./draftValues";
import { generationConfigResourceGroupIds } from "./resourceGroups";
import type {
  GenerationConfigProviderKind,
  ImageProviderKind,
  TextProviderKind,
  TextStructuredOutputMode,
} from "./types";

export interface GenerationConfigDraft {
  id: string | null;
  resource_group_ids: string[];
  purpose: "text" | "image";
  name: string;
  provider_kind: TextProviderKind | ImageProviderKind;
  provider_profile_id: string;
  brief_model: string;
  copy_model: string;
  model: string;
  images_quality: string;
  images_style: string;
  responses_background_enabled: boolean;
  supports_image_understanding: boolean;
  structured_output_enabled: boolean;
  structured_output_mode: TextStructuredOutputMode;
  structured_json_response_format_enabled: boolean;
  gemini_api_version: string;
  gemini_output_mime_type: string;
  priority: string;
  max_concurrency: string;
  enabled: boolean;
  availability_window_minutes: string;
  failure_threshold: string;
  cooldown_minutes: string;
}

function textValue(record: Record<string, unknown> | undefined, key: string): string {
  const value = record?.[key];
  return typeof value === "string" ? value : "";
}

function boolValue(record: Record<string, unknown> | undefined, key: string, fallback: boolean): boolean {
  const value = record?.[key];
  return typeof value === "boolean" ? value : fallback;
}

export function textGenerationConfigSupportsImageUnderstanding(config: Record<string, unknown> | undefined): boolean {
  return boolValue(config, "supports_image_understanding", false);
}

export function isTextStructuredOutputProviderKind(providerKind: TextProviderKind | ImageProviderKind): boolean {
  return providerKind === "openai" || providerKind === "openai_chat_completions";
}

export function normalizedGenerationConfigProviderKind(
  purpose: "text" | "image",
  value: string,
): GenerationConfigProviderKind {
  if (purpose === "text") {
    return value === "openai" || value === "openai_chat_completions" ? value : "mock";
  }
  return value === "openai_responses" ||
    value === "openai_images" ||
    value === "openai_chat_image" ||
    value === "google_gemini_image"
    ? value
    : "mock";
}

function providerCapabilityForGenerationConfig(
  purpose: "text" | "image",
  providerKind: GenerationConfigProviderKind,
): ProviderCapability | null {
  if (providerKind === "mock") {
    return null;
  }
  if (purpose === "text") {
    return providerKind === "openai_chat_completions" ? "text_chat_completions" : "text_responses";
  }
  if (providerKind === "openai_responses") {
    return "image_responses";
  }
  if (providerKind === "openai_chat_image") {
    return "image_chat";
  }
  if (providerKind === "google_gemini_image") {
    return "image_google_gemini";
  }
  return "image_images";
}

export function providerProfileSupportsGenerationConfig(profile: ProviderProfile, draft: GenerationConfigDraft): boolean {
  const requiredCapability = providerCapabilityForGenerationConfig(draft.purpose, draft.provider_kind);
  if (!requiredCapability) {
    return false;
  }
  return profile.enabled && !profile.archived_at && profile.capabilities.includes(requiredCapability);
}

export function providerProfileIdAfterKindChange(
  profiles: ProviderProfile[],
  draft: GenerationConfigDraft,
  nextProviderKind: GenerationConfigProviderKind,
): string {
  if (nextProviderKind === "mock" || !draft.provider_profile_id) {
    return "";
  }
  const nextDraft = { ...draft, provider_kind: nextProviderKind };
  const selectedProfile = profiles.find((profile) => profile.id === draft.provider_profile_id);
  return selectedProfile && providerProfileSupportsGenerationConfig(selectedProfile, nextDraft)
    ? draft.provider_profile_id
    : "";
}

export function textStructuredOutputProviderInterfaceLabelKey(
  providerKind: TextProviderKind | ImageProviderKind,
): TranslationKey {
  return providerKind === "openai"
    ? "settings.provider.interface.openaiResponses"
    : "settings.provider.interface.openaiChatCompletions";
}

export function generationConfigProviderInterfaceLabelKey(providerKind: string): TranslationKey {
  if (providerKind === "openai" || providerKind === "openai_responses") {
    return "settings.provider.interface.openaiResponses";
  }
  if (providerKind === "openai_chat_completions") {
    return "settings.provider.interface.openaiChatCompletions";
  }
  if (providerKind === "openai_images") {
    return "settings.provider.interface.openaiImages";
  }
  if (providerKind === "openai_chat_image") {
    return "settings.provider.interface.openaiChatImage";
  }
  if (providerKind === "google_gemini_image") {
    return "settings.provider.interface.googleGeminiImage";
  }
  return "settings.provider.interface.mock";
}

function textStructuredOutputDraft(
  config: Record<string, unknown> | undefined,
): { enabled: boolean; mode: TextStructuredOutputMode } {
  const raw = config?.structured_output;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const structuredOutput = raw as Record<string, unknown>;
    const mode = structuredOutput.mode === "json_object" ? "json_object" : "json_schema";
    return {
      enabled: typeof structuredOutput.enabled === "boolean" ? structuredOutput.enabled : false,
      mode,
    };
  }
  const legacyEnabled = boolValue(config, "structured_json_response_format_enabled", false);
  return {
    enabled: legacyEnabled,
    mode: legacyEnabled ? "json_object" : "json_schema",
  };
}

export function generationConfigsForPurpose(
  data: ProviderConfigResponse | undefined,
  purpose: "text" | "image",
): GenerationConfig[] {
  return sortGenerationConfigsForDisplay(
    (data?.generation_configs ?? []).filter(
      (generationConfig) => generationConfig.purpose === purpose && !generationConfig.archived_at,
    ),
  );
}

export function sortGenerationConfigsForDisplay(configs: readonly GenerationConfig[]): GenerationConfig[] {
  return [...configs].sort((left, right) => {
    if (left.effective_enabled !== right.effective_enabled) {
      return left.effective_enabled ? -1 : 1;
    }
    return right.priority - left.priority || left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
  });
}

function emptyGenerationConfigDraft(purpose: "text" | "image"): GenerationConfigDraft {
  return {
    id: null,
    resource_group_ids: [],
    purpose,
    name: purpose === "text" ? "Text config" : "Image config",
    provider_kind: purpose === "text" ? "mock" : "mock",
    provider_profile_id: "",
    brief_model: "",
    copy_model: "",
    model: "",
    images_quality: "",
    images_style: "",
    responses_background_enabled: true,
    supports_image_understanding: false,
    structured_output_enabled: false,
    structured_output_mode: "json_schema",
    structured_json_response_format_enabled: false,
    gemini_api_version: "v1beta",
    gemini_output_mime_type: "",
    priority: "100",
    max_concurrency: "1",
    enabled: true,
    availability_window_minutes: "",
    failure_threshold: "",
    cooldown_minutes: "",
  };
}

export function newGenerationConfigDraft(
  purpose: "text" | "image",
  resourceGroupId: string,
): GenerationConfigDraft {
  return {
    ...emptyGenerationConfigDraft(purpose),
    resource_group_ids: resourceGroupId ? [resourceGroupId] : [],
  };
}

export function generationConfigDraft(config: GenerationConfig): GenerationConfigDraft {
  const providerKind =
    config.purpose === "text"
      ? config.provider_kind === "openai" || config.provider_kind === "openai_chat_completions"
        ? config.provider_kind
        : "mock"
      : config.provider_kind === "openai_responses" ||
          config.provider_kind === "openai_images" ||
          config.provider_kind === "openai_chat_image" ||
          config.provider_kind === "google_gemini_image"
        ? config.provider_kind
        : "mock";
  const structuredOutput = textStructuredOutputDraft(config.config);
  return {
    id: config.id,
    resource_group_ids: generationConfigResourceGroupIds(config),
    purpose: config.purpose,
    name: config.name,
    provider_kind: providerKind,
    provider_profile_id: config.provider_profile_id ?? "",
    brief_model: textValue(config.model_settings, "brief_model"),
    copy_model: textValue(config.model_settings, "copy_model"),
    model: textValue(config.model_settings, "model"),
    images_quality: textValue(config.config, "images_quality"),
    images_style: textValue(config.config, "images_style"),
    responses_background_enabled: boolValue(config.config, "responses_background_enabled", true),
    supports_image_understanding: textGenerationConfigSupportsImageUnderstanding(config.config),
    structured_output_enabled: structuredOutput.enabled,
    structured_output_mode: structuredOutput.mode,
    structured_json_response_format_enabled: structuredOutput.enabled,
    gemini_api_version: textValue(config.config, "gemini_api_version") || "v1beta",
    gemini_output_mime_type: textValue(config.config, "gemini_output_mime_type"),
    priority: String(config.priority),
    max_concurrency: String(config.max_concurrency),
    enabled: config.enabled,
    availability_window_minutes: String(config.availability_window_minutes),
    failure_threshold: String(config.failure_threshold),
    cooldown_minutes: String(config.cooldown_minutes),
  };
}

export function generationConfigPayloadFromDraft(
  draft: GenerationConfigDraft,
): GenerationConfigCreateRequest | GenerationConfigUpdateRequest {
  const model_settings =
    draft.purpose === "text"
      ? {
          ...(draft.brief_model.trim() ? { brief_model: draft.brief_model.trim() } : {}),
          ...(draft.copy_model.trim() ? { copy_model: draft.copy_model.trim() } : {}),
        }
      : draft.model.trim()
        ? { model: draft.model.trim() }
        : {};
  const config =
    draft.purpose === "text"
      ? {
          supports_image_understanding: draft.supports_image_understanding,
          ...(isTextStructuredOutputProviderKind(draft.provider_kind)
            ? {
                structured_output: {
                  enabled: draft.structured_output_enabled,
                  mode: draft.structured_output_mode,
                },
              }
            : {}),
        }
      : draft.provider_kind === "openai_responses"
      ? { responses_background_enabled: draft.responses_background_enabled }
      : draft.provider_kind === "openai_images"
        ? {
            ...(draft.images_quality.trim() ? { images_quality: draft.images_quality.trim() } : {}),
            ...(draft.images_style.trim() ? { images_style: draft.images_style.trim() } : {}),
          }
        : draft.provider_kind === "google_gemini_image"
          ? {
              gemini_api_version: draft.gemini_api_version || "v1beta",
              ...(draft.gemini_output_mime_type.trim()
                ? { gemini_output_mime_type: draft.gemini_output_mime_type.trim() }
                : {}),
            }
          : {};
  return {
    resource_group_id: draft.resource_group_ids[0] ?? null,
    resource_group_ids: draft.resource_group_ids,
    name: draft.name.trim(),
    purpose: draft.purpose,
    provider_kind: draft.provider_kind,
    provider_profile_id: draft.provider_kind === "mock" ? null : draft.provider_profile_id,
    model_settings,
    config,
    priority: numberDraftValue(draft.priority, 100),
    max_concurrency: numberDraftValue(draft.max_concurrency, 1),
    enabled: draft.enabled,
    availability_window_minutes: optionalNumberDraftValue(draft.availability_window_minutes),
    failure_threshold: optionalNumberDraftValue(draft.failure_threshold),
    cooldown_minutes: optionalNumberDraftValue(draft.cooldown_minutes),
  };
}

function defaultGenerationConfigName(purpose: "text" | "image"): string {
  return purpose === "text" ? "Text config" : "Image config";
}

function generationConfigNameUnedited(draft: GenerationConfigDraft, profiles: ProviderProfile[]): boolean {
  if (draft.name === defaultGenerationConfigName(draft.purpose)) {
    return true;
  }
  return profiles.some((profile) => draft.name === `${profile.name}-`);
}

export function generationConfigDraftAfterProviderProfileSelection(
  draft: GenerationConfigDraft,
  profiles: ProviderProfile[],
  providerProfileId: string,
  options: { isNew: boolean },
): GenerationConfigDraft {
  const selectedProfile = profiles.find((profile) => profile.id === providerProfileId);
  return {
    ...draft,
    provider_profile_id: providerProfileId,
    name:
      options.isNew && selectedProfile && generationConfigNameUnedited(draft, profiles)
        ? `${selectedProfile.name}-`
        : draft.name,
  };
}

export async function runGenerationConfigBatchTests<T>(
  items: T[],
  concurrency: number,
  run: (item: T) => Promise<void> | void,
): Promise<void> {
  const limit = Math.max(1, Math.floor(concurrency) || 1);
  let nextIndex = 0;
  const workerCount = Math.min(limit, items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex];
        nextIndex += 1;
        try {
          await run(item);
        } catch {
          // Individual test mutations own per-card failure state.
        }
      }
    }),
  );
}

export function generationConfigBatchSelectableIds(
  items: Array<{ config: Pick<GenerationConfig, "id" | "enabled">; disabled: boolean }>,
  options?: { includeDisabledConfigs?: boolean },
): string[] {
  return items
    .filter((item) => !item.disabled && (options?.includeDisabledConfigs || item.config.enabled))
    .map((item) => item.config.id);
}

export function generationConfigBatchFailedSelectableIds(
  items: Array<{ config: Pick<GenerationConfig, "id" | "enabled" | "latest_test_result">; disabled: boolean }>,
  options?: { includeDisabledConfigs?: boolean },
): string[] {
  return items
    .filter(
      (item) =>
        !item.disabled &&
        (options?.includeDisabledConfigs || item.config.enabled) &&
        generationConfigHasFailedLatestTest(item.config),
    )
    .map((item) => item.config.id);
}

export function generationConfigManualTestBlocked(
  config: Pick<GenerationConfig, "enabled" | "effective_enabled">,
): boolean {
  return config.enabled && !config.effective_enabled;
}

export function generationConfigSuccessRate(config: GenerationConfig): string {
  const stat = config.today_stat;
  if (!stat || stat.attempt_count <= 0) {
    return "0%";
  }
  return `${Math.round((stat.success_count / stat.attempt_count) * 100)}%`;
}

export function generationConfigLatestTestTypeLabelKey(testType: GenerationConfigTestResult["test_type"]): TranslationKey {
  if (testType === "image") {
    return "settings.generation.latestTestImage";
  }
  if (testType === "json_response_format") {
    return "settings.generation.latestTestJsonResponseFormat";
  }
  return "settings.generation.latestTestText";
}

function generationConfigModelSummaryText(summary: Record<string, unknown>, key: string): string {
  const value = summary[key];
  return typeof value === "string" && value.trim() ? value : "--";
}

export function generationConfigLatestTestDetail(result: GenerationConfigTestResult, t: TranslateFunction): string {
  const details: string[] = [];
  if (result.status === "failed") {
    const errorDetail = result.error_detail || result.message;
    if (errorDetail) {
      details.push(errorDetail);
    }
  } else if (result.test_type === "text") {
    details.push(
      t("settings.generation.latestTestTextModels", {
        briefModel: generationConfigModelSummaryText(result.model_summary, "brief_model"),
        copyModel: generationConfigModelSummaryText(result.model_summary, "copy_model"),
      }),
    );
  } else if (result.test_type === "image") {
    details.push(
      t("settings.generation.latestTestImageModel", {
        model: generationConfigModelSummaryText(result.model_summary, "model_name"),
      }),
    );
  } else {
    details.push(
      t("settings.generation.latestTestJsonModel", {
        model: generationConfigModelSummaryText(result.model_summary, "model"),
      }),
    );
  }
  if (result.duration_ms !== null) {
    details.push(
      t("settings.generation.latestTestDuration", {
        duration: String(Math.max(1, Math.round(result.duration_ms))),
      }),
    );
  }
  return details.join(" · ");
}

export function generationConfigTabClassName(active: boolean): string {
  return [
    "pf-settings-generation-tab inline-flex min-h-9 items-center px-3 py-2 text-sm font-semibold transition-all",
    active ? "is-active" : "",
  ].join(" ");
}

export function providerProfilesForGenerationConfig(
  profiles: ProviderProfile[],
  draft: GenerationConfigDraft,
  selectedProfileId = "",
): ProviderProfile[] {
  return profiles.filter(
    (profile) =>
      providerProfileSupportsGenerationConfig(profile, draft) ||
      (selectedProfileId && profile.id === selectedProfileId && !profile.archived_at),
  );
}

export function filterGenerationConfigsByName(configs: GenerationConfig[], query: string): GenerationConfig[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return configs;
  }
  return configs.filter((config) => config.name.toLowerCase().includes(normalizedQuery));
}

export function generationConfigHasFailedLatestTest(
  config: Pick<GenerationConfig, "latest_test_result">,
): boolean {
  return config.latest_test_result?.status === "failed";
}

export function filterGenerationConfigsByLatestTestFailure(
  configs: GenerationConfig[],
  failedOnly: boolean,
): GenerationConfig[] {
  if (!failedOnly) {
    return configs;
  }
  return configs.filter(generationConfigHasFailedLatestTest);
}
