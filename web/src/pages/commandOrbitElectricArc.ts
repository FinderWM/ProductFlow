export type CommandOrbitArcStrength = "soft" | "strong";

export interface CommandOrbitArcPoint {
  x: number;
  y: number;
}

interface CommandOrbitArcPath {
  energy: number;
  points: CommandOrbitArcPoint[];
}

export interface CommandOrbitArcFrame {
  branches: CommandOrbitArcPath[];
  main: CommandOrbitArcPath;
  sparks: CommandOrbitArcPath[];
}

export interface CommandOrbitArcViewport {
  frameBottom: number;
  frameLeft: number;
  frameRight: number;
  height: number;
  width: number;
}

interface ArcBounds {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

type RandomSource = () => number;

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function sample(random: RandomSource): number {
  return clamp(finiteOr(random(), 0.5), 0, 0.999999);
}

function randomBetween(random: RandomSource, min: number, max: number): number {
  return min + sample(random) * (max - min);
}

function clampPoint(point: CommandOrbitArcPoint, bounds: ArcBounds): CommandOrbitArcPoint {
  return {
    x: clamp(point.x, bounds.left, bounds.right),
    y: clamp(point.y, bounds.top, bounds.bottom),
  };
}

function buildFractalPath(
  start: CommandOrbitArcPoint,
  end: CommandOrbitArcPoint,
  iterations: number,
  initialDisplacement: number,
  bounds: ArcBounds,
  random: RandomSource,
): CommandOrbitArcPoint[] {
  let points = [clampPoint(start, bounds), clampPoint(end, bounds)];
  let displacement = initialDisplacement;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const nextPoints: CommandOrbitArcPoint[] = [points[0]];

    for (let index = 0; index < points.length - 1; index += 1) {
      const from = points[index];
      const to = points[index + 1];
      const deltaX = to.x - from.x;
      const deltaY = to.y - from.y;
      const length = Math.max(1, Math.hypot(deltaX, deltaY));
      const perpendicularX = -deltaY / length;
      const perpendicularY = deltaX / length;
      const perpendicularOffset = randomBetween(random, -displacement, displacement);
      const alongOffset = randomBetween(random, -displacement * 0.18, displacement * 0.18);
      const midpoint = clampPoint(
        {
          x: (from.x + to.x) / 2 + perpendicularX * perpendicularOffset + (deltaX / length) * alongOffset,
          y: (from.y + to.y) / 2 + perpendicularY * perpendicularOffset + (deltaY / length) * alongOffset,
        },
        bounds,
      );

      nextPoints.push(midpoint, to);
    }

    points = nextPoints;
    displacement *= 0.54;
  }

  return points;
}

export function commandOrbitCanvasPixelRatio(devicePixelRatio: number): number {
  return clamp(finiteOr(devicePixelRatio, 1), 1, 2);
}

export function commandOrbitArcOpacity(progress: number): number {
  const normalized = clamp(finiteOr(progress, 1), 0, 1);
  if (normalized === 0 || normalized === 1) {
    return 0;
  }
  const attack = Math.min(1, normalized / 0.08);
  const decay = Math.pow(1 - normalized, 1.35);
  return attack * decay;
}

export function createCommandOrbitArcFrame(
  viewport: CommandOrbitArcViewport,
  strength: CommandOrbitArcStrength,
  random: RandomSource = Math.random,
): CommandOrbitArcFrame {
  const width = Math.max(1, finiteOr(viewport.width, 1));
  const height = Math.max(1, finiteOr(viewport.height, 1));
  const frameLeft = clamp(finiteOr(viewport.frameLeft, 0), 0, width);
  const frameRight = clamp(finiteOr(viewport.frameRight, width), frameLeft, width);
  const frameBottom = clamp(finiteOr(viewport.frameBottom, height * 0.8), 0, height);
  const strong = strength === "strong";
  const mainBounds: ArcBounds = {
    left: 2,
    right: Math.max(2, width - 2),
    top: Math.max(2, frameBottom - (strong ? 58 : 46)),
    bottom: Math.min(height - 2, frameBottom + (strong ? 54 : 42)),
  };
  const mainStart = {
    x: frameLeft - randomBetween(random, 8, strong ? 28 : 20),
    y: frameBottom + randomBetween(random, -5, 7),
  };
  const mainEnd = {
    x: frameRight + randomBetween(random, 8, strong ? 30 : 22),
    y: frameBottom + randomBetween(random, -6, 6),
  };
  const main: CommandOrbitArcPath = {
    energy: strong ? 1 : 0.86,
    points: buildFractalPath(
      mainStart,
      mainEnd,
      strong ? 6 : 5,
      strong ? 28 : 21,
      mainBounds,
      random,
    ),
  };
  const branchBounds: ArcBounds = {
    left: 2,
    right: Math.max(2, width - 2),
    top: Math.max(2, frameBottom - 54),
    bottom: Math.max(2, height - 2),
  };
  const branchCount = (strong ? 3 : 1) + Math.floor(sample(random) * 3);
  const branches = Array.from({ length: branchCount }, (_, index): CommandOrbitArcPath => {
    const startIndex = 2 + Math.floor(sample(random) * Math.max(1, main.points.length - 4));
    const start = main.points[Math.min(startIndex, main.points.length - 2)];
    const angle = randomBetween(random, Math.PI * 0.18, Math.PI * 0.82);
    const length = randomBetween(random, strong ? 36 : 24, strong ? 78 : 56);
    const end = {
      x: start.x + Math.cos(angle) * length,
      y: start.y + Math.sin(angle) * length,
    };

    return {
      energy: clamp((strong ? 0.72 : 0.58) - index * 0.07, 0.34, 0.78),
      points: buildFractalPath(start, end, 3, strong ? 11 : 8, branchBounds, random),
    };
  });
  const sparkCount = (strong ? 5 : 2) + Math.floor(sample(random) * (strong ? 4 : 3));
  const sparks = Array.from({ length: sparkCount }, (): CommandOrbitArcPath => {
    const start = main.points[Math.floor(sample(random) * main.points.length)];
    const angle = randomBetween(random, Math.PI * 0.05, Math.PI * 0.95);
    const length = randomBetween(random, strong ? 8 : 5, strong ? 18 : 12);

    return {
      energy: randomBetween(random, 0.28, strong ? 0.58 : 0.48),
      points: [
        start,
        clampPoint(
          {
            x: start.x + Math.cos(angle) * length,
            y: start.y + Math.sin(angle) * length,
          },
          branchBounds,
        ),
      ],
    };
  });

  return { branches, main, sparks };
}

function traceArcPath(context: CanvasRenderingContext2D, points: CommandOrbitArcPoint[]): void {
  const first = points[0];
  if (!first) {
    return;
  }
  context.beginPath();
  context.moveTo(first.x, first.y);
  for (let index = 1; index < points.length; index += 1) {
    context.lineTo(points[index].x, points[index].y);
  }
  context.stroke();
}

function strokeArcLayer(
  context: CanvasRenderingContext2D,
  paths: CommandOrbitArcPath[],
  width: number,
  color: string,
  opacity: number,
): void {
  context.strokeStyle = color;
  paths.forEach((path) => {
    context.globalAlpha = opacity * path.energy;
    context.lineWidth = width * Math.max(0.58, path.energy);
    traceArcPath(context, path.points);
  });
}

export function renderCommandOrbitArcFrame(
  context: CanvasRenderingContext2D,
  frame: CommandOrbitArcFrame,
  opacity: number,
  strength: CommandOrbitArcStrength,
): void {
  const strong = strength === "strong";
  const paths = [frame.main, ...frame.branches];

  context.save();
  context.globalCompositeOperation = "lighter";
  context.lineCap = "round";
  context.lineJoin = "round";
  strokeArcLayer(context, paths, strong ? 15 : 11, "rgb(121 214 188)", opacity * 0.1);
  strokeArcLayer(context, paths, strong ? 4.4 : 3.2, "rgb(121 214 188)", opacity * 0.56);
  strokeArcLayer(context, paths, strong ? 1.5 : 1.1, "rgb(247 239 226)", opacity * 0.96);
  strokeArcLayer(context, frame.sparks, strong ? 2.2 : 1.7, "rgb(121 214 188)", opacity * 0.42);
  strokeArcLayer(context, frame.sparks, strong ? 0.9 : 0.7, "rgb(247 239 226)", opacity * 0.86);
  context.restore();
}
