// 生成配置池区块簇：池容器(PoolSection) + 配置卡片(Card) + 新建对话框 + 批量测试对话框。
// 从 SettingsPage.tsx 整簇抽出，行为不变。仅 GenerationConfigPoolSection 对外导出。

import { useEffect, useId, useState } from "react";

import {
  Check,
  CheckCircle2,
  FileJson,
  Filter,
  Image,
  Loader2,
  MessageSquareText,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Trash2,
  X,
} from "lucide-react";

import { ClassicSelectField, ClassicTextInput } from "../../../components/classicInputs";
import { ModalShell } from "../../../components/ModalShell";
import {
  WorkspaceSelectField,
  WorkspaceTextInput,
} from "../../../components/workspaceInputs";
import { formatDateTime } from "../../../lib/format";
import { useI18n } from "../../../lib/preferences";
import type {
  GenerationConfig,
  GenerationResourceGroup,
  ImageGenerationConfigTestResponse,
  ProviderProfile,
  TextGenerationConfigJsonResponseFormatTestResponse,
  TextGenerationConfigTestResponse,
} from "../../../lib/types";
import {
  imageConfigTestRecordForKey,
  textConfigJsonResponseFormatTestRecordForKey,
  textConfigTestRecordForKey,
  type ImageConfigTestDraft,
  type ImageConfigTestState,
  type TextConfigJsonResponseFormatTestState,
  type TextConfigTestDraft,
  type TextConfigTestState,
} from "../configTestState";
import {
  filterGenerationConfigsByName,
  filterGenerationConfigsByLatestTestFailure,
  generationConfigBatchFailedSelectableIds,
  generationConfigBatchSelectableIds,
  generationConfigDraft,
  generationConfigDraftAfterProviderProfileSelection,
  generationConfigLatestTestDetail,
  generationConfigLatestTestTypeLabelKey,
  generationConfigProviderInterfaceLabelKey,
  generationConfigSuccessRate,
  sortGenerationConfigsForDisplay,
  generationConfigTabClassName,
  isTextStructuredOutputProviderKind,
  newGenerationConfigDraft,
  normalizedGenerationConfigProviderKind,
  providerProfileIdAfterKindChange,
  providerProfilesForGenerationConfig,
  runGenerationConfigBatchTests,
  textStructuredOutputProviderInterfaceLabelKey,
  type GenerationConfigDraft,
} from "../generationConfig";
import { filterProviderProfilesByName } from "../providerForm";
import { generationConfigResourceGroupIds } from "../resourceGroups";
import { ImageConfigTestPanel, TextConfigTestPanel } from "./ConfigTestPanels";
import { GenerationConfigImageFields } from "./GenerationConfigImageFields";
import { GenerationResourceGroupMultiSelect } from "./GenerationResourceGroupMultiSelect";
import { ProviderModelInput } from "./ProviderModelInput";
import { SettingsFormField } from "./SettingsFormField";
import {
  PANEL_CLASS,
  SETTINGS_BORDERED_MODULE_CLASS,
  SETTINGS_FIELD_CARD_CLASS,
  useSettingsActionClassNames,
} from "./styles";
import { SettingsOptionToggle, SettingsSwitchToggle } from "./Toggles";

interface GenerationConfigSaveOptions {
  onSuccess?: (generationConfig: GenerationConfig) => void;
}

interface GenerationConfigPoolSectionProps {
  purpose: "text" | "image";
  profiles: ProviderProfile[];
  resourceGroups: GenerationResourceGroup[];
  generationConfigs: GenerationConfig[];
  selectedResourceGroupId: string;
  drafts: Record<string, GenerationConfigDraft>;
  pending: boolean;
  listRefreshing?: boolean;
  archivingConfigId: string | null;
  canWrite: boolean;
  textTestState?: TextConfigTestState;
  jsonResponseFormatTestState?: TextConfigJsonResponseFormatTestState;
  imageTestState?: ImageConfigTestState;
  onChange: (key: string, next: GenerationConfigDraft, options?: { clearSavedMessage?: boolean }) => void;
  onSave: (draft: GenerationConfigDraft, options?: GenerationConfigSaveOptions) => void;
  onArchive: (configId: string) => void;
  onUnfreeze: (configId: string) => void;
  onTextTestDraftChange?: (draft: TextConfigTestDraft) => void;
  onTextTestPresetChange?: (presetId: string) => void;
  onImageTestDraftChange?: (draft: ImageConfigTestDraft) => void;
  onImageTestPresetChange?: (presetId: string) => void;
  onSaveImageTestDraft?: () => void;
  onTestTextConfig?: (key: string, draft: GenerationConfigDraft) => Promise<void> | void;
  onTestImageConfig?: (key: string, draft: GenerationConfigDraft, resourceGroupId: string) => Promise<void> | void;
  onTestJsonResponseFormatConfig?: (key: string, draft: GenerationConfigDraft) => Promise<void> | void;
  onResetTextConfigTests?: (key: string) => void;
  onResetImageConfigTests?: (key: string) => void;
  onBeforeOpenCreate?: () => Promise<boolean> | boolean;
  onSelectedResourceGroupIdChange: (resourceGroupId: string) => void;
  onRefreshConfigs: () => void;
  unfreezingConfigId: string | null;
  workspaceSubpage?: boolean;
}

function isActiveFrozenUntil(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

interface GenerationConfigCreateDialogProps {
  open: boolean;
  title: string;
  draft: GenerationConfigDraft;
  resourceGroups: GenerationResourceGroup[];
  profiles: ProviderProfile[];
  pending: boolean;
  canWrite: boolean;
  testing?: boolean;
  testResult?: TextGenerationConfigTestResponse | null;
  testError?: string;
  imageTesting?: boolean;
  imageTestResult?: ImageGenerationConfigTestResponse | null;
  imageTestError?: string;
  jsonResponseFormatTesting?: boolean;
  jsonResponseFormatTestResult?: TextGenerationConfigJsonResponseFormatTestResponse | null;
  jsonResponseFormatTestError?: string;
  workspaceSubpage?: boolean;
  onChange: (next: GenerationConfigDraft) => void;
  onSave: () => void;
  onClose: () => void;
  onTest?: () => void;
  onImageTest?: () => void;
  onTestJsonResponseFormat?: () => void;
}

interface GenerationConfigBatchTestItem {
  key: string;
  config: GenerationConfig;
  draft: GenerationConfigDraft;
  providerName: string;
  resourceGroupId: string;
  disabled: boolean;
}

interface GenerationConfigBatchTestDialogProps {
  open: boolean;
  purpose: "text" | "image";
  resourceGroupName: string;
  items: GenerationConfigBatchTestItem[];
  selectedIds: string[];
  concurrency: string;
  busy: boolean;
  workspaceSubpage?: boolean;
  onSelectedIdsChange: (selectedIds: string[]) => void;
  onConcurrencyChange: (concurrency: string) => void;
  onClose: () => void;
  onRun: () => void;
}

function GenerationConfigBatchTestDialog({
  open,
  purpose,
  resourceGroupName,
  items,
  selectedIds,
  concurrency,
  busy,
  workspaceSubpage = false,
  onSelectedIdsChange,
  onConcurrencyChange,
  onClose,
  onRun,
}: GenerationConfigBatchTestDialogProps) {
  const { t } = useI18n();
  const { SETTINGS_COMPACT_ACTION_CLASS, SETTINGS_ICON_ACTION_CLASS, SETTINGS_MAIN_ACTION_CLASS } =
    useSettingsActionClassNames();
  const titleId = useId();
  const selectedSet = new Set(selectedIds);
  const selectedCount = selectedIds.length;
  const selectableIds = generationConfigBatchSelectableIds(items);
  const failedSelectableIds = generationConfigBatchFailedSelectableIds(items);

  if (!open) {
    return null;
  }

  const toggleItem = (itemId: string) => {
    onSelectedIdsChange(
      selectedSet.has(itemId) ? selectedIds.filter((id) => id !== itemId) : [...selectedIds, itemId],
    );
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      closeDisabled={busy}
      ariaLabelledBy={titleId}
      overlayClassName="z-[85] bg-slate-950/55 px-4 py-6 backdrop-blur-sm"
      panelClassName="flex max-h-[calc(100dvh-3rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-slate-700/80 dark:bg-[#0f1726] dark:shadow-black/45"
    >
      <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-5 dark:border-slate-800">
        <div className="min-w-0">
          <h2 id={titleId} className="truncate text-lg font-semibold text-slate-950 dark:text-white">
            {t("settings.generation.batchTestTitle")}
          </h2>
          <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">
            {t("settings.generation.batchTestSubtitle", {
              purpose: t(purpose === "text" ? "settings.section.text" : "settings.section.image"),
              group: resourceGroupName,
            })}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className={SETTINGS_ICON_ACTION_CLASS}
          aria-label={t("create.close")}
          title={t("create.close")}
        >
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onSelectedIdsChange(selectableIds)}
            disabled={busy || selectableIds.length === 0}
            className={SETTINGS_COMPACT_ACTION_CLASS}
          >
            <Check size={14} className="mr-1.5" />
            {t("settings.generation.batchSelectAll")}
          </button>
          {failedSelectableIds.length ? (
            <button
              type="button"
              onClick={() => onSelectedIdsChange(failedSelectableIds)}
              disabled={busy}
              className={SETTINGS_COMPACT_ACTION_CLASS}
            >
              <RotateCcw size={14} className="mr-1.5" />
              {t("settings.generation.batchSelectFailed")}
            </button>
          ) : null}
        </div>
        {items.length ? (
          items.map((item) => {
            const latestTestResult = item.config.latest_test_result;
            const latestDetail = latestTestResult ? generationConfigLatestTestDetail(latestTestResult, t) : "";
            const selected = selectedSet.has(item.config.id);
            return (
              <SettingsOptionToggle
                key={item.config.id}
                checked={selected}
                disabled={busy || item.disabled}
                workspaceSubpage={workspaceSubpage}
                layout="card"
                className={`w-full ${
                  item.disabled
                    ? "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-900/45 dark:text-slate-400"
                    : selected
                      ? "border-indigo-300 bg-indigo-50/70 dark:border-violet-400/45 dark:bg-violet-500/12"
                      : "border-slate-200 bg-white dark:border-slate-700 dark:bg-[#111b2d]"
                }`}
                onChange={() => toggleItem(item.config.id)}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-950 dark:text-white">{item.config.name}</span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                        item.config.effective_enabled
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/12 dark:text-emerald-200"
                          : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/35 dark:bg-amber-500/12 dark:text-amber-200"
                      }`}
                    >
                      {item.config.effective_enabled
                        ? t("settings.generation.effectiveEnabled")
                        : t("settings.generation.effectiveDisabled")}
                    </span>
                    {!item.config.enabled ? (
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
                        {t("settings.provider.disabled")}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                    {t("settings.generation.batchProviderLine", {
                      provider: item.providerName,
                      interfaceName: t(generationConfigProviderInterfaceLabelKey(item.config.provider_kind)),
                    })}
                  </span>
                  <span className="mt-2 block text-xs leading-5 text-slate-600 dark:text-slate-300">
                    {latestTestResult
                      ? [
                          t(generationConfigLatestTestTypeLabelKey(latestTestResult.test_type)),
                          t(
                            latestTestResult.status === "failed"
                              ? "settings.generation.latestTestFailed"
                              : "settings.generation.latestTestPassed",
                          ),
                          formatDateTime(latestTestResult.tested_at),
                          latestDetail,
                        ]
                          .filter(Boolean)
                          .join(" · ")
                      : t("settings.generation.batchNoLatestTest")}
                  </span>
                </span>
              </SettingsOptionToggle>
            );
          })
        ) : (
          <div className="rounded-xl border border-dashed pf-hairline-strong bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/45 dark:text-slate-400">
            {t("settings.generation.batchEmpty")}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-800 dark:bg-slate-950/45 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-200">
          <span>{t("settings.generation.batchConcurrency")}</span>
          {workspaceSubpage ? (
            <WorkspaceTextInput
              type="number"
              min={1}
              max={20}
              value={concurrency}
              disabled={busy}
              onChange={(event) => onConcurrencyChange(event.target.value)}
              size="compact"
              className="w-20"
            />
          ) : (
            <ClassicTextInput
              type="number"
              min={1}
              max={20}
              value={concurrency}
              disabled={busy}
              onChange={(event) => onConcurrencyChange(event.target.value)}
              size="compact"
              className="w-20"
            />
          )}
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={SETTINGS_COMPACT_ACTION_CLASS}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={onRun}
            disabled={busy || selectedCount === 0}
            className={SETTINGS_MAIN_ACTION_CLASS}
          >
            {busy ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Check size={14} className="mr-1.5" />}
            {t("settings.generation.batchRun", { count: String(selectedCount) })}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function GenerationConfigCreateDialog({
  open,
  title,
  draft,
  resourceGroups,
  profiles,
  pending,
  canWrite,
  testing = false,
  testResult = null,
  testError = "",
  imageTesting = false,
  imageTestResult = null,
  imageTestError = "",
  jsonResponseFormatTesting = false,
  jsonResponseFormatTestResult = null,
  jsonResponseFormatTestError = "",
  workspaceSubpage = false,
  onChange,
  onSave,
  onClose,
  onTest,
  onImageTest,
  onTestJsonResponseFormat,
}: GenerationConfigCreateDialogProps) {
  const { t } = useI18n();
  const { SETTINGS_ICON_ACTION_CLASS } = useSettingsActionClassNames();
  const titleId = useId();

  if (!open) {
    return null;
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      closeDisabled={pending}
      ariaLabelledBy={titleId}
      overlayClassName="z-[85] bg-slate-950/55 px-4 py-6 backdrop-blur-sm"
      panelClassName="flex max-h-[calc(100dvh-3rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-slate-700/80 dark:bg-[#0f1726] dark:shadow-black/45"
    >
        <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-5 dark:border-slate-800">
          <div className="flex min-w-0 items-center gap-3">
            <span className="text-indigo-600 dark:text-violet-300">
              <Plus size={18} />
            </span>
            <h2 id={titleId} className="truncate text-lg font-semibold text-slate-950 dark:text-white">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className={SETTINGS_ICON_ACTION_CLASS}
            aria-label={t("create.close")}
            title={t("create.close")}
          >
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <GenerationConfigCard
            config={null}
            draft={draft}
            resourceGroups={resourceGroups}
            profiles={profiles}
            pending={pending}
            canWrite={canWrite}
            testing={testing}
            testResult={testResult}
            testError={testError}
            imageTesting={imageTesting}
            imageTestResult={imageTestResult}
            imageTestError={imageTestError}
            jsonResponseFormatTesting={jsonResponseFormatTesting}
            jsonResponseFormatTestResult={jsonResponseFormatTestResult}
            jsonResponseFormatTestError={jsonResponseFormatTestError}
            workspaceSubpage={workspaceSubpage}
            onChange={onChange}
            onSave={onSave}
            onTest={onTest}
            onImageTest={onImageTest}
            onTestJsonResponseFormat={onTestJsonResponseFormat}
          />
        </div>
    </ModalShell>
  );
}

export function GenerationConfigPoolSection({
  purpose,
  profiles,
  resourceGroups,
  generationConfigs,
  selectedResourceGroupId,
  drafts,
  pending,
  listRefreshing = false,
  archivingConfigId,
  canWrite,
  textTestState,
  jsonResponseFormatTestState,
  imageTestState,
  onChange,
  onSave,
  onArchive,
  onUnfreeze,
  onTextTestDraftChange,
  onTextTestPresetChange,
  onImageTestDraftChange,
  onImageTestPresetChange,
  onSaveImageTestDraft,
  onTestTextConfig,
  onTestImageConfig,
  onTestJsonResponseFormatConfig,
  onResetTextConfigTests,
  onResetImageConfigTests,
  onBeforeOpenCreate,
  onSelectedResourceGroupIdChange,
  onRefreshConfigs,
  unfreezingConfigId,
  workspaceSubpage = false,
}: GenerationConfigPoolSectionProps) {
  const { t } = useI18n();
  const { SETTINGS_COMPACT_ACTION_CLASS, SETTINGS_MAIN_ACTION_CLASS } = useSettingsActionClassNames();
  const firstEnabledGroupId = resourceGroups.find((group) => group.enabled)?.id ?? "";
  const [configSearch, setConfigSearch] = useState("");
  const [failedOnly, setFailedOnly] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [openingCreateDialog, setOpeningCreateDialog] = useState(false);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [batchSelectedIds, setBatchSelectedIds] = useState<string[]>([]);
  const [batchConcurrency, setBatchConcurrency] = useState("4");
  const [batchRunning, setBatchRunning] = useState(false);
  const activeResourceGroupId = selectedResourceGroupId || "";
  const activeResourceGroup = resourceGroups.find((group) => group.id === activeResourceGroupId) ?? null;
  const activeResourceGroupName = activeResourceGroup?.name ?? t("settings.generation.unboundResourceGroup");
  useEffect(() => {
    if (selectedResourceGroupId && !resourceGroups.some((group) => group.id === selectedResourceGroupId)) {
      onSelectedResourceGroupIdChange(firstEnabledGroupId || "");
    }
  }, [firstEnabledGroupId, onSelectedResourceGroupIdChange, resourceGroups, selectedResourceGroupId]);
  const searchedConfigs = filterGenerationConfigsByName(
    sortGenerationConfigsForDisplay(
      generationConfigs.filter((generationConfig) => generationConfig.purpose === purpose && !generationConfig.archived_at),
    ),
    configSearch,
  );
  const failedConfigs = filterGenerationConfigsByLatestTestFailure(searchedConfigs, true);
  const configs = failedOnly ? failedConfigs : searchedConfigs;
  const newDraftKey = `new-${purpose}-${activeResourceGroupId || "unbound"}`;
  const newDraft =
    drafts[newDraftKey] ?? newGenerationConfigDraft(purpose, activeResourceGroupId);
  const newDraftResourceGroupId = newDraft.resource_group_ids[0] ?? activeResourceGroupId;
  const cards = [
    ...configs.map((config) => ({
      key: config.id,
      draftKey: config.id,
      config,
      draft: drafts[config.id] ?? generationConfigDraft(config),
    })),
  ];
  const batchItems: GenerationConfigBatchTestItem[] = cards.map(({ key, config, draft }) => {
    const testRecord = textConfigTestRecordForKey(textTestState, key);
    const imageTestRecord = imageConfigTestRecordForKey(imageTestState, key);
    const providerProfile = profiles.find((profile) => profile.id === (draft.provider_profile_id || config.provider_profile_id));
    const resourceGroupId =
      activeResourceGroupId && draft.resource_group_ids.includes(activeResourceGroupId)
        ? activeResourceGroupId
        : draft.resource_group_ids[0] ?? activeResourceGroupId;
    const providerMissing = draft.provider_kind !== "mock" && !draft.provider_profile_id;
    const modelMissing = purpose === "image" && !draft.model.trim();
    const imageGroupMissing = purpose === "image" && !resourceGroupId;
    const alreadyTesting = purpose === "text" ? Boolean(testRecord?.testing) : Boolean(imageTestRecord?.testing);
    return {
      key,
      config,
      draft,
      providerName:
        draft.provider_kind === "mock"
          ? t("settings.provider.interface.mock")
          : providerProfile?.name ?? t("settings.provider.selectProfile"),
      resourceGroupId,
      disabled:
        !config.effective_enabled ||
        alreadyTesting ||
        !draft.name.trim() ||
        providerMissing ||
        modelMissing ||
        imageGroupMissing,
    };
  });
  const openBatchDialog = () => {
    if (!canWrite) {
      return;
    }
    setBatchSelectedIds([]);
    setBatchConcurrency("4");
    setBatchDialogOpen(true);
  };
  const runBatchTests = async () => {
    const selectedItems = batchItems.filter((item) => batchSelectedIds.includes(item.config.id) && !item.disabled);
    if (!selectedItems.length) {
      return;
    }
    const concurrency = Math.min(20, Math.max(1, Math.floor(Number(batchConcurrency)) || 4));
    setBatchConcurrency(String(concurrency));
    setBatchRunning(true);
    try {
      await runGenerationConfigBatchTests(selectedItems, concurrency, async (item) => {
        if (purpose === "text") {
          await onTestTextConfig?.(item.key, item.draft);
          return;
        }
        await onTestImageConfig?.(item.key, item.draft, item.resourceGroupId);
      });
      setBatchDialogOpen(false);
      setBatchSelectedIds([]);
    } finally {
      setBatchRunning(false);
    }
  };
  const newDraftTestRecord = textConfigTestRecordForKey(textTestState, newDraftKey);
  const newDraftJsonResponseFormatTestRecord = textConfigJsonResponseFormatTestRecordForKey(
    jsonResponseFormatTestState,
    newDraftKey,
  );
  const newDraftImageTestRecord = imageConfigTestRecordForKey(imageTestState, newDraftKey);
  const resetNewDraft = () => {
    onChange(newDraftKey, newGenerationConfigDraft(purpose, activeResourceGroupId), { clearSavedMessage: false });
    if (purpose === "text") {
      onResetTextConfigTests?.(newDraftKey);
    }
    if (purpose === "image") {
      onResetImageConfigTests?.(newDraftKey);
    }
  };
  const openCreateDialog = async () => {
    if (!canWrite || openingCreateDialog) {
      return;
    }
    setOpeningCreateDialog(true);
    try {
      const canOpen = onBeforeOpenCreate ? await onBeforeOpenCreate() : true;
      if (canOpen !== false) {
        setCreateDialogOpen(true);
      }
    } finally {
      setOpeningCreateDialog(false);
    }
  };

  return (
    <section className="space-y-4">
      {purpose === "text" && textTestState && onTextTestDraftChange && onTextTestPresetChange ? (
        <TextConfigTestPanel
          state={textTestState}
          onDraftChange={onTextTestDraftChange}
          onPresetChange={onTextTestPresetChange}
          workspaceSubpage={workspaceSubpage}
        />
      ) : null}
      {purpose === "image" && imageTestState && onImageTestDraftChange && onImageTestPresetChange && onSaveImageTestDraft ? (
        <ImageConfigTestPanel
          state={imageTestState}
          onDraftChange={onImageTestDraftChange}
          onPresetChange={onImageTestPresetChange}
          onSaveDraft={onSaveImageTestDraft}
          workspaceSubpage={workspaceSubpage}
        />
      ) : null}
      <div className={`${PANEL_CLASS} ${SETTINGS_BORDERED_MODULE_CLASS} space-y-5`}>
        <div className="space-y-4">
          <div>
            <h2 className="text-base font-semibold text-slate-950 dark:text-white">
              {purpose === "text" ? t("settings.generation.textPoolTitle") : t("settings.generation.imagePoolTitle")}
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
              {t("settings.generation.poolDescription")}
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <label className="relative block w-full sm:max-w-md">
              <span className="sr-only">{t("settings.generation.search")}</span>
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
              />
              {workspaceSubpage ? (
                <WorkspaceTextInput
                  type="search"
                  value={configSearch}
                  onChange={(event) => setConfigSearch(event.target.value)}
                  className="pl-10"
                  size="tall"
                  placeholder={t("settings.generation.searchPlaceholder")}
                  aria-label={t("settings.generation.search")}
                />
              ) : (
                <ClassicTextInput
                  type="search"
                  value={configSearch}
                  onChange={(event) => setConfigSearch(event.target.value)}
                  className="pl-10"
                  size="tall"
                  placeholder={t("settings.generation.searchPlaceholder")}
                  aria-label={t("settings.generation.search")}
                />
              )}
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                aria-pressed={failedOnly}
                onClick={() => setFailedOnly((value) => !value)}
                className={SETTINGS_COMPACT_ACTION_CLASS}
              >
                <Filter size={14} className="mr-2" />
                {t("settings.generation.failedOnlyFilter", { count: String(failedConfigs.length) })}
              </button>
              <button
                type="button"
                onClick={openBatchDialog}
                disabled={!canWrite || batchRunning || (purpose === "text" ? !onTestTextConfig : !onTestImageConfig)}
                className={SETTINGS_COMPACT_ACTION_CLASS}
              >
                {batchRunning ? (
                  <Loader2 size={14} className="mr-2 animate-spin" />
                ) : (
                  <Check size={14} className="mr-2" />
                )}
                {t("settings.generation.batchTest")}
              </button>
              <button
                type="button"
                onClick={() => {
                  void openCreateDialog();
                }}
                disabled={!canWrite || openingCreateDialog}
                className={SETTINGS_MAIN_ACTION_CLASS}
              >
                {openingCreateDialog ? (
                  <Loader2 size={14} className="mr-2 animate-spin" />
                ) : (
                  <Plus size={14} className="mr-2" />
                )}
                {t("settings.generation.newConfig")}
              </button>
              <button
                type="button"
                onClick={onRefreshConfigs}
                className={SETTINGS_COMPACT_ACTION_CLASS}
              >
                <RefreshCw size={14} className="mr-2" />
                {t("settings.generation.refreshSort")}
              </button>
            </div>
          </div>
        </div>
        <div className="pf-settings-generation-tabs flex flex-wrap gap-1">
          {resourceGroups.map((group) => {
            const active = activeResourceGroupId === group.id;
            return (
              <button
                key={group.id}
                type="button"
                aria-current={active ? "true" : undefined}
                onClick={() => onSelectedResourceGroupIdChange(group.id)}
                className={generationConfigTabClassName(active)}
              >
                {group.enabled ? group.name : `${group.name} (${t("settings.resourceGroup.disabled")})`}
              </button>
            );
          })}
          <button
            type="button"
            aria-current={activeResourceGroupId === "" ? "true" : undefined}
            onClick={() => onSelectedResourceGroupIdChange("")}
            className={generationConfigTabClassName(activeResourceGroupId === "")}
          >
            {t("settings.generation.unboundResourceGroup")}
          </button>
        </div>
        {listRefreshing ? (
          <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
            <Loader2 size={14} className="animate-spin" />
            <span>{t("app.loading")}</span>
          </div>
        ) : null}
        {cards.length ? (
          <div className={`space-y-4 transition-opacity ${listRefreshing ? "opacity-75" : "opacity-100"}`}>
            {cards.map(({ key, draftKey, config, draft }) => {
              const testRecord = textConfigTestRecordForKey(textTestState, key);
              const imageTestRecord = imageConfigTestRecordForKey(imageTestState, key);
              const jsonResponseFormatTestRecord = textConfigJsonResponseFormatTestRecordForKey(
                jsonResponseFormatTestState,
                key,
              );
              const cardResourceGroupId = activeResourceGroupId && draft.resource_group_ids.includes(activeResourceGroupId)
                ? activeResourceGroupId
                : draft.resource_group_ids[0] ?? firstEnabledGroupId;
              return (
                <GenerationConfigCard
                  key={key}
                  config={config}
                  draft={draft}
                  resourceGroups={resourceGroups}
                  profiles={providerProfilesForGenerationConfig(profiles, draft, draft.provider_profile_id)}
                  pending={pending || archivingConfigId === config?.id}
                  canWrite={canWrite}
                  onChange={(next) => onChange(draftKey, next)}
                  onSave={() => onSave(draft)}
                  onArchive={config ? () => onArchive(config.id) : undefined}
                  onUnfreeze={config ? () => onUnfreeze(config.id) : undefined}
                  unfreezing={unfreezingConfigId === config?.id}
                  onTest={purpose === "text" && onTestTextConfig ? () => onTestTextConfig(key, draft) : undefined}
                  onImageTest={
                    purpose === "image" && onTestImageConfig && cardResourceGroupId
                      ? () => onTestImageConfig(key, draft, cardResourceGroupId)
                      : undefined
                  }
                  onTestJsonResponseFormat={
                    purpose === "text" && onTestJsonResponseFormatConfig
                      ? () => onTestJsonResponseFormatConfig(key, draft)
                      : undefined
                  }
                  testing={Boolean(testRecord?.testing)}
                  testResult={testRecord?.result ?? null}
                  testError={testRecord?.error ?? ""}
                  imageTesting={Boolean(imageTestRecord?.testing)}
                  imageTestResult={imageTestRecord?.result ?? null}
                  imageTestError={imageTestRecord?.error ?? ""}
                  jsonResponseFormatTesting={Boolean(jsonResponseFormatTestRecord?.testing)}
                  jsonResponseFormatTestResult={jsonResponseFormatTestRecord?.result ?? null}
                  jsonResponseFormatTestError={jsonResponseFormatTestRecord?.error ?? ""}
                  workspaceSubpage={workspaceSubpage}
                />
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed pf-hairline-strong bg-white px-6 py-10 text-center text-sm font-medium text-slate-500 shadow-sm shadow-slate-200/60 dark:border-slate-700 dark:bg-[#0f1726] dark:text-slate-400 dark:shadow-black/25">
            {t(failedOnly ? "settings.generation.failedOnlyEmpty" : "settings.generation.searchEmpty")}
          </div>
        )}
        <GenerationConfigBatchTestDialog
          open={batchDialogOpen}
          purpose={purpose}
          resourceGroupName={activeResourceGroupName}
          items={batchItems}
          selectedIds={batchSelectedIds.filter((id) =>
            batchItems.some((item) => item.config.id === id && !item.disabled),
          )}
          concurrency={batchConcurrency}
          busy={batchRunning}
          workspaceSubpage={workspaceSubpage}
          onSelectedIdsChange={setBatchSelectedIds}
          onConcurrencyChange={setBatchConcurrency}
          onClose={() => {
            if (!batchRunning) {
              setBatchDialogOpen(false);
            }
          }}
          onRun={() => {
            void runBatchTests();
          }}
        />
        <GenerationConfigCreateDialog
          open={createDialogOpen}
          title={t("settings.generation.newConfig")}
          draft={newDraft}
          resourceGroups={resourceGroups}
          profiles={providerProfilesForGenerationConfig(profiles, newDraft, newDraft.provider_profile_id)}
          pending={pending}
          canWrite={canWrite}
          testing={Boolean(newDraftTestRecord?.testing)}
          testResult={newDraftTestRecord?.result ?? null}
          testError={newDraftTestRecord?.error ?? ""}
          imageTesting={Boolean(newDraftImageTestRecord?.testing)}
          imageTestResult={newDraftImageTestRecord?.result ?? null}
          imageTestError={newDraftImageTestRecord?.error ?? ""}
          jsonResponseFormatTesting={Boolean(newDraftJsonResponseFormatTestRecord?.testing)}
          jsonResponseFormatTestResult={newDraftJsonResponseFormatTestRecord?.result ?? null}
          jsonResponseFormatTestError={newDraftJsonResponseFormatTestRecord?.error ?? ""}
          workspaceSubpage={workspaceSubpage}
          onChange={(next) => {
            onChange(newDraftKey, next);
          }}
          onSave={() => {
            onSave(newDraft, {
              onSuccess: (generationConfig) => {
                const savedResourceGroupIds = generationConfigResourceGroupIds(generationConfig);
                const savedResourceGroupId = savedResourceGroupIds.includes(activeResourceGroupId)
                  ? activeResourceGroupId
                  : savedResourceGroupIds[0] ?? "";
                onSelectedResourceGroupIdChange(savedResourceGroupId);
                setConfigSearch("");
                setCreateDialogOpen(false);
                resetNewDraft();
              },
            });
          }}
          onClose={() => {
            if (pending) {
              return;
            }
            setCreateDialogOpen(false);
            resetNewDraft();
          }}
          onTest={purpose === "text" && onTestTextConfig ? () => onTestTextConfig(newDraftKey, newDraft) : undefined}
          onImageTest={
            purpose === "image" && onTestImageConfig && newDraftResourceGroupId
              ? () => onTestImageConfig(newDraftKey, newDraft, newDraftResourceGroupId)
              : undefined
          }
          onTestJsonResponseFormat={
            purpose === "text" && onTestJsonResponseFormatConfig
              ? () => onTestJsonResponseFormatConfig(newDraftKey, newDraft)
              : undefined
          }
        />
      </div>
    </section>
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
  onUnfreeze?: () => void;
  onTest?: () => void;
  onImageTest?: () => void;
  onTestJsonResponseFormat?: () => void;
  unfreezing?: boolean;
  testing?: boolean;
  testResult?: TextGenerationConfigTestResponse | null;
  testError?: string;
  imageTesting?: boolean;
  imageTestResult?: ImageGenerationConfigTestResponse | null;
  imageTestError?: string;
  jsonResponseFormatTesting?: boolean;
  jsonResponseFormatTestResult?: TextGenerationConfigJsonResponseFormatTestResponse | null;
  jsonResponseFormatTestError?: string;
  workspaceSubpage?: boolean;
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
  onUnfreeze,
  onTest,
  onImageTest,
  onTestJsonResponseFormat,
  unfreezing = false,
  testing = false,
  testResult = null,
  testError = "",
  imageTesting = false,
  imageTestResult = null,
  imageTestError = "",
  jsonResponseFormatTesting = false,
  jsonResponseFormatTestResult = null,
  jsonResponseFormatTestError = "",
  workspaceSubpage = false,
}: GenerationConfigCardProps) {
  const { t } = useI18n();
  const { SETTINGS_COMPACT_ACTION_CLASS, SETTINGS_DANGER_ICON_ACTION_CLASS, SETTINGS_MAIN_ACTION_CLASS } =
    useSettingsActionClassNames();
  const [providerProfileSearch, setProviderProfileSearch] = useState("");
  const isNew = !config;
  const providerKindOptions =
    draft.purpose === "text"
      ? [
          { value: "mock", label: t("settings.provider.interface.mock") },
          { value: "openai", label: t("settings.provider.interface.openaiResponses") },
          { value: "openai_chat_completions", label: t("settings.provider.interface.openaiChatCompletions") },
        ]
      : [
          { value: "mock", label: t("settings.provider.interface.mock") },
          { value: "openai_responses", label: t("settings.provider.interface.openaiResponses") },
          { value: "openai_images", label: t("settings.provider.interface.openaiImages") },
          { value: "openai_chat_image", label: t("settings.provider.interface.openaiChatImage") },
          { value: "google_gemini_image", label: t("settings.provider.interface.googleGeminiImage") },
        ];
  const activeFrozen = isActiveFrozenUntil(config?.state?.frozen_until);
  const busy = pending || unfreezing;
  const controlsDisabled = busy || !canWrite;
  const filteredProfiles = filterProviderProfilesByName(profiles, providerProfileSearch);
  const selectedProfile = profiles.find((profile) => profile.id === draft.provider_profile_id);
  const selectableProfiles =
    selectedProfile && !filteredProfiles.some((profile) => profile.id === selectedProfile.id)
      ? [selectedProfile, ...filteredProfiles]
      : filteredProfiles;
  const testStatus = testing || testResult || testError ? (
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
  ) : null;
  const testResultPreview = testResult ? (
    <div className="space-y-3">
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
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-[#0b1220]">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            {t("settings.generation.testBriefRequestContext")}
          </div>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-slate-700 dark:text-slate-200">
            {`${t("settings.generation.testSystemInstructions")}\n${testResult.request_context.brief.system_instructions}\n\n${t("settings.generation.testUserContent")}\n${testResult.request_context.brief.user_content}`}
          </pre>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-[#0b1220]">
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            {t("settings.generation.testCopyRequestContext")}
          </div>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-slate-700 dark:text-slate-200">
            {`${t("settings.generation.testSystemInstructions")}\n${testResult.request_context.copy.system_instructions}\n\n${t("settings.generation.testReferenceText")}\n${testResult.request_context.reference_text}\n\n${t("settings.generation.testUserContent")}\n${testResult.request_context.copy.user_content}`}
          </pre>
        </div>
      </div>
    </div>
  ) : null;
  const imageTestStatus = imageTesting || imageTestResult || imageTestError ? (
    <div
      className={`flex items-start gap-3 rounded-lg border px-3 py-3 text-sm ${
        imageTestError
          ? "border-red-200 bg-red-50 text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200"
          : imageTestResult
            ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/35 dark:bg-emerald-500/12 dark:text-emerald-100"
            : "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-violet-400/35 dark:bg-violet-500/12 dark:text-violet-100"
      }`}
    >
      {imageTestError ? (
        <X size={16} className="mt-0.5 shrink-0" />
      ) : imageTestResult ? (
        <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
      ) : (
        <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin" />
      )}
      <div className="min-w-0">
        <div className="font-semibold">
          {imageTestError
            ? t("settings.generation.imageTestFailed")
            : imageTestResult
              ? t("settings.generation.imageTestPassed")
              : t("settings.generation.imageTestRunning")}
        </div>
        <div className="mt-0.5 break-words text-xs opacity-80">
          {imageTestError ||
            (imageTestResult
              ? t("settings.generation.imageTestPassedDetail", {
                  duration: String(Math.max(1, Math.round(imageTestResult.duration_ms))),
                  model: imageTestResult.model_name,
                })
              : t("settings.generation.imageTestRunningDetail"))}
        </div>
      </div>
    </div>
  ) : null;
  const jsonResponseFormatTestStatus =
    jsonResponseFormatTesting || jsonResponseFormatTestResult || jsonResponseFormatTestError ? (
      <div
        className={`flex items-start gap-3 rounded-lg border px-3 py-3 text-sm ${
          jsonResponseFormatTestError
            ? "border-red-200 bg-red-50 text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200"
            : jsonResponseFormatTestResult
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/35 dark:bg-emerald-500/12 dark:text-emerald-100"
              : "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-violet-400/35 dark:bg-violet-500/12 dark:text-violet-100"
        }`}
      >
        {jsonResponseFormatTestError ? (
          <X size={16} className="mt-0.5 shrink-0" />
        ) : jsonResponseFormatTestResult ? (
          <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
        ) : (
          <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin" />
        )}
        <div className="min-w-0">
          <div className="font-semibold">
            {jsonResponseFormatTestError
              ? t("settings.generation.jsonResponseFormatTestFailed")
              : jsonResponseFormatTestResult
                ? t("settings.generation.jsonResponseFormatTestPassed")
                : t("settings.generation.jsonResponseFormatTestRunning")}
          </div>
          <div className="mt-0.5 break-words text-xs opacity-80">
            {jsonResponseFormatTestError ||
              (jsonResponseFormatTestResult
                ? t("settings.generation.jsonResponseFormatTestPassedDetail", {
                    duration: String(Math.max(1, Math.round(jsonResponseFormatTestResult.duration_ms))),
                    model: jsonResponseFormatTestResult.model,
                  })
                : t("settings.generation.jsonResponseFormatTestRunningDetail", {
                    interfaceName: t(textStructuredOutputProviderInterfaceLabelKey(draft.provider_kind)),
                  }))}
          </div>
        </div>
      </div>
    ) : null;
  const jsonResponseFormatTestResultPreview = jsonResponseFormatTestResult ? (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-[#0b1220]">
      <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
        {t("settings.generation.jsonResponseFormatTestResult", { model: jsonResponseFormatTestResult.model })}
      </div>
      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-slate-700 dark:text-slate-200">
        {JSON.stringify(jsonResponseFormatTestResult.parsed_json, null, 2)}
      </pre>
    </div>
  ) : null;
  const latestTestResult = config?.latest_test_result ?? null;
  const latestTestDetail = latestTestResult ? generationConfigLatestTestDetail(latestTestResult, t) : "";
  const effectiveDisabled = Boolean(config && !config.effective_enabled);

  return (
    <div className={`${SETTINGS_FIELD_CARD_CLASS} relative rounded-2xl border pf-hairline bg-white/80 p-6 shadow-none backdrop-blur-sm dark:border-slate-700/55 dark:bg-[#0f1726]/80 ${onArchive ? "pr-16" : ""}`}>
      {onArchive ? (
        <button
          type="button"
          onClick={onArchive}
          disabled={controlsDisabled}
          className={`absolute right-5 top-5 ${SETTINGS_DANGER_ICON_ACTION_CLASS}`}
          aria-label={t("settings.generation.archive")}
          title={t("settings.generation.archive")}
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
        </button>
      ) : null}
      <div className="space-y-5">
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
            {config ? (
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                  config.effective_enabled
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/12 dark:text-emerald-200"
                    : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/35 dark:bg-amber-500/12 dark:text-amber-200"
                }`}
              >
                {config.effective_enabled
                  ? t("settings.generation.effectiveEnabled")
                  : t("settings.generation.effectiveDisabled")}
              </span>
            ) : null}
            {activeFrozen ? (
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
          {latestTestResult ? (
            <div
              className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
                latestTestResult.status === "failed"
                  ? "border-red-200 bg-red-50 text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200"
                  : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/35 dark:bg-emerald-500/12 dark:text-emerald-100"
              }`}
            >
              {latestTestResult.status === "failed" ? (
                <X size={14} className="mt-0.5 shrink-0" />
              ) : (
                <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
              )}
              <div className="min-w-0">
                <div className="font-semibold">
                  {[
                    t("settings.generation.latestTest"),
                    t(generationConfigLatestTestTypeLabelKey(latestTestResult.test_type)),
                    t(
                      latestTestResult.status === "failed"
                        ? "settings.generation.latestTestFailed"
                        : "settings.generation.latestTestPassed",
                    ),
                    formatDateTime(latestTestResult.tested_at),
                  ].join(" · ")}
                </div>
                {latestTestDetail ? (
                  <div className="mt-0.5 break-words opacity-80">{latestTestDetail}</div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <SettingsFormField label={t("settings.generation.nameLabel")}>
          {workspaceSubpage ? (
            <WorkspaceTextInput
              value={draft.name}
              onChange={(event) => onChange({ ...draft, name: event.target.value })}
              disabled={controlsDisabled}
              size="tall"
              placeholder={t("settings.generation.namePlaceholder")}
            />
          ) : (
            <ClassicTextInput
              value={draft.name}
              onChange={(event) => onChange({ ...draft, name: event.target.value })}
              disabled={controlsDisabled}
              size="tall"
              placeholder={t("settings.generation.namePlaceholder")}
            />
          )}
        </SettingsFormField>
        <SettingsFormField label={t("settings.generation.resourceGroups")}>
          <GenerationResourceGroupMultiSelect
            resourceGroups={resourceGroups}
            selectedIds={draft.resource_group_ids}
            disabled={controlsDisabled}
            disabledGroupLabel={t("settings.resourceGroup.disabled")}
            noGroupsLabel={t("settings.generation.noResourceGroups")}
            noSelectionLabel={t("settings.generation.noSelectedResourceGroups")}
            selectedCountLabel={(count) => t("settings.generation.selectedResourceGroupsCount", { count })}
            ariaLabel={t("settings.generation.resourceGroups")}
            workspaceSubpage={workspaceSubpage}
            onChange={(resource_group_ids) => onChange({ ...draft, resource_group_ids })}
          />
        </SettingsFormField>
        <SettingsFormField label={t("settings.provider.apiInterfaceLabel")} helpKey="settingsProviderApiInterface">
          {workspaceSubpage ? (
            <WorkspaceSelectField
              value={draft.provider_kind}
              options={providerKindOptions}
              onChange={(value) => {
                const provider_kind = normalizedGenerationConfigProviderKind(draft.purpose, value);
                onChange({
                  ...draft,
                  provider_kind,
                  provider_profile_id: providerProfileIdAfterKindChange(profiles, draft, provider_kind),
                });
              }}
              disabled={controlsDisabled}
              size="tall"
            />
          ) : (
            <ClassicSelectField
              value={draft.provider_kind}
              options={providerKindOptions}
              onChange={(value) => {
                const provider_kind = normalizedGenerationConfigProviderKind(draft.purpose, value);
                onChange({
                  ...draft,
                  provider_kind,
                  provider_profile_id: providerProfileIdAfterKindChange(profiles, draft, provider_kind),
                });
              }}
              disabled={controlsDisabled}
              size="tall"
            />
          )}
        </SettingsFormField>
      </div>

      {draft.provider_kind !== "mock" ? (
        <SettingsFormField label={t("settings.provider.providerProfileLabel")} helpKey="settingsProviderProfile">
          {workspaceSubpage ? (
            <WorkspaceSelectField
              value={draft.provider_profile_id}
              options={[
                { value: "", label: t("settings.provider.selectProfile") },
                ...selectableProfiles.map((profile) => ({ value: profile.id, label: profile.name })),
              ]}
              onChange={(value) => {
                onChange(
                  generationConfigDraftAfterProviderProfileSelection(draft, profiles, value, {
                    isNew,
                  }),
                );
                setProviderProfileSearch("");
              }}
              searchValue={providerProfileSearch}
              onSearchChange={setProviderProfileSearch}
              searchPlaceholder={t("settings.provider.profileSearchPlaceholder")}
              searchAriaLabel={t("settings.provider.profileSearch")}
              disabled={controlsDisabled}
              size="tall"
            />
          ) : (
            <ClassicSelectField
              value={draft.provider_profile_id}
              options={[
                { value: "", label: t("settings.provider.selectProfile") },
                ...selectableProfiles.map((profile) => ({ value: profile.id, label: profile.name })),
              ]}
              onChange={(value) => {
                onChange(
                  generationConfigDraftAfterProviderProfileSelection(draft, profiles, value, {
                    isNew,
                  }),
                );
                setProviderProfileSearch("");
              }}
              searchValue={providerProfileSearch}
              onSearchChange={setProviderProfileSearch}
              searchPlaceholder={t("settings.provider.profileSearchPlaceholder")}
              searchAriaLabel={t("settings.provider.profileSearch")}
              disabled={controlsDisabled}
              size="tall"
            />
          )}
        </SettingsFormField>
      ) : null}

      {draft.purpose === "text" ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <ProviderModelInput
              idPrefix={`text-brief-model-${config?.id ?? "new"}`}
              label={t("settings.provider.textBriefModelLabel")}
              value={draft.brief_model}
              placeholder={t("settings.provider.textBriefModelPlaceholder")}
              providerKind={
                draft.provider_kind === "openai" || draft.provider_kind === "openai_chat_completions"
                  ? draft.provider_kind
                  : "mock"
              }
              providerProfileId={draft.provider_profile_id}
              disabled={controlsDisabled}
              helpKey="settingsTextBriefModel"
              workspaceSubpage={workspaceSubpage}
              onChange={(brief_model) => onChange({ ...draft, brief_model })}
            />
            <ProviderModelInput
              idPrefix={`text-copy-model-${config?.id ?? "new"}`}
              label={t("settings.provider.textCopyModelLabel")}
              value={draft.copy_model}
              placeholder={t("settings.provider.textCopyModelPlaceholder")}
              providerKind={
                draft.provider_kind === "openai" || draft.provider_kind === "openai_chat_completions"
                  ? draft.provider_kind
                  : "mock"
              }
              providerProfileId={draft.provider_profile_id}
              disabled={controlsDisabled}
              helpKey="settingsTextCopyModel"
              workspaceSubpage={workspaceSubpage}
              onChange={(copy_model) => onChange({ ...draft, copy_model })}
            />
            </div>
          {isTextStructuredOutputProviderKind(draft.provider_kind) ? (
            <div className="grid gap-3 sm:max-w-2xl sm:grid-cols-[minmax(0,1fr)_minmax(13rem,18rem)] sm:items-end">
              <SettingsOptionToggle
                checked={draft.structured_output_enabled}
                disabled={controlsDisabled}
                workspaceSubpage={workspaceSubpage}
                onChange={(structured_output_enabled) =>
                  onChange({
                    ...draft,
                    structured_output_enabled,
                    structured_json_response_format_enabled: structured_output_enabled,
                    structured_output_mode: structured_output_enabled
                      ? draft.structured_output_mode || "json_schema"
                      : draft.structured_output_mode,
                  })
                }
              >
                {t("settings.provider.structuredOutput")}
              </SettingsOptionToggle>
              <SettingsFormField label={t("settings.provider.structuredOutputMode")}>
                {workspaceSubpage ? (
                  <WorkspaceSelectField
                    value={draft.structured_output_mode}
                    options={[
                      { value: "json_schema", label: t("settings.provider.structuredOutputJsonSchema") },
                      { value: "json_object", label: t("settings.provider.structuredOutputJsonObject") },
                    ]}
                    onChange={(value) =>
                      onChange({
                        ...draft,
                        structured_output_mode: value === "json_object" ? "json_object" : "json_schema",
                      })
                    }
                    disabled={controlsDisabled || !draft.structured_output_enabled}
                    size="tall"
                  />
                ) : (
                  <ClassicSelectField
                    value={draft.structured_output_mode}
                    options={[
                      { value: "json_schema", label: t("settings.provider.structuredOutputJsonSchema") },
                      { value: "json_object", label: t("settings.provider.structuredOutputJsonObject") },
                    ]}
                    onChange={(value) =>
                      onChange({
                        ...draft,
                        structured_output_mode: value === "json_object" ? "json_object" : "json_schema",
                      })
                    }
                    disabled={controlsDisabled || !draft.structured_output_enabled}
                    size="tall"
                  />
                )}
              </SettingsFormField>
            </div>
          ) : null}
        </div>
      ) : (
        <GenerationConfigImageFields
          draft={draft}
          pending={controlsDisabled}
          onChange={onChange}
          configId={config?.id ?? "new"}
          workspaceSubpage={workspaceSubpage}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <SettingsFormField label={t("settings.generation.priority")} helpKey="settingsGenerationPriority">
          {workspaceSubpage ? (
            <WorkspaceTextInput
              value={draft.priority}
              disabled={controlsDisabled}
              onChange={(event) => onChange({ ...draft, priority: event.target.value })}
              size="tall"
              type="number"
            />
          ) : (
            <ClassicTextInput
              value={draft.priority}
              disabled={controlsDisabled}
              onChange={(event) => onChange({ ...draft, priority: event.target.value })}
              size="tall"
              type="number"
            />
          )}
        </SettingsFormField>
        <SettingsFormField label={t("settings.generation.maxConcurrency")} helpKey="settingsGenerationMaxConcurrency">
          {workspaceSubpage ? (
            <WorkspaceTextInput
              value={draft.max_concurrency}
              disabled={controlsDisabled}
              onChange={(event) => onChange({ ...draft, max_concurrency: event.target.value })}
              size="tall"
              type="number"
              min={1}
            />
          ) : (
            <ClassicTextInput
              value={draft.max_concurrency}
              disabled={controlsDisabled}
              onChange={(event) => onChange({ ...draft, max_concurrency: event.target.value })}
              size="tall"
              type="number"
              min={1}
            />
          )}
        </SettingsFormField>
        <SettingsFormField label={t("settings.generation.availabilityWindow")} helpKey="settingsGenerationAvailabilityWindow">
          {workspaceSubpage ? (
            <WorkspaceTextInput
              value={draft.availability_window_minutes}
              disabled={controlsDisabled}
              onChange={(event) => onChange({ ...draft, availability_window_minutes: event.target.value })}
              size="tall"
              type="number"
              min={1}
              placeholder={t("settings.generation.runtimeDefault")}
            />
          ) : (
            <ClassicTextInput
              value={draft.availability_window_minutes}
              disabled={controlsDisabled}
              onChange={(event) => onChange({ ...draft, availability_window_minutes: event.target.value })}
              size="tall"
              type="number"
              min={1}
              placeholder={t("settings.generation.runtimeDefault")}
            />
          )}
        </SettingsFormField>
        <SettingsFormField label={t("settings.generation.failureThreshold")} helpKey="settingsGenerationFailureThreshold">
          {workspaceSubpage ? (
            <WorkspaceTextInput
              value={draft.failure_threshold}
              disabled={controlsDisabled}
              onChange={(event) => onChange({ ...draft, failure_threshold: event.target.value })}
              size="tall"
              type="number"
              min={1}
              placeholder={t("settings.generation.runtimeDefault")}
            />
          ) : (
            <ClassicTextInput
              value={draft.failure_threshold}
              disabled={controlsDisabled}
              onChange={(event) => onChange({ ...draft, failure_threshold: event.target.value })}
              size="tall"
              type="number"
              min={1}
              placeholder={t("settings.generation.runtimeDefault")}
            />
          )}
        </SettingsFormField>
        <SettingsFormField label={t("settings.generation.cooldownMinutes")} helpKey="settingsGenerationCooldownMinutes">
          {workspaceSubpage ? (
            <WorkspaceTextInput
              value={draft.cooldown_minutes}
              disabled={controlsDisabled}
              onChange={(event) => onChange({ ...draft, cooldown_minutes: event.target.value })}
              size="tall"
              type="number"
              min={1}
              placeholder={t("settings.generation.runtimeDefault")}
            />
          ) : (
            <ClassicTextInput
              value={draft.cooldown_minutes}
              disabled={controlsDisabled}
              onChange={(event) => onChange({ ...draft, cooldown_minutes: event.target.value })}
              size="tall"
              type="number"
              min={1}
              placeholder={t("settings.generation.runtimeDefault")}
            />
          )}
        </SettingsFormField>
      </div>

      <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="w-full sm:max-w-xs">
          <SettingsSwitchToggle
            checked={draft.enabled}
            disabled={controlsDisabled}
            workspaceSubpage={workspaceSubpage}
            onChange={(enabled) => onChange({ ...draft, enabled })}
          >
            {t("settings.generation.enabled")}
          </SettingsSwitchToggle>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {onTestJsonResponseFormat && draft.purpose === "text" && isTextStructuredOutputProviderKind(draft.provider_kind) ? (
            <button
              type="button"
              onClick={onTestJsonResponseFormat}
              disabled={
                controlsDisabled ||
                jsonResponseFormatTesting ||
                effectiveDisabled ||
                !draft.structured_output_enabled ||
                !draft.name.trim() ||
                !draft.provider_profile_id
              }
              className={SETTINGS_COMPACT_ACTION_CLASS}
            >
              {jsonResponseFormatTesting ? (
                <Loader2 size={14} className="mr-1.5 animate-spin" />
              ) : (
                <FileJson size={14} className="mr-1.5" />
              )}
              {t("settings.generation.testStructuredOutput")}
            </button>
          ) : null}
          {onTest ? (
            <button
              type="button"
              onClick={onTest}
              disabled={
                controlsDisabled ||
                testing ||
                effectiveDisabled ||
                !draft.name.trim() ||
                (draft.provider_kind !== "mock" && !draft.provider_profile_id)
              }
              className={SETTINGS_COMPACT_ACTION_CLASS}
            >
              {testing ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <MessageSquareText size={14} className="mr-1.5" />}
              {t("settings.generation.test")}
            </button>
          ) : null}
          {onImageTest ? (
            <button
              type="button"
              onClick={onImageTest}
              disabled={
                controlsDisabled ||
                imageTesting ||
                effectiveDisabled ||
                !draft.name.trim() ||
                !draft.model.trim() ||
                (draft.provider_kind !== "mock" && !draft.provider_profile_id)
              }
              className={SETTINGS_COMPACT_ACTION_CLASS}
            >
              {imageTesting ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Image size={14} className="mr-1.5" />}
              {t("settings.generation.test")}
            </button>
          ) : null}
          {activeFrozen && onUnfreeze ? (
            <button
              type="button"
              onClick={onUnfreeze}
              disabled={controlsDisabled}
              className={SETTINGS_COMPACT_ACTION_CLASS}
            >
              {unfreezing ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <RotateCcw size={14} className="mr-1.5" />}
              {t("settings.generation.unfreeze")}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onSave}
            disabled={
              controlsDisabled ||
              !draft.name.trim() ||
              (draft.provider_kind !== "mock" && !draft.provider_profile_id)
            }
            className={SETTINGS_MAIN_ACTION_CLASS}
          >
            {busy ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Save size={14} className="mr-1.5" />}
            {isNew ? t("settings.generation.create") : t("settings.generation.save")}
          </button>
        </div>
      </div>
      {testStatus ||
      testResultPreview ||
      imageTestStatus ||
      jsonResponseFormatTestStatus ||
      jsonResponseFormatTestResultPreview ? (
        <div className="space-y-3 pt-1">
          {jsonResponseFormatTestStatus}
          {jsonResponseFormatTestResultPreview}
          {imageTestStatus}
          {testStatus}
          {testResultPreview}
        </div>
      ) : null}
    </div>
  );
}
