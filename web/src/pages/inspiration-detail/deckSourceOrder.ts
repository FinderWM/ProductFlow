import type { DeckSourceItem, WorkflowNode } from "../../lib/types";
import { tailSplitterOutput } from "./utils";

type DeckSourceOrderableItem = Pick<DeckSourceItem, "source_item_id" | "workflow_node_id" | "tail_item_id">;

const UNMATCHED_ORDER_INDEX = Number.MAX_SAFE_INTEGER;

export function deckSourceOrderNodeToken(nodeId: string): string {
  return `node:${nodeId}`;
}

export function deckSourceOrderTailToken(tailItemId: string): string {
  return `tail:${tailItemId}`;
}

export function workflowNodeTailItemId(node: WorkflowNode): string | null {
  const generatedBy = node.config_json.generated_by;
  if (generatedBy && typeof generatedBy === "object") {
    const itemId = (generatedBy as { item_id?: unknown }).item_id;
    if (typeof itemId === "string" && itemId.trim()) {
      return itemId.trim();
    }
  }
  const tailPlanItem = node.config_json.tail_plan_item;
  if (tailPlanItem && typeof tailPlanItem === "object") {
    const itemId = (tailPlanItem as { id?: unknown }).id;
    if (typeof itemId === "string" && itemId.trim()) {
      return itemId.trim();
    }
  }
  return null;
}

export function buildDeckSourceOrderForNodes(nodes: WorkflowNode[]): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  const pushToken = (token: string | null) => {
    if (!token || seen.has(token)) {
      return;
    }
    seen.add(token);
    tokens.push(token);
  };

  for (const node of nodes) {
    const tailItemId = workflowNodeTailItemId(node);
    if (tailItemId) {
      pushToken(deckSourceOrderTailToken(tailItemId));
    }
    pushToken(deckSourceOrderNodeToken(node.id));
    if (node.node_type === "tail_splitter") {
      const latestPlan = tailSplitterOutput(node)?.latest_plan;
      for (const item of latestPlan?.items ?? []) {
        pushToken(deckSourceOrderTailToken(item.id));
      }
    }
  }

  return tokens;
}

export function collectDeckSourceNodesFromTailSplitter(
  tailNode: WorkflowNode,
  workflowNodes: WorkflowNode[],
): WorkflowNode[] {
  if (tailNode.node_type !== "tail_splitter") {
    return [];
  }
  const output = tailSplitterOutput(tailNode);
  if (!output) {
    return [];
  }
  const nodesById = new Map(workflowNodes.map((node) => [node.id, node]));
  const orderedNodeIds: string[] = [];
  const seen = new Set<string>();
  const pushNodeId = (nodeId: string) => {
    if (!nodeId.trim() || seen.has(nodeId)) {
      return;
    }
    seen.add(nodeId);
    orderedNodeIds.push(nodeId);
  };

  pushNodeId(tailNode.id);

  const pushBatchNodeIds = (nodeIds: string[]) => {
    for (const nodeId of nodeIds) {
      pushNodeId(nodeId);
    }
  };

  for (const item of output.latest_plan?.items ?? []) {
    for (const batch of output.applied_batches) {
      if (batch.item_ids.includes(item.id)) {
        pushBatchNodeIds(batch.node_ids);
      }
    }
  }
  for (const batch of output.applied_batches) {
    pushBatchNodeIds(batch.node_ids);
  }

  return orderedNodeIds
    .map((nodeId) => nodesById.get(nodeId) ?? null)
    .filter((node): node is WorkflowNode => node !== null);
}

function sourceOrderRank(
  item: DeckSourceOrderableItem,
  sourceOrderIndex: Map<string, number>,
): [number, number] {
  const bestMatch = bestSourceOrderMatch(
    sourceOrderIndex,
    [item.source_item_id, 0],
    [item.tail_item_id ? deckSourceOrderTailToken(item.tail_item_id) : null, 1],
    [item.tail_item_id, 1],
    [deckSourceOrderNodeToken(item.workflow_node_id), 2],
    [item.workflow_node_id, 2],
  );

  if (bestMatch) {
    return [bestMatch.index, bestMatch.specificity];
  }
  return [UNMATCHED_ORDER_INDEX, UNMATCHED_ORDER_INDEX];
}

function bestSourceOrderMatch(
  sourceOrderIndex: Map<string, number>,
  ...candidates: Array<[string | null | undefined, number]>
): { index: number; specificity: number } | null {
  let bestMatch: { index: number; specificity: number } | null = null;
  for (const [candidate, specificity] of candidates) {
    if (!candidate) {
      continue;
    }
    const index = sourceOrderIndex.get(candidate);
    if (index === undefined) {
      continue;
    }
    if (
      bestMatch === null ||
      index < bestMatch.index ||
      (index === bestMatch.index && specificity < bestMatch.specificity)
    ) {
      bestMatch = { index, specificity };
    }
  }
  return bestMatch;
}

function compareSourceOrderRanks(left: number[], right: number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = (left[index] ?? UNMATCHED_ORDER_INDEX) - (right[index] ?? UNMATCHED_ORDER_INDEX);
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

export function orderDeckSourcesForDraft(
  sources: DeckSourceItem[],
  sourceOrder: string[],
  excludedSourceItemIds: string[],
): Array<DeckSourceItem & { selected: boolean }> {
  if (!sources.length) {
    return [];
  }
  const sourceOrderIndex = new Map(sourceOrder.map((sourceItemId, index) => [sourceItemId, index]));
  const excludedSet = new Set(excludedSourceItemIds);

  return [...sources]
    .map((source) => ({
      ...source,
      selected: !excludedSet.has(source.source_item_id),
    }))
    .sort((left, right) => {
      const rankCompare = compareSourceOrderRanks(
        sourceOrderRank(left, sourceOrderIndex),
        sourceOrderRank(right, sourceOrderIndex),
      );
      if (rankCompare !== 0) {
        return rankCompare;
      }
      return left.source_item_id.localeCompare(right.source_item_id);
    });
}
