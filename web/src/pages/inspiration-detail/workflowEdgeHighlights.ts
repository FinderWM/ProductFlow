import type { WorkflowEdge, WorkflowNode } from "../../lib/types";

export type WorkflowEdgeTraceKind = "selected" | "running";

export interface WorkflowEdgeTrace {
  kind: WorkflowEdgeTraceKind;
  color: string;
  targetNodeId: string;
}

interface WorkflowEdgeTraceInput {
  nodes: Array<Pick<WorkflowNode, "id" | "status">>;
  edges: Array<Pick<WorkflowEdge, "id" | "source_node_id" | "target_node_id">>;
}

interface WorkflowEdgeTraceOptions {
  selectedNodeId: string | null;
  selectedNodeIds: string[];
}

export const SELECTED_WORKFLOW_EDGE_TRACE_COLOR = "#4f46e5";

const RUNNING_WORKFLOW_EDGE_TRACE_COLORS = [
  "#0ea5e9",
  "#10b981",
  "#f97316",
  "#ec4899",
  "#8b5cf6",
  "#eab308",
  "#14b8a6",
  "#ef4444",
  "#6366f1",
  "#84cc16",
  "#06b6d4",
  "#f43f5e",
];

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x45d9f3b);
    hash ^= hash >>> 16;
  }
  return Math.abs(hash);
}

function isSingleNodeSelection(selectedNodeId: string | null, selectedNodeIds: string[]): selectedNodeId is string {
  if (!selectedNodeId) {
    return false;
  }
  if (selectedNodeIds.length === 0) {
    return true;
  }
  return selectedNodeIds.length === 1 && selectedNodeIds[0] === selectedNodeId;
}

function groupIncomingEdgesByTarget(workflowEdges: WorkflowEdgeTraceInput["edges"]) {
  const incomingByTarget = new Map<string, WorkflowEdgeTraceInput["edges"]>();
  for (const edge of workflowEdges) {
    const incomingEdges = incomingByTarget.get(edge.target_node_id) ?? [];
    incomingEdges.push(edge);
    incomingByTarget.set(edge.target_node_id, incomingEdges);
  }
  return incomingByTarget;
}

function collectUpstreamEdgeIds(
  incomingByTarget: Map<string, WorkflowEdgeTraceInput["edges"]>,
  targetNodeId: string,
): string[] {
  const edgeIds: string[] = [];
  const visitedEdgeIds = new Set<string>();
  const visitedNodeIds = new Set<string>([targetNodeId]);
  const pendingNodeIds = [targetNodeId];

  while (pendingNodeIds.length) {
    const nodeId = pendingNodeIds.shift();
    if (!nodeId) {
      continue;
    }

    for (const edge of incomingByTarget.get(nodeId) ?? []) {
      if (!visitedEdgeIds.has(edge.id)) {
        visitedEdgeIds.add(edge.id);
        edgeIds.push(edge.id);
      }
      if (!visitedNodeIds.has(edge.source_node_id)) {
        visitedNodeIds.add(edge.source_node_id);
        pendingNodeIds.push(edge.source_node_id);
      }
    }
  }

  return edgeIds;
}

function runningWorkflowNodeColorMap(runningNodeIds: string[]) {
  const availableColors = [...RUNNING_WORKFLOW_EDGE_TRACE_COLORS];
  const colorByNodeId = new Map<string, string>();

  runningNodeIds.forEach((nodeId, index) => {
    if (availableColors.length) {
      const colorIndex = hashString(nodeId) % availableColors.length;
      const [color] = availableColors.splice(colorIndex, 1);
      colorByNodeId.set(nodeId, color);
      return;
    }

    const hue = Math.round((hashString(nodeId) + index * 137.508) % 360);
    colorByNodeId.set(nodeId, `hsl(${hue} 78% 48%)`);
  });

  return colorByNodeId;
}

export function buildWorkflowEdgeTraceMap(
  workflow: WorkflowEdgeTraceInput,
  options: WorkflowEdgeTraceOptions,
): Record<string, WorkflowEdgeTrace> {
  const incomingByTarget = groupIncomingEdgesByTarget(workflow.edges);
  const traceByEdgeId: Record<string, WorkflowEdgeTrace> = {};

  if (isSingleNodeSelection(options.selectedNodeId, options.selectedNodeIds)) {
    for (const edgeId of collectUpstreamEdgeIds(incomingByTarget, options.selectedNodeId)) {
      traceByEdgeId[edgeId] = {
        kind: "selected",
        color: SELECTED_WORKFLOW_EDGE_TRACE_COLOR,
        targetNodeId: options.selectedNodeId,
      };
    }
  }

  const runningNodeIds = workflow.nodes
    .filter((node) => node.status === "running")
    .map((node) => node.id)
    .sort((left, right) => left.localeCompare(right));
  const runningColorByNodeId = runningWorkflowNodeColorMap(runningNodeIds);

  for (const nodeId of runningNodeIds) {
    const color = runningColorByNodeId.get(nodeId);
    if (!color) {
      continue;
    }

    for (const edgeId of collectUpstreamEdgeIds(incomingByTarget, nodeId)) {
      if (traceByEdgeId[edgeId]?.kind === "running") {
        continue;
      }
      traceByEdgeId[edgeId] = {
        kind: "running",
        color,
        targetNodeId: nodeId,
      };
    }
  }

  return traceByEdgeId;
}
