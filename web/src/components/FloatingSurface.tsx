import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

import {
  FLOATING_LAYER_Z_INDEX,
  placeFloatingSurface,
  viewportFromVisualViewport,
  type FloatingLayer,
  type FloatingPlacement,
  type FloatingPlacementResult,
} from "../lib/floatingSurface";

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
  const [placement, setPlacement] = useState<FloatingPlacementResult | null>(null);

  const close = useCallback(() => onOpenChange?.(false), [onOpenChange]);

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
      if (surfaceRef.current?.contains(target) || triggerRef.current?.contains(target)) {
        return;
      }
      close();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        close();
        triggerRef.current?.focus();
      }
    }

    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.visualViewport?.addEventListener("resize", updatePlacement);
    window.visualViewport?.addEventListener("scroll", updatePlacement);
    return () => {
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.visualViewport?.removeEventListener("resize", updatePlacement);
      window.visualViewport?.removeEventListener("scroll", updatePlacement);
    };
  }, [close, open, triggerRef, updatePlacement]);

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

  if (!open || typeof document === "undefined") {
    return null;
  }

  const style: CSSProperties = {
    position: "fixed",
    left: placement?.left ?? 0,
    top: placement?.top ?? 0,
    width: placement?.width,
    maxHeight: placement?.maxHeight,
    zIndex: FLOATING_LAYER_Z_INDEX[layer],
    visibility: placement ? "visible" : "hidden",
    boxSizing: "border-box",
  };

  return createPortal(
    <div
      ref={surfaceRef}
      data-floating-placement={placement?.placement ?? preferredPlacement}
      className={className}
      style={style}
    >
      {children}
    </div>,
    document.body,
  );
}
