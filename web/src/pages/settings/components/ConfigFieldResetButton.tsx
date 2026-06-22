// 配置项「恢复默认」按钮。纯展示组件。

import { Loader2, RotateCcw } from "lucide-react";

import { useI18n } from "../../../lib/preferences";
import { SETTINGS_RESET_ACTION_CLASS } from "./styles";

export function ConfigFieldResetButton({
  label,
  busy,
  disabled,
  onReset,
}: {
  label: string;
  busy: boolean;
  disabled: boolean;
  onReset: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onReset}
      disabled={disabled || busy}
      className={SETTINGS_RESET_ACTION_CLASS}
      aria-label={t("settings.restoreDefaultAria", { label })}
      title={t("settings.restoreDefault")}
    >
      {busy ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <RotateCcw size={14} className="mr-1.5" />}
      {t("settings.restoreDefault")}
    </button>
  );
}
