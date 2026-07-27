import { describe, expect, it } from "vitest";

import {
  commandOrbitArcOpacity,
  commandOrbitCanvasPixelRatio,
  createCommandOrbitArcFrame,
} from "./commandOrbitElectricArc";

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const VIEWPORT = {
  width: 632,
  height: 690,
  frameLeft: 56,
  frameRight: 576,
  frameBottom: 620,
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
    expect(Math.abs(frame.main.points[0].y - VIEWPORT.frameBottom)).toBeLessThanOrEqual(7);
    expect(Math.abs(frame.main.points.at(-1)!.y - VIEWPORT.frameBottom)).toBeLessThanOrEqual(7);
    expect(points.every((point) => point.x >= 0 && point.x <= VIEWPORT.width)).toBe(true);
    expect(points.every((point) => point.y >= 0 && point.y <= VIEWPORT.height)).toBe(true);
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
  it("uses a quick attack and decaying afterglow envelope", () => {
    expect(commandOrbitArcOpacity(0)).toBe(0);
    expect(commandOrbitArcOpacity(0.08)).toBeGreaterThan(0.8);
    expect(commandOrbitArcOpacity(0.5)).toBeLessThan(commandOrbitArcOpacity(0.08));
    expect(commandOrbitArcOpacity(1)).toBe(0);
    expect(commandOrbitArcOpacity(Number.NaN)).toBe(0);
  });

  it("caps canvas density without undersampling standard displays", () => {
    expect(commandOrbitCanvasPixelRatio(0.75)).toBe(1);
    expect(commandOrbitCanvasPixelRatio(1.5)).toBe(1.5);
    expect(commandOrbitCanvasPixelRatio(3)).toBe(2);
    expect(commandOrbitCanvasPixelRatio(Number.NaN)).toBe(1);
  });
});
