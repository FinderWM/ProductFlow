import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const SCALE_STEP = 0.25;

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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function boundedOffsetForElement(element: HTMLElement | null, next: Point, nextScale: number): Point {
  if (nextScale <= MIN_SCALE) {
    return { x: 0, y: 0 };
  }
  const width = element?.clientWidth ?? 0;
  const height = element?.clientHeight ?? 0;
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ pointerId: number; start: Point; offset: Point } | null>(null);
  const [scale, setScale] = useState(MIN_SCALE);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });

  useEffect(() => {
    setScale(MIN_SCALE);
    setOffset({ x: 0, y: 0 });
  }, [src]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !interactive) {
      return;
    }

    const handleNativeWheel = (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      const direction = event.deltaY > 0 ? -1 : 1;
      setScale((currentScale) => {
        const nextScale = clamp(currentScale + direction * SCALE_STEP, MIN_SCALE, MAX_SCALE);
        setOffset((currentOffset) => boundedOffsetForElement(container, currentOffset, nextScale));
        return nextScale;
      });
    };

    container.addEventListener("wheel", handleNativeWheel, { capture: true, passive: false });
    return () => container.removeEventListener("wheel", handleNativeWheel, { capture: true });
  }, [interactive]);

  function boundedOffset(next: Point, nextScale = scale): Point {
    return boundedOffsetForElement(containerRef.current, next, nextScale);
  }

  function updateScale(nextScale: number) {
    if (!interactive) {
      return;
    }
    const resolvedScale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    setScale(resolvedScale);
    setOffset((currentOffset) => boundedOffset(currentOffset, resolvedScale));
  }

  function resetImage() {
    if (!interactive) {
      return;
    }
    setScale(MIN_SCALE);
    setOffset({ x: 0, y: 0 });
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
    setOffset(boundedOffset(nextOffset));
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
    }
  }

  return (
    <div
      ref={containerRef}
      className={`relative flex min-h-0 items-center justify-center overflow-hidden overscroll-contain ${className}`}
    >
      <div
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
