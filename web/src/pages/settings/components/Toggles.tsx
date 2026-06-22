// 设置页通用开关控件：胶囊式多选 toggle 与开关式 toggle。纯展示组件。

import type { ReactNode } from "react";

interface SettingsOptionToggleProps {
  checked: boolean;
  disabled?: boolean;
  inputId?: string;
  children: ReactNode;
  onChange: (checked: boolean) => void;
}

export function SettingsOptionToggle({
  checked,
  disabled = false,
  inputId,
  children,
  onChange,
}: SettingsOptionToggleProps) {
  return (
    <label
      className={`pf-settings-option-toggle inline-flex min-h-9 max-w-full items-center gap-2 rounded-full border py-1.5 pl-2.5 pr-3 text-xs font-medium transition-all ${
        checked
          ? "border-indigo-300 bg-indigo-50 text-slate-950 dark:border-violet-400/45 dark:bg-violet-500/14 dark:text-white"
          : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white hover:text-slate-950 dark:border-slate-700 dark:bg-[#111b2d] dark:text-slate-300 dark:hover:border-slate-500 dark:hover:bg-[#15233a] dark:hover:text-white"
      } ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer active:scale-[0.99]"}`}
    >
      <input
        id={inputId}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span className="pf-settings-option-toggle-control" aria-hidden="true" />
      <span className="min-w-0 leading-5">{children}</span>
    </label>
  );
}

interface SettingsSwitchToggleProps {
  checked: boolean;
  disabled?: boolean;
  inputId?: string;
  children: ReactNode;
  onChange: (checked: boolean) => void;
}

export function SettingsSwitchToggle({
  checked,
  disabled = false,
  inputId,
  children,
  onChange,
}: SettingsSwitchToggleProps) {
  return (
    <label
      className={`pf-settings-switch-toggle inline-flex min-h-9 max-w-full items-center gap-2 rounded-full border py-1.5 pl-3 pr-2 text-xs font-semibold transition-all ${
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer active:scale-[0.99]"
      }`}
    >
      <span className="min-w-0 leading-5">{children}</span>
      <input
        id={inputId}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span className="pf-settings-switch-control" aria-hidden="true" />
    </label>
  );
}
