import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Layers3,
  Settings as SettingsIcon,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { GalleryTagPickerDialog } from "../components/GalleryTagPickerDialog";
import { actionButtonComponentForAppearance } from "../components/layoutActionButtons";
import {
  SaveToResourceLibraryDialog,
  type ResourceLibrarySaveSource,
} from "../components/resource-library/SaveToResourceLibraryDialog";
import { TopNav } from "../components/TopNav";
import { api, ApiError } from "../lib/api";
import { cssLengthToPixels } from "../lib/cssLength";
import { useI18n } from "../lib/preferences";
import {
  API_GLOBAL_TEMPLATES_MANAGE,
  API_GALLERY_WRITE,
  API_SETTINGS_MIGRATE,
  API_SETTINGS_PROVIDER_WRITE,
  API_SETTINGS_WRITE,
  hasSessionApiPermission,
} from "../lib/rbac";
import { useSessionState } from "../lib/session";
import { useUiLayoutScheme } from "../lib/uiLayoutSchemePreference";
import type {
  ConfigItem,
  ConfigResponse,
  LoginPageMode,
  LoginPageTemplateId,
  GenerationConfig,
  GenerationConfigCreateRequest,
  GenerationConfigUpdateRequest,
  GenerationResourceGroup,
  GenerationResourceGroupCreateRequest,
  GenerationResourceGroupUpdateRequest,
  ResourceLibraryAsset,
  ProviderProfile,
  SettingsExportPayload,
  SettingsImportPreviewResponse,
  ImageGenerationConfigTestRequest,
  ImageGenerationConfigTestResponse,
  TextGenerationConfigJsonResponseFormatTestRequest,
  TextGenerationConfigTestRequest,
} from "../lib/types";
import {
  downloadSettingsExport,
  isSettingsExportPayload,
} from "./settings/importExport";
import {
  isLoginPageMode,
  isLoginPageTemplateId,
  loginPageTemplateConfigItem,
  loginPageTemplateIdFromConfigKey,
  parseLoginPageTemplateConfigDraft,
  serializeLoginPageTemplateConfigDraft,
} from "./settings/loginPageTemplate";
import type { DraftValue, PendingProviderDisable } from "./settings/types";
import {
  clearImageConfigTestRecord,
  clearTextConfigJsonResponseFormatTestRecord,
  clearTextConfigTestRecord,
  DEFAULT_IMAGE_CONFIG_TEST_PRESETS,
  DEFAULT_TEXT_CONFIG_TEST_PRESETS,
  markImageConfigTestAssetSaved,
  markImageConfigTestFailed,
  markImageConfigTestStarted,
  markImageConfigTestSucceeded,
  markTextConfigJsonResponseFormatTestFailed,
  markTextConfigJsonResponseFormatTestStarted,
  markTextConfigJsonResponseFormatTestSucceeded,
  markTextConfigTestFailed,
  markTextConfigTestStarted,
  markTextConfigTestSucceeded,
  normalizeImageConfigTestDraft,
  normalizeImageConfigTestDraftState,
  normalizeTextConfigTestDraft,
  normalizeTextConfigTestDraftState,
  readImageConfigTestDraftState,
  readTextConfigTestDraftState,
  textConfigJsonResponseFormatTestRecordForKey,
  textConfigTestRecordForKey,
  writeImageConfigTestDraftState,
  writeTextConfigTestDraftState,
  type ImageConfigTestState,
  type TextConfigJsonResponseFormatTestState,
  type TextConfigTestState,
} from "./settings/configTestState";
import {
  configValuesFromChangedDrafts,
  draftsFromConfig,
  type DraftSnapshot,
} from "./settings/configDrafts";
import { configItemHelpContent } from "./settings/configHelp";
import {
  SETTINGS_SECTIONS,
  SETTINGS_DEFAULT_SECTION_ID,
  configCategoryGroups,
  isSettingsSectionPathname,
  settingsPathForSection,
  settingsSectionFromPathSegment,
  itemsForSection,
  settingsSectionIds,
  shouldShowGlobalTemplatesPanel,
  shouldShowSettingsMigrationPanel,
  type SettingsSectionId,
} from "./settings/sections";
import {
  archiveFailureMessage,
  imageGenerationConfigTestPayload,
  imageGenerationConfigTestResultWithGalleryEntry,
  textGenerationConfigJsonResponseFormatTestPayload,
  textGenerationConfigTestPayload,
} from "./settings/providerConfigOps";
import {
  generationConfigBatchFailedSelectableIds,
  generationConfigBatchSelectableIds,
  generationConfigDraft,
  generationConfigDraftAfterProviderProfileSelection,
  generationConfigLatestTestDetail,
  generationConfigPayloadFromDraft,
  newGenerationConfigDraft,
  runGenerationConfigBatchTests,
  type GenerationConfigDraft,
} from "./settings/generationConfig";
import {
  emptyGenerationResourceGroupDraft,
  generationConfigResourceGroupIds,
  generationResourceGroupDraft,
  generationResourceGroupPayloadFromDraft,
  type GenerationResourceGroupDraft,
} from "./settings/resourceGroups";
import {
  EMPTY_PROVIDER_FORM,
  generationConfigsUsingProvider,
  providerDisableBlocked,
  providerDrawerCreateState,
  providerDrawerEditState,
  providerFormFromProfile,
  providerProfileCreatePayload,
  providerProfileUpdatePayload,
  providerUsageFromGenerationConfigs,
  providerUsageLabelKeys,
  settingsGenerationResourceGroupsInApiOrder,
  type ProviderProfileFormState,
} from "./settings/providerForm";
import {
  PANEL_CLASS,
  SETTINGS_BORDERED_MODULE_CLASS,
} from "./settings/components/styles";
import { NotificationSettingsPanel } from "./settings/components/NotificationSettingsPanel";
import { LoginPageSettingsPanel } from "./settings/components/LoginPageSettingsPanel";
import { ProviderDisableConfirmDialog } from "./settings/components/ProviderDisableConfirmDialog";
import { ImageConfigTestResultDialog } from "./settings/components/ImageConfigTestResultDialog";
import { GenerationResourceGroupSection } from "./settings/components/GenerationResourceGroupSection";
import { SettingsMigrationPanel } from "./settings/components/SettingsMigrationPanel";
import { GenerationConfigPoolSection } from "./settings/components/GenerationConfigSection";
import { ProvidersSection } from "./settings/components/ProvidersSection";
import { SettingsSideRail } from "./settings/components/SettingsSideRail";
import { GenericConfigSection } from "./settings/components/GenericConfigSection";
import { SettingsFeedbackDialog } from "./settings/components/SettingsFeedbackDialog";
import { WeatherSettingsPanel } from "./settings/components/WeatherSettingsPanel";

export {
  isLoginPageMode,
  isLoginPageTemplateId,
  loginPageTemplateConfigItem,
  loginPageTemplateIdFromConfigKey,
  parseLoginPageTemplateConfigDraft,
  serializeLoginPageTemplateConfigDraft,
};
export { filterProviderModels } from "./settings/providerModels";
export { filterProviderProfiles, filterProviderProfilesByName } from "./settings/providerForm";
export {
  SETTINGS_DEFAULT_SECTION_ID,
  archiveFailureMessage,
  configCategoryGroups,
  isSettingsSectionPathname,
  settingsPathForSection,
  settingsSectionFromPathSegment,
  settingsSectionIds,
  shouldShowSettingsMigrationPanel,
};
export {
  filterGenerationConfigsByLatestTestFailure,
  filterGenerationConfigsByName,
  providerProfilesForGenerationConfig,
} from "./settings/generationConfig";
export {
  generationConfigBatchFailedSelectableIds,
  generationConfigBatchSelectableIds,
  generationConfigDraft,
  generationConfigDraftAfterProviderProfileSelection,
  generationConfigLatestTestDetail,
  generationConfigPayloadFromDraft,
  newGenerationConfigDraft,
  runGenerationConfigBatchTests,
};
export type { GenerationConfigDraft };

export {
  clearTextConfigJsonResponseFormatTestRecord,
  clearTextConfigTestRecord,
  DEFAULT_IMAGE_CONFIG_TEST_PRESETS,
  DEFAULT_TEXT_CONFIG_TEST_PRESETS,
  markTextConfigJsonResponseFormatTestFailed,
  markTextConfigJsonResponseFormatTestStarted,
  markTextConfigJsonResponseFormatTestSucceeded,
  markTextConfigTestFailed,
  markTextConfigTestStarted,
  markTextConfigTestSucceeded,
  normalizeImageConfigTestDraft,
  normalizeImageConfigTestDraftState,
  normalizeTextConfigTestDraft,
  normalizeTextConfigTestDraftState,
  textConfigJsonResponseFormatTestRecordForKey,
  textConfigTestRecordForKey,
};
export type { TextConfigJsonResponseFormatTestState, TextConfigTestState };
export { configValuesFromChangedDrafts, draftsFromConfig };
export { generationConfigResourceGroupIds };
export { configItemHelpContent };
export {
  providerConfigWithGenerationConfig,
  providerConfigWithGenerationResourceGroup,
  providerConfigWithProviderProfile,
} from "./settings/providerConfigOps";
export {
  generationConfigsUsingProvider,
  providerDisableBlocked,
  providerDrawerCreateState,
  providerDrawerEditState,
  providerFormFromProfile,
  providerProfileCreatePayload,
  providerProfileUpdatePayload,
  providerUsageFromGenerationConfigs,
  providerUsageLabelKeys,
  settingsGenerationResourceGroupsInApiOrder,
};

interface TextGenerationConfigTestMutationInput {
  key: string;
  payload: TextGenerationConfigTestRequest;
}

interface TextGenerationConfigJsonResponseFormatTestMutationInput {
  key: string;
  payload: TextGenerationConfigJsonResponseFormatTestRequest;
}

interface ImageGenerationConfigTestMutationInput {
  key: string;
  payload: ImageGenerationConfigTestRequest;
}

type PendingGenerationArchive =
  | { kind: "resourceGroup"; id: string; name: string }
  | { kind: "generationConfig"; id: string; name: string };

const SETTINGS_SAVED_MESSAGE_AUTO_DISMISS_MS = 1000;
const SETTINGS_SECTION_PREFETCH_STALE_TIME_MS = 30_000;
const SETTINGS_RUNTIME_CONFIG_SECTIONS = [
  "prompts",
  "upload",
  "queue",
  "layoutAppearance",
  "loginPage",
  "security",
] as const;

type SettingsRuntimeConfigSection = (typeof SETTINGS_RUNTIME_CONFIG_SECTIONS)[number];

export function runtimeConfigSectionForSettingsSection(
  section: SettingsSectionId,
): SettingsRuntimeConfigSection | null {
  return SETTINGS_RUNTIME_CONFIG_SECTIONS.includes(section as SettingsRuntimeConfigSection)
    ? (section as SettingsRuntimeConfigSection)
    : null;
}

export function filterConfigResponseForSettingsSection(
  config: ConfigResponse,
  section: SettingsSectionId,
): ConfigResponse {
  return { items: itemsForSection(config, section) };
}

function configQueryKeyForSettingsSection(section: SettingsRuntimeConfigSection) {
  return ["config", section] as const;
}

function setRuntimeConfigSectionCaches(queryClient: ReturnType<typeof useQueryClient>, config: ConfigResponse) {
  for (const section of SETTINGS_RUNTIME_CONFIG_SECTIONS) {
    queryClient.setQueryData(
      configQueryKeyForSettingsSection(section),
      filterConfigResponseForSettingsSection(config, section),
    );
  }
}

async function loadRuntimeConfigForSettingsSection(section: SettingsRuntimeConfigSection): Promise<ConfigResponse> {
  return filterConfigResponseForSettingsSection(await api.getConfig({ section }), section);
}

export function settingsSectionHasRuntimeDraftChanges(
  items: ConfigItem[],
  drafts: Record<string, DraftValue>,
  snapshots: Record<string, DraftSnapshot>,
  secretTouched: Record<string, boolean>,
): boolean {
  return Object.keys(configValuesFromChangedDrafts(items, drafts, snapshots, secretTouched)).length > 0;
}

interface ShouldScrollSettingsContentToTopInput {
  contentTop: number;
  contentBottom: number;
  safeTop: number;
  viewportHeight: number;
}

export function shouldScrollSettingsContentToTop({
  contentTop,
  contentBottom,
  safeTop,
  viewportHeight,
}: ShouldScrollSettingsContentToTopInput): boolean {
  const visibleTop = Math.max(contentTop, safeTop);
  const visibleBottom = Math.min(contentBottom, viewportHeight);
  return visibleBottom <= visibleTop;
}

function SettingsSectionLoadingState({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">{label}</span>
      <div className={`${PANEL_CLASS} ${SETTINGS_BORDERED_MODULE_CLASS} space-y-5`}>
        <div className="space-y-2">
          <div className="h-4 w-36 animate-pulse rounded pf-surface-soft" />
          <div className="h-3 w-2/3 animate-pulse rounded pf-surface-soft opacity-70" />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => (
            <div
              key={index}
              className="min-h-28 rounded-lg border pf-hairline pf-surface p-4"
            >
              <div className="h-3 w-28 animate-pulse rounded pf-surface-soft" />
              <div className="mt-4 h-9 animate-pulse rounded pf-surface-soft opacity-70" />
              <div className="mt-3 h-3 w-3/4 animate-pulse rounded pf-surface-soft opacity-70" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function providerProfilesAfterArchive(
  profiles: ProviderProfile[] | undefined,
  archivedProfile: Pick<ProviderProfile, "id">,
): ProviderProfile[] | undefined {
  return profiles?.filter((profile) => profile.id !== archivedProfile.id);
}

export function generationConfigsAfterArchive(
  generationConfigs: GenerationConfig[] | undefined,
  archivedConfig: Pick<GenerationConfig, "id">,
): GenerationConfig[] | undefined {
  return generationConfigs?.filter((generationConfig) => generationConfig.id !== archivedConfig.id);
}

export function generationResourceGroupsAfterArchive(
  resourceGroups: GenerationResourceGroup[] | undefined,
  archivedGroup: Pick<GenerationResourceGroup, "id">,
): GenerationResourceGroup[] | undefined {
  return resourceGroups?.filter((group) => group.id !== archivedGroup.id);
}

function removeProviderProfileFromSettingsCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  profile: Pick<ProviderProfile, "id">,
) {
  queryClient.setQueryData<ProviderProfile[]>(["provider-profiles"], (current) =>
    providerProfilesAfterArchive(current, profile),
  );
}

function removeGenerationConfigFromSettingsCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  generationConfig: Pick<GenerationConfig, "id">,
) {
  queryClient.setQueriesData<GenerationConfig[]>({ queryKey: ["generation-configs"] }, (current) =>
    generationConfigsAfterArchive(current, generationConfig),
  );
}

function removeGenerationResourceGroupFromSettingsCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  group: Pick<GenerationResourceGroup, "id">,
) {
  queryClient.setQueryData<GenerationResourceGroup[]>(["generation-resource-groups", "settings"], (current) =>
    generationResourceGroupsAfterArchive(current, group),
  );
}

export function SettingsPage() {
  const { t } = useI18n();
  const { activeScheme } = useUiLayoutScheme();
  const navigate = useNavigate();
  const { sectionSlug } = useParams<{ sectionSlug?: string }>();
  const queryClient = useQueryClient();
  const session = useSessionState();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const contentSectionRef = useRef<HTMLElement | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftValue>>({});
  const [draftSnapshots, setDraftSnapshots] = useState<Record<string, DraftSnapshot>>({});
  const [secretTouched, setSecretTouched] = useState<Record<string, boolean>>({});
  const [resettingKey, setResettingKey] = useState<string | null>(null);
  const [pendingResetItem, setPendingResetItem] = useState<ConfigItem | null>(null);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [sectionSearch, setSectionSearch] = useState("");
  const [providerProfileForm, setProviderProfileForm] = useState<ProviderProfileFormState>(EMPTY_PROVIDER_FORM);
  const [editingProviderProfileId, setEditingProviderProfileId] = useState<string | null>(null);
  const [providerDrawerOpen, setProviderDrawerOpen] = useState(false);
  const [pendingDeleteProviderProfile, setPendingDeleteProviderProfile] = useState<ProviderProfile | null>(null);
  const [pendingProviderDisable, setPendingProviderDisable] = useState<PendingProviderDisable | null>(null);
  const [pendingGenerationArchive, setPendingGenerationArchive] = useState<PendingGenerationArchive | null>(null);
  const [pendingGenerationArchiveError, setPendingGenerationArchiveError] = useState("");
  const [togglingProviderProfileId, setTogglingProviderProfileId] = useState<string | null>(null);
  const [generationConfigDrafts, setGenerationConfigDrafts] = useState<Record<string, GenerationConfigDraft>>({});
  const [selectedTextResourceGroupId, setSelectedTextResourceGroupId] = useState<string | null>(null);
  const [selectedImageResourceGroupId, setSelectedImageResourceGroupId] = useState<string | null>(null);
  const [savingGenerationConfigId, setSavingGenerationConfigId] = useState<string | null>(null);
  const [archivingGenerationConfigId, setArchivingGenerationConfigId] = useState<string | null>(null);
  const [unfreezingGenerationConfigId, setUnfreezingGenerationConfigId] = useState<string | null>(null);
  const [generationResourceGroupDrafts, setGenerationResourceGroupDrafts] = useState<
    Record<string, GenerationResourceGroupDraft>
  >({});
  const [archivingGenerationResourceGroupId, setArchivingGenerationResourceGroupId] = useState<string | null>(null);
  const [exportConfirmOpen, setExportConfirmOpen] = useState(false);
  const [importPayload, setImportPayload] = useState<SettingsExportPayload | null>(null);
  const [importPreview, setImportPreview] = useState<SettingsImportPreviewResponse | null>(null);
  const [importFileName, setImportFileName] = useState("");
  const [pendingSectionNavigation, setPendingSectionNavigation] = useState<SettingsSectionId | null>(null);
  const [textConfigTestState, setTextConfigTestState] = useState<TextConfigTestState>(() => ({
    ...readTextConfigTestDraftState(),
    latestKey: null,
    records: {},
  }));
  const [textConfigJsonResponseFormatTestState, setTextConfigJsonResponseFormatTestState] =
    useState<TextConfigJsonResponseFormatTestState>({
      latestKey: null,
      records: {},
    });
  const [imageConfigTestState, setImageConfigTestState] = useState<ImageConfigTestState>(() => ({
    ...readImageConfigTestDraftState(),
    latestKey: null,
    records: {},
  }));
  const [imageConfigTestPreview, setImageConfigTestPreview] = useState<ImageGenerationConfigTestResponse | null>(null);
  const [imageConfigTestGalleryAssetId, setImageConfigTestGalleryAssetId] = useState<string | null>(null);
  const [imageConfigTestGalleryTagError, setImageConfigTestGalleryTagError] = useState("");
  const [imageConfigTestResourceLibrarySource, setImageConfigTestResourceLibrarySource] =
    useState<ResourceLibrarySaveSource | null>(null);
  const matchedSection = settingsSectionFromPathSegment(sectionSlug);
  const activeSection = matchedSection ?? SETTINGS_DEFAULT_SECTION_ID;
  const previousActiveSectionRef = useRef<SettingsSectionId>(activeSection);

  const genericSection = ["prompts", "upload", "queue", "layoutAppearance", "security"].includes(activeSection);
  const activeRuntimeConfigSection = runtimeConfigSectionForSettingsSection(activeSection);
  const shouldLoadConfig = activeRuntimeConfigSection !== null;
  const shouldLoadProviderProfiles = activeSection === "providers" || activeSection === "text" || activeSection === "image";
  const shouldLoadGenerationResourceGroups =
    activeSection === "resourceGroups" || activeSection === "text" || activeSection === "image";
  const shouldLoadAllGenerationConfigs = activeSection === "resourceGroups";
  const shouldLoadProviderGenerationConfigs = activeSection === "providers";
  const shouldLoadTextTestSupport = activeSection === "text";
  const shouldLoadImageTestSupport =
    activeSection === "image" || Boolean(imageConfigTestGalleryAssetId) || Boolean(imageConfigTestResourceLibrarySource);

  const configQuery = useQuery({
    queryKey: activeRuntimeConfigSection ? configQueryKeyForSettingsSection(activeRuntimeConfigSection) : ["config", "inactive"],
    queryFn: () => loadRuntimeConfigForSettingsSection(activeRuntimeConfigSection as SettingsRuntimeConfigSection),
    enabled: shouldLoadConfig,
  });

  const runtimeConfigQuery = useQuery({
    queryKey: ["runtime-config"],
    queryFn: api.getRuntimeConfig,
    enabled: shouldLoadImageTestSupport,
  });

  const galleryTagsQuery = useQuery({
    queryKey: ["gallery-tags", "active"],
    queryFn: () => api.listGalleryTags(),
    enabled: shouldLoadImageTestSupport,
  });

  const providerProfilesQuery = useQuery({
    queryKey: ["provider-profiles"],
    queryFn: api.listProviderProfiles,
    enabled: shouldLoadProviderProfiles,
  });

  const generationResourceGroupsQuery = useQuery({
    queryKey: ["generation-resource-groups", "settings"],
    queryFn: () => api.listGenerationResourceGroups({ include_image_max_dimension: false }),
    enabled: shouldLoadGenerationResourceGroups,
  });

  const generationResourceGroups = settingsGenerationResourceGroupsInApiOrder(generationResourceGroupsQuery.data ?? []);
  const firstEnabledGenerationResourceGroupId =
    generationResourceGroups.find((group) => group.enabled)?.id ?? "";
  const effectiveSelectedTextResourceGroupId =
    selectedTextResourceGroupId ?? firstEnabledGenerationResourceGroupId;
  const effectiveSelectedImageResourceGroupId =
    selectedImageResourceGroupId ?? firstEnabledGenerationResourceGroupId;

  useEffect(() => {
    if (selectedTextResourceGroupId && !generationResourceGroups.some((group) => group.id === selectedTextResourceGroupId)) {
      setSelectedTextResourceGroupId(firstEnabledGenerationResourceGroupId || "");
    }
  }, [firstEnabledGenerationResourceGroupId, generationResourceGroups, selectedTextResourceGroupId]);

  useEffect(() => {
    if (
      selectedImageResourceGroupId &&
      !generationResourceGroups.some((group) => group.id === selectedImageResourceGroupId)
    ) {
      setSelectedImageResourceGroupId(firstEnabledGenerationResourceGroupId || "");
    }
  }, [firstEnabledGenerationResourceGroupId, generationResourceGroups, selectedImageResourceGroupId]);

  const resourceGroupGenerationConfigsQuery = useQuery({
    queryKey: ["generation-configs", "all", "resource-groups"],
    queryFn: () => api.listGenerationConfigs(),
    enabled: shouldLoadAllGenerationConfigs,
  });

  const providerGenerationConfigsQuery = useQuery({
    queryKey: ["generation-configs", "all", "providers"],
    queryFn: () => api.listGenerationConfigs(),
    enabled: shouldLoadProviderGenerationConfigs,
  });

  const textGenerationConfigsQuery = useQuery({
    queryKey: [
      "generation-configs",
      "text",
      effectiveSelectedTextResourceGroupId || "__unbound__",
    ],
    queryFn: () =>
      effectiveSelectedTextResourceGroupId
        ? api.listGenerationConfigs({
            purpose: "text",
            resource_group_id: effectiveSelectedTextResourceGroupId,
          })
        : api.listGenerationConfigs({
            purpose: "text",
            unbound_only: true,
          }),
    enabled: activeSection === "text" && generationResourceGroupsQuery.isSuccess,
    placeholderData: keepPreviousData,
  });

  const imageGenerationConfigsQuery = useQuery({
    queryKey: [
      "generation-configs",
      "image",
      effectiveSelectedImageResourceGroupId || "__unbound__",
    ],
    queryFn: () =>
      effectiveSelectedImageResourceGroupId
        ? api.listGenerationConfigs({
            purpose: "image",
            resource_group_id: effectiveSelectedImageResourceGroupId,
          })
        : api.listGenerationConfigs({
            purpose: "image",
            unbound_only: true,
          }),
    enabled: activeSection === "image" && generationResourceGroupsQuery.isSuccess,
    placeholderData: keepPreviousData,
  });

  const loginPageAssetsQuery = useQuery({
    queryKey: ["resource-library-assets", "login-page"],
    queryFn: () => api.listResourceLibraryAssets({ group_id: null }),
    enabled: activeSection === "loginPage",
  });
  const textTestReferenceAssetsQuery = useQuery({
    queryKey: ["resource-library-assets", "all"],
    queryFn: () => api.listResourceLibraryAssets({ group_id: null }),
    enabled: shouldLoadTextTestSupport,
  });
  const galleryEntryTagMaxSelection = Math.max(
    1,
    Math.floor(runtimeConfigQuery.data?.gallery_entry_tag_max_selection ?? 10),
  );
  const galleryTagRequiredOnSave = runtimeConfigQuery.data?.gallery_tag_required_on_save ?? false;
  const galleryTags = galleryTagsQuery.data ?? [];
  const textTestReferenceAssets = textConfigTestState.draft.referenceAssetIds
    .map((assetId) => textTestReferenceAssetsQuery.data?.items.find((asset) => asset.id === assetId) ?? null)
    .filter((asset): asset is ResourceLibraryAsset => asset !== null);

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

  const hydrateGenerationConfigDrafts = useCallback((generationConfigs: GenerationConfig[] | undefined) => {
    if (!generationConfigs?.length) {
      return;
    }
    setGenerationConfigDrafts((current) => {
      const nextDrafts = { ...current };
      for (const generationConfig of generationConfigs) {
        if (!generationConfig.archived_at) {
          nextDrafts[generationConfig.id] = generationConfigDraft(generationConfig);
        }
      }
      return nextDrafts;
    });
  }, []);

  useEffect(() => {
    hydrateGenerationConfigDrafts(resourceGroupGenerationConfigsQuery.data);
  }, [hydrateGenerationConfigDrafts, resourceGroupGenerationConfigsQuery.data]);

  useEffect(() => {
    hydrateGenerationConfigDrafts(providerGenerationConfigsQuery.data);
  }, [hydrateGenerationConfigDrafts, providerGenerationConfigsQuery.data]);

  useEffect(() => {
    hydrateGenerationConfigDrafts(textGenerationConfigsQuery.data);
  }, [hydrateGenerationConfigDrafts, textGenerationConfigsQuery.data]);

  useEffect(() => {
    hydrateGenerationConfigDrafts(imageGenerationConfigsQuery.data);
  }, [hydrateGenerationConfigDrafts, imageGenerationConfigsQuery.data]);

  useEffect(() => {
    const nextDrafts: Record<string, GenerationResourceGroupDraft> = {
      "new-generation-resource-group": emptyGenerationResourceGroupDraft(),
    };
    for (const group of generationResourceGroupsQuery.data ?? []) {
      if (!group.archived_at) {
        nextDrafts[group.id] = generationResourceGroupDraft(group);
      }
    }
    setGenerationResourceGroupDrafts(nextDrafts);
  }, [generationResourceGroupsQuery.data]);

  const activeMeta = SETTINGS_SECTIONS.find((section) => section.id === activeSection) ?? SETTINGS_SECTIONS[0];
  const activeItems = itemsForSection(configQuery.data, activeSection);
  const activeConfigGroups = activeSection === "queue" ? configCategoryGroups(activeItems) : [];
  const canWriteRuntimeSettings = hasSessionApiPermission(session, API_SETTINGS_WRITE);
  const canWriteProviderSettings = hasSessionApiPermission(session, API_SETTINGS_PROVIDER_WRITE);
  const canSaveImageConfigTestGallery = hasSessionApiPermission(session, API_GALLERY_WRITE);
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
  const activeRuntimeConfigDraftDirty =
    shouldLoadConfig && settingsSectionHasRuntimeDraftChanges(activeItems, drafts, draftSnapshots, secretTouched);
  const dirtySectionIds = activeRuntimeConfigDraftDirty ? [activeSection] : [];
  const navigateToSettingsSection = useCallback(
    (section: SettingsSectionId) => {
      navigate(settingsPathForSection(section));
    },
    [navigate],
  );
  const prefetchSettingsSection = useCallback(
    (section: SettingsSectionId) => {
      const runtimeConfigSection = runtimeConfigSectionForSettingsSection(section);
      if (runtimeConfigSection) {
        void queryClient.prefetchQuery({
          queryKey: configQueryKeyForSettingsSection(runtimeConfigSection),
          queryFn: () => loadRuntimeConfigForSettingsSection(runtimeConfigSection),
          staleTime: SETTINGS_SECTION_PREFETCH_STALE_TIME_MS,
        });
      }
      if (section === "providers" || section === "text" || section === "image") {
        void queryClient.prefetchQuery({
          queryKey: ["provider-profiles"],
          queryFn: api.listProviderProfiles,
          staleTime: SETTINGS_SECTION_PREFETCH_STALE_TIME_MS,
        });
      }
      if (section === "providers") {
        void queryClient.prefetchQuery({
          queryKey: ["generation-configs", "all", "providers"],
          queryFn: () => api.listGenerationConfigs(),
          staleTime: SETTINGS_SECTION_PREFETCH_STALE_TIME_MS,
        });
      }
      if (section === "resourceGroups" || section === "text" || section === "image") {
        void queryClient.prefetchQuery({
          queryKey: ["generation-resource-groups", "settings"],
          queryFn: () => api.listGenerationResourceGroups({ include_image_max_dimension: false }),
          staleTime: SETTINGS_SECTION_PREFETCH_STALE_TIME_MS,
        });
      }
      if (section === "resourceGroups") {
        void queryClient.prefetchQuery({
          queryKey: ["generation-configs", "all", "resource-groups"],
          queryFn: () => api.listGenerationConfigs(),
          staleTime: SETTINGS_SECTION_PREFETCH_STALE_TIME_MS,
        });
      }
      if (section === "text" || section === "image") {
        const cachedResourceGroups = queryClient.getQueryData<GenerationResourceGroup[]>([
          "generation-resource-groups",
          "settings",
        ]);
        if (cachedResourceGroups) {
          const resourceGroupsInApiOrder = settingsGenerationResourceGroupsInApiOrder(cachedResourceGroups);
          const selectedResourceGroupId =
            section === "text" ? selectedTextResourceGroupId : selectedImageResourceGroupId;
          const effectiveResourceGroupId =
            selectedResourceGroupId ?? resourceGroupsInApiOrder.find((group) => group.enabled)?.id ?? "";
          void queryClient.prefetchQuery({
            queryKey: [
              "generation-configs",
              section,
              effectiveResourceGroupId || "__unbound__",
            ],
            queryFn: () =>
              effectiveResourceGroupId
                ? api.listGenerationConfigs({
                    purpose: section,
                    resource_group_id: effectiveResourceGroupId,
                  })
                : api.listGenerationConfigs({
                    purpose: section,
                    unbound_only: true,
                  }),
            staleTime: SETTINGS_SECTION_PREFETCH_STALE_TIME_MS,
          });
        }
      }
      if (section === "text") {
        void queryClient.prefetchQuery({
          queryKey: ["resource-library-assets", "all"],
          queryFn: () => api.listResourceLibraryAssets({ group_id: null }),
          staleTime: SETTINGS_SECTION_PREFETCH_STALE_TIME_MS,
        });
      }
      if (section === "image") {
        void queryClient.prefetchQuery({
          queryKey: ["runtime-config"],
          queryFn: api.getRuntimeConfig,
          staleTime: SETTINGS_SECTION_PREFETCH_STALE_TIME_MS,
        });
        void queryClient.prefetchQuery({
          queryKey: ["gallery-tags", "active"],
          queryFn: () => api.listGalleryTags(),
          staleTime: SETTINGS_SECTION_PREFETCH_STALE_TIME_MS,
        });
      }
      if (section === "loginPage") {
        void queryClient.prefetchQuery({
          queryKey: ["resource-library-assets", "login-page"],
          queryFn: () => api.listResourceLibraryAssets({ group_id: null }),
          staleTime: SETTINGS_SECTION_PREFETCH_STALE_TIME_MS,
        });
      }
    },
    [queryClient, selectedImageResourceGroupId, selectedTextResourceGroupId],
  );
  const scrollActiveSectionToTop = useCallback(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }
    const contentSection = contentSectionRef.current;
    if (!contentSection) {
      return;
    }
    const root = document.documentElement;
    const computedRootStyle = window.getComputedStyle(root);
    const rootFontSize = Number.parseFloat(computedRootStyle.fontSize) || 16;
    const safeTop = cssLengthToPixels(computedRootStyle.getPropertyValue("--pf-top-chrome-safe-height"), rootFontSize);
    const contentRect = contentSection.getBoundingClientRect();
    if (
      !shouldScrollSettingsContentToTop({
        contentTop: contentRect.top,
        contentBottom: contentRect.bottom,
        safeTop,
        viewportHeight: window.innerHeight,
      })
    ) {
      return;
    }
    const nextTop = Math.max(window.scrollY + contentRect.top - safeTop, 0);
    window.scrollTo({ top: nextTop, behavior: "auto" });
  }, []);

  useEffect(() => {
    if (!sectionSlug || matchedSection !== null) {
      return;
    }
    navigate(settingsPathForSection(SETTINGS_DEFAULT_SECTION_ID), { replace: true });
  }, [matchedSection, navigate, sectionSlug]);

  useEffect(() => {
    if (previousActiveSectionRef.current === activeSection) {
      return;
    }
    previousActiveSectionRef.current = activeSection;
    setSavedMessage("");
    setError("");
    window.requestAnimationFrame(scrollActiveSectionToTop);
  }, [activeSection, scrollActiveSectionToTop]);

  const handleActiveSectionChange = useCallback((section: SettingsSectionId) => {
    if (section === activeSection) {
      return;
    }
    if (activeRuntimeConfigDraftDirty) {
      setPendingSectionNavigation(section);
      return;
    }
    navigateToSettingsSection(section);
  }, [activeRuntimeConfigDraftDirty, activeSection, navigateToSettingsSection]);

  const retryActiveSectionLoad = useCallback(() => {
    if (shouldLoadConfig) {
      void configQuery.refetch();
    }
    if (activeSection === "providers") {
      void providerProfilesQuery.refetch();
    }
    if (activeSection === "resourceGroups") {
      void generationResourceGroupsQuery.refetch();
      void resourceGroupGenerationConfigsQuery.refetch();
    }
    if (activeSection === "text") {
      void providerProfilesQuery.refetch();
      void generationResourceGroupsQuery.refetch();
      void textGenerationConfigsQuery.refetch();
      void textTestReferenceAssetsQuery.refetch();
    }
    if (activeSection === "image") {
      void providerProfilesQuery.refetch();
      void generationResourceGroupsQuery.refetch();
      void imageGenerationConfigsQuery.refetch();
    }
  }, [
    activeSection,
    configQuery,
    generationResourceGroupsQuery,
    imageGenerationConfigsQuery,
    providerProfilesQuery,
    resourceGroupGenerationConfigsQuery,
    shouldLoadConfig,
    textTestReferenceAssetsQuery,
    textGenerationConfigsQuery,
  ]);

  const refreshSettingsQueries = useCallback(
    async ({
      includeConfig = false,
      includeRuntimeConfig = false,
      includeProviderModels = false,
      includeProviderProfiles = false,
      includeGenerationResourceGroups = false,
      includeGenerationConfigs = false,
      includeGenerationConfigOptions = false,
      includeGenerationConfigStatus = false,
      includeMyGenerationResourceGroups = false,
    }: {
      includeConfig?: boolean;
      includeRuntimeConfig?: boolean;
      includeProviderModels?: boolean;
      includeProviderProfiles?: boolean;
      includeGenerationResourceGroups?: boolean;
      includeGenerationConfigs?: boolean;
      includeGenerationConfigOptions?: boolean;
      includeGenerationConfigStatus?: boolean;
      includeMyGenerationResourceGroups?: boolean;
    } = {}) => {
      const refreshes: Array<Promise<unknown>> = [];
      if (includeConfig) {
        refreshes.push(queryClient.invalidateQueries({ queryKey: ["config"] }));
      }
      if (includeRuntimeConfig) {
        refreshes.push(queryClient.invalidateQueries({ queryKey: ["runtime-config"] }));
      }
      if (includeProviderModels) {
        refreshes.push(queryClient.invalidateQueries({ queryKey: ["provider-models"] }));
      }
      if (includeProviderProfiles) {
        refreshes.push(queryClient.invalidateQueries({ queryKey: ["provider-profiles"] }));
      }
      if (includeGenerationResourceGroups) {
        refreshes.push(queryClient.invalidateQueries({ queryKey: ["generation-resource-groups"] }));
      }
      if (includeGenerationConfigs) {
        refreshes.push(queryClient.invalidateQueries({ queryKey: ["generation-configs"] }));
      }
      if (includeGenerationConfigOptions) {
        refreshes.push(queryClient.invalidateQueries({ queryKey: ["generation-config-options"] }));
      }
      if (includeGenerationConfigStatus) {
        refreshes.push(queryClient.invalidateQueries({ queryKey: ["generation-config-status"] }));
      }
      if (includeMyGenerationResourceGroups) {
        refreshes.push(queryClient.invalidateQueries({ queryKey: ["my-generation-resource-groups"] }));
      }
      await Promise.all(refreshes);
    },
    [queryClient],
  );

  const updateTextConfigTestDraftState = useCallback(
    (recipe: (draft: TextConfigTestState["draft"]) => TextConfigTestState["draft"]) => {
      setTextConfigTestState((current) => {
        const selectedPresetId = current.selectedPresetId;
        const normalizedDraft = normalizeTextConfigTestDraft(
          recipe(current.draft),
          current.presets[selectedPresetId] ?? current.draft,
        );
        const draftState = {
          selectedPresetId,
          draft: normalizedDraft,
          presets: {
            ...current.presets,
            [selectedPresetId]: normalizedDraft,
          },
        };
        writeTextConfigTestDraftState(draftState);
        return { ...current, ...draftState };
      });
    },
    [],
  );

  const syncGenerationConfigDraftImageUnderstanding = useCallback((key: string, enabled: boolean) => {
    setGenerationConfigDrafts((current) => {
      const draft = current[key];
      if (!draft || draft.purpose !== "text") {
        return current;
      }
      return {
        ...current,
        [key]: {
          ...draft,
          supports_image_understanding: enabled,
        },
      };
    });
  }, []);

  const refreshProviderProfilesFromApi = useCallback(async (): Promise<ProviderProfile[] | null> => {
    setError("");
    setSavedMessage("");
    try {
      const result = await providerProfilesQuery.refetch();
      if (result.error) {
        setError(result.error instanceof ApiError ? result.error.detail : t("settings.provider.saveFailed"));
        return null;
      }
      return result.data ?? null;
    } catch (fetchError) {
      setError(fetchError instanceof ApiError ? fetchError.detail : t("settings.provider.saveFailed"));
      return null;
    }
  }, [providerProfilesQuery, t]);

  const refreshGenerationSectionInputsFromApi = useCallback(async (): Promise<boolean> => {
    setError("");
    setSavedMessage("");
    try {
      const results = await Promise.all([providerProfilesQuery.refetch(), generationResourceGroupsQuery.refetch()]);
      const failedResult = results.find((result) => result.error);
      if (failedResult?.error) {
        setError(failedResult.error instanceof ApiError ? failedResult.error.detail : t("settings.provider.saveFailed"));
        return false;
      }
      return true;
    } catch (fetchError) {
      setError(fetchError instanceof ApiError ? fetchError.detail : t("settings.provider.saveFailed"));
      return false;
    }
  }, [generationResourceGroupsQuery, providerProfilesQuery, t]);

  useEffect(() => {
    if (!savedMessage) {
      return undefined;
    }
    const timer = window.setTimeout(() => setSavedMessage(""), SETTINGS_SAVED_MESSAGE_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [savedMessage]);

  const applyConfigResponse = useCallback(
    (data: ConfigResponse, message: string) => {
      setRuntimeConfigSectionCaches(queryClient, data);
      void queryClient.invalidateQueries({ queryKey: ["runtime-config"] });
      void queryClient.invalidateQueries({ queryKey: ["session"] });
      setError("");
      setSavedMessage(message);
    },
    [queryClient],
  );

  const saveMutation = useMutation({
    mutationFn: () => {
      const values = configValuesFromChangedDrafts(activeItems, drafts, draftSnapshots, secretTouched);
      return api.updateConfig({ values });
    },
    onSuccess: (data) => {
      applyConfigResponse(data, t("settings.saved"));
    },
    onError: (mutationError) => {
      setSavedMessage("");
      setError(mutationError instanceof ApiError ? mutationError.detail : t("settings.saveFailed"));
    },
  });

  const saveLoginPageSelectionMutation = useMutation({
    mutationFn: (value: LoginPageMode) => api.updateLoginPageSelection({ value }),
    onSuccess: (data) => {
      applyConfigResponse(data, t("settings.loginPage.selectionSaved"));
    },
    onError: (mutationError) => {
      setSavedMessage("");
      setError(mutationError instanceof ApiError ? mutationError.detail : t("settings.saveFailed"));
    },
  });

  const saveLoginPageTemplateConfigMutation = useMutation({
    mutationFn: (payload: { templateId: LoginPageTemplateId; config: Record<string, string> }) =>
      api.updateLoginPageTemplateConfig(payload.templateId, { config: payload.config }),
    onSuccess: (data) => {
      applyConfigResponse(data, t("settings.loginPage.templateConfigSaved"));
    },
    onError: (mutationError) => {
      setSavedMessage("");
      setError(mutationError instanceof ApiError ? mutationError.detail : t("settings.saveFailed"));
    },
  });

  const resetMutation = useMutation({
    mutationFn: (key: string) => {
      if (key === "login_page_mode") {
        return api.resetLoginPageSelection();
      }
      const templateId = loginPageTemplateIdFromConfigKey(key);
      if (templateId) {
        return api.resetLoginPageTemplateConfig(templateId);
      }
      return api.updateConfig({ reset_keys: [key] });
    },
    onMutate: (key) => {
      setResettingKey(key);
      setError("");
      setSavedMessage("");
    },
    onSuccess: (data) => {
      setPendingResetItem(null);
      applyConfigResponse(data, t("settings.restored"));
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
        setRuntimeConfigSectionCaches(queryClient, data.config);
      }
      if (data.provider_config) {
        queryClient.setQueryData(["provider-profiles"], data.provider_config.profiles);
        queryClient.setQueryData(["generation-resource-groups", "settings"], data.provider_config.generation_resource_groups);
      }
      await refreshSettingsQueries({
        includeConfig: true,
        includeRuntimeConfig: true,
        includeProviderProfiles: true,
        includeGenerationResourceGroups: true,
        includeGenerationConfigs: true,
        includeGenerationConfigOptions: true,
        includeGenerationConfigStatus: true,
        includeMyGenerationResourceGroups: true,
      });
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
    onSuccess: async (profile) => {
      queryClient.setQueryData<ProviderProfile[]>(["provider-profiles"], (current = []) => {
        const nextProfiles = current.filter((item) => item.id !== profile.id);
        return [...nextProfiles, profile];
      });
      await refreshSettingsQueries({
        includeProviderModels: true,
        includeProviderProfiles: true,
        includeGenerationConfigs: true,
        includeGenerationConfigOptions: true,
        includeGenerationConfigStatus: true,
        includeMyGenerationResourceGroups: true,
      });
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
    onSuccess: async (profile) => {
      queryClient.setQueryData<ProviderProfile[]>(["provider-profiles"], (current = []) =>
        current.map((item) => (item.id === profile.id ? profile : item)),
      );
      await refreshSettingsQueries({
        includeProviderModels: true,
        includeProviderProfiles: true,
        includeGenerationConfigs: true,
        includeGenerationConfigOptions: true,
        includeGenerationConfigStatus: true,
        includeMyGenerationResourceGroups: true,
      });
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
    onSuccess: async (profile) => {
      removeProviderProfileFromSettingsCaches(queryClient, profile);
      await refreshSettingsQueries({
        includeProviderModels: true,
        includeProviderProfiles: true,
        includeGenerationConfigs: true,
        includeGenerationConfigOptions: true,
        includeGenerationConfigStatus: true,
        includeMyGenerationResourceGroups: true,
      });
      removeProviderProfileFromSettingsCaches(queryClient, profile);
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
    onSuccess: async (profile) => {
      queryClient.setQueryData<ProviderProfile[]>(["provider-profiles"], (current = []) =>
        current.map((item) => (item.id === profile.id ? profile : item)),
      );
      await refreshSettingsQueries({
        includeProviderProfiles: true,
        includeGenerationConfigs: true,
        includeGenerationConfigOptions: true,
        includeGenerationConfigStatus: true,
        includeMyGenerationResourceGroups: true,
      });
      setPendingProviderDisable(null);
      setError("");
      setSavedMessage(t("settings.provider.saved"));
    },
    onError: (mutationError) => {
      setPendingProviderDisable(null);
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
    onMutate: (draft) => {
      setSavingGenerationConfigId(draft.id);
      setError("");
      setSavedMessage("");
    },
    onSuccess: async (generationConfig) => {
      setGenerationConfigDrafts((current) => ({ ...current, [generationConfig.id]: generationConfigDraft(generationConfig) }));
      await refreshSettingsQueries({
        includeConfig: true,
        includeRuntimeConfig: true,
        includeProviderProfiles: true,
        includeGenerationConfigs: true,
        includeGenerationConfigOptions: true,
        includeGenerationConfigStatus: true,
        includeMyGenerationResourceGroups: true,
      });
      setError("");
      setSavedMessage(t("settings.generation.saved"));
    },
    onError: (mutationError) => {
      setSavedMessage("");
      setError(mutationError instanceof ApiError ? mutationError.detail : t("settings.generation.saveFailed"));
    },
    onSettled: () => setSavingGenerationConfigId(null),
  });

  const archiveGenerationConfigMutation = useMutation({
    mutationFn: (configId: string) => api.archiveGenerationConfig(configId),
    onMutate: (configId) => {
      setArchivingGenerationConfigId(configId);
      setPendingGenerationArchiveError("");
      setError("");
      setSavedMessage("");
    },
    onSuccess: async (generationConfig) => {
      setGenerationConfigDrafts((current) => {
        const nextDrafts = { ...current };
        delete nextDrafts[generationConfig.id];
        return nextDrafts;
      });
      removeGenerationConfigFromSettingsCaches(queryClient, generationConfig);
      await refreshSettingsQueries({
        includeConfig: true,
        includeRuntimeConfig: true,
        includeProviderProfiles: true,
        includeGenerationConfigs: true,
        includeGenerationConfigOptions: true,
        includeGenerationConfigStatus: true,
        includeMyGenerationResourceGroups: true,
      });
      removeGenerationConfigFromSettingsCaches(queryClient, generationConfig);
      setPendingGenerationArchive(null);
      setPendingGenerationArchiveError("");
      setError("");
      setSavedMessage(t("settings.generation.archived"));
    },
    onError: (mutationError) => {
      setSavedMessage("");
      setPendingGenerationArchiveError(archiveFailureMessage(mutationError, t("settings.generation.archiveFailed")));
    },
    onSettled: () => {
      setArchivingGenerationConfigId(null);
    },
  });

  const unfreezeGenerationConfigMutation = useMutation({
    mutationFn: (configId: string) => api.unfreezeGenerationConfig(configId),
    onMutate: (configId) => {
      setUnfreezingGenerationConfigId(configId);
      setError("");
      setSavedMessage("");
    },
    onSuccess: async (generationConfig) => {
      setGenerationConfigDrafts((current) => ({ ...current, [generationConfig.id]: generationConfigDraft(generationConfig) }));
      await refreshSettingsQueries({
        includeGenerationConfigs: true,
        includeGenerationConfigOptions: true,
        includeGenerationConfigStatus: true,
      });
      setError("");
      setSavedMessage(t("settings.generation.unfrozen"));
    },
    onError: (mutationError) => {
      setSavedMessage("");
      setError(mutationError instanceof ApiError ? mutationError.detail : t("settings.generation.unfreezeFailed"));
    },
    onSettled: () => setUnfreezingGenerationConfigId(null),
  });

  const saveGenerationResourceGroupMutation = useMutation({
    mutationFn: (draft: GenerationResourceGroupDraft) => {
      const payload = generationResourceGroupPayloadFromDraft(draft);
      return draft.id
        ? api.updateGenerationResourceGroup(draft.id, payload as GenerationResourceGroupUpdateRequest)
        : api.createGenerationResourceGroup(payload as GenerationResourceGroupCreateRequest);
    },
    onSuccess: async () => {
      await refreshSettingsQueries({
        includeGenerationResourceGroups: true,
        includeGenerationConfigs: true,
        includeGenerationConfigOptions: true,
        includeGenerationConfigStatus: true,
        includeMyGenerationResourceGroups: true,
      });
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
      setPendingGenerationArchiveError("");
      setError("");
      setSavedMessage("");
    },
    onSuccess: async (group) => {
      setGenerationResourceGroupDrafts((current) => {
        const nextDrafts = { ...current };
        delete nextDrafts[group.id];
        return nextDrafts;
      });
      removeGenerationResourceGroupFromSettingsCaches(queryClient, group);
      await refreshSettingsQueries({
        includeGenerationResourceGroups: true,
        includeGenerationConfigs: true,
        includeGenerationConfigOptions: true,
        includeGenerationConfigStatus: true,
        includeMyGenerationResourceGroups: true,
      });
      removeGenerationResourceGroupFromSettingsCaches(queryClient, group);
      setPendingGenerationArchive(null);
      setPendingGenerationArchiveError("");
      setError("");
      setSavedMessage(t("settings.resourceGroup.archived"));
    },
    onError: (mutationError) => {
      setSavedMessage("");
      setPendingGenerationArchiveError(
        archiveFailureMessage(mutationError, t("settings.resourceGroup.archiveFailed")),
      );
    },
    onSettled: () => {
      setArchivingGenerationResourceGroupId(null);
    },
  });

  const testTextGenerationConfigMutation = useMutation({
    mutationFn: ({ payload }: TextGenerationConfigTestMutationInput) => api.testTextGenerationConfig(payload),
    onMutate: ({ key }) => {
      setTextConfigTestState((current) => markTextConfigTestStarted(current, key));
      setSavedMessage("");
      setError("");
    },
    onSuccess: (result, { key, payload }) => {
      setTextConfigTestState((current) => markTextConfigTestSucceeded(current, key, result));
      if (payload.reference_asset_ids?.length) {
        syncGenerationConfigDraftImageUnderstanding(key, true);
      }
    },
    onError: (mutationError, { key, payload }) => {
      setTextConfigTestState((current) =>
        markTextConfigTestFailed(
          current,
          key,
          mutationError instanceof ApiError
            ? mutationError.detail
            : mutationError instanceof Error
              ? mutationError.message
          : t("settings.generation.testFailed"),
        ),
      );
      if (payload.reference_asset_ids?.length) {
        syncGenerationConfigDraftImageUnderstanding(key, false);
      }
    },
    onSettled: () => {
      void refreshSettingsQueries({ includeGenerationConfigs: true });
    },
  });

  const testTextGenerationConfigJsonResponseFormatMutation = useMutation({
    mutationFn: ({ payload }: TextGenerationConfigJsonResponseFormatTestMutationInput) =>
      api.testTextGenerationConfigJsonResponseFormat(payload),
    onMutate: ({ key }) => {
      setTextConfigJsonResponseFormatTestState((current) =>
        markTextConfigJsonResponseFormatTestStarted(current, key),
      );
      setSavedMessage("");
      setError("");
    },
    onSuccess: (result, { key }) => {
      setTextConfigJsonResponseFormatTestState((current) =>
        markTextConfigJsonResponseFormatTestSucceeded(current, key, result),
      );
    },
    onError: (mutationError, { key }) => {
      setTextConfigJsonResponseFormatTestState((current) =>
        markTextConfigJsonResponseFormatTestFailed(
          current,
          key,
          mutationError instanceof ApiError
            ? mutationError.detail
          : t("settings.generation.jsonResponseFormatTestFailed"),
        ),
      );
    },
    onSettled: () => {
      void refreshSettingsQueries({ includeGenerationConfigs: true });
    },
  });

  const testImageGenerationConfigMutation = useMutation({
    mutationFn: ({ payload }: ImageGenerationConfigTestMutationInput) => api.testImageGenerationConfig(payload),
    onMutate: ({ key }) => {
      setImageConfigTestState((current) => markImageConfigTestStarted(current, key));
      setImageConfigTestPreview(null);
      setImageConfigTestResourceLibrarySource(null);
      setImageConfigTestGalleryAssetId(null);
      setSavedMessage("");
      setError("");
    },
    onSuccess: (result, { key }) => {
      setImageConfigTestState((current) => markImageConfigTestSucceeded(current, key, result));
      setImageConfigTestPreview(result);
    },
    onError: (mutationError, { key }) => {
      setImageConfigTestState((current) =>
        markImageConfigTestFailed(
          current,
          key,
          mutationError instanceof ApiError ? mutationError.detail : t("settings.generation.imageTestFailed"),
        ),
      );
    },
    onSettled: () => {
      void refreshSettingsQueries({ includeGenerationConfigs: true });
    },
  });

  const keepImageConfigTestMutation = useMutation({
    mutationFn: (imageSessionId: string) => api.keepImageGenerationConfigTest(imageSessionId),
    onSuccess: async () => {
      setImageConfigTestPreview(null);
      setImageConfigTestResourceLibrarySource(null);
      setImageConfigTestGalleryAssetId(null);
      setImageConfigTestGalleryTagError("");
      await queryClient.invalidateQueries({ queryKey: ["image-sessions"] });
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof ApiError
          ? mutationError.detail
          : t("settings.generation.imageTestKeepSessionFailed"),
      );
    },
  });

  const abandonImageConfigTestMutation = useMutation({
    mutationFn: (imageSessionId: string) => api.abandonImageGenerationConfigTest(imageSessionId),
    onError: (mutationError) => {
      setError(
        mutationError instanceof ApiError
          ? mutationError.detail
          : t("settings.generation.imageTestAbandonFailed"),
      );
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["image-sessions"] });
    },
  });

  const saveImageConfigTestGalleryMutation = useMutation({
    mutationFn: ({ assetId, tagIds }: { assetId: string; tagIds: string[] }) =>
      api.saveGalleryEntry(assetId, { tag_ids: tagIds }),
    onSuccess: async (entry, variables) => {
      setImageConfigTestPreview((current) =>
        current ? imageGenerationConfigTestResultWithGalleryEntry(current, entry) : current,
      );
      setImageConfigTestState((current) => {
        const recordResult = Object.values(current.records).find(
          (record) => record.result?.generated_asset.id === variables.assetId,
        )?.result;
        if (!recordResult) {
          return current;
        }
        return markImageConfigTestAssetSaved(
          current,
          variables.assetId,
          imageGenerationConfigTestResultWithGalleryEntry(recordResult, entry),
        );
      });
      setImageConfigTestPreview(null);
      setImageConfigTestGalleryAssetId(null);
      setImageConfigTestResourceLibrarySource(null);
      setImageConfigTestGalleryTagError("");
      setError("");
      await queryClient.invalidateQueries({ queryKey: ["gallery"] });
      if (entry.image_session_id) {
        await queryClient.invalidateQueries({ queryKey: ["image-session", entry.image_session_id] });
      }
      await queryClient.invalidateQueries({ queryKey: ["image-sessions"] });
    },
    onError: (mutationError) => {
      const message = mutationError instanceof ApiError ? mutationError.detail : t("chat.saveGalleryFailed");
      setImageConfigTestGalleryTagError(message);
      setError(message);
    },
  });

  const logoutMutation = useMutation({
    mutationFn: api.destroySession,
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: ["config"] });
      queryClient.removeQueries({ queryKey: ["provider-profiles"] });
      queryClient.removeQueries({ queryKey: ["generation-resource-groups"] });
      queryClient.removeQueries({ queryKey: ["generation-configs"] });
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
  const providerGenerationConfigs = providerGenerationConfigsQuery.data ?? [];
  const resourceGroupPending =
    saveGenerationResourceGroupMutation.isPending || archiveGenerationResourceGroupMutation.isPending;
  const providerProfiles = providerProfilesQuery.data ?? [];
  const resourceGroupGenerationConfigs = resourceGroupGenerationConfigsQuery.data ?? [];
  const textGenerationConfigs = textGenerationConfigsQuery.data ?? [];
  const imageGenerationConfigs = imageGenerationConfigsQuery.data ?? [];
  const visibleGenerationConfigs =
    activeSection === "providers"
      ? providerGenerationConfigs
      : activeSection === "text"
      ? textGenerationConfigs
      : activeSection === "image"
        ? imageGenerationConfigs
        : resourceGroupGenerationConfigs;
  const requestGenerationResourceGroupArchive = useCallback(
    (groupId: string) => {
      const group = generationResourceGroups.find((item) => item.id === groupId);
      setPendingGenerationArchiveError("");
      setPendingGenerationArchive({ kind: "resourceGroup", id: groupId, name: group?.name ?? groupId });
    },
    [generationResourceGroups],
  );
  const requestGenerationConfigArchive = useCallback(
    (configId: string) => {
      const config = visibleGenerationConfigs.find((item) => item.id === configId);
      setPendingGenerationArchiveError("");
      setPendingGenerationArchive({ kind: "generationConfig", id: configId, name: config?.name ?? configId });
    },
    [visibleGenerationConfigs],
  );
  const pendingGenerationArchiveBusy =
    pendingGenerationArchive?.kind === "resourceGroup"
      ? archiveGenerationResourceGroupMutation.isPending
      : pendingGenerationArchive?.kind === "generationConfig"
        ? archiveGenerationConfigMutation.isPending
        : false;
  const pendingGenerationArchiveTitle =
    pendingGenerationArchive?.kind === "resourceGroup"
      ? t("settings.resourceGroup.archiveConfirmTitle")
      : pendingGenerationArchive?.kind === "generationConfig"
        ? t("settings.generation.archiveConfirmTitle")
        : "";
  const pendingGenerationArchiveDescription =
    pendingGenerationArchive?.kind === "resourceGroup"
      ? t("settings.resourceGroup.archiveConfirm", { name: pendingGenerationArchive.name })
      : pendingGenerationArchive?.kind === "generationConfig"
        ? t("settings.generation.archiveConfirm", { name: pendingGenerationArchive.name })
        : "";
  const pendingGenerationArchiveConfirmLabel =
    pendingGenerationArchive?.kind === "resourceGroup"
      ? t("settings.resourceGroup.archive")
      : pendingGenerationArchive?.kind === "generationConfig"
        ? t("settings.generation.archive")
        : "";
  const loadingMain =
    (shouldLoadConfig && configQuery.isLoading) ||
    (activeSection === "providers" && (providerProfilesQuery.isLoading || providerGenerationConfigsQuery.isLoading)) ||
    (activeSection === "resourceGroups" &&
      (generationResourceGroupsQuery.isLoading || resourceGroupGenerationConfigsQuery.isLoading)) ||
    (activeSection === "text" &&
      (providerProfilesQuery.isLoading || generationResourceGroupsQuery.isLoading || textGenerationConfigsQuery.isLoading)) ||
    (activeSection === "image" &&
      (providerProfilesQuery.isLoading || generationResourceGroupsQuery.isLoading || imageGenerationConfigsQuery.isLoading));
  const activeSectionError =
    activeSection === "providers"
      ? providerProfilesQuery.error ?? providerGenerationConfigsQuery.error
      : activeSection === "resourceGroups"
        ? generationResourceGroupsQuery.error ?? resourceGroupGenerationConfigsQuery.error
        : activeSection === "text"
          ? providerProfilesQuery.error ?? generationResourceGroupsQuery.error ?? textGenerationConfigsQuery.error
          : activeSection === "image"
            ? providerProfilesQuery.error ?? generationResourceGroupsQuery.error ?? imageGenerationConfigsQuery.error
            : shouldLoadConfig
              ? configQuery.error
              : null;
  const isWorkspaceSubpage = activeScheme === "workspace";
  const PageActionButton = actionButtonComponentForAppearance(isWorkspaceSubpage ? "workspace" : "classic");
  const pendingNavigationMeta = pendingSectionNavigation
    ? SETTINGS_SECTIONS.find((section) => section.id === pendingSectionNavigation)
    : null;
  const imageConfigTestActionBusy =
    saveImageConfigTestGalleryMutation.isPending ||
    keepImageConfigTestMutation.isPending ||
    abandonImageConfigTestMutation.isPending ||
    Boolean(imageConfigTestResourceLibrarySource);
  const closeImageConfigTestPreview = useCallback(() => {
    if (imageConfigTestActionBusy) {
      return;
    }
    const current = imageConfigTestPreview;
    setImageConfigTestPreview(null);
    setImageConfigTestGalleryAssetId(null);
    setImageConfigTestGalleryTagError("");
    setImageConfigTestResourceLibrarySource(null);
    if (current?.is_temporary) {
      abandonImageConfigTestMutation.mutate(current.image_session_id);
    }
  }, [abandonImageConfigTestMutation, imageConfigTestActionBusy, imageConfigTestPreview]);

  return (
    <div className={`${isWorkspaceSubpage ? "pf-workspace pf-settings-workspace" : "pf-app"} flex min-h-dvh flex-col dark:text-slate-100`}>
      <TopNav
        breadcrumbs={t("settings.breadcrumb")}
        onLogout={() => logoutMutation.mutate()}
      />

      <main
        className={
          isWorkspaceSubpage
            ? "pf-workspace-subpage pf-settings-main flex min-h-0 flex-1 flex-col"
            : "pf-settings-main mx-auto flex min-h-0 w-full max-w-[1440px] flex-1 flex-col"
        }
      >
        <div
          className={
            isWorkspaceSubpage
              ? "pf-workspace-subpage-frame-shell pf-settings-frame-shell flex min-h-0 w-full flex-1 flex-col"
              : "pf-settings-frame-shell flex min-h-0 w-full flex-1 flex-col"
          }
        >
          <div
            className={
              isWorkspaceSubpage
                ? "pf-workspace-subpage-frame pf-settings-frame flex min-h-0 flex-1 flex-col"
                : "pf-settings-frame flex min-h-0 w-full flex-1 flex-col"
            }
          >
            <div
              className={
                isWorkspaceSubpage
                  ? "pf-page-header pf-settings-header shrink-0"
                  : "pf-page-header pf-settings-header mx-auto mb-0 w-full max-w-[1440px] shrink-0 px-5 py-6 md:flex-row md:items-end md:justify-between lg:px-8 lg:py-8"
              }
            >
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

            <div className="pf-side-shell pf-settings-shell min-h-0 flex-1">
              <SettingsSideRail
                search={sectionSearch}
                onSearchChange={setSectionSearch}
                visibleSections={visibleSections}
                activeSection={activeSection}
                dirtySectionIds={dirtySectionIds}
                workspaceSubpage={isWorkspaceSubpage}
                onSectionPreview={prefetchSettingsSection}
                onSectionChange={handleActiveSectionChange}
              />

              <section
                ref={contentSectionRef}
                className="pf-side-content pf-settings-content min-h-0 px-3 py-6 sm:px-5 sm:py-8 lg:px-12 lg:py-10"
              >
                <div className="mx-auto max-w-4xl">
                  <div className="mb-8 sm:mb-10">
                    <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-500 dark:text-slate-400">
                      <span>{t("settings.title")}</span>
                      <span>/</span>
                      <span>{t(activeMeta.labelKey)}</span>
                    </div>
                    <h1 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-white sm:text-3xl">
                      {t(activeMeta.labelKey)}
                    </h1>
                    <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                      {t(activeMeta.descriptionKey)}
                    </p>
                  </div>
                  {loadingMain ? (
                    <SettingsSectionLoadingState label={t("app.loading")} />
                  ) : activeSectionError ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200">
                      <p>
                        {activeSectionError instanceof ApiError ? activeSectionError.detail : t("settings.loadFailed")}
                      </p>
                      <div className="mt-4">
                        <PageActionButton
                          type="button"
                          onClick={retryActiveSectionLoad}
                          preset="secondary"
                          size="sm"
                        >
                          {t("common.retry")}
                        </PageActionButton>
                      </div>
                    </div>
                  ) : (
                    <>
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
                    <div className={`${PANEL_CLASS} ${SETTINGS_BORDERED_MODULE_CLASS} flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between`}>
                      <div>
                        <h2 className="text-base font-semibold text-slate-950 dark:text-white">
                          {t("settings.section.globalTemplates")}
                        </h2>
                        <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                          {t("settings.section.globalTemplatesDescription")}
                        </p>
                      </div>
                      <PageActionButton
                        onClick={() => navigate("/settings/global-templates")}
                        disabled={!canManageGlobalTemplates}
                        preset="primary"
                        size="md"
                        leadingIcon={<Layers3 size={14} />}
                      >
                        {t("nav.globalTemplates")}
                      </PageActionButton>
                    </div>
                  ) : null}
                  {activeSection === "weather" ? (
                    <div className="space-y-5">
                      <WeatherSettingsPanel
                        workspaceSubpage={isWorkspaceSubpage}
                        onSaved={() => {
                          setError("");
                          setSavedMessage(t("settings.weather.saved"));
                        }}
                      />
                    </div>
                  ) : null}
                  {activeSection === "notifications" ? (
                    <NotificationSettingsPanel
                      workspaceSubpage={isWorkspaceSubpage}
                      onSaved={() => {
                        setError("");
                        setSavedMessage(t("settings.notification.saved"));
                      }}
                    />
                  ) : null}
                  <div>
                    {activeSection === "providers" ? (
                      <ProvidersSection
                        profiles={providerProfiles}
                        generationConfigs={providerGenerationConfigs}
                        profileForm={providerProfileForm}
                        editingProfileId={editingProviderProfileId}
                        drawerOpen={providerDrawerOpen}
                        pending={providerPending || archiveGenerationConfigMutation.isPending}
                        togglingProfileId={togglingProviderProfileId}
                        savingGenerationConfigId={savingGenerationConfigId}
                        archivingGenerationConfigId={archivingGenerationConfigId}
                        canWrite={canWriteProviderSettings}
                        workspaceSubpage={isWorkspaceSubpage}
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
                        onEditProfile={async (profile) => {
                          if (!canWriteProviderSettings) {
                            return;
                          }
                          const latestProfiles = await refreshProviderProfilesFromApi();
                          if (!latestProfiles) {
                            return;
                          }
                          const latestProfile = latestProfiles.find(
                            (candidate) => candidate.id === profile.id && !candidate.archived_at,
                          );
                          if (!latestProfile) {
                            setError(t("settings.provider.saveFailed"));
                            return;
                          }
                          const next = providerDrawerEditState(latestProfile);
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
                        onToggleProfileEnabled={async (profileId, enabled) => {
                          if (!canWriteProviderSettings) {
                            return;
                          }
                          if (!enabled) {
                            const profile = providerProfiles.find((item) => item.id === profileId);
                            if (profile && (profile.used_by_text_generation || profile.used_by_image_generation)) {
                              try {
                                const usedGenerationConfigs = generationConfigsUsingProvider(
                                  await api.listGenerationConfigs(),
                                  profileId,
                                );
                                if (usedGenerationConfigs.length) {
                                  setError("");
                                  setSavedMessage("");
                                  setPendingProviderDisable({ profile, generationConfigs: usedGenerationConfigs });
                                  return;
                                }
                              } catch (mutationError) {
                                setSavedMessage("");
                                setError(
                                  mutationError instanceof ApiError
                                    ? mutationError.detail
                                    : t("settings.provider.saveFailed"),
                                );
                                return;
                              }
                            }
                          }
                          updateProviderProfileEnabledMutation.mutate({ profileId, enabled });
                        }}
                        onToggleGenerationConfigEnabled={(config) => {
                          if (!canWriteProviderSettings) {
                            return;
                          }
                          saveGenerationConfigMutation.mutate({
                            ...generationConfigDraft(config),
                            enabled: !config.enabled,
                          });
                        }}
                        onDeleteGenerationConfig={(configId) => {
                          if (!canWriteProviderSettings) {
                            return;
                          }
                          requestGenerationConfigArchive(configId);
                        }}
                      />
                    ) : null}

                    {activeSection === "resourceGroups" ? (
                      <GenerationResourceGroupSection
                        groups={generationResourceGroups}
                        generationConfigs={resourceGroupGenerationConfigs}
                        drafts={generationResourceGroupDrafts}
                        pending={resourceGroupPending}
                        archivingGroupId={archivingGenerationResourceGroupId}
                        canWrite={canWriteProviderSettings}
                        workspaceSubpage={isWorkspaceSubpage}
                        onChange={(key, next) => {
                          setGenerationResourceGroupDrafts((current) => ({ ...current, [key]: next }));
                          setSavedMessage("");
                        }}
                        onSave={(draft, options) => {
                          if (!canWriteProviderSettings) {
                            return;
                          }
                          setError("");
                          setSavedMessage("");
                          saveGenerationResourceGroupMutation.mutate(
                            draft,
                            options?.onSuccess ? { onSuccess: options.onSuccess } : undefined,
                          );
                        }}
                        onArchive={(groupId) => {
                          if (!canWriteProviderSettings) {
                            return;
                          }
                          requestGenerationResourceGroupArchive(groupId);
                        }}
                      />
                    ) : null}

                    {activeSection === "text" ? (
                      <GenerationConfigPoolSection
                        key="text-generation-configs"
                        purpose="text"
                        profiles={providerProfiles}
                        resourceGroups={generationResourceGroups}
                        generationConfigs={textGenerationConfigs}
                        selectedResourceGroupId={effectiveSelectedTextResourceGroupId}
                        drafts={generationConfigDrafts}
                        pending={providerPending}
                        listRefreshing={textGenerationConfigsQuery.isFetching}
                        archivingConfigId={archivingGenerationConfigId}
                        canWrite={canWriteProviderSettings}
                        workspaceSubpage={isWorkspaceSubpage}
                        textTestState={textConfigTestState}
                        jsonResponseFormatTestState={textConfigJsonResponseFormatTestState}
                        onChange={(key, next, options) => {
                          setGenerationConfigDrafts((current) => ({ ...current, [key]: next }));
                          if (options?.clearSavedMessage !== false) {
                            setSavedMessage("");
                          }
                        }}
                        onSave={(draft, options) => {
                          if (!canWriteProviderSettings) {
                            return;
                          }
                          setError("");
                          setSavedMessage("");
                          saveGenerationConfigMutation.mutate(
                            draft,
                            options?.onSuccess ? { onSuccess: options.onSuccess } : undefined,
                          );
                        }}
                        onArchive={(configId) => {
                          if (!canWriteProviderSettings) {
                            return;
                          }
                          requestGenerationConfigArchive(configId);
                        }}
                        onUnfreeze={(configId) => {
                          if (!canWriteProviderSettings) {
                            return;
                          }
                          unfreezeGenerationConfigMutation.mutate(configId);
                        }}
                        onTextTestDraftChange={(draft) => {
                          updateTextConfigTestDraftState(() => draft);
                        }}
                        onTextTestPresetChange={(presetId) => {
                          setTextConfigTestState((current) => {
                            const draft = current.presets[presetId] ?? current.draft;
                            const draftState = {
                              selectedPresetId: presetId,
                              draft,
                              presets: current.presets,
                            };
                            writeTextConfigTestDraftState(draftState);
                            return { ...current, ...draftState };
                          });
                        }}
                        textTestReferenceAssets={textTestReferenceAssets}
                        canReadResourceLibrary={Boolean(session?.authenticated)}
                        onTextTestReferenceAssetAdd={(asset) => {
                          updateTextConfigTestDraftState((draft) => ({
                            ...draft,
                            referenceAssetIds: draft.referenceAssetIds.includes(asset.id)
                              ? draft.referenceAssetIds
                              : [...draft.referenceAssetIds, asset.id],
                          }));
                        }}
                        onTextTestReferenceAssetRemove={(assetId) => {
                          updateTextConfigTestDraftState((draft) => ({
                            ...draft,
                            referenceAssetIds: draft.referenceAssetIds.filter((currentId) => currentId !== assetId),
                          }));
                        }}
                        onTestTextConfig={async (key, draft) => {
                          if (!canWriteProviderSettings) {
                            return;
                          }
                          await testTextGenerationConfigMutation.mutateAsync({
                            key,
                            payload: textGenerationConfigTestPayload(draft, textConfigTestState.draft),
                          });
                        }}
                        onTestJsonResponseFormatConfig={(key, draft) => {
                          if (!canWriteProviderSettings) {
                            return;
                          }
                          testTextGenerationConfigJsonResponseFormatMutation.mutate({
                            key,
                            payload: textGenerationConfigJsonResponseFormatTestPayload(draft),
                          });
                        }}
                        onResetTextConfigTests={(key) => {
                          setTextConfigTestState((current) => clearTextConfigTestRecord(current, key));
                          setTextConfigJsonResponseFormatTestState((current) =>
                            clearTextConfigJsonResponseFormatTestRecord(current, key),
                          );
                        }}
                        onBeforeOpenCreate={refreshGenerationSectionInputsFromApi}
                        onSelectedResourceGroupIdChange={setSelectedTextResourceGroupId}
                        onRefreshConfigs={() => {
                          void textGenerationConfigsQuery.refetch();
                        }}
                        unfreezingConfigId={unfreezingGenerationConfigId}
                      />
                    ) : null}

                    {activeSection === "image" ? (
                      <GenerationConfigPoolSection
                        key="image-generation-configs"
                        purpose="image"
                        profiles={providerProfiles}
                        resourceGroups={generationResourceGroups}
                        generationConfigs={imageGenerationConfigs}
                        selectedResourceGroupId={effectiveSelectedImageResourceGroupId}
                        drafts={generationConfigDrafts}
                        pending={providerPending}
                        listRefreshing={imageGenerationConfigsQuery.isFetching}
                        archivingConfigId={archivingGenerationConfigId}
                        canWrite={canWriteProviderSettings}
                        workspaceSubpage={isWorkspaceSubpage}
                        imageTestState={imageConfigTestState}
                        onChange={(key, next, options) => {
                          setGenerationConfigDrafts((current) => ({ ...current, [key]: next }));
                          if (options?.clearSavedMessage !== false) {
                            setSavedMessage("");
                          }
                        }}
                        onSave={(draft, options) => {
                          if (!canWriteProviderSettings) {
                            return;
                          }
                          setError("");
                          setSavedMessage("");
                          saveGenerationConfigMutation.mutate(
                            draft,
                            options?.onSuccess ? { onSuccess: options.onSuccess } : undefined,
                          );
                        }}
                        onArchive={(configId) => {
                          if (!canWriteProviderSettings) {
                            return;
                          }
                          requestGenerationConfigArchive(configId);
                        }}
                        onUnfreeze={(configId) => {
                          if (!canWriteProviderSettings) {
                            return;
                          }
                          unfreezeGenerationConfigMutation.mutate(configId);
                        }}
                        onImageTestDraftChange={(draft) => {
                          setImageConfigTestState((current) => {
                            const selectedPresetId = current.selectedPresetId;
                            const normalizedDraft = normalizeImageConfigTestDraft(
                              draft,
                              current.presets[selectedPresetId] ?? current.draft,
                            );
                            const draftState = {
                              selectedPresetId,
                              draft: normalizedDraft,
                              presets: {
                                ...current.presets,
                                [selectedPresetId]: normalizedDraft,
                              },
                            };
                            writeImageConfigTestDraftState(draftState);
                            return { ...current, ...draftState };
                          });
                        }}
                        onImageTestPresetChange={(presetId) => {
                          setImageConfigTestState((current) => {
                            const draft = current.presets[presetId] ?? current.draft;
                            const draftState = {
                              selectedPresetId: presetId,
                              draft,
                              presets: current.presets,
                            };
                            writeImageConfigTestDraftState(draftState);
                            return { ...current, ...draftState };
                          });
                        }}
                        onSaveImageTestDraft={() => {
                          writeImageConfigTestDraftState({
                            selectedPresetId: imageConfigTestState.selectedPresetId,
                            draft: imageConfigTestState.draft,
                            presets: imageConfigTestState.presets,
                          });
                          setError("");
                          setSavedMessage(t("settings.generation.imageTestDraftSaved"));
                        }}
                        onTestImageConfig={async (key, draft, resourceGroupId) => {
                          if (!canWriteProviderSettings) {
                            return;
                          }
                          await testImageGenerationConfigMutation.mutateAsync({
                            key,
                            payload: imageGenerationConfigTestPayload(
                              draft,
                              imageConfigTestState.draft,
                              resourceGroupId,
                            ),
                          });
                        }}
                        onResetImageConfigTests={(key) => {
                          setImageConfigTestState((current) => clearImageConfigTestRecord(current, key));
                        }}
                        onBeforeOpenCreate={refreshGenerationSectionInputsFromApi}
                        onSelectedResourceGroupIdChange={setSelectedImageResourceGroupId}
                        onRefreshConfigs={() => {
                          void imageGenerationConfigsQuery.refetch();
                        }}
                        unfreezingConfigId={unfreezingGenerationConfigId}
                      />
                    ) : null}

                    {activeSection === "loginPage" ? (
                      <div className={`${PANEL_CLASS} ${SETTINGS_BORDERED_MODULE_CLASS} space-y-2`}>
                        {activeItems.length ? (
                          <LoginPageSettingsPanel
                            items={activeItems}
                            drafts={drafts}
                            secretTouched={secretTouched}
                            resettingKey={resettingKey}
                            disabled={!canWriteRuntimeSettings}
                            assets={loginPageAssetsQuery.data?.items ?? []}
                            assetsLoading={loginPageAssetsQuery.isLoading}
                            assetsError={loginPageAssetsQuery.isError}
                            selectionSaving={saveLoginPageSelectionMutation.isPending}
                            templateConfigSaving={saveLoginPageTemplateConfigMutation.isPending}
                            workspaceSubpage={isWorkspaceSubpage}
                            onChange={(item, nextValue, touchedSecret) => {
                              setDrafts((current) => ({ ...current, [item.key]: nextValue }));
                              setSavedMessage("");
                              if (touchedSecret) {
                                setSecretTouched((current) => ({ ...current, [item.key]: true }));
                              }
                            }}
                            onReset={(item) => {
                              if (canWriteRuntimeSettings) {
                                setPendingResetItem(item);
                              }
                            }}
                            onSaveSelection={(value) => {
                              if (!canWriteRuntimeSettings) {
                                return;
                              }
                              setError("");
                              setSavedMessage("");
                              saveLoginPageSelectionMutation.mutate(value);
                            }}
                            onSaveTemplateConfig={(templateId, config) => {
                              if (!canWriteRuntimeSettings) {
                                return;
                              }
                              setError("");
                              setSavedMessage("");
                              saveLoginPageTemplateConfigMutation.mutate({ templateId, config });
                            }}
                          />
                        ) : (
                          <div className="rounded-lg border border-dashed pf-hairline-strong px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                            {t("settings.section.empty")}
                          </div>
                        )}
                      </div>
                    ) : null}

                    {genericSection ? (
                      <GenericConfigSection
                        activeSection={activeSection}
                        items={activeItems}
                        configGroups={activeConfigGroups}
                        drafts={drafts}
                        secretTouched={secretTouched}
                        resettingKey={resettingKey}
                        disabled={!canWriteRuntimeSettings}
                        saving={saveMutation.isPending}
                        workspaceSubpage={isWorkspaceSubpage}
                        onChange={(item, nextValue, touchedSecret) => {
                          setDrafts((current) => ({ ...current, [item.key]: nextValue }));
                          setSavedMessage("");
                          if (touchedSecret) {
                            setSecretTouched((current) => ({ ...current, [item.key]: true }));
                          }
                        }}
                        onReset={(item) => {
                          if (canWriteRuntimeSettings) {
                            setPendingResetItem(item);
                          }
                        }}
                        onDiscard={() => resetDraftsFromConfig(configQuery.data)}
                        onSubmit={handleSubmit}
                      />
                    ) : null}
                  </div>
                    </>
                  )}
                </div>
              </section>
            </div>

          </div>
        </div>
        <SettingsFeedbackDialog
          successMessage={savedMessage}
          errorMessage={error}
          onCloseSuccess={() => setSavedMessage("")}
          onCloseError={() => setError("")}
        />
        <ConfirmDialog
          open={Boolean(pendingSectionNavigation)}
          appearance={isWorkspaceSubpage ? "workspace" : "classic"}
          title={t("settings.unsavedNavigationConfirmTitle")}
          description={
            pendingNavigationMeta
              ? t("settings.unsavedNavigationConfirm", {
                  from: t(activeMeta.labelKey),
                  to: t(pendingNavigationMeta.labelKey),
                })
              : ""
          }
          confirmLabel={t("settings.unsavedNavigationConfirmLabel")}
          cancelLabel={t("common.cancel")}
          destructive={false}
          onClose={() => setPendingSectionNavigation(null)}
          onConfirm={() => {
            if (!pendingSectionNavigation) {
              return;
            }
            const nextSection = pendingSectionNavigation;
            setPendingSectionNavigation(null);
            resetDraftsFromConfig(configQuery.data);
            navigateToSettingsSection(nextSection);
          }}
        />
        {imageConfigTestPreview ? (
          <ImageConfigTestResultDialog
            appearance={isWorkspaceSubpage ? "workspace" : "classic"}
            result={imageConfigTestPreview}
            canSaveGallery={canSaveImageConfigTestGallery}
            canSaveResourceLibrary
            canKeepSession={canWriteProviderSettings}
            busy={imageConfigTestActionBusy}
            savingGallery={saveImageConfigTestGalleryMutation.isPending}
            keepingSession={keepImageConfigTestMutation.isPending}
            onSaveResourceLibrary={() => {
              if (imageConfigTestActionBusy) {
                return;
              }
              setImageConfigTestResourceLibrarySource({
                source_type: "image_session_asset",
                source_id: imageConfigTestPreview.generated_asset.id,
                title: imageConfigTestPreview.generated_asset.original_filename,
                thumbnail_url:
                  imageConfigTestPreview.generated_asset.thumbnail_url ??
                  imageConfigTestPreview.generated_asset.preview_url,
              });
            }}
            onSaveGallery={() => {
              if (
                !canSaveImageConfigTestGallery ||
                imageConfigTestPreview.generated_asset.gallery_saved ||
                imageConfigTestActionBusy
              ) {
                return;
              }
              setImageConfigTestGalleryAssetId(imageConfigTestPreview.generated_asset.id);
              setImageConfigTestGalleryTagError("");
            }}
            onKeepSession={() => {
              if (!canWriteProviderSettings || imageConfigTestActionBusy) {
                return;
              }
              keepImageConfigTestMutation.mutate(imageConfigTestPreview.image_session_id);
            }}
            onClose={closeImageConfigTestPreview}
          />
        ) : null}
        <SaveToResourceLibraryDialog
          source={imageConfigTestResourceLibrarySource}
          canWrite
          appearance={isWorkspaceSubpage ? "workspace" : "classic"}
          onSaved={async () => {
            setImageConfigTestPreview(null);
            setImageConfigTestResourceLibrarySource(null);
            setImageConfigTestGalleryAssetId(null);
            setImageConfigTestGalleryTagError("");
            await queryClient.invalidateQueries({ queryKey: ["image-sessions"] });
          }}
          onClose={() => {
            if (!imageConfigTestResourceLibrarySource) {
              return;
            }
            setImageConfigTestResourceLibrarySource(null);
          }}
        />
        <GalleryTagPickerDialog
          open={Boolean(imageConfigTestGalleryAssetId)}
          appearance={isWorkspaceSubpage ? "workspace" : "classic"}
          tags={galleryTags}
          initialSelectedTagIds={[]}
          maxSelection={galleryEntryTagMaxSelection}
          required={galleryTagRequiredOnSave}
          busy={saveImageConfigTestGalleryMutation.isPending}
          error={imageConfigTestGalleryTagError}
          onConfirm={(tagIds) => {
            if (!imageConfigTestGalleryAssetId) {
              return;
            }
            saveImageConfigTestGalleryMutation.mutate({ assetId: imageConfigTestGalleryAssetId, tagIds });
          }}
          onClose={() => {
            if (!saveImageConfigTestGalleryMutation.isPending) {
              setImageConfigTestGalleryAssetId(null);
              setImageConfigTestGalleryTagError("");
            }
          }}
        />
        <ConfirmDialog
          open={exportConfirmOpen}
          appearance={isWorkspaceSubpage ? "workspace" : "classic"}
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
          open={Boolean(pendingResetItem)}
          appearance={isWorkspaceSubpage ? "workspace" : "classic"}
          title={t("settings.restoreDefaultConfirmTitle")}
          description={
            pendingResetItem
              ? t("settings.restoreDefaultConfirm", {
                  label: pendingResetItem.label,
                  key: pendingResetItem.key,
                })
              : ""
          }
          confirmLabel={t("settings.restoreDefaultConfirmLabel")}
          cancelLabel={t("common.cancel")}
          busy={resetMutation.isPending}
          onClose={() => {
            if (!resetMutation.isPending) {
              setPendingResetItem(null);
            }
          }}
          onConfirm={() => {
            if (canWriteRuntimeSettings && pendingResetItem) {
              resetMutation.mutate(pendingResetItem.key);
            }
          }}
        />
        <ConfirmDialog
          open={Boolean(pendingDeleteProviderProfile)}
          appearance={isWorkspaceSubpage ? "workspace" : "classic"}
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
        <ProviderDisableConfirmDialog
          pendingDisable={pendingProviderDisable}
          busy={updateProviderProfileEnabledMutation.isPending}
          onClose={() => {
            if (!updateProviderProfileEnabledMutation.isPending) {
              setPendingProviderDisable(null);
            }
          }}
          onConfirm={() => {
            if (canWriteProviderSettings && pendingProviderDisable) {
              updateProviderProfileEnabledMutation.mutate({
                profileId: pendingProviderDisable.profile.id,
                enabled: false,
              });
            }
          }}
        />
        <ConfirmDialog
          open={Boolean(pendingGenerationArchive)}
          appearance={isWorkspaceSubpage ? "workspace" : "classic"}
          title={pendingGenerationArchiveTitle}
          description={pendingGenerationArchiveDescription}
          error={pendingGenerationArchiveError}
          confirmLabel={pendingGenerationArchiveConfirmLabel}
          cancelLabel={t("common.cancel")}
          busy={pendingGenerationArchiveBusy}
          onClose={() => {
            if (!pendingGenerationArchiveBusy) {
              setPendingGenerationArchive(null);
              setPendingGenerationArchiveError("");
            }
          }}
          onConfirm={() => {
            if (!canWriteProviderSettings || !pendingGenerationArchive) {
              return;
            }
            setPendingGenerationArchiveError("");
            if (pendingGenerationArchive.kind === "resourceGroup") {
              archiveGenerationResourceGroupMutation.mutate(pendingGenerationArchive.id);
              return;
            }
            archiveGenerationConfigMutation.mutate(pendingGenerationArchive.id);
          }}
        />
      </main>
    </div>
  );
}
