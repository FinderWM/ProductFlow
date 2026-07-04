import { createElement, Fragment, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";

export const ACTION_BUTTON_PRESETS = ["primary", "secondary", "danger"] as const;
export type ActionButtonPreset = (typeof ACTION_BUTTON_PRESETS)[number];

export const ACTION_BUTTON_SIZES = ["sm", "md", "lg", "icon-sm", "icon-md", "icon-lg"] as const;
export type ActionButtonSize = (typeof ACTION_BUTTON_SIZES)[number];

export type ActionButtonToneVarName =
  | "--pf-action-bg"
  | "--pf-action-bg-hover"
  | "--pf-action-border"
  | "--pf-action-border-hover"
  | "--pf-action-text"
  | "--pf-action-shadow"
  | "--pf-action-shadow-hover"
  | "--pf-action-focus-ring";

export type ActionButtonToneVars = Partial<Record<ActionButtonToneVarName, string>>;

export const ACTION_BUTTON_SIZE_CLASSNAME: Record<ActionButtonSize, string> = {
  sm: "pf-action-button--sm",
  md: "pf-action-button--md",
  lg: "pf-action-button--lg",
  "icon-sm": "pf-action-button--icon-sm",
  "icon-md": "pf-action-button--icon-md",
  "icon-lg": "pf-action-button--icon-lg",
};

export interface BaseActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  preset?: ActionButtonPreset;
  size?: ActionButtonSize;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
  toneVars?: ActionButtonToneVars;
}

export function joinActionButtonClassNames(parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function buildActionButtonClassName({
  baseClassName,
  presetClassName,
  preset = "primary",
  size = "md",
  fullWidth = false,
  className,
}: {
  baseClassName: string;
  presetClassName: Record<ActionButtonPreset, string>;
  preset?: ActionButtonPreset;
  size?: ActionButtonSize;
  fullWidth?: boolean;
  className?: string;
}): string {
  return joinActionButtonClassNames([
    baseClassName,
    presetClassName[preset],
    ACTION_BUTTON_SIZE_CLASSNAME[size],
    fullWidth ? "w-full" : "",
    className,
  ]);
}

export function buildActionSurfaceClassName({
  baseClassName,
  presetClassName,
  preset = "secondary",
  focusWithin = false,
  className,
}: {
  baseClassName: string;
  presetClassName: Record<ActionButtonPreset, string>;
  preset?: ActionButtonPreset;
  focusWithin?: boolean;
  className?: string;
}): string {
  return joinActionButtonClassNames([
    baseClassName,
    presetClassName[preset],
    focusWithin ? "pf-action-surface-focus" : "",
    className,
  ]);
}

export function actionButtonToneStyle(toneVars?: ActionButtonToneVars, style?: CSSProperties): CSSProperties | undefined {
  if (!toneVars && !style) {
    return undefined;
  }
  return { ...(toneVars ?? {}), ...(style ?? {}) } as CSSProperties;
}

export function renderActionButtonInner({
  leadingIcon,
  label,
  trailingIcon,
}: {
  leadingIcon?: ReactNode;
  label?: ReactNode;
  trailingIcon?: ReactNode;
}) {
  return createElement(
    Fragment,
    null,
    leadingIcon ? createElement("span", { className: "pf-action-button__icon" }, leadingIcon) : null,
    label ? createElement("span", { className: "pf-action-button__label" }, label) : null,
    trailingIcon ? createElement("span", { className: "pf-action-button__icon" }, trailingIcon) : null,
  );
}
