// 设置页操作反馈弹窗：成功/失败消息。纯展示组件。

import { useId } from "react";

import { CheckCircle2, X } from "lucide-react";

import { ModalShell } from "../../../components/ModalShell";
import { useI18n } from "../../../lib/preferences";
import { useSettingsActionClassNames } from "./styles";

export function SettingsFeedbackDialog({
  successMessage,
  errorMessage,
  onCloseSuccess,
  onCloseError,
}: {
  successMessage: string;
  errorMessage: string;
  onCloseSuccess: () => void;
  onCloseError: () => void;
}) {
  const { t } = useI18n();
  const { SETTINGS_ICON_ACTION_CLASS } = useSettingsActionClassNames();
  const titleId = useId();
  const descriptionId = useId();
  const open = Boolean(errorMessage || successMessage);
  const isError = Boolean(errorMessage);
  const message = errorMessage || successMessage;

  if (!open) {
    return null;
  }

  const Icon = isError ? X : CheckCircle2;

  return (
    <ModalShell
      open={open}
      role={isError ? "alertdialog" : "dialog"}
      onClose={isError ? onCloseError : onCloseSuccess}
      ariaLabelledBy={titleId}
      ariaDescribedBy={descriptionId}
      overlayClassName="z-[95] bg-slate-950/45 px-4 py-6 backdrop-blur-sm"
      panelClassName="w-full max-w-sm overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-slate-700/80 dark:bg-[#0f1726] dark:shadow-black/45 animate-spring-pop-in"
    >
        <div className="flex items-start gap-3 px-5 py-5">
          <div
            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              isError
                ? "bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-200"
                : "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-200"
            }`}
          >
            <Icon size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold text-slate-950 dark:text-white">
              {isError ? t("settings.operationFailed") : t("settings.operationSucceeded")}
            </h2>
            <p id={descriptionId} className="mt-2 break-words text-sm leading-6 text-slate-600 dark:text-slate-300">
              {message}
            </p>
          </div>
          {isError ? (
            <button
              type="button"
              onClick={onCloseError}
              className={SETTINGS_ICON_ACTION_CLASS}
              aria-label={t("create.close")}
              title={t("create.close")}
            >
              <X size={16} />
            </button>
          ) : null}
        </div>
    </ModalShell>
  );
}
