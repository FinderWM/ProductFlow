// 停用「被生成配置占用的供应商」的确认弹窗。纯展示组件。

import { useId } from "react";

import { Loader2 } from "lucide-react";

import { ModalShell } from "../../../components/ModalShell";
import { useI18n } from "../../../lib/preferences";
import type { PendingProviderDisable } from "../types";
import { SETTINGS_COMPACT_ACTION_CLASS, SETTINGS_MAIN_ACTION_CLASS } from "./styles";

export function ProviderDisableConfirmDialog({
  pendingDisable,
  busy,
  onClose,
  onConfirm,
}: {
  pendingDisable: PendingProviderDisable | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const titleId = useId();

  if (!pendingDisable) {
    return null;
  }

  return (
    <ModalShell
      open={Boolean(pendingDisable)}
      onClose={onClose}
      closeDisabled={busy}
      ariaLabelledBy={titleId}
      overlayClassName="z-[85] bg-slate-950/55 px-4 py-6 backdrop-blur-sm"
      panelClassName="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-slate-700/80 dark:bg-[#0f1726] dark:shadow-black/45"
    >
      <div className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <h2 id={titleId} className="text-base font-semibold text-slate-950 dark:text-white">
          {t("settings.provider.disableUsedConfirmTitle")}
        </h2>
        <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
          {t("settings.provider.disableUsedConfirmDescription", { name: pendingDisable.profile.name })}
        </p>
      </div>
      <div className="max-h-[45dvh] overflow-y-auto px-5 py-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {t("settings.provider.disableUsedListTitle")}
        </div>
        <ul className="space-y-2">
          {pendingDisable.generationConfigs.map((generationConfig) => (
            <li
              key={generationConfig.id}
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900/45 dark:text-slate-200"
            >
              <span className="font-medium">{generationConfig.name}</span>
              <span className="ml-2 text-xs text-slate-500 dark:text-slate-400">
                {t(generationConfig.purpose === "text" ? "settings.section.text" : "settings.section.image")}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-800 dark:bg-slate-950/45">
        <button type="button" onClick={onClose} disabled={busy} className={SETTINGS_COMPACT_ACTION_CLASS}>
          {t("common.cancel")}
        </button>
        <button type="button" onClick={onConfirm} disabled={busy} className={SETTINGS_MAIN_ACTION_CLASS}>
          {busy ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
          {t("settings.provider.disableUsedConfirmLabel")}
        </button>
      </div>
    </ModalShell>
  );
}
