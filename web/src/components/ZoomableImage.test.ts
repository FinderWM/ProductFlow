import { describe, expect, it } from "vitest";

import { anchoredOffsetFromPointer, nextWheelZoomScale, normalizeWheelDelta } from "./ZoomableImage";

describe("ZoomableImage helpers", () => {
  it("normalizes wheel delta units to pixels", () => {
    expect(normalizeWheelDelta(3, 0, 640)).toBe(3);
    expect(normalizeWheelDelta(3, 1, 640)).toBe(48);
    expect(normalizeWheelDelta(1, 2, 640)).toBe(640);
  });

  it("uses wheel magnitude for slower zoom steps and clamps the result", () => {
    expect(nextWheelZoomScale(1, -100, 0, 800)).toBeCloseTo(1.161834, 6);
    expect(nextWheelZoomScale(4.95, -1000, 0, 800)).toBe(5);
    expect(nextWheelZoomScale(1.02, 1000, 0, 800)).toBe(1);
  });

  it("keeps the pointer anchor stable when applying the next offset", () => {
    const currentScale = 1.6;
    const nextScale = 2.2;
    const currentOffset = { x: 34, y: -18 };
    const pointerDeltaFromImageCenter = { x: 52, y: -27 };
    const nextOffset = anchoredOffsetFromPointer(
      currentOffset,
      pointerDeltaFromImageCenter,
      nextScale / currentScale,
    );
    const localPoint = {
      x: pointerDeltaFromImageCenter.x / currentScale,
      y: pointerDeltaFromImageCenter.y / currentScale,
    };
    const pointerScreenPosition = {
      x: currentOffset.x + pointerDeltaFromImageCenter.x,
      y: currentOffset.y + pointerDeltaFromImageCenter.y,
    };

    expect(nextOffset.x + localPoint.x * nextScale).toBeCloseTo(pointerScreenPosition.x, 6);
    expect(nextOffset.y + localPoint.y * nextScale).toBeCloseTo(pointerScreenPosition.y, 6);
  });
});
