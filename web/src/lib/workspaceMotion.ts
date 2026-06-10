export const WORKSPACE_CURSOR_X_PROPERTY = "--pf-cursor-x";
export const WORKSPACE_CURSOR_Y_PROPERTY = "--pf-cursor-y";

export interface WorkspacePointerViewport {
  width: number;
  height: number;
  offsetLeft?: number;
  offsetTop?: number;
}

export interface WorkspacePointerCssValues {
  x: string;
  y: string;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function workspacePointerCssValues(
  clientX: number,
  clientY: number,
  viewport: WorkspacePointerViewport,
): WorkspacePointerCssValues {
  const left = finiteOr(viewport.offsetLeft, 0);
  const top = finiteOr(viewport.offsetTop, 0);
  const width = Math.max(1, finiteOr(viewport.width, 1));
  const height = Math.max(1, finiteOr(viewport.height, 1));
  const x = clamp(finiteOr(clientX, left) - left, 0, width);
  const y = clamp(finiteOr(clientY, top) - top, 0, height);

  return {
    x: `${Math.round(x)}px`,
    y: `${Math.round(y)}px`,
  };
}
