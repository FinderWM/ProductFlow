import type { WorkflowNode } from "../../lib/types";

const MINI_MAP_STATUS_STROKE_COLORS: Record<WorkflowNode["status"], string> = {
  idle: "#cbd5e1",
  queued: "#cbd5e1",
  running: "#2563eb",
  succeeded: "#cbd5e1",
  failed: "#cbd5e1",
  cancelled: "#cbd5e1",
};

const MINI_MAP_ACTIVE_STATUS_CLASS_NAMES: Partial<Record<WorkflowNode["status"], string>> = {
  running: "workflow-canvas-minimap-node-running",
};

export function workflowMiniMapNodeColor(node: Pick<WorkflowNode, "status">): string {
  return node.status === "running" ? "#2563eb" : "#d4d4d8";
}

export function workflowMiniMapNodeStrokeColor(
  node: Pick<WorkflowNode, "status">,
  selection: { primarySelected: boolean; secondarySelected: boolean },
): string {
  if (node.status === "running") {
    return "#1d4ed8";
  }
  if (selection.primarySelected) {
    return "#52525b";
  }
  if (selection.secondarySelected) {
    return "#71717a";
  }
  return MINI_MAP_STATUS_STROKE_COLORS[node.status];
}

export function workflowMiniMapNodeClassName(node: Pick<WorkflowNode, "status">): string {
  return MINI_MAP_ACTIVE_STATUS_CLASS_NAMES[node.status] ?? "";
}
