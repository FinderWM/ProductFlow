import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Check,
  Eye,
  FileText,
  Hand,
  Image as ImageIcon,
  ImagePlus,
  Layers3,
  Loader2,
  Maximize2,
  Minimize2,
  MousePointer2,
  Move,
  Play,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import { Drawer } from "vaul";

import { ConfirmDialog } from "../components/ConfirmDialog";
import {
  getResourceBlockedActionTitle,
  isResourceBlocked,
  ResourceBlockedNotice,
  ResourceMetaBadges,
} from "../components/ResourceGovernance";
import { ResourceLibraryModal } from "../components/resource-library/ResourceLibraryModal";
import {
  SaveToResourceLibraryDialog,
  type ResourceLibrarySaveSource,
} from "../components/resource-library/SaveToResourceLibraryDialog";
import { SelectField } from "../components/SelectField";
import { TOP_CHROME_COLLAPSED_SAFE_HEIGHT_CLASS, TopNav } from "../components/TopNav";
import { ZoomableImage } from "../components/ZoomableImage";
import { api, ApiError } from "../lib/api";
import { DEFAULT_IMAGE_TOOL_ALLOWED_FIELDS } from "../lib/imageToolOptions";
import { DEFAULT_IMAGE_GENERATION_MAX_DIMENSION, buildImageSizeOptions } from "../lib/imageSizes";
import { useI18n } from "../lib/preferences";
import {
  API_INSPIRATIONS_GENERATE,
  API_INSPIRATIONS_WRITE,
  API_STATUS_READ,
  hasSessionApiPermission,
} from "../lib/rbac";
import { activeGenerationResourceGroupsInApiOrder } from "../lib/resourceGroups";
import { useSessionState } from "../lib/session";
import type {
  ApplyTailSplitPlanImageGenerationConfigInput,
  ApplyTailSplitPlanItemInput,
  ApplyTailSplitPlanReuseOptions,
  CanvasTemplateSummary,
  CanvasTemplateScope,
  CanvasTemplateCategory,
  GenerationConfigOption,
  GenerationConfigSelectionMode,
  GenerationResourceGroup,
  InspirationWorkflow,
  InspirationWorkflowStatus,
  PosterVariant,
  ResourceLibraryAsset,
  SourceAsset,
  TailSplitPlan,
  WorkflowNode,
  WorkflowNodeType,
  WorkflowRunStartMode,
} from "../lib/types";
import {
  ADD_NODE_OPTIONS,
  DEFAULT_GENERATION_TAIL_SPLITTER_MAX_ITEMS,
  IMAGE_PREVIEW_SURFACE_CLASS_NAME,
  MAX_INSPECTOR_WIDTH,
  MIN_INSPECTOR_WIDTH,
  NODE_WIDTH,
} from "./inspiration-detail/constants";
import { DownloadLink } from "./inspiration-detail/ImageDownloadComponents";
import { ImagesPanel } from "./inspiration-detail/ImagesPanel";
import { InspectorPanel } from "./inspiration-detail/InspectorPanel";
import { RunsPanel } from "./inspiration-detail/RunsPanel";
import { SidebarTabButton } from "./inspiration-detail/SidebarTabButton";
import { TemplateGroupsPanel } from "./inspiration-detail/TemplateGroupsPanel";
import { TailSplitPlanDialog } from "./inspiration-detail/TailSplitPlanDialog";
import { WorkflowCanvas } from "./inspiration-detail/WorkflowCanvas";
import type { NodePositionCommitInput, WorkflowCanvasHandle } from "./inspiration-detail/WorkflowCanvas";
import {
  buildPosterSourceAssetMap,
  getVisibleReferenceAssets,
} from "./inspiration-detail/galleryImages";
import {
  getNodeImageDownload,
  getSourceImageDownload,
  type DownloadableImageWithResourceLibrarySource,
} from "./inspiration-detail/imageDownloads";
import {
  clearSelectedNodeGroup,
  deleteNodeFromSelection,
  focusSelectedNodeGroup,
  reconcileSelectedNodeIds,
  replaceSelectedNodeIdsFromBox,
  toggleSelectedNodeId,
} from "./inspiration-detail/selection";
import {
  getSelectedWorkflowShortcutNodeIds,
  getWorkflowKeyboardShortcut,
} from "./inspiration-detail/shortcuts";
import {
  createRestoreEdgesStep,
  createRestoreNodesStep,
  getWorkflowStructureSignature,
  getInternalWorkflowEdges,
  workflowHistoryStepRequiresConfirmation,
  workflowEdgeToRestorableEdge,
} from "./inspiration-detail/workflowHistory";
import type { WorkflowHistoryStep } from "./inspiration-detail/workflowHistory";
import { connectionDescription, localizedWorkflowNodeTypeLabel } from "./inspiration-detail/nodeDisplay";
import type { CanvasInteractionMode, NodeConfigDraft, SaveStatus } from "./inspiration-detail/types";
import {
  buildWorkflowCanvasActionItems,
  getWorkflowCanvasActionTargetForNodeToolbar,
  getWorkflowCanvasActionTargetNodeIds,
} from "./inspiration-detail/workflowActions";
import type {
  WorkflowCanvasActionId,
  WorkflowCanvasActionItem,
  WorkflowCanvasActionToolbar,
  WorkflowCanvasActionTarget,
} from "./inspiration-detail/workflowActions";
import {
  clamp,
  getWorkflowNodeCancelableRun,
  getWorkflowNodeRunActionState,
  hasActiveWorkflow,
  isInspirationWorkflowStatusActive,
  mergeInspirationWorkflowStatusIntoDetail,
  outputStringArray,
  outputText,
  pendingTailSplitPlan,
  readStoredNumber,
  shouldRefreshInspirationWorkflowDetailFromStatus,
  workflowRunQueueText,
} from "./inspiration-detail/utils";
import {
  defaultConfigForType,
  defaultTitleForType,
  draftFromNode,
  nodeConfigFromDraft,
} from "./inspiration-detail/workflowConfig";
import type { DownloadableImage } from "../lib/image-downloads";
import { normalizeWorkflowZoom } from "./inspiration-detail/reactFlowAdapters";

type SidebarTab = "singleNode" | "templates" | "details" | "runs" | "images";
type TemplateScopeFilter = CanvasTemplateScope | "all";
type RunWorkflowInput = { startNodeId: string; startMode: WorkflowRunStartMode } | undefined;

type PendingDeleteAction =
  | { kind: "node"; node: WorkflowNode }
  | { kind: "selectedNodes"; nodeIds: string[]; count: number }
  | { kind: "template"; templateId: string; title: string };

type PendingHistoryAction = {
  direction: "undo" | "redo";
  step: WorkflowHistoryStep;
};

function resourceLibrarySourceFromPreviewImage(image: DownloadableImage): ResourceLibrarySaveSource | null {
  const source = (image as DownloadableImageWithResourceLibrarySource).resourceLibrarySource;
  return source
    ? {
        source_type: source.source_type,
        source_id: source.source_id,
        title: source.title,
        thumbnail_url: source.thumbnail_url,
      }
    : null;
}

const RESOURCE_GROUP_REQUIRED_NODE_TYPES = new Set<WorkflowNodeType>([
  "copy_generation",
  "image_generation",
  "tail_splitter",
]);
const RESOURCE_LIBRARY_SOURCE_ASSET_IMAGE_KINDS = new Set<SourceAsset["kind"]>([
  "original_image",
  "reference_image",
  "processed_inspiration_image",
  "context_image",
]);

function workflowNodeResourceGroupId(node: WorkflowNode): string | null {
  const value = node.config_json.resource_group_id;
  return typeof value === "string" && value.trim() ? value : null;
}

function workflowNodeRequiresResourceGroup(node: WorkflowNode): boolean {
  return RESOURCE_GROUP_REQUIRED_NODE_TYPES.has(node.node_type);
}

function workflowNodeGenerationConfigMode(node: WorkflowNode): GenerationConfigSelectionMode {
  return node.config_json.generation_config_mode === "manual" ? "manual" : "auto";
}

function workflowNodeGenerationConfigId(node: WorkflowNode): string | null {
  const value = node.config_json.generation_config_id;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function workflowNodeMissingManualGenerationConfig(node: WorkflowNode, selectedNode: WorkflowNode | null, draft: NodeConfigDraft): boolean {
  if (!workflowNodeRequiresResourceGroup(node)) {
    return false;
  }
  if (selectedNode?.id === node.id) {
    return draft.generationConfigMode === "manual" && !draft.generationConfigId;
  }
  return workflowNodeGenerationConfigMode(node) === "manual" && !workflowNodeGenerationConfigId(node);
}

type WorkflowClipboard = {
  nodeIds: string[];
};

const AUTO_IMAGE_OUTPUT_NODE_OFFSET_X = NODE_WIDTH + 80;
type TailPublicNodeRole = "public_copy" | "public_reference";

function isAdminViewingOtherOwner(
  user: { id: string; is_admin: boolean } | null | undefined,
  ownerUserId: string | null | undefined,
): boolean {
  return Boolean(user?.is_admin && ownerUserId && user.id !== ownerUserId);
}

function latestCreatedWorkflowNode(
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

function hasReusableTailPublicNode(
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

function latestActiveWorkflowRun(workflow: InspirationWorkflow | null | undefined): InspirationWorkflow["runs"][number] | null {
  return workflow?.runs.find((run) => run.status === "running" || run.status === "waiting_confirmation") ?? null;
}

function isWorkflowNodeDeleteLocked(node: WorkflowNode): boolean {
  return node.status === "queued" || node.status === "running";
}

function mergeActiveRunNodeStatuses(workflow: InspirationWorkflow | null): InspirationWorkflow | null {
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

function referenceImageNodesMissingSucceededOutput(
  workflow: InspirationWorkflow,
  status: InspirationWorkflowStatus,
): string[] {
  const statusByNodeId = new Map(status.nodes.map((node) => [node.id, node]));
  return workflow.nodes
    .filter((node) => {
      const nodeStatus = statusByNodeId.get(node.id);
      return (
        node.node_type === "reference_image" &&
        nodeStatus?.status === "succeeded" &&
        outputStringArray(node, "source_asset_ids").length === 0
      );
    })
    .map((node) => node.id);
}

export function InspirationDetailPage() {
  const { t } = useI18n();
  const session = useSessionState();
  const { inspirationId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const previousBodyUserSelectRef = useRef<string | null>(null);
  const workflowCanvasRef = useRef<WorkflowCanvasHandle | null>(null);
  const wasWorkflowActiveRef = useRef(false);
  const artifactRefreshRequestedAtRef = useRef<Map<string, number>>(new Map());
  const workflowHistorySignatureRef = useRef<string | null>(null);
  const draftVersionRef = useRef(0);
  const previousDraftNodeIdRef = useRef<string | null>(null);
  const lastOpenedTailPlanIdRef = useRef<string | null>(null);
  const skipNextCanvasBlankClickRef = useRef(false);
  const canvasSelectionClearedRef = useRef(false);
  const workflowClipboardRef = useRef<WorkflowClipboard | null>(null);
  const undoStackRef = useRef<WorkflowHistoryStep[]>([]);
  const redoStackRef = useRef<WorkflowHistoryStep[]>([]);
  const pendingMoveGroupsRef = useRef<
    Record<
      string,
      {
        expected: number;
        moves: Array<{ nodeId: string; from: { x: number; y: number }; to: { x: number; y: number } }>;
      }
    >
  >({});
  const mobileInitialCanvasViewRef = useRef("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [templateSaveTitle, setTemplateSaveTitle] = useState("");
  const [templateSaveDescription, setTemplateSaveDescription] = useState("");
  const [templateSaveOpen, setTemplateSaveOpen] = useState(false);
  const [canvasTemplateSaveOpen, setCanvasTemplateSaveOpen] = useState(false);
  const [canvasTemplateSaveTitle, setCanvasTemplateSaveTitle] = useState("");
  const [canvasTemplateSaveDescription, setCanvasTemplateSaveDescription] = useState("");
  const [canvasTemplateSaveCategoryId, setCanvasTemplateSaveCategoryId] = useState("");
  const [canvasTemplateRetainPromptText, setCanvasTemplateRetainPromptText] = useState(true);
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateCategoryId, setTemplateCategoryId] = useState("");
  const [templateScope, setTemplateScope] = useState<TemplateScopeFilter>("all");
  const [activeSidebarTab, setActiveSidebarTab] = useState<SidebarTab>("details");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [topChromeCollapsed, setTopChromeCollapsed] = useState(false);
  const [mobileDetailsSheetOpen, setMobileDetailsSheetOpen] = useState(false);
  const [mobileCanvasMode, setMobileCanvasMode] = useState<CanvasInteractionMode>("browse");
  const [mobileCanvasControlsActive, setMobileCanvasControlsActive] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia("(max-width: 1023px)").matches,
  );
  const [pendingTemplateAutoLayoutSignature, setPendingTemplateAutoLayoutSignature] = useState<string | null>(null);
  const [initialWorkflowCanvasZoom] = useState(() =>
    normalizeWorkflowZoom(readStoredNumber("inspiration-one.workflow.zoom", 1)),
  );
  const [snapToGrid, setSnapToGrid] = useState(() => {
    const stored = window.localStorage.getItem("inspiration-one.workflow.snapToGrid");
    return stored === null ? true : stored === "true";
  });

  useEffect(() => {
    window.localStorage.setItem("inspiration-one.workflow.snapToGrid", String(snapToGrid));
  }, [snapToGrid]);
  const [draft, setDraft] = useState<NodeConfigDraft>(() =>
    draftFromNode(null),
  );
  const [draftDirty, setDraftDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [notice, setNotice] = useState("");
  const [inspectorWidth, setInspectorWidth] = useState(() =>
    clamp(readStoredNumber("inspiration-one.workflow.inspectorWidth", 360), MIN_INSPECTOR_WIDTH, MAX_INSPECTOR_WIDTH),
  );
  const [previewImage, setPreviewImage] = useState<DownloadableImage | null>(
    null,
  );
  const [previewResourceLibrarySource, setPreviewResourceLibrarySource] = useState<ResourceLibrarySaveSource | null>(
    null,
  );
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [resourceLibraryOpen, setResourceLibraryOpen] = useState(false);
  const [resourceLibrarySaveSource, setResourceLibrarySaveSource] = useState<ResourceLibrarySaveSource | null>(null);
  const [pendingDeleteAction, setPendingDeleteAction] =
    useState<PendingDeleteAction | null>(null);
  const [pendingHistoryAction, setPendingHistoryAction] = useState<PendingHistoryAction | null>(null);
  const [tailPlanDialogOpen, setTailPlanDialogOpen] = useState(false);
  const [historyActionBusy, setHistoryActionBusy] = useState(false);
  const [error, setError] = useState("");
  const normalizedTemplateSearch = templateSearch.trim();
  const templateScopeParam = templateScope === "all" ? undefined : templateScope;

  const inspirationQuery = useQuery({
    queryKey: ["inspiration", inspirationId],
    queryFn: () => api.getInspiration(inspirationId),
    enabled: Boolean(inspirationId),
  });
  const inspirationRecord = inspirationQuery.data ?? null;
  const inspirationBlocked = isResourceBlocked(inspirationRecord);
  const inspirationAdminReadonly = isAdminViewingOtherOwner(session?.user, inspirationRecord?.owner_user_id ?? null);
  const adminReadonlyActionTitle = t("resource.adminReadonlyAction");
  const blockedInspirationActionMessage = useCallback(
    () => getResourceBlockedActionTitle(inspirationRecord, t("resource.blockedAction")),
    [inspirationRecord, t],
  );
  const inspirationMutationBlocked = inspirationBlocked || inspirationAdminReadonly;
  const inspirationMutationBlockedTitle = inspirationAdminReadonly
    ? adminReadonlyActionTitle
    : inspirationBlocked
      ? blockedInspirationActionMessage()
      : "";
  const canWriteInspirationWorkflow = hasSessionApiPermission(session, API_INSPIRATIONS_WRITE);
  const canGenerateInspirationWorkflow = hasSessionApiPermission(session, API_INSPIRATIONS_GENERATE);
  const canReadGenerationQueue = hasSessionApiPermission(session, API_STATUS_READ);
  const inspirationWriteBlockedTitle =
    inspirationMutationBlockedTitle || (canWriteInspirationWorkflow ? "" : t("detail.permission.inspirationsWriteRequired"));
  const inspirationGenerateBlockedTitle =
    inspirationMutationBlockedTitle ||
    (canGenerateInspirationWorkflow ? "" : t("detail.permission.inspirationsGenerateRequired"));
  const resourceLibraryWriteBlockedTitle = inspirationMutationBlockedTitle;
  const inspirationWriteBlocked = inspirationMutationBlocked || !canWriteInspirationWorkflow;
  const inspirationGenerateBlocked = inspirationMutationBlocked || !canGenerateInspirationWorkflow;
  const showInspirationWriteBlockedError = useCallback(() => {
    if (!inspirationWriteBlockedTitle) {
      return;
    }
    setNotice("");
    setError(inspirationWriteBlockedTitle);
  }, [inspirationWriteBlockedTitle]);
  const showInspirationGenerateBlockedError = useCallback(() => {
    if (!inspirationGenerateBlockedTitle) {
      return;
    }
    setNotice("");
    setError(inspirationGenerateBlockedTitle);
  }, [inspirationGenerateBlockedTitle]);
  const assertInspirationWritable = useCallback(() => {
    if (inspirationWriteBlocked) {
      throw new ApiError(403, inspirationWriteBlockedTitle || t("detail.permission.inspirationsWriteRequired"));
    }
  }, [inspirationWriteBlocked, inspirationWriteBlockedTitle, t]);
  const assertInspirationGeneratable = useCallback(() => {
    if (inspirationGenerateBlocked) {
      throw new ApiError(403, inspirationGenerateBlockedTitle || t("detail.permission.inspirationsGenerateRequired"));
    }
  }, [inspirationGenerateBlocked, inspirationGenerateBlockedTitle, t]);

  const workflowQuery = useQuery({
    queryKey: ["inspiration-workflow", inspirationId],
    queryFn: () => api.getInspirationWorkflow(inspirationId),
    enabled: Boolean(inspirationId),
  });
  const workflow = useMemo(() => mergeActiveRunNodeStatuses(workflowQuery.data ?? null), [workflowQuery.data]);
  const workflowInitialEntryMode = workflow?.initial_entry_mode ?? "image";
  const canvasTemplatesQuery = useQuery({
    queryKey: ["canvas-templates", normalizedTemplateSearch, templateCategoryId, templateScope, workflowInitialEntryMode],
    queryFn: () =>
      api.listCanvasTemplates({
        search: normalizedTemplateSearch || undefined,
        category_id: templateCategoryId || undefined,
        scope: templateScopeParam,
        initial_workflow_entry: workflowInitialEntryMode,
      }),
    enabled: Boolean(workflow),
  });
  const canvasTemplateCategoriesQuery = useQuery({
    queryKey: ["canvas-template-categories", templateScope],
    queryFn: () =>
      api.listCanvasTemplateCategories({
        scope: templateScopeParam,
      }),
  });
  const userCanvasTemplateCategoriesQuery = useQuery({
    queryKey: ["canvas-template-categories", "user"],
    queryFn: () => api.listCanvasTemplateCategories({ scope: "user" }),
  });
  const workflowActive = hasActiveWorkflow(workflow);
  const workflowStatusQuery = useQuery({
    queryKey: ["inspiration-workflow-status", inspirationId],
    queryFn: () => api.getInspirationWorkflowStatus(inspirationId),
    enabled: Boolean(inspirationId && workflowActive),
    refetchInterval: (query) => {
      const data = query.state.data as InspirationWorkflowStatus | undefined;
      return isInspirationWorkflowStatusActive(data) ? 1200 : false;
    },
  });
  const runtimeConfigQuery = useQuery({
    queryKey: ["runtime-config"],
    queryFn: api.getRuntimeConfig,
  });
  const generationResourceGroupsQuery = useQuery({
    queryKey: ["my-generation-resource-groups"],
    queryFn: api.listMyGenerationResourceGroups,
  });
  const generationConfigOptionsQuery = useQuery({
    queryKey: ["generation-config-options"],
    queryFn: api.listGenerationConfigOptions,
  });
  const queueOverviewQuery = useQuery({
    queryKey: ["generation-queue"],
    queryFn: api.getGenerationQueueOverview,
    enabled: canReadGenerationQueue,
    refetchInterval: (query) => ((query.state.data?.active_count ?? 0) > 0 || workflowActive ? 1500 : false),
  });
  const imageGenerationMaxDimension =
    runtimeConfigQuery.data?.image_generation_max_dimension ?? DEFAULT_IMAGE_GENERATION_MAX_DIMENSION;
  const imageToolAllowedFields = runtimeConfigQuery.data?.image_tool_allowed_fields ?? DEFAULT_IMAGE_TOOL_ALLOWED_FIELDS;
  const tailSplitterMaxItems =
    runtimeConfigQuery.data?.generation_tail_splitter_max_items ?? DEFAULT_GENERATION_TAIL_SPLITTER_MAX_ITEMS;
  const imageSizeOptions = useMemo(
    () => buildImageSizeOptions(imageGenerationMaxDimension),
    [imageGenerationMaxDimension],
  );
  const workflowResourceGroups = useMemo<GenerationResourceGroup[]>(
    () => activeGenerationResourceGroupsInApiOrder(generationResourceGroupsQuery.data),
    [generationResourceGroupsQuery.data],
  );
  const generationConfigOptions: GenerationConfigOption[] = generationConfigOptionsQuery.data ?? [];
  const historyQuery = useQuery({
    queryKey: ["inspiration-history", inspirationId],
    queryFn: () => api.getInspirationHistory(inspirationId),
    enabled: Boolean(inspirationId),
  });

  const selectedNode = selectedNodeId
    ? workflow?.nodes.find((node) => node.id === selectedNodeId) ?? null
    : null;
  const selectedReferenceNode =
    selectedNode?.node_type === "reference_image" ? selectedNode : null;
  const resourceLibrarySelectDisabledTitle =
    resourceLibraryWriteBlockedTitle ||
    (inspirationWriteBlocked ? inspirationWriteBlockedTitle : "") ||
    (!selectedReferenceNode ? t("detail.selectImageNodeFirst") : "");
  const selectedTailPendingPlan = pendingTailSplitPlan(selectedNode);
  const selectedTailPublicReuseAvailability = useMemo(
    () => ({
      canReusePublicCopyNode:
        selectedNode?.node_type === "tail_splitter"
          ? hasReusableTailPublicNode(workflow, selectedNode.id, "public_copy")
          : false,
      canReusePublicReferenceNode:
        selectedNode?.node_type === "tail_splitter"
          ? hasReusableTailPublicNode(workflow, selectedNode.id, "public_reference")
          : false,
    }),
    [selectedNode?.id, selectedNode?.node_type, workflow],
  );
  const workflowStructureSignature = useMemo(
    () => (workflow ? getWorkflowStructureSignature(workflow) : null),
    [workflow],
  );

  const clearWorkflowLocalHistory = useCallback(() => {
    workflowClipboardRef.current = null;
    undoStackRef.current = [];
    redoStackRef.current = [];
    pendingMoveGroupsRef.current = {};
    setPendingHistoryAction(null);
  }, []);

  useEffect(() => {
    clearWorkflowLocalHistory();
    setPendingTemplateAutoLayoutSignature(null);
    workflowHistorySignatureRef.current = workflowStructureSignature;
  }, [clearWorkflowLocalHistory, inspirationId, workflow?.id]);

  useEffect(() => {
    if (!workflowStructureSignature) {
      if (workflowHistorySignatureRef.current !== null) {
        clearWorkflowLocalHistory();
      }
      workflowHistorySignatureRef.current = null;
      return;
    }
    if (workflowHistorySignatureRef.current === null) {
      workflowHistorySignatureRef.current = workflowStructureSignature;
      return;
    }
    if (workflowHistorySignatureRef.current !== workflowStructureSignature) {
      clearWorkflowLocalHistory();
      workflowHistorySignatureRef.current = workflowStructureSignature;
    }
  }, [clearWorkflowLocalHistory, workflowStructureSignature]);

  useEffect(() => {
    if (!pendingTemplateAutoLayoutSignature || workflowStructureSignature !== pendingTemplateAutoLayoutSignature) {
      return;
    }
    setPendingTemplateAutoLayoutSignature(null);
    workflowCanvasRef.current?.triggerAutoLayout();
  }, [pendingTemplateAutoLayoutSignature, workflowStructureSignature]);

  useEffect(() => {
    canvasSelectionClearedRef.current = false;
  }, [inspirationId, workflow?.id]);

  useEffect(() => {
    if (selectedNodeId || selectedNodeIds.length) {
      canvasSelectionClearedRef.current = false;
    }
  }, [selectedNodeId, selectedNodeIds]);

  useEffect(() => {
    if (!workflow?.nodes.length) {
      canvasSelectionClearedRef.current = false;
      if (selectedNodeId) {
        setSelectedNodeId(null);
      }
      if (selectedNodeIds.length) {
        setSelectedNodeIds([]);
      }
      return;
    }
    const allowEmptySelection =
      canvasSelectionClearedRef.current && !selectedNodeId && selectedNodeIds.length === 0;
    const reconciledSelection = reconcileSelectedNodeIds(selectedNodeIds, workflow.nodes, selectedNodeId, {
      allowEmptySelection,
    });
    if (reconciledSelection.primaryNodeId !== selectedNodeId) {
      setSelectedNodeId(reconciledSelection.primaryNodeId);
    }
    if (
      reconciledSelection.selectedNodeIds.length !== selectedNodeIds.length ||
      reconciledSelection.selectedNodeIds.some((nodeId, index) => nodeId !== selectedNodeIds[index])
    ) {
      setSelectedNodeIds(reconciledSelection.selectedNodeIds);
    }
  }, [selectedNodeId, selectedNodeIds, workflow]);

  useEffect(() => {
    const selectedId = selectedNode?.id ?? null;
    const selectedChanged = previousDraftNodeIdRef.current !== selectedId;
    previousDraftNodeIdRef.current = selectedId;
    if (draftDirty && !selectedChanged) {
      return;
    }
    setDraft(draftFromNode(selectedNode, inspirationQuery.data, workflow?.initial_entry_mode ?? "image"));
    setDraftDirty(false);
    setSaveStatus("idle");
  }, [
    draftDirty,
    inspirationQuery.data,
    selectedNode?.id,
    selectedNode?.last_run_at,
    selectedNode?.updated_at,
    workflow?.initial_entry_mode,
  ]);

  useEffect(() => {
    if (!selectedNode || selectedNode.node_type !== "tail_splitter" || !selectedTailPendingPlan) {
      return;
    }
    if (selectedNode.status !== "succeeded") {
      return;
    }
    if (lastOpenedTailPlanIdRef.current === selectedTailPendingPlan.plan_id) {
      return;
    }
    lastOpenedTailPlanIdRef.current = selectedTailPendingPlan.plan_id;
    setTailPlanDialogOpen(true);
  }, [
    selectedNode,
    selectedNode?.status,
    selectedTailPendingPlan,
    selectedTailPendingPlan?.plan_id,
  ]);

  useEffect(() => {
    return () => {
      restoreBodyUserSelect();
    };
  }, []);

  useEffect(() => {
    if (!previewImage) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPreviewImage(null);
        setPreviewResourceLibrarySource(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [previewImage]);

  const disableBodyUserSelect = () => {
    if (previousBodyUserSelectRef.current === null) {
      previousBodyUserSelectRef.current = document.body.style.userSelect;
    }
    document.body.style.userSelect = "none";
  };

  const restoreBodyUserSelect = () => {
    if (previousBodyUserSelectRef.current === null) {
      return;
    }
    document.body.style.userSelect = previousBodyUserSelectRef.current;
    previousBodyUserSelectRef.current = null;
  };

  const refreshInspirationArtifacts = async () => {
    await queryClient.invalidateQueries({ queryKey: ["inspiration", inspirationId] });
    await queryClient.invalidateQueries({
      queryKey: ["inspiration-history", inspirationId],
    });
    await queryClient.invalidateQueries({ queryKey: ["inspirations"] });
  };

  useEffect(() => {
    const status = workflowStatusQuery.data;
    if (!status || !inspirationId || status.inspiration_id !== inspirationId) {
      return;
    }
    const currentWorkflow = queryClient.getQueryData<InspirationWorkflow>(["inspiration-workflow", inspirationId]);
    const shouldRefetchWorkflow = shouldRefreshInspirationWorkflowDetailFromStatus(currentWorkflow, status);
    const missingSucceededOutputNodeIds = currentWorkflow
      ? referenceImageNodesMissingSucceededOutput(currentWorkflow, status)
      : [];
    if (currentWorkflow) {
      const nextWorkflow = mergeInspirationWorkflowStatusIntoDetail(currentWorkflow, status);
      queryClient.setQueryData(["inspiration-workflow", inspirationId], nextWorkflow);
      const latestRun = nextWorkflow.runs[0];
      if (latestRun?.status === "failed" && latestRun.failure_reason) {
        setError(latestRun.failure_reason);
      }
    }
    if (missingSucceededOutputNodeIds.length) {
      const now = Date.now();
      const shouldRefreshArtifacts = missingSucceededOutputNodeIds.some((nodeId) => {
        const lastRequestedAt = artifactRefreshRequestedAtRef.current.get(nodeId) ?? 0;
        if (now - lastRequestedAt < 3000) {
          return false;
        }
        artifactRefreshRequestedAtRef.current.set(nodeId, now);
        return true;
      });
      if (shouldRefreshArtifacts) {
        void queryClient.invalidateQueries({ queryKey: ["inspiration-workflow", inspirationId] });
        void refreshInspirationArtifacts();
      }
    }
    if (shouldRefetchWorkflow) {
      void queryClient.invalidateQueries({ queryKey: ["inspiration-workflow", inspirationId] });
    }
  }, [inspirationId, queryClient, workflowStatusQuery.data]);

  useEffect(() => {
    artifactRefreshRequestedAtRef.current.clear();
  }, [inspirationId, workflow?.id]);

  useEffect(() => {
    if (!wasWorkflowActiveRef.current && workflowActive) {
      wasWorkflowActiveRef.current = true;
      return;
    }
    if (wasWorkflowActiveRef.current && !workflowActive) {
      wasWorkflowActiveRef.current = false;
      void refreshInspirationArtifacts();
    }
  }, [workflowActive]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1023px)");
    const syncMobileCanvasControls = () => setMobileCanvasControlsActive(mediaQuery.matches);
    syncMobileCanvasControls();
    mediaQuery.addEventListener("change", syncMobileCanvasControls);
    return () => mediaQuery.removeEventListener("change", syncMobileCanvasControls);
  }, []);

  const handleDraftChange = (nextDraft: NodeConfigDraft) => {
    draftVersionRef.current += 1;
    setDraft(nextDraft);
    setDraftDirty(true);
    setSaveStatus("idle");
  };

  const handleGuardedDraftChange = (nextDraft: NodeConfigDraft) => {
    if (inspirationWriteBlocked) {
      showInspirationWriteBlockedError();
      return;
    }
    handleDraftChange(nextDraft);
  };

  const applyPrimarySelection = (nodeId: string, nodeIds: string[]) => {
    canvasSelectionClearedRef.current = false;
    setSelectedNodeId(nodeId);
    setSelectedNodeIds(nodeIds);
    setActiveSidebarTab("details");
  };

  const clearMultiSelection = () => {
    setSelectedNodeIds(clearSelectedNodeGroup(selectedNodeId));
  };

  const clearCanvasSelection = () => {
    if (!selectedNodeId && selectedNodeIds.length === 0) {
      return;
    }
    const applyClear = () => {
      canvasSelectionClearedRef.current = true;
      setSelectedNodeId(null);
      setSelectedNodeIds([]);
      setTemplateSaveOpen(false);
      if (mobileCanvasControlsActive && mobileCanvasMode === "select") {
        setMobileCanvasMode("browse");
      }
    };
    if (!selectedNode || !draftDirty) {
      applyClear();
      return;
    }
    void (async () => {
      try {
        await flushSelectedDraft();
        applyClear();
      } catch {
        // Mutations already surface ApiError.detail in local error state.
      }
    })();
  };

  const selectNodeForDetails = (nodeId: string) => {
    const applySelection = () => {
      const nextSelection = focusSelectedNodeGroup(selectedNodeIds, nodeId);
      applyPrimarySelection(nodeId, nextSelection.selectedNodeIds);
    };
    if (nodeId === selectedNode?.id || !draftDirty) {
      applySelection();
      return;
    }
    void (async () => {
      try {
        await flushSelectedDraft();
        applySelection();
      } catch {
        // Mutations already surface ApiError.detail in local error state.
      }
    })();
  };

  const toggleNodeSelectionForDetails = (nodeId: string) => {
    const applySelection = () => {
      const nextSelectedNodeIds = toggleSelectedNodeId(selectedNodeIds, nodeId);
      const nextPrimaryNodeId = nextSelectedNodeIds.includes(nodeId)
        ? nodeId
        : selectedNodeId === nodeId
          ? nextSelectedNodeIds[0] ?? workflow?.nodes[0]?.id ?? null
          : selectedNodeId;
      if (!nextPrimaryNodeId) {
        setSelectedNodeId(null);
        setSelectedNodeIds([]);
        return;
      }
      applyPrimarySelection(nextPrimaryNodeId, nextSelectedNodeIds.includes(nextPrimaryNodeId) ? nextSelectedNodeIds : [nextPrimaryNodeId]);
    };
    if (nodeId === selectedNode?.id || !draftDirty) {
      applySelection();
      return;
    }
    void (async () => {
      try {
        await flushSelectedDraft();
        applySelection();
      } catch {
        // Mutations already surface ApiError.detail in local error state.
      }
    })();
  };

  const selectNodeFromPointer = (nodeId: string, event: ReactPointerEvent | ReactMouseEvent) => {
    const mobileSelectionMode = mobileCanvasControlsActive && mobileCanvasMode === "select";
    if (event.ctrlKey || event.metaKey || event.shiftKey || mobileSelectionMode) {
      toggleNodeSelectionForDetails(nodeId);
      return;
    }
    selectNodeForDetails(nodeId);
  };

  const selectNodeForDragStart = (nodeId: string) => {
    if (selectedNodeIds.includes(nodeId)) {
      if (nodeId !== selectedNodeId) {
        applyPrimarySelection(nodeId, selectedNodeIds);
      }
      return;
    }
    selectNodeForDetails(nodeId);
  };

  const handleCanvasBlankClick = (event: ReactMouseEvent<Element>) => {
    if (skipNextCanvasBlankClickRef.current) {
      skipNextCanvasBlankClickRef.current = false;
      return;
    }
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest(
        [
          "[data-workflow-node-id]",
          "[data-node-action]",
          "[data-workflow-target-node-id]",
          "[data-canvas-control]",
          "button",
          "a",
          "input",
          "textarea",
          "select",
          "label",
          "[role='button']",
        ].join(","),
      )
    ) {
      return;
    }
    clearMultiSelection();
    if (mobileCanvasControlsActive && mobileCanvasMode === "select") {
      setMobileCanvasMode("browse");
    }
  };

  const replaceSelectionFromBox = (nodeIds: string[]) => {
    skipNextCanvasBlankClickRef.current = true;
    window.setTimeout(() => {
      skipNextCanvasBlankClickRef.current = false;
    }, 0);
    const nextSelection = replaceSelectedNodeIdsFromBox(nodeIds, selectedNodeId);
    if (!nextSelection.primaryNodeId) {
      setSelectedNodeId(null);
      setSelectedNodeIds([]);
      return;
    }
    const primaryNodeId = nextSelection.primaryNodeId;
    if (primaryNodeId === selectedNode?.id || !draftDirty) {
      applyPrimarySelection(primaryNodeId, nextSelection.selectedNodeIds);
      return;
    }
    void (async () => {
      try {
        await flushSelectedDraft();
        applyPrimarySelection(primaryNodeId, nextSelection.selectedNodeIds);
      } catch {
        // Mutations already surface ApiError.detail in local error state.
      }
    })();
  };

  const getCurrentWorkflow = () =>
    queryClient.getQueryData<InspirationWorkflow>(["inspiration-workflow", inspirationId]) ?? workflow ?? null;

  const workflowNodeIdsContainInspirationContext = (nodeIds: string[]) => {
    const nodeIdSet = new Set(nodeIds);
    return Boolean(
      getCurrentWorkflow()?.nodes.some((node) => nodeIdSet.has(node.id) && node.node_type === "inspiration_context"),
    );
  };

  const setWorkflowCache = (nextWorkflow: InspirationWorkflow) => {
    workflowHistorySignatureRef.current = getWorkflowStructureSignature(nextWorkflow);
    queryClient.setQueryData(["inspiration-workflow", inspirationId], nextWorkflow);
  };

  const pushUndoStep = (step: WorkflowHistoryStep) => {
    if (
      (step.kind === "deleteNodes" && !step.nodeIds.length) ||
      (step.kind === "restoreNodes" && !step.nodes.length) ||
      (step.kind === "deleteEdges" && !step.edgeIds.length) ||
      (step.kind === "restoreEdges" && !step.edges.length) ||
      (step.kind === "moveNodes" && !step.moves.length)
    ) {
      return;
    }
    undoStackRef.current.push(step);
    redoStackRef.current = [];
  };

  const selectCreatedNodes = (previousWorkflow: InspirationWorkflow | null, nextWorkflow: InspirationWorkflow) => {
    const previousNodeIds = new Set(previousWorkflow?.nodes.map((node) => node.id) ?? []);
    const createdNodes = nextWorkflow.nodes.filter((node) => !previousNodeIds.has(node.id));
    if (!createdNodes.length) {
      return;
    }
    setSelectedNodeId(createdNodes[0].id);
    setSelectedNodeIds(createdNodes.map((node) => node.id));
    setActiveSidebarTab("details");
  };

  const executeDeleteNodesStep = async (
    step: Extract<WorkflowHistoryStep, { kind: "deleteNodes" }>,
  ): Promise<WorkflowHistoryStep> => {
    assertInspirationWritable();
    const currentWorkflow = getCurrentWorkflow();
    const nodeIdSet = new Set(step.nodeIds);
    const nodesToRestore = currentWorkflow?.nodes.filter((node) => nodeIdSet.has(node.id)) ?? [];
    const edgesToRestore = getInternalWorkflowEdges(currentWorkflow?.edges ?? [], nodeIdSet);
    let nextWorkflow = currentWorkflow;
    for (const nodeId of step.nodeIds) {
      if (!nextWorkflow?.nodes.some((node) => node.id === nodeId)) {
        continue;
      }
      nextWorkflow = await api.deleteWorkflowNode(nodeId);
      setWorkflowCache(nextWorkflow);
    }
    if (nextWorkflow) {
      const nextPrimaryNodeId = nextWorkflow.nodes[0]?.id ?? null;
      setSelectedNodeId(nextPrimaryNodeId);
      setSelectedNodeIds(clearSelectedNodeGroup(nextPrimaryNodeId));
    }
    return createRestoreNodesStep(nodesToRestore, edgesToRestore);
  };

  const executeRestoreNodesStep = async (
    step: Extract<WorkflowHistoryStep, { kind: "restoreNodes" }>,
  ): Promise<WorkflowHistoryStep> => {
    assertInspirationWritable();
    const oldToNewNodeIds = new Map<string, string>();
    let nextWorkflow = getCurrentWorkflow();
    const createdNodeIds: string[] = [];
    for (const node of step.nodes) {
      const previousNodeIds = new Set(nextWorkflow?.nodes.map((workflowNode) => workflowNode.id) ?? []);
      nextWorkflow = await api.createWorkflowNode(inspirationId, {
        node_type: node.node_type,
        title: node.title,
        position_x: node.position_x,
        position_y: node.position_y,
        config_json: node.config_json,
      });
      setWorkflowCache(nextWorkflow);
      const createdNode = nextWorkflow.nodes.find((workflowNode) => !previousNodeIds.has(workflowNode.id));
      if (createdNode) {
        oldToNewNodeIds.set(node.oldId, createdNode.id);
        createdNodeIds.push(createdNode.id);
      }
    }
    for (const edge of step.edges) {
      const sourceNodeId = oldToNewNodeIds.get(edge.source_node_id);
      const targetNodeId = oldToNewNodeIds.get(edge.target_node_id);
      if (!sourceNodeId || !targetNodeId) {
        continue;
      }
      nextWorkflow = await api.createWorkflowEdge(inspirationId, {
        source_node_id: sourceNodeId,
        target_node_id: targetNodeId,
        source_handle: edge.source_handle ?? undefined,
        target_handle: edge.target_handle ?? undefined,
      });
      setWorkflowCache(nextWorkflow);
    }
    if (nextWorkflow) {
      setSelectedNodeId(createdNodeIds[0] ?? null);
      setSelectedNodeIds(createdNodeIds);
      setActiveSidebarTab("details");
    }
    return { kind: "deleteNodes", nodeIds: createdNodeIds };
  };

  const executeDeleteEdgesStep = async (
    step: Extract<WorkflowHistoryStep, { kind: "deleteEdges" }>,
  ): Promise<WorkflowHistoryStep> => {
    assertInspirationWritable();
    const currentWorkflow = getCurrentWorkflow();
    const edgeIdSet = new Set(step.edgeIds);
    const edgesToRestore = currentWorkflow?.edges.filter((edge) => edgeIdSet.has(edge.id)) ?? [];
    let nextWorkflow = currentWorkflow;
    for (const edgeId of step.edgeIds) {
      if (!nextWorkflow?.edges.some((edge) => edge.id === edgeId)) {
        continue;
      }
      nextWorkflow = await api.deleteWorkflowEdge(edgeId);
      setWorkflowCache(nextWorkflow);
    }
    return createRestoreEdgesStep(edgesToRestore);
  };

  const executeRestoreEdgesStep = async (
    step: Extract<WorkflowHistoryStep, { kind: "restoreEdges" }>,
  ): Promise<WorkflowHistoryStep> => {
    assertInspirationWritable();
    let nextWorkflow = getCurrentWorkflow();
    const createdEdgeIds: string[] = [];
    for (const edge of step.edges) {
      const previousEdgeIds = new Set(nextWorkflow?.edges.map((workflowEdge) => workflowEdge.id) ?? []);
      nextWorkflow = await api.createWorkflowEdge(inspirationId, {
        source_node_id: edge.source_node_id,
        target_node_id: edge.target_node_id,
        source_handle: edge.source_handle ?? undefined,
        target_handle: edge.target_handle ?? undefined,
      });
      setWorkflowCache(nextWorkflow);
      const createdEdge = nextWorkflow.edges.find((workflowEdge) => !previousEdgeIds.has(workflowEdge.id));
      if (createdEdge) {
        createdEdgeIds.push(createdEdge.id);
      }
    }
    return { kind: "deleteEdges", edgeIds: createdEdgeIds };
  };

  const executeMoveNodesStep = async (
    step: Extract<WorkflowHistoryStep, { kind: "moveNodes" }>,
  ): Promise<WorkflowHistoryStep> => {
    assertInspirationWritable();
    for (const move of step.moves) {
      const nextWorkflow = await api.updateWorkflowNode(move.nodeId, {
        position_x: move.to.x,
        position_y: move.to.y,
      });
      setWorkflowCache(nextWorkflow);
    }
    return {
      kind: "moveNodes",
      moves: step.moves.map((move) => ({
        nodeId: move.nodeId,
        from: move.to,
        to: move.from,
      })),
    };
  };

  const executeWorkflowHistoryStep = (step: WorkflowHistoryStep): Promise<WorkflowHistoryStep> => {
    if (step.kind === "deleteNodes") {
      return executeDeleteNodesStep(step);
    }
    if (step.kind === "restoreNodes") {
      return executeRestoreNodesStep(step);
    }
    if (step.kind === "deleteEdges") {
      return executeDeleteEdgesStep(step);
    }
    if (step.kind === "restoreEdges") {
      return executeRestoreEdgesStep(step);
    }
    return executeMoveNodesStep(step);
  };

  const executeHistoryDirection = async (direction: "undo" | "redo", expectedStep?: WorkflowHistoryStep) => {
    const sourceStack = direction === "undo" ? undoStackRef.current : redoStackRef.current;
    const targetStack = direction === "undo" ? redoStackRef.current : undoStackRef.current;
    const step = sourceStack[sourceStack.length - 1] ?? null;
    if (!step || (expectedStep && step !== expectedStep)) {
      setPendingHistoryAction(null);
      return;
    }
    sourceStack.pop();
    setHistoryActionBusy(true);
    try {
      const counterpart = await executeWorkflowHistoryStep(step);
      targetStack.push(counterpart);
      setPendingHistoryAction(null);
      setError("");
    } catch (mutationError) {
      sourceStack.push(step);
      setPendingHistoryAction(null);
      setError(mutationError instanceof ApiError ? mutationError.detail : t("detail.error.historyAction"));
    } finally {
      setHistoryActionBusy(false);
    }
  };

  const requestHistoryDirection = (direction: "undo" | "redo") => {
    const stack = direction === "undo" ? undoStackRef.current : redoStackRef.current;
    const step = stack[stack.length - 1] ?? null;
    if (!step) {
      return;
    }
    if (workflowHistoryStepRequiresConfirmation(step)) {
      setPendingHistoryAction({ direction, step });
      return;
    }
    void executeHistoryDirection(direction, step);
  };

  const runWorkflowMutation = useMutation({
    mutationFn: (input?: RunWorkflowInput) => {
      assertInspirationGeneratable();
      return api.runInspirationWorkflow(
        inspirationId,
        input?.startNodeId
          ? { start_node_id: input.startNodeId, start_mode: input.startMode }
          : {},
      );
    },
    onSuccess: async (nextWorkflow) => {
      setError(
        nextWorkflow.runs[0]?.status === "failed"
          ? (nextWorkflow.runs[0].failure_reason ?? "")
          : "",
      );
      queryClient.setQueryData(["inspiration-workflow", inspirationId], nextWorkflow);
      await refreshInspirationArtifacts();
    },
    onError: (mutationError) => {
      setPendingDeleteAction(null);
      setError(
        mutationError instanceof ApiError
          ? mutationError.detail
          : t("detail.error.runWorkflow"),
      );
    },
  });

  const cancelWorkflowRunMutation = useMutation({
    mutationFn: (runId: string) => {
      assertInspirationGeneratable();
      return api.cancelInspirationWorkflowRun(inspirationId, runId);
    },
    onSuccess: async (nextWorkflow) => {
      setError("");
      queryClient.setQueryData(["inspiration-workflow", inspirationId], nextWorkflow);
      await queryClient.invalidateQueries({ queryKey: ["inspiration-workflow-status", inspirationId] });
      await queryClient.invalidateQueries({ queryKey: ["generation-queue"] });
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof ApiError
          ? mutationError.detail
          : t("detail.error.cancelWorkflow"),
      );
    },
  });

  const retryWorkflowRunMutation = useMutation({
    mutationFn: (runId: string) => {
      assertInspirationGeneratable();
      return api.retryInspirationWorkflowRun(inspirationId, runId);
    },
    onSuccess: (nextWorkflow) => {
      setError("");
      queryClient.setQueryData(["inspiration-workflow", inspirationId], nextWorkflow);
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof ApiError
          ? mutationError.detail
          : t("detail.error.retryWorkflow"),
      );
    },
  });

  const retryFailedWorkflowNodesMutation = useMutation({
    mutationFn: () => {
      assertInspirationGeneratable();
      return api.retryFailedWorkflowNodes(inspirationId);
    },
    onSuccess: async (nextWorkflow) => {
      setError("");
      queryClient.setQueryData(["inspiration-workflow", inspirationId], nextWorkflow);
      await queryClient.invalidateQueries({ queryKey: ["inspiration-workflow-status", inspirationId] });
      await queryClient.invalidateQueries({ queryKey: ["generation-queue"] });
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof ApiError
          ? mutationError.detail
          : t("detail.error.retryFailedNodes"),
      );
    },
  });

  const createNodeMutation = useMutation({
    mutationFn: async (type: WorkflowNodeType) => {
      assertInspirationWritable();
      const currentWorkflow = workflowQuery.data;
      if (!currentWorkflow) {
        throw new Error(t("detail.error.workflowNotLoaded"));
      }
      const previousNodeIds = new Set(currentWorkflow.nodes.map((node) => node.id));
      const siblingCount = currentWorkflow.nodes.filter(
        (node) => node.node_type === type,
      ).length;
      const nextPosition = workflowCanvasRef.current?.getViewportCenterNodePosition() ?? { x: 120, y: 120 };
      const nextWorkflow = await api.createWorkflowNode(inspirationId, {
        node_type: type,
        title: defaultTitleForType(type, siblingCount + 1),
        position_x: nextPosition.x,
        position_y: nextPosition.y,
        config_json: defaultConfigForType(type),
      });

      const createdNode = latestCreatedWorkflowNode(nextWorkflow, previousNodeIds, type);
      if (type !== "image_generation" || !createdNode) {
        return {
          nextWorkflow,
          createdNodeIds: createdNode ? [createdNode.id] : [],
          selectedNodeId: createdNode?.id ?? null,
        };
      }

      const beforeOutputNodeIds = new Set(nextWorkflow.nodes.map((node) => node.id));
      const outputSiblingCount = nextWorkflow.nodes.filter((node) => node.node_type === "reference_image").length;
      const workflowWithOutput = await api.createWorkflowNode(inspirationId, {
        node_type: "reference_image",
        title: defaultTitleForType("reference_image", outputSiblingCount + 1),
        position_x: createdNode.position_x + AUTO_IMAGE_OUTPUT_NODE_OFFSET_X,
        position_y: createdNode.position_y,
        config_json: {
          ...defaultConfigForType("reference_image"),
          label: "生成结果槽位",
        },
      });
      const outputNode = latestCreatedWorkflowNode(workflowWithOutput, beforeOutputNodeIds, "reference_image");
      if (!outputNode) {
        return {
          nextWorkflow: workflowWithOutput,
          createdNodeIds: [createdNode.id],
          selectedNodeId: createdNode.id,
        };
      }

      const workflowWithEdge = await api.createWorkflowEdge(inspirationId, {
        source_node_id: createdNode.id,
        target_node_id: outputNode.id,
        source_handle: "output",
        target_handle: "input",
      });
      return {
        nextWorkflow: workflowWithEdge,
        createdNodeIds: [createdNode.id, outputNode.id],
        selectedNodeId: createdNode.id,
      };
    },
    onSuccess: ({ nextWorkflow, createdNodeIds, selectedNodeId }) => {
      setError("");
      setWorkflowCache(nextWorkflow);
      const fallbackNewest =
        [...nextWorkflow.nodes].sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        )[0] ?? null;
      const selectedCreatedNode = selectedNodeId
        ? (nextWorkflow.nodes.find((node) => node.id === selectedNodeId) ?? null)
        : null;
      const newest = selectedCreatedNode ?? fallbackNewest;
      const undoNodeIds = createdNodeIds.length ? createdNodeIds : newest ? [newest.id] : [];
      if (undoNodeIds.length) {
        pushUndoStep({ kind: "deleteNodes", nodeIds: undoNodeIds });
      }
      setSelectedNodeId(newest?.id ?? null);
      setSelectedNodeIds(newest ? [newest.id] : []);
      setActiveSidebarTab("details");
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof ApiError
          ? mutationError.detail
          : t("detail.error.createNode"),
      );
    },
  });

  const applyTemplateGroupMutation = useMutation({
    mutationFn: async (template: CanvasTemplateSummary) => {
      assertInspirationWritable();
      await flushSelectedDraft();
      const previousWorkflow = queryClient.getQueryData<InspirationWorkflow>(["inspiration-workflow", inspirationId]) ?? workflow;
      const previousNodeIds = new Set(previousWorkflow?.nodes.map((node) => node.id) ?? []);
      const nextPosition = workflowCanvasRef.current?.getViewportCenterNodePosition() ?? { x: 120, y: 120 };
      const nextWorkflow = await api.applyWorkflowTemplateGroup(inspirationId, {
        template_key: template.key,
        position_x: nextPosition.x,
        position_y: nextPosition.y,
      });
      return { nextWorkflow, previousNodeIds };
    },
    onSuccess: async ({ nextWorkflow, previousNodeIds }) => {
      setError("");
      setWorkflowCache(nextWorkflow);
      await queryClient.invalidateQueries({ queryKey: ["inspiration-workflow", inspirationId] });
      const createdNodes = nextWorkflow.nodes.filter((node) => !previousNodeIds.has(node.id));
      const selectedCreatedNode =
        createdNodes.find((node) => node.node_type === "copy_generation") ??
        createdNodes.find((node) => node.node_type === "image_generation") ??
        createdNodes[0] ??
        null;
      pushUndoStep({ kind: "deleteNodes", nodeIds: createdNodes.map((node) => node.id) });
      setSelectedNodeId(selectedCreatedNode?.id ?? null);
      setSelectedNodeIds(selectedCreatedNode ? [selectedCreatedNode.id] : []);
      setActiveSidebarTab("details");
      if (createdNodes.length > 0) {
        const refreshedWorkflow =
          queryClient.getQueryData<InspirationWorkflow>(["inspiration-workflow", inspirationId]) ?? nextWorkflow;
        setPendingTemplateAutoLayoutSignature(getWorkflowStructureSignature(refreshedWorkflow));
      }
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof ApiError
          ? mutationError.detail
          : t("detail.error.applyTemplate"),
      );
    },
  });

  const applyTailSplitPlanMutation = useMutation({
    mutationFn: async ({
      nodeId,
      plan,
      items,
      imageGenerationConfig,
      reuseOptions,
    }: {
      nodeId: string;
      plan: TailSplitPlan;
      items: ApplyTailSplitPlanItemInput[];
      imageGenerationConfig: ApplyTailSplitPlanImageGenerationConfigInput;
      reuseOptions: ApplyTailSplitPlanReuseOptions;
    }) => {
      assertInspirationWritable();
      await flushSelectedDraft();
      const previousWorkflow = getCurrentWorkflow();
      const tailNode = previousWorkflow?.nodes.find((node) => node.id === nodeId) ?? null;
      const nextWorkflow = await api.applyTailSplitPlan(nodeId, {
        plan_id: plan.plan_id,
        item_ids: items.map((item) => item.id),
        items,
        image_generation_config: imageGenerationConfig,
        position_x: (tailNode?.position_x ?? 120) + 80,
        position_y: tailNode?.position_y ?? 120,
        reuse_public_copy_node: reuseOptions.reuse_public_copy_node,
        reuse_public_reference_node: reuseOptions.reuse_public_reference_node,
      });
      return { nextWorkflow, previousWorkflow, itemCount: items.length };
    },
    onSuccess: ({ nextWorkflow, previousWorkflow, itemCount }) => {
      const previousNodeIds = new Set(previousWorkflow?.nodes.map((node) => node.id) ?? []);
      const createdNodeIds = nextWorkflow.nodes
        .filter((node) => !previousNodeIds.has(node.id))
        .map((node) => node.id);
      setError("");
      setNotice(t("detail.tailPlan.appliedNotice", { count: itemCount }));
      setTailPlanDialogOpen(false);
      setWorkflowCache(nextWorkflow);
      pushUndoStep({ kind: "deleteNodes", nodeIds: createdNodeIds });
      selectCreatedNodes(previousWorkflow, nextWorkflow);
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof ApiError ? mutationError.detail : t("detail.error.applyTailPlan"),
      );
    },
  });

  const duplicateNodeGroupMutation = useMutation({
    mutationFn: async ({ nodeIds, source }: { nodeIds: string[]; source: "paste" | "duplicate" }) => {
      assertInspirationWritable();
      if (!nodeIds.length) {
        throw new Error(t("detail.error.selectNodesToDuplicate"));
      }
      await flushSelectedDraft();
      const previousWorkflow = getCurrentWorkflow();
      const nodeIdSet = new Set(nodeIds);
      const hasDuplicableNodes = Boolean(
        previousWorkflow?.nodes.some((node) => nodeIdSet.has(node.id) && node.node_type !== "inspiration_context"),
      );
      if (!hasDuplicableNodes) {
        throw new Error(t("detail.error.selectNodesToDuplicate"));
      }
      const nextWorkflow = await api.duplicateWorkflowNodeGroup(inspirationId, {
        node_ids: nodeIds,
        offset_x: 56,
        offset_y: 56,
      });
      return { nextWorkflow, previousWorkflow, source };
    },
    onSuccess: ({ nextWorkflow, previousWorkflow, source }) => {
      const previousNodeIds = new Set(previousWorkflow?.nodes.map((node) => node.id) ?? []);
      const createdNodeIds = nextWorkflow.nodes
        .filter((node) => !previousNodeIds.has(node.id))
        .map((node) => node.id);
      setError("");
      setNotice(
        source === "paste"
          ? t("detail.notice.pastedNodes", { count: createdNodeIds.length })
          : t("detail.notice.duplicatedNodes", { count: createdNodeIds.length }),
      );
      setWorkflowCache(nextWorkflow);
      pushUndoStep({ kind: "deleteNodes", nodeIds: createdNodeIds });
      selectCreatedNodes(previousWorkflow, nextWorkflow);
    },
    onError: (mutationError) => {
      setNotice("");
      setError(
        mutationError instanceof ApiError
          ? mutationError.detail
          : mutationError instanceof Error
            ? mutationError.message
            : t("detail.error.duplicateNodes"),
      );
    },
  });

  const createUserTemplateGroupMutation = useMutation({
    mutationFn: async () => {
      assertInspirationWritable();
      if (selectedNodeIds.length < 2) {
        throw new Error(t("detail.error.selectNodesToSave"));
      }
      if (workflowNodeIdsContainInspirationContext(selectedNodeIds)) {
        throw new Error(t("detail.error.templateContainsInspirationContext"));
      }
      const title = templateSaveTitle.trim();
      if (!title) {
        throw new Error(t("detail.error.templateNameRequired"));
      }
      await flushSelectedDraft();
      return api.createUserTemplateGroup(inspirationId, {
        title,
        description: templateSaveDescription.trim() || undefined,
        node_ids: selectedNodeIds,
      });
    },
    onSuccess: async () => {
      setError("");
      setTemplateSaveOpen(false);
      setTemplateSaveTitle("");
      setTemplateSaveDescription("");
      await queryClient.invalidateQueries({ queryKey: ["canvas-templates"] });
      setActiveSidebarTab("templates");
      setSidebarCollapsed(false);
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof ApiError
          ? mutationError.detail
          : mutationError instanceof Error
            ? mutationError.message
            : t("detail.error.saveTemplate"),
      );
    },
  });

  const createUserCanvasTemplateMutation = useMutation({
    mutationFn: async () => {
      assertInspirationWritable();
      const title = canvasTemplateSaveTitle.trim();
      if (!title) {
        throw new Error(t("detail.error.templateNameRequired"));
      }
      if (!canvasTemplateSaveCategoryId) {
        throw new Error(t("detail.saveCanvasTemplateCategoryRequired"));
      }
      await flushSelectedDraft();
      return api.createUserCanvasTemplate(inspirationId, {
        title,
        description: canvasTemplateSaveDescription.trim() || undefined,
        category_id: canvasTemplateSaveCategoryId,
        retain_prompt_text: canvasTemplateRetainPromptText,
      });
    },
    onSuccess: async () => {
      setError("");
      setNotice(t("detail.notice.savedCanvasTemplate"));
      setCanvasTemplateSaveOpen(false);
      setCanvasTemplateSaveTitle("");
      setCanvasTemplateSaveDescription("");
      setCanvasTemplateSaveCategoryId("");
      setCanvasTemplateRetainPromptText(true);
      await queryClient.invalidateQueries({ queryKey: ["canvas-templates"] });
      setActiveSidebarTab("templates");
      setSidebarCollapsed(false);
    },
    onError: (mutationError) => {
      setNotice("");
      setError(
        mutationError instanceof ApiError
          ? mutationError.detail
          : mutationError instanceof Error
            ? mutationError.message
            : t("detail.error.saveCanvasTemplate"),
      );
    },
  });

  const updateUserTemplateGroupMutation = useMutation({
    mutationFn: ({ templateId, title }: { templateId: string; title: string }) => {
      assertInspirationWritable();
      return api.updateUserTemplateGroup(templateId, { title });
    },
    onSuccess: async () => {
      setError("");
      await queryClient.invalidateQueries({ queryKey: ["canvas-templates"] });
    },
    onError: (mutationError) => {
      setError(mutationError instanceof ApiError ? mutationError.detail : t("detail.error.updateTemplate"));
    },
  });

  const archiveUserTemplateGroupMutation = useMutation({
    mutationFn: (templateId: string) => {
      assertInspirationWritable();
      return api.archiveUserTemplateGroup(templateId);
    },
    onSuccess: async () => {
      setError("");
      setPendingDeleteAction(null);
      await queryClient.invalidateQueries({ queryKey: ["canvas-templates"] });
    },
    onError: (mutationError) => {
      setPendingDeleteAction(null);
      setError(mutationError instanceof ApiError ? mutationError.detail : t("detail.error.deleteTemplate"));
    },
  });

  const updateNodeConfigMutation = useMutation({
    mutationFn: (node: WorkflowNode) => {
      assertInspirationWritable();
      return api.updateWorkflowNode(node.id, {
        title: draft.title,
        config_json: nodeConfigFromDraft(node, draft, imageToolAllowedFields),
      });
    },
    onSuccess: (nextWorkflow) => {
      setError("");
      queryClient.setQueryData(["inspiration-workflow", inspirationId], nextWorkflow);
    },
    onError: (mutationError) => {
      setSaveStatus("failed");
      setError(
        mutationError instanceof ApiError
          ? mutationError.detail
          : t("detail.error.saveNode"),
      );
    },
  });

  const updateNodeCopyMutation = useMutation({
    mutationFn: (node: WorkflowNode) => {
      assertInspirationWritable();
      if (!draft.copyStructuredPayload) {
        throw new Error(t("detail.error.missingStructuredCopy"));
      }
      return api.updateWorkflowNodeCopy(node.id, {
        structured_payload: draft.copyStructuredPayload,
      });
    },
    onSuccess: async (nextWorkflow) => {
      setError("");
      queryClient.setQueryData(["inspiration-workflow", inspirationId], nextWorkflow);
      setSelectedNodeIds(clearSelectedNodeGroup(selectedNodeId));
      await refreshInspirationArtifacts();
    },
    onError: (mutationError) => {
      setSaveStatus("failed");
      setError(
        mutationError instanceof ApiError
          ? mutationError.detail
          : t("detail.error.saveCopy"),
      );
    },
  });

  const updateNodePositionMutation = useMutation({
    scope: { id: `inspiration-workflow-node-position-${inspirationId}` },
    mutationFn: (input: {
      node: WorkflowNode;
      position_x: number;
      position_y: number;
      mutationVersion: number;
      moveGroupId: string;
      moveGroupSize: number;
      rollbackWorkflow?: InspirationWorkflow;
    }) => {
      assertInspirationWritable();
      return api.updateWorkflowNode(input.node.id, {
        position_x: input.position_x,
        position_y: input.position_y,
      });
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({
        queryKey: ["inspiration-workflow", inspirationId],
      });
      const previous = queryClient.getQueryData<InspirationWorkflow>([
        "inspiration-workflow",
        inspirationId,
      ]);
      return { previous: input.rollbackWorkflow ?? previous };
    },
    onSuccess: (nextWorkflow, input) => {
      if (!workflowCanvasRef.current?.acceptNodePositionMutation(input.node.id, input.mutationVersion)) {
        return;
      }
      setError("");
      const updatedNode = nextWorkflow.nodes.find((node) => node.id === input.node.id);
      workflowHistorySignatureRef.current = getWorkflowStructureSignature(nextWorkflow);
      queryClient.setQueryData<InspirationWorkflow>(
        ["inspiration-workflow", inspirationId],
        (current) => {
          if (!current || !updatedNode) {
            return nextWorkflow;
          }
          return {
            ...current,
            nodes: current.nodes.map((node) => (node.id === updatedNode.id ? updatedNode : node)),
            edges: nextWorkflow.edges,
            runs: nextWorkflow.runs,
            updated_at: nextWorkflow.updated_at,
          };
        },
      );
      workflowCanvasRef.current.clearOptimisticNodePosition(input.node.id);
      const moveGroup = pendingMoveGroupsRef.current[input.moveGroupId] ?? {
        expected: input.moveGroupSize,
        moves: [],
      };
      moveGroup.moves.push({
        nodeId: input.node.id,
        from: { x: input.position_x, y: input.position_y },
        to: { x: input.node.position_x, y: input.node.position_y },
      });
      pendingMoveGroupsRef.current[input.moveGroupId] = moveGroup;
      if (moveGroup.moves.length >= moveGroup.expected) {
        pushUndoStep({ kind: "moveNodes", moves: moveGroup.moves });
        delete pendingMoveGroupsRef.current[input.moveGroupId];
      }
    },
    onError: (mutationError, _input, context) => {
      if (!workflowCanvasRef.current?.acceptNodePositionMutation(_input.node.id, _input.mutationVersion)) {
        return;
      }
      if (context?.previous) {
        setWorkflowCache(context.previous);
      }
      workflowCanvasRef.current.clearOptimisticNodePosition(_input.node.id);
      delete pendingMoveGroupsRef.current[_input.moveGroupId];
      setError(
        mutationError instanceof ApiError
          ? mutationError.detail
          : t("detail.error.moveNode"),
      );
    },
  });

  const createEdgeMutation = useMutation({
    mutationFn: async (input: { sourceNodeId: string; targetNodeId: string }) => {
      assertInspirationWritable();
      const currentWorkflow = queryClient.getQueryData<InspirationWorkflow>(["inspiration-workflow", inspirationId]) ?? workflow;
      const previousEdgeIds = new Set(currentWorkflow?.edges.map((edge) => edge.id) ?? []);
      const source = currentWorkflow?.nodes.find((node) => node.id === input.sourceNodeId);
      const target = currentWorkflow?.nodes.find((node) => node.id === input.targetNodeId);
      if (source?.node_type === "reference_image" && target?.node_type === "reference_image") {
        throw new Error(connectionDescription(source, target, t));
      }
      const nextWorkflow = await api.createWorkflowEdge(inspirationId, {
        source_node_id: input.sourceNodeId,
        target_node_id: input.targetNodeId,
        source_handle: "output",
        target_handle: "input",
      });
      return { nextWorkflow, sourceNodeId: input.sourceNodeId, targetNodeId: input.targetNodeId, previousEdgeIds };
    },
    onSuccess: ({ nextWorkflow, sourceNodeId, targetNodeId, previousEdgeIds }) => {
      const source = nextWorkflow.nodes.find((node) => node.id === sourceNodeId);
      const target = nextWorkflow.nodes.find((node) => node.id === targetNodeId);
      const createdEdgeIds = nextWorkflow.edges
        .filter((edge) => !previousEdgeIds.has(edge.id))
        .map((edge) => edge.id);
      setError("");
      setNotice(source && target ? connectionDescription(source, target, t) : "");
      setWorkflowCache(nextWorkflow);
      pushUndoStep({ kind: "deleteEdges", edgeIds: createdEdgeIds });
      setSelectedNodeIds(clearSelectedNodeGroup(selectedNodeId));
    },
    onError: (mutationError) => {
      setNotice("");
      setError(
        mutationError instanceof ApiError
          ? mutationError.detail
          : mutationError instanceof Error
            ? mutationError.message
          : t("detail.error.connectNode"),
      );
    },
  });

  const deleteEdgeMutation = useMutation({
    mutationFn: async (edgeId: string) => {
      assertInspirationWritable();
      const currentWorkflow = getCurrentWorkflow();
      const edge = currentWorkflow?.edges.find((workflowEdge) => workflowEdge.id === edgeId);
      const restoreStep: WorkflowHistoryStep = edge
        ? { kind: "restoreEdges", edges: [workflowEdgeToRestorableEdge(edge)] }
        : { kind: "restoreEdges", edges: [] };
      const nextWorkflow = await api.deleteWorkflowEdge(edgeId);
      return { nextWorkflow, restoreStep };
    },
    onSuccess: ({ nextWorkflow, restoreStep }) => {
      setError("");
      setNotice("");
      setWorkflowCache(nextWorkflow);
      pushUndoStep(restoreStep);
      setSelectedNodeIds(clearSelectedNodeGroup(selectedNodeId));
    },
    onError: (mutationError) => {
      setPendingDeleteAction(null);
      setError(
        mutationError instanceof ApiError
          ? mutationError.detail
          : t("detail.error.deleteEdge"),
      );
    },
  });

  const deleteNodeMutation = useMutation({
    mutationFn: async (nodeId: string) => {
      assertInspirationWritable();
      const currentWorkflow = getCurrentWorkflow();
      const node = currentWorkflow?.nodes.find((workflowNode) => workflowNode.id === nodeId);
      if (node?.node_type === "inspiration_context") {
        throw new Error(t("detail.error.inspirationContextProtected"));
      }
      const nodeIds = new Set(node ? [node.id] : []);
      const restoreStep = createRestoreNodesStep(
        node ? [node] : [],
        getInternalWorkflowEdges(currentWorkflow?.edges ?? [], nodeIds),
      );
      const nextWorkflow = await api.deleteWorkflowNode(nodeId);
      return { nextWorkflow, nodeId, restoreStep };
    },
    onSuccess: ({ nextWorkflow, nodeId, restoreStep }) => {
      setError("");
      setPendingDeleteAction(null);
      setWorkflowCache(nextWorkflow);
      pushUndoStep(restoreStep);
      const fallbackPrimaryNodeId = selectedNodeId === nodeId ? nextWorkflow.nodes[0]?.id ?? null : selectedNodeId;
      const nextSelection = deleteNodeFromSelection(selectedNodeIds, nodeId, fallbackPrimaryNodeId);
      setSelectedNodeId(nextSelection.primaryNodeId);
      setSelectedNodeIds(nextSelection.selectedNodeIds);
    },
    onError: (mutationError) => {
      setPendingDeleteAction(null);
      setError(
        mutationError instanceof ApiError
          ? mutationError.detail
          : t("detail.error.deleteNode"),
      );
    },
  });

  const handleDeleteNode = (node: WorkflowNode) => {
    if (inspirationWriteBlocked) {
      showInspirationWriteBlockedError();
      return;
    }
    if (node.node_type === "inspiration_context") {
      setError(t("detail.error.inspirationContextProtected"));
      return;
    }
    if (isWorkflowNodeDeleteLocked(node)) {
      setError(
        getWorkflowNodeRunActionState(node, {
          runSubmissionPending: false,
          pendingStartNodeId: null,
        }, t).title,
      );
      return;
    }
    if (workflowActive) {
      setError(t("detail.running"));
      return;
    }
    setPendingDeleteAction({ kind: "node", node });
  };

  const deleteSelectedNodesMutation = useMutation({
    mutationFn: async (nodeIds: string[]) => {
      assertInspirationWritable();
      if (nodeIds.length < 2) {
        throw new Error(t("detail.error.selectNodesToDelete"));
      }
      if (workflowNodeIdsContainInspirationContext(nodeIds)) {
        throw new Error(t("detail.error.inspirationContextProtected"));
      }
      const currentWorkflow = getCurrentWorkflow();
      const nodeIdSet = new Set(nodeIds);
      const restoreStep = createRestoreNodesStep(
        currentWorkflow?.nodes.filter((node) => nodeIdSet.has(node.id)) ?? [],
        getInternalWorkflowEdges(currentWorkflow?.edges ?? [], nodeIdSet),
      );
      let nextWorkflow: InspirationWorkflow | null = null;
      for (const nodeId of nodeIds) {
        nextWorkflow = await api.deleteWorkflowNode(nodeId);
      }
      if (!nextWorkflow) {
        throw new Error(t("detail.error.deleteNode"));
      }
      return { nextWorkflow, restoreStep };
    },
    onSuccess: ({ nextWorkflow, restoreStep }) => {
      setError("");
      setPendingDeleteAction(null);
      setWorkflowCache(nextWorkflow);
      pushUndoStep(restoreStep);
      const nextPrimaryNodeId = nextWorkflow.nodes[0]?.id ?? null;
      setSelectedNodeId(nextPrimaryNodeId);
      setSelectedNodeIds(clearSelectedNodeGroup(nextPrimaryNodeId));
      setTemplateSaveOpen(false);
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof ApiError
          ? mutationError.detail
          : mutationError instanceof Error
            ? mutationError.message
            : t("detail.error.deleteSelectedNodes"),
      );
    },
  });

  const uploadNodeImageMutation = useMutation({
    mutationFn: (file: File) => {
      assertInspirationWritable();
      if (!selectedNode) {
        throw new Error(t("detail.error.selectImageNode"));
      }
      return api.uploadWorkflowNodeImage(selectedNode.id, {
        file,
        role: draft.role,
        label: draft.label,
      });
    },
    onSuccess: async (nextWorkflow) => {
      setError("");
      queryClient.setQueryData(["inspiration-workflow", inspirationId], nextWorkflow);
      setSelectedNodeIds(clearSelectedNodeGroup(selectedNodeId));
      await refreshInspirationArtifacts();
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof ApiError ? mutationError.detail : t("detail.error.upload"),
      );
    },
  });

  const uploadNodeDocumentMutation = useMutation({
    mutationFn: (file: File) => {
      assertInspirationWritable();
      if (!selectedNode || selectedNode.node_type !== "inspiration_context") {
        throw new Error(t("detail.error.selectContextNode"));
      }
      return api.uploadWorkflowNodeDocument(selectedNode.id, { file });
    },
    onSuccess: async (nextWorkflow) => {
      setError("");
      queryClient.setQueryData(["inspiration-workflow", inspirationId], nextWorkflow);
      setSelectedNodeIds(clearSelectedNodeGroup(selectedNodeId));
      await refreshInspirationArtifacts();
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof ApiError ? mutationError.detail : t("detail.error.uploadDocument"),
      );
    },
  });

  const bindNodeImageMutation = useMutation({
    mutationFn: (input: { source_asset_id?: string; poster_variant_id?: string }) => {
      assertInspirationWritable();
      if (!selectedNode || selectedNode.node_type !== "reference_image") {
        throw new Error(t("detail.error.selectImageNode"));
      }
      return api.bindWorkflowNodeImage(selectedNode.id, input);
    },
    onSuccess: async (nextWorkflow) => {
      setError("");
      queryClient.setQueryData(["inspiration-workflow", inspirationId], nextWorkflow);
      setSelectedNodeIds(clearSelectedNodeGroup(selectedNodeId));
      await refreshInspirationArtifacts();
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof ApiError
          ? mutationError.detail
          : t("detail.error.fill"),
      );
    },
  });

  const loadResourceLibraryAssetMutation = useMutation({
    mutationFn: (assetId: string) => {
      assertInspirationWritable();
      if (!selectedReferenceNode) {
        throw new Error(t("detail.error.selectImageNode"));
      }
      return api.loadResourceLibraryAssetToWorkflowNode(assetId, {
        node_id: selectedReferenceNode.id,
      });
    },
    onSuccess: async (nextWorkflow) => {
      setError("");
      setNotice(t("resourceLibrary.loadToCurrentNode"));
      queryClient.setQueryData(["inspiration-workflow", inspirationId], nextWorkflow);
      setSelectedNodeIds(clearSelectedNodeGroup(selectedNodeId));
      setResourceLibraryOpen(false);
      await refreshInspirationArtifacts();
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof ApiError
          ? mutationError.detail
          : t("resourceLibrary.loadFailedAction"),
      );
    },
  });

  const clearNodeImageMutation = useMutation({
    mutationFn: () => {
      assertInspirationWritable();
      if (!selectedNode || selectedNode.node_type !== "reference_image") {
        throw new Error(t("detail.error.selectImageNode"));
      }
      return api.clearWorkflowNodeImage(selectedNode.id);
    },
    onSuccess: (nextWorkflow) => {
      setError("");
      queryClient.setQueryData(["inspiration-workflow", inspirationId], nextWorkflow);
      setSelectedNodeIds(clearSelectedNodeGroup(selectedNodeId));
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof ApiError
          ? mutationError.detail
          : t("detail.error.clearReferenceImage"),
      );
    },
  });

  const selectedCopyHasOutput = Boolean(
    selectedNode?.node_type === "copy_generation" &&
      selectedNode.output_json &&
      outputText(selectedNode.output_json, "copy_set_id"),
  );

  function handleOpenResourceLibrary() {
    setResourceLibraryOpen(true);
  }

  function handlePreviewImage(image: DownloadableImage) {
    setPreviewImage(image);
    setPreviewResourceLibrarySource(resourceLibrarySourceFromPreviewImage(image));
  }

  function closePreviewImage() {
    setPreviewImage(null);
    setPreviewResourceLibrarySource(null);
  }

  function getResourceLibrarySourceDisabledTitle(source: ResourceLibrarySaveSource | null): string {
    if (!source) {
      return "";
    }
    if (resourceLibraryWriteBlockedTitle) {
      return resourceLibraryWriteBlockedTitle;
    }
    const sourceResource =
      source.source_type === "poster_variant"
        ? posters.find((poster) => poster.id === source.source_id)
        : resourceLibraryStatusInspiration?.source_assets.find((asset) => asset.id === source.source_id) ?? null;
    return isResourceBlocked(sourceResource) ? getResourceBlockedActionTitle(sourceResource, t("resource.blockedAction")) : "";
  }

  function handleSavePreviewImageToResourceLibrary() {
    if (!previewResourceLibrarySource) {
      return;
    }
    const disabledTitle = getResourceLibrarySourceDisabledTitle(previewResourceLibrarySource);
    if (disabledTitle) {
      setNotice("");
      setError(disabledTitle);
      return;
    }
    setResourceLibrarySaveSource(previewResourceLibrarySource);
  }

  function handleSavePosterToResourceLibrary(poster: PosterVariant) {
    if (resourceLibraryWriteBlockedTitle) {
      setNotice("");
      setError(resourceLibraryWriteBlockedTitle);
      return;
    }
    setResourceLibrarySaveSource({
      source_type: "poster_variant",
      source_id: poster.id,
      title: poster.kind === "main_image" ? t("detail.mainImage") : t("detail.promoImage"),
      thumbnail_url: poster.thumbnail_url,
    });
  }

  function handleSaveSourceAssetToResourceLibrary(asset: SourceAsset) {
    if (resourceLibraryWriteBlockedTitle) {
      setNotice("");
      setError(resourceLibraryWriteBlockedTitle);
      return;
    }
    setResourceLibrarySaveSource({
      source_type: "source_asset",
      source_id: asset.id,
      title: asset.kind === "original_image" ? t("detail.mainImage") : t("detail.referenceImage"),
      thumbnail_url: asset.thumbnail_url,
    });
  }

  function handleResourceLibraryAssetSelect(asset: ResourceLibraryAsset) {
    if (resourceLibraryWriteBlockedTitle) {
      setNotice("");
      setError(resourceLibraryWriteBlockedTitle);
      return;
    }
    if (inspirationWriteBlocked) {
      showInspirationWriteBlockedError();
      return;
    }
    if (!selectedReferenceNode) {
      setNotice("");
      setError(t("detail.error.selectImageNode"));
      return;
    }
    loadResourceLibraryAssetMutation.mutate(asset.id);
  }

  const flushSelectedDraft = async () => {
    if (!selectedNode || !draftDirty) {
      return;
    }
    const saveVersion = draftVersionRef.current;
    setSaveStatus("saving");
    await updateNodeConfigMutation.mutateAsync(selectedNode);
    if (selectedCopyHasOutput) {
      if (draft.copyStructuredPayload?.summary.trim()) {
        await updateNodeCopyMutation.mutateAsync(selectedNode);
      }
    }
    if (draftVersionRef.current === saveVersion) {
      setDraftDirty(false);
      setSaveStatus("saved");
    } else {
      setSaveStatus("idle");
    }
  };

  useEffect(() => {
    if (!selectedNode || !draftDirty || workflowActive || inspirationWriteBlocked) {
      return;
    }
    setSaveStatus("saving");
    const timer = window.setTimeout(() => {
      void flushSelectedDraft();
    }, 700);
    return () => window.clearTimeout(timer);
  }, [draft, draftDirty, inspirationWriteBlocked, selectedNode?.id, workflowActive]);

  const handleRunWorkflow = async (startNodeId?: string, startMode: WorkflowRunStartMode = "from_node") => {
    if (inspirationGenerateBlocked) {
      showInspirationGenerateBlockedError();
      return;
    }
    const targetNodes = startNodeId
      ? (workflow?.nodes.filter((node) => node.id === startNodeId) ?? [])
      : (workflow?.nodes ?? []);
    const missingResourceGroup = targetNodes.some((node) => {
      if (!workflowNodeRequiresResourceGroup(node)) {
        return false;
      }
      if (selectedNode?.id === node.id) {
        return !draft.resourceGroupId;
      }
      return !workflowNodeResourceGroupId(node);
    });
    if (missingResourceGroup) {
      setError(t("detail.inspector.resourceGroupRequired"));
      return;
    }
    if (targetNodes.some((node) => workflowNodeMissingManualGenerationConfig(node, selectedNode, draft))) {
      setError(t("detail.inspector.generationConfigRequired"));
      return;
    }
    try {
      await flushSelectedDraft();
      await runWorkflowMutation.mutateAsync(startNodeId ? { startNodeId, startMode } : undefined);
    } catch {
      // Mutations already surface ApiError.detail in local error state.
    }
  };

  const handleConfirmTailSplitPlan = async (
    items: ApplyTailSplitPlanItemInput[],
    imageGenerationConfig: ApplyTailSplitPlanImageGenerationConfigInput,
    reuseOptions: ApplyTailSplitPlanReuseOptions,
  ) => {
    if (!selectedNode || selectedNode.node_type !== "tail_splitter" || !selectedTailPendingPlan) {
      return;
    }
    if (!items.length) {
      setError(t("detail.tailPlan.selectAtLeastOne"));
      return;
    }
    if (inspirationWriteBlocked) {
      showInspirationWriteBlockedError();
      return;
    }
    try {
      await applyTailSplitPlanMutation.mutateAsync({
        nodeId: selectedNode.id,
        plan: selectedTailPendingPlan,
        items,
        imageGenerationConfig,
        reuseOptions,
      });
    } catch {
      // mutation handles UI errors
    }
  };

  const handleCancelWorkflowRun = (run: InspirationWorkflow["runs"][number]) => {
    if (inspirationGenerateBlocked) {
      showInspirationGenerateBlockedError();
      return;
    }
    if (!run.is_cancelable || cancelWorkflowRunMutation.isPending) {
      return;
    }
    cancelWorkflowRunMutation.mutate(run.id);
  };

  const handleRetryWorkflowRun = (run: InspirationWorkflow["runs"][number]) => {
    if (inspirationGenerateBlocked) {
      showInspirationGenerateBlockedError();
      return;
    }
    if (!run.is_retryable || retryWorkflowRunMutation.isPending) {
      return;
    }
    retryWorkflowRunMutation.mutate(run.id);
  };

  const handleRetryFailedWorkflowNodes = async () => {
    if (inspirationGenerateBlocked) {
      showInspirationGenerateBlockedError();
      return;
    }
    const failedNodes = workflow?.nodes.filter((node) => node.status === "failed") ?? [];
    if (!failedNodes.length) {
      setError(t("detail.failedNodesRetry.empty"));
      return;
    }
    if (failedNodes.some((node) => !node.is_retryable)) {
      setError(t("detail.failedNodesRetry.nonRetryable"));
      return;
    }
    try {
      await flushSelectedDraft();
      await retryFailedWorkflowNodesMutation.mutateAsync();
    } catch {
      // mutation handles UI errors
    }
  };

  const openSidebarTab = (tab: SidebarTab) => {
    if (tab === "images") {
      setGalleryOpen(true);
      return;
    }
    setActiveSidebarTab(tab);
    setSidebarCollapsed(false);
  };

  const startInspectorResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    disableBodyUserSelect();
    const startX = event.clientX;
    const startWidth = inspectorWidth;
    const onMove = (moveEvent: PointerEvent) => {
      const next = clamp(startWidth + startX - moveEvent.clientX, MIN_INSPECTOR_WIDTH, MAX_INSPECTOR_WIDTH);
      setInspectorWidth(next);
      window.localStorage.setItem("inspiration-one.workflow.inspectorWidth", String(next));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      restoreBodyUserSelect();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const layoutMutationBusy =
    createNodeMutation.isPending ||
    applyTemplateGroupMutation.isPending ||
    applyTailSplitPlanMutation.isPending ||
    duplicateNodeGroupMutation.isPending ||
    historyActionBusy ||
    createEdgeMutation.isPending ||
    deleteEdgeMutation.isPending ||
    deleteNodeMutation.isPending ||
    deleteSelectedNodesMutation.isPending ||
    uploadNodeImageMutation.isPending ||
    uploadNodeDocumentMutation.isPending ||
    bindNodeImageMutation.isPending ||
    loadResourceLibraryAssetMutation.isPending ||
    clearNodeImageMutation.isPending ||
    createUserCanvasTemplateMutation.isPending;
  const inspectorBusy = layoutMutationBusy || inspirationWriteBlocked;
  const structureBusy = layoutMutationBusy || workflowActive || inspirationWriteBlocked;
  const runSubmissionPending =
    runWorkflowMutation.isPending || retryWorkflowRunMutation.isPending || retryFailedWorkflowNodesMutation.isPending;
  const pendingStartNodeId = runWorkflowMutation.isPending ? (runWorkflowMutation.variables?.startNodeId ?? null) : null;
  const activeWorkflowRun = latestActiveWorkflowRun(workflow);
  const activeWorkflowRunLabel =
    activeWorkflowRun?.status === "waiting_confirmation"
      ? t("detail.runStatus.waiting_confirmation")
      : activeWorkflowRun?.status === "running"
        ? t("detail.runStatus.running")
        : "";
  const activeWorkflowRunQueueText = activeWorkflowRun ? workflowRunQueueText(activeWorkflowRun, t) : "";
  const fullWorkflowRunBusy = runSubmissionPending || workflowActive;
  const fullWorkflowRunSpinner = runSubmissionPending || activeWorkflowRun?.status === "running";
  const fullWorkflowRunDisabled = fullWorkflowRunBusy || inspirationGenerateBlocked;
  const fullWorkflowRunTitle = inspirationGenerateBlocked
    ? inspirationGenerateBlockedTitle
    : activeWorkflowRunQueueText || activeWorkflowRunLabel
      ? [activeWorkflowRunLabel, activeWorkflowRunQueueText].filter(Boolean).join(" · ")
      : runSubmissionPending
        ? t("detail.workflowRunning")
        : workflowActive
          ? t("detail.workflowRunning")
          : t("detail.runWorkflow");
  const fullWorkflowRunLabel = runSubmissionPending
    ? t("detail.running")
    : activeWorkflowRunLabel
      ? activeWorkflowRunLabel
      : t("detail.runFullWorkflow");
  const workflowRunActionBusyRunId =
    (cancelWorkflowRunMutation.isPending ? cancelWorkflowRunMutation.variables : null) ??
    (retryWorkflowRunMutation.isPending ? retryWorkflowRunMutation.variables : null);
  const pendingDeleteDialog = pendingDeleteAction
    ? (() => {
        if (pendingDeleteAction.kind === "node") {
          return {
            title: t("detail.confirm.deleteNodeTitle"),
            description: t("detail.confirm.deleteNode", { title: pendingDeleteAction.node.title }),
            busy: deleteNodeMutation.isPending,
          };
        }
        if (pendingDeleteAction.kind === "selectedNodes") {
          return {
            title: t("detail.confirm.deleteSelectedNodesTitle"),
            description: t("detail.confirm.deleteSelectedNodes", { count: pendingDeleteAction.count }),
            busy: deleteSelectedNodesMutation.isPending,
          };
        }
        return {
          title: t("detail.confirm.deleteTemplateTitle"),
          description: t("detail.confirm.deleteTemplate", { title: pendingDeleteAction.title }),
          busy: archiveUserTemplateGroupMutation.isPending,
        };
      })()
    : null;
  const pendingHistoryDeleteCount =
    pendingHistoryAction?.step.kind === "deleteNodes"
      ? pendingHistoryAction.step.nodeIds.length
      : pendingHistoryAction?.step.kind === "deleteEdges"
        ? pendingHistoryAction.step.edgeIds.length
        : 0;
  const pendingHistoryDialog = pendingHistoryAction
    ? {
        title: pendingHistoryAction.direction === "undo" ? t("detail.confirm.undoTitle") : t("detail.confirm.redoTitle"),
        description: t("detail.confirm.historyDeletes", { count: pendingHistoryDeleteCount }),
      }
    : null;

  const workflowActionPrimaryNode = useCallback((target: WorkflowCanvasActionTarget) => {
    const primaryNodeId = target.kind === "single" ? target.nodeId : target.primaryNodeId;
    return workflow?.nodes.find((node) => node.id === primaryNodeId) ?? null;
  }, [workflow]);

  const workflowActionTargetNodes = useCallback((target: WorkflowCanvasActionTarget) => {
    const targetNodeIds = new Set(getWorkflowCanvasActionTargetNodeIds(target));
    return workflow?.nodes.filter((node) => targetNodeIds.has(node.id)) ?? [];
  }, [workflow]);

  const workflowActionItems = useCallback((target: WorkflowCanvasActionTarget): WorkflowCanvasActionItem[] => {
    const primaryNode = workflowActionPrimaryNode(target);
    const runActionState = primaryNode
      ? getWorkflowNodeRunActionState(primaryNode, {
          runSubmissionPending,
          pendingStartNodeId,
        })
      : null;
    return buildWorkflowCanvasActionItems(target, {
      primaryNode,
      targetNodes: workflowActionTargetNodes(target),
      runActionState: inspirationGenerateBlocked && runActionState
        ? {
            ...runActionState,
            disabled: true,
            pending: false,
            title: inspirationGenerateBlockedTitle,
          }
        : runActionState,
      structureBusy,
      duplicatePending: duplicateNodeGroupMutation.isPending,
      templatePending: createUserTemplateGroupMutation.isPending,
      deletePending: deleteNodeMutation.isPending || deleteSelectedNodesMutation.isPending,
    }).map((item) => {
      const label = item.label ?? (item.labelKey ? t(item.labelKey) : "");
      return {
        ...item,
        label,
        title: item.title ?? label,
      };
    });
  }, [
    createUserTemplateGroupMutation.isPending,
    deleteNodeMutation.isPending,
    deleteSelectedNodesMutation.isPending,
    duplicateNodeGroupMutation.isPending,
    inspirationGenerateBlocked,
    inspirationGenerateBlockedTitle,
    pendingStartNodeId,
    runSubmissionPending,
    structureBusy,
    t,
    workflowActionPrimaryNode,
    workflowActionTargetNodes,
  ]);

  const executeWorkflowCanvasAction = (actionId: WorkflowCanvasActionId, target: WorkflowCanvasActionTarget) => {
    const nodeIds = getWorkflowCanvasActionTargetNodeIds(target);
    if (actionId === "fitSelected") {
      workflowCanvasRef.current?.fitNodeIds(nodeIds);
      return;
    }
    if (actionId === "run") {
      if (inspirationGenerateBlocked) {
        showInspirationGenerateBlockedError();
        return;
      }
      if (target.kind === "single") {
        void handleRunWorkflow(target.nodeId);
      }
      return;
    }
    if (actionId === "runAfter") {
      if (inspirationGenerateBlocked) {
        showInspirationGenerateBlockedError();
        return;
      }
      if (target.kind === "single") {
        void handleRunWorkflow(target.nodeId, "after_node");
      }
      return;
    }
    if (inspirationWriteBlocked) {
      showInspirationWriteBlockedError();
      return;
    }
    if (actionId === "duplicate") {
      duplicateNodeGroupMutation.mutate({ nodeIds, source: "duplicate" });
      return;
    }
    if (actionId === "saveTemplate") {
      if (target.kind === "group") {
        setSelectedNodeId(target.primaryNodeId);
        setSelectedNodeIds(target.nodeIds);
      }
      setTemplateSaveOpen(true);
      return;
    }
    if (nodeIds.length === 1) {
      const node = workflow?.nodes.find((workflowNode) => workflowNode.id === nodeIds[0]);
      if (node) {
        if (node.node_type === "inspiration_context") {
          setError(t("detail.error.inspirationContextProtected"));
          return;
        }
        setPendingDeleteAction({ kind: "node", node });
      }
      return;
    }
    if (nodeIds.length > 1) {
      setPendingDeleteAction({
        kind: "selectedNodes",
        nodeIds,
        count: nodeIds.length,
      });
    }
  };

  const getWorkflowNodeActionToolbar = useCallback((nodeId: string): WorkflowCanvasActionToolbar | null => {
    const target = getWorkflowCanvasActionTargetForNodeToolbar(nodeId, selectedNodeId, selectedNodeIds);
    if (!target) {
      return null;
    }
    const items = workflowActionItems(target);
    return items.length ? { target, items } : null;
  }, [selectedNodeId, selectedNodeIds, workflowActionItems]);

  const commitNodePosition = (input: NodePositionCommitInput) => {
    if (inspirationWriteBlocked) {
      workflowCanvasRef.current?.clearOptimisticNodePosition(input.node.id);
      showInspirationWriteBlockedError();
      return;
    }
    const rollbackWorkflow = queryClient.getQueryData<InspirationWorkflow>([
      "inspiration-workflow",
      inspirationId,
    ]);
    queryClient.setQueryData<InspirationWorkflow>(
      ["inspiration-workflow", inspirationId],
      (current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          nodes: current.nodes.map((node) =>
            node.id === input.node.id
              ? {
                  ...node,
                  position_x: input.position_x,
                  position_y: input.position_y,
                }
              : node,
          ),
        };
      },
    );
    updateNodePositionMutation.mutate({
      ...input,
      rollbackWorkflow,
    });
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const shortcut = getWorkflowKeyboardShortcut(event);
      if (!shortcut) {
        return;
      }
      if (!workflow) {
        return;
      }
      if (
        previewImage ||
        pendingDeleteAction ||
        pendingHistoryAction ||
        templateSaveOpen ||
        canvasTemplateSaveOpen
      ) {
        return;
      }
      event.preventDefault();
      const shortcutNodeIds = getSelectedWorkflowShortcutNodeIds(selectedNodeIds, selectedNodeId);

      if (shortcut === "copy") {
        if (!shortcutNodeIds.length) {
          return;
        }
        workflowClipboardRef.current = { nodeIds: shortcutNodeIds };
        setNotice(t("detail.notice.copiedNodes", { count: shortcutNodeIds.length }));
        setError("");
        return;
      }

      if (inspirationWriteBlocked) {
        showInspirationWriteBlockedError();
        return;
      }

      if (structureBusy) {
        setError(t("detail.error.shortcutBusy"));
        return;
      }

      if (shortcut === "paste") {
        const clipboard = workflowClipboardRef.current;
        if (!clipboard?.nodeIds.length) {
          return;
        }
        duplicateNodeGroupMutation.mutate({ nodeIds: clipboard.nodeIds, source: "paste" });
        return;
      }

      if (shortcut === "duplicate") {
        if (!shortcutNodeIds.length) {
          return;
        }
        duplicateNodeGroupMutation.mutate({ nodeIds: shortcutNodeIds, source: "duplicate" });
        return;
      }

      if (shortcut === "delete") {
        if (!shortcutNodeIds.length) {
          return;
        }
      if (workflowNodeIdsContainInspirationContext(shortcutNodeIds)) {
        setError(t("detail.error.inspirationContextProtected"));
        return;
      }
      const shortcutNodes = workflow.nodes.filter((workflowNode) => shortcutNodeIds.includes(workflowNode.id));
      const lockedShortcutNode = shortcutNodes.find(isWorkflowNodeDeleteLocked);
      if (lockedShortcutNode) {
        setError(
          getWorkflowNodeRunActionState(lockedShortcutNode, {
            runSubmissionPending: false,
            pendingStartNodeId: null,
          }, t).title,
        );
        return;
      }
      if (workflowActive) {
        setError(t("detail.running"));
        return;
      }
      if (shortcutNodeIds.length === 1) {
        const node = workflow.nodes.find((workflowNode) => workflowNode.id === shortcutNodeIds[0]);
        if (node) {
            setPendingDeleteAction({ kind: "node", node });
          }
          return;
        }
        setPendingDeleteAction({
          kind: "selectedNodes",
          nodeIds: shortcutNodeIds,
          count: shortcutNodeIds.length,
        });
        return;
      }

      requestHistoryDirection(shortcut);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    duplicateNodeGroupMutation,
    pendingDeleteAction,
    pendingHistoryAction,
    previewImage,
    requestHistoryDirection,
    selectedNodeId,
    selectedNodeIds,
    inspirationWriteBlocked,
    showInspirationWriteBlockedError,
    structureBusy,
    t,
    canvasTemplateSaveOpen,
    templateSaveOpen,
    workflow,
  ]);

  useEffect(() => {
    if (!workflow?.nodes.length || !selectedNode) {
      return;
    }
    if (!mobileCanvasControlsActive) {
      return;
    }

    const layoutKey = `${inspirationId}:${workflow.nodes.map((node) => node.id).join("|")}`;
    if (mobileInitialCanvasViewRef.current === layoutKey) {
      return;
    }
    mobileInitialCanvasViewRef.current = layoutKey;

    window.requestAnimationFrame(() => {
      workflowCanvasRef.current?.centerNode(selectedNode);
    });
  }, [mobileCanvasControlsActive, inspirationId, selectedNode, workflow?.nodes]);

  const resourceLibraryStatusInspiration = inspirationQuery.data ?? null;
  const resourceLibraryPosterItems =
    historyQuery.data?.poster_variants ?? resourceLibraryStatusInspiration?.poster_variants ?? [];
  const resourceLibraryPosterSourceAssetIds = useMemo(() => {
    if (!resourceLibraryStatusInspiration) {
      return new Map<string, string>();
    }
    return buildPosterSourceAssetMap({
      inspiration: resourceLibraryStatusInspiration,
      workflow,
      posters: resourceLibraryPosterItems,
    });
  }, [resourceLibraryPosterItems, resourceLibraryStatusInspiration, workflow]);
  const resourceLibraryReferenceAssets = useMemo(() => {
    if (!resourceLibraryStatusInspiration) {
      return [];
    }
    return getVisibleReferenceAssets({
      inspiration: resourceLibraryStatusInspiration,
      posterSourceAssetIds: resourceLibraryPosterSourceAssetIds,
      posters: resourceLibraryPosterItems,
    });
  }, [resourceLibraryPosterItems, resourceLibraryPosterSourceAssetIds, resourceLibraryStatusInspiration]);
  const resourceLibraryPosterIds = useMemo(
    () => resourceLibraryPosterItems.map((poster) => poster.id),
    [resourceLibraryPosterItems],
  );
  const resourceLibraryReferenceAssetIds = useMemo(
    () => {
      const assetIds = new Set(resourceLibraryReferenceAssets.map((asset) => asset.id));
      for (const asset of resourceLibraryStatusInspiration?.source_assets ?? []) {
        if (RESOURCE_LIBRARY_SOURCE_ASSET_IMAGE_KINDS.has(asset.kind)) {
          assetIds.add(asset.id);
        }
      }
      return [...assetIds];
    },
    [resourceLibraryReferenceAssets, resourceLibraryStatusInspiration?.source_assets],
  );
  const posterResourceLibraryStatusQuery = useQuery({
    queryKey: ["resource-library-source-status", "poster_variant", resourceLibraryPosterIds],
    queryFn: () =>
      api.listResourceLibrarySourceStatus({
        source_type: "poster_variant",
        source_ids: resourceLibraryPosterIds,
      }),
    enabled: resourceLibraryPosterIds.length > 0,
  });
  const sourceAssetResourceLibraryStatusQuery = useQuery({
    queryKey: ["resource-library-source-status", "source_asset", resourceLibraryReferenceAssetIds],
    queryFn: () =>
      api.listResourceLibrarySourceStatus({
        source_type: "source_asset",
        source_ids: resourceLibraryReferenceAssetIds,
      }),
    enabled: resourceLibraryReferenceAssetIds.length > 0,
  });
  const savedPosterIds = useMemo(
    () =>
      new Set(
        (posterResourceLibraryStatusQuery.data?.items ?? [])
          .filter((item) => item.saved)
          .map((item) => item.source_id),
      ),
    [posterResourceLibraryStatusQuery.data?.items],
  );
  const savedSourceAssetIds = useMemo(
    () =>
      new Set(
        (sourceAssetResourceLibraryStatusQuery.data?.items ?? [])
          .filter((item) => item.saved)
          .map((item) => item.source_id),
      ),
    [sourceAssetResourceLibraryStatusQuery.data?.items],
  );

  const workflowCanvasSelectNodeRef = useRef(selectNodeFromPointer);
  workflowCanvasSelectNodeRef.current = selectNodeFromPointer;
  const handleWorkflowCanvasSelectNode = useCallback((nodeId: string, event: ReactMouseEvent<Element>) => {
    workflowCanvasSelectNodeRef.current(nodeId, event);
  }, []);

  const workflowCanvasDragCompleteSelectRef = useRef(selectNodeForDragStart);
  workflowCanvasDragCompleteSelectRef.current = selectNodeForDragStart;
  const handleWorkflowCanvasDragCompleteSelect = useCallback((nodeId: string) => {
    workflowCanvasDragCompleteSelectRef.current(nodeId);
  }, []);

  const workflowCanvasSelectionBoxCompleteRef = useRef(replaceSelectionFromBox);
  workflowCanvasSelectionBoxCompleteRef.current = replaceSelectionFromBox;
  const handleWorkflowCanvasSelectionBoxComplete = useCallback((nodeIds: string[]) => {
    workflowCanvasSelectionBoxCompleteRef.current(nodeIds);
  }, []);

  const workflowCanvasNodePositionCommitRef = useRef(commitNodePosition);
  workflowCanvasNodePositionCommitRef.current = commitNodePosition;
  const handleWorkflowCanvasNodePositionCommit = useCallback((input: NodePositionCommitInput) => {
    workflowCanvasNodePositionCommitRef.current(input);
  }, []);

  const workflowCanvasNodeActionRef = useRef(executeWorkflowCanvasAction);
  workflowCanvasNodeActionRef.current = executeWorkflowCanvasAction;
  const handleWorkflowCanvasNodeAction = useCallback(
    (actionId: WorkflowCanvasActionId, target: WorkflowCanvasActionTarget) => {
      workflowCanvasNodeActionRef.current(actionId, target);
    },
    [],
  );

  const workflowCanvasClearSelectionRef = useRef(clearCanvasSelection);
  workflowCanvasClearSelectionRef.current = clearCanvasSelection;
  const handleWorkflowCanvasClearSelection = useCallback(() => {
    workflowCanvasClearSelectionRef.current();
  }, []);

  const workflowCanvasPreviewImageRef = useRef(handlePreviewImage);
  workflowCanvasPreviewImageRef.current = handlePreviewImage;
  const handleWorkflowCanvasPreviewImage = useCallback((image: DownloadableImage) => {
    workflowCanvasPreviewImageRef.current(image);
  }, []);

  const handleWorkflowCanvasNodeDragGroup = useCallback(
    (nodeId: string) => (selectedNodeIds.includes(nodeId) ? selectedNodeIds : [nodeId]),
    [selectedNodeIds],
  );
  const createEdgeMutationRef = useRef(createEdgeMutation);
  createEdgeMutationRef.current = createEdgeMutation;
  const handleWorkflowCanvasConnectionCreate = useCallback((input: { sourceNodeId: string; targetNodeId: string }) => {
    createEdgeMutationRef.current.mutate(input);
  }, []);
  const deleteEdgeMutationRef = useRef(deleteEdgeMutation);
  deleteEdgeMutationRef.current = deleteEdgeMutation;
  const handleWorkflowCanvasDeleteEdge = useCallback((edgeId: string) => {
    deleteEdgeMutationRef.current.mutate(edgeId);
  }, []);
  const handleWorkflowCanvasToggleSnapToGrid = useCallback(() => {
    setSnapToGrid((prev) => !prev);
  }, []);
  const handleWorkflowCanvasAutoLayout = useCallback(() => {
    workflowCanvasRef.current?.triggerAutoLayout();
  }, []);
  const getWorkflowCanvasNodeImage = useCallback(
    (node: WorkflowNode) => (inspirationQuery.data ? getNodeImageDownload(node, inspirationQuery.data, t) : null),
    [inspirationQuery.data, t],
  );

  if (inspirationQuery.isLoading) {
    return (
      <div className="pf-workspace flex min-h-[100dvh] items-center justify-center text-zinc-400 dark:text-slate-400">
        <Loader2 size={24} className="animate-spin" />
      </div>
    );
  }

  if (inspirationQuery.isError || !inspirationQuery.data) {
    return (
      <div className="pf-workspace flex min-h-[100dvh] items-center justify-center">
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200">
          {t("detail.loadFailed")}
        </div>
      </div>
    );
  }

  const inspiration = inspirationQuery.data;
  const sourceImage = getSourceImageDownload(inspiration, t);
  const latestRun = workflow?.runs[0] ?? null;
  const selectedNodeCancelableRun = getWorkflowNodeCancelableRun(workflow, selectedNode);
  const failedWorkflowNodes = workflow?.nodes.filter((node) => node.status === "failed") ?? [];
  const retryableFailedWorkflowNodes = failedWorkflowNodes.filter((node) => node.is_retryable);
  const failedWorkflowNodesRetryTitle = inspirationGenerateBlocked
    ? inspirationGenerateBlockedTitle
    : failedWorkflowNodes.length === 0
      ? t("detail.failedNodesRetry.empty")
      : retryableFailedWorkflowNodes.length !== failedWorkflowNodes.length
        ? t("detail.failedNodesRetry.nonRetryable")
        : t("detail.failedNodesRetry.title", { count: failedWorkflowNodes.length });
  const retryFailedWorkflowNodesDisabled =
    inspirationGenerateBlocked ||
    retryFailedWorkflowNodesMutation.isPending ||
    failedWorkflowNodes.length === 0 ||
    retryableFailedWorkflowNodes.length !== failedWorkflowNodes.length;
  const posters = resourceLibraryPosterItems;
  const posterSourceAssetIds = resourceLibraryPosterSourceAssetIds;
  const referenceAssets = resourceLibraryReferenceAssets;
  const artifactCount = posters.length + referenceAssets.length;
  const previewResourceLibrarySaved =
    previewResourceLibrarySource?.source_type === "poster_variant"
      ? savedPosterIds.has(previewResourceLibrarySource.source_id)
      : previewResourceLibrarySource?.source_type === "source_asset"
        ? savedSourceAssetIds.has(previewResourceLibrarySource.source_id)
        : false;
  const previewResourceLibrarySaving = Boolean(
    previewResourceLibrarySource &&
      resourceLibrarySaveSource?.source_type === previewResourceLibrarySource.source_type &&
      resourceLibrarySaveSource.source_id === previewResourceLibrarySource.source_id,
  );
  const previewResourceLibraryDisabledTitle = getResourceLibrarySourceDisabledTitle(previewResourceLibrarySource);
  const selectedGroupCount = selectedNodeIds.length;
  const workflowCanvasKeyboardShortcutsActive =
    !previewImage &&
    !pendingDeleteAction &&
    !pendingHistoryAction &&
    !templateSaveOpen &&
    !canvasTemplateSaveOpen;
  const fillReferenceBusy = bindNodeImageMutation.isPending;
  const queueOverview = canReadGenerationQueue ? (queueOverviewQuery.data ?? null) : null;
  const queueOverviewText =
    queueOverview && queueOverview.active_count > 0
      ? t("detail.queueOverview", {
          running: queueOverview.running_count,
          queued: queueOverview.queued_count,
          active: queueOverview.active_count,
          max: queueOverview.max_concurrent_tasks,
        })
      : "";
  const queueOverviewInlineText =
    queueOverview && queueOverview.active_count > 0
      ? t("detail.runRunningText", {
          running: queueOverview.running_count,
          queued: queueOverview.queued_count,
        })
      : "";
  const activeRunQueueTextAlreadyIncludesGlobalCounts =
    activeWorkflowRun?.status === "running" && typeof activeWorkflowRun.queue_position !== "number";
  const showQueueOverview = Boolean(queueOverviewText && !activeWorkflowRun);
  const activeWorkflowRunStatusClassName =
    activeWorkflowRun?.status === "waiting_confirmation"
      ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-200"
      : "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-400/35 dark:bg-blue-500/10 dark:text-blue-200";
  const canvasTemplates = canvasTemplatesQuery.data?.items ?? [];
  const canvasTemplateCategories: CanvasTemplateCategory[] = canvasTemplateCategoriesQuery.data?.items ?? [];
  const userCanvasTemplateCategories: CanvasTemplateCategory[] = userCanvasTemplateCategoriesQuery.data?.items ?? [];
  const canvasTemplateSaveDisabled = workflowInitialEntryMode === "blank" || inspirationWriteBlocked || !workflow;
  const canvasTemplateHasTailNode = Boolean(workflow?.nodes.some((node) => node.node_type === "tail_splitter"));
  const userTemplateMutationBusy =
    createUserTemplateGroupMutation.isPending ||
    createUserCanvasTemplateMutation.isPending ||
    updateUserTemplateGroupMutation.isPending ||
    archiveUserTemplateGroupMutation.isPending;
  const autoLayoutBusy = layoutMutationBusy || inspirationWriteBlocked || !workflow || workflow.nodes.length === 0;

  const renderWorkflowToolbarButtons = () => (
    <>
      <span className="w-full text-center text-[10px] font-semibold leading-none text-slate-500">
        {t("detail.toolbar.runSection")}
      </span>
      <button
        type="button"
        onClick={() => {
          if (canvasTemplateSaveDisabled) {
            setNotice("");
            setError(
              workflowInitialEntryMode === "blank"
                ? t("detail.saveCanvasTemplateBlankDisabled")
                : inspirationWriteBlockedTitle || t("detail.error.workflowNotLoaded"),
            );
            return;
          }
          setCanvasTemplateSaveTitle(inspiration.name);
          setCanvasTemplateSaveDescription("");
          setCanvasTemplateSaveCategoryId(userCanvasTemplateCategories[0]?.id ?? "");
          setCanvasTemplateRetainPromptText(true);
          setCanvasTemplateSaveOpen(true);
        }}
        disabled={createUserCanvasTemplateMutation.isPending || inspirationWriteBlocked || !workflow}
        className="btn-secondary-spring flex w-full flex-col items-center rounded-lg px-1.5 py-2 text-xs font-semibold"
        title={
          workflowInitialEntryMode === "blank"
            ? t("detail.saveCanvasTemplateBlankDisabled")
            : t("detail.saveCanvasTemplate")
        }
        aria-label={
          workflowInitialEntryMode === "blank"
            ? t("detail.saveCanvasTemplateBlankDisabled")
            : t("detail.saveCanvasTemplate")
        }
      >
        {createUserCanvasTemplateMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Layers3 size={16} />}
        <span className="mt-1 leading-tight">{t("detail.saveCanvasTemplate")}</span>
      </button>
      <button
        type="button"
        onClick={() => void handleRunWorkflow(undefined)}
        disabled={fullWorkflowRunDisabled || !workflow}
        className="btn-primary-spring flex w-full flex-col items-center rounded-lg px-1.5 py-2 text-xs font-semibold"
        title={fullWorkflowRunTitle}
        aria-label={fullWorkflowRunTitle}
      >
        {fullWorkflowRunSpinner ? <Loader2 size={17} className="animate-spin" /> : <Play size={17} />}
        <span className="mt-1 leading-tight">{fullWorkflowRunLabel}</span>
      </button>
      {failedWorkflowNodes.length > 0 ? (
        <button
          type="button"
          onClick={() => void handleRetryFailedWorkflowNodes()}
          disabled={retryFailedWorkflowNodesDisabled || !workflow}
          className="btn-secondary-spring flex w-full flex-col items-center rounded-lg px-1.5 py-2 text-xs font-semibold text-red-600 dark:text-red-200"
          title={failedWorkflowNodesRetryTitle}
          aria-label={failedWorkflowNodesRetryTitle}
        >
          {retryFailedWorkflowNodesMutation.isPending ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <RotateCcw size={16} />
          )}
          <span className="mt-1 leading-tight">
            {t("detail.failedNodesRetry.action", { count: failedWorkflowNodes.length })}
          </span>
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => workflowCanvasRef.current?.triggerAutoLayout()}
        disabled={autoLayoutBusy}
        className="btn-secondary-spring flex w-full flex-col items-center rounded-lg px-1.5 py-2 text-xs font-semibold"
        title={inspirationWriteBlocked ? inspirationWriteBlockedTitle : t("detail.autoLayout")}
        aria-label={inspirationWriteBlocked ? inspirationWriteBlockedTitle : t("detail.autoLayout")}
      >
        <Sparkles size={16} />
        <span className="mt-1 leading-tight">{t("detail.autoLayout")}</span>
      </button>
      <div className="my-1 h-px w-11 self-center bg-slate-200/70 dark:bg-slate-800" />
      <span className="w-full text-center text-[10px] font-semibold leading-none text-slate-500">
        {t("detail.toolbar.addSection")}
      </span>
    </>
  );

  const renderToolbarViewDivider = () => (
    <>
      <div className="my-1 h-px w-11 self-center bg-slate-200/70 dark:bg-slate-800" />
      <span className="w-full text-center text-[10px] font-semibold leading-none text-slate-500">
        {t("detail.toolbar.viewSection")}
      </span>
    </>
  );

  const renderSingleNodePanel = () => (
    <div className="space-y-3">
      {ADD_NODE_OPTIONS.map((option) => {
        const optionLabel = localizedWorkflowNodeTypeLabel(option.type, t);
        const description =
          option.type === "reference_image"
            ? t("detail.singleNode.description.referenceImage")
            : option.type === "copy_generation"
              ? t("detail.singleNode.description.copyGeneration")
              : option.type === "tail_splitter"
                ? t("detail.singleNode.description.tailSplitter")
                : t("detail.singleNode.description.imageGeneration");
        const creatingThisNode = createNodeMutation.isPending && createNodeMutation.variables === option.type;
        const NodeIcon = option.type === "reference_image"
          ? ImagePlus
          : option.type === "copy_generation"
            ? FileText
            : option.type === "tail_splitter"
              ? Sparkles
              : ImageIcon;
        return (
          <div
            key={option.type}
            className="config-bubble rounded-2xl p-4 shadow-sm transition-all hover:scale-[1.01]"
          >
            <div className="flex items-start">
              <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-violet-400">
                <NodeIcon size={16} />
              </span>
              <span className="ml-3 min-w-0 flex-1">
                <span className="block text-sm font-semibold text-zinc-900 dark:text-slate-100">{optionLabel}</span>
                <span className="mt-1 block text-xs leading-5 text-zinc-500 dark:text-slate-400">
                  {description}
                </span>
              </span>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => createNodeMutation.mutate(option.type)}
                disabled={structureBusy || !workflow}
                className="btn-primary-spring inline-flex h-9 items-center rounded-xl px-4 text-xs font-semibold"
                title={inspirationWriteBlocked ? inspirationWriteBlockedTitle : t("detail.addNode", { label: optionLabel })}
                aria-label={inspirationWriteBlocked ? inspirationWriteBlockedTitle : t("detail.addNode", { label: optionLabel })}
              >
                {creatingThisNode ? (
                  <Loader2 size={13} className="mr-1.5 animate-spin" />
                ) : (
                  <Plus size={13} className="mr-1.5" />
                )}
                {t("detail.template.add")}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );

  const sidebarTabItems: Array<{
    key: SidebarTab;
    label: string;
    icon: ReactNode;
  }> = [
    { key: "singleNode", label: t("detail.tabSingleNode"), icon: <Plus size={16} /> },
    { key: "templates", label: t("detail.tabTemplates"), icon: <Layers3 size={16} /> },
    { key: "details", label: t("detail.tabDetails"), icon: <Settings2 size={16} /> },
    { key: "runs", label: t("detail.tabRuns"), icon: <CircleDot size={16} /> },
    { key: "images", label: t("detail.tabImages"), icon: <ImageIcon size={16} /> },
  ];

  const activeSidebarTabItem =
    sidebarTabItems.find((item) => item.key === activeSidebarTab) ??
    sidebarTabItems.find((item) => item.key === "details") ??
    sidebarTabItems[0];
  const mobileCanvasModeItems: Array<{
    key: CanvasInteractionMode;
    label: string;
    description: string;
    icon: ReactNode;
  }> = [
    {
      key: "browse",
      label: t("detail.mobileCanvasBrowse"),
      description: t("detail.mobileCanvasBrowseHint"),
      icon: <Hand size={15} />,
    },
    {
      key: "edit",
      label: t("detail.mobileCanvasEdit"),
      description: t("detail.mobileCanvasEditHint"),
      icon: <Move size={15} />,
    },
    {
      key: "select",
      label: t("detail.mobileCanvasSelect"),
      description: t("detail.mobileCanvasSelectHint"),
      icon: <MousePointer2 size={15} />,
    },
  ];

  const openMobileSidebarTab = (tab: SidebarTab) => {
    if (tab === "images") {
      setGalleryOpen(true);
      setMobileDetailsSheetOpen(false);
      return;
    }
    setActiveSidebarTab(tab);
    setMobileDetailsSheetOpen(true);
  };

  const selectedNodeBaseRunActionState = selectedNode
    ? getWorkflowNodeRunActionState(selectedNode, {
        runSubmissionPending,
        pendingStartNodeId,
      })
    : null;
  const selectedNodeRunActionState =
    selectedNode && selectedNodeBaseRunActionState && inspirationGenerateBlocked
      ? {
          ...selectedNodeBaseRunActionState,
          disabled: true,
          pending: false,
          title: inspirationGenerateBlockedTitle,
        }
      : selectedNode &&
          selectedNodeBaseRunActionState &&
          workflowNodeRequiresResourceGroup(selectedNode) &&
          !draft.resourceGroupId
        ? {
            ...selectedNodeBaseRunActionState,
            disabled: true,
            pending: false,
            title: t("detail.inspector.resourceGroupRequired"),
          }
        : selectedNode &&
            selectedNodeBaseRunActionState &&
            workflowNodeMissingManualGenerationConfig(selectedNode, selectedNode, draft)
          ? {
              ...selectedNodeBaseRunActionState,
              disabled: true,
              pending: false,
              title: t("detail.inspector.generationConfigRequired"),
            }
          : selectedNodeBaseRunActionState;
  const selectedNodeDeleteLocked = selectedNode ? isWorkflowNodeDeleteLocked(selectedNode) : false;
  const selectedNodeDeleteDisabled = Boolean(selectedNode && (workflowActive || selectedNodeDeleteLocked));
  const selectedNodeDeleteTitle =
    selectedNode && selectedNodeDeleteLocked
      ? getWorkflowNodeRunActionState(selectedNode, {
          runSubmissionPending: false,
          pendingStartNodeId: null,
        }, t).title
      : selectedNodeDeleteDisabled
        ? t("detail.running")
        : t("detail.delete");

  const renderDetailsPanelContent = () =>
    selectedNode ? (
      <div className="space-y-3">
        {selectedTailPendingPlan && selectedNode.node_type === "tail_splitter" ? (
          <div className="rounded-2xl border border-fuchsia-200 bg-fuchsia-50/80 px-4 py-3 text-sm text-fuchsia-900 dark:border-fuchsia-400/35 dark:bg-fuchsia-500/10 dark:text-fuchsia-100">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold">{t("detail.tailPlan.pendingTitle")}</div>
                <div className="mt-1 text-xs leading-5 text-fuchsia-800/80 dark:text-fuchsia-100/75">
                  {t("detail.tailPlan.pendingDescription", { count: selectedTailPendingPlan.items.length })}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTailPlanDialogOpen(true)}
                className="shrink-0 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-fuchsia-700 ring-1 ring-fuchsia-200 transition-colors hover:bg-fuchsia-100 dark:bg-slate-950/80 dark:text-fuchsia-200 dark:ring-fuchsia-400/35 dark:hover:bg-fuchsia-500/10"
              >
                {t("detail.tailPlan.open")}
              </button>
            </div>
          </div>
        ) : null}
        <InspectorPanel
          inspiration={inspiration}
          sourceImage={sourceImage}
          workflow={workflow}
          node={selectedNode}
          draft={draft}
          imageSizeOptions={imageSizeOptions}
          imageGenerationMaxDimension={imageGenerationMaxDimension}
          imageToolAllowedFields={imageToolAllowedFields}
          tailSplitterMaxItems={tailSplitterMaxItems}
          resourceGroups={workflowResourceGroups}
          generationConfigOptions={generationConfigOptions}
          onPreviewImage={handlePreviewImage}
          onDraftChange={handleGuardedDraftChange}
          onRun={() => void handleRunWorkflow(selectedNode.id)}
          onCancelRun={
            selectedNodeCancelableRun
              ? () => handleCancelWorkflowRun(selectedNodeCancelableRun)
              : null
          }
          saveStatus={saveStatus}
          onUploadImage={(file) => uploadNodeImageMutation.mutate(file)}
          onUploadDocument={(file) => uploadNodeDocumentMutation.mutate(file)}
          onClearImage={() => clearNodeImageMutation.mutate()}
          onOpenResourceLibrary={handleOpenResourceLibrary}
          resourceLibraryDisabledTitle={resourceLibrarySelectDisabledTitle || null}
          onSaveSourceAssetToResourceLibrary={handleSaveSourceAssetToResourceLibrary}
          resourceLibrarySaveDisabledTitle={resourceLibraryWriteBlockedTitle || null}
          savedResourceLibrarySourceAssetIds={savedSourceAssetIds}
          savingResourceLibrarySourceId={resourceLibrarySaveSource?.source_id ?? null}
          onDelete={() => handleDeleteNode(selectedNode)}
          deleteDisabled={selectedNodeDeleteDisabled}
          deleteTitle={selectedNodeDeleteTitle}
          busy={inspectorBusy}
          cancelBusy={cancelWorkflowRunMutation.isPending || inspirationGenerateBlocked}
          runActionState={
            selectedNodeRunActionState ??
            getWorkflowNodeRunActionState(selectedNode, {
              runSubmissionPending,
              pendingStartNodeId,
            })
          }
        />
      </div>
    ) : (
      <div className="glass-empty-state px-4 py-8 text-center text-xs text-zinc-500 dark:text-slate-400 flex flex-col items-center justify-center gap-2">
        <MousePointer2 size={18} className="text-indigo-500 opacity-70 dark:text-indigo-400" />
        <div>{t("detail.selectNodeHint")}</div>
      </div>
    );

  const renderSidebarPanelContent = () => (
    <>
      {activeSidebarTab === "singleNode" ? renderSingleNodePanel() : null}
      {activeSidebarTab === "details" ? renderDetailsPanelContent() : null}
      {activeSidebarTab === "runs" ? (
        <RunsPanel
          workflow={workflow}
          latestRun={latestRun}
          busyRunId={workflowRunActionBusyRunId ?? null}
          failedNodeCount={failedWorkflowNodes.length}
          retryableFailedNodeCount={retryableFailedWorkflowNodes.length}
          retryFailedNodesBusy={retryFailedWorkflowNodesMutation.isPending}
          retryFailedNodesTitle={failedWorkflowNodesRetryTitle}
          mutationBlockedTitle={inspirationGenerateBlocked ? inspirationGenerateBlockedTitle : null}
          onRetryRun={handleRetryWorkflowRun}
          onRetryFailedNodes={() => void handleRetryFailedWorkflowNodes()}
        />
      ) : null}
      {activeSidebarTab === "templates" ? (
        <TemplateGroupsPanel
          templates={canvasTemplates}
          categories={canvasTemplateCategories}
          isLoading={canvasTemplatesQuery.isLoading}
          isError={canvasTemplatesQuery.isError}
          categoriesLoading={canvasTemplateCategoriesQuery.isLoading}
          categoriesError={canvasTemplateCategoriesQuery.isError}
          templateSearch={templateSearch}
          selectedCategoryId={templateCategoryId}
          templateScope={templateScope}
          onTemplateSearchChange={setTemplateSearch}
          onSelectedCategoryIdChange={setTemplateCategoryId}
          onTemplateScopeChange={setTemplateScope}
          structureBusy={structureBusy || !workflow}
          applyBusy={applyTemplateGroupMutation.isPending}
          applyingTemplateKey={applyTemplateGroupMutation.variables?.key ?? null}
          onApplyTemplate={(template) => {
            if (inspirationWriteBlocked) {
              showInspirationWriteBlockedError();
              return;
            }
            if (isResourceBlocked(template)) {
              setError(getResourceBlockedActionTitle(template, t("resource.blockedAction")));
              return;
            }
            applyTemplateGroupMutation.mutate(template);
          }}
          userTemplateBusy={userTemplateMutationBusy || inspirationWriteBlocked}
          onRenameUserTemplate={(template, title) => {
            if (inspirationWriteBlocked) {
              showInspirationWriteBlockedError();
              return;
            }
            if (isResourceBlocked(template)) {
              setError(getResourceBlockedActionTitle(template, t("resource.blockedAction")));
              return;
            }
            if (template.user_template_id) {
              updateUserTemplateGroupMutation.mutate({
                templateId: template.user_template_id,
                title,
              });
            }
          }}
          onArchiveUserTemplate={(template) => {
            if (inspirationWriteBlocked) {
              showInspirationWriteBlockedError();
              return;
            }
            if (isResourceBlocked(template)) {
              setError(getResourceBlockedActionTitle(template, t("resource.blockedAction")));
              return;
            }
            if (template.user_template_id) {
              setPendingDeleteAction({
                kind: "template",
                templateId: template.user_template_id,
                title: template.title,
              });
            }
          }}
        />
      ) : null}
    </>
  );

  return (
    <div className="pf-workspace flex h-[100dvh] flex-col overflow-hidden text-sm text-zinc-900 dark:text-slate-100">
      {!topChromeCollapsed ? (
        <TopNav onHome={() => navigate("/inspirations")} breadcrumbs={inspiration.name} />
      ) : (
        <div className={`${TOP_CHROME_COLLAPSED_SAFE_HEIGHT_CLASS} shrink-0`} />
      )}

      <main className="pf-workspace-tool-main flex min-h-0 flex-1 flex-col border-t border-slate-200 bg-transparent dark:border-slate-800">
        {error ? (
          <div className="z-20 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200 sm:px-6 lg:px-8">
            <AlertCircle size={14} className="mr-2 inline" /> {error}
          </div>
        ) : null}
        {!error && notice ? (
          <div className="z-20 border-b border-blue-200 bg-blue-50 px-4 py-2 text-xs text-blue-700 dark:border-blue-400/35 dark:bg-blue-500/10 dark:text-blue-200 sm:px-6 lg:px-8">
            <AlertCircle size={14} className="mr-2 inline" /> {notice}
          </div>
        ) : null}
        <ResourceMetaBadges
          resource={inspiration}
          showReason
          className="pf-workspace-status-strip z-20 border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-[#0b1220] sm:px-6 lg:px-8"
        />
        <ResourceBlockedNotice resource={inspiration} className="z-20 rounded-none border-x-0 border-t-0 px-4 py-2 sm:px-6 lg:px-8" />
        {activeWorkflowRun ? (
          <div className={`z-20 border-b px-4 py-2 text-xs sm:px-6 lg:px-8 ${activeWorkflowRunStatusClassName}`}>
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center rounded-full border border-current/25 bg-white/55 px-2 py-0.5 text-[10px] font-semibold dark:bg-slate-950/25">
                {activeWorkflowRunLabel}
              </span>
              {activeWorkflowRunQueueText ? (
                <span className="min-w-0 truncate">{activeWorkflowRunQueueText}</span>
              ) : null}
              {queueOverviewInlineText && !activeRunQueueTextAlreadyIncludesGlobalCounts ? (
                <span className="min-w-0 truncate opacity-90">{queueOverviewInlineText}</span>
              ) : null}
              <span className="text-[11px] opacity-75">
                {t("detail.nodeRunCount", { count: activeWorkflowRun.node_runs.length })}
              </span>
            </div>
          </div>
        ) : null}
        {showQueueOverview && queueOverview ? (
          <div className="z-20 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-200 sm:px-6 lg:px-8">
            {queueOverviewText}
          </div>
        ) : null}

        <div className="pf-workspace-stage relative flex min-h-0 flex-1 overflow-hidden">
          <div className="pf-workspace-canvas-wash absolute inset-0 bg-gradient-to-br from-white/60 via-transparent to-indigo-50/40 dark:from-[#060a12]/78 dark:via-transparent dark:to-[#151f33]/70" />
          <section
            className="relative z-10 min-w-0 flex-1 overflow-hidden transition-[padding] duration-300 ease-out"
            style={{
              paddingRight: mobileCanvasControlsActive ? 0 : (sidebarCollapsed ? 96 : 72 + inspectorWidth + 24),
            }}
          >
            <div data-canvas-control className="pointer-events-none absolute right-3 top-3 z-30 lg:right-4 lg:top-4">
              <button
                type="button"
                onClick={() => setTopChromeCollapsed((collapsed) => !collapsed)}
                className="pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-xl border border-zinc-200 bg-white/90 text-zinc-600 shadow-sm backdrop-blur transition-colors active:scale-[0.98] hover:bg-white hover:text-zinc-900 dark:border-slate-700/80 dark:bg-[#151f33]/92 dark:text-slate-300 dark:shadow-black/20 dark:hover:bg-[#1a2740] dark:hover:text-white lg:h-9 lg:w-9 lg:rounded-lg"
                aria-label={topChromeCollapsed ? t("detail.restoreCanvas") : t("detail.maximizeCanvas")}
                title={topChromeCollapsed ? t("detail.restoreCanvas") : t("detail.maximizeCanvas")}
              >
                {topChromeCollapsed ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
            </div>
            <WorkflowCanvas
              ref={workflowCanvasRef}
              workflow={workflow}
              isLoading={workflowQuery.isLoading}
              selectedNodeId={selectedNodeId}
              selectedNodeIds={selectedNodeIds}
              structureBusy={structureBusy}
              mobileInteractionMode={mobileCanvasControlsActive ? mobileCanvasMode : "edit"}
              mobileCanvasControlsActive={mobileCanvasControlsActive}
              zoomStorageKey="inspiration-one.workflow.zoom"
              initialZoom={initialWorkflowCanvasZoom}
              selectedGroupCount={selectedGroupCount}
              loadFailedLabel={t("detail.workflowLoadFailed")}
              deleteEdgeLabel={t("detail.deleteEdge")}
              inputHandleLabel={t("detail.inputHandle")}
              outputHandleLabel={t("detail.outputHandle")}
              zoomOutLabel={t("detail.zoomOut")}
              resetZoomLabel={t("detail.resetZoom")}
              zoomInLabel={t("detail.zoomIn")}
              fitViewLabel={t("detail.fitCanvas")}
              fitSelectionLabel={t("detail.fitSelection")}
              canvasControlsLabel={t("detail.canvasControls")}
              canvasMiniMapLabel={t("detail.canvasMiniMap")}
              snapToGridLabel={t("detail.snapToGrid")}
              autoLayoutLabel={t("detail.autoLayout")}
              snapToGrid={snapToGrid}
              onToggleSnapToGrid={handleWorkflowCanvasToggleSnapToGrid}
              onAutoLayout={handleWorkflowCanvasAutoLayout}
              onBlankClick={handleCanvasBlankClick}
              onSelectNode={handleWorkflowCanvasSelectNode}
              onNodeDragCompleteSelect={handleWorkflowCanvasDragCompleteSelect}
              getNodeDragGroup={handleWorkflowCanvasNodeDragGroup}
              onSelectionBoxComplete={handleWorkflowCanvasSelectionBoxComplete}
              onNodePositionCommit={handleWorkflowCanvasNodePositionCommit}
              onConnectionCreate={handleWorkflowCanvasConnectionCreate}
              onDeleteEdge={handleWorkflowCanvasDeleteEdge}
              getNodeActionToolbar={getWorkflowNodeActionToolbar}
              onNodeAction={handleWorkflowCanvasNodeAction}
              keyboardShortcutsActive={workflowCanvasKeyboardShortcutsActive}
              onClearSelection={handleWorkflowCanvasClearSelection}
              getNodeImage={getWorkflowCanvasNodeImage}
              onPreviewImage={handleWorkflowCanvasPreviewImage}
            />
            {selectedGroupCount > 1 ? (
              <div data-canvas-control className="pointer-events-none absolute bottom-[calc(12.75rem+env(safe-area-inset-bottom))] left-3 right-3 z-30 lg:bottom-auto lg:left-1/2 lg:right-auto lg:top-4 lg:-translate-x-1/2">
                <div className="pointer-events-auto max-h-[calc(100dvh-16rem)] overflow-y-auto rounded-xl border border-indigo-200 bg-white/95 p-2.5 text-sm font-semibold text-indigo-700 shadow-lg shadow-indigo-950/10 backdrop-blur dark:border-violet-400/50 dark:bg-[#151f33]/95 dark:text-violet-100 dark:shadow-black/30 lg:max-h-none lg:min-w-[22rem] lg:overflow-visible">
                  <div className="flex items-center gap-2">
                    <Check size={16} strokeWidth={2.5} />
                    <span className="mr-auto">{t("detail.selectedCount", { count: selectedGroupCount })}</span>
                    <button
                      type="button"
                      onClick={clearMultiSelection}
                      className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-600 shadow-sm transition-colors hover:border-red-300 hover:bg-red-100 hover:text-red-700 dark:border-red-400/40 dark:bg-red-500/10 dark:text-red-200 dark:hover:border-red-400/60 dark:hover:bg-red-500/16 dark:hover:text-red-100 lg:h-8 lg:w-8"
                      aria-label={t("detail.clearSelection")}
                      title={t("detail.clearSelection")}
                    >
                      <X size={18} strokeWidth={2.5} />
                    </button>
                  </div>
                  {templateSaveOpen ? (
                    <form
                      className="mt-2 grid gap-2 border-t border-indigo-100 pt-2 dark:border-violet-400/20"
                      onSubmit={(event) => {
                        event.preventDefault();
                        createUserTemplateGroupMutation.mutate();
                      }}
                    >
                      <input
                        value={templateSaveTitle}
                        onChange={(event) => setTemplateSaveTitle(event.target.value)}
                        className="h-11 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-indigo-300 dark:border-slate-700 dark:bg-[#0b1220] dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-violet-400 lg:h-9"
                        placeholder={t("detail.templateName")}
                        maxLength={255}
                      />
                      <input
                        value={templateSaveDescription}
                        onChange={(event) => setTemplateSaveDescription(event.target.value)}
                        className="h-11 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 focus:border-indigo-300 dark:border-slate-700 dark:bg-[#0b1220] dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-violet-400 lg:h-9"
                        placeholder={t("detail.templateDescription")}
                        maxLength={1000}
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setTemplateSaveOpen(false)}
                          className="h-11 rounded-lg px-3 text-xs font-semibold text-zinc-500 hover:bg-zinc-50 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white lg:h-8 lg:px-2.5"
                        >
                          {t("detail.cancel")}
                        </button>
                        <button
                          type="submit"
                          disabled={createUserTemplateGroupMutation.isPending || inspirationWriteBlocked}
                          title={inspirationWriteBlocked ? inspirationWriteBlockedTitle : t("detail.save")}
                          className="inline-flex h-11 items-center rounded-lg bg-zinc-950 px-3 text-xs font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-violet-500 dark:hover:bg-violet-400 lg:h-8"
                        >
                          {t("detail.save")}
                        </button>
                      </div>
                    </form>
                  ) : null}
                </div>
              </div>
            ) : null}
          </section>

          {sidebarCollapsed ? (
            <div
              data-canvas-control
              className="absolute bottom-6 right-6 top-20 z-30 hidden min-h-0 w-[72px] flex-col items-center gap-2 overflow-y-auto overscroll-contain rounded-[24px] shadow-2xl glass-inspector p-2 pb-3 lg:flex"
            >
              {renderWorkflowToolbarButtons()}
              <SidebarTabButton active={false} label={t("detail.tabSingleNode")} title={t("detail.tabSingleNode")} icon={<Plus size={17} />} onClick={() => openSidebarTab("singleNode")} />
              <SidebarTabButton active={false} label={t("detail.tabTemplates")} title={t("detail.tabTemplates")} icon={<Layers3 size={17} />} onClick={() => openSidebarTab("templates")} />
              {renderToolbarViewDivider()}
              <SidebarTabButton active={false} label={t("detail.tabDetails")} title={t("detail.tabDetails")} icon={<Eye size={17} />} onClick={() => openSidebarTab("details")} />
              <SidebarTabButton active={false} label={t("detail.tabRuns")} title={t("detail.runsTitle")} icon={<CircleDot size={17} />} onClick={() => openSidebarTab("runs")} />
              <SidebarTabButton active={false} label={t("detail.tabImages")} title={t("detail.tabImages")} icon={<ImageIcon size={17} />} onClick={() => openSidebarTab("images")} />

              <div className="mt-auto flex w-full justify-center border-t border-slate-200/40 pt-2 dark:border-white/5">
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed(false)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition-all hover:scale-105 hover:bg-white/40 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-slate-200"
                  title={t("detail.expandSidebar")}
                  aria-label={t("detail.expandSidebar")}
                >
                  <ChevronLeft size={16} />
                </button>
              </div>
            </div>
          ) : (
          <div
            data-canvas-control
            className="absolute right-6 top-20 bottom-6 z-30 hidden rounded-[28px] shadow-[0_24px_50px_rgba(15,23,42,0.18)] dark:shadow-[0_32px_64px_rgba(0,0,0,0.45)] glass-inspector lg:flex animate-spring-slide-in"
            style={{ width: 72 + inspectorWidth }}
            >
            <div
              role="separator"
              aria-label={t("detail.resizeSidebar")}
              onPointerDown={startInspectorResize}
              className="group absolute left-0 top-0 z-30 flex h-full w-2.5 cursor-col-resize items-center justify-center"
            >
              <div className="h-12 w-[4px] rounded-full bg-slate-300 opacity-40 transition-all duration-300 group-hover:h-20 group-hover:opacity-100 dark:bg-slate-700 animate-handle-glow" />
            </div>

            <div className="flex min-h-0 w-[72px] shrink-0 flex-col items-center gap-2 overflow-y-auto overscroll-contain border-r border-slate-200/40 bg-white/5 px-2 py-4 dark:border-white/5 dark:bg-black/10">
              {renderWorkflowToolbarButtons()}
              <SidebarTabButton
                active={activeSidebarTab === "singleNode"}
                label={t("detail.tabSingleNode")}
                title={t("detail.tabSingleNode")}
                icon={<Plus size={17} />}
                onClick={() => openSidebarTab("singleNode")}
              />
              <SidebarTabButton
                active={activeSidebarTab === "templates"}
                label={t("detail.tabTemplates")}
                title={t("detail.tabTemplates")}
                icon={<Layers3 size={17} />}
                onClick={() => openSidebarTab("templates")}
              />
              {renderToolbarViewDivider()}
              <SidebarTabButton
                active={activeSidebarTab === "details"}
                label={t("detail.tabDetails")}
                title={t("detail.tabDetails")}
                icon={<Eye size={17} />}
                onClick={() => openSidebarTab("details")}
              />
              <SidebarTabButton
                active={activeSidebarTab === "runs"}
                label={t("detail.tabRuns")}
                title={t("detail.runsTitle")}
                icon={<CircleDot size={17} />}
                onClick={() => openSidebarTab("runs")}
              />
              <SidebarTabButton
                active={false}
                label={t("detail.tabImages")}
                title={t("detail.tabImages")}
                icon={<ImageIcon size={17} />}
                onClick={() => openSidebarTab("images")}
              />

              <div className="mt-auto flex w-full justify-center border-t border-slate-200/40 pt-2 dark:border-white/5">
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed(true)}
                  className="btn-secondary-spring inline-flex h-9 w-9 items-center justify-center rounded-xl"
                  title={t("detail.collapseSidebar")}
                  aria-label={t("detail.collapseSidebar")}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>

            <aside
              className="relative flex shrink-0 flex-col bg-transparent"
              style={{ width: inspectorWidth }}
            >
              <div className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200/50 px-4 dark:border-slate-800">
                <div className="flex items-center">
                  <span className="mr-2 text-indigo-600 dark:text-violet-400">{activeSidebarTabItem.icon}</span>
                  <span className="text-[11px] font-bold uppercase tracking-widest text-slate-700 dark:text-slate-200">
                    {activeSidebarTabItem.label}
                  </span>
                </div>
              </div>
              <div
                key={`${activeSidebarTab}-${selectedNode?.id ?? ""}`}
                className="min-h-0 flex-1 overflow-y-auto p-4 animate-spring-slide-in"
              >
                {renderSidebarPanelContent()}
              </div>
            </aside>
          </div>
          )}
        </div>
      </main>

      <div
        className="fixed inset-x-0 z-40 px-2 lg:hidden"
        style={{ bottom: topChromeCollapsed ? "calc(0.75rem + env(safe-area-inset-bottom))" : "calc(4.1rem + env(safe-area-inset-bottom))" }}
      >
        <div
          className="mx-auto max-w-[28rem] rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[0_-6px_18px_rgba(15,23,42,0.12)] dark:border-slate-700 dark:bg-slate-950 dark:shadow-[0_-12px_28px_rgba(0,0,0,0.30)]"
        >
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-900/85">
            {mobileCanvasModeItems.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setMobileCanvasMode(item.key)}
                className={`inline-flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-lg px-2 text-xs font-semibold transition-colors active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-violet-400 ${
                  mobileCanvasMode === item.key
                    ? "bg-white text-indigo-700 shadow-sm dark:bg-violet-500/18 dark:text-violet-100 dark:ring-1 dark:ring-violet-300/35"
                    : "text-slate-500 hover:bg-white/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                }`}
                aria-pressed={mobileCanvasMode === item.key}
                aria-label={item.description}
                title={item.description}
              >
                {item.icon}
                <span className="truncate">{item.label}</span>
              </button>
            ))}
          </div>
          <div
            role="toolbar"
            aria-label={t("detail.mobileToolbar")}
            className="mt-1.5 grid grid-cols-6 gap-1"
          >
            <button
              type="button"
              onClick={() => void handleRunWorkflow(undefined)}
              disabled={fullWorkflowRunDisabled || !workflow}
              className="inline-flex min-h-14 min-w-0 flex-col items-center justify-center rounded-xl bg-indigo-600 px-1 text-[10px] font-semibold leading-[1.05] text-white shadow-lg shadow-indigo-600/20 transition-colors active:scale-[0.98] hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-gradient-to-r dark:from-indigo-500 dark:via-violet-500 dark:to-fuchsia-500 dark:shadow-violet-900/45 dark:ring-1 dark:ring-violet-300/35"
              title={fullWorkflowRunTitle}
              aria-label={fullWorkflowRunTitle}
            >
              {fullWorkflowRunSpinner ? <Loader2 size={17} className="mb-1 shrink-0 animate-spin" /> : <Play size={17} className="mb-1 shrink-0" />}
              <span className="max-w-full text-center">{fullWorkflowRunLabel}</span>
            </button>
            {failedWorkflowNodes.length > 0 ? (
              <button
                type="button"
                onClick={() => void handleRetryFailedWorkflowNodes()}
                disabled={retryFailedWorkflowNodesDisabled || !workflow}
                className="inline-flex min-h-14 min-w-0 flex-col items-center justify-center rounded-xl border border-red-200 bg-white px-1 text-[10px] font-semibold leading-[1.05] text-red-600 transition-colors active:scale-[0.98] hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-400/35 dark:bg-slate-950/80 dark:text-red-200 dark:hover:bg-red-500/12"
                title={failedWorkflowNodesRetryTitle}
                aria-label={failedWorkflowNodesRetryTitle}
              >
                {retryFailedWorkflowNodesMutation.isPending ? (
                  <Loader2 size={16} className="mb-1 shrink-0 animate-spin" />
                ) : (
                  <RotateCcw size={16} className="mb-1 shrink-0" />
                )}
                <span className="max-w-full text-center">
                  {t("detail.failedNodesRetry.action", { count: failedWorkflowNodes.length })}
                </span>
              </button>
            ) : null}
            {sidebarTabItems.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => openMobileSidebarTab(item.key)}
                className={`inline-flex min-h-14 min-w-0 flex-col items-center justify-center rounded-xl border px-1 text-[10px] font-semibold leading-[1.05] text-slate-600 transition-colors active:scale-[0.98] hover:border-indigo-200 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-violet-400 ${
                  activeSidebarTab === item.key && item.key !== "images"
                    ? "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-violet-400/55 dark:bg-violet-500/18 dark:text-violet-100"
                    : "border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950/80 dark:text-slate-300 dark:hover:border-violet-400/55 dark:hover:text-violet-100"
                }`}
                aria-label={item.label}
                title={item.label}
              >
                {item.icon}
                <span className="mt-1 max-w-full text-center">{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <Drawer.Root
        direction="bottom"
        handleOnly
        open={mobileDetailsSheetOpen}
        onOpenChange={setMobileDetailsSheetOpen}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-[70] bg-slate-950/42 lg:hidden" />
          <Drawer.Content
            className="fixed inset-x-0 bottom-0 z-[71] flex h-[80dvh] max-h-[80dvh] flex-col overflow-hidden rounded-t-[1.5rem] border-t border-slate-200 bg-white shadow-[0_-12px_34px_rgba(15,23,42,0.16)] outline-none dark:border-slate-700 dark:bg-[#0f1726] dark:shadow-[0_-18px_42px_rgba(0,0,0,0.34)] lg:hidden"
            onPointerDownOutside={(event) => {
              const target = event.target;
              if (target instanceof Element && target.closest("[data-template-preview-dialog]")) {
                event.preventDefault();
              }
            }}
          >
            <Drawer.Title className="sr-only">{t("detail.mobileDetailsSheet")}</Drawer.Title>
            <Drawer.Handle className="mx-auto mt-2 flex h-7 w-24 items-center justify-center rounded-full text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-500 dark:focus-visible:ring-violet-400">
              <span className="h-1.5 w-12 rounded-full bg-slate-300 dark:bg-slate-600" />
            </Drawer.Handle>
            <div className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 pb-3 dark:border-slate-800">
              <div className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 text-indigo-600 dark:text-violet-200">{activeSidebarTabItem.icon}</span>
                <span className="truncate text-sm font-semibold text-slate-950 dark:text-white">{activeSidebarTabItem.label}</span>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMobileDetailsSheetOpen(false)}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 transition-colors active:scale-[0.98] hover:border-slate-300 hover:text-slate-950 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-950/80 dark:text-slate-300 dark:hover:border-violet-400/55 dark:hover:text-violet-100 dark:focus-visible:ring-violet-400"
                  aria-label={t("detail.closeMobileSheet")}
                >
                  <X size={18} />
                </button>
              </div>
            </div>
            <div
              data-vaul-no-drag
              className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4 [-webkit-overflow-scrolling:touch] [&_a]:min-h-11 [&_button]:min-h-11 [&_input]:min-h-11"
            >
              {renderSidebarPanelContent()}
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      {previewImage ? (
        <InspirationImagePreviewModal
          image={previewImage}
          resourceLibrarySource={previewResourceLibrarySource}
          resourceLibrarySaved={previewResourceLibrarySaved}
          resourceLibrarySaving={previewResourceLibrarySaving}
          resourceLibraryDisabledTitle={previewResourceLibraryDisabledTitle}
          onSaveToResourceLibrary={handleSavePreviewImageToResourceLibrary}
          onClose={closePreviewImage}
        />
      ) : null}
      <ImagesPanel
        open={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        inspiration={inspiration}
        posters={posters}
        referenceAssets={referenceAssets}
        artifactCount={artifactCount}
        selectedReferenceNode={selectedReferenceNode}
        posterSourceAssetIds={posterSourceAssetIds}
        onPreviewImage={handlePreviewImage}
        onFillFromSourceAsset={(sourceAssetId) =>
          bindNodeImageMutation.mutate({
            source_asset_id: sourceAssetId,
          })
        }
        onFillFromPoster={(posterId) =>
          bindNodeImageMutation.mutate({
            poster_variant_id: posterId,
          })
        }
        onSavePosterToResourceLibrary={handleSavePosterToResourceLibrary}
        onSaveSourceAssetToResourceLibrary={handleSaveSourceAssetToResourceLibrary}
        savedPosterIds={savedPosterIds}
        savedSourceAssetIds={savedSourceAssetIds}
        fillReferenceBusy={fillReferenceBusy}
        fillBlockedTitle={inspirationWriteBlocked ? inspirationWriteBlockedTitle : null}
        resourceLibraryWriteDisabledTitle={resourceLibraryWriteBlockedTitle}
        savingResourceLibrarySourceId={resourceLibrarySaveSource?.source_id ?? null}
      />
      <ResourceLibraryModal
        open={resourceLibraryOpen}
        onClose={() => setResourceLibraryOpen(false)}
        canRead
        onSelectAsset={handleResourceLibraryAssetSelect}
        selectLabel={t("resourceLibrary.loadToCurrentNode")}
        selectDisabled={Boolean(resourceLibrarySelectDisabledTitle)}
        selectDisabledTitle={resourceLibrarySelectDisabledTitle || null}
        selectingAssetId={loadResourceLibraryAssetMutation.variables ?? null}
      />
      <SaveToResourceLibraryDialog
        source={resourceLibrarySaveSource}
        canWrite={!resourceLibraryWriteBlockedTitle}
        onClose={() => setResourceLibrarySaveSource(null)}
        onSaved={() => {
          setNotice(t("resourceLibrary.saved"));
          setError("");
        }}
      />
      <TailSplitPlanDialog
        open={tailPlanDialogOpen && Boolean(selectedTailPendingPlan) && selectedNode?.node_type === "tail_splitter"}
        nodeTitle={selectedNode?.title ?? ""}
        plan={selectedTailPendingPlan}
        busy={applyTailSplitPlanMutation.isPending}
        imageSizeOptions={imageSizeOptions}
        imageGenerationMaxDimension={imageGenerationMaxDimension}
        imageToolAllowedFields={imageToolAllowedFields}
        resourceGroups={workflowResourceGroups}
        generationConfigOptions={generationConfigOptions}
        canReusePublicCopyNode={selectedTailPublicReuseAvailability.canReusePublicCopyNode}
        canReusePublicReferenceNode={selectedTailPublicReuseAvailability.canReusePublicReferenceNode}
        onClose={() => setTailPlanDialogOpen(false)}
        onConfirm={(itemIds, imageGenerationConfig, reuseOptions) =>
          void handleConfirmTailSplitPlan(itemIds, imageGenerationConfig, reuseOptions)
        }
      />
      {canvasTemplateSaveOpen ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/55 px-4 py-6 backdrop-blur-sm">
          <form
            className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-slate-700 dark:bg-[#0f1726] dark:shadow-black/45"
            onSubmit={(event) => {
              event.preventDefault();
              createUserCanvasTemplateMutation.mutate();
            }}
          >
            <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
              <h2 className="text-base font-semibold text-slate-950 dark:text-white">
                {t("detail.saveCanvasTemplateTitle")}
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
                {t("detail.saveCanvasTemplateDescription")}
              </p>
              {canvasTemplateHasTailNode ? (
                <div className="mt-3 rounded-xl border border-fuchsia-200 bg-fuchsia-50 px-3 py-2 text-xs leading-5 text-fuchsia-900 dark:border-fuchsia-400/35 dark:bg-fuchsia-500/10 dark:text-fuchsia-100">
                  {t("detail.saveCanvasTemplateTailHint")}
                </div>
              ) : null}
            </div>
            <div className="space-y-3 px-5 py-4">
              <input
                value={canvasTemplateSaveTitle}
                onChange={(event) => setCanvasTemplateSaveTitle(event.target.value)}
                className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-950 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-[#111b2d] dark:text-slate-100 dark:focus:border-violet-400"
                placeholder={t("detail.templateName")}
                maxLength={255}
              />
              <textarea
                value={canvasTemplateSaveDescription}
                onChange={(event) => setCanvasTemplateSaveDescription(event.target.value)}
                className="min-h-20 w-full resize-y rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-950 outline-none focus:border-indigo-500 dark:border-slate-700 dark:bg-[#111b2d] dark:text-slate-100 dark:focus:border-violet-400"
                placeholder={t("detail.templateDescription")}
                maxLength={1000}
              />
              <SelectField
                value={canvasTemplateSaveCategoryId}
                options={[
                  { value: "", label: t("detail.saveCanvasTemplateCategoryRequired") },
                  ...userCanvasTemplateCategories.map((category) => ({ value: category.id, label: category.name })),
                ]}
                onChange={setCanvasTemplateSaveCategoryId}
                ariaLabel={t("detail.saveCanvasTemplateCategoryRequired")}
                disabled={userCanvasTemplateCategoriesQuery.isLoading}
                radius="lg"
              />
              <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={canvasTemplateRetainPromptText}
                  onChange={(event) => setCanvasTemplateRetainPromptText(event.target.checked)}
                  className="h-4 w-4 accent-indigo-600"
                />
                {t("detail.saveCanvasTemplateRetainPrompt")}
              </label>
              {workflowInitialEntryMode === "blank" ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-200">
                  {t("detail.saveCanvasTemplateBlankDisabled")}
                </div>
              ) : null}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3 dark:border-slate-800 dark:bg-slate-950/45">
              <button
                type="button"
                onClick={() => setCanvasTemplateSaveOpen(false)}
                disabled={createUserCanvasTemplateMutation.isPending}
                className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {t("common.cancel")}
              </button>
              <button
                type="submit"
                disabled={
                  createUserCanvasTemplateMutation.isPending ||
                  canvasTemplateSaveDisabled ||
                  !canvasTemplateSaveTitle.trim() ||
                  !canvasTemplateSaveCategoryId
                }
                className="inline-flex h-9 items-center rounded-lg bg-slate-950 px-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60 dark:bg-violet-500 dark:hover:bg-violet-400"
              >
                {createUserCanvasTemplateMutation.isPending ? <Loader2 size={14} className="mr-2 animate-spin" /> : null}
                {t("detail.save")}
              </button>
            </div>
          </form>
        </div>
      ) : null}
      <ConfirmDialog
        open={Boolean(pendingDeleteDialog)}
        title={pendingDeleteDialog?.title ?? ""}
        description={pendingDeleteDialog?.description ?? ""}
        confirmLabel={t("confirm.delete.confirm")}
        cancelLabel={t("common.cancel")}
        busy={pendingDeleteDialog?.busy ?? false}
        onClose={() => setPendingDeleteAction(null)}
        onConfirm={() => {
          if (!pendingDeleteAction) {
            return;
          }
          if (inspirationWriteBlocked) {
            showInspirationWriteBlockedError();
            setPendingDeleteAction(null);
            return;
          }
          if (pendingDeleteAction.kind === "node") {
            deleteNodeMutation.mutate(pendingDeleteAction.node.id);
            return;
          }
          if (pendingDeleteAction.kind === "selectedNodes") {
            deleteSelectedNodesMutation.mutate(pendingDeleteAction.nodeIds);
            return;
          }
          archiveUserTemplateGroupMutation.mutate(pendingDeleteAction.templateId);
        }}
      />
      <ConfirmDialog
        open={Boolean(pendingHistoryDialog)}
        title={pendingHistoryDialog?.title ?? ""}
        description={pendingHistoryDialog?.description ?? ""}
        confirmLabel={t("detail.confirm.continue")}
        cancelLabel={t("common.cancel")}
        busy={historyActionBusy}
        onClose={() => setPendingHistoryAction(null)}
        onConfirm={() => {
          if (inspirationWriteBlocked) {
            showInspirationWriteBlockedError();
            setPendingHistoryAction(null);
            return;
          }
          if (pendingHistoryAction) {
            void executeHistoryDirection(pendingHistoryAction.direction, pendingHistoryAction.step);
          }
        }}
      />
    </div>
  );
}

function InspirationImagePreviewModal({
  image,
  resourceLibrarySource,
  resourceLibrarySaved,
  resourceLibrarySaving,
  resourceLibraryDisabledTitle,
  onSaveToResourceLibrary,
  onClose,
}: {
  image: DownloadableImage;
  resourceLibrarySource: ResourceLibrarySaveSource | null;
  resourceLibrarySaved: boolean;
  resourceLibrarySaving: boolean;
  resourceLibraryDisabledTitle: string;
  onSaveToResourceLibrary: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const hasResourceLibraryAction = Boolean(resourceLibrarySource);
  const resourceLibraryLabel = resourceLibrarySaved
    ? t("resourceLibrary.alreadyInLibrary")
    : t("resourceLibrary.saveToLibrary");
  const resourceLibraryTitle = resourceLibraryDisabledTitle || resourceLibraryLabel;

  const modal = (
    <div
      className="pointer-events-auto fixed inset-0 z-[80] flex items-center justify-center bg-zinc-950/70 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={image.alt}
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-[#0f1726]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3 dark:border-slate-800">
          <div className="min-w-0 truncate text-sm font-medium text-zinc-800 dark:text-slate-100">{image.alt}</div>
          <div className="flex shrink-0 items-center gap-2">
            <DownloadLink image={image} />
            {hasResourceLibraryAction ? (
              <button
                type="button"
                onClick={onSaveToResourceLibrary}
                disabled={Boolean(resourceLibraryDisabledTitle) || resourceLibrarySaving}
                title={resourceLibraryTitle}
                aria-label={resourceLibraryTitle}
                className="inline-flex min-h-8 items-center rounded border border-[#56B3FE] bg-gradient-to-r from-[#56B3FE] via-[#2F7CFF] to-[#8B5CF6] px-2.5 py-1 text-[10px] font-semibold text-white shadow-sm shadow-[#56B3FE]/25 transition-[background-color,border-color,box-shadow,transform] duration-200 ease-out hover:border-[#7C3AED] hover:shadow-md hover:shadow-[#2F7CFF]/35 active:translate-y-px active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#56B3FE]/40 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-200 disabled:bg-none disabled:text-slate-500 disabled:shadow-none disabled:hover:border-slate-200 disabled:active:translate-y-0 disabled:active:scale-100 dark:disabled:border-slate-700 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
              >
                {resourceLibrarySaving ? (
                  <Loader2 size={12} className="mr-1.5 animate-spin" />
                ) : resourceLibrarySaved ? (
                  <Check size={12} className="mr-1.5" />
                ) : (
                  <Save size={12} className="mr-1.5" />
                )}
                <span className="max-w-28 truncate">{resourceLibraryLabel}</span>
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
              aria-label={t("detail.preview.close")}
            >
              <X size={16} />
            </button>
          </div>
        </div>
        <ZoomableImage
          src={image.previewUrl}
          alt={image.alt}
          zoomOutLabel={t("imagePreview.zoomOut")}
          zoomInLabel={t("imagePreview.zoomIn")}
          resetLabel={t("imagePreview.reset")}
          className={`h-[calc(100vh-11rem)] p-4 ${IMAGE_PREVIEW_SURFACE_CLASS_NAME}`}
        />
      </div>
    </div>
  );

  return typeof document === "undefined" ? modal : createPortal(modal, document.body);
}
