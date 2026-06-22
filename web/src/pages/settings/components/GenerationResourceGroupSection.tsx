// 生成资源分组的设置区块：列表区 + 分组卡片 + 新建弹窗。

import { useId, useState } from "react";

import { Loader2, Plus, Save, Trash2, X } from "lucide-react";

import { ModalShell } from "../../../components/ModalShell";
import { useI18n } from "../../../lib/preferences";
import type { GenerationConfig, GenerationResourceGroup } from "../../../lib/types";
import { settingsGenerationResourceGroupsInApiOrder } from "../providerForm";
import {
  emptyGenerationResourceGroupDraft,
  generationConfigCountsForResourceGroup,
  generationResourceGroupDraft,
  generationResourceGroupDraftKey,
  type GenerationResourceGroupDraft,
} from "../resourceGroups";
import { SettingsFormField } from "./SettingsFormField";
import {
  INPUT_CLASS,
  PANEL_CLASS,
  SETTINGS_BORDERED_MODULE_CLASS,
  SETTINGS_DANGER_ICON_ACTION_CLASS,
  SETTINGS_FIELD_CARD_CLASS,
  SETTINGS_ICON_ACTION_CLASS,
  SETTINGS_MAIN_ACTION_CLASS,
  TEXTAREA_CLASS,
} from "./styles";
import { SettingsOptionToggle, SettingsSwitchToggle } from "./Toggles";

function generationResourceGroupStatusClassName(group: GenerationResourceGroupDraft): string {
  if (group.enabled) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/12 dark:text-emerald-200";
  }
  return "pf-hairline pf-surface-soft pf-ink-muted";
}

interface GenerationResourceGroupSaveOptions {
  onSuccess?: () => void;
}

interface GenerationResourceGroupSectionProps {
  groups: GenerationResourceGroup[];
  generationConfigs: GenerationConfig[];
  drafts: Record<string, GenerationResourceGroupDraft>;
  pending: boolean;
  archivingGroupId: string | null;
  canWrite: boolean;
  onChange: (key: string, next: GenerationResourceGroupDraft) => void;
  onSave: (draft: GenerationResourceGroupDraft, options?: GenerationResourceGroupSaveOptions) => void;
  onArchive: (groupId: string) => void;
}

export function GenerationResourceGroupSection({
  groups,
  generationConfigs,
  drafts,
  pending,
  archivingGroupId,
  canWrite,
  onChange,
  onSave,
  onArchive,
}: GenerationResourceGroupSectionProps) {
  const { t } = useI18n();
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const activeGroups = settingsGenerationResourceGroupsInApiOrder(groups);
  const activeGenerationConfigs = generationConfigs.filter((config) => !config.archived_at);
  const newDraftKey = "new-generation-resource-group";
  const newDraft = drafts[newDraftKey] ?? emptyGenerationResourceGroupDraft();
  const cards = activeGroups.map((group) => ({
    key: group.id,
    group,
    draft: drafts[group.id] ?? generationResourceGroupDraft(group),
    counts: generationConfigCountsForResourceGroup(activeGenerationConfigs, group.id),
  }));
  const resetNewDraft = () => onChange(newDraftKey, emptyGenerationResourceGroupDraft());

  return (
    <section className={`${PANEL_CLASS} ${SETTINGS_BORDERED_MODULE_CLASS} space-y-4`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold pf-ink">
            {t("settings.resourceGroup.title")}
          </h2>
          <p className="mt-1 text-sm leading-6 pf-ink-muted">
            {t("settings.resourceGroup.description")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreateDialogOpen(true)}
          disabled={!canWrite}
          className={SETTINGS_MAIN_ACTION_CLASS}
        >
          <Plus size={14} className="mr-2" />
          {t("settings.resourceGroup.newGroup")}
        </button>
      </div>
      <div className="grid gap-4">
        {cards.map(({ key, group, draft, counts }) => (
          <GenerationResourceGroupCard
            key={key}
            group={group}
            draft={draft}
            counts={counts}
            pending={pending || archivingGroupId === group?.id}
            canWrite={canWrite}
            onChange={(next) => onChange(generationResourceGroupDraftKey(next), next)}
            onSave={() => onSave(draft)}
            onArchive={group ? () => onArchive(group.id) : undefined}
          />
        ))}
      </div>
      <GenerationResourceGroupCreateDialog
        open={createDialogOpen}
        draft={newDraft}
        pending={pending}
        canWrite={canWrite}
        onChange={(next) => onChange(newDraftKey, next)}
        onSave={() => {
          onSave(newDraft, {
            onSuccess: () => {
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
      />
    </section>
  );
}

interface GenerationResourceGroupCreateDialogProps {
  open: boolean;
  draft: GenerationResourceGroupDraft;
  pending: boolean;
  canWrite: boolean;
  onChange: (next: GenerationResourceGroupDraft) => void;
  onSave: () => void;
  onClose: () => void;
}

function GenerationResourceGroupCreateDialog({
  open,
  draft,
  pending,
  canWrite,
  onChange,
  onSave,
  onClose,
}: GenerationResourceGroupCreateDialogProps) {
  const { t } = useI18n();
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
      panelClassName="flex max-h-[calc(100dvh-3rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border pf-hairline pf-surface shadow-2xl shadow-slate-950/20 dark:shadow-black/45"
    >
        <div className="flex h-16 shrink-0 items-center justify-between gap-3 border-b pf-hairline px-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="text-indigo-600 dark:text-violet-300">
              <Plus size={18} />
            </span>
            <h2 id={titleId} className="truncate text-lg font-semibold pf-ink">
              {t("settings.resourceGroup.newGroup")}
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
          <GenerationResourceGroupCard
            group={null}
            draft={draft}
            counts={{ text: 0, image: 0 }}
            pending={pending}
            canWrite={canWrite}
            onChange={onChange}
            onSave={onSave}
          />
        </div>
    </ModalShell>
  );
}

interface GenerationResourceGroupCardProps {
  group: GenerationResourceGroup | null;
  draft: GenerationResourceGroupDraft;
  counts: { text: number; image: number };
  pending: boolean;
  canWrite: boolean;
  onChange: (next: GenerationResourceGroupDraft) => void;
  onSave: () => void;
  onArchive?: () => void;
}

function GenerationResourceGroupCard({
  group,
  draft,
  counts,
  pending,
  canWrite,
  onChange,
  onSave,
  onArchive,
}: GenerationResourceGroupCardProps) {
  const { t } = useI18n();
  const isNew = !group;

  return (
    <div className={`${SETTINGS_FIELD_CARD_CLASS} relative rounded-2xl border pf-hairline bg-white/80 p-4 shadow-none backdrop-blur-sm dark:border-slate-700/55 dark:bg-[#0b1220]/80 ${onArchive ? "pr-14" : ""}`}>
      {onArchive ? (
        <button
          type="button"
          onClick={onArchive}
          disabled={!canWrite || pending}
          className={`absolute right-4 top-4 ${SETTINGS_DANGER_ICON_ACTION_CLASS}`}
          aria-label={t("settings.resourceGroup.archive")}
          title={t("settings.resourceGroup.archive")}
        >
          {pending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
        </button>
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold pf-ink">
              {isNew ? t("settings.resourceGroup.newGroup") : group.name}
            </h3>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${generationResourceGroupStatusClassName(draft)}`}>
              {draft.enabled ? t("settings.resourceGroup.enabled") : t("settings.resourceGroup.disabled")}
            </span>
          </div>
          <p className="mt-1 font-mono text-xs pf-ink-muted">
            {draft.key || t("settings.resourceGroup.keyPlaceholder")}
          </p>
          {!isNew ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="rounded-full border pf-hairline pf-surface-soft px-2 py-0.5 text-[11px] font-medium pf-ink-muted">
                {t("settings.resourceGroup.textConfigCount", { count: counts.text })}
              </span>
              <span className="rounded-full border pf-hairline pf-surface-soft px-2 py-0.5 text-[11px] font-medium pf-ink-muted">
                {t("settings.resourceGroup.imageConfigCount", { count: counts.image })}
              </span>
            </div>
          ) : null}
        </div>
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

      <div className="mt-4 flex flex-col gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <SettingsSwitchToggle
            checked={draft.enabled}
            disabled={!canWrite}
            onChange={(enabled) => onChange({ ...draft, enabled })}
          >
            {t("settings.resourceGroup.enabled")}
          </SettingsSwitchToggle>
          <SettingsOptionToggle
            checked={draft.blur_images_by_default}
            disabled={!canWrite}
            onChange={(blur_images_by_default) => onChange({ ...draft, blur_images_by_default })}
          >
            {t("settings.resourceGroup.blurImagesByDefault")}
          </SettingsOptionToggle>
        </div>
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
