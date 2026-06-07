import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, FormEvent, ReactNode, RefObject } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  FileJson,
  Image,
  KeyRound,
  Link2,
  Layers3,
  Pencil,
  Plus,
  Loader2,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ServerCog,
  Settings as SettingsIcon,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { ConfirmDialog } from "../components/ConfirmDialog";
import {
  ParameterHelpLabel,
  type ParameterHelpContentOverride,
} from "../components/ParameterHelp";
import { SelectField } from "../components/SelectField";
import { TopNav } from "../components/TopNav";
import { api, ApiError } from "../lib/api";
import type { TranslationKey } from "../lib/i18n";
import type { ParameterHelpKey } from "../lib/parameterHelp";
import { useI18n } from "../lib/preferences";
import {
  API_GLOBAL_TEMPLATES_MANAGE,
  API_SETTINGS_MIGRATE,
  API_SETTINGS_PROVIDER_WRITE,
  API_SETTINGS_WRITE,
  hasSessionApiPermission,
} from "../lib/rbac";
import { useSessionState } from "../lib/session";
import type {
  ConfigItem,
  ConfigResponse,
  ProviderCapability,
  ProviderConfigResponse,
  GenerationConfig,
  GenerationConfigCreateRequest,
  GenerationConfigUpdateRequest,
  GenerationResourceGroup,
  GenerationResourceGroupCreateRequest,
  GenerationResourceGroupUpdateRequest,
  ProviderModel,
  ProviderProfile,
  ProviderProfileCreateRequest,
  ProviderProfileUpdateRequest,
  ProviderType,
  SettingsExportPayload,
  SettingsImportPreviewResponse,
  TextGenerationConfigTestRequest,
  TextGenerationConfigTestResponse,
} from "../lib/types";
import {
  downloadSettingsExport,
  isSettingsExportPayload,
  settingsImportSummaryCounts,
} from "./settings/importExport";

type DraftValue = string | boolean | string[];
export type SettingsSectionId =
  | "providers"
  | "resourceGroups"
  | "text"
  | "image"
  | "prompts"
  | "upload"
  | "queue"
  | "globalTemplates"
  | "security"
  | "migration";

interface DraftSnapshot {
  value: DraftValue;
}

interface ConfigDraftState {
  drafts: Record<string, DraftValue>;
  snapshots: Record<string, DraftSnapshot>;
}

interface SettingsSection {
  id: SettingsSectionId;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  groupKey: TranslationKey;
  icon: LucideIcon;
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

export interface GenerationConfigDraft {
  id: string | null;
  resource_group_id: string;
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
  gemini_api_version: string;
  gemini_output_mime_type: string;
  priority: string;
  max_concurrency: string;
  enabled: boolean;
  availability_window_minutes: string;
  failure_threshold: string;
  cooldown_minutes: string;
}

export interface GenerationResourceGroupDraft {
  id: string | null;
  key: string;
  name: string;
  description: string;
  sort_order: string;
  enabled: boolean;
}

export interface TextConfigTestDraft {
  inspirationName: string;
  category: string;
  price: string;
  sourceNote: string;
  instruction: string;
}

export interface TextConfigTestRecord {
  testing: boolean;
  result: TextGenerationConfigTestResponse | null;
  error: string;
}

export interface TextConfigTestState {
  draft: TextConfigTestDraft;
  latestKey: string | null;
  records: Record<string, TextConfigTestRecord>;
}

interface TextGenerationConfigTestMutationInput {
  key: string;
  payload: TextGenerationConfigTestRequest;
}

type TextProviderKind = "mock" | "openai";
type ImageProviderKind = "mock" | "openai_responses" | "openai_images" | "google_gemini_image";
type ProviderModelKind = TextProviderKind | ImageProviderKind;

const INPUT_CLASS =
  "h-11 w-full rounded-lg border border-slate-200 bg-slate-50 px-4 text-sm text-slate-950 " +
  "placeholder:text-slate-400 shadow-sm shadow-slate-200/35 focus:border-indigo-500 focus:bg-white " +
  "focus:outline-none focus:ring-1 focus:ring-indigo-500 " +
  "dark:border-slate-700 dark:bg-[#111b2d] dark:text-slate-100 dark:shadow-black/20 " +
  "dark:placeholder:text-slate-500 dark:focus:border-violet-400 dark:focus:bg-[#111b2d]";

const TEXTAREA_CLASS =
  "w-full rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 " +
  "placeholder:text-slate-400 shadow-sm shadow-slate-200/35 focus:border-indigo-500 focus:bg-white " +
  "focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-slate-700 dark:bg-[#111b2d] " +
  "dark:text-slate-100 dark:shadow-black/20 dark:placeholder:text-slate-500 dark:focus:border-violet-400";

const PANEL_CLASS =
  "rounded-xl border border-slate-200 bg-white p-6 shadow-sm shadow-slate-200/60 " +
  "dark:border-slate-800 dark:bg-[#0f1726] dark:shadow-black/25";

const SETTINGS_MAIN_ACTION_CLASS =
  "inline-flex h-11 items-center justify-center rounded-lg bg-indigo-600 px-5 text-sm font-semibold text-white " +
  "shadow-sm shadow-indigo-500/25 hover:bg-indigo-500 disabled:opacity-50 dark:bg-violet-500 dark:hover:bg-violet-400";

const PROVIDER_DRAWER_INPUT_CLASS =
  "h-[43px] w-full rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium text-slate-950 " +
  "placeholder:text-slate-400 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 " +
  "dark:border-slate-700 dark:bg-[#192234] dark:text-slate-100 dark:placeholder:text-slate-500 " +
  "dark:focus:border-violet-500 dark:focus:ring-violet-500/35";

const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    id: "providers",
    labelKey: "settings.section.providers",
    descriptionKey: "settings.section.providersDescription",
    groupKey: "settings.groupProviders",
    icon: ServerCog,
  },
  {
    id: "resourceGroups",
    labelKey: "settings.section.resourceGroups",
    descriptionKey: "settings.section.resourceGroupsDescription",
    groupKey: "settings.groupProviders",
    icon: Link2,
  },
  {
    id: "text",
    labelKey: "settings.section.text",
    descriptionKey: "settings.section.textDescription",
    groupKey: "settings.groupProviders",
    icon: MessageSquareText,
  },
  {
    id: "image",
    labelKey: "settings.section.image",
    descriptionKey: "settings.section.imageDescription",
    groupKey: "settings.groupProviders",
    icon: Image,
  },
  {
    id: "prompts",
    labelKey: "settings.section.prompts",
    descriptionKey: "settings.section.promptsDescription",
    groupKey: "settings.groupWorkflow",
    icon: SlidersHorizontal,
  },
  {
    id: "upload",
    labelKey: "settings.section.upload",
    descriptionKey: "settings.section.uploadDescription",
    groupKey: "settings.groupWorkflow",
    icon: UploadCloud,
  },
  {
    id: "queue",
    labelKey: "settings.section.queue",
    descriptionKey: "settings.section.queueDescription",
    groupKey: "settings.groupWorkflow",
    icon: SettingsIcon,
  },
  {
    id: "globalTemplates",
    labelKey: "settings.section.globalTemplates",
    descriptionKey: "settings.section.globalTemplatesDescription",
    groupKey: "settings.groupWorkflow",
    icon: Layers3,
  },
  {
    id: "security",
    labelKey: "settings.section.security",
    descriptionKey: "settings.section.securityDescription",
    groupKey: "settings.groupSecurity",
    icon: ShieldCheck,
  },
  {
    id: "migration",
    labelKey: "settings.section.migration",
    descriptionKey: "settings.section.migrationDescription",
    groupKey: "settings.groupSecurity",
    icon: FileJson,
  },
];

const SETTINGS_GROUPS: TranslationKey[] = ["settings.groupProviders", "settings.groupWorkflow", "settings.groupSecurity"];
const GLOBAL_GENERATION_CONFIG_CATEGORY_PREFIX = "全局生成配置 / ";
const LEGACY_GENERATION_QUEUE_CATEGORY = "生成队列";

export function settingsSectionIds(): SettingsSectionId[] {
  return SETTINGS_SECTIONS.map((section) => section.id);
}

export function shouldShowSettingsMigrationPanel(section: SettingsSectionId): boolean {
  return section === "migration";
}

export function shouldShowGlobalTemplatesPanel(section: SettingsSectionId): boolean {
  return section === "globalTemplates";
}

const PROVIDER_CAPABILITY_OPTIONS: Array<{ value: ProviderCapability; labelKey: TranslationKey }> = [
  { value: "text_responses", labelKey: "settings.provider.capability.textResponses" },
  { value: "image_responses", labelKey: "settings.provider.capability.imageResponses" },
  { value: "image_images", labelKey: "settings.provider.capability.imageImages" },
  { value: "image_google_gemini", labelKey: "settings.provider.capability.imageGoogleGemini" },
];

function providerCapabilityLabelKey(capability: ProviderCapability): TranslationKey {
  return (
    PROVIDER_CAPABILITY_OPTIONS.find((option) => option.value === capability)?.labelKey ??
    "settings.provider.capability.imageGoogleGemini"
  );
}

const EMPTY_PROVIDER_FORM: ProviderProfileFormState = {
  name: "",
  provider_type: "openai_compatible",
  base_url: "",
  api_key: "",
  capabilities: ["text_responses", "image_images"],
  enabled: true,
};

const DEFAULT_TEXT_CONFIG_TEST_DRAFT: TextConfigTestDraft = {
  inspirationName: "测试灵感产物",
  category: "电商灵感产物",
  price: "",
  sourceNote: "用于验证当前文案生成配置的测试输入。",
  instruction: "输出适合主图的短文案。",
};

export function textConfigTestRecordForKey(
  state: TextConfigTestState | undefined,
  key: string,
): TextConfigTestRecord | null {
  return state?.records[key] ?? null;
}

export function markTextConfigTestStarted(state: TextConfigTestState, key: string): TextConfigTestState {
  return {
    ...state,
    latestKey: key,
    records: {
      ...state.records,
      [key]: { testing: true, result: null, error: "" },
    },
  };
}

export function markTextConfigTestSucceeded(
  state: TextConfigTestState,
  key: string,
  result: TextGenerationConfigTestResponse,
): TextConfigTestState {
  return {
    ...state,
    latestKey: key,
    records: {
      ...state.records,
      [key]: { testing: false, result, error: "" },
    },
  };
}

export function markTextConfigTestFailed(
  state: TextConfigTestState,
  key: string,
  error: string,
): TextConfigTestState {
  return {
    ...state,
    latestKey: key,
    records: {
      ...state.records,
      [key]: { testing: false, result: null, error },
    },
  };
}

function multiSelectValue(value: ConfigItem["value"]): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return [];
}

function draftFromItem(item: ConfigItem): DraftValue {
  if (item.input_type === "boolean") {
    return Boolean(item.value);
  }
  if (item.input_type === "multi_select") {
    return multiSelectValue(item.value);
  }
  if (item.secret) {
    return "";
  }
  return item.value === null || item.value === undefined ? "" : String(item.value);
}

function draftValuesEqual(a: DraftValue, b: DraftValue): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => value === b[index])
    );
  }
  return a === b;
}

export function draftsFromConfig(config: ConfigResponse): ConfigDraftState {
  const nextDrafts: Record<string, DraftValue> = {};
  const snapshots: Record<string, DraftSnapshot> = {};
  for (const item of config.items) {
    const value = draftFromItem(item);
    nextDrafts[item.key] = value;
    snapshots[item.key] = { value };
  }
  return { drafts: nextDrafts, snapshots };
}

export function configValuesFromChangedDrafts(
  items: ConfigItem[],
  drafts: Record<string, DraftValue>,
  snapshots: Record<string, DraftSnapshot>,
  secretTouched: Record<string, boolean>,
): Record<string, string | number | boolean | string[] | null> {
  const values: Record<string, string | number | boolean | string[] | null> = {};
  for (const item of items) {
    if (item.secret && !secretTouched[item.key]) {
      continue;
    }
    const snapshot = snapshots[item.key];
    const nextValue = drafts[item.key] ?? "";
    if (snapshot && draftValuesEqual(nextValue, snapshot.value)) {
      continue;
    }
    values[item.key] = nextValue;
  }
  return values;
}

function sourceLabel(item: ConfigItem, t: ReturnType<typeof useI18n>["t"]): string {
  return item.source === "database" ? t("settings.database") : t("settings.envDefault");
}

function sourceClassName(item: ConfigItem): string {
  if (item.source === "database") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/12";
  }
  return "border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-slate-700 dark:bg-[#0b1220]";
}

function configItemHelpContent(
  item: ConfigItem,
  t: ReturnType<typeof useI18n>["t"],
): ParameterHelpContentOverride | null {
  if (!item.description.trim()) {
    return null;
  }
  const examples = [t("detail.parameterHelp.settingsRuntimeConfig.keyExample", { key: item.key })];
  if (
    (item.minimum !== null && item.minimum !== undefined) ||
    (item.maximum !== null && item.maximum !== undefined)
  ) {
    examples.push(
      t("detail.parameterHelp.settingsRuntimeConfig.rangeExample", {
        min: item.minimum ?? "-",
        max: item.maximum ?? "-",
      }),
    );
  }
  examples.push(
    item.secret
      ? t("detail.parameterHelp.settingsRuntimeConfig.secretExample")
      : t("detail.parameterHelp.settingsRuntimeConfig.sourceExample"),
  );
  return {
    title: item.label,
    description: item.description,
    examples,
  };
}

function textValue(record: Record<string, unknown> | undefined, key: string): string {
  const value = record?.[key];
  return typeof value === "string" ? value : "";
}

function boolValue(record: Record<string, unknown> | undefined, key: string, fallback: boolean): boolean {
  const value = record?.[key];
  return typeof value === "boolean" ? value : fallback;
}

function defaultCapabilitiesForProviderType(providerType: ProviderType): ProviderCapability[] {
  return providerType === "google_gemini" ? ["image_google_gemini"] : ["text_responses", "image_images"];
}

function providerTypeLabelKey(providerType: ProviderType): TranslationKey {
  return providerType === "google_gemini"
    ? "settings.provider.type.googleGemini"
    : "settings.provider.type.openaiCompatible";
}

function providerDefaultEndpointLabelKey(profile: ProviderProfile): TranslationKey {
  return profile.provider_type === "google_gemini"
    ? "settings.provider.defaultGoogleEndpoint"
    : "settings.provider.defaultBaseUrl";
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
  return profile.enabled && (usage.text || usage.image);
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

function generationConfigsForPurpose(
  data: ProviderConfigResponse | undefined,
  purpose: "text" | "image",
): GenerationConfig[] {
  return (data?.generation_configs ?? [])
    .filter((generationConfig) => generationConfig.purpose === purpose && !generationConfig.archived_at)
    .sort((left, right) => right.priority - left.priority || left.name.localeCompare(right.name));
}

function emptyGenerationConfigDraft(purpose: "text" | "image"): GenerationConfigDraft {
  return {
    id: null,
    resource_group_id: "",
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

function generationConfigDraft(config: GenerationConfig): GenerationConfigDraft {
  const providerKind =
    config.purpose === "text"
      ? config.provider_kind === "openai"
        ? "openai"
        : "mock"
      : config.provider_kind === "openai_responses" ||
          config.provider_kind === "openai_images" ||
          config.provider_kind === "google_gemini_image"
        ? config.provider_kind
        : "mock";
  return {
    id: config.id,
    resource_group_id: config.resource_group_id,
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

function numberDraftValue(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalNumberDraftValue(value: string): number | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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
    draft.provider_kind === "openai_responses"
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
    resource_group_id: draft.resource_group_id || null,
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

function emptyGenerationResourceGroupDraft(): GenerationResourceGroupDraft {
  return {
    id: null,
    key: "",
    name: "",
    description: "",
    sort_order: "100",
    enabled: true,
  };
}

function generationResourceGroupDraft(group: GenerationResourceGroup): GenerationResourceGroupDraft {
  return {
    id: group.id,
    key: group.key,
    name: group.name,
    description: group.description ?? "",
    sort_order: String(group.sort_order),
    enabled: group.enabled,
  };
}

function generationResourceGroupPayloadFromDraft(
  draft: GenerationResourceGroupDraft,
): GenerationResourceGroupCreateRequest | GenerationResourceGroupUpdateRequest {
  return {
    key: draft.key.trim(),
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    sort_order: numberDraftValue(draft.sort_order, 100),
    enabled: draft.enabled,
  };
}

function textGenerationConfigTestPayload(
  generationConfigDraft: GenerationConfigDraft,
  testDraft: TextConfigTestDraft,
): TextGenerationConfigTestRequest {
  const generationConfig = generationConfigPayloadFromDraft(generationConfigDraft) as GenerationConfigCreateRequest;
  return {
    generation_config_id: generationConfigDraft.id,
    generation_config: generationConfig,
    inspiration: {
      name: testDraft.inspirationName.trim() || DEFAULT_TEXT_CONFIG_TEST_DRAFT.inspirationName,
      category: testDraft.category.trim() || null,
      price: testDraft.price.trim() || null,
      source_note: testDraft.sourceNote.trim() || null,
    },
    copy_request: {
      instruction: testDraft.instruction.trim() || DEFAULT_TEXT_CONFIG_TEST_DRAFT.instruction,
      purpose: "main_image",
      channel: "电商",
      tone: "清晰直接",
      output_mode: "blocks",
    },
  };
}

function itemsForSection(config: ConfigResponse | undefined, section: SettingsSectionId): ConfigItem[] {
  const items = config?.items ?? [];
  if (section === "prompts") {
    return items.filter((item) => item.category === "提示词");
  }
  if (section === "upload") {
    return items.filter((item) => item.category === "海报与上传" || item.category === "图片工具参数");
  }
  if (section === "queue") {
    return items.filter(
      (item) =>
        item.category === LEGACY_GENERATION_QUEUE_CATEGORY ||
        item.category.startsWith(GLOBAL_GENERATION_CONFIG_CATEGORY_PREFIX),
    );
  }
  if (section === "security") {
    return items.filter((item) => item.category === "安全与运维");
  }
  return [];
}

interface ConfigCategoryGroup {
  category: string;
  title: string;
  items: ConfigItem[];
}

function configCategoryGroupTitle(category: string): string {
  return category.startsWith(GLOBAL_GENERATION_CONFIG_CATEGORY_PREFIX)
    ? category.slice(GLOBAL_GENERATION_CONFIG_CATEGORY_PREFIX.length)
    : category;
}

export function configCategoryGroups(items: ConfigItem[]): ConfigCategoryGroup[] {
  const groups: ConfigCategoryGroup[] = [];
  for (const item of items) {
    let group = groups.find((candidate) => candidate.category === item.category);
    if (!group) {
      group = {
        category: item.category,
        title: configCategoryGroupTitle(item.category),
        items: [],
      };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

interface SettingsMigrationPanelProps {
  importInputRef: RefObject<HTMLInputElement | null>;
  importFileName: string;
  importPreview: SettingsImportPreviewResponse | null;
  canMigrate: boolean;
  exportBusy: boolean;
  importPreviewBusy: boolean;
  importCommitBusy: boolean;
  onRequestExport: () => void;
  onChooseImportFile: () => void;
  onImportFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onCommitImport: () => void;
  onCancelImport: () => void;
}

function SettingsMigrationPanel({
  importInputRef,
  importFileName,
  importPreview,
  canMigrate,
  exportBusy,
  importPreviewBusy,
  importCommitBusy,
  onRequestExport,
  onChooseImportFile,
  onImportFileChange,
  onCommitImport,
  onCancelImport,
}: SettingsMigrationPanelProps) {
  const { t } = useI18n();
  const counts = importPreview ? settingsImportSummaryCounts(importPreview) : null;
  return (
    <section className={`${PANEL_CLASS} mb-8`}>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <div className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 dark:border-amber-400/35 dark:bg-amber-500/12 dark:text-amber-200">
            <KeyRound size={13} className="mr-1.5" />
            {t("settings.migration.sensitiveLabel")}
          </div>
          <h2 className="mt-3 text-lg font-semibold text-slate-950 dark:text-white">
            {t("settings.migration.title")}
          </h2>
          <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
            {t("settings.migration.description")}
          </p>
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-100">
            {t("settings.migration.sensitiveWarning")}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row lg:flex-col">
          <button
            type="button"
            onClick={onRequestExport}
            disabled={exportBusy}
            className={SETTINGS_MAIN_ACTION_CLASS}
          >
            {exportBusy ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Download size={14} className="mr-2" />}
            {t("settings.migration.export")}
          </button>
          <button
            type="button"
            onClick={onChooseImportFile}
            disabled={!canMigrate || importPreviewBusy || importCommitBusy}
            className="inline-flex h-11 items-center justify-center rounded-lg border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-[#111b2d] dark:text-slate-100 dark:hover:bg-slate-800"
          >
            {importPreviewBusy ? (
              <Loader2 size={14} className="mr-2 animate-spin" />
            ) : (
              <UploadCloud size={14} className="mr-2" />
            )}
            {t("settings.migration.import")}
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={onImportFileChange}
          />
        </div>
      </div>

      {importPreview && counts ? (
        <div className="mt-5 rounded-xl border border-indigo-200 bg-indigo-50/70 p-4 dark:border-violet-400/35 dark:bg-violet-500/10">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center text-sm font-semibold text-indigo-800 dark:text-violet-100">
                <FileJson size={15} className="mr-2" />
                {t("settings.migration.previewTitle")}
              </div>
              <p className="mt-1 text-xs text-indigo-700/80 dark:text-violet-100/75">
                {t("settings.migration.previewFile", { file: importFileName })}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCancelImport}
                disabled={importCommitBusy}
                className="h-9 rounded-lg px-3 text-sm font-medium text-slate-600 hover:bg-white/70 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-white/10"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={onCommitImport}
                disabled={!canMigrate || importCommitBusy}
                className={SETTINGS_MAIN_ACTION_CLASS}
              >
                {importCommitBusy ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Check size={14} className="mr-2" />}
                {t("settings.migration.commitImport")}
              </button>
            </div>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg bg-white px-3 py-2 text-xs text-slate-600 shadow-sm dark:bg-[#101827] dark:text-slate-300">
              {t("settings.migration.runtimeCount", { count: counts.runtimeConfigCount })}
            </div>
            <div className="rounded-lg bg-white px-3 py-2 text-xs text-slate-600 shadow-sm dark:bg-[#101827] dark:text-slate-300">
              {t("settings.migration.profileCount", { count: counts.providerProfileCount })}
            </div>
            <div className="rounded-lg bg-white px-3 py-2 text-xs text-slate-600 shadow-sm dark:bg-[#101827] dark:text-slate-300">
              {t("settings.migration.generationResourceGroupCount", {
                count: counts.generationResourceGroupCount,
              })}
            </div>
            <div className="rounded-lg bg-white px-3 py-2 text-xs text-slate-600 shadow-sm dark:bg-[#101827] dark:text-slate-300">
              {t("settings.migration.generationConfigCount", { count: counts.generationConfigCount })}
            </div>
            <div className="rounded-lg bg-white px-3 py-2 text-xs text-slate-600 shadow-sm dark:bg-[#101827] dark:text-slate-300">
              {t("settings.migration.bindingCount", { count: counts.providerBindingCount })}
            </div>
            <div className="rounded-lg bg-white px-3 py-2 text-xs text-slate-600 shadow-sm dark:bg-[#101827] dark:text-slate-300">
              {t("settings.migration.templateCategoryCount", { count: counts.canvasTemplateCategoryCount })}
            </div>
            <div className="rounded-lg bg-white px-3 py-2 text-xs text-slate-600 shadow-sm dark:bg-[#101827] dark:text-slate-300">
              {t("settings.migration.templateCount", { count: counts.canvasTemplateCount })}
            </div>
            <div className="rounded-lg bg-white px-3 py-2 text-xs text-slate-600 shadow-sm dark:bg-[#101827] dark:text-slate-300">
              {t("settings.migration.keyCount", { count: counts.providerProfilesWithApiKeyCount })}
            </div>
          </div>
          {importPreview.canvas_template_keys.length || importPreview.canvas_template_category_names.length ? (
            <div className="mt-3 space-y-1 text-xs leading-5 text-indigo-700/85 dark:text-violet-100/75">
              {importPreview.canvas_template_category_names.length ? (
                <p>
                  {t("settings.migration.templateCategories", {
                    names: importPreview.canvas_template_category_names.slice(0, 8).join(", "),
                  })}
                </p>
              ) : null}
              {importPreview.canvas_template_keys.length ? (
                <p>
                  {t("settings.migration.templateKeys", {
                    keys: importPreview.canvas_template_keys.slice(0, 8).join(", "),
                  })}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

interface SettingsFormFieldProps {
  label: string;
  children: ReactNode;
  className?: string;
  helpKey?: ParameterHelpKey;
  helpContent?: ParameterHelpContentOverride;
}

function SettingsFormField({ label, children, className = "", helpKey, helpContent }: SettingsFormFieldProps) {
  return (
    <label className={`block space-y-2 ${className}`}>
      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
        {helpKey ? (
          <ParameterHelpLabel label={label} helpKey={helpKey} uiType="settings" content={helpContent} />
        ) : (
          label
        )}
      </span>
      {children}
    </label>
  );
}

function providerModelsQueryKey(profileId: string, providerKind: ProviderModelKind) {
  return ["provider-models", profileId, providerKind] as const;
}

function providerModelsStatusText(
  models: ProviderModel[],
  error: unknown,
  t: ReturnType<typeof useI18n>["t"],
): string {
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

interface ProviderModelInputProps {
  idPrefix: string;
  label: string;
  value: string;
  placeholder: string;
  providerKind: ProviderModelKind;
  providerProfileId: string;
  disabled?: boolean;
  helpKey?: ParameterHelpKey;
  onChange: (value: string) => void;
}

function ProviderModelInput({
  idPrefix,
  label,
  value,
  placeholder,
  providerKind,
  providerProfileId,
  disabled = false,
  helpKey,
  onChange,
}: ProviderModelInputProps) {
  const { t } = useI18n();
  const reactId = useId();
  const inputId = `${idPrefix}-${reactId}`;
  const listboxId = `${inputId}-models`;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [open, setOpen] = useState(false);
  const [activeModelId, setActiveModelId] = useState(value);
  const canFetchModels = providerKind !== "mock" && Boolean(providerProfileId);
  const modelsQuery = useQuery({
    queryKey: providerModelsQueryKey(providerProfileId, providerKind),
    queryFn: () => api.listProviderModels(providerProfileId, providerKind),
    enabled: canFetchModels,
    retry: false,
  });
  const models = modelsQuery.data?.models ?? [];
  const filteredModels = filterProviderModels(models, value);
  const statusText =
    providerKind === "mock"
      ? ""
      : !providerProfileId
        ? t("settings.provider.modelSelectProfileFirst")
        : modelsQuery.isLoading || modelsQuery.isFetching
          ? t("settings.provider.modelsLoading")
          : providerModelsStatusText(models, modelsQuery.error, t);
  const statusClassName = modelsQuery.error
    ? "text-red-600 dark:text-red-300"
    : "text-slate-500 dark:text-slate-400";
  const canOpenModels = !disabled && canFetchModels && models.length > 0;
  const activeModel = filteredModels.find((model) => model.id === activeModelId) ?? filteredModels[0] ?? null;
  const modelOptionsOpen = open && canOpenModels && filteredModels.length > 0;

  useEffect(() => {
    if (!open) {
      setActiveModelId(value);
      return undefined;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [open, value]);

  useEffect(() => {
    if (modelOptionsOpen && activeModel) {
      optionRefs.current[activeModel.id]?.scrollIntoView({ block: "nearest" });
    }
  }, [activeModel, modelOptionsOpen]);

  useEffect(() => {
    if (!models.length) {
      setOpen(false);
    }
  }, [models.length]);

  function moveActiveModel(delta: number) {
    if (!filteredModels.length) {
      return;
    }
    const currentIndex = filteredModels.findIndex((model) => model.id === activeModelId);
    const nextIndex =
      currentIndex === -1
        ? delta > 0
          ? 0
          : filteredModels.length - 1
        : (currentIndex + delta + filteredModels.length) % filteredModels.length;
    setActiveModelId(filteredModels[nextIndex].id);
  }

  function selectModel(model: ProviderModel) {
    onChange(model.id);
    setActiveModelId(model.id);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative space-y-2">
      <label htmlFor={inputId} className="block text-xs font-medium text-slate-600 dark:text-slate-300">
        {helpKey ? <ParameterHelpLabel label={label} helpKey={helpKey} uiType="settings" /> : label}
      </label>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            id={inputId}
            role="combobox"
            aria-expanded={modelOptionsOpen}
            aria-controls={listboxId}
            aria-autocomplete="list"
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
              setActiveModelId(event.target.value);
              if (canOpenModels) {
                setOpen(true);
              }
            }}
            onFocus={() => {
              if (canOpenModels) {
                setOpen(true);
              }
            }}
            onKeyDown={(event) => {
              if (!canOpenModels) {
                return;
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setOpen(true);
                moveActiveModel(1);
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setOpen(true);
                moveActiveModel(-1);
                return;
              }
              if (event.key === "Enter" && modelOptionsOpen && activeModel) {
                event.preventDefault();
                selectModel(activeModel);
                return;
              }
              if (event.key === "Escape") {
                setOpen(false);
              }
            }}
            className={`${INPUT_CLASS} ${canOpenModels ? "pr-11" : ""}`}
            placeholder={placeholder}
            disabled={disabled}
          />
          {canOpenModels ? (
            <button
              type="button"
              onClick={() => setOpen((current) => !current)}
              className="absolute right-1.5 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
              aria-label={t("settings.provider.openModelOptions")}
              title={t("settings.provider.openModelOptions")}
            >
              <ChevronDown size={15} className={`transition-transform ${modelOptionsOpen ? "rotate-180" : ""}`} />
            </button>
          ) : null}
        </div>
        {providerKind !== "mock" ? (
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              void modelsQuery.refetch();
            }}
            disabled={disabled || !canFetchModels || modelsQuery.isFetching}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm shadow-slate-200/35 hover:border-indigo-200 hover:text-indigo-700 disabled:opacity-50 dark:border-slate-700 dark:bg-[#111b2d] dark:text-slate-400 dark:shadow-black/20 dark:hover:border-violet-400/50 dark:hover:text-violet-100"
            aria-label={t("settings.provider.refreshModels")}
            title={t("settings.provider.refreshModels")}
          >
            {modelsQuery.isFetching ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          </button>
        ) : null}
      </div>
      {modelOptionsOpen ? (
        <div
          id={listboxId}
          role="listbox"
          aria-labelledby={inputId}
          className="absolute left-0 right-[3.25rem] z-[95] max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 text-sm shadow-xl shadow-slate-950/12 ring-1 ring-slate-950/5 dark:border-slate-700 dark:bg-[#0f1726] dark:shadow-black/45 dark:ring-white/10"
        >
          {filteredModels.map((model) => (
            <button
              key={model.id}
              ref={(element) => {
                optionRefs.current[model.id] = element;
              }}
              type="button"
              role="option"
              aria-selected={model.id === value}
              onClick={() => selectModel(model)}
              className={`flex min-h-9 w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium outline-none transition-colors ${
                model.id === value
                  ? "bg-indigo-50 text-indigo-700 dark:bg-violet-500/18 dark:text-violet-100"
                  : model.id === activeModel?.id
                    ? "bg-slate-100 text-slate-950 dark:bg-slate-800 dark:text-white"
                    : "text-slate-700 hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{model.label || model.id}</span>
              {model.id === value ? <Check size={14} className="shrink-0" /> : null}
            </button>
          ))}
        </div>
      ) : null}
      {statusText ? <p className={`min-h-4 text-xs leading-5 ${statusClassName}`}>{statusText}</p> : null}
    </div>
  );
}

interface ConfigFieldProps {
  item: ConfigItem;
  value: DraftValue;
  secretTouched: boolean;
  isResetting: boolean;
  disabled?: boolean;
  layout?: "row" | "card";
  onChange: (value: DraftValue, touchedSecret?: boolean) => void;
  onReset: () => void;
}

function ConfigField({
  item,
  value,
  secretTouched,
  isResetting,
  disabled = false,
  layout = "row",
  onChange,
  onReset,
}: ConfigFieldProps) {
  const { t } = useI18n();
  const helpContent = configItemHelpContent(item, t);
  const helpKey = helpContent ? (`settings.config.${item.key}` as const) : null;
  const selectedMultiValues = Array.isArray(value) ? value : [];
  const toggleMultiValue = (optionValue: string) => {
    const selected = new Set(selectedMultiValues);
    if (selected.has(optionValue)) {
      selected.delete(optionValue);
    } else {
      selected.add(optionValue);
    }
    onChange(item.options.filter((option) => selected.has(option.value)).map((option) => option.value));
  };

  const control =
    item.input_type === "multi_select" ? (
      <div className="grid gap-2 sm:grid-cols-2">
        {item.options.map((option) => (
          <label
            key={`${item.key}-${option.value}`}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-[#0b1220] dark:text-slate-300"
          >
            <input
              type="checkbox"
              checked={selectedMultiValues.includes(option.value)}
              disabled={disabled}
              onChange={() => toggleMultiValue(option.value)}
              className="h-3.5 w-3.5 accent-indigo-600"
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    ) : item.input_type === "select" ? (
      <SelectField id={item.key} value={String(value)} options={item.options} onChange={onChange} disabled={disabled} />
    ) : item.input_type === "textarea" ? (
      <textarea
        id={item.key}
        value={String(value)}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        rows={item.key.startsWith("prompt_") ? 8 : 3}
        className={`${TEXTAREA_CLASS} resize-y leading-6`}
      />
    ) : item.input_type === "boolean" ? (
      <label className="inline-flex cursor-pointer items-center gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 dark:border-slate-700 dark:bg-[#0b1220] dark:text-slate-300">
        <input
          id={item.key}
          type="checkbox"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          className="h-4 w-4 accent-zinc-900"
        />
        <span>{Boolean(value) ? t("settings.enabled") : t("settings.disabled")}</span>
      </label>
    ) : (
      <input
        id={item.key}
        type={item.input_type === "password" ? "password" : item.input_type === "number" ? "number" : "text"}
        value={String(value)}
        min={item.minimum ?? undefined}
        max={item.maximum ?? undefined}
        placeholder={item.secret && item.has_value ? t("settings.secretPlaceholder") : item.description || undefined}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value, item.secret)}
        className={INPUT_CLASS}
        autoComplete={item.secret ? "new-password" : undefined}
      />
    );

  if (layout === "card") {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm shadow-slate-200/50 dark:border-slate-800 dark:bg-[#0f1726] dark:shadow-black/20">
        <div className="flex items-start justify-between gap-3">
          <label htmlFor={item.key} className="min-w-0 text-sm font-semibold text-zinc-950 dark:text-white">
            {helpKey ? (
              <ParameterHelpLabel label={item.label} helpKey={helpKey} uiType="settings" content={helpContent ?? undefined} />
            ) : (
              item.label
            )}
          </label>
          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${sourceClassName(item)}`}>
            {sourceLabel(item, t)}
          </span>
        </div>
        <div className="mt-3">{control}</div>
        <div className="mt-2 flex min-h-5 items-start justify-between gap-3">
          <div>
            <div className="font-mono text-[11px] text-zinc-400 dark:text-slate-500">{item.key}</div>
            {item.secret && secretTouched ? (
              <div className="mt-1 text-xs text-amber-600 dark:text-amber-300">{t("settings.writeNewSecret")}</div>
            ) : null}
          </div>
          {item.source === "database" ? (
            <button
              type="button"
              onClick={onReset}
              disabled={disabled || isResetting}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-slate-100 hover:text-zinc-900 disabled:opacity-50 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-white"
              aria-label={t("settings.restoreDefault")}
              title={t("settings.restoreDefault")}
            >
              {isResetting ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3 border-t border-slate-100 py-5 first:border-t-0 dark:border-slate-800 md:grid-cols-[220px_minmax(0,1fr)]">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={item.key} className="text-sm font-medium text-zinc-900 dark:text-white">
            {helpKey ? (
              <ParameterHelpLabel label={item.label} helpKey={helpKey} uiType="settings" content={helpContent ?? undefined} />
            ) : (
              item.label
            )}
          </label>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${sourceClassName(item)}`}>
            {sourceLabel(item, t)}
          </span>
        </div>
        <div className="mt-1 font-mono text-[11px] text-zinc-400 dark:text-slate-500">{item.key}</div>
      </div>
      <div className="space-y-2">
        {control}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="min-h-4 text-xs leading-5 text-zinc-500 dark:text-slate-400">
            {item.description}
            {item.secret && secretTouched ? (
              <span className="ml-2 text-amber-600 dark:text-amber-300">{t("settings.writeNewSecret")}</span>
            ) : null}
          </p>
          {item.source === "database" ? (
            <button
              type="button"
              onClick={onReset}
              disabled={disabled || isResetting}
              className="inline-flex items-center text-xs font-medium text-zinc-500 hover:text-zinc-900 disabled:opacity-50 dark:text-slate-400 dark:hover:text-white"
            >
              {isResetting ? <Loader2 size={13} className="mr-1 animate-spin" /> : <RotateCcw size={13} className="mr-1" />}
              {t("settings.restoreDefault")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface ProvidersSectionProps {
  data: ProviderConfigResponse | undefined;
  profileForm: ProviderProfileFormState;
  editingProfileId: string | null;
  drawerOpen: boolean;
  pending: boolean;
  togglingProfileId: string | null;
  canWrite: boolean;
  onProfileFormChange: (next: ProviderProfileFormState) => void;
  onOpenCreate: () => void;
  onEditProfile: (profile: ProviderProfile) => void;
  onCloseDrawer: () => void;
  onSubmitProfile: () => void;
  onDeleteProfile: (profile: ProviderProfile) => void;
  onToggleProfileEnabled: (profileId: string, enabled: boolean) => void;
}

function ProvidersSection({
  data,
  profileForm,
  editingProfileId,
  drawerOpen,
  pending,
  togglingProfileId,
  canWrite,
  onProfileFormChange,
  onOpenCreate,
  onEditProfile,
  onCloseDrawer,
  onSubmitProfile,
  onDeleteProfile,
  onToggleProfileEnabled,
}: ProvidersSectionProps) {
  const { t } = useI18n();
  const profiles = (data?.profiles ?? []).filter((profile) => !profile.archived_at);
  const editingProfile = editingProfileId
    ? profiles.find((profile) => profile.id === editingProfileId)
    : undefined;
  const editingProfileUsage = editingProfile
    ? providerUsageFromGenerationConfigs(data?.generation_configs ?? [], editingProfile.id)
    : undefined;
  const editingProfileDisableBlocked =
    editingProfile && editingProfileUsage ? providerDisableBlocked(editingProfile, editingProfileUsage) : false;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-950 dark:text-white">
            {t("settings.provider.listTitle")}
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
            {t("settings.provider.listDescription")}
          </p>
        </div>
        <button type="button" onClick={onOpenCreate} disabled={!canWrite} className={SETTINGS_MAIN_ACTION_CLASS}>
          <Plus size={14} className="mr-2" />
          {t("settings.provider.create")}
        </button>
      </div>

      {profiles.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {profiles.map((profile) => {
            const usage = providerUsageFromGenerationConfigs(data?.generation_configs ?? [], profile.id);
            return (
              <ProviderProfileCard
                key={profile.id}
                profile={profile}
                usage={usage}
                pending={pending}
                toggling={togglingProfileId === profile.id}
                canWrite={canWrite}
                onEdit={() => onEditProfile(profile)}
                onDelete={() => onDeleteProfile(profile)}
                onToggleEnabled={(enabled) => onToggleProfileEnabled(profile.id, enabled)}
              />
            );
          })}
        </div>
      ) : (
        <div className="flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 text-center shadow-sm shadow-slate-200/60 dark:border-slate-700 dark:bg-[#0f1726] dark:shadow-black/25">
          <Box size={42} className="text-slate-500" />
          <div className="mt-5 text-base font-semibold text-slate-950 dark:text-white">
            {t("settings.provider.emptyTitle")}
          </div>
          <p className="mt-3 max-w-sm text-sm leading-6 text-slate-500 dark:text-slate-400">
            {t("settings.provider.emptyDescription")}
          </p>
          <button type="button" onClick={onOpenCreate} disabled={!canWrite} className={`${SETTINGS_MAIN_ACTION_CLASS} mt-6`}>
            <Plus size={14} className="mr-2" />
            {t("settings.provider.create")}
          </button>
        </div>
      )}

      <ProviderProfileDrawer
        open={drawerOpen}
        form={profileForm}
        editingProfileId={editingProfileId}
        pending={pending}
        enableToggleBlocked={editingProfileDisableBlocked}
        canWrite={canWrite}
        onFormChange={onProfileFormChange}
        onClose={onCloseDrawer}
        onSubmit={onSubmitProfile}
      />
    </div>
  );
}

function generationResourceGroupDraftKey(draft: GenerationResourceGroupDraft): string {
  return draft.id ?? "new-generation-resource-group";
}

function generationResourceGroupStatusClassName(group: GenerationResourceGroupDraft): string {
  if (group.enabled) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/12 dark:text-emerald-200";
  }
  return "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300";
}

interface GenerationResourceGroupSectionProps {
  groups: GenerationResourceGroup[];
  drafts: Record<string, GenerationResourceGroupDraft>;
  pending: boolean;
  archivingGroupId: string | null;
  canWrite: boolean;
  onChange: (key: string, next: GenerationResourceGroupDraft) => void;
  onSave: (draft: GenerationResourceGroupDraft) => void;
  onArchive: (groupId: string) => void;
}

function GenerationResourceGroupSection({
  groups,
  drafts,
  pending,
  archivingGroupId,
  canWrite,
  onChange,
  onSave,
  onArchive,
}: GenerationResourceGroupSectionProps) {
  const { t } = useI18n();
  const activeGroups = groups
    .filter((group) => !group.archived_at)
    .sort((left, right) => left.sort_order - right.sort_order || left.name.localeCompare(right.name));
  const newDraftKey = "new-generation-resource-group";
  const newDraft = drafts[newDraftKey] ?? emptyGenerationResourceGroupDraft();
  const cards = [
    ...activeGroups.map((group) => ({
      key: group.id,
      group,
      draft: drafts[group.id] ?? generationResourceGroupDraft(group),
    })),
    { key: newDraftKey, group: null, draft: newDraft },
  ];

  return (
    <section className={`${PANEL_CLASS} space-y-4`}>
      <div>
        <h2 className="text-base font-semibold text-slate-950 dark:text-white">
          {t("settings.resourceGroup.title")}
        </h2>
        <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
          {t("settings.resourceGroup.description")}
        </p>
      </div>
      <div className="grid gap-4">
        {cards.map(({ key, group, draft }) => (
          <GenerationResourceGroupCard
            key={key}
            group={group}
            draft={draft}
            pending={pending || archivingGroupId === group?.id}
            canWrite={canWrite}
            onChange={(next) => onChange(generationResourceGroupDraftKey(next), next)}
            onSave={() => onSave(draft)}
            onArchive={group ? () => onArchive(group.id) : undefined}
          />
        ))}
      </div>
    </section>
  );
}

interface GenerationResourceGroupCardProps {
  group: GenerationResourceGroup | null;
  draft: GenerationResourceGroupDraft;
  pending: boolean;
  canWrite: boolean;
  onChange: (next: GenerationResourceGroupDraft) => void;
  onSave: () => void;
  onArchive?: () => void;
}

function GenerationResourceGroupCard({
  group,
  draft,
  pending,
  canWrite,
  onChange,
  onSave,
  onArchive,
}: GenerationResourceGroupCardProps) {
  const { t } = useI18n();
  const isNew = !group;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50 dark:border-slate-800 dark:bg-[#0b1220] dark:shadow-black/20">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-slate-950 dark:text-white">
              {isNew ? t("settings.resourceGroup.newGroup") : group.name}
            </h3>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${generationResourceGroupStatusClassName(draft)}`}>
              {draft.enabled ? t("settings.resourceGroup.enabled") : t("settings.resourceGroup.disabled")}
            </span>
          </div>
          <p className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">
            {draft.key || t("settings.resourceGroup.keyPlaceholder")}
          </p>
        </div>
        {onArchive ? (
          <button
            type="button"
            onClick={onArchive}
            disabled={!canWrite || pending}
            className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-500 hover:border-red-200 hover:text-red-600 disabled:opacity-50 dark:border-slate-700 dark:bg-[#111b2d] dark:text-slate-400 dark:hover:border-red-300/50 dark:hover:text-red-200"
          >
            {pending ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Trash2 size={14} className="mr-2" />}
            {t("settings.resourceGroup.archive")}
          </button>
        ) : null}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_120px]">
        <SettingsFormField label={t("settings.resourceGroup.key")}>
          <input
            value={draft.key}
            disabled={!canWrite}
            onChange={(event) => onChange({ ...draft, key: event.target.value })}
            className={INPUT_CLASS}
            placeholder={t("settings.resourceGroup.keyPlaceholder")}
          />
        </SettingsFormField>
        <SettingsFormField label={t("settings.resourceGroup.name")}>
          <input
            value={draft.name}
            disabled={!canWrite}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
            className={INPUT_CLASS}
            placeholder={t("settings.resourceGroup.namePlaceholder")}
          />
        </SettingsFormField>
        <SettingsFormField label={t("settings.resourceGroup.sortOrder")}>
          <input
            value={draft.sort_order}
            disabled={!canWrite}
            onChange={(event) => onChange({ ...draft, sort_order: event.target.value })}
            className={INPUT_CLASS}
            type="number"
          />
        </SettingsFormField>
      </div>
      <div className="mt-3">
        <SettingsFormField label={t("settings.resourceGroup.descriptionLabel")}>
          <textarea
            value={draft.description}
            disabled={!canWrite}
            onChange={(event) => onChange({ ...draft, description: event.target.value })}
            className={`${TEXTAREA_CLASS} min-h-20 resize-y`}
            placeholder={t("settings.resourceGroup.descriptionPlaceholder")}
          />
        </SettingsFormField>
      </div>

      <div className="mt-4 flex flex-col gap-4 border-t border-slate-100 pt-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
        <label className="inline-flex items-center gap-3 text-sm font-medium text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={draft.enabled}
            disabled={!canWrite}
            onChange={(event) => onChange({ ...draft, enabled: event.target.checked })}
            className="h-4 w-4 rounded border-slate-300 accent-indigo-600 dark:border-slate-600"
          />
          {t("settings.resourceGroup.enabled")}
        </label>
        <button
          type="button"
          onClick={onSave}
          disabled={!canWrite || pending || !draft.key.trim() || !draft.name.trim()}
          className={SETTINGS_MAIN_ACTION_CLASS}
        >
          {pending ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Save size={14} className="mr-2" />}
          {isNew ? t("settings.resourceGroup.create") : t("settings.resourceGroup.save")}
        </button>
      </div>
    </div>
  );
}

interface ProviderEnabledSwitchProps {
  checked: boolean;
  disabled: boolean;
  loading?: boolean;
  title?: string;
  ariaLabel: string;
  describedBy?: string;
  onToggle: (checked: boolean) => void;
}

function ProviderEnabledSwitch({
  checked,
  disabled,
  loading = false,
  title,
  ariaLabel,
  describedBy,
  onToggle,
}: ProviderEnabledSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      title={title}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onToggle(!checked);
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition ${
        checked
          ? "border-indigo-500 bg-indigo-600 dark:border-violet-400 dark:bg-violet-500"
          : "border-slate-300 bg-slate-200 dark:border-slate-700 dark:bg-slate-800"
      } ${disabled ? "cursor-not-allowed opacity-55" : "hover:brightness-105"}`}
    >
      <span
        className={`inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm transition ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      >
        {loading ? <Loader2 size={12} className="animate-spin" /> : null}
      </span>
    </button>
  );
}

interface ProviderProfileCardProps {
  profile: ProviderProfile;
  usage: ProviderProfileUsage;
  pending: boolean;
  toggling: boolean;
  canWrite: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onToggleEnabled: (enabled: boolean) => void;
}

function ProviderProfileCard({
  profile,
  usage,
  pending,
  toggling,
  canWrite,
  onEdit,
  onDelete,
  onToggleEnabled,
}: ProviderProfileCardProps) {
  const { t } = useI18n();
  const usageLabelKeys = providerUsageLabelKeys(usage);
  const disableBlocked = providerDisableBlocked(profile, usage);
  const blockHelpId = `${profile.id}-disable-help`;
  const switchHelp = disableBlocked ? t("settings.provider.disableBlocked") : undefined;

  return (
    <div className="group relative flex min-h-[230px] flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/60 transition hover:border-indigo-200 hover:shadow-md dark:border-slate-800 dark:bg-[#0f1726] dark:shadow-black/25 dark:hover:border-violet-400/45">
      <button
        type="button"
        onClick={onEdit}
        disabled={!canWrite}
        className="-m-2 block w-full space-y-4 rounded-lg p-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-violet-400"
      >
        <span className="flex items-start justify-between gap-4">
          <span className="min-w-0 pr-20">
            <span className="flex flex-wrap items-center gap-2">
              <span className="truncate text-base font-semibold text-slate-950 dark:text-white">{profile.name}</span>
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                  profile.enabled
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/12 dark:text-emerald-200"
                    : "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                }`}
              >
                {profile.enabled ? t("settings.provider.enabled") : t("settings.provider.disabled")}
              </span>
            </span>
            <span className="mt-2 flex items-center gap-1.5 truncate font-mono text-xs text-slate-500 dark:text-slate-400">
              <ServerCog size={13} className="shrink-0" />
              <span className="truncate">{profile.base_url || t(providerDefaultEndpointLabelKey(profile))}</span>
            </span>
          </span>
        </span>

        <span className="flex flex-wrap gap-1.5">
          <span className="rounded-md bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-700 dark:bg-violet-500/12 dark:text-violet-100">
            {t(providerTypeLabelKey(profile.provider_type))}
          </span>
          {profile.capabilities.map((capability) => (
            <span
              key={`${profile.id}-${capability}`}
              className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            >
              {t(providerCapabilityLabelKey(capability))}
            </span>
          ))}
        </span>

        <span className="flex flex-wrap gap-2">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${
              profile.has_api_key
                ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/12 dark:text-emerald-200"
                : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/35 dark:bg-amber-500/12 dark:text-amber-200"
            }`}
          >
            <KeyRound size={12} />
            {profile.has_api_key ? t("settings.provider.keyConfigured") : t("settings.provider.keyMissing")}
          </span>
          {usageLabelKeys.length ? (
            usageLabelKeys.map((labelKey) => (
              <span
                key={labelKey}
                className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700 dark:border-violet-400/35 dark:bg-violet-500/12 dark:text-violet-100"
              >
                {t(labelKey)}
              </span>
            ))
          ) : (
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              {t("settings.provider.usageNone")}
            </span>
          )}
        </span>
      </button>

      <div className="absolute right-5 top-5 flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onEdit}
          disabled={!canWrite}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:border-indigo-200 hover:text-indigo-700 dark:border-slate-700 dark:bg-[#0b1220] dark:text-slate-400 dark:hover:border-violet-300/50 dark:hover:text-violet-100"
          aria-label={t("settings.provider.editAria")}
          title={t("settings.provider.edit")}
        >
          <Pencil size={14} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={!canWrite || pending}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:border-red-200 hover:text-red-600 disabled:opacity-50 dark:border-slate-700 dark:bg-[#0b1220] dark:text-slate-400 dark:hover:border-red-300/50 dark:hover:text-red-200"
          aria-label={t("settings.provider.deleteAria")}
          title={t("settings.provider.deleteAria")}
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="mt-5 flex items-start justify-between gap-4 border-t border-slate-100 pt-4 dark:border-slate-800">
        <div>
          <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
            <ParameterHelpLabel
              label={t("settings.provider.enabledSwitchLabel")}
              helpKey="settingsProviderEnabled"
              uiType="settings"
            />
          </div>
          {switchHelp ? (
            <p id={blockHelpId} className="mt-1 text-xs leading-5 text-amber-700 dark:text-amber-200">
              {switchHelp}
            </p>
          ) : (
            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
              {t("settings.provider.enabledSwitchHelp")}
            </p>
          )}
        </div>
        <ProviderEnabledSwitch
          checked={profile.enabled}
          disabled={!canWrite || pending || toggling || disableBlocked}
          loading={toggling}
          title={switchHelp}
          ariaLabel={t("settings.provider.enabledSwitchAria")}
          describedBy={switchHelp ? blockHelpId : undefined}
          onToggle={onToggleEnabled}
        />
      </div>
    </div>
  );
}

interface ProviderCapabilityToggleProps {
  option: (typeof PROVIDER_CAPABILITY_OPTIONS)[number];
  selected: boolean;
  disabled?: boolean;
  onToggle: () => void;
}

function ProviderCapabilityToggle({ option, selected, disabled = false, onToggle }: ProviderCapabilityToggleProps) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onToggle}
      className={`flex h-[46px] items-center gap-3 rounded-xl border px-3 text-left text-sm font-semibold transition ${
        selected
          ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-violet-500 dark:bg-violet-500/12 dark:text-violet-50"
          : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-[#171f30] dark:text-slate-300 dark:hover:border-slate-500"
      }`}
    >
      <span
        className={`grid h-5 w-5 shrink-0 place-items-center rounded-[5px] transition ${
          selected
            ? "bg-indigo-600 text-white dark:bg-violet-500"
            : "bg-slate-200 dark:bg-slate-600"
        }`}
      >
        {selected ? <Check size={13} strokeWidth={3} /> : null}
      </span>
      {t(option.labelKey)}
    </button>
  );
}

interface ProviderDrawerTextInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: "text" | "password";
  icon?: ReactNode;
  autoComplete?: string;
  disabled?: boolean;
}

function ProviderDrawerTextInput({
  value,
  onChange,
  placeholder,
  type = "text",
  icon,
  autoComplete,
  disabled = false,
}: ProviderDrawerTextInputProps) {
  return (
    <div className="relative">
      {icon ? (
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500">
          {icon}
        </span>
      ) : null}
      <input
        type={type}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={`${PROVIDER_DRAWER_INPUT_CLASS} ${icon ? "pl-11" : ""}`}
        placeholder={placeholder}
        autoComplete={autoComplete}
      />
    </div>
  );
}

interface ProviderDrawerEnableToggleProps {
  checked: boolean;
  disabled: boolean;
  blocked?: boolean;
  onToggle: (checked: boolean) => void;
}

function ProviderDrawerEnableToggle({ checked, disabled, blocked = false, onToggle }: ProviderDrawerEnableToggleProps) {
  const { t } = useI18n();
  const helpId = useId();
  return (
    <div>
      <button
        type="button"
        disabled={disabled || blocked}
        aria-pressed={checked}
        aria-describedby={blocked ? helpId : undefined}
        onClick={() => onToggle(!checked)}
        className={`flex h-[46px] w-full items-center gap-3 rounded-xl border px-3 text-left text-sm font-semibold transition ${
          checked
            ? "border-indigo-300 bg-indigo-50 text-slate-900 dark:border-slate-700 dark:bg-[#171f30] dark:text-slate-100"
            : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-[#171f30] dark:text-slate-300"
        } ${
          disabled || blocked
            ? "cursor-not-allowed opacity-60"
            : "hover:border-indigo-300 dark:hover:border-violet-500/60"
        }`}
      >
        <span
          className={`grid h-5 w-5 shrink-0 place-items-center rounded-md transition ${
            checked ? "bg-indigo-600 text-white dark:bg-violet-500" : "bg-slate-200 dark:bg-slate-600"
          }`}
        >
          {checked ? <Check size={13} strokeWidth={3} /> : null}
        </span>
        {t("settings.provider.enable")}
      </button>
      {blocked ? (
        <p id={helpId} className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-200">
          {t("settings.provider.disableBlocked")}
        </p>
      ) : null}
    </div>
  );
}

interface ProviderProfileDrawerProps {
  open: boolean;
  form: ProviderProfileFormState;
  editingProfileId: string | null;
  pending: boolean;
  enableToggleBlocked: boolean;
  canWrite: boolean;
  onFormChange: (next: ProviderProfileFormState) => void;
  onClose: () => void;
  onSubmit: () => void;
}

function ProviderProfileDrawer({
  open,
  form,
  editingProfileId,
  pending,
  enableToggleBlocked,
  canWrite,
  onFormChange,
  onClose,
  onSubmit,
}: ProviderProfileDrawerProps) {
  const { t } = useI18n();
  const titleId = useId();
  const capabilityOptions = PROVIDER_CAPABILITY_OPTIONS.filter((option) =>
    form.provider_type === "google_gemini"
      ? option.value === "image_google_gemini"
      : option.value !== "image_google_gemini",
  );
  const handleProviderTypeChange = (provider_type: ProviderType) => {
    onFormChange({
      ...form,
      provider_type,
      base_url: provider_type === "google_gemini" ? "" : form.base_url,
      capabilities: defaultCapabilitiesForProviderType(provider_type),
    });
  };
  const toggleCapability = (capability: ProviderCapability) => {
    const selected = new Set(form.capabilities);
    if (selected.has(capability)) {
      selected.delete(capability);
    } else {
      selected.add(capability);
    }
    onFormChange({
      ...form,
      capabilities: capabilityOptions.map((option) => option.value).filter((value) => selected.has(value)),
    });
  };

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/55 backdrop-blur-sm">
      <div
        className="absolute inset-0 h-full w-full cursor-default"
        aria-hidden="true"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex h-full w-full max-w-full flex-col overflow-hidden bg-white shadow-2xl shadow-slate-950/25 dark:bg-[#121722] sm:max-w-[448px]"
      >
        <div className="flex h-[74px] items-center justify-between border-b border-slate-200 px-6 dark:border-slate-800">
          <div className="flex min-w-0 items-center gap-3">
            <span className="text-indigo-600 dark:text-violet-400">
              {editingProfileId ? <Pencil size={17} /> : <Plus size={18} />}
            </span>
            <h2 id={titleId} className="truncate text-lg font-bold text-slate-950 dark:text-white">
              {editingProfileId ? t("settings.provider.edit") : t("settings.provider.create")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:text-slate-950 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:text-white"
            aria-label={t("settings.provider.closeDrawer")}
            title={t("settings.provider.closeDrawer")}
          >
            <X size={16} />
          </button>
        </div>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canWrite) {
              return;
            }
            onSubmit();
          }}
        >
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-6">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {t("settings.provider.basicInfo")}
            </div>
            <SettingsFormField label={t("settings.provider.nameLabel")}>
              <ProviderDrawerTextInput
                value={form.name}
                onChange={(name) => onFormChange({ ...form, name })}
                placeholder={t("settings.provider.namePlaceholder")}
                disabled={!canWrite}
              />
            </SettingsFormField>
            <SettingsFormField label={t("settings.provider.typeLabel")} helpKey="settingsProviderType">
              <SelectField
                value={form.provider_type}
                options={[
                  { value: "openai_compatible", label: t("settings.provider.type.openaiCompatible") },
                  { value: "google_gemini", label: t("settings.provider.type.googleGemini") },
                ]}
                onChange={(value) =>
                  handleProviderTypeChange(value === "google_gemini" ? "google_gemini" : "openai_compatible")
                }
                disabled={!canWrite}
                radius="lg"
              />
            </SettingsFormField>
            {form.provider_type === "openai_compatible" ? (
              <SettingsFormField label={t("settings.provider.baseUrlLabel")} helpKey="settingsProviderBaseUrl">
                <ProviderDrawerTextInput
                  value={form.base_url}
                  onChange={(base_url) => onFormChange({ ...form, base_url })}
                  placeholder={t("settings.provider.baseUrlPlaceholder")}
                  icon={<Link2 size={16} />}
                  disabled={!canWrite}
                />
              </SettingsFormField>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-600 dark:border-slate-700 dark:bg-[#171f30] dark:text-slate-300">
                {t("settings.provider.googleBaseUrlUnsupported")}
              </div>
            )}
            <SettingsFormField label={t("settings.provider.apiKeyLabel")}>
              <ProviderDrawerTextInput
                type="password"
                value={form.api_key}
                onChange={(api_key) => onFormChange({ ...form, api_key })}
                placeholder={
                  editingProfileId
                    ? t("settings.provider.keepKeyPlaceholder")
                    : t("settings.provider.apiKeyPlaceholder")
                }
                icon={<KeyRound size={16} />}
                autoComplete="new-password"
                disabled={!canWrite}
              />
            </SettingsFormField>
            <div className="grid gap-2">
              <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
                <ParameterHelpLabel
                  label={t("settings.provider.capabilitiesLabel")}
                  helpKey="settingsProviderCapabilities"
                  uiType="settings"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                {capabilityOptions.map((option) => (
                  <ProviderCapabilityToggle
                    key={option.value}
                    option={option}
                    selected={form.capabilities.includes(option.value)}
                    disabled={!canWrite}
                    onToggle={() => toggleCapability(option.value)}
                  />
                ))}
              </div>
            </div>

            <div className="border-t border-slate-200 pt-4 dark:border-slate-800">
              <ProviderDrawerEnableToggle
                checked={form.enabled}
                disabled={!canWrite || pending}
                blocked={enableToggleBlocked}
                onToggle={(enabled) => onFormChange({ ...form, enabled })}
              />
            </div>
          </div>

          <div className="shrink-0 border-t border-slate-200 bg-white px-6 py-5 dark:border-slate-800 dark:bg-[#121722]">
            <button
              type="submit"
              disabled={!canWrite || pending || !form.name.trim() || !form.capabilities.length}
              className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-indigo-600 px-5 text-sm font-bold text-white shadow-lg shadow-indigo-500/25 transition hover:bg-indigo-500 disabled:opacity-50 dark:bg-violet-500 dark:shadow-violet-950/30 dark:hover:bg-violet-400"
            >
              {pending ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Save size={14} className="mr-2" />}
              {t("detail.save")}
            </button>
          </div>
        </form>
      </aside>
    </div>
  );
}

interface GenerationConfigPoolSectionProps {
  data: ProviderConfigResponse | undefined;
  purpose: "text" | "image";
  drafts: Record<string, GenerationConfigDraft>;
  pending: boolean;
  archivingConfigId: string | null;
  canWrite: boolean;
  textTestState?: TextConfigTestState;
  onChange: (key: string, next: GenerationConfigDraft) => void;
  onSave: (draft: GenerationConfigDraft) => void;
  onArchive: (configId: string) => void;
  onTextTestDraftChange?: (draft: TextConfigTestDraft) => void;
  onTestTextConfig?: (draft: GenerationConfigDraft) => void;
  onRefreshSort: () => void;
}

function generationConfigDraftKey(draft: GenerationConfigDraft): string {
  return draft.id ?? `new-${draft.purpose}`;
}

function providerProfilesForGenerationConfig(
  profiles: ProviderProfile[],
  draft: GenerationConfigDraft,
): ProviderProfile[] {
  const requiredCapability =
    draft.purpose === "text"
      ? "text_responses"
      : draft.provider_kind === "openai_responses"
        ? "image_responses"
        : draft.provider_kind === "google_gemini_image"
          ? "image_google_gemini"
          : "image_images";
  return profiles.filter(
    (profile) => profile.enabled && !profile.archived_at && profile.capabilities.includes(requiredCapability),
  );
}

function generationConfigSuccessRate(config: GenerationConfig): string {
  const stat = config.today_stat;
  if (!stat || stat.attempt_count <= 0) {
    return "0%";
  }
  return `${Math.round((stat.success_count / stat.attempt_count) * 100)}%`;
}

function isActiveFrozenUntil(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

function TextConfigTestPanel({
  state,
  onDraftChange,
}: {
  state: TextConfigTestState;
  onDraftChange: (draft: TextConfigTestDraft) => void;
}) {
  const { t } = useI18n();
  const latestRecord = state.latestKey ? state.records[state.latestKey] : null;
  const latestResult = latestRecord?.result ?? null;
  const latestError = latestRecord?.error ?? "";
  const runningCount = Object.values(state.records).filter((record) => record.testing).length;

  return (
    <section className={`${PANEL_CLASS} space-y-4`}>
      <div>
        <h2 className="text-base font-semibold text-slate-950 dark:text-white">
          {t("settings.generation.testTitle")}
        </h2>
        <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
          {t("settings.generation.testDescription")}
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <SettingsFormField label={t("settings.generation.testInspirationName")}>
          <input
            value={state.draft.inspirationName}
            onChange={(event) => onDraftChange({ ...state.draft, inspirationName: event.target.value })}
            className={INPUT_CLASS}
          />
        </SettingsFormField>
        <SettingsFormField label={t("settings.generation.testCategory")}>
          <input
            value={state.draft.category}
            onChange={(event) => onDraftChange({ ...state.draft, category: event.target.value })}
            className={INPUT_CLASS}
          />
        </SettingsFormField>
        <SettingsFormField label={t("settings.generation.testPrice")}>
          <input
            value={state.draft.price}
            onChange={(event) => onDraftChange({ ...state.draft, price: event.target.value })}
            className={INPUT_CLASS}
          />
        </SettingsFormField>
        <SettingsFormField label={t("settings.generation.testInstruction")}>
          <input
            value={state.draft.instruction}
            onChange={(event) => onDraftChange({ ...state.draft, instruction: event.target.value })}
            className={INPUT_CLASS}
          />
        </SettingsFormField>
      </div>
      <SettingsFormField label={t("settings.generation.testSourceNote")}>
        <textarea
          value={state.draft.sourceNote}
          onChange={(event) => onDraftChange({ ...state.draft, sourceNote: event.target.value })}
          className={`${TEXTAREA_CLASS} min-h-24 resize-y`}
        />
      </SettingsFormField>
      {runningCount > 0 ? (
        <div className="flex items-start gap-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-3 text-sm text-indigo-800 dark:border-violet-400/35 dark:bg-violet-500/12 dark:text-violet-100">
          <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin" />
          <div>
            <div className="font-semibold">{t("settings.generation.testRunning")}</div>
            <div className="mt-0.5 text-xs text-indigo-700/80 dark:text-violet-100/75">
              {t("settings.generation.testRunningDetail")}
            </div>
          </div>
        </div>
      ) : null}
      {latestError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200">
          {latestError}
        </div>
      ) : null}
      {runningCount === 0 && latestResult ? (
        <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm text-emerald-800 dark:border-emerald-400/35 dark:bg-emerald-500/12 dark:text-emerald-100">
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">{t("settings.generation.testPassed")}</div>
            <div className="mt-0.5 text-xs text-emerald-700/80 dark:text-emerald-100/75">
              {t("settings.generation.testPassedDetail", {
                duration: String(Math.max(1, Math.round(latestResult.duration_ms))),
                briefModel: latestResult.brief_model,
                copyModel: latestResult.copy_model,
              })}
            </div>
          </div>
        </div>
      ) : null}
      {latestResult ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-[#0b1220]">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {t("settings.generation.testBriefResult", { model: latestResult.brief_model })}
            </div>
            <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-slate-700 dark:text-slate-200">
              {JSON.stringify(latestResult.brief, null, 2)}
            </pre>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-[#0b1220]">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {t("settings.generation.testCopyResult", { model: latestResult.copy_model })}
            </div>
            <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-slate-700 dark:text-slate-200">
              {JSON.stringify(latestResult.copy_result, null, 2)}
            </pre>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function GenerationConfigPoolSection({
  data,
  purpose,
  drafts,
  pending,
  archivingConfigId,
  canWrite,
  textTestState,
  onChange,
  onSave,
  onArchive,
  onTextTestDraftChange,
  onTestTextConfig,
  onRefreshSort,
}: GenerationConfigPoolSectionProps) {
  const { t } = useI18n();
  const configs = generationConfigsForPurpose(data, purpose);
  const profiles = data?.profiles ?? [];
  const resourceGroups = (data?.generation_resource_groups ?? []).filter((group) => !group.archived_at);
  const newDraftKey = `new-${purpose}`;
  const newDraft =
    drafts[newDraftKey] ??
    ({
      ...emptyGenerationConfigDraft(purpose),
      resource_group_id: resourceGroups.find((group) => group.enabled)?.id ?? "",
    } satisfies GenerationConfigDraft);
  const cards = [
    ...configs.map((config) => ({ key: config.id, config, draft: drafts[config.id] ?? generationConfigDraft(config) })),
    { key: newDraftKey, config: null, draft: newDraft },
  ];

  return (
    <div className="space-y-4">
      {purpose === "text" && textTestState && onTextTestDraftChange ? (
        <TextConfigTestPanel state={textTestState} onDraftChange={onTextTestDraftChange} />
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-950 dark:text-white">
            {purpose === "text" ? t("settings.generation.textPoolTitle") : t("settings.generation.imagePoolTitle")}
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
            {t("settings.generation.poolDescription")}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefreshSort}
          className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-[#111b2d] dark:text-slate-100 dark:hover:bg-slate-800"
        >
          <RefreshCw size={14} className="mr-2" />
          {t("settings.generation.refreshSort")}
        </button>
      </div>
      {cards.map(({ key, config, draft }) => {
        const testRecord = textConfigTestRecordForKey(textTestState, key);
        return (
          <GenerationConfigCard
            key={key}
            config={config}
            draft={draft}
            resourceGroups={resourceGroups}
            profiles={providerProfilesForGenerationConfig(profiles, draft)}
            pending={pending || archivingConfigId === config?.id}
            canWrite={canWrite}
            onChange={(next) => onChange(generationConfigDraftKey(next), next)}
            onSave={() => onSave(draft)}
            onArchive={config ? () => onArchive(config.id) : undefined}
            onTest={purpose === "text" && onTestTextConfig ? () => onTestTextConfig(draft) : undefined}
            testing={Boolean(testRecord?.testing)}
            testResult={testRecord?.result ?? null}
            testError={testRecord?.error ?? ""}
          />
        );
      })}
    </div>
  );
}

interface GenerationConfigCardProps {
  config: GenerationConfig | null;
  draft: GenerationConfigDraft;
  resourceGroups: GenerationResourceGroup[];
  profiles: ProviderProfile[];
  pending: boolean;
  canWrite: boolean;
  onChange: (next: GenerationConfigDraft) => void;
  onSave: () => void;
  onArchive?: () => void;
  onTest?: () => void;
  testing?: boolean;
  testResult?: TextGenerationConfigTestResponse | null;
  testError?: string;
}

function GenerationConfigCard({
  config,
  draft,
  resourceGroups,
  profiles,
  pending,
  canWrite,
  onChange,
  onSave,
  onArchive,
  onTest,
  testing = false,
  testResult = null,
  testError = "",
}: GenerationConfigCardProps) {
  const { t } = useI18n();
  const isNew = !config;
  const providerKindOptions =
    draft.purpose === "text"
      ? [
          { value: "mock", label: t("settings.provider.interface.mock") },
          { value: "openai", label: t("settings.provider.interface.openaiResponses") },
        ]
      : [
          { value: "mock", label: t("settings.provider.interface.mock") },
          { value: "openai_responses", label: t("settings.provider.interface.openaiResponses") },
          { value: "openai_images", label: t("settings.provider.interface.openaiImages") },
          { value: "google_gemini_image", label: t("settings.provider.interface.googleGeminiImage") },
        ];
  const busy = pending;
  const controlsDisabled = busy || !canWrite;

  return (
    <div className={`${PANEL_CLASS} space-y-5`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold text-slate-950 dark:text-white">
              {isNew ? t("settings.generation.newConfig") : config.name}
            </h3>
            <span
              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                draft.enabled
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/12 dark:text-emerald-200"
                  : "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
              }`}
            >
              {draft.enabled ? t("settings.provider.enabled") : t("settings.provider.disabled")}
            </span>
            {isActiveFrozenUntil(config?.state?.frozen_until) ? (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:border-amber-400/35 dark:bg-amber-500/12 dark:text-amber-200">
                {t("settings.generation.frozen")}
              </span>
            ) : null}
          </div>
          {config ? (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t("settings.generation.cardStats", {
                running: config.state?.current_concurrency ?? 0,
                max: config.max_concurrency,
                attempts: config.today_stat?.attempt_count ?? 0,
                successRate: generationConfigSuccessRate(config),
              })}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {onTest ? (
            <button
              type="button"
              onClick={onTest}
              disabled={controlsDisabled || testing || !draft.name.trim() || (draft.provider_kind !== "mock" && !draft.provider_profile_id)}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:border-violet-400/35 dark:bg-violet-500/12 dark:text-violet-100 dark:hover:bg-violet-500/20"
            >
              {testing ? <Loader2 size={14} className="mr-2 animate-spin" /> : <MessageSquareText size={14} className="mr-2" />}
              {t("settings.generation.test")}
            </button>
          ) : null}
          {onArchive ? (
            <button
              type="button"
              onClick={onArchive}
              disabled={controlsDisabled}
              className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-500 hover:border-red-200 hover:text-red-600 disabled:opacity-50 dark:border-slate-700 dark:bg-[#0b1220] dark:text-slate-400 dark:hover:border-red-300/50 dark:hover:text-red-200"
            >
              {busy ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Trash2 size={14} className="mr-2" />}
              {t("settings.generation.archive")}
            </button>
          ) : null}
        </div>
      </div>
      {testing || testResult || testError ? (
        <div
          className={`flex items-start gap-3 rounded-lg border px-3 py-3 text-sm ${
            testError
              ? "border-red-200 bg-red-50 text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200"
              : testResult
                ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/35 dark:bg-emerald-500/12 dark:text-emerald-100"
                : "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-violet-400/35 dark:bg-violet-500/12 dark:text-violet-100"
          }`}
        >
          {testError ? (
            <X size={16} className="mt-0.5 shrink-0" />
          ) : testResult ? (
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
          ) : (
            <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin" />
          )}
          <div className="min-w-0">
            <div className="font-semibold">
              {testError
                ? t("settings.generation.testFailed")
                : testResult
                  ? t("settings.generation.testPassed")
                  : t("settings.generation.testRunning")}
            </div>
            <div className="mt-0.5 break-words text-xs opacity-80">
              {testError ||
                (testResult
                  ? t("settings.generation.testPassedDetail", {
                      duration: String(Math.max(1, Math.round(testResult.duration_ms))),
                      briefModel: testResult.brief_model,
                      copyModel: testResult.copy_model,
                    })
                  : t("settings.generation.testRunningDetail"))}
            </div>
          </div>
        </div>
      ) : null}
      {testResult ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-[#0b1220]">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {t("settings.generation.testBriefResult", { model: testResult.brief_model })}
            </div>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-slate-700 dark:text-slate-200">
              {JSON.stringify(testResult.brief, null, 2)}
            </pre>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-[#0b1220]">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              {t("settings.generation.testCopyResult", { model: testResult.copy_model })}
            </div>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-slate-700 dark:text-slate-200">
              {JSON.stringify(testResult.copy_result, null, 2)}
            </pre>
          </div>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <SettingsFormField label={t("settings.generation.nameLabel")}>
          <input
            value={draft.name}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
            disabled={controlsDisabled}
            className={INPUT_CLASS}
            placeholder={t("settings.generation.namePlaceholder")}
          />
        </SettingsFormField>
        <SettingsFormField label={t("settings.generation.resourceGroup")}>
          <SelectField
            value={draft.resource_group_id}
            options={[
              {
                value: "",
                label: resourceGroups.length
                  ? t("settings.generation.selectResourceGroup")
                  : t("settings.generation.noResourceGroups"),
                disabled: true,
              },
              ...resourceGroups.map((group) => ({
                value: group.id,
                label: group.enabled
                  ? group.name
                  : `${group.name} (${t("settings.resourceGroup.disabled")})`,
                disabled: !group.enabled,
              })),
            ]}
            onChange={(value) => onChange({ ...draft, resource_group_id: value })}
            disabled={controlsDisabled}
            radius="lg"
          />
        </SettingsFormField>
        <SettingsFormField label={t("settings.provider.apiInterfaceLabel")} helpKey="settingsProviderApiInterface">
          <SelectField
            value={draft.provider_kind}
            options={providerKindOptions}
            onChange={(value) =>
              onChange({
                ...draft,
                provider_kind:
                  draft.purpose === "text"
                    ? value === "openai"
                      ? "openai"
                      : "mock"
                    : value === "openai_responses" || value === "openai_images" || value === "google_gemini_image"
                      ? value
                      : "mock",
                provider_profile_id: "",
              })
            }
            disabled={controlsDisabled}
            radius="lg"
          />
        </SettingsFormField>
      </div>

      {draft.provider_kind !== "mock" ? (
        <SettingsFormField label={t("settings.provider.providerProfileLabel")} helpKey="settingsProviderProfile">
          <SelectField
            value={draft.provider_profile_id}
            options={[
              { value: "", label: t("settings.provider.selectProfile") },
              ...profiles.map((profile) => ({ value: profile.id, label: profile.name })),
            ]}
            onChange={(value) => onChange({ ...draft, provider_profile_id: value })}
            disabled={controlsDisabled}
            radius="lg"
          />
        </SettingsFormField>
      ) : null}

      {draft.purpose === "text" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <ProviderModelInput
            idPrefix={`text-brief-model-${config?.id ?? "new"}`}
            label={t("settings.provider.textBriefModelLabel")}
            value={draft.brief_model}
            placeholder={t("settings.provider.textBriefModelPlaceholder")}
            providerKind={draft.provider_kind === "openai" ? "openai" : "mock"}
            providerProfileId={draft.provider_profile_id}
            disabled={controlsDisabled}
            helpKey="settingsTextBriefModel"
            onChange={(brief_model) => onChange({ ...draft, brief_model })}
          />
          <ProviderModelInput
            idPrefix={`text-copy-model-${config?.id ?? "new"}`}
            label={t("settings.provider.textCopyModelLabel")}
            value={draft.copy_model}
            placeholder={t("settings.provider.textCopyModelPlaceholder")}
            providerKind={draft.provider_kind === "openai" ? "openai" : "mock"}
            providerProfileId={draft.provider_profile_id}
            disabled={controlsDisabled}
            helpKey="settingsTextCopyModel"
            onChange={(copy_model) => onChange({ ...draft, copy_model })}
          />
        </div>
      ) : (
        <GenerationConfigImageFields draft={draft} pending={controlsDisabled} onChange={onChange} configId={config?.id ?? "new"} />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <SettingsFormField label={t("settings.generation.priority")} helpKey="settingsGenerationPriority">
          <input value={draft.priority} disabled={controlsDisabled} onChange={(event) => onChange({ ...draft, priority: event.target.value })} className={INPUT_CLASS} type="number" />
        </SettingsFormField>
        <SettingsFormField label={t("settings.generation.maxConcurrency")} helpKey="settingsGenerationMaxConcurrency">
          <input value={draft.max_concurrency} disabled={controlsDisabled} onChange={(event) => onChange({ ...draft, max_concurrency: event.target.value })} className={INPUT_CLASS} type="number" min={1} />
        </SettingsFormField>
        <SettingsFormField label={t("settings.generation.availabilityWindow")} helpKey="settingsGenerationAvailabilityWindow">
          <input value={draft.availability_window_minutes} disabled={controlsDisabled} onChange={(event) => onChange({ ...draft, availability_window_minutes: event.target.value })} className={INPUT_CLASS} type="number" min={1} placeholder={t("settings.generation.runtimeDefault")} />
        </SettingsFormField>
        <SettingsFormField label={t("settings.generation.failureThreshold")} helpKey="settingsGenerationFailureThreshold">
          <input value={draft.failure_threshold} disabled={controlsDisabled} onChange={(event) => onChange({ ...draft, failure_threshold: event.target.value })} className={INPUT_CLASS} type="number" min={1} placeholder={t("settings.generation.runtimeDefault")} />
        </SettingsFormField>
        <SettingsFormField label={t("settings.generation.cooldownMinutes")} helpKey="settingsGenerationCooldownMinutes">
          <input value={draft.cooldown_minutes} disabled={controlsDisabled} onChange={(event) => onChange({ ...draft, cooldown_minutes: event.target.value })} className={INPUT_CLASS} type="number" min={1} placeholder={t("settings.generation.runtimeDefault")} />
        </SettingsFormField>
      </div>

      <div className="flex flex-col gap-4 border-t border-slate-100 pt-5 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
        <label className="inline-flex items-center gap-3 text-sm font-medium text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={draft.enabled}
            disabled={controlsDisabled}
            onChange={(event) => onChange({ ...draft, enabled: event.target.checked })}
            className="h-4 w-4 rounded border-slate-300 accent-indigo-600 dark:border-slate-600"
          />
          {t("settings.generation.enabled")}
        </label>
        <button
          type="button"
          onClick={onSave}
          disabled={
            controlsDisabled ||
            !draft.name.trim() ||
            !draft.resource_group_id ||
            (draft.provider_kind !== "mock" && !draft.provider_profile_id)
          }
          className={SETTINGS_MAIN_ACTION_CLASS}
        >
          {busy ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Save size={14} className="mr-2" />}
          {isNew ? t("settings.generation.create") : t("settings.generation.save")}
        </button>
      </div>
    </div>
  );
}

function GenerationConfigImageFields({
  draft,
  pending,
  onChange,
  configId,
}: {
  draft: GenerationConfigDraft;
  pending: boolean;
  onChange: (next: GenerationConfigDraft) => void;
  configId: string;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      <ProviderModelInput
        idPrefix={`image-model-${configId}`}
        label={t("settings.provider.imageModelLabel")}
        value={draft.model}
        placeholder={t("settings.provider.imageModelPlaceholder")}
        providerKind={
          draft.provider_kind === "openai_responses" ||
          draft.provider_kind === "openai_images" ||
          draft.provider_kind === "google_gemini_image"
            ? draft.provider_kind
            : "mock"
        }
        providerProfileId={draft.provider_profile_id}
        disabled={pending}
        helpKey="settingsImageModel"
        onChange={(model) => onChange({ ...draft, model })}
      />
      {draft.provider_kind === "google_gemini_image" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <SettingsFormField label={t("settings.provider.geminiApiVersionLabel")} helpKey="settingsGeminiApiVersion">
            <SelectField
              value={draft.gemini_api_version}
              options={[
                { value: "v1beta", label: "v1beta" },
                { value: "v1", label: "v1" },
              ]}
              onChange={(value) => onChange({ ...draft, gemini_api_version: value === "v1" ? "v1" : "v1beta" })}
              disabled={pending}
              radius="lg"
            />
          </SettingsFormField>
          <SettingsFormField label={t("settings.provider.geminiOutputMimeTypeLabel")} helpKey="settingsGeminiOutputMimeType">
            <SelectField
              value={draft.gemini_output_mime_type}
              options={[
                { value: "", label: t("settings.provider.geminiOutputMimeTypeDefault") },
                { value: "image/png", label: "image/png" },
                { value: "image/jpeg", label: "image/jpeg" },
                { value: "image/webp", label: "image/webp" },
              ]}
              onChange={(value) => onChange({ ...draft, gemini_output_mime_type: value })}
              disabled={pending}
              radius="lg"
            />
          </SettingsFormField>
        </div>
      ) : null}
      {draft.provider_kind === "openai_images" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <SettingsFormField label={t("settings.provider.imagesQualityLabel")} helpKey="settingsImagesQuality">
            <input
            value={draft.images_quality}
            disabled={pending}
            onChange={(event) => onChange({ ...draft, images_quality: event.target.value })}
              className={INPUT_CLASS}
              placeholder={t("settings.provider.imagesQualityPlaceholder")}
            />
          </SettingsFormField>
          <SettingsFormField label={t("settings.provider.imagesStyleLabel")} helpKey="settingsImagesStyle">
            <input
            value={draft.images_style}
            disabled={pending}
            onChange={(event) => onChange({ ...draft, images_style: event.target.value })}
              className={INPUT_CLASS}
              placeholder={t("settings.provider.imagesStylePlaceholder")}
            />
          </SettingsFormField>
        </div>
      ) : null}
      {draft.provider_kind === "openai_responses" ? (
        <label className="inline-flex items-center gap-3 text-sm font-medium text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={draft.responses_background_enabled}
            disabled={pending}
            onChange={(event) => onChange({ ...draft, responses_background_enabled: event.target.checked })}
            className="h-4 w-4 rounded border-slate-300 accent-indigo-600 dark:border-slate-600"
          />
          <ParameterHelpLabel
            label={t("settings.provider.responsesBackground")}
            helpKey="settingsResponsesBackground"
            uiType="settings"
          />
        </label>
      ) : null}
    </div>
  );
}

export function SettingsPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSessionState();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftValue>>({});
  const [draftSnapshots, setDraftSnapshots] = useState<Record<string, DraftSnapshot>>({});
  const [secretTouched, setSecretTouched] = useState<Record<string, boolean>>({});
  const [resettingKey, setResettingKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [activeSection, setActiveSection] = useState<SettingsSectionId>("providers");
  const [sectionSearch, setSectionSearch] = useState("");
  const [providerProfileForm, setProviderProfileForm] = useState<ProviderProfileFormState>(EMPTY_PROVIDER_FORM);
  const [editingProviderProfileId, setEditingProviderProfileId] = useState<string | null>(null);
  const [providerDrawerOpen, setProviderDrawerOpen] = useState(false);
  const [pendingDeleteProviderProfile, setPendingDeleteProviderProfile] = useState<ProviderProfile | null>(null);
  const [togglingProviderProfileId, setTogglingProviderProfileId] = useState<string | null>(null);
  const [generationConfigDrafts, setGenerationConfigDrafts] = useState<Record<string, GenerationConfigDraft>>({});
  const [archivingGenerationConfigId, setArchivingGenerationConfigId] = useState<string | null>(null);
  const [generationResourceGroupDrafts, setGenerationResourceGroupDrafts] = useState<
    Record<string, GenerationResourceGroupDraft>
  >({});
  const [archivingGenerationResourceGroupId, setArchivingGenerationResourceGroupId] = useState<string | null>(null);
  const [exportConfirmOpen, setExportConfirmOpen] = useState(false);
  const [importPayload, setImportPayload] = useState<SettingsExportPayload | null>(null);
  const [importPreview, setImportPreview] = useState<SettingsImportPreviewResponse | null>(null);
  const [importFileName, setImportFileName] = useState("");
  const [textConfigTestState, setTextConfigTestState] = useState<TextConfigTestState>({
    draft: DEFAULT_TEXT_CONFIG_TEST_DRAFT,
    latestKey: null,
    records: {},
  });

  const configQuery = useQuery({
    queryKey: ["config"],
    queryFn: api.getConfig,
  });

  const providerConfigQuery = useQuery({
    queryKey: ["provider-config"],
    queryFn: api.getProviderConfig,
  });

  const resetDraftsFromConfig = useCallback((config: ConfigResponse | undefined) => {
    if (!config) {
      return;
    }
    const next = draftsFromConfig(config);
    setDrafts(next.drafts);
    setDraftSnapshots(next.snapshots);
    setSecretTouched({});
  }, []);

  useEffect(() => {
    resetDraftsFromConfig(configQuery.data);
  }, [configQuery.data, resetDraftsFromConfig]);

  useEffect(() => {
    const firstEnabledGroupId =
      providerConfigQuery.data?.generation_resource_groups.find((group) => group.enabled && !group.archived_at)?.id ?? "";
    const nextDrafts: Record<string, GenerationConfigDraft> = {
      "new-text": { ...emptyGenerationConfigDraft("text"), resource_group_id: firstEnabledGroupId },
      "new-image": { ...emptyGenerationConfigDraft("image"), resource_group_id: firstEnabledGroupId },
    };
    for (const generationConfig of providerConfigQuery.data?.generation_configs ?? []) {
      if (!generationConfig.archived_at) {
        nextDrafts[generationConfig.id] = generationConfigDraft(generationConfig);
      }
    }
    setGenerationConfigDrafts(nextDrafts);
  }, [providerConfigQuery.data]);

  useEffect(() => {
    const nextDrafts: Record<string, GenerationResourceGroupDraft> = {
      "new-generation-resource-group": emptyGenerationResourceGroupDraft(),
    };
    for (const group of providerConfigQuery.data?.generation_resource_groups ?? []) {
      if (!group.archived_at) {
        nextDrafts[group.id] = generationResourceGroupDraft(group);
      }
    }
    setGenerationResourceGroupDrafts(nextDrafts);
  }, [providerConfigQuery.data]);

  const activeMeta = SETTINGS_SECTIONS.find((section) => section.id === activeSection) ?? SETTINGS_SECTIONS[0];
  const activeItems = itemsForSection(configQuery.data, activeSection);
  const activeConfigGroups = activeSection === "queue" ? configCategoryGroups(activeItems) : [];
  const canWriteRuntimeSettings = hasSessionApiPermission(session, API_SETTINGS_WRITE);
  const canWriteProviderSettings = hasSessionApiPermission(session, API_SETTINGS_PROVIDER_WRITE);
  const canMigrateSettings = hasSessionApiPermission(session, API_SETTINGS_MIGRATE);
  const canManageGlobalTemplates = hasSessionApiPermission(session, API_GLOBAL_TEMPLATES_MANAGE);
  const normalizedSectionSearch = sectionSearch.trim().toLowerCase();
  const visibleSections = normalizedSectionSearch
    ? SETTINGS_SECTIONS.filter(
        (section) =>
          t(section.labelKey).toLowerCase().includes(normalizedSectionSearch) ||
          t(section.descriptionKey).toLowerCase().includes(normalizedSectionSearch),
      )
    : SETTINGS_SECTIONS;

  const saveMutation = useMutation({
    mutationFn: () => {
      const values = configValuesFromChangedDrafts(activeItems, drafts, draftSnapshots, secretTouched);
      return api.updateConfig({ values });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["config"], data);
      void queryClient.invalidateQueries({ queryKey: ["runtime-config"] });
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      setError("");
      setSavedMessage(t("settings.saved"));
    },
    onError: (mutationError) => {
      setSavedMessage("");
      setError(mutationError instanceof ApiError ? mutationError.detail : t("settings.saveFailed"));
    },
  });

  const resetMutation = useMutation({
    mutationFn: (key: string) => api.updateConfig({ reset_keys: [key] }),
    onMutate: (key) => {
      setResettingKey(key);
      setError("");
      setSavedMessage("");
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["config"], data);
      void queryClient.invalidateQueries({ queryKey: ["runtime-config"] });
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      setSavedMessage(t("settings.restored"));
    },
    onError: (mutationError) => {
      setError(mutationError instanceof ApiError ? mutationError.detail : t("settings.restoreFailed"));
    },
    onSettled: () => setResettingKey(null),
  });

  const exportSettingsMutation = useMutation({
    mutationFn: api.exportSettings,
    onSuccess: (payload) => {
      downloadSettingsExport(payload);
      setExportConfirmOpen(false);
      setError("");
      setSavedMessage(t("settings.migration.exported"));
    },
    onError: (mutationError) => {
      setExportConfirmOpen(false);
      setSavedMessage("");
      setError(mutationError instanceof ApiError ? mutationError.detail : t("settings.migration.exportFailed"));
    },
  });

  const previewImportMutation = useMutation({
    mutationFn: async (file: File) => {
      const text = await file.text();
      let payload: unknown;
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        throw new Error(t("settings.migration.invalidJson"));
      }
      if (!isSettingsExportPayload(payload)) {
        throw new Error(t("settings.migration.invalidFile"));
      }
      const preview = await api.previewSettingsImport(payload);
      return { fileName: file.name, payload, preview };
    },
    onSuccess: ({ fileName, payload, preview }) => {
      setImportFileName(fileName);
      setImportPayload(payload);
      setImportPreview(preview);
      setError("");
      setSavedMessage("");
    },
    onError: (mutationError) => {
      setImportFileName("");
      setImportPayload(null);
      setImportPreview(null);
      setSavedMessage("");
      setError(
        mutationError instanceof ApiError
          ? mutationError.detail
          : mutationError instanceof Error
            ? mutationError.message
            : t("settings.migration.previewFailed"),
      );
    },
  });

  const commitImportMutation = useMutation({
    mutationFn: () => {
      if (!importPayload) {
        throw new Error(t("settings.migration.missingPreview"));
      }
      return api.importSettings(importPayload);
    },
    onSuccess: async (data) => {
      if (data.config) {
        queryClient.setQueryData(["config"], data.config);
      }
      if (data.provider_config) {
        queryClient.setQueryData(["provider-config"], data.provider_config);
      }
      await queryClient.invalidateQueries({ queryKey: ["config"] });
      await queryClient.invalidateQueries({ queryKey: ["provider-config"] });
      await queryClient.invalidateQueries({ queryKey: ["my-generation-resource-groups"] });
      await queryClient.invalidateQueries({ queryKey: ["generation-config-options"] });
      await queryClient.invalidateQueries({ queryKey: ["generation-config-status"] });
      await queryClient.invalidateQueries({ queryKey: ["runtime-config"] });
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      await queryClient.invalidateQueries({ queryKey: ["canvas-templates"] });
      await queryClient.invalidateQueries({ queryKey: ["canvas-template-categories"] });
      setImportPayload(null);
      setImportPreview(null);
      setImportFileName("");
      setError("");
      setSavedMessage(t("settings.migration.imported"));
    },
    onError: (mutationError) => {
      setSavedMessage("");
      setError(
        mutationError instanceof ApiError
          ? mutationError.detail
          : mutationError instanceof Error
            ? mutationError.message
            : t("settings.migration.importFailed"),
      );
    },
  });

  const createProviderProfileMutation = useMutation({
    mutationFn: () => api.createProviderProfile(providerProfileCreatePayload(providerProfileForm)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["provider-config"] });
      setProviderProfileForm(EMPTY_PROVIDER_FORM);
      setEditingProviderProfileId(null);
      setProviderDrawerOpen(false);
      setError("");
      setSavedMessage(t("settings.provider.saved"));
    },
    onError: (mutationError) => {
      setSavedMessage("");
      setError(mutationError instanceof ApiError ? mutationError.detail : t("settings.provider.saveFailed"));
    },
  });

  const updateProviderProfileMutation = useMutation({
    mutationFn: () => {
      if (!editingProviderProfileId) {
        throw new Error(t("settings.provider.missingId"));
      }
      return api.updateProviderProfile(editingProviderProfileId, providerProfileUpdatePayload(providerProfileForm));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["provider-config"] });
      setProviderProfileForm(EMPTY_PROVIDER_FORM);
      setEditingProviderProfileId(null);
      setProviderDrawerOpen(false);
      setError("");
      setSavedMessage(t("settings.provider.saved"));
    },
    onError: (mutationError) => {
      setSavedMessage("");
      setError(mutationError instanceof ApiError ? mutationError.detail : t("settings.provider.saveFailed"));
    },
  });

  const deleteProviderProfileMutation = useMutation({
    mutationFn: (profileId: string) => api.archiveProviderProfile(profileId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["provider-config"] });
      setPendingDeleteProviderProfile(null);
      setError("");
      setSavedMessage(t("settings.provider.deletedMessage"));
    },
    onError: (mutationError) => {
      setPendingDeleteProviderProfile(null);
      setSavedMessage("");
      setError(mutationError instanceof ApiError ? mutationError.detail : t("settings.provider.deleteFailed"));
    },
  });

  const updateProviderProfileEnabledMutation = useMutation({
    mutationFn: ({ profileId, enabled }: { profileId: string; enabled: boolean }) =>
      api.updateProviderProfile(profileId, { enabled }),
    onMutate: ({ profileId }) => {
      setTogglingProviderProfileId(profileId);
      setError("");
      setSavedMessage("");
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["provider-config"] });
      setError("");
      setSavedMessage(t("settings.provider.saved"));
    },
    onError: (mutationError) => {
      setSavedMessage("");
      setError(mutationError instanceof ApiError ? mutationError.detail : t("settings.provider.saveFailed"));
    },
    onSettled: () => setTogglingProviderProfileId(null),
  });

  const saveGenerationConfigMutation = useMutation({
    mutationFn: (draft: GenerationConfigDraft) => {
      const payload = generationConfigPayloadFromDraft(draft);
      return draft.id
        ? api.updateGenerationConfig(draft.id, payload as GenerationConfigUpdateRequest)
        : api.createGenerationConfig(payload as GenerationConfigCreateRequest);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["provider-config"] });
      await queryClient.invalidateQueries({ queryKey: ["generation-config-options"] });
      await queryClient.invalidateQueries({ queryKey: ["generation-config-status"] });
      setError("");
      setSavedMessage(t("settings.generation.saved"));
    },
    onError: (mutationError) => {
      setSavedMessage("");
      setError(mutationError instanceof ApiError ? mutationError.detail : t("settings.generation.saveFailed"));
    },
  });

  const archiveGenerationConfigMutation = useMutation({
    mutationFn: (configId: string) => api.archiveGenerationConfig(configId),
    onMutate: (configId) => {
      setArchivingGenerationConfigId(configId);
      setError("");
      setSavedMessage("");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["provider-config"] });
      await queryClient.invalidateQueries({ queryKey: ["generation-config-options"] });
      await queryClient.invalidateQueries({ queryKey: ["generation-config-status"] });
      setError("");
      setSavedMessage(t("settings.generation.archived"));
    },
    onError: (mutationError) => {
      setSavedMessage("");
      setError(mutationError instanceof ApiError ? mutationError.detail : t("settings.generation.archiveFailed"));
    },
    onSettled: () => setArchivingGenerationConfigId(null),
  });

  const saveGenerationResourceGroupMutation = useMutation({
    mutationFn: (draft: GenerationResourceGroupDraft) => {
      const payload = generationResourceGroupPayloadFromDraft(draft);
      return draft.id
        ? api.updateGenerationResourceGroup(draft.id, payload as GenerationResourceGroupUpdateRequest)
        : api.createGenerationResourceGroup(payload as GenerationResourceGroupCreateRequest);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["provider-config"] });
      await queryClient.invalidateQueries({ queryKey: ["my-generation-resource-groups"] });
      await queryClient.invalidateQueries({ queryKey: ["generation-config-options"] });
      await queryClient.invalidateQueries({ queryKey: ["generation-config-status"] });
      setError("");
      setSavedMessage(t("settings.resourceGroup.saved"));
    },
    onError: (mutationError) => {
      setSavedMessage("");
      setError(mutationError instanceof ApiError ? mutationError.detail : t("settings.resourceGroup.saveFailed"));
    },
  });

  const archiveGenerationResourceGroupMutation = useMutation({
    mutationFn: (groupId: string) => api.archiveGenerationResourceGroup(groupId),
    onMutate: (groupId) => {
      setArchivingGenerationResourceGroupId(groupId);
      setError("");
      setSavedMessage("");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["provider-config"] });
      await queryClient.invalidateQueries({ queryKey: ["my-generation-resource-groups"] });
      await queryClient.invalidateQueries({ queryKey: ["generation-config-options"] });
      await queryClient.invalidateQueries({ queryKey: ["generation-config-status"] });
      setError("");
      setSavedMessage(t("settings.resourceGroup.archived"));
    },
    onError: (mutationError) => {
      setSavedMessage("");
      setError(mutationError instanceof ApiError ? mutationError.detail : t("settings.resourceGroup.archiveFailed"));
    },
    onSettled: () => setArchivingGenerationResourceGroupId(null),
  });

  const testTextGenerationConfigMutation = useMutation({
    mutationFn: ({ payload }: TextGenerationConfigTestMutationInput) => api.testTextGenerationConfig(payload),
    onMutate: ({ key }) => {
      setTextConfigTestState((current) => markTextConfigTestStarted(current, key));
      setSavedMessage("");
      setError("");
    },
    onSuccess: (result, { key }) => {
      setTextConfigTestState((current) => markTextConfigTestSucceeded(current, key, result));
    },
    onError: (mutationError, { key }) => {
      setTextConfigTestState((current) =>
        markTextConfigTestFailed(
          current,
          key,
          mutationError instanceof ApiError ? mutationError.detail : t("settings.generation.testFailed"),
        ),
      );
    },
  });

  const logoutMutation = useMutation({
    mutationFn: api.destroySession,
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: ["config"] });
      queryClient.removeQueries({ queryKey: ["provider-config"] });
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      navigate("/login", { replace: true });
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canWriteRuntimeSettings) {
      return;
    }
    setError("");
    setSavedMessage("");
    saveMutation.mutate();
  };

  const handleImportFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (!file || !canMigrateSettings) {
      return;
    }
    setError("");
    setSavedMessage("");
    previewImportMutation.mutate(file);
  };

  const providerProfilePending =
    createProviderProfileMutation.isPending ||
    updateProviderProfileMutation.isPending ||
    deleteProviderProfileMutation.isPending ||
    updateProviderProfileEnabledMutation.isPending;
  const providerPending = providerProfilePending || saveGenerationConfigMutation.isPending;
  const resourceGroupPending =
    saveGenerationResourceGroupMutation.isPending || archiveGenerationResourceGroupMutation.isPending;

  const loadingMain = configQuery.isLoading || providerConfigQuery.isLoading;
  const genericSection = ["prompts", "upload", "queue", "security"].includes(activeSection);

  return (
    <div className="pf-app flex flex-col dark:text-slate-100">
      <TopNav
        breadcrumbs={t("settings.breadcrumb")}
        onLogout={() => logoutMutation.mutate()}
      />

      <main className="mx-auto flex w-full max-w-[1440px] flex-1">
        <div className="w-full">
          <div className="pf-page-header mx-auto mb-0 w-full max-w-[1440px] px-5 py-6 md:flex-row md:items-end md:justify-between lg:px-8 lg:py-8">
            <div>
              <div className="pf-eyebrow mb-2 gap-1.5">
                <SettingsIcon size={13} className="mr-1.5" />
                {t("settings.runtimeConfig")}
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">
                {t("settings.title")}
              </h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t("settings.description")}</p>
            </div>
          </div>

          {loadingMain ? (
            <div className="flex justify-center py-20 text-zinc-400 dark:text-slate-500">
              <Loader2 size={22} className="animate-spin" />
            </div>
          ) : configQuery.isError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200">
              {configQuery.error instanceof ApiError ? configQuery.error.detail : t("settings.loadFailed")}
            </div>
          ) : (
            <div className="pf-side-shell min-h-full">
              <aside className="pf-side-rail">
                <div className="border-b border-slate-200 px-5 py-7 dark:border-slate-800">
                  <div className="flex items-center gap-3 text-lg font-semibold text-slate-950 dark:text-white">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-violet-500/15 dark:text-violet-200">
                      <SettingsIcon size={20} />
                    </span>
                    {t("settings.title")}
                  </div>
                  <label className="mt-6 flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-400 shadow-sm shadow-slate-200/30 dark:border-slate-700 dark:bg-[#0b1220] dark:text-slate-500 dark:shadow-black/20">
                    <Search size={16} />
                    <input
                      value={sectionSearch}
                      onChange={(event) => setSectionSearch(event.target.value)}
                      placeholder={t("settings.searchPlaceholder")}
                      className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
                    />
                  </label>
                </div>
                <nav className="hidden space-y-6 px-3 py-5 lg:block" aria-label={t("settings.navLabel")}>
                  {SETTINGS_GROUPS.map((group) => {
                    const sections = visibleSections.filter((section) => section.groupKey === group);
                    if (!sections.length) {
                      return null;
                    }
                    return (
                      <div key={group}>
                        <div className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          {t(group)}
                        </div>
                        <div className="mt-2 space-y-1">
                          {sections.map((section) => {
                            const Icon = section.icon;
                            const active = section.id === activeSection;
                            return (
                              <button
                                key={section.id}
                                type="button"
                                onClick={() => setActiveSection(section.id)}
                                className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors ${
                                  active
                                    ? "bg-indigo-50 font-semibold text-indigo-700 ring-1 ring-indigo-200 dark:bg-violet-500/18 dark:text-violet-100 dark:ring-violet-400/35"
                                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-violet-500/12 dark:hover:text-white"
                                }`}
                              >
                                <Icon size={15} className={active ? "shrink-0 text-indigo-600 dark:text-violet-200" : "shrink-0 text-slate-400 dark:text-slate-500"} />
                                <span className="truncate">{t(section.labelKey)}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </nav>
                <div className="p-4 lg:hidden">
                  <label htmlFor="settings-section" className="mb-2 block text-xs font-semibold text-slate-500 dark:text-slate-400">
                    {t("settings.mobileSectionLabel")}
                  </label>
                  <SelectField
                    id="settings-section"
                    value={activeSection}
                    groups={SETTINGS_GROUPS.map((group) => ({
                      label: t(group),
                      options: SETTINGS_SECTIONS.filter((section) => section.groupKey === group).map((section) => ({
                        value: section.id,
                        label: t(section.labelKey),
                      })),
                    }))}
                    onChange={(value) => setActiveSection(value as SettingsSectionId)}
                    radius="lg"
                  />
                </div>
              </aside>

              <section className="pf-side-content px-5 py-8 sm:px-8 lg:px-12 lg:py-10">
                <div className="mx-auto max-w-4xl">
                  <div className="mb-10">
                    <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400">
                      <span>{t("settings.title")}</span>
                      <span>/</span>
                      <span>{t(activeMeta.labelKey)}</span>
                    </div>
                    <h1 className="text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">
                      {t(activeMeta.labelKey)}
                    </h1>
                    <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                      {t(activeMeta.descriptionKey)}
                    </p>
                  </div>
                  {shouldShowSettingsMigrationPanel(activeSection) ? (
                    <SettingsMigrationPanel
                      importInputRef={importInputRef}
                      importFileName={importFileName}
                      importPreview={importPreview}
                      canMigrate={canMigrateSettings}
                      exportBusy={exportSettingsMutation.isPending}
                      importPreviewBusy={previewImportMutation.isPending}
                      importCommitBusy={commitImportMutation.isPending}
                      onRequestExport={() => {
                        setError("");
                        setSavedMessage("");
                        setExportConfirmOpen(true);
                      }}
                      onChooseImportFile={() => {
                        if (canMigrateSettings) {
                          importInputRef.current?.click();
                        }
                      }}
                      onImportFileChange={handleImportFileChange}
                      onCommitImport={() => {
                        if (canMigrateSettings) {
                          commitImportMutation.mutate();
                        }
                      }}
                      onCancelImport={() => {
                        setImportPayload(null);
                        setImportPreview(null);
                        setImportFileName("");
                      }}
                    />
                  ) : null}
                  {shouldShowGlobalTemplatesPanel(activeSection) ? (
                    <div className={`${PANEL_CLASS} flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between`}>
                      <div>
                        <h2 className="text-base font-semibold text-slate-950 dark:text-white">
                          {t("settings.section.globalTemplates")}
                        </h2>
                        <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                          {t("settings.section.globalTemplatesDescription")}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => navigate("/settings/global-templates")}
                        disabled={!canManageGlobalTemplates}
                        className={SETTINGS_MAIN_ACTION_CLASS}
                      >
                        <Layers3 size={14} className="mr-2" />
                        {t("nav.globalTemplates")}
                      </button>
                    </div>
                  ) : null}
                  {error ? (
                    <div className="mb-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200">
                      {error}
                    </div>
                  ) : null}
                  {savedMessage ? (
                    <div className="mb-5 flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/10 dark:text-emerald-200">
                      <CheckCircle2 size={16} className="mr-2" />
                      {savedMessage}
                    </div>
                  ) : null}
                  <div>
                    {activeSection === "providers" ? (
                      <ProvidersSection
                        data={providerConfigQuery.data}
                        profileForm={providerProfileForm}
                        editingProfileId={editingProviderProfileId}
                        drawerOpen={providerDrawerOpen}
                        pending={providerProfilePending}
                        togglingProfileId={togglingProviderProfileId}
                        canWrite={canWriteProviderSettings}
                        onProfileFormChange={setProviderProfileForm}
                        onOpenCreate={() => {
                          if (!canWriteProviderSettings) {
                            return;
                          }
                          const next = providerDrawerCreateState();
                          setEditingProviderProfileId(next.editingProfileId);
                          setProviderProfileForm(next.form);
                          setProviderDrawerOpen(next.open);
                          setError("");
                          setSavedMessage("");
                        }}
                        onEditProfile={(profile) => {
                          if (!canWriteProviderSettings) {
                            return;
                          }
                          const next = providerDrawerEditState(profile);
                          setEditingProviderProfileId(next.editingProfileId);
                          setProviderProfileForm(next.form);
                          setProviderDrawerOpen(next.open);
                          setError("");
                          setSavedMessage("");
                        }}
                        onCloseDrawer={() => {
                          setEditingProviderProfileId(null);
                          setProviderProfileForm(EMPTY_PROVIDER_FORM);
                          setProviderDrawerOpen(false);
                        }}
                        onSubmitProfile={() => {
                          if (!canWriteProviderSettings) {
                            return;
                          }
                          setError("");
                          setSavedMessage("");
                          if (editingProviderProfileId) {
                            updateProviderProfileMutation.mutate();
                            return;
                          }
                          createProviderProfileMutation.mutate();
                        }}
                        onDeleteProfile={(profile) => {
                          if (!canWriteProviderSettings) {
                            return;
                          }
                          setError("");
                          setSavedMessage("");
                          setPendingDeleteProviderProfile(profile);
                        }}
                        onToggleProfileEnabled={(profileId, enabled) => {
                          if (!canWriteProviderSettings) {
                            return;
                          }
                          updateProviderProfileEnabledMutation.mutate({ profileId, enabled });
                        }}
                      />
                    ) : null}

                    {activeSection === "resourceGroups" ? (
                      <GenerationResourceGroupSection
                        groups={providerConfigQuery.data?.generation_resource_groups ?? []}
                        drafts={generationResourceGroupDrafts}
                        pending={resourceGroupPending}
                        archivingGroupId={archivingGenerationResourceGroupId}
                        canWrite={canWriteProviderSettings}
                        onChange={(key, next) => {
                          setGenerationResourceGroupDrafts((current) => ({ ...current, [key]: next }));
                          setSavedMessage("");
                        }}
                        onSave={(draft) => {
                          if (!canWriteProviderSettings) {
                            return;
                          }
                          setError("");
                          setSavedMessage("");
                          saveGenerationResourceGroupMutation.mutate(draft);
                        }}
                        onArchive={(groupId) => {
                          if (!canWriteProviderSettings) {
                            return;
                          }
                          archiveGenerationResourceGroupMutation.mutate(groupId);
                        }}
                      />
                    ) : null}

                    {activeSection === "text" ? (
                      <GenerationConfigPoolSection
                        data={providerConfigQuery.data}
                        purpose="text"
                        drafts={generationConfigDrafts}
                        pending={providerPending}
                        archivingConfigId={archivingGenerationConfigId}
                        canWrite={canWriteProviderSettings}
                        textTestState={textConfigTestState}
                        onChange={(key, next) => {
                          setGenerationConfigDrafts((current) => ({ ...current, [key]: next }));
                          setSavedMessage("");
                        }}
                        onSave={(draft) => {
                          if (!canWriteProviderSettings) {
                            return;
                          }
                          setError("");
                          setSavedMessage("");
                          saveGenerationConfigMutation.mutate(draft);
                        }}
                        onArchive={(configId) => {
                          if (!canWriteProviderSettings) {
                            return;
                          }
                          archiveGenerationConfigMutation.mutate(configId);
                        }}
                        onTextTestDraftChange={(draft) => {
                          setTextConfigTestState((current) => ({ ...current, draft }));
                        }}
                        onTestTextConfig={(draft) => {
                          if (!canWriteProviderSettings) {
                            return;
                          }
                          testTextGenerationConfigMutation.mutate({
                            key: generationConfigDraftKey(draft),
                            payload: textGenerationConfigTestPayload(draft, textConfigTestState.draft),
                          });
                        }}
                        onRefreshSort={() => {
                          void queryClient.invalidateQueries({ queryKey: ["provider-config"] });
                        }}
                      />
                    ) : null}

                    {activeSection === "image" ? (
                      <GenerationConfigPoolSection
                        data={providerConfigQuery.data}
                        purpose="image"
                        drafts={generationConfigDrafts}
                        pending={providerPending}
                        archivingConfigId={archivingGenerationConfigId}
                        canWrite={canWriteProviderSettings}
                        onChange={(key, next) => {
                          setGenerationConfigDrafts((current) => ({ ...current, [key]: next }));
                          setSavedMessage("");
                        }}
                        onSave={(draft) => {
                          if (!canWriteProviderSettings) {
                            return;
                          }
                          setError("");
                          setSavedMessage("");
                          saveGenerationConfigMutation.mutate(draft);
                        }}
                        onArchive={(configId) => {
                          if (!canWriteProviderSettings) {
                            return;
                          }
                          archiveGenerationConfigMutation.mutate(configId);
                        }}
                        onRefreshSort={() => {
                          void queryClient.invalidateQueries({ queryKey: ["provider-config"] });
                        }}
                      />
                    ) : null}

                    {genericSection ? (
                      <form onSubmit={handleSubmit} className={`${PANEL_CLASS} space-y-2`}>
                        {activeItems.length ? (
                          activeSection === "queue" ? (
                            <div className="space-y-1">
                              {activeConfigGroups.map((group) => (
                                <div key={group.category} className="border-t border-slate-100 py-2 first:border-t-0 dark:border-slate-800">
                                  <div className="px-1 py-3">
                                    <h3 className="text-sm font-semibold text-slate-950 dark:text-white">
                                      {group.title}
                                    </h3>
                                  </div>
                                  {group.items.map((item) => (
                                    <ConfigField
                                      key={item.key}
                                      item={item}
                                      value={drafts[item.key] ?? draftFromItem(item)}
                                      secretTouched={Boolean(secretTouched[item.key])}
                                      isResetting={resettingKey === item.key}
                                      disabled={!canWriteRuntimeSettings}
                                      onChange={(nextValue, touchedSecret) => {
                                        setDrafts((current) => ({ ...current, [item.key]: nextValue }));
                                        setSavedMessage("");
                                        if (touchedSecret) {
                                          setSecretTouched((current) => ({ ...current, [item.key]: true }));
                                        }
                                      }}
                                      onReset={() => {
                                        if (canWriteRuntimeSettings) {
                                          resetMutation.mutate(item.key);
                                        }
                                      }}
                                    />
                                  ))}
                                </div>
                              ))}
                            </div>
                          ) : activeSection === "upload" ? (
                            <div className="grid gap-3 lg:grid-cols-2">
                              {activeItems.map((item) => (
                                <ConfigField
                                  key={item.key}
                                  item={item}
                                  value={drafts[item.key] ?? draftFromItem(item)}
                                  secretTouched={Boolean(secretTouched[item.key])}
                                  isResetting={resettingKey === item.key}
                                  layout="card"
                                  disabled={!canWriteRuntimeSettings}
                                  onChange={(nextValue, touchedSecret) => {
                                    setDrafts((current) => ({ ...current, [item.key]: nextValue }));
                                    setSavedMessage("");
                                    if (touchedSecret) {
                                      setSecretTouched((current) => ({ ...current, [item.key]: true }));
                                    }
                                  }}
                                  onReset={() => {
                                    if (canWriteRuntimeSettings) {
                                      resetMutation.mutate(item.key);
                                    }
                                  }}
                                />
                              ))}
                            </div>
                          ) : (
                            activeItems.map((item) => (
                              <ConfigField
                                key={item.key}
                                item={item}
                                value={drafts[item.key] ?? draftFromItem(item)}
                                secretTouched={Boolean(secretTouched[item.key])}
                                isResetting={resettingKey === item.key}
                                disabled={!canWriteRuntimeSettings}
                                onChange={(nextValue, touchedSecret) => {
                                  setDrafts((current) => ({ ...current, [item.key]: nextValue }));
                                  setSavedMessage("");
                                  if (touchedSecret) {
                                    setSecretTouched((current) => ({ ...current, [item.key]: true }));
                                  }
                                }}
                                onReset={() => {
                                  if (canWriteRuntimeSettings) {
                                    resetMutation.mutate(item.key);
                                  }
                                }}
                              />
                            ))
                          )
                        ) : (
                          <div className="rounded-lg border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                            {t("settings.section.empty")}
                          </div>
                        )}
                        <div className="flex justify-end gap-3 border-t border-slate-100 pt-5 dark:border-slate-800">
                          <button
                            type="button"
                            onClick={() => resetDraftsFromConfig(configQuery.data)}
                            disabled={!canWriteRuntimeSettings}
                            className="px-4 py-2 text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-slate-300 dark:hover:text-white"
                          >
                            {t("settings.discard")}
                          </button>
                          <button
                            type="submit"
                            disabled={!canWriteRuntimeSettings || saveMutation.isPending}
                            className={SETTINGS_MAIN_ACTION_CLASS}
                          >
                            {saveMutation.isPending ? (
                              <Loader2 size={14} className="mr-2 animate-spin" />
                            ) : (
                              <Save size={14} className="mr-2" />
                            )}
                            {t("settings.save")}
                          </button>
                        </div>
                      </form>
                    ) : null}
                  </div>
                </div>
              </section>
            </div>
          )}

        </div>
        <ConfirmDialog
          open={exportConfirmOpen}
          title={t("settings.migration.exportConfirmTitle")}
          description={t("settings.migration.exportConfirm")}
          confirmLabel={t("settings.migration.exportConfirmLabel")}
          cancelLabel={t("common.cancel")}
          busy={exportSettingsMutation.isPending}
          destructive={false}
          onClose={() => setExportConfirmOpen(false)}
          onConfirm={() => exportSettingsMutation.mutate()}
        />
        <ConfirmDialog
          open={Boolean(pendingDeleteProviderProfile)}
          title={t("settings.provider.deleteConfirmTitle")}
          description={
            pendingDeleteProviderProfile
              ? t("settings.provider.deleteConfirm", { name: pendingDeleteProviderProfile.name })
              : ""
          }
          confirmLabel={t("settings.provider.deleteConfirmLabel")}
          cancelLabel={t("common.cancel")}
          busy={deleteProviderProfileMutation.isPending}
          onClose={() => setPendingDeleteProviderProfile(null)}
          onConfirm={() => {
            if (canWriteProviderSettings && pendingDeleteProviderProfile) {
              deleteProviderProfileMutation.mutate(pendingDeleteProviderProfile.id);
            }
          }}
        />
      </main>
    </div>
  );
}
