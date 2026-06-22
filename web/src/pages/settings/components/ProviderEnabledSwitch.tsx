// 供应商启用状态开关（switch role）。纯展示组件。

import { Loader2 } from "lucide-react";

interface ProviderEnabledSwitchProps {
  checked: boolean;
  disabled: boolean;
  loading?: boolean;
  title?: string;
  ariaLabel: string;
  describedBy?: string;
  onToggle: (checked: boolean) => void;
}

export function ProviderEnabledSwitch({
  checked,
  disabled,
  loading = false,
  title,
  ariaLabel,
  describedBy,
  onToggle,
}: ProviderEnabledSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      title={title}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onToggle(!checked);
      }}
      onKeyDown={(event) => event.stopPropagation()}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition ${
        checked
          ? "border-indigo-500 bg-indigo-600 dark:border-violet-400 dark:bg-violet-500"
          : "pf-hairline-strong bg-slate-200 dark:border-slate-700 dark:bg-slate-800"
      } ${disabled ? "cursor-not-allowed opacity-55" : "hover:brightness-105"}`}
    >
      <span
        className={`inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm transition ${
          checked ? "translate-x-5" : "translate-x-0.5"
        }`}
      >
        {loading ? <Loader2 size={12} className="animate-spin" /> : null}
      </span>
    </button>
  );
}
