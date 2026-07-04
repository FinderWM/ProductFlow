import type { ButtonHTMLAttributes } from "react";

import {
  actionButtonToneStyle,
  actionSurfaceClassNameForAppearance,
  type ActionButtonToneVars,
  type LayoutActionAppearance,
} from "./layoutActionButtons";
import type { ActionButtonPreset } from "./actionButtonShared";

interface LayoutActionSurfaceButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  appearance: LayoutActionAppearance;
  preset?: ActionButtonPreset;
  focusWithin?: boolean;
  toneVars?: ActionButtonToneVars;
}

export function LayoutActionSurfaceButton({
  appearance,
  preset = "secondary",
  focusWithin = false,
  toneVars,
  className,
  style,
  type = "button",
  children,
  ...buttonProps
}: LayoutActionSurfaceButtonProps) {
  return (
    <button
      type={type}
      className={actionSurfaceClassNameForAppearance(appearance, {
        preset,
        focusWithin,
        className,
      })}
      style={actionButtonToneStyle(toneVars, style)}
      {...buttonProps}
    >
      {children}
    </button>
  );
}
