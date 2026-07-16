// 供应商档案表单状态、抽屉视图状态、用量判定与创建/更新载荷构造。
// 从 SettingsPage.tsx 抽出的纯逻辑。

import type { TranslationKey } from "../../lib/i18n";
import {
  IMAGE_GENERATION_DIMENSION_MULTIPLE,
  IMAGE_GENERATION_MAX_MAX_DIMENSION,
  IMAGE_GENERATION_MIN_MAX_DIMENSION,
} from "../../lib/imageSizes";
import type {
  GenerationConfig,
  GenerationResourceGroup,
  ProviderCapability,
  ProviderProfile,
  ProviderProfileCreateRequest,
  ProviderProfileUpdateRequest,
  ProviderType,
} from "../../lib/types";
import { sortGenerationConfigsForDisplay } from "./generationConfig";

export function filterProviderProfiles(profiles: ProviderProfile[], query: string): ProviderProfile[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return profiles;
  }
  return profiles.filter((profile) =>
    [profile.name, profile.id, profile.base_url ?? "", profile.provider_type].some((value) =>
      value.toLowerCase().includes(normalizedQuery),
    ),
  );
}

export function filterProviderProfilesByName(profiles: ProviderProfile[], query: string): ProviderProfile[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return profiles;
  }
  return profiles.filter((profile) => profile.name.toLowerCase().includes(normalizedQuery));
}

export function filterProviderProfilesForList(
  profiles: ProviderProfile[],
  query: string,
  enabled: boolean,
): ProviderProfile[] {
  return filterProviderProfilesByName(
    profiles.filter((profile) => !profile.archived_at && profile.enabled === enabled),
    query,
  );
}

export function providerCapabilityLabelKey(capability: ProviderCapability): TranslationKey {
  return (
    PROVIDER_CAPABILITY_OPTIONS.find((option) => option.value === capability)?.labelKey ??
    "settings.provider.capability.imageGoogleGemini"
  );
}

export function defaultCapabilitiesForProviderType(providerType: ProviderType): ProviderCapability[] {
  return providerType === "google_gemini" ? ["image_google_gemini"] : ["text_responses", "image_images"];
}

export function providerTypeLabelKey(providerType: ProviderType): TranslationKey {
  return providerType === "google_gemini"
    ? "settings.provider.type.googleGemini"
    : "settings.provider.type.openaiCompatible";
}

export function providerDefaultEndpointLabelKey(profile: ProviderProfile): TranslationKey {
  return profile.provider_type === "google_gemini"
    ? "settings.provider.defaultGoogleEndpoint"
    : "settings.provider.defaultBaseUrl";
}

export const PROVIDER_IMAGE_MAX_DIMENSION_PRESETS = [1024, 1536, 2048, 3072, 3840] as const;
export const PROVIDER_IMAGE_MAX_DIMENSION_GLOBAL_OPTION = "__global__";
export const PROVIDER_IMAGE_MAX_DIMENSION_CUSTOM_OPTION = "__custom__";

export type ProviderImageMaxDimensionMode = "preset" | "custom";

function normalizeProviderImageMaxDimensionNumber(value: number): number {
  const normalized = value - (value % IMAGE_GENERATION_DIMENSION_MULTIPLE);
  return Math.max(IMAGE_GENERATION_MIN_MAX_DIMENSION, normalized);
}

export function coerceProviderImageMaxDimension(value: unknown): number | null {
  if (value == null || typeof value === "boolean") {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || !/^\d+$/.test(trimmed)) {
      return null;
    }
    return coerceProviderImageMaxDimension(Number(trimmed));
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return null;
  }
  if (value < IMAGE_GENERATION_MIN_MAX_DIMENSION || value > IMAGE_GENERATION_MAX_MAX_DIMENSION) {
    return null;
  }
  return normalizeProviderImageMaxDimensionNumber(value);
}

export function parseProviderImageMaxDimensionDraft(raw: string): { value: number | null; invalid: boolean } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { value: null, invalid: false };
  }
  if (!/^\d+$/.test(trimmed)) {
    return { value: null, invalid: true };
  }
  const parsed = Number(trimmed);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < IMAGE_GENERATION_MIN_MAX_DIMENSION ||
    parsed > IMAGE_GENERATION_MAX_MAX_DIMENSION
  ) {
    return { value: null, invalid: true };
  }
  return { value: normalizeProviderImageMaxDimensionNumber(parsed), invalid: false };
}

function providerImageMaxDimensionUsesCustomMode(value: number | null): boolean {
  return value != null && !PROVIDER_IMAGE_MAX_DIMENSION_PRESETS.includes(value as (typeof PROVIDER_IMAGE_MAX_DIMENSION_PRESETS)[number]);
}

function providerImageMaxDimensionFormState(
  value: unknown,
): Pick<ProviderProfileFormState, "image_max_dimension" | "image_max_dimension_mode" | "image_max_dimension_custom_value"> {
  const normalized = coerceProviderImageMaxDimension(value);
  const custom = providerImageMaxDimensionUsesCustomMode(normalized);
  return {
    image_max_dimension: normalized,
    image_max_dimension_mode: custom ? "custom" : "preset",
    image_max_dimension_custom_value: custom && normalized != null ? String(normalized) : "",
  };
}

export function providerImageMaxDimensionSelectValue(
  form: Pick<ProviderProfileFormState, "image_max_dimension" | "image_max_dimension_mode">,
): string {
  if (form.image_max_dimension_mode === "custom") {
    return PROVIDER_IMAGE_MAX_DIMENSION_CUSTOM_OPTION;
  }
  if (form.image_max_dimension == null) {
    return PROVIDER_IMAGE_MAX_DIMENSION_GLOBAL_OPTION;
  }
  return String(form.image_max_dimension);
}

export function providerImageMaxDimensionFormInvalid(
  form: Pick<ProviderProfileFormState, "image_max_dimension_mode" | "image_max_dimension_custom_value">,
): boolean {
  return form.image_max_dimension_mode === "custom" && parseProviderImageMaxDimensionDraft(form.image_max_dimension_custom_value).invalid;
}

export interface ProviderProfileFormState {
  name: string;
  provider_type: ProviderType;
  base_url: string;
  api_key: string;
  capabilities: ProviderCapability[];
  enabled: boolean;
  image_max_dimension: number | null;
  image_max_dimension_mode: ProviderImageMaxDimensionMode;
  image_max_dimension_custom_value: string;
}

export interface ProviderProfileUsage {
  text: boolean;
  image: boolean;
}

export interface ProviderDrawerViewState {
  open: boolean;
  editingProfileId: string | null;
  form: ProviderProfileFormState;
}

export const EMPTY_PROVIDER_FORM: ProviderProfileFormState = {
  name: "",
  provider_type: "openai_compatible",
  base_url: "",
  api_key: "",
  capabilities: ["text_responses", "image_images"],
  enabled: true,
  image_max_dimension: null,
  image_max_dimension_mode: "preset",
  image_max_dimension_custom_value: "",
};

export const PROVIDER_CAPABILITY_OPTIONS: Array<{ value: ProviderCapability; labelKey: TranslationKey }> = [
  { value: "text_responses", labelKey: "settings.provider.capability.textResponses" },
  { value: "text_chat_completions", labelKey: "settings.provider.capability.textChatCompletions" },
  { value: "image_responses", labelKey: "settings.provider.capability.imageResponses" },
  { value: "image_images", labelKey: "settings.provider.capability.imageImages" },
  { value: "image_chat", labelKey: "settings.provider.capability.imageChat" },
  { value: "image_google_gemini", labelKey: "settings.provider.capability.imageGoogleGemini" },
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function providerImageMaxDimension(config: Record<string, unknown> | undefined): number | null {
  const capabilities = asRecord(asRecord(config)?.capabilities);
  const value = capabilities?.image_max_dimension;
  return coerceProviderImageMaxDimension(value);
}

export function providerFormFromProfile(profile?: ProviderProfile | null): ProviderProfileFormState {
  if (!profile) {
    return EMPTY_PROVIDER_FORM;
  }
  return {
    name: profile.name,
    provider_type: profile.provider_type,
    base_url: profile.base_url ?? "",
    api_key: "",
    capabilities: profile.capabilities,
    enabled: profile.enabled,
    ...providerImageMaxDimensionFormState(providerImageMaxDimension(profile.config)),
  };
}

export function providerDrawerCreateState(): ProviderDrawerViewState {
  return {
    open: true,
    editingProfileId: null,
    form: EMPTY_PROVIDER_FORM,
  };
}

export function providerDrawerEditState(profile: ProviderProfile): ProviderDrawerViewState {
  return {
    open: true,
    editingProfileId: profile.id,
    form: providerFormFromProfile(profile),
  };
}

export function providerUsageFromGenerationConfigs(
  generationConfigs: GenerationConfig[],
  profileId: string,
): ProviderProfileUsage {
  return {
    text: generationConfigs.some(
      (generationConfig) =>
        generationConfig.purpose === "text" &&
        generationConfig.provider_profile_id === profileId &&
        !generationConfig.archived_at,
    ),
    image: generationConfigs.some(
      (generationConfig) =>
        generationConfig.purpose === "image" &&
        generationConfig.provider_profile_id === profileId &&
        !generationConfig.archived_at,
    ),
  };
}

export function providerUsageFromProfile(
  profile: Pick<ProviderProfile, "used_by_text_generation" | "used_by_image_generation">,
): ProviderProfileUsage {
  return {
    text: Boolean(profile.used_by_text_generation),
    image: Boolean(profile.used_by_image_generation),
  };
}

export function providerUsageLabelKeys(usage: ProviderProfileUsage): TranslationKey[] {
  const labels: TranslationKey[] = [];
  if (usage.text) {
    labels.push("settings.provider.usageText");
  }
  if (usage.image) {
    labels.push("settings.provider.usageImage");
  }
  return labels;
}

export function providerDisableBlocked(profile: ProviderProfile, usage: ProviderProfileUsage): boolean {
  void profile;
  void usage;
  return false;
}

export function generationConfigsUsingProvider(
  generationConfigs: GenerationConfig[],
  profileId: string,
): GenerationConfig[] {
  return generationConfigs.filter(
    (generationConfig) => generationConfig.provider_profile_id === profileId && !generationConfig.archived_at,
  );
}

export function providerGenerationConfigsForUsage(
  generationConfigs: GenerationConfig[],
  profileId: string,
  purpose: "text" | "image",
): GenerationConfig[] {
  return sortGenerationConfigsForDisplay(
    generationConfigs.filter(
      (generationConfig) =>
        generationConfig.provider_profile_id === profileId &&
        generationConfig.purpose === purpose &&
        !generationConfig.archived_at,
    ),
  );
}

export function settingsGenerationResourceGroupsInApiOrder(
  groups: readonly GenerationResourceGroup[] | null | undefined,
): GenerationResourceGroup[] {
  return (groups ?? []).filter((group) => !group.archived_at);
}

export function providerProfileCreatePayload(form: ProviderProfileFormState): ProviderProfileCreateRequest {
  return {
    name: form.name.trim(),
    provider_type: form.provider_type,
    base_url: form.provider_type === "google_gemini" ? null : form.base_url.trim() || null,
    api_key: form.api_key.trim() || null,
    capabilities: form.capabilities,
    enabled: form.enabled,
    config: {
      capabilities: {
        image_max_dimension: form.image_max_dimension,
      },
    },
  };
}

export function providerProfileUpdatePayload(form: ProviderProfileFormState): ProviderProfileUpdateRequest {
  return {
    name: form.name.trim(),
    provider_type: form.provider_type,
    base_url: form.provider_type === "google_gemini" ? null : form.base_url.trim() || null,
    api_key: form.api_key,
    capabilities: form.capabilities,
    enabled: form.enabled,
    config: {
      capabilities: {
        image_max_dimension: form.image_max_dimension,
      },
    },
  };
}
