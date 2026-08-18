import { describe, expect, it } from "vitest";

import {
  commandOrbitArcCount,
  commandOrbitArcFlowWindow,
  commandOrbitArcOpacity,
  commandOrbitArcPathSegment,
  commandOrbitCanvasPixelRatio,
  createCommandOrbitArcFrame,
  createCommandOrbitArcViewport,
} from "./commandOrbitElectricArc";

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const VIEWPORT = {
  width: 1280,
  height: 900,
  trackStart: { x: 180, y: 220 },
  trackEnd: { x: 920, y: 640 },
};

describe("Command Orbit electric arc geometry", () => {
  it("keeps the soft arc continuous and inside the canvas", () => {
    const frame = createCommandOrbitArcFrame(VIEWPORT, "soft", seededRandom(9527));
    const paths = [frame.main, ...frame.branches, ...frame.sparks];
    const points = paths.flatMap((path) => path.points);

    expect(frame.main.points).toHaveLength(33);
    expect(frame.branches.length).toBeGreaterThanOrEqual(1);
    expect(frame.branches.length).toBeLessThanOrEqual(3);
    expect(frame.sparks.length).toBeGreaterThanOrEqual(2);
    expect(frame.sparks.length).toBeLessThanOrEqual(4);
    expect(
      Math.hypot(
        frame.main.points[0].x - VIEWPORT.trackStart.x,
        frame.main.points[0].y - VIEWPORT.trackStart.y,
      ),
    ).toBeLessThanOrEqual(8);
    expect(
      Math.hypot(
        frame.main.points.at(-1)!.x - VIEWPORT.trackEnd.x,
        frame.main.points.at(-1)!.y - VIEWPORT.trackEnd.y,
      ),
    ).toBeLessThanOrEqual(8);
    expect(points.every((point) => point.x >= 0 && point.x <= VIEWPORT.width)).toBe(true);
    expect(points.every((point) => point.y >= 0 && point.y <= VIEWPORT.height)).toBe(true);
    expect([...frame.branches, ...frame.sparks].every((path) => path.anchor >= 0 && path.anchor <= 1)).toBe(true);
  });

  it("gives strong discharges denser paths and more branches", () => {
    const soft = createCommandOrbitArcFrame(VIEWPORT, "soft", seededRandom(47));
    const strong = createCommandOrbitArcFrame(VIEWPORT, "strong", seededRandom(47));

    expect(strong.main.points).toHaveLength(65);
    expect(strong.main.points.length).toBeGreaterThan(soft.main.points.length);
    expect(strong.branches.length).toBeGreaterThanOrEqual(3);
    expect(strong.branches.length).toBeGreaterThan(soft.branches.length);
    expect(strong.sparks.length).toBeGreaterThan(soft.sparks.length);
  });
});

describe("Command Orbit electric arc rendering helpers", () => {
  it("places long tracks at randomized positions across desktop and mobile canvases", () => {
    const generatedViewports = Array.from({ length: 48 }, (_, index) =>
      index % 2 === 0
        ? createCommandOrbitArcViewport(1440, 1000, seededRandom(index + 1))
        : createCommandOrbitArcViewport(390, 844, seededRandom(index + 1)),
    );

    generatedViewports.forEach((viewport) => {
      const points = [viewport.trackStart, viewport.trackEnd];
      const trackLength = Math.hypot(
        viewport.trackEnd.x - viewport.trackStart.x,
        viewport.trackEnd.y - viewport.trackStart.y,
      );

      expect(points.every((point) => point.x >= 0 && point.x <= viewport.width)).toBe(true);
      expect(points.every((point) => point.y >= 0 && point.y <= viewport.height)).toBe(true);
      expect(trackLength).toBeGreaterThan(Math.min(viewport.width, viewport.height) * 0.35);
    });
    const startPositions = new Set(
      generatedViewports.map(
        (viewport) => `${Math.round(viewport.trackStart.x / 20)}:${Math.round(viewport.trackStart.y / 20)}`,
      ),
    );
    expect(startPositions.size).toBeGreaterThan(20);
  });

  it("selects between one and five page arcs for each heartbeat", () => {
    expect(commandOrbitArcCount(() => 0)).toBe(1);
    expect(commandOrbitArcCount(() => 0.42)).toBe(3);
    expect(commandOrbitArcCount(() => 0.999999)).toBe(5);
    expect(commandOrbitArcCount(() => Number.NaN)).toBe(3);
  });

  it("matches the primary and secondary heartbeat peaks", () => {
    expect(commandOrbitArcOpacity(0)).toBe(0);
    expect(commandOrbitArcOpacity(0.12)).toBe(1);
    expect(commandOrbitArcOpacity(0.22)).toBeLessThan(commandOrbitArcOpacity(0.12));
    expect(commandOrbitArcOpacity(0.36)).toBeGreaterThan(commandOrbitArcOpacity(0.22));
    expect(commandOrbitArcOpacity(0.52)).toBe(0);
    expect(commandOrbitArcOpacity(1)).toBe(0);
    expect(commandOrbitArcOpacity(Number.NaN)).toBe(0);
  });

  it("moves a longer bounded current window across each page track", () => {
    expect(commandOrbitArcFlowWindow(0)).toEqual({ start: 0, end: 0 });
    expect(commandOrbitArcFlowWindow(0.5)).toEqual({ start: 0.25, end: 0.75 });
    expect(commandOrbitArcFlowWindow(1)).toEqual({ start: 1, end: 1 });
    expect(commandOrbitArcFlowWindow(Number.NaN)).toEqual({ start: 1, end: 1 });
  });

  it("extracts an interpolated section from a jagged path", () => {
    const segment = commandOrbitArcPathSegment(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      0.25,
      0.75,
    );

    expect(segment).toEqual([
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
    ]);
  });

  it("caps canvas density without undersampling standard displays", () => {
    expect(commandOrbitCanvasPixelRatio(0.75)).toBe(1);
    expect(commandOrbitCanvasPixelRatio(1.5)).toBe(1.5);
    expect(commandOrbitCanvasPixelRatio(3)).toBe(2);
    expect(commandOrbitCanvasPixelRatio(Number.NaN)).toBe(1);
  });
});
