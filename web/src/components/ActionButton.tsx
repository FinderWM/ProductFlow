import { Loader2 } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";

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

export const ACTION_BUTTON_SIZE_CLASSNAME: Record<ActionButtonSize, string> = {
  sm: "pf-action-button--sm",
  md: "pf-action-button--md",
  lg: "pf-action-button--lg",
  "icon-sm": "pf-action-button--icon-sm",
  "icon-md": "pf-action-button--icon-md",
  "icon-lg": "pf-action-button--icon-lg",
};

function joinClassNames(parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

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
  return joinClassNames([
    "pf-action-button",
    ACTION_BUTTON_PRESET_CLASSNAME[preset],
    ACTION_BUTTON_SIZE_CLASSNAME[size],
    fullWidth ? "w-full" : "",
    className,
  ]);
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
  return joinClassNames([
    "pf-action-surface",
    ACTION_SURFACE_PRESET_CLASSNAME[preset],
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

export interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  preset?: ActionButtonPreset;
  size?: ActionButtonSize;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  loading?: boolean;
  fullWidth?: boolean;
  toneVars?: ActionButtonToneVars;
}

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
