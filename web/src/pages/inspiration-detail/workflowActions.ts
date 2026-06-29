import type { TranslationKey } from "../../lib/i18n";
import type { WorkflowNode } from "../../lib/types";
import { outputStringArray, outputText, tailSplitterOutput } from "./utils";
import type { WorkflowNodeRunActionState } from "./utils";

export type WorkflowCanvasActionId =
  | "run"
  | "runAfter"
  | "duplicate"
  | "fitSelected"
  | "createDeck"
  | "saveTemplate"
  | "delete";
export type WorkflowCanvasActionIcon =
  | "run"
  | "runAfter"
  | "duplicate"
  | "fitSelected"
  | "createDeck"
  | "saveTemplate"
  | "delete";

export type WorkflowCanvasActionTarget =
  | { kind: "single"; nodeId: string }
  | { kind: "group"; primaryNodeId: string; nodeIds: string[] };

export interface WorkflowCanvasActionItem {
  id: WorkflowCanvasActionId;
  icon: WorkflowCanvasActionIcon;
  labelKey?: TranslationKey;
  label?: string;
  title?: string;
  destructive?: boolean;
  disabled?: boolean;
  pending?: boolean;
}

export interface WorkflowCanvasActionToolbar {
  target: WorkflowCanvasActionTarget;
  items: WorkflowCanvasActionItem[];
}

interface WorkflowCanvasActionOptions {
  primaryNode?: WorkflowNode | null;
  targetNodes?: WorkflowNode[];
  runActionState?: WorkflowNodeRunActionState | null;
  structureBusy?: boolean;
  duplicatePending?: boolean;
  templatePending?: boolean;
  deletePending?: boolean;
}

export interface WorkflowDeckSourceSelectionSummary {
  eligibleNodeCount: number;
  usableNodeCount: number;
  unavailableNodeCount: number;
  firstUnavailableReasonKey: TranslationKey | null;
}

export interface WorkflowDeckNodeEdgeInput {
  source_node_id: string;
  target_node_id: string;
  source_handle: "output";
  target_handle: "input";
}

export interface WorkflowDeckNodeCreationPlan {
  sourceNodes: WorkflowNode[];
  usableSourceNodes: WorkflowNode[];
  sourceSelectionSummary: WorkflowDeckSourceSelectionSummary;
  nextPosition: {
    x: number;
    y: number;
  } | null;
}

function isWorkflowNodeActive(node: WorkflowNode): boolean {
  return node.status === "queued" || node.status === "running";
}

export function workflowNodeDeckSourceUnavailableReasonKey(node: WorkflowNode): TranslationKey | null {
  if (node.node_type === "inspiration_context" || node.node_type === "deck_generation") {
    return "detail.deck.unavailableReason.unsupportedNodeType";
  }
  if (node.status !== "succeeded") {
    return "detail.deck.unavailableReason.nodeNotSucceeded";
  }
  if (node.node_type === "copy_generation") {
    return node.output_json && outputText(node.output_json, "copy_set_id")
      ? null
      : "detail.deck.unavailableReason.missingCopySet";
  }
  if (node.node_type === "reference_image") {
    return outputStringArray(node, "source_asset_ids").length > 0
      ? null
      : "detail.deck.unavailableReason.emptyOutput";
  }
  if (node.node_type === "image_generation") {
    return (
      outputStringArray(node, "generated_poster_variant_ids").length > 0 ||
      outputStringArray(node, "filled_source_asset_ids").length > 0 ||
      outputStringArray(node, "source_asset_ids").length > 0
    )
      ? null
      : "detail.deck.unavailableReason.emptyOutput";
  }
  if (node.node_type === "tail_splitter") {
    const output = tailSplitterOutput(node);
    return output?.latest_plan || output?.applied_batches.length
      ? null
      : "detail.deck.unavailableReason.emptyOutput";
  }
  return "detail.deck.unavailableReason.unsupportedNodeType";
}

export function workflowNodeHasUsableDeckSourceOutput(node: WorkflowNode): boolean {
  return workflowNodeDeckSourceUnavailableReasonKey(node) === null;
}

export function summarizeWorkflowDeckSourceSelection(
  nodes: WorkflowNode[],
): WorkflowDeckSourceSelectionSummary {
  let eligibleNodeCount = 0;
  let usableNodeCount = 0;
  let unavailableNodeCount = 0;
  let firstUnavailableReasonKey: TranslationKey | null = null;

  for (const node of nodes) {
    if (node.node_type === "inspiration_context" || node.node_type === "deck_generation") {
      continue;
    }
    eligibleNodeCount += 1;
    const reasonKey = workflowNodeDeckSourceUnavailableReasonKey(node);
    if (reasonKey === null) {
      usableNodeCount += 1;
      continue;
    }
    unavailableNodeCount += 1;
    firstUnavailableReasonKey ??= reasonKey;
  }

  return {
    eligibleNodeCount,
    usableNodeCount,
    unavailableNodeCount,
    firstUnavailableReasonKey,
  };
}

export function workflowTemplateGroupNodeIdsFromSelection(
  selectedNodeIds: string[],
  workflowNodes: WorkflowNode[],
): string[] {
  const workflowNodesById = new Map(workflowNodes.map((node) => [node.id, node]));
  return selectedNodeIds.filter((nodeId) => {
    const node = workflowNodesById.get(nodeId);
    return node?.node_type !== "deck_generation";
  });
}

export function planWorkflowDeckNodeCreation(
  selectedNodeIds: string[],
  workflowNodes: WorkflowNode[],
  offsetX: number,
): WorkflowDeckNodeCreationPlan {
  const workflowNodesById = new Map(workflowNodes.map((node) => [node.id, node]));
  const sourceNodes = selectedNodeIds
    .map((nodeId) => workflowNodesById.get(nodeId) ?? null)
    .filter(
      (node): node is WorkflowNode =>
        Boolean(node && node.node_type !== "inspiration_context" && node.node_type !== "deck_generation"),
    );
  const sourceSelectionSummary = summarizeWorkflowDeckSourceSelection(sourceNodes);
  const usableSourceNodes = sourceNodes.filter(workflowNodeHasUsableDeckSourceOutput);
  const nextPosition =
    sourceNodes.length > 0
      ? {
          x: Math.max(...sourceNodes.map((node) => node.position_x)) + offsetX,
          y: Math.min(...sourceNodes.map((node) => node.position_y)),
        }
      : null;

  return {
    sourceNodes,
    usableSourceNodes,
    sourceSelectionSummary,
    nextPosition,
  };
}

export function buildWorkflowDeckNodeEdgeInputs(
  sourceNodes: WorkflowNode[],
  deckNodeId: string,
): WorkflowDeckNodeEdgeInput[] {
  return sourceNodes.map((sourceNode) => ({
    source_node_id: sourceNode.id,
    target_node_id: deckNodeId,
    source_handle: "output",
    target_handle: "input",
  }));
}

export function workflowHasActiveDeckGeneration(nodes: WorkflowNode[]): boolean {
  return nodes.some(
    (node) => node.node_type === "deck_generation" && node.output_json?.deck_status === "generating",
  );
}

export function getWorkflowCanvasActionTargetNodeIds(target: WorkflowCanvasActionTarget): string[] {
  return target.kind === "single" ? [target.nodeId] : [...target.nodeIds];
}

export function getWorkflowCanvasActionTargetForNodeToolbar(
  nodeId: string,
  primaryNodeId: string | null,
  selectedNodeIds: string[],
): WorkflowCanvasActionTarget | null {
  if (selectedNodeIds.length > 1) {
    if (nodeId !== primaryNodeId || !selectedNodeIds.includes(nodeId)) {
      return null;
    }
    return {
      kind: "group",
      primaryNodeId: nodeId,
      nodeIds: [...selectedNodeIds],
    };
  }
  if (nodeId === primaryNodeId || selectedNodeIds.includes(nodeId)) {
    return { kind: "single", nodeId };
  }
  return null;
}

export function buildWorkflowCanvasActionItems(
  target: WorkflowCanvasActionTarget,
  options: WorkflowCanvasActionOptions = {},
): WorkflowCanvasActionItem[] {
  const nodeIds = getWorkflowCanvasActionTargetNodeIds(target);
  const primaryNode = options.primaryNode ?? null;
  const knownTargetNodes = options.targetNodes ?? (primaryNode ? [primaryNode] : []);
  const primaryIsInspirationContext = primaryNode?.node_type === "inspiration_context";
  const primaryIsDeckGeneration = primaryNode?.node_type === "deck_generation";
  const targetContainsInspirationContext = knownTargetNodes.some((node) => node.node_type === "inspiration_context");
  const targetContainsDeckGeneration = knownTargetNodes.some((node) => node.node_type === "deck_generation");
  const targetHasReusableNodes = knownTargetNodes.length
    ? knownTargetNodes.some((node) => node.node_type !== "inspiration_context")
    : target.kind === "group" || !primaryIsInspirationContext;
  const targetHasDeckSourceNodes = knownTargetNodes.length
    ? knownTargetNodes.some((node) => node.node_type !== "inspiration_context" && node.node_type !== "deck_generation")
    : target.kind === "group" || (!primaryIsInspirationContext && !primaryIsDeckGeneration);
  const targetDeckSourceSummary = summarizeWorkflowDeckSourceSelection(knownTargetNodes);
  const targetHasUsableDeckSourceNodes = knownTargetNodes.length
    ? targetDeckSourceSummary.usableNodeCount > 0
    : target.kind === "group" || (!primaryIsInspirationContext && !primaryIsDeckGeneration);
  const targetHasActiveNode = knownTargetNodes.some(isWorkflowNodeActive);
  const structureBusy = Boolean(options.structureBusy);
  const items: WorkflowCanvasActionItem[] = [];

  if (target.kind === "single" && !primaryIsInspirationContext && !primaryIsDeckGeneration) {
    items.push({
      id: "run",
      icon: "run",
      label: options.runActionState?.label,
      labelKey: options.runActionState?.label ? undefined : "detail.runAction.runFromNode",
      title: options.runActionState?.title,
      disabled: Boolean(options.runActionState?.disabled),
      pending: Boolean(options.runActionState?.pending),
    });
  }

  if (target.kind === "single" && !primaryIsInspirationContext && !primaryIsDeckGeneration) {
    items.push({
      id: "runAfter",
      icon: "runAfter",
      labelKey: "detail.runAction.runAfterNode",
      title: options.runActionState?.pending ? options.runActionState.title : undefined,
      disabled: Boolean(options.runActionState?.disabled),
      pending: Boolean(options.runActionState?.pending),
    });
  }

  if (targetHasReusableNodes) {
    items.push({
      id: "duplicate",
      icon: "duplicate",
      labelKey: "detail.duplicate",
      disabled: structureBusy || Boolean(options.duplicatePending) || nodeIds.length === 0,
      pending: Boolean(options.duplicatePending),
    });
  }

  items.push({
    id: "fitSelected",
    icon: "fitSelected",
    labelKey: "detail.fitSelection",
    disabled: nodeIds.length === 0,
  });

  if (nodeIds.length >= 1 && !targetContainsInspirationContext && !targetContainsDeckGeneration && targetHasDeckSourceNodes) {
    items.push({
      id: "createDeck",
      icon: "createDeck",
      labelKey: "detail.deck.createFromSelection",
      disabled: structureBusy || Boolean(options.templatePending) || !targetHasUsableDeckSourceNodes,
      pending: Boolean(options.templatePending),
    });
  }

  if (nodeIds.length >= 2 && !targetContainsInspirationContext && !targetContainsDeckGeneration) {
    items.push({
      id: "saveTemplate",
      icon: "saveTemplate",
      labelKey: "detail.saveTemplate",
      disabled: structureBusy || Boolean(options.templatePending),
      pending: Boolean(options.templatePending),
    });
  }

  if (
    (target.kind === "group" && !targetContainsInspirationContext) ||
    (target.kind === "single" && !primaryIsInspirationContext)
  ) {
    items.push({
      id: "delete",
      icon: "delete",
      labelKey: "detail.delete",
      destructive: true,
      disabled: structureBusy || targetHasActiveNode || Boolean(options.deletePending) || nodeIds.length === 0,
      pending: Boolean(options.deletePending),
    });
  }

  return items;
}
