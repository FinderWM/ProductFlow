import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const SCALE_STEP = 0.2;
const MAX_WHEEL_DELTA_PX = 120;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;

interface ZoomableImageProps {
  src: string;
  alt: string;
  zoomInLabel: string;
  zoomOutLabel: string;
  resetLabel: string;
  interactive?: boolean;
  className?: string;
  imageClassName?: string;
}

interface Point {
  x: number;
  y: number;
}

interface ImageTransformState {
  scale: number;
  offset: Point;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function normalizeWheelDelta(delta: number, deltaMode: number, pageSize: number) {
  if (deltaMode === 1) {
    return delta * 16;
  }
  if (deltaMode === 2) {
    return delta * pageSize;
  }
  return delta;
}

export function nextWheelZoomScale(currentScale: number, deltaY: number, deltaMode: number, pageSize: number) {
  const deltaPixels = normalizeWheelDelta(deltaY, deltaMode, pageSize);
  if (!Number.isFinite(deltaPixels) || deltaPixels === 0) {
    return currentScale;
  }
  const boundedDelta = clamp(deltaPixels, -MAX_WHEEL_DELTA_PX, MAX_WHEEL_DELTA_PX);
  const zoomFactor = Math.exp(-boundedDelta * WHEEL_ZOOM_SENSITIVITY);
  return clamp(currentScale * zoomFactor, MIN_SCALE, MAX_SCALE);
}

export function anchoredOffsetFromPointer(currentOffset: Point, pointerDeltaFromImageCenter: Point, scaleRatio: number): Point {
  if (!Number.isFinite(scaleRatio) || scaleRatio === 1) {
    return currentOffset;
  }
  return {
    x: currentOffset.x - pointerDeltaFromImageCenter.x * (scaleRatio - 1),
    y: currentOffset.y - pointerDeltaFromImageCenter.y * (scaleRatio - 1),
  };
}

function boundedOffsetForElement(
  surfaceElement: HTMLElement | null,
  imageElement: HTMLImageElement | null,
  next: Point,
  nextScale: number,
): Point {
  if (nextScale <= MIN_SCALE) {
    return { x: 0, y: 0 };
  }
  const width = imageElement?.clientWidth || surfaceElement?.clientWidth || 0;
  const height = imageElement?.clientHeight || surfaceElement?.clientHeight || 0;
  const maxX = (width * (nextScale - 1)) / 2;
  const maxY = (height * (nextScale - 1)) / 2;
  return {
    x: clamp(next.x, -maxX, maxX),
    y: clamp(next.y, -maxY, maxY),
  };
}

export function ZoomableImage({
  src,
  alt,
  zoomInLabel,
  zoomOutLabel,
  resetLabel,
  interactive = true,
  className = "",
  imageClassName = "",
}: ZoomableImageProps) {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ pointerId: number; start: Point; offset: Point } | null>(null);
  const [transform, setTransform] = useState<ImageTransformState>({
    scale: MIN_SCALE,
    offset: { x: 0, y: 0 },
  });
  const { scale, offset } = transform;

  useEffect(() => {
    setTransform({
      scale: MIN_SCALE,
      offset: { x: 0, y: 0 },
    });
  }, [src]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || !interactive) {
      return;
    }

    const handleNativeWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const surfaceRect = surface.getBoundingClientRect();
      const pointerWithinSurface = {
        x: event.clientX - surfaceRect.left,
        y: event.clientY - surfaceRect.top,
      };
      const surfaceCenter = {
        x: surface.clientWidth / 2,
        y: surface.clientHeight / 2,
      };

      setTransform((current) => {
        const nextScale = nextWheelZoomScale(current.scale, event.deltaY, event.deltaMode, surface.clientHeight || window.innerHeight);
        if (nextScale === current.scale) {
          return current;
        }
        const pointerDeltaFromImageCenter = {
          x: pointerWithinSurface.x - surfaceCenter.x - current.offset.x,
          y: pointerWithinSurface.y - surfaceCenter.y - current.offset.y,
        };
        const nextOffset = anchoredOffsetFromPointer(
          current.offset,
          pointerDeltaFromImageCenter,
          nextScale / current.scale,
        );

        return {
          scale: nextScale,
          offset: boundedOffsetForElement(surfaceRef.current, imageRef.current, nextOffset, nextScale),
        };
      });
    };

    surface.addEventListener("wheel", handleNativeWheel, { capture: true, passive: false });
    return () => surface.removeEventListener("wheel", handleNativeWheel, { capture: true });
  }, [interactive]);

  function boundedOffset(next: Point, nextScale = scale): Point {
    return boundedOffsetForElement(surfaceRef.current, imageRef.current, next, nextScale);
  }

  function updateScale(nextScale: number) {
    if (!interactive) {
      return;
    }
    setTransform((current) => {
      const resolvedScale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
      return {
        scale: resolvedScale,
        offset: boundedOffset(current.offset, resolvedScale),
      };
    });
  }

  function resetImage() {
    if (!interactive) {
      return;
    }
    setTransform({
      scale: MIN_SCALE,
      offset: { x: 0, y: 0 },
    });
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!interactive || scale <= MIN_SCALE) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      offset,
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const nextOffset = {
      x: drag.offset.x + event.clientX - drag.start.x,
      y: drag.offset.y + event.clientY - drag.start.y,
    };
    setTransform((current) => ({
      ...current,
      offset: boundedOffset(nextOffset, current.scale),
    }));
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  }

  return (
    <div
      className={`relative flex min-h-0 items-center justify-center overflow-hidden overscroll-contain ${className}`}
    >
      <div
        ref={surfaceRef}
        className={`flex h-full w-full items-center justify-center ${
          interactive ? (scale > MIN_SCALE ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in") : "cursor-default"
        }`}
        style={{ touchAction: "none" }}
        onDoubleClick={interactive ? (scale > MIN_SCALE ? resetImage : () => updateScale(MIN_SCALE + SCALE_STEP * 4)) : undefined}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
      >
        <img
          ref={imageRef}
          src={src}
          alt={alt}
          decoding="async"
          draggable={false}
          className={`max-h-full max-w-full select-none object-contain ${imageClassName}`}
          style={{
            transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
            transformOrigin: "center",
          }}
        />
      </div>
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-white/15 bg-slate-950/78 p-1.5 text-white shadow-lg shadow-black/25 backdrop-blur">
        <button
          type="button"
          onClick={() => updateScale(scale - SCALE_STEP)}
          disabled={!interactive || scale <= MIN_SCALE}
          title={zoomOutLabel}
          aria-label={zoomOutLabel}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/12 hover:text-white disabled:opacity-40"
        >
          <ZoomOut size={16} />
        </button>
        <button
          type="button"
          onClick={resetImage}
          disabled={!interactive || (scale <= MIN_SCALE && offset.x === 0 && offset.y === 0)}
          title={resetLabel}
          aria-label={resetLabel}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/12 hover:text-white disabled:opacity-40"
        >
          <RotateCcw size={15} />
        </button>
        <button
          type="button"
          onClick={() => updateScale(scale + SCALE_STEP)}
          disabled={!interactive || scale >= MAX_SCALE}
          title={zoomInLabel}
          aria-label={zoomInLabel}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/12 hover:text-white disabled:opacity-40"
        >
          <ZoomIn size={16} />
        </button>
      </div>
    </div>
  );
}
