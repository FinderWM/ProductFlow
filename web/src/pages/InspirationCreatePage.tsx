import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  Eye,
  EyeOff,
  FileText,
  ImagePlus,
  LayoutTemplate,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import { ClassicOptionToggle, ClassicSelectField, ClassicTextInput } from "../components/classicInputs";
import { ImageDropZone } from "../components/ImageDropZone";
import {
  actionButtonComponentForAppearance,
  actionSurfaceClassNameForAppearance,
  type LayoutActionAppearance,
} from "../components/layoutActionButtons";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { AsyncContent, AsyncErrorState, AsyncPausedState } from "../components/loading/AsyncContent";
import { Skeleton, SkeletonRows } from "../components/loading/Skeleton";
import { ParameterHelpButton, ParameterHelpLabel } from "../components/ParameterHelp";
import { TopNav } from "../components/TopNav";
import {
  getResourceBlockedActionTitle,
  isResourceBlocked,
  ResourceMetaBadges,
} from "../components/ResourceGovernance";
import { ResourceLibraryModal } from "../components/resource-library/ResourceLibraryModal";
import { WorkspaceOptionToggle, WorkspaceSelectField, WorkspaceTextInput } from "../components/workspaceInputs";
import { api, ApiError } from "../lib/api";
import { asyncViewPhase, asyncViewStateFromQuery } from "../lib/asyncViewState";
import { localizeCanvasTemplateSummary } from "../lib/canvasTemplateLocalization";
import { dynamicFieldsToRecord, type DynamicFieldDraft } from "../lib/dynamicFields";
import { INSPIRATION_CONTEXT_MARKDOWN_MAX_LENGTH } from "../lib/markdown";
import { useI18n } from "../lib/preferences";
import { activeGenerationResourceGroupsInApiOrder } from "../lib/resourceGroups";
import type { TranslationKey } from "../lib/i18n";
import { useUiLayoutScheme } from "../lib/uiLayoutSchemePreference";
import type {
  CanvasTemplateScope,
  CanvasTemplateSummary,
  GenerationResourceGroup,
  InspirationInitialWorkflowEntry,
  ModerationFields,
  ResourceLibraryAsset,
  WorkflowNodeType,
} from "../lib/types";

interface PreviewNode {
  id: string;
  title: string;
  subtitle: string;
  x: number;
  y: number;
  width?: number;
  tone?: "input" | "copy" | "image" | "output" | "blank" | "tail";
}

interface PreviewPortUsage {
  inputs: Set<string>;
  outputs: Set<string>;
}

interface PreviewEdge {
  from: string;
  to: string;
}

interface CanvasPlanOption extends ModerationFields {
  key: string;
  label: string;
  shortLabel: string;
  description: string;
  badge: string;
  stage: string;
  entryMode?: InspirationInitialWorkflowEntry;
  scope?: CanvasTemplateScope | null;
  categoryName?: string | null;
  owner_user_id?: string | null;
  owner_username?: string | null;
  outputCount: number;
  referenceCount: number;
  previewNodes: PreviewNode[];
  previewEdges: PreviewEdge[];
}

type TemplateScopeFilter = CanvasTemplateScope | "all";

const PREVIEW_MIN_WIDTH = 920;
const PREVIEW_NODE_WIDTH = 248;
const NODE_HEIGHT = 92;
const PREVIEW_HEIGHT = 560;
const MAIN_IMAGE_PREVIEW_MAX_WIDTH = 640;
const MAIN_IMAGE_PREVIEW_MAX_HEIGHT = 360;
const MAIN_IMAGE_PREVIEW_DEFAULT_SIZE = {
  width: MAIN_IMAGE_PREVIEW_MAX_WIDTH,
  height: MAIN_IMAGE_PREVIEW_MAX_HEIGHT,
};
const INSPIRATION_CREATE_FORM_ID = "inspiration-create-form";
type MobileCreateStep = "entry" | "details" | "template";
export type DocumentTextState = "idle" | "loading" | "ready" | "failed";

interface ImageNaturalSize {
  width: number;
  height: number;
}

interface InspirationCreateReturnState {
  source?: "inspiration-list";
  returnTo?: string;
  listState?: unknown;
}

const NODE_TYPE_LABEL_KEYS: Record<WorkflowNodeType, TranslationKey> = {
  inspiration_context: "create.inspirationContext",
  reference_image: "create.referenceImage",
  copy_generation: "create.copy",
  image_generation: "create.imageGeneration",
  image_enhance: "create.imageEnhance",
  tail_splitter: "create.tailSplitter",
  deck_generation: "create.deckGeneration",
};

const INITIAL_WORKFLOW_ENTRY_OPTIONS: Array<{
  value: InspirationInitialWorkflowEntry;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  icon: typeof ImagePlus;
}> = [
  { value: "image", labelKey: "create.entry.image", descriptionKey: "create.entry.imageHint", icon: ImagePlus },
  { value: "copy", labelKey: "create.entry.copy", descriptionKey: "create.entry.copyHint", icon: FileText },
  { value: "tail", labelKey: "create.entry.tail", descriptionKey: "create.entry.tailHint", icon: Sparkles },
  { value: "blank", labelKey: "create.entry.blank", descriptionKey: "create.entry.blankHint", icon: LayoutTemplate },
];

const stageLabelKeys: Record<string, TranslationKey> = {
  blank: "create.stage.blank",
  image: "create.entry.image",
  copy: "create.entry.copy",
  tail: "create.entry.tail",
  listing: "create.stage.listing",
  detail: "create.stage.detail",
  content: "create.stage.content",
  gallery: "create.stage.gallery",
  campaign: "create.stage.campaign",
};

const stageOrder = ["image", "copy", "tail", "blank", "listing", "detail", "gallery", "content", "campaign"];
const blankStageOrder = ["image", "copy", "tail", "blank", "listing", "detail", "gallery", "content", "campaign"];
const toneClasses: Record<NonNullable<PreviewNode["tone"]>, string> = {
  input: "border-sky-100 bg-sky-50/90 text-sky-900 dark:border-sky-400/35 dark:bg-sky-500/12 dark:text-sky-100",
  copy: "border-violet-100 bg-violet-50/90 text-violet-900 dark:border-violet-400/40 dark:bg-violet-500/16 dark:text-violet-100",
  image: "border-emerald-100 bg-emerald-50/90 text-emerald-900 dark:border-emerald-400/35 dark:bg-emerald-500/12 dark:text-emerald-100",
  output: "border-amber-100 bg-amber-50/90 text-amber-900 dark:border-amber-400/35 dark:bg-amber-500/12 dark:text-amber-100",
  tail: "border-fuchsia-100 bg-fuchsia-50/90 text-fuchsia-900 dark:border-fuchsia-400/35 dark:bg-fuchsia-500/12 dark:text-fuchsia-100",
  blank: "border-dashed border-zinc-300 bg-white/80 text-zinc-500 dark:border-slate-600 dark:bg-[#151f33]/80 dark:text-slate-300",
};

function nodeTone(nodeType: WorkflowNodeType, outputNodeKeys: Set<string>, nodeKey: string): PreviewNode["tone"] {
  if (nodeType === "inspiration_context") {
    return "input";
  }
  if (nodeType === "copy_generation") {
    return "copy";
  }
  if (nodeType === "image_generation") {
    return "image";
  }
  if (nodeType === "tail_splitter") {
    return "tail";
  }
  return outputNodeKeys.has(nodeKey) ? "output" : "input";
}

function nodeSubtitle(
  node: CanvasTemplateSummary["preview_nodes"][number],
  outputNodeKeys: Set<string>,
  t: ReturnType<typeof useI18n>["t"],
): string {
  if (outputNodeKeys.has(node.key)) {
    return t("create.outputSlot");
  }
  if (node.node_type === "image_generation" && node.size) {
    return node.size.replace("x", " x ");
  }
  return t(NODE_TYPE_LABEL_KEYS[node.node_type]);
}

function canvasTemplateToPlan(template: CanvasTemplateSummary, t: ReturnType<typeof useI18n>["t"]): CanvasPlanOption {
  const outputNodeKeys = new Set(template.output_slots.map((slot) => slot.node_key));
  return {
    key: template.key,
    label: template.title,
    shortLabel: template.output_slots.map((slot) => slot.label).join(" / ") || template.scenario.title,
    description: template.description,
    badge: template.scenario.title || t("create.template"),
    stage: template.entry_mode,
    entryMode: template.entry_mode,
    scope: template.scope,
    categoryName: template.category_name,
    owner_user_id: template.owner_user_id,
    owner_username: template.owner_username,
    enabled: template.enabled,
    effective_enabled: template.effective_enabled,
    disabled_reason: template.disabled_reason,
    outputCount: template.output_slots.length,
    referenceCount: template.reference_input_hints.length,
    previewNodes: template.preview_nodes.map((node) => ({
      id: node.key,
      title: node.title,
      subtitle: nodeSubtitle(node, outputNodeKeys, t),
      x: node.position_x,
      y: node.position_y,
      tone: nodeTone(node.node_type, outputNodeKeys, node.key),
    })),
    previewEdges: template.preview_edges.map((edge) => ({
      from: edge.source_node_key,
      to: edge.target_node_key,
    })),
  };
}

function sortPlans(plans: CanvasPlanOption[]): CanvasPlanOption[] {
  return [...plans].sort((left, right) => {
    const leftIndex = stageOrder.indexOf(left.stage);
    const rightIndex = stageOrder.indexOf(right.stage);
    const normalizedLeft = leftIndex === -1 ? stageOrder.length : leftIndex;
    const normalizedRight = rightIndex === -1 ? stageOrder.length : rightIndex;
    return normalizedLeft - normalizedRight || left.label.localeCompare(right.label, "zh-Hans-CN");
  });
}

function previewWidth(plan: CanvasPlanOption): number {
  if (!plan.previewNodes.length) {
    return PREVIEW_MIN_WIDTH;
  }
  return Math.max(
    PREVIEW_MIN_WIDTH,
    Math.max(...plan.previewNodes.map((node) => node.x + (node.width ?? PREVIEW_NODE_WIDTH))) + 96,
  );
}

function groupedPlans(
  plans: CanvasPlanOption[],
  t: ReturnType<typeof useI18n>["t"],
  order: string[] = stageOrder,
) {
  const groups = new Map<string, CanvasPlanOption[]>();
  for (const plan of plans) {
    const items = groups.get(plan.stage) ?? [];
    items.push(plan);
    groups.set(plan.stage, items);
  }
  return order
    .filter((stage) => groups.has(stage))
    .map((stage) => ({ stage, label: stageLabelKeys[stage] ? t(stageLabelKeys[stage]) : stage, plans: groups.get(stage) ?? [] }));
}

export function contextDocumentFileForSubmit(file: File | null): File | undefined {
  return file ?? undefined;
}

export function constrainedMainImagePreviewSize(size: ImageNaturalSize | null): ImageNaturalSize {
  if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) {
    return MAIN_IMAGE_PREVIEW_DEFAULT_SIZE;
  }
  const scale = Math.min(MAIN_IMAGE_PREVIEW_MAX_WIDTH / size.width, MAIN_IMAGE_PREVIEW_MAX_HEIGHT / size.height);
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

export function InspirationCreatePage() {
  const { locale, t } = useI18n();
  const { activeScheme } = useUiLayoutScheme();
  const navigate = useNavigate();
  const location = useLocation();
  const workspaceSubpage = activeScheme === "workspace";
  const actionAppearance: LayoutActionAppearance = workspaceSubpage ? "workspace" : "classic";
  const ActionButton = actionButtonComponentForAppearance(actionAppearance);
  const createMainImageUploadClass = actionSurfaceClassNameForAppearance(actionAppearance, {
    preset: "secondary",
    focusWithin: true,
    className:
      "pf-action-surface--compact-button pf-action-surface--dashed flex-1 min-w-[180px] cursor-pointer",
  });
  const createDocumentUploadClass = actionSurfaceClassNameForAppearance(actionAppearance, {
    preset: "secondary",
    focusWithin: true,
    className: "pf-action-surface--dashed flex cursor-pointer items-center justify-center px-3 py-3 text-xs font-medium",
  });
  const LayoutOptionToggle = workspaceSubpage ? WorkspaceOptionToggle : ClassicOptionToggle;
  const LayoutSelectField = workspaceSubpage ? WorkspaceSelectField : ClassicSelectField;
  const LayoutTextInput = workspaceSubpage ? WorkspaceTextInput : ClassicTextInput;
  const markdownInputAppearance = workspaceSubpage ? "workspace" : "classic";
  const [name, setName] = useState("");
  const [longText, setLongText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [selectedMainImageAsset, setSelectedMainImageAsset] = useState<ResourceLibraryAsset | null>(null);
  const [mainImageResourceLibraryOpen, setMainImageResourceLibraryOpen] = useState(false);
  const [uploadedMainImagePreviewUrl, setUploadedMainImagePreviewUrl] = useState<string | null>(null);
  const [mainImageNaturalSize, setMainImageNaturalSize] = useState<ImageNaturalSize | null>(null);
  const [contextDocumentFile, setContextDocumentFile] = useState<File | null>(null);
  const [contextDocumentText, setContextDocumentText] = useState("");
  const [contextDocumentTextState, setContextDocumentTextState] = useState<DocumentTextState>("idle");
  const [contextDocumentPreviewOpen, setContextDocumentPreviewOpen] = useState(false);
  const contextDocumentTextFileRef = useRef<File | null>(null);
  const [dynamicFields, setDynamicFields] = useState<Array<DynamicFieldDraft & { id: string }>>([]);
  const [initialWorkflowEntry, setInitialWorkflowEntry] = useState<InspirationInitialWorkflowEntry>("image");
  const [selectedResourceGroupId, setSelectedResourceGroupId] = useState<string | null>(null);
  const [canvasTemplateKey, setCanvasTemplateKey] = useState<string>("");
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateCategoryId, setTemplateCategoryId] = useState("");
  const [templateScope, setTemplateScope] = useState<TemplateScopeFilter>("all");
  const [error, setError] = useState("");
  const [mobileStep, setMobileStep] = useState<MobileCreateStep>("entry");
  const createReturnState = location.state as InspirationCreateReturnState | null;
  const normalizedTemplateSearch = templateSearch.trim();
  const templateScopeParam = templateScope === "all" ? undefined : templateScope;
  const longTextRequired = initialWorkflowEntry === "copy" || initialWorkflowEntry === "tail";
  const mainImageRequired = initialWorkflowEntry === "image";
  const entryTextHelpKey: TranslationKey | null =
    initialWorkflowEntry === "copy"
      ? "create.entryText.copyHelp"
      : initialWorkflowEntry === "tail"
        ? "create.entryText.tailHelp"
        : null;

  const templatesQuery = useQuery({
    queryKey: ["canvas-templates", normalizedTemplateSearch, templateCategoryId, templateScope, initialWorkflowEntry],
    queryFn: () =>
      api.listCanvasTemplates({
        search: normalizedTemplateSearch || undefined,
        category_id: templateCategoryId || undefined,
        scope: templateScopeParam,
        initial_workflow_entry: initialWorkflowEntry,
      }),
  });

  const templateCategoriesQuery = useQuery({
    queryKey: ["canvas-template-categories", templateScope],
    queryFn: () =>
      api.listCanvasTemplateCategories({
        scope: templateScopeParam,
      }),
  });
  const generationResourceGroupsQuery = useQuery({
    queryKey: ["my-generation-resource-groups"],
    queryFn: api.listMyGenerationResourceGroups,
  });
  const templatesState = asyncViewStateFromQuery({
    active: true,
    data: templatesQuery.data,
    dataUpdatedAt: templatesQuery.dataUpdatedAt,
    isSuccess: templatesQuery.isSuccess,
    isError: templatesQuery.isError,
    fetchStatus: templatesQuery.fetchStatus,
    isEmpty: () => false,
  });
  const templatesPhase = asyncViewPhase(templatesState);
  const templateCategoriesState = asyncViewStateFromQuery({
    active: true,
    data: templateCategoriesQuery.data,
    dataUpdatedAt: templateCategoriesQuery.dataUpdatedAt,
    isSuccess: templateCategoriesQuery.isSuccess,
    isError: templateCategoriesQuery.isError,
    fetchStatus: templateCategoriesQuery.fetchStatus,
    isEmpty: (data) => data.items.length === 0,
  });
  const generationResourceGroupsState = asyncViewStateFromQuery({
    active: true,
    data: generationResourceGroupsQuery.data,
    dataUpdatedAt: generationResourceGroupsQuery.dataUpdatedAt,
    isSuccess: generationResourceGroupsQuery.isSuccess,
    isError: generationResourceGroupsQuery.isError,
    fetchStatus: generationResourceGroupsQuery.fetchStatus,
    isEmpty: (data) => activeGenerationResourceGroupsInApiOrder(data).length === 0,
  });
  const generationResourceGroupsPhase = asyncViewPhase(generationResourceGroupsState);
  const resourceGroups = useMemo<GenerationResourceGroup[]>(
    () => activeGenerationResourceGroupsInApiOrder(generationResourceGroupsQuery.data),
    [generationResourceGroupsQuery.data],
  );

  useEffect(() => {
    if (generationResourceGroupsPhase !== "ready" && generationResourceGroupsPhase !== "empty") {
      return;
    }
    if (!resourceGroups.length) {
      if (selectedResourceGroupId) {
        setSelectedResourceGroupId(null);
      }
      return;
    }
    if (!selectedResourceGroupId || !resourceGroups.some((group) => group.id === selectedResourceGroupId)) {
      setSelectedResourceGroupId(resourceGroups[0].id);
    }
  }, [generationResourceGroupsPhase, resourceGroups, selectedResourceGroupId]);

  const canvasPlanOptions = useMemo(() => {
    const blankCanvasPreviewNodes: PreviewNode[] =
      initialWorkflowEntry === "image"
        ? [
            { id: "inspiration", title: t("create.inspirationContext"), subtitle: t("create.inspirationInfoNode"), x: 48, y: 120, tone: "input" },
            { id: "entry-copy", title: t("create.copy"), subtitle: t("create.copy"), x: 368, y: 72, tone: "copy" },
            { id: "entry-image", title: t("create.imageGeneration"), subtitle: t("create.entry.image"), x: 688, y: 104, tone: "image" },
            { id: "entry-output", title: t("create.referenceImage"), subtitle: t("create.outputSlot"), x: 1008, y: 120, tone: "output" },
          ]
        : initialWorkflowEntry === "copy"
          ? [
              { id: "inspiration", title: t("create.inspirationContext"), subtitle: t("create.inspirationInfoNode"), x: 48, y: 112, tone: "input" },
              { id: "entry-copy", title: t("create.copy"), subtitle: t("create.entry.copy"), x: 368, y: 112, tone: "copy" },
            ]
          : initialWorkflowEntry === "tail"
            ? [
                { id: "inspiration", title: t("create.inspirationContext"), subtitle: t("create.inspirationInfoNode"), x: 48, y: 112, tone: "input" },
                { id: "entry-tail", title: t("create.tailSplitter"), subtitle: t("create.entry.tail"), x: 368, y: 112, tone: "tail" },
              ]
            : [{ id: "inspiration", title: t("create.inspirationContext"), subtitle: t("create.inspirationInfoNode"), x: 48, y: 112, tone: "input" }];
    const planTitleKey: TranslationKey =
      initialWorkflowEntry === "image"
        ? "create.plan.imageBaseTitle"
        : initialWorkflowEntry === "copy"
          ? "create.plan.copyBaseTitle"
          : initialWorkflowEntry === "tail"
            ? "create.plan.tailBaseTitle"
            : "create.blankCanvas";
    const planDescriptionKey: TranslationKey =
      initialWorkflowEntry === "image"
        ? "create.plan.imageBaseDescription"
        : initialWorkflowEntry === "copy"
          ? "create.plan.copyBaseDescription"
          : initialWorkflowEntry === "tail"
            ? "create.plan.tailBaseDescription"
            : "create.blankDescription";
    const blankCanvasPlan: CanvasPlanOption = {
      key: "",
      label: t(planTitleKey),
      shortLabel: t("create.freeLayout"),
      description: t(planDescriptionKey),
      badge: t("create.basic"),
      stage: "blank",
      outputCount: initialWorkflowEntry === "image" ? 1 : 0,
      referenceCount: 0,
      previewNodes: blankCanvasPreviewNodes,
      previewEdges:
        initialWorkflowEntry === "image"
          ? [
              { from: "inspiration", to: "entry-copy" },
              { from: "inspiration", to: "entry-image" },
              { from: "entry-copy", to: "entry-image" },
              { from: "entry-image", to: "entry-output" },
            ]
          : initialWorkflowEntry === "copy"
            ? [{ from: "inspiration", to: "entry-copy" }]
            : initialWorkflowEntry === "tail"
              ? [{ from: "inspiration", to: "entry-tail" }]
              : [],
    };
    const fullCanvasTemplates =
      templatesQuery.data?.items
        .filter((template) => template.kind === "full_canvas")
        .map((template) => localizeCanvasTemplateSummary(template, locale))
        .map((template) => canvasTemplateToPlan(template, t)) ?? [];
    return [blankCanvasPlan, ...sortPlans(fullCanvasTemplates)];
  }, [initialWorkflowEntry, locale, t, templatesQuery.data]);

  const selectedPlan =
    canvasPlanOptions.find((option) => option.key === canvasTemplateKey) ?? canvasPlanOptions[0];

  const planGroups = useMemo(
    () => groupedPlans(canvasPlanOptions, t, initialWorkflowEntry === "blank" ? blankStageOrder : stageOrder),
    [canvasPlanOptions, initialWorkflowEntry, t],
  );
  const templateCategories = templateCategoriesQuery.data?.items ?? [];

  useEffect(() => {
    if (templatesPhase !== "ready") {
      return;
    }
    if (!canvasPlanOptions.some((option) => option.key === canvasTemplateKey)) {
      setCanvasTemplateKey("");
    }
  }, [canvasPlanOptions, canvasTemplateKey, templatesPhase]);

  const handleInitialWorkflowEntryChange = (value: InspirationInitialWorkflowEntry) => {
    setInitialWorkflowEntry(value);
    setCanvasTemplateKey("");
    setError("");
  };

  const handleTemplateScopeChange = (nextScope: TemplateScopeFilter) => {
    setTemplateScope(nextScope);
    setTemplateCategoryId("");
  };

  useEffect(() => {
    if (!file) {
      setUploadedMainImagePreviewUrl(null);
      return;
    }
    const objectUrl = window.URL.createObjectURL(file);
    setUploadedMainImagePreviewUrl(objectUrl);
    return () => {
      window.URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  useEffect(() => {
    if (!contextDocumentFile) {
      setContextDocumentText("");
      setContextDocumentTextState("idle");
      contextDocumentTextFileRef.current = null;
      return;
    }
    if (!contextDocumentPreviewOpen) {
      return;
    }
    if (contextDocumentTextFileRef.current === contextDocumentFile && contextDocumentTextState !== "idle") {
      return;
    }
    let active = true;
    setContextDocumentText("");
    setContextDocumentTextState("loading");
    void contextDocumentFile
      .text()
      .then((text) => {
        if (!active) {
          return;
        }
        contextDocumentTextFileRef.current = contextDocumentFile;
        setContextDocumentText(text);
        setContextDocumentTextState("ready");
      })
      .catch(() => {
        if (!active) {
          return;
        }
        contextDocumentTextFileRef.current = contextDocumentFile;
        setContextDocumentText("");
        setContextDocumentTextState("failed");
      });
    return () => {
      active = false;
    };
  }, [contextDocumentFile, contextDocumentPreviewOpen]);

  const validateCreateDraft = (options?: { checkResource?: boolean }) => {
    if (!name.trim()) {
      return t("create.requiredName");
    }
    if (!selectedResourceGroupId) {
      return t("create.resourceGroupRequired");
    }
    if (mainImageRequired && !file && !selectedMainImageAsset) {
      return t("create.requiredImage");
    }
    if (initialWorkflowEntry === "copy" && !longText.trim()) {
      return t("create.requiredCopyText");
    }
    if (initialWorkflowEntry === "tail" && !longText.trim()) {
      return t("create.requiredTailText");
    }
    if (dynamicFields.some((field) => !field.key.trim() && field.value.trim())) {
      return t("create.dynamicKeyRequired");
    }
    if (options?.checkResource !== false && isResourceBlocked(selectedPlan)) {
      return getResourceBlockedActionTitle(selectedPlan, t("resource.blockedAction"));
    }
    return "";
  };

  const handleMobileDetailsNext = (event?: React.MouseEvent<HTMLButtonElement>) => {
    event?.preventDefault();
    const validationError = validateCreateDraft({ checkResource: false });
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    setMobileStep("template");
  };

  const createInspirationMutation = useMutation({
    mutationFn: () => {
      const validationError = validateCreateDraft();
      if (validationError) {
        throw new Error(validationError);
      }
      const dynamicFieldsPayload = dynamicFieldsToRecord(dynamicFields);
      const trimmedLongText = longText.trim();
      return api.createInspiration({
        name: name.trim(),
        resource_group_id: selectedResourceGroupId ?? "",
        long_text: trimmedLongText || undefined,
        file: file ?? undefined,
        image_source_asset_id: selectedMainImageAsset?.id ?? undefined,
        contextDocumentFile: contextDocumentFileForSubmit(contextDocumentFile),
        dynamic_fields: Object.keys(dynamicFieldsPayload).length ? dynamicFieldsPayload : undefined,
        canvas_template_key: selectedPlan.key || undefined,
        initial_workflow_entry: initialWorkflowEntry,
        entry_text: longTextRequired ? trimmedLongText : undefined,
      });
    },
    onSuccess: (inspiration) => {
      navigate(`/inspirations/${inspiration.id}`);
    },
    onError: (mutationError) => {
      if (mutationError instanceof ApiError) {
        setError(mutationError.detail);
        return;
      }
      setError(mutationError instanceof Error ? mutationError.message : t("create.failed"));
    },
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    createInspirationMutation.mutate();
  };

  const handleImageFiles = (files: File[]) => {
    const nextFile = files[0] ?? null;
    setFile(nextFile);
    if (nextFile) {
      setSelectedMainImageAsset(null);
    }
    setError("");
  };

  const handleSelectMainImageAsset = (asset: ResourceLibraryAsset) => {
    setSelectedMainImageAsset(asset);
    setMainImageResourceLibraryOpen(false);
    setFile(null);
    setError("");
  };

  const clearMainImage = () => {
    setFile(null);
    setSelectedMainImageAsset(null);
    setError("");
  };

  const handleDocumentFiles = (files: File[]) => {
    const nextFile = files[0] ?? null;
    if (contextDocumentFile && nextFile) {
      return;
    }
    setContextDocumentPreviewOpen(false);
    setContextDocumentText("");
    setContextDocumentTextState("idle");
    contextDocumentTextFileRef.current = null;
    setContextDocumentFile(nextFile);
    setError("");
  };

  const clearContextDocument = () => {
    setContextDocumentFile(null);
    setContextDocumentText("");
    setContextDocumentTextState("idle");
    setContextDocumentPreviewOpen(false);
    contextDocumentTextFileRef.current = null;
    setError("");
  };

  const addDynamicField = () => {
    setDynamicFields((current) => [
      ...current,
      { id: `dynamic-${Date.now()}-${current.length}`, key: "", value: "" },
    ]);
    setError("");
  };

  const updateDynamicField = (fieldId: string, patch: Partial<DynamicFieldDraft>) => {
    setDynamicFields((current) => current.map((field) => (field.id === fieldId ? { ...field, ...patch } : field)));
    setError("");
  };

  const removeDynamicField = (fieldId: string) => {
    setDynamicFields((current) => current.filter((field) => field.id !== fieldId));
    setError("");
  };

  const handleClose = () => {
    if (createReturnState?.source === "inspiration-list" && createReturnState.returnTo) {
      navigate(createReturnState.returnTo, {
        state: { restoreInspirationListState: createReturnState.listState },
      });
      return;
    }
    navigate("/inspirations/list");
  };

  const hasMainImage = file !== null || selectedMainImageAsset !== null;
  const mainImageName = file?.name ?? selectedMainImageAsset?.original_filename ?? "";
  const mainImagePreviewUrl = selectedMainImageAsset
    ? api.toApiUrl(selectedMainImageAsset.preview_url || selectedMainImageAsset.thumbnail_url)
    : uploadedMainImagePreviewUrl;
  const mainImagePreviewDisplaySize = constrainedMainImagePreviewSize(mainImageNaturalSize);
  const mainImagePreviewFrameStyle = {
    width: `${mainImagePreviewDisplaySize.width}px`,
    aspectRatio: `${mainImagePreviewDisplaySize.width} / ${mainImagePreviewDisplaySize.height}`,
  };
  const mainImageSourceLabel = file
    ? t("create.mainImageSourceUpload")
    : selectedMainImageAsset
      ? t("create.mainImageSourceLibrary")
      : t("create.mainImageEmpty");
  const mainImageUploadLabel = hasMainImage ? t("create.replaceMainImage") : t("create.uploadMainImage");
  const templateCategorySelect = (
    <LayoutSelectField
      value={templateCategoryId}
      onChange={setTemplateCategoryId}
      size="compact"
      ariaLabel={t("templateFilter.category")}
      options={[
        { value: "", label: t("templateFilter.allCategories") },
        ...templateCategories.map((category) => ({
          value: category.id,
          label: category.name,
        })),
      ]}
    />
  );
  const generationResourceGroupSelect = (
    <LayoutSelectField
      value={selectedResourceGroupId ?? ""}
      onChange={(value) => {
        setSelectedResourceGroupId(value || null);
        setError("");
      }}
      disabled={!resourceGroups.length}
      size="compact"
      ariaLabel={t("create.resourceGroup")}
      options={[
        {
          value: "",
          label: resourceGroups.length ? t("create.selectResourceGroup") : t("create.noResourceGroups"),
          disabled: true,
        },
        ...resourceGroups.map((group) => ({
          value: group.id,
          label: group.name,
        })),
      ]}
    />
  );

  useEffect(() => {
    setMainImageNaturalSize(null);
  }, [mainImagePreviewUrl]);

  const templatePanelContent = (
    <>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-950 dark:text-white">{t("create.templateTitle")}</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-slate-400">
            {t("create.templateDescription")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ActionButton
            onClick={() => navigate("/workflow/templates")}
            preset="secondary"
            size="icon-sm"
            aria-label={t("templateManage.personalTitle")}
            title={t("templateManage.personalTitle")}
            leadingIcon={<Settings2 size={14} />}
          />
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-zinc-500 dark:text-slate-400">
            {t("templateFilter.search")}
          </span>
          <span className="relative block">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-slate-500" />
            <LayoutTextInput
              value={templateSearch}
              onChange={(event) => setTemplateSearch(event.target.value)}
              maxLength={120}
              size="compact"
              className="pl-8"
              placeholder={t("templateFilter.searchPlaceholder")}
            />
          </span>
        </label>
        <div className="grid gap-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-zinc-500 dark:text-slate-400">
              {t("templateFilter.category")}
            </span>
            <AsyncContent
              state={templateCategoriesState}
              refreshIntent="parameter-change"
              loadingLabel={t("app.loading")}
              skeleton={<Skeleton className="h-9 w-full" rounded="lg" />}
              initialError={(
                <AsyncErrorState
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-100"
                  title={t("templateFilter.categoriesLoadFailed")}
                  retryLabel={t("common.retry")}
                  retryingLabel={t("app.loading")}
                  retrying={templateCategoriesState.fetch === "fetching"}
                  onRetry={() => void templateCategoriesQuery.refetch()}
                />
              )}
              paused={(
                <AsyncPausedState
                  title={t("app.requestPaused.title")}
                  retryLabel={t("common.retry")}
                  onRetry={() => void templateCategoriesQuery.refetch()}
                />
              )}
              inactive={null}
              empty={templateCategorySelect}
              refreshFeedback={
                templateCategoriesState.error === "refresh" ? (
                  <div className="mt-2 text-xs text-red-600 dark:text-red-300">
                    {t("templateFilter.categoriesLoadFailed")}
                  </div>
                ) : null
              }
            >
              {templateCategorySelect}
            </AsyncContent>
          </label>
          <div>
            <div className="mb-1.5 text-xs font-medium text-zinc-500 dark:text-slate-400">
              {t("templateFilter.scope")}
            </div>
            <div className="flex flex-wrap gap-2">
              {(["all", "global", "user"] as const).map((scope) => {
                const labelKey =
                  scope === "all"
                    ? "templateFilter.scopeAll"
                    : scope === "global"
                      ? "templateFilter.scopeGlobal"
                      : "templateFilter.scopeUser";
                return (
                  <LayoutOptionToggle
                    key={scope}
                    checked={templateScope === scope}
                    selectionMode="single"
                    name="template-scope-filter"
                    onChange={(checked) => {
                      if (checked) {
                        handleTemplateScopeChange(scope);
                      }
                    }}
                  >
                    {t(labelKey)}
                  </LayoutOptionToggle>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <AsyncContent
        state={templatesState}
        refreshIntent="parameter-change"
        loadingLabel={t("app.loading")}
        skeleton={(
          <div className="mt-4 max-h-[42dvh] overflow-hidden pr-1 md:max-h-[420px] xl:max-h-[520px]">
            <SkeletonRows count={5} />
          </div>
        )}
        initialError={(
          <AsyncErrorState
            className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-100"
            title={t("create.templateLoadFailed")}
            retryLabel={t("common.retry")}
            retryingLabel={t("app.loading")}
            retrying={templatesState.fetch === "fetching"}
            onRetry={() => void templatesQuery.refetch()}
          />
        )}
        paused={(
          <AsyncPausedState
            title={t("app.requestPaused.title")}
            message={t("app.requestPaused.message")}
            retryLabel={t("common.retry")}
            onRetry={() => void templatesQuery.refetch()}
            className="mt-4 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-300/30 dark:bg-amber-400/10 dark:text-amber-100"
          />
        )}
        inactive={null}
        empty={null}
        refreshFeedback={
          templatesState.error === "refresh" ? (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-100">
              <span>{t("create.templateLoadFailed")}</span>
              <ActionButton
                preset="secondary"
                size="sm"
                className="shrink-0 text-xs"
                onClick={() => void templatesQuery.refetch()}
              >
                {t("common.retry")}
              </ActionButton>
            </div>
          ) : null
        }
      >
        <div className="mt-4 max-h-[42dvh] space-y-5 overflow-y-auto pr-1 md:max-h-[420px] xl:max-h-[520px]">
          {planGroups.map((group) => (
          <div key={group.stage}>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500 dark:text-slate-400">{group.label}</h3>
              <span className="text-[11px] text-zinc-400 dark:text-slate-500">{group.plans.length}</span>
            </div>
            <div className="space-y-2">
              {group.plans.map((option) => {
                const optionBlocked = isResourceBlocked(option);
                const optionBlockedTitle = getResourceBlockedActionTitle(option, t("resource.blockedAction"));
                return (
                  <LayoutOptionToggle
                    key={option.key || "blank"}
                    checked={selectedPlan.key === option.key}
                    layout="card"
                    selectionMode="single"
                    name="canvas-template-plan"
                    title={optionBlocked ? optionBlockedTitle : option.label}
                    className={optionBlocked ? "w-full px-3 py-3 opacity-60 cursor-not-allowed" : "w-full px-3 py-3"}
                    onChange={(checked) => {
                      if (!checked) {
                        return;
                      }
                      if (optionBlocked) {
                        setError(optionBlockedTitle);
                        return;
                      }
                      setCanvasTemplateKey(option.key);
                    }}
                  >
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-zinc-950 dark:text-white">
                          {option.label}
                        </span>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-zinc-500 dark:text-slate-400">
                          {option.description}
                        </p>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <TemplateChip>{option.shortLabel}</TemplateChip>
                      {option.scope ? (
                        <TemplateChip>
                          {option.scope === "global" ? t("templateFilter.scopeGlobal") : t("templateFilter.scopeUser")}
                        </TemplateChip>
                      ) : null}
                      {option.categoryName ? <TemplateChip>{option.categoryName}</TemplateChip> : null}
                      {option.outputCount ? <TemplateChip>{t("create.outputCount", { count: option.outputCount })}</TemplateChip> : null}
                      {option.referenceCount ? <TemplateChip>{t("create.referenceCount", { count: option.referenceCount })}</TemplateChip> : null}
                    </div>
                    <ResourceMetaBadges resource={option} className="mt-2" showReason />
                  </LayoutOptionToggle>
                );
              })}
            </div>
          </div>
          ))}
        </div>
      </AsyncContent>
    </>
  );

  const previewPanelContent = (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-zinc-950 dark:text-white">{selectedPlan.label}</h2>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:border dark:border-slate-700 dark:bg-[#151f33] dark:text-slate-300">
              {selectedPlan.badge}
            </span>
          </div>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-zinc-500 dark:text-slate-400">{selectedPlan.description}</p>
          <ResourceMetaBadges resource={selectedPlan} className="mt-2" showReason />
        </div>
        <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-slate-300">
          <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 dark:border-slate-700 dark:bg-[#151f33]">
            {t("create.nodeCount", { count: selectedPlan.previewNodes.length })}
          </span>
          <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 dark:border-slate-700 dark:bg-[#151f33]">
            {t("create.edgeCount", { count: selectedPlan.previewEdges.length })}
          </span>
        </div>
      </div>
      <WorkflowPreview plan={selectedPlan} />
    </>
  );

  return (
    <>
      <TopNav />
      <div className="pf-workspace px-4 pb-[calc(5.75rem+env(safe-area-inset-bottom))] pt-4 text-zinc-900 dark:text-slate-100 sm:px-6 md:pb-8 lg:px-8">
      <main className="mx-auto max-w-[1480px]">
        <div className="mb-5 flex items-start justify-between gap-4 border-b border-slate-200/80 pb-4 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-md bg-blue-50 text-blue-600 dark:border dark:border-violet-400/35 dark:bg-violet-500/15 dark:text-violet-100">
              <Tag size={21} />
            </div>
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400 dark:text-slate-500 md:hidden">
                Inspiration One
              </div>
              <h1 className="text-xl font-semibold text-zinc-950 dark:text-white">{t("create.title")}</h1>
              <p className="mt-1 text-sm text-zinc-500 dark:text-slate-400">{t("create.description")}</p>
            </div>
          </div>
          <ActionButton
            onClick={handleClose}
            aria-label={t("create.close")}
            preset="secondary"
            size="icon-lg"
            className="shrink-0"
            leadingIcon={<X size={18} />}
          />
        </div>

        {error ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200 md:hidden">
            {error}
          </div>
        ) : null}

        <form
          id={INSPIRATION_CREATE_FORM_ID}
          onSubmit={handleSubmit}
          className="grid min-w-0 gap-5 md:grid-cols-[minmax(0,300px)_minmax(0,1fr)] lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)]"
        >
          <div
            className={`min-w-0 content-start gap-5 md:grid ${
              mobileStep === "details" ? "hidden" : "grid"
            } order-1 md:order-none`}
          >
            <section className={`pf-panel min-w-0 p-5 ${mobileStep === "entry" ? "block" : "hidden"} md:block`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-zinc-950 dark:text-white">{t("create.initialEntry")}</h2>
                  <p className="mt-1 text-sm text-zinc-500 dark:text-slate-400 md:line-clamp-1 xl:line-clamp-2">{t("create.initialEntryDescription")}</p>
                </div>
                <span className="rounded-full bg-zinc-100 px-2 py-1 text-[11px] font-medium text-zinc-500 dark:border dark:border-slate-700 dark:bg-[#151f33] dark:text-slate-300 md:hidden">
                  1 / 3
                </span>
              </div>
              <div className="mt-4 grid gap-2">
                <label className="mb-2 block">
                  <span className="mb-2 block text-sm font-medium text-zinc-700 dark:text-slate-300">
                    {t("create.resourceGroup")} <span className="text-red-500">*</span>
                  </span>
                  <AsyncContent
                    state={generationResourceGroupsState}
                    refreshIntent="background"
                    loadingLabel={t("app.loading")}
                    skeleton={<Skeleton className="h-9 w-full" rounded="lg" />}
                    initialError={(
                      <AsyncErrorState
                        className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-100"
                        title={t("create.resourceGroupLoadFailed")}
                        retryLabel={t("common.retry")}
                        retryingLabel={t("app.loading")}
                        retrying={generationResourceGroupsState.fetch === "fetching"}
                        onRetry={() => void generationResourceGroupsQuery.refetch()}
                      />
                    )}
                    paused={(
                      <AsyncPausedState
                        title={t("app.requestPaused.title")}
                        retryLabel={t("common.retry")}
                        onRetry={() => void generationResourceGroupsQuery.refetch()}
                      />
                    )}
                    inactive={null}
                    empty={generationResourceGroupSelect}
                    refreshFeedback={
                      generationResourceGroupsState.error === "refresh" ? (
                        <div className="mt-2 text-xs text-red-600 dark:text-red-300">
                          {t("create.resourceGroupLoadFailed")}
                        </div>
                      ) : null
                    }
                  >
                    {generationResourceGroupSelect}
                  </AsyncContent>
                </label>
                {INITIAL_WORKFLOW_ENTRY_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  return (
                    <LayoutOptionToggle
                      key={option.value}
                      checked={initialWorkflowEntry === option.value}
                      layout="card"
                      selectionMode="single"
                      name="initial-workflow-entry"
                      className="w-full px-3 py-3 md:items-center md:py-2.5 xl:items-start xl:py-3"
                      onChange={(checked) => {
                        if (checked) {
                          handleInitialWorkflowEntryChange(option.value);
                        }
                      }}
                    >
                      <span className="mt-0.5 rounded-lg border border-current/20 p-2 opacity-90 md:mt-0 xl:mt-0.5">
                        <Icon size={14} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">{t(option.labelKey)}</span>
                        <span className="mt-1 block text-xs leading-5 text-current/75 md:line-clamp-1 xl:line-clamp-2">{t(option.descriptionKey)}</span>
                      </span>
                    </LayoutOptionToggle>
                  );
                })}
              </div>
            </section>

            <section className={`pf-panel min-w-0 p-4 ${mobileStep === "template" ? "block" : "hidden"} md:block`}>
              {templatePanelContent}
            </section>
          </div>

          <div
            className={`order-2 min-w-0 content-start gap-5 md:order-none md:grid xl:grid-cols-[minmax(320px,360px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(340px,380px)_minmax(0,1fr)] ${
              mobileStep === "entry" ? "hidden" : "grid"
            }`}
          >
            <section className={`pf-panel min-w-0 p-5 ${mobileStep === "details" ? "block" : "hidden"} md:block`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-zinc-950 dark:text-white">{t("create.inspirationInfo")}</h2>
                  <p className="mt-1 text-sm text-zinc-500 dark:text-slate-400">{t("create.contentDescription")}</p>
                </div>
                <span className="rounded-full bg-zinc-100 px-2 py-1 text-[11px] font-medium text-zinc-500 dark:border dark:border-slate-700 dark:bg-[#151f33] dark:text-slate-300 md:hidden">
                  2 / 3
                </span>
              </div>

              <div className="mt-5">
                <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-slate-300">
                  {t("create.inspirationName")} <span className="text-red-500">*</span>
                </label>
                <LayoutTextInput
                  type="text"
                  maxLength={60}
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setError("");
                  }}
                  size="tall"
                  placeholder={t("create.namePlaceholder")}
                />
                <div className="mt-1 text-right text-xs text-zinc-400 dark:text-slate-500">{name.length} / 60</div>
              </div>

              <div className="mt-5">
                <MarkdownEditor
                  label={t("create.longText")}
                  labelHelp={<ParameterHelpButton helpKey="inspirationContextLongText" uiType="create" />}
                  value={longText}
                  modalTitle={t("create.longText")}
                  maxLength={INSPIRATION_CONTEXT_MARKDOWN_MAX_LENGTH}
                  minRows={6}
                  required={longTextRequired}
                  onChange={(value) => {
                    setLongText(value);
                    setError("");
                  }}
                  inputAppearance={markdownInputAppearance}
                  placeholder={t("create.longTextPlaceholder")}
                  helpText={entryTextHelpKey ? t(entryTextHelpKey) : t("create.longTextHelp")}
                />
              </div>

              <div className="mt-5">
                <label className="mb-2 block text-sm font-medium text-zinc-700 dark:text-slate-300">
                  {t("create.mainImage")} {mainImageRequired ? <span className="text-red-500">*</span> : null}
                </label>
                <div className="space-y-3">
                  <div
                    className="relative mx-auto flex max-w-full items-center justify-center overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50 shadow-sm dark:border-slate-700 dark:bg-slate-950/60"
                    style={mainImagePreviewFrameStyle}
                  >
                    {mainImagePreviewUrl ? (
                      <img
                        src={mainImagePreviewUrl}
                        alt={mainImageName || t("create.mainImage")}
                        className="h-full w-full object-contain"
                        onLoad={(event) => {
                          const { naturalWidth, naturalHeight } = event.currentTarget;
                          if (naturalWidth > 0 && naturalHeight > 0) {
                            setMainImageNaturalSize({ width: naturalWidth, height: naturalHeight });
                          }
                        }}
                        onError={() => setMainImageNaturalSize(null)}
                      />
                    ) : (
                      <div className="flex h-full flex-col items-center justify-center gap-2 px-5 text-center text-zinc-500 dark:text-slate-400">
                        <ImagePlus size={28} className="opacity-70" />
                        <p className="text-sm font-semibold text-zinc-700 dark:text-slate-200">{t("create.mainImageEmpty")}</p>
                        <p className="text-xs">
                          {mainImageRequired ? t("create.uploadHint") : t("create.uploadOptionalHint")}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-slate-400">
                    <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 font-medium text-zinc-600 dark:border-slate-700 dark:bg-[#0b1220] dark:text-slate-200">
                      {mainImageSourceLabel}
                    </span>
                    {hasMainImage ? <span className="min-w-0 flex-1 truncate">{mainImageName}</span> : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <ImageDropZone
                      ariaLabel={t("create.uploadAria")}
                      className={createMainImageUploadClass}
                      activeClassName="pf-action-surface--active"
                      disabled={createInspirationMutation.isPending}
                      onFiles={handleImageFiles}
                    >
                      {({ isDragging }) => (
                        <>
                          <ImagePlus size={14} className="shrink-0 opacity-70" />
                          <span className="min-w-0 truncate">{isDragging ? t("create.uploadDrop") : mainImageUploadLabel}</span>
                        </>
                      )}
                    </ImageDropZone>
                    <ActionButton
                      onClick={() => setMainImageResourceLibraryOpen(true)}
                      preset="secondary"
                      size="sm"
                      className="flex-1 min-w-[180px]"
                      disabled={createInspirationMutation.isPending}
                    >
                      {t("create.selectMainImageFromLibrary")}
                    </ActionButton>
                    {hasMainImage ? (
                      <ActionButton
                        onClick={clearMainImage}
                        preset="danger"
                        size="sm"
                        className="flex-1 min-w-[140px]"
                        disabled={createInspirationMutation.isPending}
                      >
                        {t("create.clearMainImage")}
                      </ActionButton>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="mt-5 rounded-md border border-zinc-200 bg-zinc-50/60 p-3 dark:border-slate-700 dark:bg-[#0b1220]">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-zinc-700 dark:text-slate-300">
                      <ParameterHelpLabel
                        label={t("create.contextDocument")}
                        helpKey="inspirationContextDocument"
                        uiType="create"
                      />
                    </div>
                    <div className="mt-1 text-xs text-zinc-500 dark:text-slate-400">
                      {contextDocumentFile ? t("create.contextDocumentLockedHint") : t("create.contextDocumentHint")}
                    </div>
                  </div>
                </div>
                {contextDocumentFile ? (
                  <div className="space-y-3">
                    <div className="rounded-md border border-zinc-200 bg-white p-3 dark:border-slate-700 dark:bg-[#111b2d]">
                      <div className="flex min-w-0 items-start gap-2">
                        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-zinc-500 dark:border-slate-700 dark:bg-slate-950/45 dark:text-slate-300">
                          <FileText size={14} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-semibold text-zinc-700 dark:text-slate-100">
                            {contextDocumentFile.name}
                          </div>
                          {contextDocumentFile.type ? (
                            <div className="mt-0.5 truncate text-[11px] text-zinc-400 dark:text-slate-500">
                              {t("create.documentMimeType", { mime: contextDocumentFile.type })}
                            </div>
                          ) : null}
                          <div className="mt-1 text-[11px] leading-5 text-zinc-500 dark:text-slate-400">
                            {t("create.contextDocumentRemoveHint")}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3 dark:border-slate-800">
                        <ActionButton
                          onClick={() => setContextDocumentPreviewOpen((current) => !current)}
                          aria-pressed={contextDocumentPreviewOpen}
                          preset="secondary"
                          size="sm"
                          aria-expanded={contextDocumentPreviewOpen}
                          aria-label={contextDocumentPreviewOpen ? t("create.hideDocumentPreview") : t("create.showDocumentPreview")}
                          title={contextDocumentPreviewOpen ? t("create.hideDocumentPreview") : t("create.showDocumentPreview")}
                          leadingIcon={contextDocumentPreviewOpen ? <EyeOff size={13} /> : <Eye size={13} />}
                        >
                          {contextDocumentPreviewOpen ? t("create.hideDocumentPreview") : t("create.showDocumentPreview")}
                        </ActionButton>
                        <ActionButton
                          onClick={clearContextDocument}
                          preset="danger"
                          size="sm"
                          aria-label={t("create.clearDocument")}
                          title={t("create.clearDocument")}
                          leadingIcon={<X size={13} />}
                        >
                          {t("create.clearDocument")}
                        </ActionButton>
                      </div>
                    </div>
                    {contextDocumentPreviewOpen && (contextDocumentTextState === "idle" || contextDocumentTextState === "loading") ? (
                      <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-500 dark:border-slate-700 dark:bg-[#111b2d] dark:text-slate-400">
                        {t("create.documentReading")}
                      </div>
                    ) : null}
                    {contextDocumentPreviewOpen && contextDocumentTextState === "failed" ? (
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-100">
                        {t("create.documentPreviewUnavailable")}
                      </div>
                    ) : null}
                    {contextDocumentPreviewOpen && contextDocumentTextState === "ready" ? (
                      <MarkdownEditor
                        label={t("create.documentPreview")}
                        value={contextDocumentText}
                        modalTitle={contextDocumentFile.name}
                        helpText={t("create.documentPreviewHelp")}
                        minRows={4}
                        inputAppearance={markdownInputAppearance}
                        readOnly
                      />
                    ) : null}
                  </div>
                ) : (
                  <ImageDropZone
                    accept=".txt,.md,.csv,.json,text/plain,text/markdown,text/csv,application/json"
                    ariaLabel={t("create.contextDocument")}
                    className={createDocumentUploadClass}
                    activeClassName="pf-action-surface--active"
                    onFiles={handleDocumentFiles}
                  >
                    {({ isDragging }) => (
                      <span className="inline-flex items-center gap-2">
                        <FileText size={14} />
                        {isDragging ? t("create.documentDrop") : t("create.documentUpload")}
                      </span>
                    )}
                  </ImageDropZone>
                )}
              </div>

              <div className="mt-5 rounded-md border border-zinc-200 bg-zinc-50/60 p-3 dark:border-slate-700 dark:bg-[#0b1220]">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-zinc-700 dark:text-slate-300">
                      <ParameterHelpLabel
                        label={t("create.dynamicFields")}
                        helpKey="inspirationContextDynamicFields"
                        uiType="create"
                      />
                    </div>
                    <div className="mt-1 text-xs text-zinc-500 dark:text-slate-400">
                      {t("create.dynamicFieldsHint")}
                    </div>
                  </div>
                  <ActionButton
                    onClick={addDynamicField}
                    preset="secondary"
                    size="icon-sm"
                    aria-label={t("create.addDynamicField")}
                    title={t("create.addDynamicField")}
                    leadingIcon={<Plus size={14} />}
                  />
                </div>
                {dynamicFields.length ? (
                  <div className="space-y-2">
                    {dynamicFields.map((field) => (
                      <div key={field.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
                        <LayoutTextInput
                          value={field.key}
                          onChange={(event) => updateDynamicField(field.id, { key: event.target.value })}
                          size="compact"
                          className="min-w-0"
                          placeholder={t("create.dynamicKey")}
                        />
                        <LayoutTextInput
                          value={field.value}
                          onChange={(event) => updateDynamicField(field.id, { value: event.target.value })}
                          size="compact"
                          className="min-w-0"
                          placeholder={t("create.dynamicValue")}
                        />
                        <ActionButton
                          onClick={() => removeDynamicField(field.id)}
                          preset="danger"
                          size="icon-md"
                          aria-label={t("create.removeDynamicField")}
                          title={t("create.removeDynamicField")}
                          leadingIcon={<Trash2 size={13} />}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed border-zinc-300 px-3 py-3 text-xs text-zinc-500 dark:border-slate-700 dark:text-slate-400">
                    {t("create.noDynamicFields")}
                  </div>
                )}
              </div>

              {error ? <div className="mt-4 hidden text-sm text-red-600 dark:text-red-300 md:block">{error}</div> : null}

              <div className="mt-6 hidden gap-3 md:flex">
                <ActionButton
                  onClick={handleClose}
                  preset="secondary"
                  size="lg"
                  className="flex-1"
                >
                  {t("create.cancel")}
                </ActionButton>
                <ActionButton
                  type="submit"
                  disabled={createInspirationMutation.isPending}
                  loading={createInspirationMutation.isPending}
                  preset="primary"
                  size="lg"
                  className="flex-1"
                >
                  {t("create.submit")}
                </ActionButton>
              </div>
            </section>

            <section className={`pf-panel min-w-0 p-4 ${mobileStep === "template" ? "block" : "hidden"} md:block xl:sticky xl:top-4 xl:self-start`}>
              {previewPanelContent}
            </section>
          </div>
        </form>
      </main>

      <div className="fixed inset-x-0 z-40 px-3 md:hidden" style={{ bottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}>
        <div className="mx-auto flex max-w-2xl items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_-6px_18px_rgba(15,23,42,0.12)] dark:border-slate-700 dark:bg-slate-950 dark:shadow-[0_-12px_28px_rgba(0,0,0,0.30)]">
          {mobileStep !== "entry" ? (
            <ActionButton
              onClick={() => {
                setError("");
                setMobileStep(mobileStep === "template" ? "details" : "entry");
              }}
              preset="secondary"
              size="lg"
            >
              {t("create.mobileBack")}
            </ActionButton>
          ) : null}
          <div className="min-w-0 flex-1 px-1">
            <div className="truncate text-[11px] font-medium text-slate-400 dark:text-slate-500">
              {mobileStep === "entry"
                ? t("create.mobileStep.entry")
                : mobileStep === "details"
                  ? t("create.mobileStep.details")
                  : t("create.mobileStep.template")}
            </div>
            <div className="mt-0.5 truncate text-xs font-semibold text-slate-700 dark:text-slate-200">
              {mobileStep === "template" ? selectedPlan.label : t(INITIAL_WORKFLOW_ENTRY_OPTIONS.find((option) => option.value === initialWorkflowEntry)?.labelKey ?? "create.entry.image")}
            </div>
          </div>
          {mobileStep === "entry" ? (
            <ActionButton
              key="mobile-entry-next"
              onClick={() => {
                setError("");
                setMobileStep("details");
              }}
              preset="primary"
              size="lg"
              trailingIcon={<ChevronRight size={16} />}
            >
              {t("create.mobileNext")}
            </ActionButton>
          ) : mobileStep === "details" ? (
            <ActionButton
              key="mobile-details-next"
              onClick={handleMobileDetailsNext}
              preset="primary"
              size="lg"
              leadingIcon={<Eye size={16} />}
            >
              {t("create.mobilePreview")}
            </ActionButton>
          ) : (
            <ActionButton
              key="mobile-submit"
              type="submit"
              form={INSPIRATION_CREATE_FORM_ID}
              disabled={createInspirationMutation.isPending}
              loading={createInspirationMutation.isPending}
              preset="primary"
              size="lg"
            >
              {t("create.submitShort")}
            </ActionButton>
          )}
        </div>
      </div>
      <ResourceLibraryModal
        open={mainImageResourceLibraryOpen}
        onClose={() => setMainImageResourceLibraryOpen(false)}
        canRead
        appearance={actionAppearance}
        onSelectAsset={handleSelectMainImageAsset}
        selectLabel={t("create.selectMainImageFromLibrary")}
        selectDisabled={createInspirationMutation.isPending}
      />
      </div>
    </>
  );
}

function TemplateChip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:border-slate-700 dark:bg-[#0b1220] dark:text-slate-300">
      {children}
    </span>
  );
}

function WorkflowPreview({ plan }: { plan: CanvasPlanOption }) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  const nodeById = new Map(plan.previewNodes.map((node) => [node.id, node]));
  const width = previewWidth(plan);
  const scale = viewportWidth > 0 ? Math.min(1, viewportWidth / width) : 1;
  const frameHeight = Math.max(320, Math.ceil(PREVIEW_HEIGHT * scale));
  const portUsage = plan.previewEdges.reduce<PreviewPortUsage>(
    (usage, edge) => {
      usage.outputs.add(edge.from);
      usage.inputs.add(edge.to);
      return usage;
    },
    { inputs: new Set<string>(), outputs: new Set<string>() },
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const updateWidth = () => setViewportWidth(viewport.clientWidth);
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={viewportRef}
      className="relative overflow-hidden rounded-md border border-zinc-100 bg-zinc-50 dark:border-slate-700/80 dark:bg-[#0b1220]"
      style={{ height: frameHeight }}
    >
      <div
        className="relative h-full bg-[radial-gradient(circle_at_1px_1px,rgb(212_212_216)_1px,transparent_0)] bg-[length:16px_16px] dark:bg-[radial-gradient(circle_at_1px_1px,rgba(148,163,184,0.2)_1px,transparent_0)]"
        style={{ width, height: PREVIEW_HEIGHT, transform: `scale(${scale})`, transformOrigin: "top left" }}
      >
        <svg className="pointer-events-none absolute inset-0 z-0 h-full w-full" viewBox={`0 0 ${width} ${PREVIEW_HEIGHT}`} aria-hidden="true">
          {plan.previewEdges.map((edge) => {
            const from = nodeById.get(edge.from);
            const to = nodeById.get(edge.to);
            if (!from || !to) {
              return null;
            }
            const fromWidth = from.width ?? PREVIEW_NODE_WIDTH;
            const startX = from.x + fromWidth;
            const startY = from.y + NODE_HEIGHT / 2;
            const endX = to.x;
            const endY = to.y + NODE_HEIGHT / 2;
            const midX = startX + Math.max((endX - startX) / 2, 36);
            return (
              <path
                key={`${edge.from}-${edge.to}`}
                d={`M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`}
                fill="none"
                className="stroke-indigo-600 dark:stroke-violet-400"
                strokeLinecap="round"
                strokeOpacity="0.75"
                strokeWidth="1.8"
              />
            );
          })}
        </svg>
        {plan.previewNodes.map((node) => (
          <PreviewNodeCard key={node.id} node={node} portUsage={portUsage} />
        ))}
      </div>
    </div>
  );
}

function PreviewNodeCard({ node, portUsage }: { node: PreviewNode; portUsage: PreviewPortUsage }) {
  const { t } = useI18n();
  const width = node.width ?? PREVIEW_NODE_WIDTH;
  const status = node.tone === "copy" || node.tone === "image" ? t("create.pending") : t("create.available");
  const showInputPort = portUsage.inputs.has(node.id);
  const showOutputPort = portUsage.outputs.has(node.id);
  return (
    <div
      className={`absolute z-10 rounded-lg border px-3 py-3 shadow-sm backdrop-blur dark:shadow-slate-950/25 ${toneClasses[node.tone ?? "input"]}`}
      style={{ left: node.x, top: node.y, width, height: NODE_HEIGHT }}
    >
      {showInputPort ? (
        <span
          aria-hidden="true"
          className="absolute left-[-5px] top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border pf-hairline-strong bg-white shadow-sm dark:border-slate-500 dark:bg-[#0b1220]"
        />
      ) : null}
      {showOutputPort ? (
        <span
          aria-hidden="true"
          className="absolute right-[-6px] top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-indigo-500 bg-white shadow-sm dark:border-violet-400 dark:bg-[#0b1220]"
        />
      ) : null}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{node.title}</div>
          <div className="mt-1 truncate text-xs opacity-70">{node.subtitle}</div>
        </div>
        <span className="shrink-0 rounded-full bg-white/70 px-2 py-0.5 text-[10px] text-zinc-500 dark:bg-[#0b1220]/80 dark:text-slate-300">{status}</span>
      </div>
      <div className="mt-3 flex gap-1.5">
        <span className="h-1.5 w-7 rounded-full bg-current opacity-20" />
        <span className="h-1.5 w-4 rounded-full bg-current opacity-20" />
      </div>
    </div>
  );
}
