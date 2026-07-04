// 供应商启用状态开关（switch role）。纯展示组件。

import { Loader2 } from "lucide-react";

import { ClassicSwitch } from "../../../components/classicInputs";
import { WorkspaceSwitch } from "../../../components/workspaceInputs";

interface ProviderEnabledSwitchProps {
  checked: boolean;
  disabled: boolean;
  loading?: boolean;
  title?: string;
  ariaLabel: string;
  describedBy?: string;
  workspaceSubpage?: boolean;
  onToggle: (checked: boolean) => void;
}

export function ProviderEnabledSwitch({
  checked,
  disabled,
  loading = false,
  title,
  ariaLabel,
  describedBy,
  workspaceSubpage = false,
  onToggle,
}: ProviderEnabledSwitchProps) {
  return workspaceSubpage ? (
    <div
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      title={title}
    >
      <WorkspaceSwitch
        checked={checked}
        disabled={disabled}
        ariaLabel={ariaLabel}
        ariaDescribedBy={describedBy}
        className="min-h-0 gap-0 border-0 bg-transparent p-0 shadow-none hover:bg-transparent dark:bg-transparent"
        controlClassName="relative"
        controlContent={
          loading ? (
            <span className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center text-slate-500 dark:text-slate-100">
              <Loader2 size={11} className="animate-spin" />
            </span>
          ) : null
        }
        onChange={onToggle}
      />
    </div>
  ) : (
    <div
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      title={title}
    >
      <ClassicSwitch
        checked={checked}
        disabled={disabled}
        ariaLabel={ariaLabel}
        ariaDescribedBy={describedBy}
        className="min-h-0 gap-0 border-0 bg-transparent p-0 shadow-none hover:bg-transparent dark:bg-transparent"
        controlClassName="relative"
        controlContent={
          loading ? (
            <span className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center text-slate-500 dark:text-slate-100">
              <Loader2 size={11} className="animate-spin" />
            </span>
          ) : null
        }
        onChange={onToggle}
      />
    </div>
  );
}
