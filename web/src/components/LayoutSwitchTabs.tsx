import type { ReactNode } from "react";

import type { LayoutActionAppearance } from "./layoutActionButtons";

export interface LayoutSwitchTabItem<TValue extends string> {
  value: TValue;
  label: ReactNode;
  disabled?: boolean;
  tabId?: string;
  panelId?: string;
}

interface LayoutSwitchTabsProps<TValue extends string> {
  appearance: LayoutActionAppearance;
  value: TValue;
  items: readonly LayoutSwitchTabItem<TValue>[];
  ariaLabel: string;
  onChange: (value: TValue) => void;
  className?: string;
  tabClassName?: string;
}

function joinClassNames(parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function layoutSwitchTabsClassName(appearance: LayoutActionAppearance, className?: string): string {
  return joinClassNames([
    "pf-settings-generation-tabs",
    appearance === "workspace" ? "pf-workspace-horizontal-switch-tabs" : "pf-classic-horizontal-switch-tabs",
    "flex flex-wrap gap-1",
    className,
  ]);
}

export function layoutSwitchTabClassName(active: boolean, className?: string): string {
  return joinClassNames([
    "pf-settings-generation-tab inline-flex min-h-9 items-center justify-center px-3 py-2 text-sm font-semibold transition-all",
    active ? "is-active" : "",
    className,
  ]);
}

export function LayoutSwitchTabs<TValue extends string>({
  appearance,
  value,
  items,
  ariaLabel,
  onChange,
  className,
  tabClassName,
}: LayoutSwitchTabsProps<TValue>) {
  return (
    <div className={layoutSwitchTabsClassName(appearance, className)} role="tablist" aria-label={ariaLabel}>
      {items.map((item) => {
        const active = value === item.value;
        return (
          <button
            key={item.value}
            id={item.tabId}
            type="button"
            role="tab"
            aria-selected={active}
            aria-current={active ? "true" : undefined}
            aria-controls={item.panelId}
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
            className={layoutSwitchTabClassName(active, tabClassName)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
