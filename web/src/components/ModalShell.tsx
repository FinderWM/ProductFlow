import {
  useEffect,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type TouchEvent,
  type WheelEvent,
} from "react";
import { createPortal } from "react-dom";

type ModalRole = "dialog" | "alertdialog";
type ModalPanelElement = "div" | "form" | "section" | "aside";
type DataAttributes = {
  [key: `data-${string}`]: string | number | boolean | undefined;
};

interface ModalBodyLockSnapshot {
  scrollY: number;
  htmlOverflow: string;
  htmlOverscrollBehavior: string;
  bodyOverflow: string;
  bodyOverscrollBehavior: string;
  bodyPosition: string;
  bodyTop: string;
  bodyLeft: string;
  bodyRight: string;
  bodyWidth: string;
}

interface ModalShellProps {
  children: ReactNode;
  open?: boolean;
  role?: ModalRole;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  overlayClassName?: string;
  panelClassName?: string;
  panelElement?: ModalPanelElement;
  overlayProps?: HTMLAttributes<HTMLDivElement> & DataAttributes;
  panelProps?: HTMLAttributes<HTMLElement> & DataAttributes;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  closeDisabled?: boolean;
  lockBodyScroll?: boolean;
  renderPanel?: boolean;
  onClose?: () => void;
}

let bodyLockCount = 0;
let bodyLockSnapshot: ModalBodyLockSnapshot | null = null;

function mergeClassNames(...classNames: Array<string | undefined>): string {
  return classNames.filter(Boolean).join(" ");
}

function lockBodyScroll(): void {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return;
  }
  bodyLockCount += 1;
  if (bodyLockCount > 1) {
    return;
  }

  const root = document.documentElement;
  const body = document.body;
  bodyLockSnapshot = {
    scrollY: window.scrollY,
    htmlOverflow: root.style.overflow,
    htmlOverscrollBehavior: root.style.overscrollBehavior,
    bodyOverflow: body.style.overflow,
    bodyOverscrollBehavior: body.style.overscrollBehavior,
    bodyPosition: body.style.position,
    bodyTop: body.style.top,
    bodyLeft: body.style.left,
    bodyRight: body.style.right,
    bodyWidth: body.style.width,
  };

  root.style.overflow = "hidden";
  root.style.overscrollBehavior = "none";
  body.style.overflow = "hidden";
  body.style.overscrollBehavior = "none";
  body.style.position = "fixed";
  body.style.top = `-${bodyLockSnapshot.scrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
}

function unlockBodyScroll(): void {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return;
  }
  bodyLockCount = Math.max(0, bodyLockCount - 1);
  if (bodyLockCount > 0 || !bodyLockSnapshot) {
    return;
  }

  const root = document.documentElement;
  const body = document.body;
  const snapshot = bodyLockSnapshot;
  root.style.overflow = snapshot.htmlOverflow;
  root.style.overscrollBehavior = snapshot.htmlOverscrollBehavior;
  body.style.overflow = snapshot.bodyOverflow;
  body.style.overscrollBehavior = snapshot.bodyOverscrollBehavior;
  body.style.position = snapshot.bodyPosition;
  body.style.top = snapshot.bodyTop;
  body.style.left = snapshot.bodyLeft;
  body.style.right = snapshot.bodyRight;
  body.style.width = snapshot.bodyWidth;
  bodyLockSnapshot = null;
  window.scrollTo({ top: snapshot.scrollY });
}

export function ModalShell({
  children,
  open = true,
  role = "dialog",
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  overlayClassName,
  panelClassName,
  panelElement = "div",
  overlayProps,
  panelProps,
  closeOnBackdrop = true,
  closeOnEscape = true,
  closeDisabled = false,
  lockBodyScroll: shouldLockBodyScroll = true,
  renderPanel = true,
  onClose,
}: ModalShellProps) {
  useEffect(() => {
    if (!open || !shouldLockBodyScroll) {
      return undefined;
    }
    lockBodyScroll();
    return unlockBodyScroll;
  }, [open, shouldLockBodyScroll]);

  useEffect(() => {
    if (!open || !closeOnEscape || !onClose) {
      return undefined;
    }
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape" || closeDisabled) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      onClose?.();
    }
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [closeDisabled, closeOnEscape, onClose, open]);

  if (!open) {
    return null;
  }

  const handleBackdropPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    overlayProps?.onPointerDown?.(event);
    if (event.defaultPrevented) {
      return;
    }
    event.stopPropagation();
    if (event.target === event.currentTarget && closeOnBackdrop && !closeDisabled) {
      onClose?.();
    }
  };

  const stopMousePropagation = (event: MouseEvent<HTMLDivElement>) => {
    overlayProps?.onMouseDown?.(event);
    event.stopPropagation();
  };

  const stopClickPropagation = (event: MouseEvent<HTMLDivElement>) => {
    overlayProps?.onClick?.(event);
    event.stopPropagation();
  };

  const stopWheelPropagation = (event: WheelEvent<HTMLDivElement>) => {
    overlayProps?.onWheel?.(event);
    event.stopPropagation();
  };

  const stopTouchPropagation = (event: TouchEvent<HTMLDivElement>) => {
    overlayProps?.onTouchMove?.(event);
    event.stopPropagation();
  };

  const stopKeyPropagation = (event: KeyboardEvent<HTMLDivElement>) => {
    overlayProps?.onKeyDown?.(event);
    event.stopPropagation();
  };

  const PanelElement = panelElement;
  const panel = renderPanel ? (
    <PanelElement
      {...panelProps}
      role={role}
      aria-modal="true"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-describedby={ariaDescribedBy}
      className={mergeClassNames(panelClassName, panelProps?.className)}
    >
      {children}
    </PanelElement>
  ) : (
    children
  );

  const shell = (
    <div
      {...overlayProps}
      className={mergeClassNames(
        "fixed inset-0 flex items-center justify-center overflow-hidden overscroll-contain",
        overlayClassName,
        overlayProps?.className,
      )}
      onPointerDown={handleBackdropPointerDown}
      onMouseDown={stopMousePropagation}
      onClick={stopClickPropagation}
      onWheel={stopWheelPropagation}
      onTouchMove={stopTouchPropagation}
      onKeyDown={stopKeyPropagation}
    >
      {panel}
    </div>
  );

  return typeof document === "undefined" ? shell : createPortal(shell, document.body);
}
