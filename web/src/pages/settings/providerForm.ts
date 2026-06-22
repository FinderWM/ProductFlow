// 供应商档案表单状态、抽屉视图状态、用量判定与创建/更新载荷构造。
// 从 SettingsPage.tsx 抽出的纯逻辑。

import type { TranslationKey } from "../../lib/i18n";
import type {
  GenerationConfig,
  GenerationResourceGroup,
  ProviderCapability,
  ProviderProfile,
  ProviderProfileCreateRequest,
  ProviderProfileUpdateRequest,
  ProviderType,
} from "../../lib/types";

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

export interface ProviderProfileFormState {
  name: string;
  provider_type: ProviderType;
  base_url: string;
  api_key: string;
  capabilities: ProviderCapability[];
  enabled: boolean;
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
};

export const PROVIDER_CAPABILITY_OPTIONS: Array<{ value: ProviderCapability; labelKey: TranslationKey }> = [
  { value: "text_responses", labelKey: "settings.provider.capability.textResponses" },
  { value: "text_chat_completions", labelKey: "settings.provider.capability.textChatCompletions" },
  { value: "image_responses", labelKey: "settings.provider.capability.imageResponses" },
  { value: "image_images", labelKey: "settings.provider.capability.imageImages" },
  { value: "image_chat", labelKey: "settings.provider.capability.imageChat" },
  { value: "image_google_gemini", labelKey: "settings.provider.capability.imageGoogleGemini" },
];

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
  };
}
