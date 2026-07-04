import type { ReactNode } from "react";

import type { LayoutActionAppearance } from "../../components/layoutActionButtons";

interface SidebarRailTabProps {
  active: boolean;
  appearance: LayoutActionAppearance;
  label: string;
  title: string;
  icon: ReactNode;
  onClick: () => void;
}

function joinClassNames(parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function SidebarRailTab({
  active,
  appearance,
  label,
  title,
  icon,
  onClick,
}: SidebarRailTabProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      title={title}
      onClick={onClick}
      className={joinClassNames([
        "pf-sidebar-rail-tab",
        appearance === "workspace" ? "pf-sidebar-rail-tab--workspace" : "pf-sidebar-rail-tab--classic",
        active ? "is-active" : "",
      ])}
    >
      <span className="pf-sidebar-rail-tab__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="pf-sidebar-rail-tab__label">{label}</span>
    </button>
  );
}
