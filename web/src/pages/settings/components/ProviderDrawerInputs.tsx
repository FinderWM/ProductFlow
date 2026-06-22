// 供应商抽屉的输入控件：能力多选项、文本输入、启用开关。纯展示组件。

import { useId, type ReactNode } from "react";

import { Check } from "lucide-react";

import { useI18n } from "../../../lib/preferences";
import { PROVIDER_CAPABILITY_OPTIONS } from "../providerForm";
import { PROVIDER_DRAWER_INPUT_CLASS } from "./styles";

interface ProviderCapabilityToggleProps {
  option: (typeof PROVIDER_CAPABILITY_OPTIONS)[number];
  selected: boolean;
  disabled?: boolean;
  onToggle: () => void;
}

export function ProviderCapabilityToggle({ option, selected, disabled = false, onToggle }: ProviderCapabilityToggleProps) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onToggle}
      className={`pf-settings-provider-option flex min-h-[46px] items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm font-semibold transition ${
        selected
          ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-violet-500 dark:bg-violet-500/12 dark:text-violet-50"
          : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 dark:border-slate-700 dark:bg-[#171f30] dark:text-slate-300 dark:hover:border-slate-500"
      }`}
    >
      <span
        className={`pf-settings-provider-option-mark grid h-5 w-5 shrink-0 place-items-center rounded-[5px] transition ${
          selected
            ? "bg-indigo-600 text-white dark:bg-violet-500"
            : "bg-slate-200 dark:bg-slate-600"
        }`}
      >
        {selected ? <Check size={13} strokeWidth={3} /> : null}
      </span>
      <span className="min-w-0 flex-1 whitespace-normal break-words leading-5">{t(option.labelKey)}</span>
    </button>
  );
}

interface ProviderDrawerTextInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: "text" | "password";
  icon?: ReactNode;
  autoComplete?: string;
  disabled?: boolean;
}

export function ProviderDrawerTextInput({
  value,
  onChange,
  placeholder,
  type = "text",
  icon,
  autoComplete,
  disabled = false,
}: ProviderDrawerTextInputProps) {
  return (
    <div className="relative">
      {icon ? (
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500">
          {icon}
        </span>
      ) : null}
      <input
        type={type}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className={`${PROVIDER_DRAWER_INPUT_CLASS} ${icon ? "pl-11" : ""}`}
        placeholder={placeholder}
        autoComplete={autoComplete}
      />
    </div>
  );
}

interface ProviderDrawerEnableToggleProps {
  checked: boolean;
  disabled: boolean;
  blocked?: boolean;
  onToggle: (checked: boolean) => void;
}

export function ProviderDrawerEnableToggle({ checked, disabled, blocked = false, onToggle }: ProviderDrawerEnableToggleProps) {
  const { t } = useI18n();
  const helpId = useId();
  return (
    <div>
      <button
        type="button"
        disabled={disabled || blocked}
        aria-pressed={checked}
        aria-describedby={blocked ? helpId : undefined}
        onClick={() => onToggle(!checked)}
        className={`pf-settings-provider-option flex h-[46px] w-full items-center gap-3 rounded-xl border px-3 text-left text-sm font-semibold transition ${
          checked
            ? "border-indigo-300 bg-indigo-50 text-slate-900 dark:border-slate-700 dark:bg-[#171f30] dark:text-slate-100"
            : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-[#171f30] dark:text-slate-300"
        } ${
          disabled || blocked
            ? "cursor-not-allowed opacity-60"
            : "hover:border-indigo-300 dark:hover:border-violet-500/60"
        }`}
      >
        <span
          className={`pf-settings-provider-option-mark grid h-5 w-5 shrink-0 place-items-center rounded-md transition ${
            checked ? "bg-indigo-600 text-white dark:bg-violet-500" : "bg-slate-200 dark:bg-slate-600"
          }`}
        >
          {checked ? <Check size={13} strokeWidth={3} /> : null}
        </span>
        {t("settings.provider.enable")}
      </button>
      {blocked ? (
        <p id={helpId} className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-200">
          {t("settings.provider.disableBlocked")}
        </p>
      ) : null}
    </div>
  );
}
