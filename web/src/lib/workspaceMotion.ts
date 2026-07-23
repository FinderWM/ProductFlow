export const WORKSPACE_CURSOR_X_PROPERTY = "--pf-cursor-x";
export const WORKSPACE_CURSOR_Y_PROPERTY = "--pf-cursor-y";

/** Dedicated ambient layer node — transform updated directly (not via root CSS vars). */
export const WORKSPACE_AMBIENT_GLOW_CLASS = "pf-workspace-ambient-glow";

/** Snap pointer CSS updates so ambient glow is not rewritten every sub-pixel frame. */
export const WORKSPACE_POINTER_QUANTUM_PX = 8;

/** Drop ambient will-change shortly after the pointer stops moving. */
export const WORKSPACE_AMBIENT_IDLE_MS = 400;

/** Root dataset value while the document is visible and workspace motion may run. */
export const WORKSPACE_DOCUMENT_MOTION_ACTIVE = "active";

/** Root dataset value while the document is hidden — CSS animations stay paused. */
export const WORKSPACE_DOCUMENT_MOTION_PAUSED = "paused";

/** Root dataset key toggled with document visibility. */
export const WORKSPACE_DOCUMENT_MOTION_DATASET = "workspaceDocumentMotion";

/** Element attribute toggled by the shared home IntersectionObserver. */
export const WORKSPACE_MOTION_INVIEW_ATTR = "data-workspace-motion-inview";

/** Root dataset key for short weather-logo CSS pulse. */
export const WEATHER_LOGO_MOTION_DATASET = "weatherMotion";

/** Root dataset value while weather logo animations may run. */
export const WEATHER_LOGO_MOTION_PULSE = "pulse";

/** Weather logo pulse duration (refresh or hover). */
export const WEATHER_LOGO_MOTION_MS = 5000;

let weatherLogoMotionTimer = 0;

/** Pulse weather logo animations once for ~5s; re-trigger restarts the window. */
export function pulseWeatherLogoMotion(durationMs = WEATHER_LOGO_MOTION_MS): void {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return;
  }
  const root = document.documentElement;
  // Drop then re-set so CSS animations restart even when already pulsing.
  delete root.dataset[WEATHER_LOGO_MOTION_DATASET];
  // Force style recompute so the next assignment is treated as a fresh transition.
  void root.offsetWidth;
  root.dataset[WEATHER_LOGO_MOTION_DATASET] = WEATHER_LOGO_MOTION_PULSE;
  if (weatherLogoMotionTimer !== 0) {
    window.clearTimeout(weatherLogoMotionTimer);
  }
  weatherLogoMotionTimer = window.setTimeout(() => {
    weatherLogoMotionTimer = 0;
    if (root.dataset[WEATHER_LOGO_MOTION_DATASET] === WEATHER_LOGO_MOTION_PULSE) {
      delete root.dataset[WEATHER_LOGO_MOTION_DATASET];
    }
  }, Math.max(0, durationMs));
}

export function clearWeatherLogoMotion(): void {
  if (typeof document === "undefined") {
    return;
  }
  if (typeof window !== "undefined" && weatherLogoMotionTimer !== 0) {
    window.clearTimeout(weatherLogoMotionTimer);
    weatherLogoMotionTimer = 0;
  }
  delete document.documentElement.dataset[WEATHER_LOGO_MOTION_DATASET];
}

/**
 * Ambient glow follows the pointer only on bare shell background — not over page UI
 * descendants of `.pf-workspace` / `.pf-app`.
 */
export function workspaceAmbientPointerOnBackground(
  target: EventTarget | null,
  host: Element | null,
): boolean {
  if (!(target instanceof Element) || !host) {
    return false;
  }
  if (target.classList.contains(WORKSPACE_AMBIENT_GLOW_CLASS)) {
    return true;
  }
  return target === host;
}

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

export function workspaceDocumentMotionState(documentHidden: boolean): typeof WORKSPACE_DOCUMENT_MOTION_ACTIVE | typeof WORKSPACE_DOCUMENT_MOTION_PAUSED {
  return documentHidden ? WORKSPACE_DOCUMENT_MOTION_PAUSED : WORKSPACE_DOCUMENT_MOTION_ACTIVE;
}

/** Continuous JS/CSS motion runs only when the target is on-screen and the tab is visible. */
export function workspaceContinuousMotionAllowed({
  inView,
  documentHidden,
}: {
  inView: boolean;
  documentHidden: boolean;
}): boolean {
  return inView && !documentHidden;
}

export function workspaceGalleryTrackTransform(offsetPx: number): string {
  const offset = Math.max(0, finiteOr(offsetPx, 0));
  return `translate3d(${-offset}px, 0, 0)`;
}

export function workspaceGalleryMaxOffset(trackWidth: number, viewportWidth: number): number {
  return Math.max(0, finiteOr(trackWidth, 0) - finiteOr(viewportWidth, 0));
}

export function workspaceGalleryClampOffset(offsetPx: number, maxOffset: number): number {
  return clamp(finiteOr(offsetPx, 0), 0, Math.max(0, finiteOr(maxOffset, 0)));
}
