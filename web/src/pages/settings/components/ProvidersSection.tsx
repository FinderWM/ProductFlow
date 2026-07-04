// 供应商档案区块簇：列表(ProvidersSection) + 档案卡片(Card) + 创建/编辑抽屉(Drawer)。
// 从 SettingsPage.tsx 整簇抽出，行为不变。仅 ProvidersSection 对外导出。

import { useId, useState } from "react";

import { Box, KeyRound, Link2, Loader2, Pencil, Plus, Save, Search, ServerCog, Trash2, X } from "lucide-react";

import { ClassicSelectField, ClassicTextInput } from "../../../components/classicInputs";
import { ModalShell } from "../../../components/ModalShell";
import { ParameterHelpLabel } from "../../../components/ParameterHelp";
import { WorkspaceSelectField, WorkspaceTextInput } from "../../../components/workspaceInputs";
import {
  IMAGE_GENERATION_DIMENSION_MULTIPLE,
  IMAGE_GENERATION_MAX_MAX_DIMENSION,
  IMAGE_GENERATION_MIN_MAX_DIMENSION,
} from "../../../lib/imageSizes";
import { useI18n } from "../../../lib/preferences";
import type { ProviderCapability, ProviderProfile, ProviderType } from "../../../lib/types";
import {
  PROVIDER_IMAGE_MAX_DIMENSION_CUSTOM_OPTION,
  PROVIDER_IMAGE_MAX_DIMENSION_GLOBAL_OPTION,
  PROVIDER_IMAGE_MAX_DIMENSION_PRESETS,
  PROVIDER_CAPABILITY_OPTIONS,
  providerImageMaxDimensionFormInvalid,
  providerImageMaxDimensionSelectValue,
  parseProviderImageMaxDimensionDraft,
  defaultCapabilitiesForProviderType,
  filterProviderProfilesByName,
  providerCapabilityLabelKey,
  providerDefaultEndpointLabelKey,
  providerDisableBlocked,
  providerTypeLabelKey,
  providerUsageFromProfile,
  providerUsageLabelKeys,
  type ProviderProfileFormState,
  type ProviderProfileUsage,
} from "../providerForm";
import {
  ProviderCapabilityToggle,
  ProviderDrawerEnableToggle,
  ProviderDrawerTextInput,
} from "./ProviderDrawerInputs";
import { ProviderEnabledSwitch } from "./ProviderEnabledSwitch";
import { SettingsFormField } from "./SettingsFormField";
import {
  PANEL_CLASS,
  SETTINGS_BORDERED_MODULE_CLASS,
  useSettingsActionClassNames,
} from "./styles";

interface ProvidersSectionProps {
  profiles: ProviderProfile[];
  profileForm: ProviderProfileFormState;
  editingProfileId: string | null;
  drawerOpen: boolean;
  pending: boolean;
  togglingProfileId: string | null;
  canWrite: boolean;
  workspaceSubpage?: boolean;
  onProfileFormChange: (next: ProviderProfileFormState) => void;
  onOpenCreate: () => void;
  onEditProfile: (profile: ProviderProfile) => void;
  onCloseDrawer: () => void;
  onSubmitProfile: () => void;
  onDeleteProfile: (profile: ProviderProfile) => void;
  onToggleProfileEnabled: (profileId: string, enabled: boolean) => void;
}

export function ProvidersSection({
  profiles,
  profileForm,
  editingProfileId,
  drawerOpen,
  pending,
  togglingProfileId,
  canWrite,
  workspaceSubpage = false,
  onProfileFormChange,
  onOpenCreate,
  onEditProfile,
  onCloseDrawer,
  onSubmitProfile,
  onDeleteProfile,
  onToggleProfileEnabled,
}: ProvidersSectionProps) {
  const { t } = useI18n();
  const { SETTINGS_MAIN_ACTION_CLASS } = useSettingsActionClassNames();
  const [profileSearch, setProfileSearch] = useState("");
  const activeProfiles = profiles.filter((profile) => !profile.archived_at);
  const filteredProfiles = filterProviderProfilesByName(activeProfiles, profileSearch);
  const editingProfile = editingProfileId
    ? activeProfiles.find((profile) => profile.id === editingProfileId)
    : undefined;
  const editingProfileUsage = editingProfile ? providerUsageFromProfile(editingProfile) : undefined;
  const editingProfileDisableBlocked =
    editingProfile && editingProfileUsage ? providerDisableBlocked(editingProfile, editingProfileUsage) : false;

  return (
    <section className={`${PANEL_CLASS} ${SETTINGS_BORDERED_MODULE_CLASS}`}>
      <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold pf-ink dark:text-[#fff]">
            {t("settings.provider.listTitle")}
          </h2>
          <p className="mt-1 text-sm leading-6 pf-ink-muted dark:text-[color:var(--pf-muted)]">
            {t("settings.provider.listDescription")}
          </p>
        </div>
        <button type="button" onClick={onOpenCreate} disabled={!canWrite} className={SETTINGS_MAIN_ACTION_CLASS}>
          <Plus size={14} className="mr-2" />
          {t("settings.provider.create")}
        </button>
      </div>

      {activeProfiles.length ? (
        <label className="relative block max-w-md">
          <span className="sr-only">{t("settings.provider.listSearch")}</span>
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 pf-ink-muted dark:text-[color:var(--pf-muted)]"
          />
          {workspaceSubpage ? (
            <WorkspaceTextInput
              type="search"
              value={profileSearch}
              onChange={(event) => setProfileSearch(event.target.value)}
              className="pl-10"
              size="tall"
              placeholder={t("settings.provider.listSearchPlaceholder")}
              aria-label={t("settings.provider.listSearch")}
            />
          ) : (
            <ClassicTextInput
              type="search"
              value={profileSearch}
              onChange={(event) => setProfileSearch(event.target.value)}
              className="pl-10"
              size="tall"
              placeholder={t("settings.provider.listSearchPlaceholder")}
              aria-label={t("settings.provider.listSearch")}
            />
          )}
        </label>
      ) : null}

      {activeProfiles.length ? (
        filteredProfiles.length ? (
          <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">
            {filteredProfiles.map((profile) => {
            const usage = providerUsageFromProfile(profile);
            return (
              <ProviderProfileCard
                key={profile.id}
                profile={profile}
                usage={usage}
                pending={pending}
                toggling={togglingProfileId === profile.id}
                canWrite={canWrite}
                workspaceSubpage={workspaceSubpage}
                onEdit={() => onEditProfile(profile)}
                onDelete={() => onDeleteProfile(profile)}
                onToggleEnabled={(enabled) => onToggleProfileEnabled(profile.id, enabled)}
              />
            );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed pf-hairline-strong pf-surface px-6 py-10 text-center text-sm font-medium pf-ink-muted shadow-sm shadow-slate-200/60 dark:border-[color:var(--pf-border)] dark:bg-[#0f1726] dark:text-[color:var(--pf-muted)] dark:shadow-black/25">
            {t("settings.provider.searchEmpty")}
          </div>
        )
      ) : (
        <div className="flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-dashed pf-hairline-strong pf-surface px-6 text-center shadow-sm shadow-slate-200/60 dark:border-[color:var(--pf-border)] dark:bg-[#0f1726] dark:shadow-black/25">
          <Box size={42} className="pf-ink-muted" />
          <div className="mt-5 text-base font-semibold pf-ink dark:text-[#fff]">
            {t("settings.provider.emptyTitle")}
          </div>
          <p className="mt-3 max-w-sm text-sm leading-6 pf-ink-muted dark:text-[color:var(--pf-muted)]">
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
        apiKeyPreview={editingProfile?.api_key_preview ?? null}
        pending={pending}
        enableToggleBlocked={editingProfileDisableBlocked}
        canWrite={canWrite}
        workspaceSubpage={workspaceSubpage}
        onFormChange={onProfileFormChange}
        onClose={onCloseDrawer}
        onSubmit={onSubmitProfile}
      />
    </div>
    </section>
  );
}

interface ProviderProfileCardProps {
  profile: ProviderProfile;
  usage: ProviderProfileUsage;
  pending: boolean;
  toggling: boolean;
  canWrite: boolean;
  workspaceSubpage?: boolean;
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
  workspaceSubpage = false,
  onEdit,
  onDelete,
  onToggleEnabled,
}: ProviderProfileCardProps) {
  const { t } = useI18n();
  const { SETTINGS_DANGER_ICON_ACTION_CLASS, SETTINGS_ICON_ACTION_CLASS } = useSettingsActionClassNames();
  const usageLabelKeys = providerUsageLabelKeys(usage);
  const disableBlocked = providerDisableBlocked(profile, usage);
  const blockHelpId = `${profile.id}-disable-help`;
  const switchHelp = disableBlocked ? t("settings.provider.disableBlocked") : undefined;

  return (
    <div className="group relative flex flex-col justify-between overflow-hidden rounded-xl border pf-hairline bg-[rgba(255,255,255,0.8)] p-3 shadow-md shadow-slate-200/50 backdrop-blur-sm transition hover:border-indigo-200 hover:shadow-lg dark:border-[color:var(--pf-border)] dark:bg-[#0f1726]/80 dark:shadow-black/20 dark:hover:border-violet-400/45 sm:p-5">
      <button
        type="button"
        onClick={onEdit}
        disabled={!canWrite}
        className="-m-2 block w-full space-y-4 rounded-lg p-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-violet-400"
      >
        <span className="flex items-start justify-between gap-4">
          <span className="min-w-0 pr-16 sm:pr-20">
            <span className="flex flex-wrap items-center gap-2">
              <span className="truncate text-base font-semibold pf-ink dark:text-[#fff]">{profile.name}</span>
              <span
                className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                  profile.enabled
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/12 dark:text-emerald-200"
                    : "pf-hairline pf-surface-soft pf-ink-muted dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)] dark:text-[color:var(--pf-muted)]"
                }`}
              >
                {profile.enabled ? t("settings.provider.enabled") : t("settings.provider.disabled")}
              </span>
            </span>
            <span className="mt-2 flex items-center gap-1.5 overflow-hidden font-mono text-xs pf-ink-muted dark:text-[color:var(--pf-muted)]">
              <ServerCog size={13} className="shrink-0" />
              <span className="truncate">{profile.base_url || t(providerDefaultEndpointLabelKey(profile))}</span>
            </span>
          </span>
        </span>

        <span className="flex flex-col gap-3 sm:grid sm:grid-cols-[max-content_1px_minmax(0,1fr)] sm:items-start">
          <span className="whitespace-nowrap rounded-md bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-700 dark:bg-violet-500/12 dark:text-violet-100">
            {t(providerTypeLabelKey(profile.provider_type))}
          </span>
          <span aria-hidden="true" className="hidden w-px self-stretch bg-[color:var(--pf-border-soft)] dark:bg-[color:var(--pf-border-soft)] sm:block" />
          <span className="flex min-w-0 flex-col items-start gap-1.5">
            {profile.capabilities.map((capability) => (
              <span
                key={`${profile.id}-${capability}`}
                className="max-w-full rounded-md pf-surface-soft px-2 py-1 text-[11px] font-medium pf-ink-muted dark:bg-[color:var(--pf-deep)] dark:text-[color:var(--pf-muted)]"
              >
                {t(providerCapabilityLabelKey(capability))}
              </span>
            ))}
          </span>
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
            <span className="rounded-full border pf-hairline pf-surface-soft px-2.5 py-1 text-[11px] font-medium pf-ink-muted dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)] dark:text-[color:var(--pf-muted)]">
              {t("settings.provider.usageNone")}
            </span>
          )}
        </span>
      </button>

      <div className="absolute right-3 top-3 flex shrink-0 items-center gap-2 sm:right-5 sm:top-5">
        <button
          type="button"
          onClick={onEdit}
          disabled={!canWrite}
          className={SETTINGS_ICON_ACTION_CLASS}
          aria-label={t("settings.provider.editAria")}
          title={t("settings.provider.edit")}
        >
          <Pencil size={14} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={!canWrite || pending}
          className={SETTINGS_DANGER_ICON_ACTION_CLASS}
          aria-label={t("settings.provider.deleteAria")}
          title={t("settings.provider.deleteAria")}
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="mt-4 flex flex-col items-start gap-3 border-t pf-hairline pt-4 dark:border-[color:var(--pf-border)] sm:mt-5 sm:flex-row sm:justify-between">
        <div>
          <div className="text-xs font-semibold pf-ink-muted dark:text-[color:var(--pf-muted)]">
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
            <p className="mt-1 text-xs leading-5 pf-ink-muted dark:text-[color:var(--pf-muted)]">
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
          workspaceSubpage={workspaceSubpage}
          onToggle={onToggleEnabled}
        />
      </div>
    </div>
  );
}

interface ProviderProfileDrawerProps {
  open: boolean;
  form: ProviderProfileFormState;
  editingProfileId: string | null;
  apiKeyPreview: string | null;
  pending: boolean;
  enableToggleBlocked: boolean;
  canWrite: boolean;
  workspaceSubpage?: boolean;
  onFormChange: (next: ProviderProfileFormState) => void;
  onClose: () => void;
  onSubmit: () => void;
}

function ProviderProfileDrawer({
  open,
  form,
  editingProfileId,
  apiKeyPreview,
  pending,
  enableToggleBlocked,
  canWrite,
  workspaceSubpage = false,
  onFormChange,
  onClose,
  onSubmit,
}: ProviderProfileDrawerProps) {
  const { t } = useI18n();
  const { SETTINGS_DRAWER_SUBMIT_ACTION_CLASS, SETTINGS_ICON_ACTION_CLASS } = useSettingsActionClassNames();
  const titleId = useId();
  const imageMaxDimensionDraft = parseProviderImageMaxDimensionDraft(form.image_max_dimension_custom_value);
  const imageMaxDimensionInvalid = providerImageMaxDimensionFormInvalid(form);
  const capabilityOptions = PROVIDER_CAPABILITY_OPTIONS.filter((option) =>
    form.provider_type === "google_gemini"
      ? option.value === "image_google_gemini"
      : option.value !== "image_google_gemini",
  );
  const imageMaxDimensionOptions = [
    { value: PROVIDER_IMAGE_MAX_DIMENSION_GLOBAL_OPTION, label: t("settings.provider.imageMaxDimensionPlaceholder") },
    ...PROVIDER_IMAGE_MAX_DIMENSION_PRESETS.map((value) => ({
      value: String(value),
      label: `${providerImageMaxDimensionTierLabel(value)} · ${value} px`,
    })),
    { value: PROVIDER_IMAGE_MAX_DIMENSION_CUSTOM_OPTION, label: t("imageSize.customLabel") },
  ];
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
  const handleImageMaxDimensionSelectChange = (value: string) => {
    if (value === PROVIDER_IMAGE_MAX_DIMENSION_CUSTOM_OPTION) {
      onFormChange({
        ...form,
        image_max_dimension_mode: "custom",
        image_max_dimension_custom_value: form.image_max_dimension != null ? String(form.image_max_dimension) : "",
      });
      return;
    }
    if (value === PROVIDER_IMAGE_MAX_DIMENSION_GLOBAL_OPTION) {
      onFormChange({
        ...form,
        image_max_dimension: null,
        image_max_dimension_mode: "preset",
        image_max_dimension_custom_value: "",
      });
      return;
    }
    onFormChange({
      ...form,
      image_max_dimension: Number(value),
      image_max_dimension_mode: "preset",
      image_max_dimension_custom_value: "",
    });
  };
  const handleImageMaxDimensionCustomChange = (raw: string) => {
    const nextDraft = parseProviderImageMaxDimensionDraft(raw);
    onFormChange({
      ...form,
      image_max_dimension_mode: "custom",
      image_max_dimension_custom_value: raw,
      image_max_dimension: nextDraft.invalid ? null : nextDraft.value,
    });
  };

  if (!open) {
    return null;
  }

  return (
    <ModalShell
      onClose={onClose}
      ariaLabelledBy={titleId}
      overlayClassName="z-[80] bg-[color:var(--pf-deep)] backdrop-blur-sm"
      overlayProps={{ style: { alignItems: "stretch", justifyContent: "flex-end" } }}
      panelElement="aside"
      panelClassName="relative flex h-full w-full max-w-full flex-col overflow-hidden pf-surface shadow-2xl shadow-slate-950/25 dark:bg-[#121722] sm:max-w-[448px]"
    >
        <div className="flex h-[74px] items-center justify-between border-b pf-hairline px-6 dark:border-[color:var(--pf-border)]">
          <div className="flex min-w-0 items-center gap-3">
            <span className="text-indigo-600 dark:text-violet-400">
              {editingProfileId ? <Pencil size={17} /> : <Plus size={18} />}
            </span>
            <h2 id={titleId} className="truncate text-lg font-bold pf-ink dark:text-[#fff]">
              {editingProfileId ? t("settings.provider.edit") : t("settings.provider.create")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={SETTINGS_ICON_ACTION_CLASS}
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
            <div className="text-xs font-semibold pf-ink-muted dark:text-[color:var(--pf-muted)]">
              {t("settings.provider.basicInfo")}
            </div>
            <SettingsFormField label={t("settings.provider.nameLabel")}>
              <ProviderDrawerTextInput
                value={form.name}
                onChange={(name) => onFormChange({ ...form, name })}
                placeholder={t("settings.provider.namePlaceholder")}
                disabled={!canWrite}
                workspaceSubpage={workspaceSubpage}
              />
            </SettingsFormField>
            <SettingsFormField label={t("settings.provider.typeLabel")} helpKey="settingsProviderType">
              {workspaceSubpage ? (
                <WorkspaceSelectField
                  value={form.provider_type}
                  options={[
                    { value: "openai_compatible", label: t("settings.provider.type.openaiCompatible") },
                    { value: "google_gemini", label: t("settings.provider.type.googleGemini") },
                  ]}
                  onChange={(value) =>
                    handleProviderTypeChange(value === "google_gemini" ? "google_gemini" : "openai_compatible")
                  }
                  disabled={!canWrite}
                  size="tall"
                />
              ) : (
                <ClassicSelectField
                  value={form.provider_type}
                  options={[
                    { value: "openai_compatible", label: t("settings.provider.type.openaiCompatible") },
                    { value: "google_gemini", label: t("settings.provider.type.googleGemini") },
                  ]}
                  onChange={(value) =>
                    handleProviderTypeChange(value === "google_gemini" ? "google_gemini" : "openai_compatible")
                  }
                  disabled={!canWrite}
                  size="tall"
                />
              )}
            </SettingsFormField>
            {form.provider_type === "openai_compatible" ? (
              <SettingsFormField label={t("settings.provider.baseUrlLabel")} helpKey="settingsProviderBaseUrl">
                <ProviderDrawerTextInput
                  value={form.base_url}
                  onChange={(base_url) => onFormChange({ ...form, base_url })}
                  placeholder={t("settings.provider.baseUrlPlaceholder")}
                  icon={<Link2 size={16} />}
                  disabled={!canWrite}
                  workspaceSubpage={workspaceSubpage}
                />
              </SettingsFormField>
            ) : (
              <div className="rounded-xl border pf-hairline pf-surface-soft px-4 py-3 text-xs leading-5 pf-ink-muted dark:border-[color:var(--pf-border)] dark:bg-[#171f30] dark:text-[color:var(--pf-muted)]">
                {t("settings.provider.googleBaseUrlUnsupported")}
              </div>
            )}
            <SettingsFormField label={t("settings.provider.apiKeyLabel")}>
              <div className="space-y-2">
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
                  workspaceSubpage={workspaceSubpage}
                />
                {editingProfileId && apiKeyPreview ? (
                  <p className="text-xs leading-5 pf-ink-muted dark:text-[color:var(--pf-muted)]">
                    {t("settings.provider.apiKeyPreview", { value: apiKeyPreview })}
                  </p>
                ) : null}
              </div>
            </SettingsFormField>
            <div className="grid gap-2">
              <div className="text-xs font-medium pf-ink-muted dark:text-[color:var(--pf-muted)]">
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
                workspaceSubpage={workspaceSubpage}
                onToggle={() => toggleCapability(option.value)}
              />
                ))}
              </div>
            </div>

            <div className="border-t pf-hairline pt-4 dark:border-[color:var(--pf-border)]">
              <SettingsFormField
                label={t("settings.provider.imageMaxDimension")}
                helpKey="settings.config.provider_image_max_dimension"
                helpContent={{
                  title: t("settings.provider.imageMaxDimension"),
                  description: t("settings.provider.imageMaxDimensionHelp"),
                }}
              >
                <div className="space-y-3">
                  {workspaceSubpage ? (
                    <WorkspaceSelectField
                      value={providerImageMaxDimensionSelectValue(form)}
                      options={imageMaxDimensionOptions}
                      onChange={handleImageMaxDimensionSelectChange}
                      disabled={!canWrite || pending}
                      size="tall"
                    />
                  ) : (
                    <ClassicSelectField
                      value={providerImageMaxDimensionSelectValue(form)}
                      options={imageMaxDimensionOptions}
                      onChange={handleImageMaxDimensionSelectChange}
                      disabled={!canWrite || pending}
                      size="tall"
                    />
                  )}
                  {form.image_max_dimension_mode === "custom" ? (
                    <div className="space-y-2">
                      {workspaceSubpage ? (
                        <WorkspaceTextInput
                          type="number"
                          min={String(IMAGE_GENERATION_MIN_MAX_DIMENSION)}
                          max={String(IMAGE_GENERATION_MAX_MAX_DIMENSION)}
                          step={String(IMAGE_GENERATION_DIMENSION_MULTIPLE)}
                          value={form.image_max_dimension_custom_value}
                          placeholder={t("settings.provider.imageMaxDimensionCustomPlaceholder")}
                          disabled={!canWrite || pending}
                          onChange={(event) => handleImageMaxDimensionCustomChange(event.target.value)}
                          size="tall"
                          className={
                            imageMaxDimensionInvalid
                              ? "border-rose-300 text-rose-700 placeholder:text-rose-300 dark:border-rose-500/70 dark:text-rose-100"
                              : undefined
                          }
                        />
                      ) : (
                        <ClassicTextInput
                          type="number"
                          min={String(IMAGE_GENERATION_MIN_MAX_DIMENSION)}
                          max={String(IMAGE_GENERATION_MAX_MAX_DIMENSION)}
                          step={String(IMAGE_GENERATION_DIMENSION_MULTIPLE)}
                          value={form.image_max_dimension_custom_value}
                          placeholder={t("settings.provider.imageMaxDimensionCustomPlaceholder")}
                          disabled={!canWrite || pending}
                          onChange={(event) => handleImageMaxDimensionCustomChange(event.target.value)}
                          size="tall"
                          className={
                            imageMaxDimensionInvalid
                              ? "border-rose-300 text-rose-700 placeholder:text-rose-300 dark:border-rose-500/70 dark:text-rose-100"
                              : undefined
                          }
                        />
                      )}
                      <p
                        className={`text-xs leading-5 ${
                          imageMaxDimensionInvalid
                            ? "text-rose-600 dark:text-rose-300"
                            : "pf-ink-muted dark:text-[color:var(--pf-muted)]"
                        }`}
                      >
                        {imageMaxDimensionInvalid
                          ? t("settings.provider.imageMaxDimensionCustomInvalid", {
                              min: IMAGE_GENERATION_MIN_MAX_DIMENSION,
                              max: IMAGE_GENERATION_MAX_MAX_DIMENSION,
                            })
                          : form.image_max_dimension_custom_value.trim() &&
                              imageMaxDimensionDraft.value != null &&
                              imageMaxDimensionDraft.value !== Number(form.image_max_dimension_custom_value)
                            ? t("settings.provider.imageMaxDimensionCustomNormalized", {
                                value: imageMaxDimensionDraft.value,
                              })
                            : t("settings.provider.imageMaxDimensionCustomHint", {
                                min: IMAGE_GENERATION_MIN_MAX_DIMENSION,
                                max: IMAGE_GENERATION_MAX_MAX_DIMENSION,
                                multiple: IMAGE_GENERATION_DIMENSION_MULTIPLE,
                              })}
                      </p>
                    </div>
                  ) : null}
                </div>
              </SettingsFormField>
            </div>

            <div className="border-t pf-hairline pt-4 dark:border-[color:var(--pf-border)]">
              <ProviderDrawerEnableToggle
                checked={form.enabled}
                disabled={!canWrite || pending}
                blocked={enableToggleBlocked}
                workspaceSubpage={workspaceSubpage}
                onToggle={(enabled) => onFormChange({ ...form, enabled })}
              />
            </div>
          </div>

          <div className="shrink-0 border-t pf-hairline pf-surface px-6 py-5 dark:border-[color:var(--pf-border)] dark:bg-[#121722]">
            <button
              type="submit"
              disabled={
                !canWrite ||
                pending ||
                !form.name.trim() ||
                !form.capabilities.length ||
                imageMaxDimensionInvalid
              }
              className={SETTINGS_DRAWER_SUBMIT_ACTION_CLASS}
            >
              {pending ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Save size={14} className="mr-2" />}
              {t("detail.save")}
            </button>
          </div>
        </form>
    </ModalShell>
  );
}

function providerImageMaxDimensionTierLabel(value: number): string {
  if (value >= 3840) {
    return "4K";
  }
  if (value >= 3072) {
    return "3K";
  }
  if (value >= 2048) {
    return "2K";
  }
  if (value >= 1536) {
    return "1.5K";
  }
  return "1K";
}
