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
const EDGE_POINT_EPSILON = 0.001;
const EDGE_CORNER_RADIUS = 22;
const EDGE_CUBIC_CONTROL_RATIO = 0.55;

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

function getOrthogonalDistance(start: CanvasPoint, end: CanvasPoint): number {
  return Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
}

function moveAlongSegment(start: CanvasPoint, end: CanvasPoint, distance: number): CanvasPoint {
  const segmentLength = getOrthogonalDistance(start, end);
  if (segmentLength <= EDGE_POINT_EPSILON) {
    return { ...start };
  }
  const ratio = Math.min(distance, segmentLength) / segmentLength;
  return {
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio,
  };
}

function toBezierSvgPath(points: CanvasPoint[]): string {
  if (points.length < 3) {
    return toSvgPath(points);
  }

  const commands = [`M ${formatPathPoint(points[0])}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];
    const incomingLength = getOrthogonalDistance(previous, corner);
    const outgoingLength = getOrthogonalDistance(corner, next);
    const isOrthogonalCorner =
      (previous.x === corner.x || previous.y === corner.y) &&
      (corner.x === next.x || corner.y === next.y) &&
      !(previous.x === corner.x && corner.x === next.x) &&
      !(previous.y === corner.y && corner.y === next.y);
    const radius = Math.min(EDGE_CORNER_RADIUS, incomingLength / 2, outgoingLength / 2);

    if (!isOrthogonalCorner || radius <= EDGE_POINT_EPSILON) {
      commands.push(`L ${formatPathPoint(corner)}`);
      continue;
    }

    const curveStart = moveAlongSegment(corner, previous, radius);
    const curveEnd = moveAlongSegment(corner, next, radius);
    const controlDistance = radius * EDGE_CUBIC_CONTROL_RATIO;
    const firstControl = moveAlongSegment(curveStart, corner, controlDistance);
    const secondControl = moveAlongSegment(curveEnd, corner, controlDistance);
    commands.push(`L ${formatPathPoint(curveStart)}`);
    commands.push(`C ${formatPathPoint(firstControl)} ${formatPathPoint(secondControl)} ${formatPathPoint(curveEnd)}`);
  }
  commands.push(`L ${formatPathPoint(points[points.length - 1])}`);
  return commands.join(" ");
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

function buildDefaultEdgePoints(sourceX: number, sourceY: number, targetX: number, targetY: number): CanvasPoint[] {
  if (targetX - sourceX >= EDGE_HANDLE_OFFSET * 2) {
    const midX = (sourceX + targetX) / 2;
    return compactOrthogonalPoints([
      { x: sourceX, y: sourceY },
      { x: midX, y: sourceY },
      { x: midX, y: targetY },
      { x: targetX, y: targetY },
    ]);
  }

  const sourceLaneX = sourceX + EDGE_HANDLE_OFFSET;
  const targetLaneX = targetX - EDGE_HANDLE_OFFSET;
  const midY = (sourceY + targetY) / 2;
  return compactOrthogonalPoints([
    { x: sourceX, y: sourceY },
    { x: sourceLaneX, y: sourceY },
    { x: sourceLaneX, y: midY },
    { x: targetLaneX, y: midY },
    { x: targetLaneX, y: targetY },
    { x: targetX, y: targetY },
  ]);
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
  obstacles = [],
}: {
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  sourceNodeId?: string;
  targetNodeId?: string;
  obstacles?: WorkflowEdgeObstacle[];
}): WorkflowEdgeRoute {
  const paddedObstacles = obstacles
    .filter((obstacle) => obstacle.nodeId !== sourceNodeId && obstacle.nodeId !== targetNodeId)
    .map(toPaddedObstacle)
    .filter((obstacle): obstacle is PaddedWorkflowEdgeObstacle => obstacle !== null);
  const defaultPoints = buildDefaultEdgePoints(sourceX, sourceY, targetX, targetY);
  const preferredY = (sourceY + targetY) / 2;
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
    buildLaneEdgePoints(sourceX, sourceY, targetX, targetY, laneY),
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
