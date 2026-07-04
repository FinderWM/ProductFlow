// 设置页通用开关控件：胶囊式多选 toggle 与开关式 toggle。纯展示组件。

import type { ReactNode } from "react";

import { ClassicOptionToggle, ClassicSwitch } from "../../../components/classicInputs";
import { WorkspaceOptionToggle, WorkspaceSwitch } from "../../../components/workspaceInputs";

interface SettingsOptionToggleProps {
  checked: boolean;
  disabled?: boolean;
  inputId?: string;
  workspaceSubpage?: boolean;
  layout?: "pill" | "card";
  className?: string;
  children: ReactNode;
  onChange: (checked: boolean) => void;
}

export function SettingsOptionToggle({
  checked,
  disabled = false,
  inputId,
  workspaceSubpage = false,
  layout = "pill",
  className,
  children,
  onChange,
}: SettingsOptionToggleProps) {
  return workspaceSubpage ? (
    <WorkspaceOptionToggle
      checked={checked}
      disabled={disabled}
      inputId={inputId}
      layout={layout}
      className={className}
      onChange={onChange}
    >
      {children}
    </WorkspaceOptionToggle>
  ) : (
    <ClassicOptionToggle
      checked={checked}
      disabled={disabled}
      inputId={inputId}
      layout={layout}
      className={className}
      onChange={onChange}
    >
      {children}
    </ClassicOptionToggle>
  );
}

interface SettingsSwitchToggleProps {
  checked: boolean;
  disabled?: boolean;
  inputId?: string;
  workspaceSubpage?: boolean;
  children: ReactNode;
  onChange: (checked: boolean) => void;
}

export function SettingsSwitchToggle({
  checked,
  disabled = false,
  inputId,
  workspaceSubpage = false,
  children,
  onChange,
}: SettingsSwitchToggleProps) {
  return workspaceSubpage ? (
    <WorkspaceSwitch
      checked={checked}
      disabled={disabled}
      inputId={inputId}
      onChange={onChange}
    >
      {children}
    </WorkspaceSwitch>
  ) : (
    <ClassicSwitch checked={checked} disabled={disabled} inputId={inputId} onChange={onChange}>
      {children}
    </ClassicSwitch>
  );
}
