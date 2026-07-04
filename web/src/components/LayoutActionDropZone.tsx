import type { ReactNode } from "react";

import { ImageDropZone } from "./ImageDropZone";
import { actionSurfaceClassNameForAppearance, type LayoutActionAppearance } from "./layoutActionButtons";
import {
  ACTION_BUTTON_SIZE_CLASSNAME,
  joinActionButtonClassNames,
  type ActionButtonPreset,
  type ActionButtonSize,
} from "./actionButtonShared";

interface LayoutActionDropZoneState {
  isDragging: boolean;
}

interface LayoutActionDropZoneProps {
  appearance: LayoutActionAppearance;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  preset?: ActionButtonPreset;
  size?: ActionButtonSize;
  fullWidth?: boolean;
  focusWithin?: boolean;
  className?: string;
  activeClassName?: string;
  inputClassName?: string;
  ariaLabel?: string;
  onFiles: (files: File[]) => void;
  children: ReactNode | ((state: LayoutActionDropZoneState) => ReactNode);
}

export function LayoutActionDropZone({
  appearance,
  preset = "secondary",
  size = "md",
  fullWidth = false,
  focusWithin = true,
  className,
  activeClassName = "pf-action-surface--active",
  ...dropZoneProps
}: LayoutActionDropZoneProps) {
  return (
    <ImageDropZone
      {...dropZoneProps}
      className={actionSurfaceClassNameForAppearance(appearance, {
        preset,
        focusWithin,
        className: joinActionButtonClassNames([
          "pf-layout-action-drop-zone",
          ACTION_BUTTON_SIZE_CLASSNAME[size],
          fullWidth ? "w-full" : "",
          className,
        ]),
      })}
      activeClassName={activeClassName}
      focusClassName=""
    />
  );
}
