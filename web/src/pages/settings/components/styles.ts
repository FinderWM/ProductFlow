// 设置页共享的 className 常量：输入框/文本域/面板/各类操作按钮/抽屉输入。
// 从 SettingsPage.tsx 抽出，供页面与 settings/components/ 下各组件共用。

export const INPUT_CLASS =
  "h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm text-slate-950 " +
  "placeholder:text-slate-400 shadow-none transition-colors focus:border-indigo-500 focus:bg-white " +
  "focus:outline-none focus:ring-2 focus:ring-indigo-500/20 " +
  "dark:border-slate-700 dark:bg-[#111b2d] dark:text-slate-100 " +
  "dark:placeholder:text-slate-500 dark:focus:border-violet-400 dark:focus:bg-[#111b2d]";

export const INPUT_COMPACT_CLASS =
  "h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs text-slate-950 " +
  "placeholder:text-slate-400 shadow-none transition-colors focus:border-indigo-500 focus:bg-white " +
  "focus:outline-none focus:ring-2 focus:ring-indigo-500/20 " +
  "dark:border-slate-700 dark:bg-[#111b2d] dark:text-slate-100 " +
  "dark:placeholder:text-slate-500 dark:focus:border-violet-400 dark:focus:bg-[#111b2d]";

export const TEXTAREA_CLASS =
  "w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-950 " +
  "placeholder:text-slate-400 shadow-none transition-colors focus:border-indigo-500 focus:bg-white " +
  "focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-[#111b2d] " +
  "dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-violet-400";

export const PROMPT_TEXTAREA_CLASS = `${TEXTAREA_CLASS} pf-settings-prompt-textarea`;

export const PANEL_CLASS =
  "rounded-xl border border-slate-200 bg-white p-6 shadow-md shadow-slate-300/40 " +
  "dark:border-slate-700/70 dark:bg-[#0f1726] dark:shadow-black/35";

export const SETTINGS_MAIN_ACTION_CLASS =
  "pf-workspace-action-primary inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-xl border px-3.5 text-xs font-semibold " +
  "transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60";
export const SETTINGS_SECONDARY_ACTION_CLASS =
  "pf-workspace-action-secondary inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-xl border px-3.5 text-xs font-semibold " +
  "transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60";
export const SETTINGS_COMPACT_ACTION_CLASS =
  "pf-workspace-action-secondary inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border px-2.5 text-xs font-medium " +
  "transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60";
export const SETTINGS_ICON_ACTION_CLASS =
  "pf-workspace-action-secondary inline-flex h-8 w-8 items-center justify-center rounded-xl border transition-all " +
  "active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60";
export const SETTINGS_SQUARE_ACTION_CLASS =
  "pf-workspace-action-secondary inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border " +
  "transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60";
export const SETTINGS_DRAWER_SUBMIT_ACTION_CLASS =
  "pf-workspace-action-primary inline-flex h-9 w-full items-center justify-center rounded-xl border px-3.5 text-xs font-semibold " +
  "transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60";
export const SETTINGS_DANGER_ICON_ACTION_CLASS =
  "pf-danger-action inline-flex h-8 w-8 items-center justify-center rounded-xl border transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";
export const SETTINGS_RESET_ACTION_CLASS =
  "pf-danger-action inline-flex h-8 shrink-0 items-center justify-center rounded-lg border px-2.5 text-xs font-semibold " +
  "transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";
export const SETTINGS_BORDERED_MODULE_CLASS = "pf-settings-bordered-module";
export const SETTINGS_FIELD_CARD_CLASS = "pf-settings-field-card";

export const PROVIDER_DRAWER_INPUT_CLASS =
  "h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-medium text-slate-950 " +
  "placeholder:text-slate-400 outline-none transition-colors focus:border-indigo-500 focus:bg-white " +
  "focus:ring-2 focus:ring-indigo-500/20 " +
  "dark:border-slate-700 dark:bg-[#111b2d] dark:text-slate-100 dark:placeholder:text-slate-500 " +
  "dark:focus:border-violet-400 dark:focus:bg-[#111b2d]";
