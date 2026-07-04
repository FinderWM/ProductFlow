import { Loader2 } from "lucide-react";
import { forwardRef } from "react";

import {
  actionButtonToneStyle,
  buildActionButtonClassName,
  buildActionSurfaceClassName,
  renderActionButtonInner,
  type ActionButtonPreset,
  type BaseActionButtonProps,
} from "./actionButtonShared";

export const WORKSPACE_ACTION_BUTTON_PRESET_CLASSNAME: Record<ActionButtonPreset, string> = {
  primary: "pf-workspace-action-button--primary",
  secondary: "pf-workspace-action-button--secondary",
  danger: "pf-workspace-action-button--danger",
};

export const WORKSPACE_ACTION_SURFACE_PRESET_CLASSNAME: Record<ActionButtonPreset, string> = {
  primary: "pf-workspace-action-surface--primary",
  secondary: "pf-workspace-action-surface--secondary",
  danger: "pf-workspace-action-surface--danger",
};

export function workspaceActionButtonClassName({
  preset = "primary",
  size = "md",
  fullWidth = false,
  className,
}: {
  preset?: ActionButtonPreset;
  size?: BaseActionButtonProps["size"];
  fullWidth?: boolean;
  className?: string;
} = {}): string {
  return buildActionButtonClassName({
    baseClassName: "pf-workspace-action-button",
    presetClassName: WORKSPACE_ACTION_BUTTON_PRESET_CLASSNAME,
    preset,
    size,
    fullWidth,
    className,
  });
}

export function workspaceActionSurfaceClassName({
  preset = "secondary",
  focusWithin = false,
  className,
}: {
  preset?: ActionButtonPreset;
  focusWithin?: boolean;
  className?: string;
} = {}): string {
  return buildActionSurfaceClassName({
    baseClassName: "pf-workspace-action-surface",
    presetClassName: WORKSPACE_ACTION_SURFACE_PRESET_CLASSNAME,
    preset,
    focusWithin,
    className,
  });
}

export type WorkspaceActionButtonProps = BaseActionButtonProps;

export const WorkspaceActionButton = forwardRef<HTMLButtonElement, WorkspaceActionButtonProps>(function WorkspaceActionButton(
  {
    preset = "primary",
    size = "md",
    leadingIcon,
    trailingIcon,
    loading = false,
    fullWidth = false,
    toneVars,
    className,
    disabled,
    style,
    children,
    type = "button",
    ...buttonProps
  },
  ref,
) {
  const resolvedLeadingIcon = loading ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : leadingIcon;
  const resolvedTrailingIcon = loading ? null : trailingIcon;
  const resolvedDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      type={type}
      className={workspaceActionButtonClassName({ preset, size, fullWidth, className })}
      disabled={resolvedDisabled}
      style={actionButtonToneStyle(toneVars, style)}
      {...buttonProps}
    >
      {renderActionButtonInner({
        leadingIcon: resolvedLeadingIcon,
        label: children,
        trailingIcon: resolvedTrailingIcon,
      })}
    </button>
  );
});
