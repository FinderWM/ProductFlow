import {
  actionButtonToneStyle,
  renderActionButtonInner,
  type ActionButtonToneVars,
} from "./actionButtonShared";
import {
  ClassicActionButton,
  classicActionButtonClassName,
  classicActionSurfaceClassName,
} from "./ClassicActionButton";
import {
  WorkspaceActionButton,
  workspaceActionButtonClassName,
  workspaceActionSurfaceClassName,
} from "./WorkspaceActionButton";

export type LayoutActionAppearance = "classic" | "workspace";

export function actionButtonComponentForAppearance(appearance: LayoutActionAppearance) {
  return appearance === "workspace" ? WorkspaceActionButton : ClassicActionButton;
}

export function actionButtonClassNameForAppearance(
  appearance: LayoutActionAppearance,
  options?: Parameters<typeof classicActionButtonClassName>[0],
) {
  return appearance === "workspace" ? workspaceActionButtonClassName(options) : classicActionButtonClassName(options);
}

export function actionSurfaceClassNameForAppearance(
  appearance: LayoutActionAppearance,
  options?: Parameters<typeof classicActionSurfaceClassName>[0],
) {
  return appearance === "workspace"
    ? workspaceActionSurfaceClassName(options)
    : classicActionSurfaceClassName(options);
}

export const transparentActionToneVars: ActionButtonToneVars = {
  "--pf-action-bg": "transparent",
  "--pf-action-bg-hover": "transparent",
  "--pf-action-border": "transparent",
  "--pf-action-border-hover": "transparent",
  "--pf-action-shadow": "none",
  "--pf-action-shadow-hover": "none",
};

export { actionButtonToneStyle, renderActionButtonInner, type ActionButtonToneVars };
