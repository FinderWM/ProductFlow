// 登录页设置面板：模式选择 + 模板内容编辑（大图资源库 / 文案字段）。从 SettingsPage.tsx 抽出，行为不变。

import { useEffect, useState } from "react";

import { Image, Loader2, RotateCcw, Save } from "lucide-react";

import { ResourceLibraryModal } from "../../../components/resource-library/ResourceLibraryModal";
import { SelectField } from "../../../components/SelectField";
import { api } from "../../../lib/api";
import { useI18n } from "../../../lib/preferences";
import type { ConfigItem, LoginPageMode, LoginPageTemplateId, ResourceLibraryAsset } from "../../../lib/types";
import { draftFromItem } from "../configDrafts";
import { sourceClassName, sourceLabel } from "../configSource";
import {
  LOGIN_PAGE_TEMPLATE_CONFIG_FIELDS,
  LOGIN_PAGE_TEMPLATE_IDS,
  LOGIN_PAGE_TEMPLATE_LABEL_KEYS,
  isLoginPageMode,
  isLoginPageTemplateId,
  loginPageTemplateConfigItem,
  parseLoginPageTemplateConfigDraft,
  serializeLoginPageTemplateConfigDraft,
} from "../loginPageTemplate";
import type { DraftValue } from "../types";
import { ConfigField } from "./ConfigField";
import { ConfigFieldResetButton } from "./ConfigFieldResetButton";
import {
  INPUT_CLASS,
  SETTINGS_COMPACT_ACTION_CLASS,
  SETTINGS_FIELD_CARD_CLASS,
  SETTINGS_MAIN_ACTION_CLASS,
  TEXTAREA_CLASS,
} from "./styles";

interface LoginPageSettingsPanelProps {
  items: ConfigItem[];
  drafts: Record<string, DraftValue>;
  secretTouched: Record<string, boolean>;
  resettingKey: string | null;
  disabled: boolean;
  assets: ResourceLibraryAsset[];
  assetsLoading: boolean;
  assetsError: boolean;
  selectionSaving: boolean;
  templateConfigSaving: boolean;
  onChange: (item: ConfigItem, value: DraftValue, touchedSecret?: boolean) => void;
  onReset: (item: ConfigItem) => void;
  onSaveSelection: (value: LoginPageMode) => void;
  onSaveTemplateConfig: (templateId: LoginPageTemplateId, config: Record<string, string>) => void;
}

export function LoginPageSettingsPanel({
  items,
  drafts,
  secretTouched,
  resettingKey,
  disabled,
  assets,
  assetsLoading,
  assetsError,
  selectionSaving,
  templateConfigSaving,
  onChange,
  onReset,
  onSaveSelection,
  onSaveTemplateConfig,
}: LoginPageSettingsPanelProps) {
  const { t } = useI18n();
  const [resourceLibraryOpen, setResourceLibraryOpen] = useState(false);
  const selectionItem = items.find((item) => item.key === "login_page_mode");
  const selectionValue = selectionItem ? String(drafts[selectionItem.key] ?? draftFromItem(selectionItem)) : "random";
  const selectionMode = isLoginPageMode(selectionValue) ? selectionValue : "random";
  const [editingTemplateId, setEditingTemplateId] = useState<LoginPageTemplateId>("command-orbit");
  const selectableAssets = assets.filter(
    (asset) => asset.kind === "image" && !asset.archived_at && asset.effective_enabled !== false,
  );
  const activeConfigItem = loginPageTemplateConfigItem(items, editingTemplateId);
  const activeConfig = activeConfigItem
    ? parseLoginPageTemplateConfigDraft(
        editingTemplateId,
        drafts[activeConfigItem.key] ?? draftFromItem(activeConfigItem),
      )
    : {};
  const selectedAssetId = activeConfig.hero_image_asset_id ?? "";
  const selectedAsset = selectableAssets.find((asset) => asset.id === selectedAssetId);

  useEffect(() => {
    if (isLoginPageTemplateId(selectionValue)) {
      setEditingTemplateId(selectionValue);
    }
  }, [selectionValue]);

  const updateActiveConfigField = (fieldKey: string, value: string) => {
    if (!activeConfigItem) {
      return;
    }
    onChange(
      activeConfigItem,
      serializeLoginPageTemplateConfigDraft(editingTemplateId, {
        ...activeConfig,
        [fieldKey]: value,
      }),
    );
  };

  return (
    <>
    <div className="space-y-5">
      {selectionItem ? (
        <section className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-950 dark:text-white">
              {t("settings.loginPage.selectionTitle")}
            </h3>
          </div>
          <ConfigField
            item={selectionItem}
            value={drafts[selectionItem.key] ?? draftFromItem(selectionItem)}
            secretTouched={Boolean(secretTouched[selectionItem.key])}
            isResetting={resettingKey === selectionItem.key}
            layout="card"
            disabled={disabled}
            onChange={(nextValue, touchedSecret) => onChange(selectionItem, nextValue, touchedSecret)}
            onReset={() => onReset(selectionItem)}
          />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => onSaveSelection(selectionMode)}
              disabled={disabled || selectionSaving}
              className={SETTINGS_MAIN_ACTION_CLASS}
            >
              {selectionSaving ? (
                <Loader2 size={14} className="mr-2 animate-spin" />
              ) : (
                <Save size={14} className="mr-2" />
              )}
              {t("settings.loginPage.saveSelection")}
            </button>
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-950 dark:text-white">
              {t("settings.loginPage.contentTitle")}
            </h3>
            <p className="mt-1 text-xs leading-5 text-zinc-500 dark:text-slate-400">
              {t("settings.loginPage.contentDescription")}
            </p>
          </div>
          <div className="min-w-48 text-xs font-medium text-zinc-600 dark:text-slate-300">
            <span id="login-page-edit-template-label" className="mb-1 block">
              {t("settings.loginPage.editTemplate")}
            </span>
            <SelectField
              id="login-page-edit-template"
              value={editingTemplateId}
              options={LOGIN_PAGE_TEMPLATE_IDS.map((templateId) => ({
                value: templateId,
                label: t(LOGIN_PAGE_TEMPLATE_LABEL_KEYS[templateId]),
              }))}
              onChange={(value) => {
                if (isLoginPageTemplateId(value)) {
                  setEditingTemplateId(value);
                }
              }}
              ariaLabel={t("settings.loginPage.editTemplate")}
              radius="xl"
            />
          </div>
        </div>

        {activeConfigItem ? (
          <div className={`${SETTINGS_FIELD_CARD_CLASS} rounded-2xl border border-slate-200 bg-white p-4 shadow-none dark:border-slate-800 dark:bg-[#0f1726]`}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="block text-sm font-semibold text-zinc-950 dark:text-white">
                    {activeConfigItem.label}
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${sourceClassName(activeConfigItem)}`}>
                    {sourceLabel(activeConfigItem, t)}
                  </span>
                </div>
                <div className="pf-settings-config-key min-w-0 break-all font-mono text-[11px] leading-5 text-zinc-400 dark:text-slate-500">
                  {activeConfigItem.key}
                </div>
              </div>
              {activeConfigItem.source === "database" ? (
                <ConfigFieldResetButton
                  label={activeConfigItem.label}
                  busy={resettingKey === activeConfigItem.key}
                  disabled={disabled}
                  onReset={() => onReset(activeConfigItem)}
                />
              ) : null}
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              {LOGIN_PAGE_TEMPLATE_CONFIG_FIELDS[editingTemplateId].map((field) =>
                field.type === "asset" ? (
                  <div key={field.key} className="space-y-2 lg:col-span-2">
                    <label
                      htmlFor={`${activeConfigItem.key}-${field.key}`}
                      className="block text-sm font-medium text-zinc-900 dark:text-white"
                    >
                      {t(field.labelKey)}
                    </label>
                    <p className="text-xs leading-5 text-zinc-500 dark:text-slate-400">
                      {t("settings.loginPage.assetDescription")}
                    </p>
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_180px] lg:items-start">
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-2">
                          <button
                            id={`${activeConfigItem.key}-${field.key}`}
                            type="button"
                            onClick={() => setResourceLibraryOpen(true)}
                            disabled={disabled}
                            className={SETTINGS_COMPACT_ACTION_CLASS}
                          >
                            <Image size={14} className="mr-2" />
                            {t("settings.loginPage.selectLargeImage")}
                          </button>
                          <button
                            type="button"
                            onClick={() => updateActiveConfigField(field.key, "")}
                            disabled={disabled || !selectedAssetId}
                            className={SETTINGS_COMPACT_ACTION_CLASS}
                          >
                            <RotateCcw size={14} className="mr-2" />
                            {t("settings.loginPage.useDefaultLargeImage")}
                          </button>
                        </div>
                        {assetsLoading ? (
                          <div className="flex items-center text-xs text-slate-500 dark:text-slate-400">
                            <Loader2 size={13} className="mr-2 animate-spin" />
                            {t("settings.loginPage.loadingAssets")}
                          </div>
                        ) : assetsError ? (
                          <p className="text-xs text-red-600 dark:text-red-300">{t("settings.loginPage.assetsLoadFailed")}</p>
                        ) : selectableAssets.length ? (
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {t("settings.loginPage.assetCount", { count: selectableAssets.length })}
                          </p>
                        ) : (
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {t("settings.loginPage.noAssets")}
                          </p>
                        )}
                      </div>

                      <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950">
                        {selectedAsset ? (
                          <img
                            src={api.toApiUrl(selectedAsset.thumbnail_url)}
                            alt={selectedAsset.original_filename}
                            className="aspect-[4/3] w-full object-cover"
                            loading="lazy"
                            decoding="async"
                          />
                        ) : !selectedAssetId ? (
                          <img
                            src={api.toApiUrl("/hero.png")}
                            alt={t("settings.loginPage.defaultHeroImage")}
                            className="aspect-[4/3] w-full object-cover"
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <div className="flex aspect-[4/3] w-full items-center justify-center text-slate-400 dark:text-slate-500">
                            <Image size={24} />
                          </div>
                        )}
                        <div className="border-t border-slate-200 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                          {selectedAsset?.original_filename ??
                            (selectedAssetId
                              ? t("settings.loginPage.selectedAssetUnavailable")
                              : t("settings.loginPage.defaultHeroImage"))}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : field.type === "textarea" ? (
                  <label key={field.key} className="space-y-2">
                    <span className="block text-sm font-medium text-zinc-900 dark:text-white">{t(field.labelKey)}</span>
                    <textarea
                      value={activeConfig[field.key] ?? ""}
                      disabled={disabled}
                      onChange={(event) => updateActiveConfigField(field.key, event.target.value)}
                      rows={3}
                      className={`${TEXTAREA_CLASS} resize-y leading-6`}
                    />
                  </label>
                ) : (
                  <label key={field.key} className="space-y-2">
                    <span className="block text-sm font-medium text-zinc-900 dark:text-white">{t(field.labelKey)}</span>
                    <input
                      type="text"
                      value={activeConfig[field.key] ?? ""}
                      disabled={disabled}
                      onChange={(event) => updateActiveConfigField(field.key, event.target.value)}
                      className={INPUT_CLASS}
                    />
                  </label>
                ),
              )}
            </div>
            <div className="mt-5 flex justify-end border-t border-slate-100 pt-4 dark:border-slate-800">
              <button
                type="button"
                onClick={() => onSaveTemplateConfig(editingTemplateId, activeConfig)}
                disabled={disabled || templateConfigSaving}
                className={SETTINGS_MAIN_ACTION_CLASS}
              >
                {templateConfigSaving ? (
                  <Loader2 size={14} className="mr-2 animate-spin" />
                ) : (
                  <Save size={14} className="mr-2" />
                )}
                {t("settings.loginPage.saveTemplateConfig")}
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            {t("settings.section.empty")}
          </div>
        )}
      </section>
    </div>
    <ResourceLibraryModal
      open={resourceLibraryOpen}
      onClose={() => setResourceLibraryOpen(false)}
      canRead
      onSelectAsset={(asset) => {
        if (asset.kind !== "image") {
          return;
        }
        updateActiveConfigField("hero_image_asset_id", asset.id);
        setResourceLibraryOpen(false);
      }}
      selectLabel={t("settings.loginPage.selectLargeImage")}
      selectDisabled={disabled}
      selectDisabledTitle={disabled ? t("settings.writePermissionRequired") : null}
      isAssetSelectable={(asset) => asset.kind === "image"}
      assetSelectDisabledTitle={t("settings.loginPage.imageOnly")}
    />
    </>
  );
}
