// 供应商档案区块簇：列表(ProvidersSection) + 档案卡片(Card) + 创建/编辑抽屉(Drawer)。
// 从 SettingsPage.tsx 整簇抽出，行为不变。仅 ProvidersSection 对外导出。

import { useId, useState } from "react";

import { Box, KeyRound, Link2, Loader2, Pencil, Plus, Save, Search, ServerCog, Trash2, X } from "lucide-react";

import { ModalShell } from "../../../components/ModalShell";
import { ParameterHelpLabel } from "../../../components/ParameterHelp";
import { SelectField } from "../../../components/SelectField";
import { useI18n } from "../../../lib/preferences";
import type { ProviderCapability, ProviderConfigResponse, ProviderProfile, ProviderType } from "../../../lib/types";
import {
  PROVIDER_CAPABILITY_OPTIONS,
  defaultCapabilitiesForProviderType,
  filterProviderProfilesByName,
  providerCapabilityLabelKey,
  providerDefaultEndpointLabelKey,
  providerDisableBlocked,
  providerTypeLabelKey,
  providerUsageFromGenerationConfigs,
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
  INPUT_CLASS,
  PANEL_CLASS,
  SETTINGS_BORDERED_MODULE_CLASS,
  SETTINGS_DANGER_ICON_ACTION_CLASS,
  SETTINGS_DRAWER_SUBMIT_ACTION_CLASS,
  SETTINGS_ICON_ACTION_CLASS,
  SETTINGS_MAIN_ACTION_CLASS,
} from "./styles";

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

export function ProvidersSection({
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
  const [profileSearch, setProfileSearch] = useState("");
  const profiles = (data?.profiles ?? []).filter((profile) => !profile.archived_at);
  const filteredProfiles = filterProviderProfilesByName(profiles, profileSearch);
  const editingProfile = editingProfileId
    ? profiles.find((profile) => profile.id === editingProfileId)
    : undefined;
  const editingProfileUsage = editingProfile
    ? providerUsageFromGenerationConfigs(data?.generation_configs ?? [], editingProfile.id)
    : undefined;
  const editingProfileDisableBlocked =
    editingProfile && editingProfileUsage ? providerDisableBlocked(editingProfile, editingProfileUsage) : false;

  return (
    <section className={`${PANEL_CLASS} ${SETTINGS_BORDERED_MODULE_CLASS}`}>
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
        <label className="relative block max-w-md">
          <span className="sr-only">{t("settings.provider.listSearch")}</span>
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
          />
          <input
            type="search"
            value={profileSearch}
            onChange={(event) => setProfileSearch(event.target.value)}
            className={`${INPUT_CLASS} pl-10`}
            placeholder={t("settings.provider.listSearchPlaceholder")}
            aria-label={t("settings.provider.listSearch")}
          />
        </label>
      ) : null}

      {profiles.length ? (
        filteredProfiles.length ? (
          <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">
            {filteredProfiles.map((profile) => {
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
          <div className="rounded-xl border border-dashed pf-hairline-strong bg-white px-6 py-10 text-center text-sm font-medium text-slate-500 shadow-sm shadow-slate-200/60 dark:border-slate-700 dark:bg-[#0f1726] dark:text-slate-400 dark:shadow-black/25">
            {t("settings.provider.searchEmpty")}
          </div>
        )
      ) : (
        <div className="flex min-h-[320px] flex-col items-center justify-center rounded-xl border border-dashed pf-hairline-strong bg-white px-6 text-center shadow-sm shadow-slate-200/60 dark:border-slate-700 dark:bg-[#0f1726] dark:shadow-black/25">
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
    </section>
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
    <div className="group relative flex flex-col justify-between overflow-hidden rounded-xl border pf-hairline bg-white/80 p-3 shadow-md shadow-slate-200/50 backdrop-blur-sm transition hover:border-indigo-200 hover:shadow-lg dark:border-slate-700/40 dark:bg-[#0f1726]/80 dark:shadow-black/20 dark:hover:border-violet-400/45 sm:p-5">
      <button
        type="button"
        onClick={onEdit}
        disabled={!canWrite}
        className="-m-2 block w-full space-y-4 rounded-lg p-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-violet-400"
      >
        <span className="flex items-start justify-between gap-4">
          <span className="min-w-0 pr-16 sm:pr-20">
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
            <span className="mt-2 flex items-center gap-1.5 overflow-hidden font-mono text-xs text-slate-500 dark:text-slate-400">
              <ServerCog size={13} className="shrink-0" />
              <span className="truncate">{profile.base_url || t(providerDefaultEndpointLabelKey(profile))}</span>
            </span>
          </span>
        </span>

        <span className="flex flex-col gap-3 sm:grid sm:grid-cols-[max-content_1px_minmax(0,1fr)] sm:items-start">
          <span className="whitespace-nowrap rounded-md bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-700 dark:bg-violet-500/12 dark:text-violet-100">
            {t(providerTypeLabelKey(profile.provider_type))}
          </span>
          <span aria-hidden="true" className="hidden w-px self-stretch bg-slate-200 dark:bg-slate-700 sm:block" />
          <span className="flex min-w-0 flex-col items-start gap-1.5">
            {profile.capabilities.map((capability) => (
              <span
                key={`${profile.id}-${capability}`}
                className="max-w-full rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300"
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
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
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

      <div className="mt-4 flex flex-col items-start gap-3 border-t border-slate-100 pt-4 dark:border-slate-800 sm:mt-5 sm:flex-row sm:justify-between">
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
    <ModalShell
      onClose={onClose}
      ariaLabelledBy={titleId}
      overlayClassName="z-[80] bg-slate-950/55 backdrop-blur-sm"
      overlayProps={{ style: { alignItems: "stretch", justifyContent: "flex-end" } }}
      panelElement="aside"
      panelClassName="relative flex h-full w-full max-w-full flex-col overflow-hidden bg-white shadow-2xl shadow-slate-950/25 dark:bg-[#121722] sm:max-w-[448px]"
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
              <SettingsFormField
                label={t("settings.provider.imageMaxDimension")}
                help={t("settings.provider.imageMaxDimensionHelp")}
              >
                <input
                  type="number"
                  min="512"
                  max="8192"
                  step="256"
                  value={form.image_max_dimension ?? ""}
                  placeholder={t("settings.provider.imageMaxDimensionPlaceholder")}
                  disabled={!canWrite || pending}
                  onChange={(e) => {
                    const value = e.target.value.trim();
                    onFormChange({ ...form, image_max_dimension: value ? parseInt(value, 10) : null });
                  }}
                  className={INPUT_CLASS}
                />
              </SettingsFormField>
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
