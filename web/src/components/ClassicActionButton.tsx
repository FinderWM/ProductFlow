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

export const CLASSIC_ACTION_BUTTON_PRESET_CLASSNAME: Record<ActionButtonPreset, string> = {
  primary: "pf-classic-action-button--primary",
  secondary: "pf-classic-action-button--secondary",
  danger: "pf-classic-action-button--danger",
};

export const CLASSIC_ACTION_SURFACE_PRESET_CLASSNAME: Record<ActionButtonPreset, string> = {
  primary: "pf-classic-action-surface--primary",
  secondary: "pf-classic-action-surface--secondary",
  danger: "pf-classic-action-surface--danger",
};

export function classicActionButtonClassName({
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
    baseClassName: "pf-classic-action-button",
    presetClassName: CLASSIC_ACTION_BUTTON_PRESET_CLASSNAME,
    preset,
    size,
    fullWidth,
    className,
  });
}

export function classicActionSurfaceClassName({
  preset = "secondary",
  focusWithin = false,
  className,
}: {
  preset?: ActionButtonPreset;
  focusWithin?: boolean;
  className?: string;
} = {}): string {
  return buildActionSurfaceClassName({
    baseClassName: "pf-classic-action-surface",
    presetClassName: CLASSIC_ACTION_SURFACE_PRESET_CLASSNAME,
    preset,
    focusWithin,
    className,
  });
}

export type ClassicActionButtonProps = BaseActionButtonProps;

export const ClassicActionButton = forwardRef<HTMLButtonElement, ClassicActionButtonProps>(function ClassicActionButton(
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
      className={classicActionButtonClassName({ preset, size, fullWidth, className })}
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
