import { Loader2 } from "lucide-react";
import { forwardRef } from "react";

export {
  ACTION_BUTTON_PRESETS,
  ACTION_BUTTON_SIZES,
  ACTION_BUTTON_SIZE_CLASSNAME,
  actionButtonToneStyle,
  type ActionButtonPreset,
  type ActionButtonSize,
  type ActionButtonToneVarName,
  type ActionButtonToneVars,
} from "./actionButtonShared";
import {
  buildActionButtonClassName,
  buildActionSurfaceClassName,
  actionButtonToneStyle,
  type ActionButtonPreset,
  type ActionButtonSize,
  type BaseActionButtonProps,
} from "./actionButtonShared";
export {
  ClassicActionButton,
  classicActionButtonClassName,
  classicActionSurfaceClassName,
} from "./ClassicActionButton";
export {
  WorkspaceActionButton,
  workspaceActionButtonClassName,
  workspaceActionSurfaceClassName,
} from "./WorkspaceActionButton";

export const ACTION_BUTTON_PRESET_CLASSNAME: Record<ActionButtonPreset, string> = {
  primary: "pf-action-button--primary",
  secondary: "pf-action-button--secondary",
  danger: "pf-action-button--danger",
};

export const ACTION_SURFACE_PRESET_CLASSNAME: Record<ActionButtonPreset, string> = {
  primary: "pf-action-surface--primary",
  secondary: "pf-action-surface--secondary",
  danger: "pf-action-surface--danger",
};

export function actionButtonClassName({
  preset = "primary",
  size = "md",
  fullWidth = false,
  className,
}: {
  preset?: ActionButtonPreset;
  size?: ActionButtonSize;
  fullWidth?: boolean;
  className?: string;
} = {}): string {
  return buildActionButtonClassName({
    baseClassName: "pf-action-button",
    presetClassName: ACTION_BUTTON_PRESET_CLASSNAME,
    preset,
    size,
    fullWidth,
    className,
  });
}

export function actionSurfaceClassName({
  preset = "secondary",
  focusWithin = false,
  className,
}: {
  preset?: ActionButtonPreset;
  focusWithin?: boolean;
  className?: string;
} = {}): string {
  return buildActionSurfaceClassName({
    baseClassName: "pf-action-surface",
    presetClassName: ACTION_SURFACE_PRESET_CLASSNAME,
    preset,
    focusWithin,
    className,
  });
}

export type ActionButtonProps = BaseActionButtonProps;

export const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(function ActionButton(
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
      className={actionButtonClassName({ preset, size, fullWidth, className })}
      disabled={resolvedDisabled}
      style={actionButtonToneStyle(toneVars, style)}
      {...buttonProps}
    >
      {resolvedLeadingIcon ? <span className="pf-action-button__icon">{resolvedLeadingIcon}</span> : null}
      {children ? <span className="pf-action-button__label">{children}</span> : null}
      {resolvedTrailingIcon ? <span className="pf-action-button__icon">{resolvedTrailingIcon}</span> : null}
    </button>
  );
});
