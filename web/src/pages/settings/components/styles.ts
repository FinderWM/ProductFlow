// 设置页共享的 className 常量：输入框/文本域/面板/各类操作按钮/抽屉输入。
// 从 SettingsPage.tsx 抽出，供页面与 settings/components/ 下各组件共用。

import { actionButtonClassNameForAppearance } from "../../../components/layoutActionButtons";
import { useUiLayoutScheme } from "../../../lib/uiLayoutSchemePreference";

export type SettingsButtonAppearance = "classic" | "workspace";

type SettingsActionButtonOptions = Parameters<typeof actionButtonClassNameForAppearance>[1];

export function settingsActionButtonClassName(
  appearance: SettingsButtonAppearance,
  options?: SettingsActionButtonOptions,
): string {
  return actionButtonClassNameForAppearance(appearance, options);
}

export function useSettingsActionClassNames() {
  const { activeScheme } = useUiLayoutScheme();
  const appearance: SettingsButtonAppearance = activeScheme === "workspace" ? "workspace" : "classic";

  return {
    SETTINGS_MAIN_ACTION_CLASS: settingsActionButtonClassName(appearance, {
      preset: "primary",
      size: "md",
      className: "gap-0",
    }),
    SETTINGS_SECONDARY_ACTION_CLASS: settingsActionButtonClassName(appearance, {
      preset: "secondary",
      size: "md",
      className: "gap-0",
    }),
    SETTINGS_COMPACT_ACTION_CLASS: settingsActionButtonClassName(appearance, {
      preset: "secondary",
      size: "sm",
      className: "gap-0",
    }),
    SETTINGS_ICON_ACTION_CLASS: settingsActionButtonClassName(appearance, { preset: "secondary", size: "icon-sm" }),
    SETTINGS_SQUARE_ACTION_CLASS: settingsActionButtonClassName(appearance, { preset: "secondary", size: "icon-md" }),
    SETTINGS_DRAWER_SUBMIT_ACTION_CLASS: settingsActionButtonClassName(appearance, {
      preset: "primary",
      size: "md",
      fullWidth: true,
      className: "gap-0",
    }),
    SETTINGS_DANGER_ICON_ACTION_CLASS: settingsActionButtonClassName(appearance, { preset: "danger", size: "icon-sm" }),
    SETTINGS_RESET_ACTION_CLASS: settingsActionButtonClassName(appearance, {
      preset: "danger",
      size: "sm",
      className: "gap-0",
    }),
  };
}

export const PANEL_CLASS =
  "rounded-xl border border-slate-200 bg-white p-6 shadow-md shadow-slate-300/40 " +
  "dark:border-slate-700/70 dark:bg-[#0f1726] dark:shadow-black/35";
export const SETTINGS_BORDERED_MODULE_CLASS = "pf-settings-bordered-module";
export const SETTINGS_FIELD_CARD_CLASS = "pf-settings-field-card";
