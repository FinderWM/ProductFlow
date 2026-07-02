import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  type TouchEvent,
  type WheelEvent,
} from "react";
import { createPortal } from "react-dom";

import {
  FLOATING_LAYER_Z_INDEX,
  FLOATING_TOUCH_DISMISS_PROTECTION_DURATION_MS,
  createFloatingTouchDismissProtection,
  isFloatingTouchDismissProtectionHit,
  placeFloatingSurface,
  viewportFromVisualViewport,
  type FloatingLayer,
  type FloatingPlacement,
  type FloatingPlacementResult,
  type FloatingTouchDismissProtection,
} from "../lib/floatingSurface";
import { shouldPreventScrollChain } from "../lib/scrollChain";

interface FloatingSurfaceProps {
  open: boolean;
  triggerRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  className?: string;
  preferredPlacement?: FloatingPlacement;
  layer?: FloatingLayer;
  offset?: number;
  margin?: number;
  minWidth?: number;
  matchTriggerWidth?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface TouchPoint {
  x: number;
  y: number;
}

interface TimedTouchPoint extends TouchPoint {
  at: number;
}

function samePlacement(left: FloatingPlacementResult | null, right: FloatingPlacementResult): boolean {
  return (
    left?.left === right.left &&
    left.top === right.top &&
    left.width === right.width &&
    left.maxHeight === right.maxHeight &&
    left.placement === right.placement
  );
}

export function FloatingSurface({
  open,
  triggerRef,
  children,
  className = "",
  preferredPlacement = "bottom-start",
  layer = "popover",
  offset,
  margin,
  minWidth,
  matchTriggerWidth = true,
  onOpenChange,
}: FloatingSurfaceProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const lastTouchPointRef = useRef<TouchPoint | null>(null);
  const pendingTouchDismissProtectionRef = useRef<TimedTouchPoint | null>(null);
  const pendingSurfaceTouchProtectionRef = useRef<TimedTouchPoint | null>(null);
  const dismissProtectionRef = useRef<FloatingTouchDismissProtection | null>(null);
  const dismissProtectionCleanupRef = useRef<(() => void) | null>(null);
  const [placement, setPlacement] = useState<FloatingPlacementResult | null>(null);

  const close = useCallback(() => onOpenChange?.(false), [onOpenChange]);

  const clearDismissProtection = useCallback(() => {
    dismissProtectionCleanupRef.current?.();
    dismissProtectionCleanupRef.current = null;
    dismissProtectionRef.current = null;
  }, []);

  const rememberTouchDismissProtection = useCallback((point: TouchPoint | null) => {
    if (!point) {
      return;
    }
    pendingTouchDismissProtectionRef.current = { ...point, at: Date.now() };
  }, []);

  const rememberSurfaceTouchProtection = useCallback((point: TouchPoint | null) => {
    if (!point) {
      return;
    }
    pendingSurfaceTouchProtectionRef.current = { ...point, at: Date.now() };
  }, []);

  const updatePlacement = useCallback(() => {
    if (!open || typeof window === "undefined") {
      return;
    }
    const triggerElement = triggerRef.current;
    const surfaceElement = surfaceRef.current;
    if (!triggerElement || !surfaceElement) {
      close();
      return;
    }
    const triggerRect = triggerElement.getBoundingClientRect();
    const surfaceRect = surfaceElement.getBoundingClientRect();
    const nextPlacement = placeFloatingSurface({
      triggerRect: {
        x: triggerRect.left,
        y: triggerRect.top,
        width: triggerRect.width,
        height: triggerRect.height,
      },
      surfaceSize: {
        width: surfaceRect.width,
        height: surfaceRect.height,
      },
      viewport: viewportFromVisualViewport(window.visualViewport, window.innerWidth, window.innerHeight),
      preferredPlacement,
      offset,
      margin,
      minWidth,
      matchTriggerWidth,
    });
    setPlacement((current) => (samePlacement(current, nextPlacement) ? current : nextPlacement));
  }, [close, margin, matchTriggerWidth, minWidth, offset, open, preferredPlacement, triggerRef]);

  useLayoutEffect(() => {
    updatePlacement();
  }, [updatePlacement]);

  useEffect(() => {
    if (!open || typeof window === "undefined") {
      setPlacement(null);
      return undefined;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }
      const isSurfaceClick = surfaceRef.current?.contains(target);
      const isTriggerClick = triggerRef.current?.contains(target);

      if (isSurfaceClick || isTriggerClick) {
        return;
      }
      if (event.pointerType === "touch") {
        rememberTouchDismissProtection({ x: event.clientX, y: event.clientY });
      }
      close();
    }

    function handleWindowKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        close();
        triggerRef.current?.focus();
      }
    }

    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleWindowKeyDown);
    window.visualViewport?.addEventListener("resize", updatePlacement);
    window.visualViewport?.addEventListener("scroll", updatePlacement);
    return () => {
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleWindowKeyDown);
      window.visualViewport?.removeEventListener("resize", updatePlacement);
      window.visualViewport?.removeEventListener("scroll", updatePlacement);
    };
  }, [close, open, rememberTouchDismissProtection, triggerRef, updatePlacement]);

  useEffect(() => {
    clearDismissProtection();
    if (open || typeof document === "undefined" || typeof window === "undefined") {
      return undefined;
    }
    const touchPoint = pendingTouchDismissProtectionRef.current;
    if (!touchPoint) {
      return undefined;
    }
    pendingTouchDismissProtectionRef.current = null;
    if (Date.now() - touchPoint.at > FLOATING_TOUCH_DISMISS_PROTECTION_DURATION_MS) {
      return undefined;
    }
    dismissProtectionRef.current = createFloatingTouchDismissProtection(touchPoint);

    const suppressGhostTap = (event: MouseEvent | PointerEvent) => {
      const protection = dismissProtectionRef.current;
      if (
        !protection ||
        !isFloatingTouchDismissProtectionHit(protection, { x: event.clientX, y: event.clientY })
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      // 不要立即清理，让 320ms 超时自然过期，以覆盖完整的触摸事件链
    };

    const timeoutId = window.setTimeout(clearDismissProtection, FLOATING_TOUCH_DISMISS_PROTECTION_DURATION_MS);
    document.addEventListener("pointerdown", suppressGhostTap, true);
    document.addEventListener("click", suppressGhostTap, true);
    document.addEventListener("pointerup", suppressGhostTap, true);
    dismissProtectionCleanupRef.current = () => {
      window.clearTimeout(timeoutId);
      document.removeEventListener("pointerdown", suppressGhostTap, true);
      document.removeEventListener("click", suppressGhostTap, true);
      document.removeEventListener("pointerup", suppressGhostTap, true);
    };
    return clearDismissProtection;
  }, [clearDismissProtection, open]);

  useEffect(() => {
    if (!open || typeof document === "undefined") {
      pendingSurfaceTouchProtectionRef.current = null;
      return undefined;
    }

    const suppressSurfaceGhostTap = (event: MouseEvent | PointerEvent) => {
      const touchPoint = pendingSurfaceTouchProtectionRef.current;
      const target = event.target;
      if (!touchPoint || !(target instanceof Node)) {
        return;
      }
      if (Date.now() - touchPoint.at > FLOATING_TOUCH_DISMISS_PROTECTION_DURATION_MS) {
        pendingSurfaceTouchProtectionRef.current = null;
        return;
      }
      if (surfaceRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      if (
        !isFloatingTouchDismissProtectionHit(
          {
            x: touchPoint.x,
            y: touchPoint.y,
            expiresAt: touchPoint.at + FLOATING_TOUCH_DISMISS_PROTECTION_DURATION_MS,
          },
          { x: event.clientX, y: event.clientY },
        )
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      // 不要立即清理，让超时检查自然过期，以覆盖完整的触摸事件链
    };

    document.addEventListener("pointerdown", suppressSurfaceGhostTap, true);
    document.addEventListener("pointerup", suppressSurfaceGhostTap, true);
    document.addEventListener("click", suppressSurfaceGhostTap, true);
    return () => {
      document.removeEventListener("pointerdown", suppressSurfaceGhostTap, true);
      document.removeEventListener("pointerup", suppressSurfaceGhostTap, true);
      document.removeEventListener("click", suppressSurfaceGhostTap, true);
    };
  }, [open, triggerRef]);

  useEffect(() => {
    if (!open || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const surfaceElement = surfaceRef.current;
    const triggerElement = triggerRef.current;
    if (!surfaceElement || !triggerElement) {
      return undefined;
    }

    const observer = new ResizeObserver(updatePlacement);
    observer.observe(surfaceElement);
    observer.observe(triggerElement);
    return () => observer.disconnect();
  }, [open, triggerRef, updatePlacement]);

  useEffect(() => clearDismissProtection, [clearDismissProtection]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  const portalRoot =
    triggerRef.current?.closest<HTMLElement>("[data-floating-root]") ?? document.body;
  const rootRect = portalRoot === document.body ? null : portalRoot.getBoundingClientRect();

  const style: CSSProperties = {
    position: portalRoot === document.body ? "fixed" : "absolute",
    left: placement ? placement.left - (rootRect?.left ?? 0) + portalRoot.scrollLeft : 0,
    top: placement ? placement.top - (rootRect?.top ?? 0) + portalRoot.scrollTop : 0,
    width: placement?.width,
    maxHeight: placement?.maxHeight,
    zIndex: FLOATING_LAYER_Z_INDEX[layer],
    visibility: placement ? "visible" : "hidden",
    boxSizing: "border-box",
    overscrollBehavior: "contain",
    pointerEvents: "auto",
  };

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (shouldPreventScrollChain(surfaceRef.current, event.target, event.deltaX, event.deltaY)) {
      event.preventDefault();
    }
  }

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    event.stopPropagation();
    event.stopImmediatePropagation();
    const touch = event.touches[0];
    const point = touch ? { x: touch.clientX, y: touch.clientY } : null;
    rememberTouchDismissProtection(point);
    rememberSurfaceTouchProtection(point);
    lastTouchPointRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  }

  function handleTouchMove(event: TouchEvent<HTMLDivElement>) {
    event.stopPropagation();
    event.stopImmediatePropagation();
    const touch = event.touches[0];
    const previous = lastTouchPointRef.current;
    if (!touch || !previous) {
      event.preventDefault();
      return;
    }
    const deltaX = previous.x - touch.clientX;
    const deltaY = previous.y - touch.clientY;
    if (shouldPreventScrollChain(surfaceRef.current, event.target, deltaX, deltaY)) {
      event.preventDefault();
      return;
    }
    lastTouchPointRef.current = { x: touch.clientX, y: touch.clientY };
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.key === "Escape") {
      close();
      triggerRef.current?.focus();
    }
  }

  return createPortal(
    <div
      ref={surfaceRef}
      data-floating-placement={placement?.placement ?? preferredPlacement}
      className={className}
      style={style}
      onPointerDown={(event) => {
        if (event.pointerType === "touch") {
          const point = { x: event.clientX, y: event.clientY };
          rememberTouchDismissProtection(point);
          rememberSurfaceTouchProtection(point);
        }
        event.stopPropagation();
        event.stopImmediatePropagation();
      }}
      onPointerUp={(event) => {
        event.stopPropagation();
        event.stopImmediatePropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
        event.stopImmediatePropagation();
      }}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={(event) => {
        event.stopPropagation();
        event.stopImmediatePropagation();
        lastTouchPointRef.current = null;
      }}
      onTouchCancel={(event) => {
        event.stopPropagation();
        event.stopImmediatePropagation();
        lastTouchPointRef.current = null;
      }}
      onKeyDown={handleKeyDown}
    >
      {children}
    </div>,
    portalRoot,
  );
}
