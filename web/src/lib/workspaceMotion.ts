export const WORKSPACE_CURSOR_X_PROPERTY = "--pf-cursor-x";
export const WORKSPACE_CURSOR_Y_PROPERTY = "--pf-cursor-y";

/** Dedicated ambient layer node — transform updated directly (not via root CSS vars). */
export const WORKSPACE_AMBIENT_GLOW_CLASS = "pf-workspace-ambient-glow";

/** Snap pointer CSS updates so ambient glow is not rewritten every sub-pixel frame. */
export const WORKSPACE_POINTER_QUANTUM_PX = 8;

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

export function quantizeWorkspacePointerCoordinate(value: number, quantumPx = WORKSPACE_POINTER_QUANTUM_PX): number {
  const step = Math.max(1, finiteOr(quantumPx, WORKSPACE_POINTER_QUANTUM_PX));
  return Math.round(value / step) * step;
}

export function workspacePointerCssValues(
  clientX: number,
  clientY: number,
  viewport: WorkspacePointerViewport,
  quantumPx = WORKSPACE_POINTER_QUANTUM_PX,
): WorkspacePointerCssValues {
  const left = finiteOr(viewport.offsetLeft, 0);
  const top = finiteOr(viewport.offsetTop, 0);
  const width = Math.max(1, finiteOr(viewport.width, 1));
  const height = Math.max(1, finiteOr(viewport.height, 1));
  const x = quantizeWorkspacePointerCoordinate(clamp(finiteOr(clientX, left) - left, 0, width), quantumPx);
  const y = quantizeWorkspacePointerCoordinate(clamp(finiteOr(clientY, top) - top, 0, height), quantumPx);

  return {
    x: `${x}px`,
    y: `${y}px`,
  };
}

export function workspaceAmbientGlowTransform(values: WorkspacePointerCssValues): string {
  return `translate3d(${values.x}, ${values.y}, 0)`;
}
