import type { ReactNode } from "react";

import { ActionButton } from "../../components/ActionButton";

interface SidebarTabButtonProps {
  active: boolean;
  label: string;
  title: string;
  icon: ReactNode;
  onClick: () => void;
}

export function SidebarTabButton({
  active,
  label,
  title,
  icon,
  onClick,
}: SidebarTabButtonProps) {
  return (
    <ActionButton
      preset="secondary"
      size="lg"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      leadingIcon={icon}
      className={`min-h-14 w-full min-w-0 flex-col gap-1 px-1 py-2 text-[10px] font-medium transition-spring [&_.pf-action-button__label]:text-center [&_.pf-action-button__label]:leading-tight ${
        active ? "[&_.pf-action-button__icon]:scale-110" : ""
      }`}
    >
      {label}
    </ActionButton>
  );
}
