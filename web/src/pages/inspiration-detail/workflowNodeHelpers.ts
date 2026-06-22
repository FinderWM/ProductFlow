// 工作流节点纯逻辑助手：资源分组/生成配置判定、节点查找、活动运行态合并。
// 从 InspirationDetailPage.tsx 抽出（move-out + import-back），主文件 import 回，调用点零改。

import type {
  GenerationConfigSelectionMode,
  InspirationWorkflow,
  WorkflowNode,
  WorkflowNodeType,
} from "../../lib/types";
import type { NodeConfigDraft } from "./types";

export const RESOURCE_GROUP_REQUIRED_NODE_TYPES = new Set<WorkflowNodeType>([
  "copy_generation",
  "image_generation",
  "tail_splitter",
]);

export type TailPublicNodeRole = "public_copy" | "public_reference";

export function workflowNodeResourceGroupId(node: WorkflowNode): string | null {
  const value = node.config_json.resource_group_id;
  return typeof value === "string" && value.trim() ? value : null;
}

export function workflowNodeRequiresResourceGroup(node: WorkflowNode): boolean {
  return RESOURCE_GROUP_REQUIRED_NODE_TYPES.has(node.node_type);
}

export function workflowNodeGenerationConfigMode(node: WorkflowNode): GenerationConfigSelectionMode {
  return node.config_json.generation_config_mode === "manual" ? "manual" : "auto";
}

export function workflowNodeGenerationConfigId(node: WorkflowNode): string | null {
  const value = node.config_json.generation_config_id;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function workflowNodeMissingManualGenerationConfig(
  node: WorkflowNode,
  selectedNode: WorkflowNode | null,
  draft: NodeConfigDraft,
): boolean {
  if (!workflowNodeRequiresResourceGroup(node)) {
    return false;
  }
  if (selectedNode?.id === node.id) {
    return draft.generationConfigMode === "manual" && !draft.generationConfigId;
  }
  return workflowNodeGenerationConfigMode(node) === "manual" && !workflowNodeGenerationConfigId(node);
}

export function isAdminViewingOtherOwner(
  user: { id: string; is_admin: boolean } | null | undefined,
  ownerUserId: string | null | undefined,
): boolean {
  return Boolean(user?.is_admin && ownerUserId && user.id !== ownerUserId);
}

export function latestCreatedWorkflowNode(
  workflow: InspirationWorkflow,
  previousNodeIds: Set<string>,
  nodeType?: WorkflowNodeType,
): WorkflowNode | null {
  return (
    workflow.nodes
      .filter((node) => !previousNodeIds.has(node.id) && (!nodeType || node.node_type === nodeType))
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] ?? null
  );
}

export function hasReusableTailPublicNode(
  workflow: InspirationWorkflow | null | undefined,
  tailNodeId: string | null | undefined,
  role: TailPublicNodeRole,
): boolean {
  if (!workflow || !tailNodeId) {
    return false;
  }
  return workflow.nodes.some((node) => {
    const generatedBy = node.config_json.generated_by;
    if (!generatedBy || typeof generatedBy !== "object" || Array.isArray(generatedBy)) {
      return false;
    }
    const metadata = generatedBy as Record<string, unknown>;
    return metadata.tail_node_id === tailNodeId && metadata.role === role;
  });
}

export function latestActiveWorkflowRun(
  workflow: InspirationWorkflow | null | undefined,
): InspirationWorkflow["runs"][number] | null {
  return workflow?.runs.find((run) => run.status === "running" || run.status === "waiting_confirmation") ?? null;
}

export function isWorkflowNodeDeleteLocked(node: WorkflowNode): boolean {
  return node.status === "queued" || node.status === "running";
}

export function mergeActiveRunNodeStatuses(workflow: InspirationWorkflow | null): InspirationWorkflow | null {
  const activeRun = latestActiveWorkflowRun(workflow);
  if (!workflow || !activeRun?.node_runs.length) {
    return workflow;
  }
  const nodeRunByNodeId = new Map(activeRun.node_runs.map((nodeRun) => [nodeRun.node_id, nodeRun]));
  let changed = false;
  const nodes = workflow.nodes.map((node) => {
    const nodeRun = nodeRunByNodeId.get(node.id);
    if (!nodeRun) {
      return node;
    }
    const nextFailureReason = nodeRun.failure_reason ?? node.failure_reason;
    const nextLastRunAt = nodeRun.finished_at ?? nodeRun.started_at ?? node.last_run_at;
    if (node.status === nodeRun.status && node.failure_reason === nextFailureReason && node.last_run_at === nextLastRunAt) {
      return node;
    }
    changed = true;
    return {
      ...node,
      status: nodeRun.status,
      failure_reason: nextFailureReason,
      last_run_at: nextLastRunAt,
    };
  });
  return changed ? { ...workflow, nodes } : workflow;
}
