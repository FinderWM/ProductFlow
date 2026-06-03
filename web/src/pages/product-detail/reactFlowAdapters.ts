import type { Connection, Edge, Node, XYPosition } from "@xyflow/react";

import type { ProductWorkflow, WorkflowEdge, WorkflowNode } from "../../lib/types";
import { MAX_ZOOM, MIN_ZOOM, NODE_WIDTH } from "./constants";
import type { CanvasPoint } from "./types";
import { clamp } from "./utils";

export const PRODUCTFLOW_NODE_TYPE = "productflowNode";
export const PRODUCTFLOW_EDGE_TYPE = "productflowEdge";
export const PRODUCTFLOW_SOURCE_HANDLE = "output";
export const PRODUCTFLOW_TARGET_HANDLE = "input";

const ZOOM_PRECISION = 10_000;
const EDGE_HANDLE_OFFSET = 36;
const EDGE_OBSTACLE_PADDING = 18;
const EDGE_LANE_MARGIN = 10;
const EDGE_SIBLING_LANE_GAP = 36;
const EDGE_POINT_EPSILON = 0.001;
const EDGE_CURVE_TAIL_LENGTH = 24;
const EDGE_CURVE_CONTROL_X_RATIO = 0.36;
const EDGE_CURVE_MIN_CONTROL_X = 52;
const EDGE_CURVE_MAX_CONTROL_X = 220;
const EDGE_CURVE_LANE_PULL_RATIO = 0.88;

export interface ProductFlowNodeData extends Record<string, unknown> {
  workflowNode: WorkflowNode;
}

export interface ProductFlowEdgeData extends Record<string, unknown> {
  workflowEdge: WorkflowEdge;
}

export interface WorkflowEdgeObstacle {
  nodeId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorkflowEdgeRoute {
  path: string;
  labelX: number;
  labelY: number;
  points: CanvasPoint[];
}

interface PaddedWorkflowEdgeObstacle {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ProductFlowReactFlowNode = Node<ProductFlowNodeData, typeof PRODUCTFLOW_NODE_TYPE>;
export type ProductFlowReactFlowEdge = Edge<ProductFlowEdgeData, typeof PRODUCTFLOW_EDGE_TYPE>;

export interface WorkflowToReactFlowNodeOptions {
  selectedNodeIds?: string[];
  positionOverrides?: Record<string, CanvasPoint>;
  previousNodes?: Array<Pick<Node, "id" | "position">>;
  preservePreviousPositionsForNodeIds?: Iterable<string>;
}

export function normalizeWorkflowZoom(nextZoom: number): number {
  return clamp(Math.round(nextZoom * ZOOM_PRECISION) / ZOOM_PRECISION, MIN_ZOOM, MAX_ZOOM);
}

export function workflowToReactFlowNodes(
  workflow: ProductWorkflow,
  options: WorkflowToReactFlowNodeOptions = {},
): ProductFlowReactFlowNode[] {
  const selectedNodeIds = new Set(options.selectedNodeIds ?? []);
  const previousPositionByNodeId = new Map(options.previousNodes?.map((node) => [node.id, node.position]));
  const preservePreviousPositionsForNodeIds = new Set(options.preservePreviousPositionsForNodeIds ?? []);
  return workflow.nodes.map((node) => ({
    id: node.id,
    type: PRODUCTFLOW_NODE_TYPE,
    position:
      (preservePreviousPositionsForNodeIds.has(node.id) ? previousPositionByNodeId.get(node.id) : undefined) ??
      options.positionOverrides?.[node.id] ?? {
        x: node.position_x,
        y: node.position_y,
      },
    selected: selectedNodeIds.has(node.id),
    className: "nopan",
    draggable: true,
    selectable: true,
    connectable: true,
    deletable: false,
    data: {
      workflowNode: node,
    },
  }));
}

export function workflowToReactFlowEdges(workflow: ProductWorkflow): ProductFlowReactFlowEdge[] {
  return workflow.edges.map((edge) => ({
    id: edge.id,
    type: PRODUCTFLOW_EDGE_TYPE,
    source: edge.source_node_id,
    target: edge.target_node_id,
    sourceHandle: edge.source_handle ?? PRODUCTFLOW_SOURCE_HANDLE,
    targetHandle: edge.target_handle ?? PRODUCTFLOW_TARGET_HANDLE,
    reconnectable: false,
    deletable: false,
    focusable: false,
    data: {
      workflowEdge: edge,
    },
  }));
}

function formatPathCoordinate(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

function formatPathPoint(point: CanvasPoint): string {
  return `${formatPathCoordinate(point.x)} ${formatPathCoordinate(point.y)}`;
}

function toSvgPath(points: CanvasPoint[]): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${formatPathPoint(point)}`).join(" ");
}

function isHorizontalSegment(start: CanvasPoint, end: CanvasPoint): boolean {
  return Math.abs(start.y - end.y) < EDGE_POINT_EPSILON && Math.abs(start.x - end.x) >= EDGE_POINT_EPSILON;
}

function toBezierSvgPath(points: CanvasPoint[]): string {
  if (points.length < 2) {
    return toSvgPath(points);
  }

  const start = points[0];
  const end = points[points.length - 1];
  const next = points[1] ?? end;
  const previous = points[points.length - 2] ?? start;
  const sourceDirection = Math.sign(next.x - start.x) || (end.x >= start.x ? 1 : -1);
  const targetDirection = Math.sign(end.x - previous.x) || (end.x >= start.x ? 1 : -1);
  const curveStart = { x: start.x + sourceDirection * EDGE_CURVE_TAIL_LENGTH, y: start.y };
  const curveEnd = { x: end.x - targetDirection * EDGE_CURVE_TAIL_LENGTH, y: end.y };
  const horizontalSpan = Math.abs(curveEnd.x - curveStart.x);
  const minControlX = Math.min(EDGE_CURVE_MIN_CONTROL_X, horizontalSpan * 0.25);
  const maxControlX = Math.max(minControlX, Math.min(EDGE_CURVE_MAX_CONTROL_X, horizontalSpan * 0.45));
  const controlXDistance =
    horizontalSpan <= EDGE_POINT_EPSILON
      ? EDGE_CURVE_MIN_CONTROL_X
      : clamp(horizontalSpan * EDGE_CURVE_CONTROL_X_RATIO, minControlX, maxControlX);
  const laneY = getDominantHorizontalLaneY(points, start, end);
  const [firstControlY, secondControlY] =
    laneY === null
      ? getPreferredCurveControlY(start.y, end.y)
      : [
          start.y + (laneY - start.y) * EDGE_CURVE_LANE_PULL_RATIO,
          end.y + (laneY - end.y) * EDGE_CURVE_LANE_PULL_RATIO,
        ];
  const firstControl = {
    x: curveStart.x + sourceDirection * controlXDistance,
    y: firstControlY,
  };
  const secondControl = {
    x: curveEnd.x - targetDirection * controlXDistance,
    y: secondControlY,
  };

  return [
    `M ${formatPathPoint(start)}`,
    `L ${formatPathPoint(curveStart)}`,
    `C ${formatPathPoint(firstControl)} ${formatPathPoint(secondControl)} ${formatPathPoint(curveEnd)}`,
    `L ${formatPathPoint(end)}`,
  ].join(" ");
}

function getPreferredCurveControlY(sourceY: number, targetY: number): [number, number] {
  return [sourceY, targetY];
}

function getDominantHorizontalLaneY(points: CanvasPoint[], start: CanvasPoint, end: CanvasPoint): number | null {
  let bestLane: { y: number; length: number } | null = null;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    if (!isHorizontalSegment(previous, point)) {
      continue;
    }
    if (Math.abs(point.y - start.y) <= EDGE_POINT_EPSILON || Math.abs(point.y - end.y) <= EDGE_POINT_EPSILON) {
      continue;
    }
    const length = Math.abs(point.x - previous.x);
    if (!bestLane || length > bestLane.length) {
      bestLane = { y: point.y, length };
    }
  }
  return bestLane?.y ?? null;
}

function compactOrthogonalPoints(points: CanvasPoint[]): CanvasPoint[] {
  const withoutDuplicates = points.filter((point, index) => {
    const previous = points[index - 1];
    return !previous || previous.x !== point.x || previous.y !== point.y;
  });

  return withoutDuplicates.filter((point, index) => {
    const previous = withoutDuplicates[index - 1];
    const next = withoutDuplicates[index + 1];
    if (!previous || !next) {
      return true;
    }
    return !(previous.x === point.x && point.x === next.x) && !(previous.y === point.y && point.y === next.y);
  });
}

function getPathLength(points: CanvasPoint[]): number {
  return points.reduce((length, point, index) => {
    const previous = points[index - 1];
    return previous ? length + Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y) : length;
  }, 0);
}

function getPathMidpoint(points: CanvasPoint[]): CanvasPoint {
  const totalLength = getPathLength(points);
  if (totalLength <= 0) {
    return points[0] ?? { x: 0, y: 0 };
  }

  let traversed = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    const segmentLength = Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y);
    if (traversed + segmentLength >= totalLength / 2) {
      const remaining = totalLength / 2 - traversed;
      if (previous.x === point.x) {
        return {
          x: previous.x,
          y: previous.y + Math.sign(point.y - previous.y) * remaining,
        };
      }
      return {
        x: previous.x + Math.sign(point.x - previous.x) * remaining,
        y: previous.y,
      };
    }
    traversed += segmentLength;
  }

  return points.at(-1) ?? { x: 0, y: 0 };
}

function toPaddedObstacle(obstacle: WorkflowEdgeObstacle): PaddedWorkflowEdgeObstacle | null {
  if (
    !Number.isFinite(obstacle.x) ||
    !Number.isFinite(obstacle.y) ||
    !Number.isFinite(obstacle.width) ||
    !Number.isFinite(obstacle.height) ||
    obstacle.width <= 0 ||
    obstacle.height <= 0
  ) {
    return null;
  }
  return {
    x: obstacle.x - EDGE_OBSTACLE_PADDING,
    y: obstacle.y - EDGE_OBSTACLE_PADDING,
    width: obstacle.width + EDGE_OBSTACLE_PADDING * 2,
    height: obstacle.height + EDGE_OBSTACLE_PADDING * 2,
  };
}

function orthogonalSegmentIntersectsObstacle(
  start: CanvasPoint,
  end: CanvasPoint,
  obstacle: PaddedWorkflowEdgeObstacle,
): boolean {
  const obstacleRight = obstacle.x + obstacle.width;
  const obstacleBottom = obstacle.y + obstacle.height;
  if (Math.abs(start.y - end.y) < EDGE_POINT_EPSILON) {
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    return start.y >= obstacle.y && start.y <= obstacleBottom && maxX >= obstacle.x && minX <= obstacleRight;
  }
  if (Math.abs(start.x - end.x) < EDGE_POINT_EPSILON) {
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    return start.x >= obstacle.x && start.x <= obstacleRight && maxY >= obstacle.y && minY <= obstacleBottom;
  }
  return false;
}

function countRouteCollisions(points: CanvasPoint[], obstacles: PaddedWorkflowEdgeObstacle[]): number {
  let collisions = 0;
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    for (const obstacle of obstacles) {
      if (orthogonalSegmentIntersectsObstacle(start, end, obstacle)) {
        collisions += 1;
      }
    }
  }
  return collisions;
}

function buildForwardEdgePoints(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  laneOffset: number,
): CanvasPoint[] {
  const defaultMidX = (sourceX + targetX) / 2;
  const minMidX = Math.min(sourceX, targetX) + EDGE_HANDLE_OFFSET;
  const maxMidX = Math.max(sourceX, targetX) - EDGE_HANDLE_OFFSET;
  const midX = minMidX <= maxMidX ? clamp(defaultMidX + laneOffset, minMidX, maxMidX) : defaultMidX + laneOffset;
  return compactOrthogonalPoints([
    { x: sourceX, y: sourceY },
    { x: midX, y: sourceY },
    { x: midX, y: targetY },
    { x: targetX, y: targetY },
  ]);
}

function buildReturnEdgePoints(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  laneOffset: number,
): CanvasPoint[] {
  const sourceLaneX = sourceX + EDGE_HANDLE_OFFSET;
  const targetLaneX = targetX - EDGE_HANDLE_OFFSET;
  const midY = (sourceY + targetY) / 2 + laneOffset;
  return compactOrthogonalPoints([
    { x: sourceX, y: sourceY },
    { x: sourceLaneX, y: sourceY },
    { x: sourceLaneX, y: midY },
    { x: targetLaneX, y: midY },
    { x: targetLaneX, y: targetY },
    { x: targetX, y: targetY },
  ]);
}

function buildOffsetEdgePoints(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  laneOffset: number,
): CanvasPoint[] {
  if (targetX - sourceX >= EDGE_HANDLE_OFFSET * 2) {
    return buildForwardEdgePoints(sourceX, sourceY, targetX, targetY, laneOffset);
  }

  return buildReturnEdgePoints(sourceX, sourceY, targetX, targetY, laneOffset);
}

function buildLaneEdgePoints(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  laneY: number,
): CanvasPoint[] {
  const sourceLaneX = sourceX + EDGE_HANDLE_OFFSET;
  const targetLaneX = targetX - EDGE_HANDLE_OFFSET;
  return compactOrthogonalPoints([
    { x: sourceX, y: sourceY },
    { x: sourceLaneX, y: sourceY },
    { x: sourceLaneX, y: laneY },
    { x: targetLaneX, y: laneY },
    { x: targetLaneX, y: targetY },
    { x: targetX, y: targetY },
  ]);
}

function centeredLaneOffset(index: number, count: number): number {
  if (count <= 1 || index < 0) {
    return 0;
  }
  return (index - (count - 1) / 2) * EDGE_SIBLING_LANE_GAP;
}

function sortEdgesByNodePair(edges: WorkflowEdge[], firstNodeKey: keyof WorkflowEdge, secondNodeKey: keyof WorkflowEdge) {
  return [...edges].sort((a, b) => {
    const firstNodeCompare = String(a[firstNodeKey]).localeCompare(String(b[firstNodeKey]));
    if (firstNodeCompare !== 0) {
      return firstNodeCompare;
    }
    const secondNodeCompare = String(a[secondNodeKey]).localeCompare(String(b[secondNodeKey]));
    if (secondNodeCompare !== 0) {
      return secondNodeCompare;
    }
    return a.id.localeCompare(b.id);
  });
}

function assignGroupOffsets(
  edgeOffsets: Record<string, number[]>,
  groups: Map<string, WorkflowEdge[]>,
  firstNodeKey: keyof WorkflowEdge,
  secondNodeKey: keyof WorkflowEdge,
) {
  for (const groupEdges of groups.values()) {
    if (groupEdges.length <= 1) {
      continue;
    }
    const sortedEdges = sortEdgesByNodePair(groupEdges, firstNodeKey, secondNodeKey);
    sortedEdges.forEach((edge, index) => {
      edgeOffsets[edge.id] = [...(edgeOffsets[edge.id] ?? []), centeredLaneOffset(index, sortedEdges.length)];
    });
  }
}

export function buildWorkflowEdgeLaneOffsets(edges: WorkflowEdge[]): Record<string, number> {
  const bySource = new Map<string, WorkflowEdge[]>();
  const byTarget = new Map<string, WorkflowEdge[]>();
  for (const edge of edges) {
    bySource.set(edge.source_node_id, [...(bySource.get(edge.source_node_id) ?? []), edge]);
    byTarget.set(edge.target_node_id, [...(byTarget.get(edge.target_node_id) ?? []), edge]);
  }

  const edgeOffsets: Record<string, number[]> = {};
  assignGroupOffsets(edgeOffsets, bySource, "source_node_id", "target_node_id");
  assignGroupOffsets(edgeOffsets, byTarget, "target_node_id", "source_node_id");

  return Object.fromEntries(
    edges.map((edge) => {
      const offsets = edgeOffsets[edge.id] ?? [];
      const offset = offsets.length ? offsets.reduce((sum, item) => sum + item, 0) / offsets.length : 0;
      return [edge.id, offset];
    }),
  );
}

function getRelevantObstacleLanes(
  obstacles: PaddedWorkflowEdgeObstacle[],
  sourceX: number,
  targetX: number,
): number[] {
  const minRouteX = Math.min(sourceX + EDGE_HANDLE_OFFSET, targetX - EDGE_HANDLE_OFFSET, sourceX, targetX);
  const maxRouteX = Math.max(sourceX + EDGE_HANDLE_OFFSET, targetX - EDGE_HANDLE_OFFSET, sourceX, targetX);
  const relevantObstacles = obstacles.filter((obstacle) => {
    const obstacleRight = obstacle.x + obstacle.width;
    return obstacle.x <= maxRouteX && obstacleRight >= minRouteX;
  });
  const lanes = relevantObstacles.flatMap((obstacle) => [
    obstacle.y - EDGE_LANE_MARGIN,
    obstacle.y + obstacle.height + EDGE_LANE_MARGIN,
  ]);

  if (relevantObstacles.length > 0) {
    lanes.push(
      Math.min(...relevantObstacles.map((obstacle) => obstacle.y)) - EDGE_LANE_MARGIN,
      Math.max(...relevantObstacles.map((obstacle) => obstacle.y + obstacle.height)) + EDGE_LANE_MARGIN,
    );
  }

  return [...new Set(lanes.filter(Number.isFinite))];
}

function routeCost(points: CanvasPoint[], preferredY: number): number {
  const verticalDeviation = points.reduce(
    (maxDeviation, point) => Math.max(maxDeviation, Math.abs(point.y - preferredY)),
    0,
  );
  return getPathLength(points) + verticalDeviation * 0.2 + points.length * 6;
}

export function buildOrthogonalAvoidingPath({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourceNodeId,
  targetNodeId,
  laneOffset = 0,
  obstacles = [],
}: {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourceNodeId?: string;
  targetNodeId?: string;
  laneOffset?: number;
  obstacles?: WorkflowEdgeObstacle[];
}): WorkflowEdgeRoute {
  const paddedObstacles = obstacles
    .filter((obstacle) => obstacle.nodeId !== sourceNodeId && obstacle.nodeId !== targetNodeId)
    .map(toPaddedObstacle)
    .filter((obstacle): obstacle is PaddedWorkflowEdgeObstacle => obstacle !== null);
  const defaultPoints = buildOffsetEdgePoints(sourceX, sourceY, targetX, targetY, laneOffset);
  const preferredY = (sourceY + targetY) / 2 + laneOffset;
  const defaultCollisions = countRouteCollisions(defaultPoints, paddedObstacles);
  if (defaultCollisions === 0) {
    const label = getPathMidpoint(defaultPoints);
    return {
      path: toBezierSvgPath(defaultPoints),
      labelX: label.x,
      labelY: label.y,
      points: defaultPoints,
    };
  }

  const candidateRoutes = getRelevantObstacleLanes(paddedObstacles, sourceX, targetX).map((laneY) =>
    buildLaneEdgePoints(sourceX, sourceY, targetX, targetY, laneY + laneOffset),
  );
  const rankedRoutes = [defaultPoints, ...candidateRoutes]
    .map((points) => ({
      points,
      collisions: countRouteCollisions(points, paddedObstacles),
      cost: routeCost(points, preferredY),
    }))
    .sort((a, b) => a.collisions - b.collisions || a.cost - b.cost);
  const bestPoints = rankedRoutes[0]?.points ?? defaultPoints;
  const label = getPathMidpoint(bestPoints);

  return {
    path: toBezierSvgPath(bestPoints),
    labelX: label.x,
    labelY: label.y,
    points: bestPoints,
  };
}

export function reactFlowPositionToWorkflowPatch(position: XYPosition): { position_x: number; position_y: number } {
  return {
    position_x: Math.round(position.x),
    position_y: Math.round(position.y),
  };
}

export function getChangedWorkflowNodePositionCandidates<
  T extends { workflowNode: Pick<WorkflowNode, "position_x" | "position_y">; position: XYPosition },
>(candidates: T[]): T[] {
  return candidates.filter(({ workflowNode, position }) => {
    const patch = reactFlowPositionToWorkflowPatch(position);
    return workflowNode.position_x !== patch.position_x || workflowNode.position_y !== patch.position_y;
  });
}

export function getNodeDragGroupScreenDistance(
  candidates: Array<{ nodeId: string; position: XYPosition }>,
  startPositions: Record<string, CanvasPoint>,
  viewportZoom: number,
): number {
  return candidates.reduce((maxDistance, candidate) => {
    const startPosition = startPositions[candidate.nodeId];
    if (!startPosition) {
      return maxDistance;
    }
    const flowDistance = Math.hypot(candidate.position.x - startPosition.x, candidate.position.y - startPosition.y);
    return Math.max(maxDistance, flowDistance * viewportZoom);
  }, 0);
}

export function shouldCommitNodeDragGroupPosition(
  candidates: Array<{ nodeId: string; position: XYPosition }>,
  startPositions: Record<string, CanvasPoint>,
  viewportZoom: number,
  commitScreenDistance: number,
): boolean {
  return getNodeDragGroupScreenDistance(candidates, startPositions, viewportZoom) >= commitScreenDistance;
}

export function getNodePositionForViewportCenter(center: CanvasPoint): CanvasPoint {
  return {
    x: Math.round(center.x - NODE_WIDTH / 2),
    y: Math.round(center.y - 80),
  };
}

export function workflowNodeIdFromReactFlowNode(node: Pick<Node, "id"> | string): string {
  return typeof node === "string" ? node : node.id;
}

export function workflowEdgeIdFromReactFlowEdge(edge: Pick<Edge, "id"> | string): string {
  return typeof edge === "string" ? edge : edge.id;
}

export function connectionToWorkflowEdgeInput(
  connection: Connection,
): { source_node_id: string; target_node_id: string; source_handle: string; target_handle: string } | null {
  if (!connection.source || !connection.target || connection.source === connection.target) {
    return null;
  }
  return {
    source_node_id: connection.source,
    target_node_id: connection.target,
    source_handle: connection.sourceHandle ?? PRODUCTFLOW_SOURCE_HANDLE,
    target_handle: connection.targetHandle ?? PRODUCTFLOW_TARGET_HANDLE,
  };
}
