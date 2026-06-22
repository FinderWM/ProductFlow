// 设置迁移面板：敏感配置导出 + 导入预览/提交。从 SettingsPage.tsx 抽出，行为不变。

import type { ChangeEvent, RefObject } from "react";

import { Check, Download, FileJson, KeyRound, Loader2, UploadCloud } from "lucide-react";

import { useI18n } from "../../../lib/preferences";
import type { SettingsImportPreviewResponse } from "../../../lib/types";
import { settingsImportSummaryCounts } from "../importExport";
import {
  PANEL_CLASS,
  SETTINGS_BORDERED_MODULE_CLASS,
  SETTINGS_COMPACT_ACTION_CLASS,
  SETTINGS_MAIN_ACTION_CLASS,
  SETTINGS_SECONDARY_ACTION_CLASS,
} from "./styles";

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

export function SettingsMigrationPanel({
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
    <section className="mb-8 space-y-4">
      <div className={`${PANEL_CLASS} ${SETTINGS_BORDERED_MODULE_CLASS}`}>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 dark:border-amber-400/35 dark:bg-amber-500/12 dark:text-amber-200">
              <KeyRound size={13} className="mr-1.5" />
              {t("settings.migration.sensitiveLabel")}
            </div>
            <h2 className="mt-3 text-lg font-semibold text-slate-950 dark:text-white">
              {t("settings.migration.exportTitle")}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
              {t("settings.migration.exportDescription")}
            </p>
            <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-100">
              {t("settings.migration.sensitiveWarning")}
            </p>
          </div>
          <button
            type="button"
            onClick={onRequestExport}
            disabled={exportBusy}
            className={SETTINGS_MAIN_ACTION_CLASS}
          >
            {exportBusy ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Download size={14} className="mr-2" />}
            {t("settings.migration.export")}
          </button>
        </div>
      </div>

      <div className={`${PANEL_CLASS} ${SETTINGS_BORDERED_MODULE_CLASS}`}>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <h2 className="text-lg font-semibold text-slate-950 dark:text-white">
              {t("settings.migration.importTitle")}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
              {t("settings.migration.importDescription")}
            </p>
          </div>
          <button
            type="button"
            onClick={onChooseImportFile}
            disabled={!canMigrate || importPreviewBusy || importCommitBusy}
            className={SETTINGS_SECONDARY_ACTION_CLASS}
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
            className="sr-only"
            onChange={onImportFileChange}
          />
        </div>

        {importPreview && counts ? (
          <div className="mt-5 rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4 dark:border-violet-400/35 dark:bg-violet-500/10">
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
                  className={SETTINGS_COMPACT_ACTION_CLASS}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  onClick={onCommitImport}
                  disabled={!canMigrate || importCommitBusy}
                  className={SETTINGS_MAIN_ACTION_CLASS}
                >
                  {importCommitBusy ? (
                    <Loader2 size={14} className="mr-2 animate-spin" />
                  ) : (
                    <Check size={14} className="mr-2" />
                  )}
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
      </div>
    </section>
  );
}
