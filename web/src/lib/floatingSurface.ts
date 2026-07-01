export const FLOATING_LAYER_Z_INDEX = {
  nav: 30,
  stickyAction: 40,
  popover: 50,
  drawerOverlay: 60,
  drawer: 70,
  modalOverlay: 80,
  modal: 90,
  toast: 100,
} as const;

export type FloatingLayer = keyof typeof FLOATING_LAYER_Z_INDEX;
export type FloatingPlacement = "bottom-start" | "bottom-end" | "top-start" | "top-end";

export interface FloatingRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FloatingSize {
  width: number;
  height: number;
}

export interface FloatingViewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisualViewportLike {
  offsetLeft: number;
  offsetTop: number;
  width: number;
  height: number;
}

export interface FloatingPlacementInput {
  triggerRect: FloatingRect;
  surfaceSize: FloatingSize;
  viewport: FloatingViewport;
  preferredPlacement?: FloatingPlacement;
  offset?: number;
  margin?: number;
  minWidth?: number;
  matchTriggerWidth?: boolean;
}

export interface FloatingPlacementResult {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  placement: FloatingPlacement;
}

export interface FloatingTouchDismissProtection {
  x: number;
  y: number;
  expiresAt: number;
}

const DEFAULT_OFFSET = 6;
const DEFAULT_MARGIN = 8;
export const FLOATING_TOUCH_DISMISS_PROTECTION_DURATION_MS = 320;
export const FLOATING_TOUCH_DISMISS_PROTECTION_RADIUS_PX = 28;

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

function placementSide(placement: FloatingPlacement): "top" | "bottom" {
  return placement.startsWith("top") ? "top" : "bottom";
}

function placementAlign(placement: FloatingPlacement): "start" | "end" {
  return placement.endsWith("end") ? "end" : "start";
}

function withSide(placement: FloatingPlacement, side: "top" | "bottom"): FloatingPlacement {
  return `${side}-${placementAlign(placement)}` as FloatingPlacement;
}

export function createFloatingTouchDismissProtection(
  point: { x: number; y: number },
  now = Date.now(),
  durationMs = FLOATING_TOUCH_DISMISS_PROTECTION_DURATION_MS,
): FloatingTouchDismissProtection {
  return {
    x: point.x,
    y: point.y,
    expiresAt: now + durationMs,
  };
}

export function isFloatingTouchDismissProtectionHit(
  protection: FloatingTouchDismissProtection,
  point: { x: number; y: number },
  now = Date.now(),
  radiusPx = FLOATING_TOUCH_DISMISS_PROTECTION_RADIUS_PX,
): boolean {
  if (now > protection.expiresAt) {
    return false;
  }
  const deltaX = protection.x - point.x;
  const deltaY = protection.y - point.y;
  return deltaX * deltaX + deltaY * deltaY <= radiusPx * radiusPx;
}

export function viewportFromVisualViewport(
  visualViewport: VisualViewportLike | null | undefined,
  fallbackWidth: number,
  fallbackHeight: number,
): FloatingViewport {
  if (!visualViewport) {
    return { x: 0, y: 0, width: fallbackWidth, height: fallbackHeight };
  }
  return {
    x: visualViewport.offsetLeft,
    y: visualViewport.offsetTop,
    width: visualViewport.width,
    height: visualViewport.height,
  };
}

export function placeFloatingSurface({
  triggerRect,
  surfaceSize,
  viewport,
  preferredPlacement = "bottom-start",
  offset = DEFAULT_OFFSET,
  margin = DEFAULT_MARGIN,
  minWidth = 0,
  matchTriggerWidth = true,
}: FloatingPlacementInput): FloatingPlacementResult {
  const viewportLeft = viewport.x + margin;
  const viewportTop = viewport.y + margin;
  const viewportRight = viewport.x + viewport.width - margin;
  const viewportBottom = viewport.y + viewport.height - margin;
  const availableWidth = Math.max(0, viewportRight - viewportLeft);
  const desiredWidth = matchTriggerWidth
    ? Math.max(surfaceSize.width, triggerRect.width, minWidth)
    : Math.max(surfaceSize.width, minWidth);
  const width = Math.min(desiredWidth, availableWidth);

  const belowTop = triggerRect.y + triggerRect.height + offset;
  const aboveBottom = triggerRect.y - offset;
  const availableBelow = Math.max(0, viewportBottom - belowTop);
  const availableAbove = Math.max(0, aboveBottom - viewportTop);
  const preferredSide = placementSide(preferredPlacement);
  const shouldFlipToTop =
    preferredSide === "bottom" && surfaceSize.height > availableBelow && availableAbove > availableBelow;
  const shouldFlipToBottom =
    preferredSide === "top" && surfaceSize.height > availableAbove && availableBelow > availableAbove;
  const side = shouldFlipToTop ? "top" : shouldFlipToBottom ? "bottom" : preferredSide;
  const placement = withSide(preferredPlacement, side);
  const availableHeight = side === "top" ? availableAbove : availableBelow;
  const maxHeight = Math.max(0, availableHeight);
  const visibleHeight = Math.min(surfaceSize.height, maxHeight);

  const alignedLeft =
    placementAlign(placement) === "end" ? triggerRect.x + triggerRect.width - width : triggerRect.x;
  const left = clamp(alignedLeft, viewportLeft, viewportRight - width);
  const unclampedTop = side === "top" ? triggerRect.y - offset - visibleHeight : belowTop;
  const top = clamp(unclampedTop, viewportTop, viewportBottom - visibleHeight);

  return {
    left,
    top,
    width,
    maxHeight,
    placement,
  };
}
