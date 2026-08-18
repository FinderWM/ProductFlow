export type CommandOrbitArcStrength = "soft" | "strong";

export const COMMAND_ORBIT_HEARTBEAT_MS = 3200;
export const COMMAND_ORBIT_HEARTBEAT_DELAY_MS = 1300;
export const COMMAND_ORBIT_ARC_VISIBLE_RATIO = 0.52;
export const COMMAND_ORBIT_ARC_MIN_COUNT = 1;
export const COMMAND_ORBIT_ARC_MAX_COUNT = 5;

export interface CommandOrbitArcPoint {
  x: number;
  y: number;
}

interface CommandOrbitArcPath {
  anchor: number;
  energy: number;
  points: CommandOrbitArcPoint[];
}

export interface CommandOrbitArcFrame {
  branches: CommandOrbitArcPath[];
  main: CommandOrbitArcPath;
  sparks: CommandOrbitArcPath[];
}

export interface CommandOrbitArcViewport {
  height: number;
  trackEnd: CommandOrbitArcPoint;
  trackStart: CommandOrbitArcPoint;
  width: number;
}

export interface CommandOrbitArcFlowWindow {
  end: number;
  start: number;
}

interface ArcBounds {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

type RandomSource = () => number;

const COMMAND_ORBIT_ARC_ENVELOPE = [
  { progress: 0, value: 0 },
  { progress: 0.04, value: 0.36 },
  { progress: 0.12, value: 1 },
  { progress: 0.22, value: 0.24 },
  { progress: 0.36, value: 0.68 },
  { progress: COMMAND_ORBIT_ARC_VISIBLE_RATIO, value: 0 },
] as const;

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

export function commandOrbitArcCount(random: RandomSource = Math.random): number {
  const countRange = COMMAND_ORBIT_ARC_MAX_COUNT - COMMAND_ORBIT_ARC_MIN_COUNT + 1;
  return COMMAND_ORBIT_ARC_MIN_COUNT + Math.floor(sample(random) * countRange);
}

function distanceToBoundary(position: number, direction: number, min: number, max: number): number {
  if (Math.abs(direction) < 0.0001) {
    return Number.POSITIVE_INFINITY;
  }
  return direction > 0 ? (max - position) / direction : (min - position) / direction;
}

export function createCommandOrbitArcViewport(
  width: number,
  height: number,
  random: RandomSource = Math.random,
): CommandOrbitArcViewport {
  const safeWidth = Math.max(1, finiteOr(width, 1));
  const safeHeight = Math.max(1, finiteOr(height, 1));
  const minimumDimension = Math.min(safeWidth, safeHeight);
  const margin = Math.min(28, Math.max(2, minimumDimension * 0.035), safeWidth * 0.22, safeHeight * 0.22);
  const bounds: ArcBounds = {
    left: margin,
    right: Math.max(margin, safeWidth - margin),
    top: margin,
    bottom: Math.max(margin, safeHeight - margin),
  };
  const innerWidth = Math.max(0, bounds.right - bounds.left);
  const innerHeight = Math.max(0, bounds.bottom - bounds.top);
  const center = {
    x: randomBetween(random, bounds.left + innerWidth * 0.18, bounds.right - innerWidth * 0.18),
    y: randomBetween(random, bounds.top + innerHeight * 0.18, bounds.bottom - innerHeight * 0.18),
  };
  const angle = randomBetween(random, 0, Math.PI * 2);
  const direction = { x: Math.cos(angle), y: Math.sin(angle) };
  const forwardLimit = Math.min(
    distanceToBoundary(center.x, direction.x, bounds.left, bounds.right),
    distanceToBoundary(center.y, direction.y, bounds.top, bounds.bottom),
  );
  const backwardLimit = Math.min(
    distanceToBoundary(center.x, -direction.x, bounds.left, bounds.right),
    distanceToBoundary(center.y, -direction.y, bounds.top, bounds.bottom),
  );
  const availableLength = Math.max(1, forwardLimit + backwardLimit);
  const diagonal = Math.hypot(safeWidth, safeHeight);
  const minimumLength = Math.min(availableLength * 0.78, Math.max(120, diagonal * 0.32));
  const maximumLength = Math.max(
    minimumLength,
    Math.min(availableLength * 0.96, Math.max(minimumLength, diagonal * 0.58)),
  );
  const trackLength = randomBetween(random, minimumLength, maximumLength);
  const unusedLength = Math.max(0, availableLength - trackLength);
  const trackStartOffset = -backwardLimit + randomBetween(random, 0, unusedLength);
  const trackEndOffset = trackStartOffset + trackLength;

  return {
    width: safeWidth,
    height: safeHeight,
    trackStart: clampPoint(
      {
        x: center.x + direction.x * trackStartOffset,
        y: center.y + direction.y * trackStartOffset,
      },
      bounds,
    ),
    trackEnd: clampPoint(
      {
        x: center.x + direction.x * trackEndOffset,
        y: center.y + direction.y * trackEndOffset,
      },
      bounds,
    ),
  };
}

export function commandOrbitArcOpacity(progress: number): number {
  const normalized = clamp(finiteOr(progress, 1), 0, 1);
  if (normalized >= COMMAND_ORBIT_ARC_ENVELOPE.at(-1)!.progress) {
    return 0;
  }

  const nextIndex = COMMAND_ORBIT_ARC_ENVELOPE.findIndex((point) => point.progress >= normalized);
  const next = COMMAND_ORBIT_ARC_ENVELOPE[Math.max(1, nextIndex)];
  const previous = COMMAND_ORBIT_ARC_ENVELOPE[Math.max(0, nextIndex - 1)];
  const localProgress = (normalized - previous.progress) / Math.max(0.0001, next.progress - previous.progress);
  return previous.value + (next.value - previous.value) * localProgress;
}

export function commandOrbitArcFlowWindow(progress: number, windowSize = 0.5): CommandOrbitArcFlowWindow {
  const normalized = clamp(finiteOr(progress, 1), 0, 1);
  const normalizedWindow = clamp(finiteOr(windowSize, 0.5), 0.08, 0.8);
  const head = normalized * (1 + normalizedWindow);
  return {
    start: clamp(head - normalizedWindow, 0, 1),
    end: clamp(head, 0, 1),
  };
}

export function createCommandOrbitArcFrame(
  viewport: CommandOrbitArcViewport,
  strength: CommandOrbitArcStrength,
  random: RandomSource = Math.random,
): CommandOrbitArcFrame {
  const width = Math.max(1, finiteOr(viewport.width, 1));
  const height = Math.max(1, finiteOr(viewport.height, 1));
  const viewportBounds = {
    left: 2,
    right: Math.max(2, width - 2),
    top: 2,
    bottom: Math.max(2, height - 2),
  };
  const trackStart = clampPoint(viewport.trackStart, viewportBounds);
  const trackEnd = clampPoint(viewport.trackEnd, viewportBounds);
  const trackDeltaX = trackEnd.x - trackStart.x;
  const trackDeltaY = trackEnd.y - trackStart.y;
  const trackLength = Math.max(1, Math.hypot(trackDeltaX, trackDeltaY));
  const trackUnitX = trackDeltaX / trackLength;
  const trackUnitY = trackDeltaY / trackLength;
  const trackPerpendicularX = -trackUnitY;
  const trackPerpendicularY = trackUnitX;
  const strong = strength === "strong";
  const mainBounds: ArcBounds = {
    left: 2,
    right: Math.max(2, width - 2),
    top: 2,
    bottom: Math.max(2, height - 2),
  };
  const endpointJitter = strong ? 6 : 4;
  const mainStart = {
    x:
      trackStart.x +
      trackUnitX * randomBetween(random, -endpointJitter, endpointJitter) +
      trackPerpendicularX * randomBetween(random, -endpointJitter, endpointJitter),
    y:
      trackStart.y +
      trackUnitY * randomBetween(random, -endpointJitter, endpointJitter) +
      trackPerpendicularY * randomBetween(random, -endpointJitter, endpointJitter),
  };
  const mainEnd = {
    x:
      trackEnd.x +
      trackUnitX * randomBetween(random, -endpointJitter, endpointJitter) +
      trackPerpendicularX * randomBetween(random, -endpointJitter, endpointJitter),
    y:
      trackEnd.y +
      trackUnitY * randomBetween(random, -endpointJitter, endpointJitter) +
      trackPerpendicularY * randomBetween(random, -endpointJitter, endpointJitter),
  };
  const displacement = clamp(height * (strong ? 0.17 : 0.12), strong ? 18 : 13, strong ? 28 : 21);
  const main: CommandOrbitArcPath = {
    anchor: 0,
    energy: strong ? 1 : 0.86,
    points: buildFractalPath(mainStart, mainEnd, strong ? 6 : 5, displacement, mainBounds, random),
  };
  const branchBounds = mainBounds;
  const branchCount = (strong ? 3 : 1) + Math.floor(sample(random) * 3);
  const branches = Array.from({ length: branchCount }, (_, index): CommandOrbitArcPath => {
    const startIndex = 2 + Math.floor(sample(random) * Math.max(1, main.points.length - 4));
    const start = main.points[Math.min(startIndex, main.points.length - 2)];
    const trackAngle = Math.atan2(trackDeltaY, trackDeltaX);
    const branchSide = sample(random) > 0.5 ? 1 : -1;
    const angle = trackAngle + branchSide * randomBetween(random, Math.PI * 0.28, Math.PI * 0.58);
    const length = randomBetween(random, strong ? 34 : 22, strong ? 72 : 52);
    const end = {
      x: start.x + Math.cos(angle) * length,
      y: start.y + Math.sin(angle) * length,
    };

    return {
      anchor: startIndex / Math.max(1, main.points.length - 1),
      energy: clamp((strong ? 0.72 : 0.58) - index * 0.07, 0.34, 0.78),
      points: buildFractalPath(start, end, 3, strong ? 11 : 8, branchBounds, random),
    };
  });
  const sparkCount = (strong ? 5 : 2) + Math.floor(sample(random) * (strong ? 4 : 3));
  const sparks = Array.from({ length: sparkCount }, (): CommandOrbitArcPath => {
    const startIndex = Math.floor(sample(random) * main.points.length);
    const start = main.points[startIndex];
    const angle = randomBetween(random, 0, Math.PI * 2);
    const length = randomBetween(random, strong ? 8 : 5, strong ? 18 : 12);

    return {
      anchor: startIndex / Math.max(1, main.points.length - 1),
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

export function commandOrbitArcPathSegment(
  points: CommandOrbitArcPoint[],
  startProgress: number,
  endProgress: number,
): CommandOrbitArcPoint[] {
  if (points.length < 2) {
    return points;
  }

  const start = clamp(finiteOr(startProgress, 0), 0, 1);
  const end = clamp(finiteOr(endProgress, 1), start, 1);
  const lengths = [0];
  for (let index = 1; index < points.length; index += 1) {
    lengths.push(
      lengths[index - 1] +
        Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y),
    );
  }
  const totalLength = lengths.at(-1) ?? 0;
  if (totalLength === 0) {
    return [points[0], points.at(-1)!];
  }

  const pointAtDistance = (distance: number): CommandOrbitArcPoint => {
    const segmentIndex = Math.min(
      points.length - 2,
      Math.max(0, lengths.findIndex((length) => length >= distance) - 1),
    );
    const segmentStart = lengths[segmentIndex];
    const segmentEnd = lengths[segmentIndex + 1];
    const segmentProgress = (distance - segmentStart) / Math.max(0.0001, segmentEnd - segmentStart);
    return {
      x: points[segmentIndex].x + (points[segmentIndex + 1].x - points[segmentIndex].x) * segmentProgress,
      y: points[segmentIndex].y + (points[segmentIndex + 1].y - points[segmentIndex].y) * segmentProgress,
    };
  };

  const startDistance = totalLength * start;
  const endDistance = totalLength * end;
  const segment = [pointAtDistance(startDistance)];
  for (let index = 1; index < points.length - 1; index += 1) {
    if (lengths[index] > startDistance && lengths[index] < endDistance) {
      segment.push(points[index]);
    }
  }
  segment.push(pointAtDistance(endDistance));
  return segment;
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
  flowProgress: number,
): void {
  const strong = strength === "strong";
  const flowWindow = commandOrbitArcFlowWindow(flowProgress);
  const mainPath = {
    ...frame.main,
    points: commandOrbitArcPathSegment(frame.main.points, flowWindow.start, flowWindow.end),
  };
  const headPath = {
    ...frame.main,
    points: commandOrbitArcPathSegment(
      frame.main.points,
      Math.max(flowWindow.start, flowWindow.end - 0.08),
      flowWindow.end,
    ),
  };
  const branchMargin = strong ? 0.1 : 0.07;
  const branches = frame.branches.filter(
    (path) => path.anchor >= flowWindow.start - branchMargin && path.anchor <= flowWindow.end + branchMargin,
  );
  const sparks = frame.sparks.filter(
    (path) => path.anchor >= flowWindow.start - 0.04 && path.anchor <= flowWindow.end + 0.04,
  );
  const paths = [mainPath, ...branches];

  context.save();
  context.globalCompositeOperation = "lighter";
  context.lineCap = "round";
  context.lineJoin = "round";
  strokeArcLayer(context, paths, strong ? 15 : 11, "rgb(121 214 188)", opacity * 0.1);
  strokeArcLayer(context, paths, strong ? 4.4 : 3.2, "rgb(121 214 188)", opacity * 0.56);
  strokeArcLayer(context, paths, strong ? 1.5 : 1.1, "rgb(247 239 226)", opacity * 0.96);
  strokeArcLayer(context, [headPath], strong ? 7.2 : 5.6, "rgb(121 214 188)", opacity * 0.72);
  strokeArcLayer(context, [headPath], strong ? 2 : 1.5, "rgb(247 239 226)", opacity);
  strokeArcLayer(context, sparks, strong ? 2.2 : 1.7, "rgb(121 214 188)", opacity * 0.42);
  strokeArcLayer(context, sparks, strong ? 0.9 : 0.7, "rgb(247 239 226)", opacity * 0.86);
  context.restore();
}
