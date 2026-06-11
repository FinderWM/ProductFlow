import type { ReactNode } from "react";

import { useI18n } from "../lib/preferences";

export type ImageGenerationSettingsTab = "basic" | "advanced";

const ACTIVE_TAB_CLASS =
  "border-[#56B3FE] bg-gradient-to-r from-[#56B3FE] via-[#2F7CFF] to-[#8B5CF6] text-white shadow-sm shadow-[#56B3FE]/25";
const INACTIVE_TAB_CLASS =
  "border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-900/70 dark:hover:text-slate-100";

interface ImageGenerationSettingsTabsProps {
  value: ImageGenerationSettingsTab;
  onChange: (value: ImageGenerationSettingsTab) => void;
  basic: ReactNode;
  advanced: ReactNode;
  className?: string;
}

export function ImageGenerationSettingsTabs({
  value,
  onChange,
  basic,
  advanced,
  className = "",
}: ImageGenerationSettingsTabsProps) {
  const { t } = useI18n();
  const tabs: readonly [ImageGenerationSettingsTab, string][] = [
    ["basic", t("imageSettings.tabs.basic")],
    ["advanced", t("imageSettings.tabs.advanced")],
  ];

  return (
    <div className={className}>
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-950/72 dark:shadow-inner dark:shadow-black/20">
        {tabs.map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            onClick={() => onChange(tab)}
            className={`h-9 rounded-lg border text-sm font-semibold transition-[background-color,border-color,box-shadow,transform] duration-200 ease-out active:translate-y-px active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#56B3FE]/40 ${
              value === tab ? ACTIVE_TAB_CLASS : INACTIVE_TAB_CLASS
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div key={value} className="animate-spring-slide-in">
        {value === "basic" ? basic : advanced}
      </div>
    </div>
  );
}
