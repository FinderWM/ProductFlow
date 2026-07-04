// 供应商抽屉的输入控件：能力多选项、文本输入、启用开关。纯展示组件。

import { useId, type ReactNode } from "react";

import { ClassicOptionToggle, ClassicTextInput } from "../../../components/classicInputs";
import { WorkspaceOptionToggle, WorkspaceTextInput } from "../../../components/workspaceInputs";
import { useI18n } from "../../../lib/preferences";
import { PROVIDER_CAPABILITY_OPTIONS } from "../providerForm";

interface ProviderCapabilityToggleProps {
  option: (typeof PROVIDER_CAPABILITY_OPTIONS)[number];
  selected: boolean;
  disabled?: boolean;
  workspaceSubpage?: boolean;
  onToggle: () => void;
}

export function ProviderCapabilityToggle({
  option,
  selected,
  disabled = false,
  workspaceSubpage = false,
  onToggle,
}: ProviderCapabilityToggleProps) {
  const { t } = useI18n();
  return workspaceSubpage ? (
    <WorkspaceOptionToggle
      checked={selected}
      disabled={disabled}
      layout="card"
      className="min-h-[46px] gap-3 px-3 py-2.5 text-sm font-semibold"
      onChange={() => onToggle()}
    >
      <span className="min-w-0 flex-1 whitespace-normal break-words leading-5">{t(option.labelKey)}</span>
    </WorkspaceOptionToggle>
  ) : (
    <ClassicOptionToggle
      checked={selected}
      disabled={disabled}
      layout="card"
      className="min-h-[46px] gap-3 px-3 py-2.5 text-sm font-semibold"
      onChange={() => onToggle()}
    >
      <span className="min-w-0 flex-1 whitespace-normal break-words leading-5">{t(option.labelKey)}</span>
    </ClassicOptionToggle>
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
  workspaceSubpage?: boolean;
}

export function ProviderDrawerTextInput({
  value,
  onChange,
  placeholder,
  type = "text",
  icon,
  autoComplete,
  disabled = false,
  workspaceSubpage = false,
}: ProviderDrawerTextInputProps) {
  return (
    <div className="relative">
      {icon ? (
        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500">
          {icon}
        </span>
      ) : null}
      {workspaceSubpage ? (
        <WorkspaceTextInput
          type={type}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={icon ? "pl-11 font-medium" : "font-medium"}
          size="tall"
          placeholder={placeholder}
          autoComplete={autoComplete}
        />
      ) : (
        <ClassicTextInput
          type={type}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          className={icon ? "pl-11 font-medium" : "font-medium"}
          size="tall"
          placeholder={placeholder}
          autoComplete={autoComplete}
        />
      )}
    </div>
  );
}

interface ProviderDrawerEnableToggleProps {
  checked: boolean;
  disabled: boolean;
  blocked?: boolean;
  workspaceSubpage?: boolean;
  onToggle: (checked: boolean) => void;
}

export function ProviderDrawerEnableToggle({
  checked,
  disabled,
  blocked = false,
  workspaceSubpage = false,
  onToggle,
}: ProviderDrawerEnableToggleProps) {
  const { t } = useI18n();
  const helpId = useId();
  return (
    <div>
      {workspaceSubpage ? (
        <WorkspaceOptionToggle
          checked={checked}
          disabled={disabled || blocked}
          layout="card"
          className="min-h-[46px] w-full gap-3 px-3 py-2.5 text-sm font-semibold"
          title={blocked ? t("settings.provider.disableBlocked") : undefined}
          onChange={(nextChecked) => onToggle(nextChecked)}
        >
          {t("settings.provider.enable")}
        </WorkspaceOptionToggle>
      ) : (
        <ClassicOptionToggle
          checked={checked}
          disabled={disabled || blocked}
          layout="card"
          className="min-h-[46px] w-full gap-3 px-3 py-2.5 text-sm font-semibold"
          title={blocked ? t("settings.provider.disableBlocked") : undefined}
          onChange={(nextChecked) => onToggle(nextChecked)}
        >
          {t("settings.provider.enable")}
        </ClassicOptionToggle>
      )}
      {blocked ? (
        <p id={helpId} className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-200">
          {t("settings.provider.disableBlocked")}
        </p>
      ) : null}
    </div>
  );
}
