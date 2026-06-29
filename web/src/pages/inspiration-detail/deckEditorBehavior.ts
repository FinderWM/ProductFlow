import type { WorkflowNode } from "../../lib/types";

export type DeckEditorAutoOpenDecision =
  | { action: "open"; nextLastAutoOpenedDeckNodeId: string }
  | { action: "close"; nextLastAutoOpenedDeckNodeId: null }
  | { action: "idle"; nextLastAutoOpenedDeckNodeId: string | null };

export function resolveDeckEditorAutoOpenDecision({
  activeSidebarTab,
  selectedNode,
  lastAutoOpenedDeckNodeId,
}: {
  activeSidebarTab: string;
  selectedNode: Pick<WorkflowNode, "id" | "node_type"> | null;
  lastAutoOpenedDeckNodeId: string | null;
}): DeckEditorAutoOpenDecision {
  if (!selectedNode || selectedNode.node_type !== "deck_generation" || activeSidebarTab !== "details") {
    return { action: "close", nextLastAutoOpenedDeckNodeId: null };
  }
  if (lastAutoOpenedDeckNodeId === selectedNode.id) {
    return {
      action: "idle",
      nextLastAutoOpenedDeckNodeId: lastAutoOpenedDeckNodeId,
    };
  }
  return {
    action: "open",
    nextLastAutoOpenedDeckNodeId: selectedNode.id,
  };
}
