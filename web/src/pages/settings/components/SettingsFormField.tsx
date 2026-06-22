// 设置页表单字段容器：可选带 ParameterHelp 标签。纯展示组件。

import type { ReactNode } from "react";

import { ParameterHelpLabel, type ParameterHelpContentOverride } from "../../../components/ParameterHelp";
import type { ParameterHelpKey } from "../../../lib/parameterHelp";

interface SettingsFormFieldProps {
  label: string;
  children: ReactNode;
  className?: string;
  helpKey?: ParameterHelpKey;
  helpContent?: ParameterHelpContentOverride;
}

export function SettingsFormField({ label, children, className = "", helpKey, helpContent }: SettingsFormFieldProps) {
  if (helpKey) {
    return (
      <div className={`block space-y-2 ${className}`}>
        <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
          <ParameterHelpLabel label={label} helpKey={helpKey} uiType="settings" content={helpContent} />
        </div>
        {children}
      </div>
    );
  }

  return (
    <label className={`block space-y-2 ${className}`}>
      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{label}</span>
      {children}
    </label>
  );
}
