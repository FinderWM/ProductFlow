import type { ReactNode } from "react";

import { actionButtonClassNameForAppearance, type LayoutActionAppearance } from "./layoutActionButtons";
import { useI18n } from "../lib/preferences";

export type ImageGenerationSettingsTab = "basic" | "advanced";

interface ImageGenerationSettingsTabsProps {
  value: ImageGenerationSettingsTab;
  onChange: (value: ImageGenerationSettingsTab) => void;
  basic: ReactNode;
  advanced: ReactNode;
  className?: string;
  appearance?: LayoutActionAppearance;
}

export function ImageGenerationSettingsTabs({
  value,
  onChange,
  basic,
  advanced,
  className = "",
  appearance = "classic",
}: ImageGenerationSettingsTabsProps) {
  const { t } = useI18n();
  const tabs: readonly [ImageGenerationSettingsTab, string][] = [
    ["basic", t("imageSettings.tabs.basic")],
    ["advanced", t("imageSettings.tabs.advanced")],
  ];
  const tabListClassName =
    appearance === "workspace"
      ? "mb-4 grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-950/72 dark:shadow-inner dark:shadow-black/20"
      : "mb-4 grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-slate-50/90 p-1 dark:border-slate-700 dark:bg-slate-950/55";

  return (
    <div className={className}>
      <div className={tabListClassName}>
        {tabs.map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            onClick={() => onChange(tab)}
            aria-pressed={value === tab}
            className={actionButtonClassNameForAppearance(appearance, {
              preset: "secondary",
              size: "sm",
              className: "h-9 w-full justify-center text-xs",
            })}
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
