import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Clock3,
  Download,
  Eye,
  EyeOff,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  ImagePlus,
  Loader2,
  Maximize2,
  OctagonX,
  Play,
  Presentation,
  Plus,
  RefreshCcw,
  Save,
  Settings2,
  Trash2,
  Upload,
  X,
  XCircle,
  Sparkles,
  Wand2,
} from "lucide-react";

import {
  actionButtonClassNameForAppearance,
  actionButtonComponentForAppearance,
  actionSurfaceClassNameForAppearance,
  type LayoutActionAppearance,
} from "../../components/layoutActionButtons";
import type { BaseActionButtonProps } from "../../components/actionButtonShared";
import { ClipboardImageButton } from "../../components/ClipboardImageButton";
import {
  ClassicCheckbox,
  ClassicSelectField,
  ClassicTextInput,
  ClassicTextarea,
} from "../../components/classicInputs";
import { ImageDropZone } from "../../components/ImageDropZone";
import { ImageGenerationSettingsPanel } from "../../components/ImageGenerationSettingsPanel";
import { ImageGenerationSettingsTabs, type ImageGenerationSettingsTab } from "../../components/ImageGenerationSettingsTabs";
import { ImageSizePicker } from "../../components/ImageSizePicker";
import { ImageToolControls } from "../../components/ImageToolControls";
import { MarkdownEditor } from "../../components/MarkdownEditor";
import { MediaPreviewTrigger } from "../../components/MediaPreviewTrigger";
import { ModalShell } from "../../components/ModalShell";
import { AsyncContent, AsyncErrorState, AsyncPausedState } from "../../components/loading/AsyncContent";
import { Skeleton } from "../../components/loading/Skeleton";
import { ParameterHelpButton } from "../../components/ParameterHelp";
import { PromptPreviewDialog, type PromptPreview } from "../../components/PromptPreviewDialog";
import {
  WorkspaceCheckbox,
  WorkspaceSelectField,
  WorkspaceTextInput,
  WorkspaceTextarea,
} from "../../components/workspaceInputs";
import { api, ApiError } from "../../lib/api";
import { asyncViewStateFromQuery } from "../../lib/asyncViewState";
import { exportDeckAsPptx } from "../../lib/deckPptxExport";
import { sanitizeFilenamePart, toImageUrl, type DownloadableImage } from "../../lib/image-downloads";
import {
  generationConfigOptionLabel,
  generationConfigOptionsForPurpose,
} from "../../lib/generationConfigs";
import {
  imageSizeValueFromDimensions,
  parseImageSizeValue,
  type ImageSizeOption,
} from "../../lib/imageSizes";
import { formatDateTime, formatPrice } from "../../lib/format";
import type { TranslationKey, TranslationParams } from "../../lib/i18n";
import { INSPIRATION_CONTEXT_MARKDOWN_MAX_LENGTH } from "../../lib/markdown";
import type { ParameterHelpKey } from "../../lib/parameterHelp";
import { useI18n } from "../../lib/preferences";
import type {
  CopyBlock,
  CopyPayloadV2,
  CopySection,
  Deck,
  DeckSlide,
  DeckSlideStatus,
  DeckSourceItem,
  DeckSourceManifest,
  GenerationConfigOption,
  GenerationResourceGroup,
  ImageToolOptionKey,
  InspirationDetail,
  InspirationInitialWorkflowEntry,
  InspirationWorkflow,
  SourceAsset,
  WorkflowNode,
} from "../../lib/types";
import { IMAGE_PREVIEW_SURFACE_CLASS_NAME } from "./constants";
import { buildDeckOutlineSlideContext, partitionDeckSources } from "./deckSourcePlanning";
import { readDeckNodeCardState } from "./deckNodeCardState";
import { DECK_STATUS_LABEL_KEYS } from "./deckStatus";
import { orderDeckSourcesForDraft } from "./deckSourceOrder";
import { describeDeckGroupId, readDeckSlideSourcePlan } from "./deckSlideManifest";
import { DownloadLink } from "./ImageDownloadComponents";
import { getNodeImageDownload, getNodeImageSourceAsset } from "./imageDownloads";
import { workflowNodeDisplayLabel, workflowNodeDisplayTitle } from "./nodeDisplay";
import type { NodeConfigDraft, SaveStatus } from "./types";
import {
  type WorkflowNodeRunActionState,
  getWorkflowNodeActiveRunContext,
  outputText,
  statusClass,
  workflowNodeActivityText,
  workflowRetryHintLabel,
  workflowNodeStatusLabel,
  workflowRunQueueText,
} from "./utils";
import { TextArea as BaseTextArea } from "./TextArea";

type TFunction = (key: TranslationKey, params?: TranslationParams) => string;

const SAVE_STATUS_LABEL_KEYS: Record<SaveStatus, TranslationKey> = {
  idle: "detail.inspector.saveIdle",
  saving: "detail.inspector.saving",
  saved: "detail.inspector.saved",
  failed: "detail.inspector.saveFailed",
};

const SAVE_STATUS_CLASS_NAMES: Record<SaveStatus, string> = {
  idle: "pf-hairline pf-surface-soft pf-ink-muted dark:border-[color:var(--pf-border)] dark:bg-[#0b1220] dark:text-[color:var(--pf-muted)]",
  saving: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/35 dark:bg-blue-500/12 dark:text-blue-200",
  saved: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/12 dark:text-emerald-200",
  failed: "border-red-200 bg-red-50 text-red-700 dark:border-red-400/35 dark:bg-red-500/12 dark:text-red-200",
};

const REFERENCE_ROLE_OPTIONS: Array<{ value: string; labelKey: TranslationKey }> = [
  { value: "reference", labelKey: "detail.referenceRole.reference" },
  { value: "style", labelKey: "detail.referenceRole.style" },
  { value: "inspiration_angle", labelKey: "detail.referenceRole.inspirationAngle" },
  { value: "main_image", labelKey: "detail.referenceRole.mainImage" },
  { value: "sku_image", labelKey: "detail.referenceRole.skuImage" },
  { value: "model_image", labelKey: "detail.referenceRole.modelImage" },
  { value: "scene_image", labelKey: "detail.referenceRole.sceneImage" },
  { value: "detail_image", labelKey: "detail.referenceRole.detailImage" },
  { value: "campaign_image", labelKey: "detail.referenceRole.campaignImage" },
  { value: "background", labelKey: "detail.referenceRole.background" },
];

const INSPIRATION_CONTEXT_ENTRY_OPTIONS: Array<{ value: InspirationInitialWorkflowEntry; labelKey: TranslationKey }> = [
  { value: "image", labelKey: "detail.inspector.entryType.image" },
  { value: "copy", labelKey: "detail.inspector.entryType.copy" },
  { value: "tail", labelKey: "detail.inspector.entryType.tail" },
  { value: "blank", labelKey: "detail.inspector.entryType.blank" },
];

const InspectorInputLayoutContext = createContext(false);

function useInspectorWorkspaceSubpage() {
  return useContext(InspectorInputLayoutContext);
}

function LayoutTextInput(props: ComponentProps<typeof WorkspaceTextInput>) {
  const workspaceSubpage = useInspectorWorkspaceSubpage();
  return workspaceSubpage ? <WorkspaceTextInput {...props} /> : <ClassicTextInput {...props} />;
}

function LayoutTextarea(props: ComponentProps<typeof WorkspaceTextarea>) {
  const workspaceSubpage = useInspectorWorkspaceSubpage();
  return workspaceSubpage ? <WorkspaceTextarea {...props} /> : <ClassicTextarea {...props} />;
}

function LayoutSelectField(props: ComponentProps<typeof WorkspaceSelectField>) {
  const workspaceSubpage = useInspectorWorkspaceSubpage();
  return workspaceSubpage ? <WorkspaceSelectField {...props} /> : <ClassicSelectField {...props} />;
}

function LayoutCheckbox(props: ComponentProps<typeof WorkspaceCheckbox>) {
  const workspaceSubpage = useInspectorWorkspaceSubpage();
  return workspaceSubpage ? <WorkspaceCheckbox {...props} /> : <ClassicCheckbox {...props} />;
}

function TextArea(props: ComponentProps<typeof BaseTextArea>) {
  const workspaceSubpage = useInspectorWorkspaceSubpage();
  return <BaseTextArea {...props} workspaceSubpage={workspaceSubpage} />;
}

function layoutInputAppearance(workspaceSubpage: boolean) {
  return workspaceSubpage ? "workspace" : "classic";
}

function useInspectorActionAppearance(): LayoutActionAppearance {
  return useInspectorWorkspaceSubpage() ? "workspace" : "classic";
}

function ActionButton(props: BaseActionButtonProps) {
  const appearance = useInspectorActionAppearance();
  const ButtonComponent = actionButtonComponentForAppearance(appearance);
  return <ButtonComponent {...props} />;
}

function inspectorAddCopyFieldButtonClassName(appearance: LayoutActionAppearance) {
  return actionButtonClassNameForAppearance(appearance, {
    preset: "secondary",
    size: "sm",
    className: "copy-add-field gap-1 text-[11px]",
  });
}

function inspectorSecondaryFullButtonClassName(appearance: LayoutActionAppearance) {
  return actionButtonClassNameForAppearance(appearance, {
    preset: "secondary",
    size: "md",
    fullWidth: true,
  });
}

function inspectorDocumentDropzoneClassName(appearance: LayoutActionAppearance) {
  return actionSurfaceClassNameForAppearance(appearance, {
    preset: "secondary",
    focusWithin: true,
    className: "pf-action-surface--dashed flex cursor-pointer items-center justify-center px-3 py-4 text-xs font-medium",
  });
}

function inspectorImageDropzoneClassName(appearance: LayoutActionAppearance) {
  return actionSurfaceClassNameForAppearance(appearance, {
    preset: "secondary",
    focusWithin: true,
    className: "pf-action-surface--dashed flex cursor-pointer items-center justify-center px-3 py-6 text-xs font-medium",
  });
}

function referenceRolePresetValue(role: string): string {
  return REFERENCE_ROLE_OPTIONS.some((option) => option.value === role) ? role : "__custom__";
}

function resourceGroupOptionLabel(group: GenerationResourceGroup, t: TFunction): string {
  const markers = [!group.enabled ? t("detail.inspector.resourceGroupDisabled") : ""].filter(Boolean);
  const suffix = markers.length ? ` (${markers.join(" · ")})` : "";
  return `${group.name}${suffix}`;
}

function FieldLabel({
  label,
  helpKey,
  className = "mb-1.5 text-[10px] font-semibold uppercase tracking-widest pf-ink-muted dark:text-[color:var(--pf-muted)]",
}: {
  label: string;
  helpKey?: ParameterHelpKey;
  className?: string;
}) {
  return (
    <span className={`${className} inline-flex items-center gap-1`}>
      <span>{label}</span>
      {helpKey ? <ParameterHelpButton helpKey={helpKey} uiType="inspirationDetail" /> : null}
    </span>
  );
}

function InspectorTextArea({
  label,
  value,
  onChange,
  minRows = 2,
  maxRows,
  placeholder,
  onBlur,
  helpKey,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  minRows?: number;
  maxRows?: number;
  placeholder?: string;
  onBlur?: () => void;
  helpKey?: ParameterHelpKey;
}) {
  const textareaId = useId();

  return (
    <div className="block">
      <div className="mb-1.5 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest pf-ink-muted dark:text-[color:var(--pf-muted)]">
        <label htmlFor={textareaId}>{label}</label>
        {helpKey ? <ParameterHelpButton helpKey={helpKey} uiType="inspirationDetail" /> : null}
      </div>
      <LayoutTextarea
        id={textareaId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        size="compact"
        autosize
        minRows={minRows}
        maxRows={maxRows}
      />
    </div>
  );
}

interface InspectorPanelProps {
  inspiration: InspirationDetail;
  sourceImage: DownloadableImage | null;
  workflow: InspirationWorkflow | null;
  node: WorkflowNode;
  draft: NodeConfigDraft;
  imageSizeOptions: ImageSizeOption[];
  imageGenerationMaxDimension: number;
  imageToolAllowedFields: readonly ImageToolOptionKey[];
  tailSplitterMaxItems: number;
  resourceGroups: GenerationResourceGroup[];
  generationConfigOptions: GenerationConfigOption[];
  onDraftChange: (draft: NodeConfigDraft) => void;
  onFlushDraft?: () => Promise<void>;
  onPreviewImage: (image: DownloadableImage) => void;
  onRun: () => void;
  onCancelRun: (() => void) | null;
  onUploadImage: (file: File) => void;
  onUploadDocument: (file: File) => void;
  onClipboardError?: (message: string) => void;
  onClearImage: () => void;
  onOpenResourceLibrary?: () => void;
  resourceLibraryDisabledTitle?: string | null;
  onSaveSourceAssetToResourceLibrary?: (asset: SourceAsset) => void;
  resourceLibrarySaveDisabledTitle?: string | null;
  savedResourceLibrarySourceAssetIds?: ReadonlySet<string>;
  savingResourceLibrarySourceId?: string | null;
  onDelete: () => void;
  deleteDisabled?: boolean;
  deleteTitle?: string;
  onCreateDeckFromTail?: (tailNode: WorkflowNode) => void;
  createDeckPending?: boolean;
  busy: boolean;
  cancelBusy: boolean;
  runActionState: WorkflowNodeRunActionState;
  saveStatus: SaveStatus;
  deckEditorOpen?: boolean;
  onOpenDeckEditor?: () => void;
  onCloseDeckEditor?: () => void;
  workspaceSubpage?: boolean;
}

export function InspectorPanel({
  inspiration,
  sourceImage,
  workflow,
  node,
  draft,
  imageSizeOptions,
  imageGenerationMaxDimension,
  imageToolAllowedFields,
  tailSplitterMaxItems,
  resourceGroups,
  generationConfigOptions,
  onDraftChange,
  onFlushDraft,
  onPreviewImage,
  onRun,
  onCancelRun,
  onUploadImage,
  onUploadDocument,
  onClipboardError,
  onClearImage,
  onOpenResourceLibrary,
  resourceLibraryDisabledTitle = null,
  onSaveSourceAssetToResourceLibrary,
  resourceLibrarySaveDisabledTitle = null,
  savedResourceLibrarySourceAssetIds,
  savingResourceLibrarySourceId = null,
  onDelete,
  deleteDisabled = false,
  deleteTitle,
  onCreateDeckFromTail,
  createDeckPending = false,
  busy,
  cancelBusy,
  runActionState,
  saveStatus,
  deckEditorOpen = false,
  onOpenDeckEditor,
  onCloseDeckEditor,
  workspaceSubpage = false,
}: InspectorPanelProps) {
  const { t } = useI18n();
  const actionAppearance: LayoutActionAppearance = workspaceSubpage ? "workspace" : "classic";
  const [promptPreview, setPromptPreview] = useState<PromptPreview | null>(null);
  const icon = {
    inspiration_context: FileText,
    reference_image: ImagePlus,
    copy_generation: FileText,
    image_generation: ImageIcon,
    image_enhance: ImageIcon,
    tail_splitter: Sparkles,
    deck_generation: Presentation,
  }[node.node_type];
  const InspectorIcon = icon;
  const displayTitle = workflowNodeDisplayTitle({ ...node, title: draft.title || node.title }, t);
  const displayLabel = workflowNodeDisplayLabel(node, t);
  const showRunAction = node.node_type !== "inspiration_context" && node.node_type !== "deck_generation";
  const showDeleteAction = node.node_type !== "inspiration_context";
  const showActionRow = showRunAction || Boolean(onCancelRun) || showDeleteAction;
  const actionGridColumns = showRunAction && onCancelRun ? "grid-cols-2" : "grid-cols-1";
  const deleteActionDisabled = busy || deleteDisabled;
  const deleteActionTitle = deleteTitle ?? t("detail.delete");
  const downstreamReferenceCount =
    node.node_type === "image_generation" || node.node_type === "image_enhance"
      ? new Set(
          workflow?.edges
            .filter((edge) => {
              if (edge.source_node_id !== node.id) {
                return false;
              }
              const target = workflow.nodes.find(
                (item) => item.id === edge.target_node_id,
              );
              return target?.node_type === "reference_image";
            })
            .map((edge) => edge.target_node_id) ?? [],
        ).size
      : 0;
  const hasReferenceImage = Boolean(
    node.node_type === "reference_image" &&
      Array.isArray(node.output_json?.source_asset_ids) &&
      node.output_json.source_asset_ids.length,
  );
  const referenceImage = node.node_type === "reference_image" ? getNodeImageDownload(node, inspiration, t) : null;
  const nodeImageSourceAsset = getNodeImageSourceAsset(node, inspiration);
  const nodeImageSavedToResourceLibrary = nodeImageSourceAsset
    ? (savedResourceLibrarySourceAssetIds?.has(nodeImageSourceAsset.id) ?? false)
    : false;
  const nodeImageSaveBusy = Boolean(nodeImageSourceAsset && savingResourceLibrarySourceId === nodeImageSourceAsset.id);
  const activeRunContext = getWorkflowNodeActiveRunContext(workflow, node);
  const activeRunQueueText = activeRunContext ? workflowRunQueueText(activeRunContext.run, t) : "";
  const activeRunNodeText = workflowNodeActivityText(
    { ...node, status: activeRunContext?.nodeRun.status ?? node.status },
    t,
  );
  const showActiveRunIndicator =
    showRunAction &&
    runActionState.disabled &&
    runActionState.pending &&
    (node.status === "queued" || node.status === "running");
  const textGenerationConfigOptions = generationConfigOptionsForPurpose(
    generationConfigOptions,
    "text",
    draft.resourceGroupId,
  );
  const imageGenerationConfigOptions = generationConfigOptionsForPurpose(
    generationConfigOptions,
    "image",
    draft.resourceGroupId,
  );

  return (
    <InspectorInputLayoutContext.Provider value={workspaceSubpage}>
      <div className="space-y-3">
      <section className="config-bubble rounded-2xl p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <span className="rounded-xl border border-indigo-100 bg-indigo-50 p-2 text-indigo-700 dark:border-violet-400/35 dark:bg-violet-500/15 dark:text-violet-100">
            <InspectorIcon size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold pf-ink dark:text-[#fff]">
              {displayTitle}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <span className="rounded-full border pf-hairline pf-surface-soft px-2 py-0.5 text-[10px] font-medium pf-ink-muted dark:border-[color:var(--pf-border)] dark:bg-[#0b1220] dark:text-[color:var(--pf-muted)]">
                {displayLabel}
              </span>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusClass(node.status)}`}
              >
                {node.status === "running" || node.status === "queued" ? (
                  <Loader2 size={11} className="mr-1 animate-spin" />
                ) : node.status === "failed" ? (
                  <XCircle size={11} className="mr-1" />
                ) : node.status === "succeeded" ? (
                  <CheckCircle2 size={11} className="mr-1" />
                ) : (
                  <Clock3 size={11} className="mr-1" />
                )}
                {workflowNodeStatusLabel(node, t)}
              </span>
              <span
                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${SAVE_STATUS_CLASS_NAMES[saveStatus]}`}
              >
                {saveStatus === "saving" ? (
                  <Loader2 size={11} className="mr-1 animate-spin" />
                ) : saveStatus === "saved" ? (
                  <CheckCircle2 size={11} className="mr-1" />
                ) : saveStatus === "failed" ? (
                  <XCircle size={11} className="mr-1" />
                ) : null}
                {t(SAVE_STATUS_LABEL_KEYS[saveStatus])}
              </span>
            </div>
            {node.last_run_at ? (
              <div className="mt-2 text-[11px] pf-ink-muted dark:text-[color:var(--pf-muted)]">
                {t("detail.inspector.lastRun", { time: formatDateTime(node.last_run_at) })}
              </div>
            ) : null}
          </div>
        </div>

        {activeRunContext ? (
          <div className="mt-4 overflow-hidden rounded-2xl border border-blue-300/70 bg-blue-50/95 text-blue-950 shadow-[0_14px_28px_rgba(37,99,235,0.12)] dark:border-sky-300/45 dark:bg-sky-400/15 dark:text-[#fff] dark:shadow-[0_18px_36px_rgba(56,189,248,0.12)]">
            <div className="h-1 bg-gradient-to-r from-blue-600 via-cyan-400 to-blue-600" />
            <div className="flex items-start gap-3 px-3 py-3">
              <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[#fff] shadow-lg shadow-blue-500/25 dark:bg-sky-300 dark:text-[color:var(--pf-text)] dark:shadow-sky-300/20">
                <Loader2 size={15} className="animate-spin" />
              </span>
              <div className="min-w-0 flex-1 text-xs leading-5">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm font-semibold">
                    {activeRunContext.nodeRun.status === "queued"
                      ? t("detail.inspector.activeRunQueued")
                      : t("detail.inspector.activeRunRunning")}
                  </div>
                  <span className="rounded-full border border-blue-300/70 bg-[rgba(255,255,255,0.75)] px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:border-sky-200/35 dark:bg-[rgba(255,255,255,0.1)] dark:text-sky-100">
                    {workflowNodeStatusLabel(
                      { ...node, status: activeRunContext.nodeRun.status },
                      t,
                    )}
                  </span>
                </div>
                {activeRunNodeText ? (
                  <div className="mt-1 text-blue-800/85 dark:text-sky-50/80">{activeRunNodeText}</div>
                ) : null}
                {activeRunQueueText ? (
                  <div className="mt-1 text-blue-700/75 dark:text-sky-100/70">{activeRunQueueText}</div>
                ) : null}
                <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-blue-700/65 dark:text-sky-100/60">
                  <span>{t("detail.nodeRunStarted", { time: formatDateTime(activeRunContext.nodeRun.started_at) })}</span>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {showActionRow ? (
          <div className={`mt-4 grid gap-2 ${actionGridColumns}`}>
            {showActiveRunIndicator ? (
              <div
                role="status"
                aria-live="polite"
                className="inline-flex min-h-10 items-center justify-center rounded-xl border border-blue-300/70 bg-blue-50 px-3 py-2.5 text-xs font-semibold text-blue-700 shadow-sm dark:border-sky-300/40 dark:bg-sky-400/15 dark:text-sky-100"
                title={runActionState.title}
              >
                <Loader2 size={13} className="mr-1.5 animate-spin" />
                {runActionState.label}
              </div>
            ) : showRunAction ? (
              <ActionButton
                onClick={onRun}
                disabled={runActionState.disabled}
                preset="primary"
                size="md"
                title={runActionState.title}
                loading={runActionState.pending}
                leadingIcon={<Play size={13} />}
              >
                {runActionState.label}
              </ActionButton>
            ) : null}
            {onCancelRun ? (
              <ActionButton
                onClick={onCancelRun}
                disabled={cancelBusy}
                preset="danger"
                size="md"
                title={t("detail.inspector.cancelCurrentRun")}
                loading={cancelBusy}
                leadingIcon={<OctagonX size={13} />}
              >
                {t("detail.cancel")}
              </ActionButton>
            ) : null}
            {showDeleteAction ? (
              <ActionButton
                onClick={onDelete}
                disabled={deleteActionDisabled}
                title={deleteActionTitle}
                preset="danger"
                size="md"
                className={showActiveRunIndicator && onCancelRun ? "col-span-2" : ""}
                leadingIcon={<Trash2 size={13} />}
              >
                {t("detail.delete")}
              </ActionButton>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="config-bubble rounded-2xl p-4 shadow-sm">
        <fieldset disabled={busy} className="min-w-0">
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-widest pf-ink-muted dark:text-[color:var(--pf-muted)]">
            {t("detail.inspector.config")}
          </div>
          <label className="mb-3 block">
            <FieldLabel label={t("detail.inspector.nodeName")} />
            <LayoutTextInput
              value={draft.title}
              onChange={(event) =>
                onDraftChange({ ...draft, title: event.target.value })
              }
              size="default"
            />
          </label>
          <div className="mb-3 rounded-md border pf-hairline pf-surface-soft px-3 py-2 text-xs leading-5 pf-ink-muted dark:border-[color:var(--pf-border)] dark:bg-[#0b1220] dark:text-[color:var(--pf-muted)]">
            {node.node_type === "image_generation"
              ? t("detail.inspector.description.imageGeneration")
              : node.node_type === "image_enhance"
                ? t("detail.inspector.description.imageEnhance")
              : node.node_type === "reference_image"
                ? t("detail.inspector.description.referenceImage")
                : node.node_type === "copy_generation"
                  ? t("detail.inspector.description.copyGeneration")
                  : node.node_type === "tail_splitter"
                    ? t("detail.inspector.description.tailSplitter")
                    : node.node_type === "deck_generation"
                      ? t("detail.inspector.description.deckGeneration")
                      : t("detail.inspector.description.inspirationContext")}
          </div>

        {node.node_type === "inspiration_context" ? (
          <InspirationContextInspector
            inspiration={inspiration}
            sourceImage={getNodeImageDownload(node, inspiration, t) ?? sourceImage}
            draft={draft}
            onDraftChange={onDraftChange}
            onPreviewImage={onPreviewImage}
            onUploadImage={onUploadImage}
            onUploadDocument={onUploadDocument}
            onClipboardError={onClipboardError}
            sourceAsset={nodeImageSourceAsset}
            onSaveSourceAssetToResourceLibrary={onSaveSourceAssetToResourceLibrary}
            resourceLibrarySaveDisabledTitle={resourceLibrarySaveDisabledTitle}
            savedToResourceLibrary={nodeImageSavedToResourceLibrary}
            savingToResourceLibrary={nodeImageSaveBusy}
            busy={busy}
            t={t}
          />
        ) : null}
        {node.node_type === "reference_image" ? (
          <ReferenceImageInspector
            draft={draft}
            onDraftChange={onDraftChange}
            onUploadImage={onUploadImage}
            onClipboardError={onClipboardError}
            onClearImage={onClearImage}
            onOpenResourceLibrary={onOpenResourceLibrary}
            resourceLibraryDisabledTitle={resourceLibraryDisabledTitle}
            busy={busy}
            hasImage={hasReferenceImage}
            image={referenceImage}
            sourceAsset={nodeImageSourceAsset}
            onSaveSourceAssetToResourceLibrary={onSaveSourceAssetToResourceLibrary}
            resourceLibrarySaveDisabledTitle={resourceLibrarySaveDisabledTitle}
            savedToResourceLibrary={nodeImageSavedToResourceLibrary}
            savingToResourceLibrary={nodeImageSaveBusy}
            onPreviewImage={onPreviewImage}
            t={t}
          />
        ) : null}
        {node.node_type === "copy_generation" ? (
          <CopyNodeInspector
            node={node}
            draft={draft}
            resourceGroups={resourceGroups}
            generationConfigOptions={textGenerationConfigOptions}
            onDraftChange={onDraftChange}
            t={t}
          />
        ) : null}
        {node.node_type === "tail_splitter" ? (
          <TailSplitterInspector
            node={node}
            draft={draft}
            tailSplitterMaxItems={tailSplitterMaxItems}
            resourceGroups={resourceGroups}
            generationConfigOptions={textGenerationConfigOptions}
            onDraftChange={onDraftChange}
            onCreateDeckFromTail={onCreateDeckFromTail}
            createDeckPending={createDeckPending}
            t={t}
          />
        ) : null}
        {node.node_type === "image_generation" ? (
          <ImageGenerationInspector
            node={node}
            draft={draft}
            imageSizeOptions={imageSizeOptions}
            imageGenerationMaxDimension={imageGenerationMaxDimension}
            imageToolAllowedFields={imageToolAllowedFields}
            resourceGroups={resourceGroups}
            generationConfigOptions={imageGenerationConfigOptions}
            onDraftChange={onDraftChange}
            downstreamReferenceCount={downstreamReferenceCount}
            onPreviewPrompt={setPromptPreview}
            t={t}
          />
        ) : null}
        {node.node_type === "image_enhance" ? (
          <ImageEnhanceInspector
            draft={draft}
            imageSizeOptions={imageSizeOptions}
            imageGenerationMaxDimension={imageGenerationMaxDimension}
            resourceGroups={resourceGroups}
            generationConfigOptions={imageGenerationConfigOptions}
            onDraftChange={onDraftChange}
            t={t}
          />
        ) : null}
        {node.node_type === "deck_generation" ? (
          <>
            <DeckGenerationInspectorSummary
              node={node}
              onOpenEditor={onOpenDeckEditor}
              t={t}
            />
            {onOpenDeckEditor && onCloseDeckEditor ? (
              <DeckGenerationEditorDialog
                open={deckEditorOpen}
                title={displayTitle}
                onClose={onCloseDeckEditor}
                t={t}
              >
                <DeckGenerationInspector
                  inspiration={inspiration}
                  node={node}
                  draft={draft}
                  resourceGroups={resourceGroups}
                  generationConfigOptions={generationConfigOptions}
                  onDraftChange={onDraftChange}
                  onFlushDraft={onFlushDraft}
                  onPreviewImage={onPreviewImage}
                  busy={busy}
                  t={t}
                />
              </DeckGenerationEditorDialog>
            ) : null}
          </>
        ) : null}
        </fieldset>
      </section>
      {node.attempt_count > 0 ? (
        <section className="rounded-2xl border pf-hairline pf-surface-soft p-3 text-xs leading-relaxed pf-ink-muted shadow-sm dark:border-[color:var(--pf-border)] dark:bg-[#0b1220] dark:text-[color:var(--pf-muted)]">
          {t("detail.nodeAttemptSummary", { attempts: node.attempt_count, retries: node.retry_count })}
        </section>
      ) : null}
      {node.failure_reason ? (
        <section
          className={`rounded-2xl border p-4 text-xs leading-relaxed shadow-sm ${
            node.status === "cancelled"
              ? "pf-hairline pf-surface-soft pf-ink-muted dark:border-[color:var(--pf-border)] dark:bg-[#0b1220] dark:text-[color:var(--pf-muted)]"
              : "border-red-200 bg-red-50 text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200"
          }`}
        >
          <AlertCircle size={13} className="mr-1.5 inline" />
          {node.failure_reason}
          {node.status === "failed" && node.is_retryable && node.node_type !== "inspiration_context" ? (
            <div className="mt-2 font-semibold text-red-700 dark:text-red-100">{t("detail.inspector.retryableCurrent")}</div>
          ) : null}
          {node.status === "failed" && !node.is_retryable ? (
            <div className="mt-2 font-semibold text-red-700 dark:text-red-100">{t("detail.notRetryable")}</div>
          ) : null}
          {node.status === "failed" && !node.is_retryable && node.non_retryable_reason ? (
            <div className="mt-1 text-[11px] text-red-700/85 dark:text-red-100/85">
              {t("detail.nonRetryableReason", { reason: node.non_retryable_reason })}
            </div>
          ) : null}
          {node.status === "failed" && node.retry_hint ? (
            <div className="mt-1 text-[11px] text-red-700/85 dark:text-red-100/85">
              {workflowRetryHintLabel(node.retry_hint, t)}
            </div>
          ) : null}
        </section>
      ) : null}
      {promptPreview ? (
        <PromptPreviewDialog appearance={actionAppearance} preview={promptPreview} onClose={() => setPromptPreview(null)} />
      ) : null}
      </div>
    </InspectorInputLayoutContext.Provider>
  );
}

function InspirationContextInspector({
  inspiration,
  sourceImage,
  draft,
  onDraftChange,
  onPreviewImage,
  onUploadImage,
  onUploadDocument,
  onClipboardError,
  sourceAsset,
  onSaveSourceAssetToResourceLibrary,
  resourceLibrarySaveDisabledTitle = null,
  savedToResourceLibrary,
  savingToResourceLibrary,
  busy,
  t,
}: {
  inspiration: InspirationDetail;
  sourceImage: DownloadableImage | null;
  draft: NodeConfigDraft;
  onDraftChange: (draft: NodeConfigDraft) => void;
  onPreviewImage: (image: DownloadableImage) => void;
  onUploadImage: (file: File) => void;
  onUploadDocument: (file: File) => void;
  onClipboardError?: (message: string) => void;
  sourceAsset: SourceAsset | null;
  onSaveSourceAssetToResourceLibrary?: (asset: SourceAsset) => void;
  resourceLibrarySaveDisabledTitle?: string | null;
  savedToResourceLibrary: boolean;
  savingToResourceLibrary: boolean;
  busy: boolean;
  t: TFunction;
}) {
  const actionAppearance = useInspectorActionAppearance();
  const clipboardButtonClassName = inspectorSecondaryFullButtonClassName(actionAppearance);
  const documentDropzoneClassName = inspectorDocumentDropzoneClassName(actionAppearance);
  const addDynamicField = () => {
    onDraftChange({
      ...draft,
      dynamicFields: [
        ...draft.dynamicFields,
        { id: `dynamic-${Date.now()}-${draft.dynamicFields.length}`, key: "", value: "" },
      ],
    });
  };

  const updateDynamicField = (fieldId: string, patch: Partial<NodeConfigDraft["dynamicFields"][number]>) => {
    onDraftChange({
      ...draft,
      dynamicFields: draft.dynamicFields.map((field) => (field.id === fieldId ? { ...field, ...patch } : field)),
    });
  };

  const removeDynamicField = (fieldId: string) => {
    onDraftChange({
      ...draft,
      dynamicFields: draft.dynamicFields.filter((field) => field.id !== fieldId),
    });
  };
  const hasDocument = Boolean(draft.documentSourceAssetId || draft.documentFilename || draft.documentText);
  const [documentPreviewOpen, setDocumentPreviewOpen] = useState(false);
  useEffect(() => {
    setDocumentPreviewOpen(false);
  }, [draft.documentSourceAssetId, draft.documentFilename]);
  const removeDocument = () => {
    setDocumentPreviewOpen(false);
    onDraftChange({
      ...draft,
      documentSourceAssetId: "",
      documentFilename: "",
      documentMimeType: "",
      documentText: "",
    });
  };
  const entryTypeLabelKey =
    INSPIRATION_CONTEXT_ENTRY_OPTIONS.find((option) => option.value === draft.entryType)?.labelKey ??
    "detail.inspector.entryType.image";
  const inputAppearance = layoutInputAppearance(useInspectorWorkspaceSubpage());

  return (
    <div className="space-y-3">
      {sourceImage ? (
        <MediaPreviewTrigger
          onPreview={() => onPreviewImage(sourceImage)}
          className={`group relative flex h-40 items-center justify-center overflow-hidden rounded-2xl border pf-hairline bg-[rgba(255,255,255,0.5)] p-2 shadow-sm transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-indigo-300 dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)] dark:hover:border-violet-400/50 hover:shadow-[0_8px_20px_-6px_rgba(99,102,241,0.15)] dark:hover:shadow-[0_8px_20px_-6px_rgba(139,92,246,0.3)] ${IMAGE_PREVIEW_SURFACE_CLASS_NAME}`}
          aria-label={t("detail.previewImage", { alt: sourceImage.alt })}
          title={t("detail.previewImage", { alt: sourceImage.alt })}
        >
          <img
            src={sourceImage.previewUrl}
            alt={sourceImage.alt}
            className="h-full w-full object-contain transition-transform duration-300 ease-out group-hover:scale-[1.03]"
          />
          <DownloadLink image={sourceImage} appearance={actionAppearance} variant="overlay" />
        </MediaPreviewTrigger>
      ) : (
        <div
          className={`group relative flex h-40 items-center justify-center overflow-hidden rounded-2xl border pf-hairline bg-[rgba(255,255,255,0.5)] p-2 shadow-sm transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-indigo-300 dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)] dark:hover:border-violet-400/50 hover:shadow-[0_8px_20px_-6px_rgba(99,102,241,0.15)] dark:hover:shadow-[0_8px_20px_-6px_rgba(139,92,246,0.3)] ${IMAGE_PREVIEW_SURFACE_CLASS_NAME}`}
        >
          <div className="text-xs pf-ink-muted dark:text-[color:var(--pf-muted)]">{t("detail.inspector.noSourceImage")}</div>
        </div>
      )}
      <SaveCurrentImageToResourceLibraryButton
        sourceAsset={sourceAsset}
        onSaveSourceAssetToResourceLibrary={onSaveSourceAssetToResourceLibrary}
        disabledTitle={resourceLibrarySaveDisabledTitle}
        saved={savedToResourceLibrary}
        busy={savingToResourceLibrary}
        t={t}
      />
      <ImageDropZone
        ariaLabel={sourceImage ? t("detail.inspector.replaceContextImage") : t("detail.inspector.uploadContextImage")}
        disabled={busy}
        className="flex cursor-pointer items-center justify-center rounded-2xl border border-dashed pf-hairline-strong px-3 py-5 text-xs font-medium pf-ink-muted transition-all duration-300 hover:border-indigo-500 hover:bg-indigo-50/20 hover:text-indigo-600 dark:border-[color:var(--pf-border)] dark:text-[color:var(--pf-muted)] dark:hover:border-violet-400 dark:hover:bg-violet-500/5 dark:hover:text-violet-200"
        activeClassName="border-indigo-500 bg-indigo-50/60 text-indigo-700 shadow-[0_0_0_4px_rgba(99,102,241,0.12)] dark:border-violet-400 dark:bg-violet-500/12 dark:text-violet-100 dark:shadow-[0_0_0_4px_rgba(139,92,246,0.18)]"
        focusClassName="focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:focus-visible:ring-violet-400 dark:focus-visible:ring-offset-slate-950"
        onFiles={(files) => {
          const file = files[0];
          if (file) {
            onUploadImage(file);
          }
        }}
      >
        {({ isDragging }) => (
          <div className={`flex h-full w-full items-center justify-center transition-transform duration-200 ${isDragging ? "scale-[1.03] text-indigo-600 dark:text-violet-300" : ""}`}>
            <Upload size={14} className={`mr-2 transition-transform duration-200 ${isDragging ? "-translate-y-0.5 scale-110" : ""}`} />
            {isDragging
              ? t("detail.inspector.dropUpload")
              : sourceImage
                ? t("detail.inspector.replaceContextImage")
                : t("detail.inspector.uploadContextImage")}
          </div>
        )}
      </ImageDropZone>
      <ClipboardImageButton
        buttonClassName={clipboardButtonClassName}
        disabled={busy}
        label={t("common.pasteImage")}
        closeLabel={t("common.close")}
        pasteAreaLabel={t("common.pasteImageTarget")}
        pasteAreaPlaceholder={t("common.pasteImagePlaceholder")}
        noImageMessage={t("common.clipboardNoImage")}
        onFiles={(files) => {
          const file = files[0];
          if (file) {
            onUploadImage(file);
          }
        }}
        onError={onClipboardError}
      />
      <label className="block">
        <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest pf-ink-muted dark:text-[color:var(--pf-muted)]">
          {t("detail.inspector.inspirationName")}
        </span>
        <LayoutTextInput
          value={draft.inspirationName}
          onChange={(event) =>
            onDraftChange({ ...draft, inspirationName: event.target.value })
          }
          size="compact"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest pf-ink-muted dark:text-[color:var(--pf-muted)]">
            {t("detail.inspector.ownerId")}
          </span>
          <LayoutTextInput
            value={draft.ownerId}
            readOnly
            size="compact"
            className="pf-ink-muted dark:text-[color:var(--pf-muted)]"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest pf-ink-muted dark:text-[color:var(--pf-muted)]">
            {t("detail.inspector.entryType")}
          </span>
          <LayoutTextInput
            value={t(entryTypeLabelKey)}
            readOnly
            size="compact"
            className="pf-ink-muted dark:text-[color:var(--pf-muted)]"
          />
        </label>
      </div>
      <MarkdownEditor
        label={t("detail.inspector.longText")}
        labelHelp={<ParameterHelpButton helpKey="inspirationContextLongText" uiType="inspirationDetail" />}
        value={draft.longText}
        modalTitle={t("detail.inspector.longText")}
        onChange={(value) => onDraftChange({ ...draft, longText: value, sourceNote: value })}
        maxLength={INSPIRATION_CONTEXT_MARKDOWN_MAX_LENGTH}
        minRows={5}
        disabled={busy}
        inputAppearance={inputAppearance}
      />
      <div className="space-y-3 rounded-xl border pf-hairline pf-surface-soft px-3 py-3 dark:border-[color:var(--pf-border)] dark:bg-[#0b1220]">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <FieldLabel
              label={t("detail.inspector.contextDocument")}
              helpKey="inspirationContextDocument"
              className="text-xs font-semibold pf-ink-muted dark:text-[color:var(--pf-muted)]"
            />
            <div className="mt-0.5 text-[11px] pf-ink-muted dark:text-[color:var(--pf-muted)]">
              {hasDocument
                ? t("detail.inspector.contextDocumentLockedHint")
                : t("detail.inspector.uploadContextDocument")}
            </div>
          </div>
          {hasDocument ? (
            <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/12 dark:text-emerald-100">
              {t("detail.inspector.documentUploaded")}
            </span>
          ) : null}
        </div>
        {hasDocument ? (
          <div className="rounded-xl border pf-hairline pf-surface px-3 py-3 dark:border-[color:var(--pf-border)] dark:bg-[#111b2d]">
            <div className="flex min-w-0 items-start gap-2">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border pf-hairline pf-surface-soft pf-ink-muted dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)] dark:text-[color:var(--pf-muted)]">
                <FileText size={15} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold pf-ink-muted dark:text-[color:var(--pf-muted)]">
                  {draft.documentFilename || t("detail.inspector.unnamedContextDocument")}
                </div>
                {draft.documentMimeType ? (
                  <div className="mt-0.5 truncate text-[11px] pf-ink-muted dark:text-[color:var(--pf-muted)]">
                    {t("detail.inspector.documentMimeType", { mime: draft.documentMimeType })}
                  </div>
                ) : null}
                <div className="mt-1 text-[11px] leading-5 pf-ink-muted dark:text-[color:var(--pf-muted)]">
                  {t("detail.inspector.removeContextDocumentHint")}
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t pf-hairline pt-3 dark:border-[color:var(--pf-border)]">
              {draft.documentText ? (
                <ActionButton
                  onClick={() => setDocumentPreviewOpen((current) => !current)}
                  disabled={busy}
                  preset="secondary"
                  size="sm"
                  aria-expanded={documentPreviewOpen}
                  aria-label={
                    documentPreviewOpen
                      ? t("detail.inspector.hideDocumentPreview")
                      : t("detail.inspector.showDocumentPreview")
                  }
                  title={
                    documentPreviewOpen
                      ? t("detail.inspector.hideDocumentPreview")
                      : t("detail.inspector.showDocumentPreview")
                  }
                  leadingIcon={documentPreviewOpen ? <EyeOff size={12} /> : <Eye size={12} />}
                >
                  {documentPreviewOpen
                    ? t("detail.inspector.hideDocumentPreview")
                    : t("detail.inspector.showDocumentPreview")}
                </ActionButton>
              ) : null}
              <ActionButton
                onClick={removeDocument}
                disabled={busy}
                preset="danger"
                size="sm"
                leadingIcon={<Trash2 size={12} />}
              >
                {t("detail.inspector.removeContextDocument")}
              </ActionButton>
            </div>
          </div>
        ) : (
          <ImageDropZone
            accept=".txt,.md,.csv,.json,text/plain,text/markdown,text/csv,application/json"
            ariaLabel={t("detail.inspector.uploadContextDocument")}
            disabled={busy}
            className={documentDropzoneClassName}
            activeClassName="pf-action-surface--active"
            onFiles={(files) => {
              const file = files[0];
              if (file) {
                onUploadDocument(file);
              }
            }}
          >
            {({ isDragging }) => (
              <div className={`flex h-full w-full items-center justify-center transition-transform duration-200 ${isDragging ? "scale-[1.03] text-indigo-600 dark:text-violet-300" : ""}`}>
                <Upload size={14} className={`mr-2 transition-transform duration-200 ${isDragging ? "-translate-y-0.5 scale-110" : ""}`} />
                {isDragging ? t("detail.inspector.dropDocument") : t("detail.inspector.uploadContextDocument")}
              </div>
            )}
          </ImageDropZone>
        )}
        {draft.documentText && documentPreviewOpen ? (
          <MarkdownEditor
            label={t("detail.inspector.documentText")}
            value={draft.documentText}
            modalTitle={draft.documentFilename || t("detail.inspector.documentText")}
            helpText={t("detail.inspector.documentPreviewHelp")}
            minRows={4}
            inputAppearance={inputAppearance}
            readOnly
          />
        ) : null}
      </div>
      <div className="space-y-2 rounded-xl border pf-hairline pf-surface-soft px-3 py-3 dark:border-[color:var(--pf-border)] dark:bg-[#0b1220]">
        <div className="flex items-center justify-between gap-2">
          <FieldLabel
            label={t("detail.inspector.dynamicFields")}
            helpKey="inspirationContextDynamicFields"
            className="text-xs font-semibold pf-ink-muted dark:text-[color:var(--pf-muted)]"
          />
          <ActionButton
            type="button"
            onClick={addDynamicField}
            disabled={busy}
            preset="secondary"
            size="sm"
            leadingIcon={<Plus size={12} />}
          >
            {t("detail.inspector.addDynamicField")}
          </ActionButton>
        </div>
        {draft.dynamicFields.length ? (
          <div className="space-y-2">
            {draft.dynamicFields.map((field) => (
              <div key={field.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
                <LayoutTextInput
                  value={field.key}
                  onChange={(event) => updateDynamicField(field.id, { key: event.target.value })}
                  size="compact"
                  className="min-w-0"
                  placeholder={t("detail.inspector.dynamicKey")}
                />
                <LayoutTextInput
                  value={field.value}
                  onChange={(event) => updateDynamicField(field.id, { value: event.target.value })}
                  size="compact"
                  className="min-w-0"
                  placeholder={t("detail.inspector.dynamicValue")}
                />
                <ActionButton
                  onClick={() => removeDynamicField(field.id)}
                  disabled={busy}
                  preset="danger"
                  size="icon-md"
                  aria-label={t("detail.inspector.removeDynamicField")}
                  title={t("detail.inspector.removeDynamicField")}
                  leadingIcon={<Trash2 size={13} />}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed pf-hairline-strong px-3 py-3 text-xs pf-ink-muted dark:border-[color:var(--pf-border)] dark:text-[color:var(--pf-muted)]">
            {t("detail.inspector.noDynamicFields")}
          </div>
        )}
      </div>
      <div className="rounded-md border pf-hairline pf-surface-soft px-3 py-2 text-xs pf-ink-muted dark:border-[color:var(--pf-border)] dark:bg-[#0b1220] dark:text-[color:var(--pf-muted)]">
        {t("detail.inspector.originalInspiration", { name: inspiration.name })}
        {inspiration.category ? ` · ${inspiration.category}` : ""}
        {inspiration.price ? ` · ${formatPrice(inspiration.price)}` : ""}
      </div>
    </div>
  );
}

function ReferenceImageInspector({
  draft,
  onDraftChange,
  onUploadImage,
  onClipboardError,
  onClearImage,
  onOpenResourceLibrary,
  resourceLibraryDisabledTitle = null,
  sourceAsset,
  onSaveSourceAssetToResourceLibrary,
  resourceLibrarySaveDisabledTitle = null,
  savedToResourceLibrary,
  savingToResourceLibrary,
  busy,
  hasImage,
  image,
  onPreviewImage,
  t,
}: {
  draft: NodeConfigDraft;
  onDraftChange: (draft: NodeConfigDraft) => void;
  onUploadImage: (file: File) => void;
  onClipboardError?: (message: string) => void;
  onClearImage: () => void;
  onOpenResourceLibrary?: () => void;
  resourceLibraryDisabledTitle?: string | null;
  sourceAsset: SourceAsset | null;
  onSaveSourceAssetToResourceLibrary?: (asset: SourceAsset) => void;
  resourceLibrarySaveDisabledTitle?: string | null;
  savedToResourceLibrary: boolean;
  savingToResourceLibrary: boolean;
  busy: boolean;
  hasImage: boolean;
  image: DownloadableImage | null;
  onPreviewImage: (image: DownloadableImage) => void;
  t: TFunction;
}) {
  const actionAppearance = useInspectorActionAppearance();
  const clipboardButtonClassName = inspectorSecondaryFullButtonClassName(actionAppearance);
  const imageDropzoneClassName = inspectorImageDropzoneClassName(actionAppearance);

  return (
    <div className="space-y-3">
      {image ? (
        <div
          className={`group relative flex aspect-[4/3] min-h-[180px] w-full items-center justify-center overflow-hidden rounded-2xl border pf-hairline bg-[rgba(255,255,255,0.5)] p-3 shadow-sm transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-indigo-300 dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)] dark:hover:border-violet-400/50 hover:shadow-[0_8px_20px_-6px_rgba(99,102,241,0.15)] dark:hover:shadow-[0_8px_20px_-6px_rgba(139,92,246,0.3)] ${IMAGE_PREVIEW_SURFACE_CLASS_NAME}`}
        >
          <MediaPreviewTrigger
            onPreview={() => onPreviewImage(image)}
            className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-lg"
            aria-label={t("detail.inspector.preview", { alt: image.alt })}
          >
            <img src={image.previewUrl} alt={image.alt} className="h-full w-full object-contain transition-transform duration-300 ease-out group-hover:scale-[1.03]" />
            <span className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-[color:var(--pf-deep)] px-2 py-1 text-[11px] font-medium text-[#fff] opacity-0 transition-opacity group-hover:opacity-100">
              {t("detail.inspector.clickPreview")}
            </span>
          </MediaPreviewTrigger>
          <DownloadLink image={image} appearance={actionAppearance} variant="overlay" />
          <ActionButton
            onClick={(event) => {
              event.stopPropagation();
              onClearImage();
            }}
            disabled={busy}
            preset="danger"
            size="icon-sm"
            className="nodrag nopan nowheel absolute right-2 top-2"
            aria-label={t("detail.inspector.clearReferenceImage")}
            title={t("detail.inspector.clearReferenceImage")}
            leadingIcon={<Trash2 size={13} aria-hidden="true" />}
          />
          <div className="absolute left-2 top-2 inline-flex items-center rounded-full border border-violet-400/60 bg-[color:var(--pf-deep)] px-2.5 py-1 text-[11px] font-semibold text-violet-100 shadow-lg shadow-violet-950/35 ring-1 ring-violet-300/20 backdrop-blur">
            <Sparkles size={12} className="mr-1 text-violet-300" />
            {t("detail.canUseAsReference")}
          </div>
        </div>
      ) : null}
      <SaveCurrentImageToResourceLibraryButton
        sourceAsset={sourceAsset}
        onSaveSourceAssetToResourceLibrary={onSaveSourceAssetToResourceLibrary}
        disabledTitle={resourceLibrarySaveDisabledTitle}
        saved={savedToResourceLibrary}
        busy={savingToResourceLibrary}
        t={t}
      />
      <div className="block">
        <FieldLabel label={t("detail.inspector.role")} helpKey="referenceRole" />
        <div className="space-y-2">
          <LayoutSelectField
            value={referenceRolePresetValue(draft.role)}
            options={[
              ...REFERENCE_ROLE_OPTIONS.map((option) => ({
                value: option.value,
                label: t(option.labelKey),
              })),
              { value: "__custom__", label: t("detail.referenceRole.custom") },
            ]}
            onChange={(nextValue) =>
              onDraftChange({
                ...draft,
                role: nextValue === "__custom__" ? "" : nextValue,
              })
            }
            radius="lg"
            visualSize="sm"
          />
          <LayoutTextInput
            value={draft.role}
            onChange={(event) =>
              onDraftChange({ ...draft, role: event.target.value })
            }
            size="compact"
            placeholder={t("detail.referenceRole.customPlaceholder")}
          />
        </div>
      </div>
      <label className="block">
        <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest pf-ink-muted dark:text-[color:var(--pf-muted)]">
          {t("detail.inspector.label")}
        </span>
        <LayoutTextInput
          value={draft.label}
          onChange={(event) =>
            onDraftChange({ ...draft, label: event.target.value })
          }
          size="compact"
          placeholder={t("detail.inspector.labelCompatPlaceholder")}
        />
      </label>
      <ImageDropZone
        ariaLabel={hasImage ? t("detail.inspector.replaceReference") : t("detail.inspector.uploadReference")}
        disabled={busy}
        className={imageDropzoneClassName}
        activeClassName="pf-action-surface--active"
        onFiles={(files) => {
          const file = files[0];
          if (file) {
            onUploadImage(file);
          }
        }}
      >
        {({ isDragging }) => (
          <div className={`flex h-full w-full items-center justify-center transition-transform duration-200 ${isDragging ? "scale-[1.03] text-indigo-600 dark:text-violet-300" : ""}`}>
            <Upload size={14} className={`mr-2 transition-transform duration-200 ${isDragging ? "-translate-y-0.5 scale-110" : ""}`} />
            {isDragging
              ? t("detail.inspector.dropUpload")
              : hasImage
                ? t("detail.inspector.replaceImage")
                : t("detail.inspector.uploadImage")}
          </div>
        )}
      </ImageDropZone>
      <ClipboardImageButton
        buttonClassName={clipboardButtonClassName}
        disabled={busy}
        label={t("common.pasteImage")}
        closeLabel={t("common.close")}
        pasteAreaLabel={t("common.pasteImageTarget")}
        pasteAreaPlaceholder={t("common.pasteImagePlaceholder")}
        noImageMessage={t("common.clipboardNoImage")}
        onFiles={(files) => {
          const file = files[0];
          if (file) {
            onUploadImage(file);
          }
        }}
        onError={onClipboardError}
      />
      {onOpenResourceLibrary ? (
        <ActionButton
          onClick={onOpenResourceLibrary}
          disabled={busy || Boolean(resourceLibraryDisabledTitle)}
          title={resourceLibraryDisabledTitle ?? t("resourceLibrary.open")}
          preset="secondary"
          size="md"
          fullWidth
          leadingIcon={<FolderOpen size={14} />}
        >
          {t("resourceLibrary.open")}
        </ActionButton>
      ) : null}
    </div>
  );
}

function SaveCurrentImageToResourceLibraryButton({
  sourceAsset,
  onSaveSourceAssetToResourceLibrary,
  disabledTitle,
  saved,
  busy,
  t,
}: {
  sourceAsset: SourceAsset | null;
  onSaveSourceAssetToResourceLibrary?: (asset: SourceAsset) => void;
  disabledTitle: string | null;
  saved: boolean;
  busy: boolean;
  t: TFunction;
}) {
  if (!sourceAsset || !onSaveSourceAssetToResourceLibrary) {
    return null;
  }

  return (
    <ActionButton
      onClick={() => onSaveSourceAssetToResourceLibrary(sourceAsset)}
      disabled={busy || Boolean(disabledTitle)}
      title={disabledTitle ?? t("resourceLibrary.saveToLibrary")}
      preset="primary"
      size="md"
      fullWidth
      loading={busy}
      leadingIcon={<Save size={14} />}
    >
      {saved ? t("resourceLibrary.alreadyInLibrary") : t("resourceLibrary.saveToLibrary")}
    </ActionButton>
  );
}

function ResourceGroupSelector({
  label,
  draft,
  resourceGroups,
  onDraftChange,
  t,
}: {
  label: string;
  draft: NodeConfigDraft;
  resourceGroups: GenerationResourceGroup[];
  onDraftChange: (draft: NodeConfigDraft) => void;
  t: TFunction;
}) {
  return (
    <div className="space-y-2 rounded-xl border pf-hairline pf-surface-soft px-3 py-3 dark:border-[color:var(--pf-border)] dark:bg-[#0b1220]">
      <FieldLabel
        label={label}
        className="text-xs font-semibold pf-ink-muted dark:text-[color:var(--pf-muted)]"
      />
      <LayoutSelectField
        value={draft.resourceGroupId ?? ""}
        options={[
          {
            value: "",
            label: resourceGroups.length ? t("detail.inspector.selectResourceGroup") : t("detail.inspector.noResourceGroups"),
            disabled: true,
          },
          ...resourceGroups.map((group) => ({
            value: group.id,
            label: resourceGroupOptionLabel(group, t),
            disabled: !group.enabled || Boolean(group.archived_at),
          })),
        ]}
        onChange={(value) =>
          onDraftChange({
            ...draft,
            resourceGroupId: value || null,
            generationConfigMode: "auto",
            generationConfigId: null,
            deckTextGenerationConfigMode: "auto",
            deckTextGenerationConfigId: null,
            deckImageGenerationConfigMode: "auto",
            deckImageGenerationConfigId: null,
          })
        }
        ariaLabel={label}
        radius="lg"
        visualSize="sm"
      />
    </div>
  );
}

const DECK_SLIDE_STATUS_LABEL_KEYS: Record<DeckSlideStatus, TranslationKey> = {
  pending: "detail.deck.slideStatus.pending",
  queued: "detail.deck.slideStatus.queued",
  running: "detail.deck.slideStatus.running",
  completed: "detail.deck.slideStatus.completed",
  failed: "detail.deck.slideStatus.failed",
};

const DECK_SLIDE_SIZE_OPTIONS = [
  { value: "2048x1152", label: "2K 16:9 · 2048x1152" },
  { value: "1920x1080", label: "FHD 16:9 · 1920x1080" },
  { value: "1280x720", label: "HD 16:9 · 1280x720" },
] as const;

function deckErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    return error.detail;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return fallback;
}

function deckIsActive(deck: Deck | undefined): boolean {
  if (!deck) {
    return false;
  }
  return deck.status === "generating" || deck.slides.some((slide) => slide.slide_status === "queued" || slide.slide_status === "running");
}

function deckIdFromNode(node: WorkflowNode): string | null {
  const value = node.config_json.deck_id ?? node.output_json?.deck_id;
  return typeof value === "string" && value.trim() ? value : null;
}

function deckSourceKindLabel(kind: string, t: TFunction): string {
  if (kind === "copy") return t("detail.deck.sourceKind.copy");
  if (kind === "image") return t("detail.deck.sourceKind.image");
  if (kind === "source_asset") return t("detail.deck.sourceKind.sourceAsset");
  if (kind === "poster") return t("detail.deck.sourceKind.poster");
  if (kind === "context") return t("detail.deck.sourceKind.context");
  if (kind === "tail_item") return t("detail.deck.sourceKind.tailItem");
  if (kind === "tail_plan") return t("detail.deck.sourceKind.tailPlan");
  return kind;
}

function deckUnavailableReasonLabel(reason: string, t: TFunction): string {
  const keyMap: Record<string, TranslationKey> = {
    node_not_succeeded: "detail.deck.unavailableReason.nodeNotSucceeded",
    empty_output: "detail.deck.unavailableReason.emptyOutput",
    missing_copy_set: "detail.deck.unavailableReason.missingCopySet",
    missing_source_asset: "detail.deck.unavailableReason.missingSourceAsset",
    disabled_source_asset: "detail.deck.unavailableReason.disabledSourceAsset",
    missing_poster_variant: "detail.deck.unavailableReason.missingPosterVariant",
    disabled_poster_variant: "detail.deck.unavailableReason.disabledPosterVariant",
    unsupported_node_type: "detail.deck.unavailableReason.unsupportedNodeType",
  };
  const key = keyMap[reason];
  return key ? t(key) : reason;
}

function deckPageTypeLabel(pageType: string, t: TFunction): string {
  const keyMap: Record<string, TranslationKey> = {
    cover: "detail.deck.pageType.cover",
    section: "detail.deck.pageType.section",
    copy: "detail.deck.pageType.copy",
    image: "detail.deck.pageType.image",
    summary: "detail.deck.pageType.summary",
  };
  const key = keyMap[pageType];
  return key ? t(key) : pageType;
}

function deckCaptionSourceLabel(captionSource: string, t: TFunction): string {
  const keyMap: Record<string, TranslationKey> = {
    copy_summary: "detail.deck.captionSource.copySummary",
    visual_summary: "detail.deck.captionSource.visualSummary",
  };
  const key = keyMap[captionSource];
  return key ? t(key) : captionSource;
}

function deckGroupLabel(groupId: string | null, t: TFunction): string | null {
  const descriptor = describeDeckGroupId(groupId);
  if (!descriptor) {
    return null;
  }
  if (descriptor.kind === "tail") {
    return t("detail.deck.group.tail", { id: descriptor.shortId });
  }
  if (descriptor.kind === "node") {
    return t("detail.deck.group.node", { id: descriptor.shortId });
  }
  return t("detail.deck.group.other", { id: descriptor.shortId });
}

function deckSourceBadgeLabel(source: DeckSourceItem, t: TFunction): string {
  return `${source.workflow_node_title} · ${deckSourceKindLabel(source.kind, t)}`;
}

function deckSourcePreviewImage(source: DeckSourceItem, t: TFunction): DownloadableImage | null {
  const previewPath = source.preview_url || source.download_url || source.thumbnail_url;
  const downloadPath = source.download_url || source.preview_url || source.thumbnail_url;
  if (!previewPath || !downloadPath) {
    return null;
  }
  return {
    previewUrl: toImageUrl(previewPath),
    downloadUrl: toImageUrl(downloadPath),
    filename: `${sanitizeFilenamePart(source.workflow_node_title, "deck-source")}-${sanitizeFilenamePart(source.source_item_id, "source")}.png`,
    alt: deckSourceBadgeLabel(source, t),
  };
}

function deckGeneratedSlidePreviewImage(slide: DeckSlide, t: TFunction): DownloadableImage | null {
  if (!slide.image_url) {
    return null;
  }
  const slideLabel = slide.title.trim() || `${t("detail.deck.generatedImage")}-${slide.order_index + 1}`;
  return {
    previewUrl: toImageUrl(slide.image_url),
    downloadUrl: toImageUrl(slide.image_url),
    filename: `${sanitizeFilenamePart(slideLabel, "deck-slide")}.png`,
    alt: slideLabel,
  };
}

function deckMaterialPreviewImage(
  slide: DeckSlide,
  selectedBoundSource: DeckSourceItem | null,
  t: TFunction,
): DownloadableImage | null {
  if (slide.material_url) {
    const slideLabel = slide.title.trim() || `${t("detail.deck.currentMaterial")}-${slide.order_index + 1}`;
    return {
      previewUrl: toImageUrl(slide.material_url),
      downloadUrl: toImageUrl(slide.material_url),
      filename: `${sanitizeFilenamePart(slideLabel, "deck-material")}.png`,
      alt: slideLabel,
    };
  }
  return selectedBoundSource ? deckSourcePreviewImage(selectedBoundSource, t) : null;
}

function DeckPreviewSurface({
  label,
  image,
  thumbnailUrl,
  caption,
  emptyLabel,
  aspectClassName = "aspect-[16/9]",
  onPreviewImage,
  t,
}: {
  label: string;
  image: DownloadableImage | null;
  thumbnailUrl?: string;
  caption?: string | null;
  emptyLabel: string;
  aspectClassName?: string;
  onPreviewImage: (image: DownloadableImage) => void;
  t: TFunction;
}) {
  const actionAppearance = useInspectorActionAppearance();

  return (
    <div className="rounded-xl border pf-hairline bg-[rgba(255,255,255,0.8)] p-2 dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)]">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="truncate text-[10px] font-semibold uppercase tracking-widest pf-ink-muted dark:text-[color:var(--pf-muted)]">
          {label}
        </div>
        {caption ? <div className="truncate text-[10px] pf-ink-muted dark:text-[color:var(--pf-muted)]">{caption}</div> : null}
      </div>
      {image ? (
        <div className={`relative ${IMAGE_PREVIEW_SURFACE_CLASS_NAME}`}>
          <MediaPreviewTrigger
            onPreview={() => onPreviewImage(image)}
            className={`group relative w-full overflow-hidden rounded-lg ${aspectClassName}`}
            aria-label={t("detail.previewImage", { alt: image.alt })}
          >
            <img
              src={thumbnailUrl || image.previewUrl}
              alt={image.alt}
              className="h-full w-full object-contain bg-[color:var(--pf-panel-soft)] p-1.5 transition-transform duration-300 ease-out group-hover:scale-[1.03] dark:bg-[color:var(--pf-deep)]"
            />
            <span className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-[color:var(--pf-deep)] px-2 py-1 text-[10px] font-medium text-[#fff] opacity-0 transition-opacity group-hover:opacity-100">
              {t("detail.inspector.clickPreview")}
            </span>
          </MediaPreviewTrigger>
          <DownloadLink image={image} appearance={actionAppearance} variant="overlay" />
        </div>
      ) : (
        <div
          className={`flex items-center justify-center rounded-lg border border-dashed pf-hairline bg-[color:var(--pf-panel-soft)] px-3 text-center text-[11px] pf-ink-muted dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)] dark:text-[color:var(--pf-muted)] ${aspectClassName}`}
        >
          {emptyLabel}
        </div>
      )}
    </div>
  );
}

function DeckMetaChip({
  label,
  title,
}: {
  label: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className="inline-flex items-center rounded-full border pf-hairline pf-surface px-2 py-0.5 text-[10px] font-medium pf-ink-muted dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)] dark:text-[color:var(--pf-muted)]"
    >
      {label}
    </span>
  );
}

function DeckSourceSection({
  title,
  emptyLabel,
  sources,
  orderedSourceIds,
  actionBusy,
  onPreviewImage,
  onToggleSelection,
  onMoveSource,
  t,
}: {
  title: string;
  emptyLabel: string;
  sources: DeckSourceItem[];
  orderedSourceIds: string[];
  actionBusy: boolean;
  onPreviewImage: (image: DownloadableImage) => void;
  onToggleSelection: (sourceItemId: string, selected: boolean) => void;
  onMoveSource: (sourceItemId: string, direction: -1 | 1) => void;
  t: TFunction;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-medium pf-ink-muted dark:text-[color:var(--pf-muted)]">{title}</div>
      {sources.length ? (
        sources.map((source) => {
          const sourceIndex = orderedSourceIds.indexOf(source.source_item_id);
          const previewImage = deckSourcePreviewImage(source, t);
          return (
            <div
              key={source.source_item_id}
              className={`rounded-lg border px-2.5 py-2 text-xs dark:border-[color:var(--pf-border)] ${
                source.selected
                  ? "pf-hairline pf-surface-soft dark:bg-[#0b1220]"
                  : "border-[color:var(--pf-border-soft)] bg-[color:var(--pf-panel-soft)] opacity-75 dark:bg-[color:var(--pf-deep)]"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-1 gap-2.5">
                  {previewImage ? (
                    <MediaPreviewTrigger
                      onPreview={() => onPreviewImage(previewImage)}
                      className="group relative h-12 w-12 shrink-0 overflow-hidden rounded-md"
                      aria-label={t("detail.previewImage", { alt: previewImage.alt })}
                      title={t("detail.previewImage", { alt: previewImage.alt })}
                    >
                      <img
                        src={toImageUrl(source.thumbnail_url, source.preview_url, source.download_url)}
                        alt={previewImage.alt}
                        className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
                      />
                    </MediaPreviewTrigger>
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <ActionButton
                        disabled={actionBusy}
                        onClick={() => onToggleSelection(source.source_item_id, !source.selected)}
                        preset="secondary"
                        size="sm"
                        className="text-[10px]"
                        aria-pressed={source.selected}
                      >
                        {source.selected ? t("detail.deck.sourceSelected") : t("detail.deck.sourceExcluded")}
                      </ActionButton>
                      <span className="truncate font-semibold pf-ink-muted dark:text-[color:var(--pf-muted)]">
                        {source.workflow_node_title}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className="shrink-0 rounded-full border pf-hairline pf-surface px-2 py-0.5 text-[10px] pf-ink-muted dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)] dark:text-[color:var(--pf-muted)]">
                        {deckSourceKindLabel(source.kind, t)}
                      </span>
                      <span className="text-[10px] pf-ink-muted dark:text-[color:var(--pf-muted)]">{source.source_item_id}</span>
                    </div>
                    {source.summary ? (
                      <div className="mt-1 line-clamp-3 text-[11px] leading-4 pf-ink-muted dark:text-[color:var(--pf-muted)]">
                        {source.summary}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <ActionButton
                    disabled={actionBusy || sourceIndex <= 0}
                    onClick={() => onMoveSource(source.source_item_id, -1)}
                    title={t("detail.deck.moveSourceUp")}
                    preset="secondary"
                    size="icon-sm"
                    leadingIcon={<ChevronUp size={12} />}
                  />
                  <ActionButton
                    disabled={actionBusy || sourceIndex < 0 || sourceIndex === orderedSourceIds.length - 1}
                    onClick={() => onMoveSource(source.source_item_id, 1)}
                    title={t("detail.deck.moveSourceDown")}
                    preset="secondary"
                    size="icon-sm"
                    leadingIcon={<ChevronDown size={12} />}
                  />
                </div>
              </div>
            </div>
          );
        })
      ) : (
        <div className="rounded-lg border border-dashed pf-hairline-strong px-3 py-4 text-center text-xs pf-ink-muted dark:border-[color:var(--pf-border)] dark:text-[color:var(--pf-muted)]">
          {emptyLabel}
        </div>
      )}
    </div>
  );
}

function deckBindableSources(manifest: DeckSourceManifest | undefined): DeckSourceItem[] {
  return (manifest?.available_sources ?? []).filter((source) => source.source_asset_id || source.poster_variant_id);
}

function deckPointsDraft(points: string[]): string {
  return points.join("\n");
}

function deckPointsFromDraft(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function stringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function DeckGenerationInspectorSummary({
  node,
  onOpenEditor,
  t,
}: {
  node: WorkflowNode;
  onOpenEditor?: () => void;
  t: TFunction;
}) {
  const cardState = readDeckNodeCardState(node);

  return (
    <div className="rounded-2xl border pf-hairline bg-[color:var(--pf-panel-soft)] p-4 shadow-sm dark:border-[color:var(--pf-border)] dark:bg-[#0b1220]">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {cardState ? (
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusClass(cardState.badgeTone)}`}
                >
                  {t(cardState.badgeLabelKey)}
                </span>
              ) : null}
              {cardState ? <DeckMetaChip label={t("detail.deck.sourceCount", { count: cardState.sourceItemCount })} /> : null}
              {cardState && cardState.slideCount !== null ? (
                <DeckMetaChip label={t("detail.deck.slideCount", { count: cardState.slideCount })} />
              ) : null}
              {cardState && cardState.generatedSlideCount !== null ? (
                <DeckMetaChip label={t("detail.deck.generatedCount", { count: cardState.generatedSlideCount })} />
              ) : null}
            </div>
            <p className="mt-2 text-xs leading-5 pf-ink-muted dark:text-[color:var(--pf-muted)]">{t("detail.deck.dagDeckHint")}</p>
          </div>
          {onOpenEditor ? (
            <ActionButton
              onClick={onOpenEditor}
              preset="secondary"
              size="md"
              className="w-full sm:w-auto"
              leadingIcon={<Maximize2 size={14} />}
            >
              {t("detail.deck.openEditor")}
            </ActionButton>
          ) : null}
        </div>
        {cardState?.sourceStale ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-100">
            {t("detail.deck.sourceStale")}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DeckGenerationEditorDialog({
  open,
  title,
  onClose,
  t,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  t: TFunction;
  children: ReactNode;
}) {
  const headingId = useId();

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      ariaLabelledBy={headingId}
      panelElement="section"
      overlayClassName="z-[90] bg-[color:var(--pf-deep)] px-3 py-4 backdrop-blur-sm sm:px-6 sm:py-6"
      panelClassName="flex h-[min(92vh,58rem)] w-[min(96vw,78rem)] flex-col overflow-hidden rounded-[28px] border pf-hairline pf-surface shadow-2xl dark:border-[color:var(--pf-border)] dark:bg-[#0f1726]"
    >
      <div className="flex items-start justify-between gap-4 border-b pf-hairline px-5 py-4 dark:border-[color:var(--pf-border)] sm:px-6">
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="truncate text-base font-semibold pf-ink dark:text-[#fff]">
            {t("detail.deck.editorTitle", { title })}
          </h2>
          <p className="mt-1 text-xs leading-5 pf-ink-muted dark:text-[color:var(--pf-muted)]">{t("detail.deck.dagDeckHint")}</p>
        </div>
        <ActionButton
          onClick={onClose}
          aria-label={t("common.close")}
          preset="secondary"
          size="icon-md"
          leadingIcon={<X size={16} />}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
    </ModalShell>
  );
}

function DeckGenerationInspector({
  inspiration,
  node,
  draft,
  resourceGroups,
  generationConfigOptions,
  onDraftChange,
  onFlushDraft,
  onPreviewImage,
  busy,
  t,
}: {
  inspiration: InspirationDetail;
  node: WorkflowNode;
  draft: NodeConfigDraft;
  resourceGroups: GenerationResourceGroup[];
  generationConfigOptions: GenerationConfigOption[];
  onDraftChange: (draft: NodeConfigDraft) => void;
  onFlushDraft?: () => Promise<void>;
  onPreviewImage: (image: DownloadableImage) => void;
  busy: boolean;
  t: TFunction;
}) {
  const queryClient = useQueryClient();
  const [localError, setLocalError] = useState("");
  const [bindingSlideId, setBindingSlideId] = useState<string | null>(null);
  const [pptxProgress, setPptxProgress] = useState<{ completed: number; total: number } | null>(null);
  const [deckTitleDraft, setDeckTitleDraft] = useState("");
  const [outlineSlideDrafts, setOutlineSlideDrafts] = useState<Record<string, { title: string; points: string[] }>>({});
  const stylesQuery = useQuery({ queryKey: ["deck-styles"], queryFn: () => api.listDeckStyles() });
  const sourcesQuery = useQuery({
    queryKey: ["workflow-deck-sources", inspiration.id, node.id, draft.deckIncludeTransitiveInputs],
    queryFn: () => api.getWorkflowDeckSources(inspiration.id, node.id, draft.deckIncludeTransitiveInputs),
  });
  const sourcesViewState = asyncViewStateFromQuery({
    active: true,
    data: sourcesQuery.data,
    dataUpdatedAt: sourcesQuery.dataUpdatedAt,
    isSuccess: sourcesQuery.isSuccess,
    isError: sourcesQuery.isError,
    fetchStatus: sourcesQuery.fetchStatus,
    isEmpty: (data) => data.available_sources.length === 0 && data.unavailable_sources.length === 0,
  });
  const deckId = deckIdFromNode(node);
  const deckQuery = useQuery({
    queryKey: ["deck", deckId],
    queryFn: () => api.getDeck(deckId as string),
    enabled: Boolean(deckId),
    refetchInterval: (query) => (deckIsActive(query.state.data as Deck | undefined) ? 1500 : false),
  });
  const deck = deckQuery.data;
  useEffect(() => {
    setDeckTitleDraft(deck?.title ?? "");
  }, [deck?.id, deck?.title]);
  useEffect(() => {
    setOutlineSlideDrafts({});
  }, [deck?.id]);
  const styles = stylesQuery.data ?? [];
  const textGenerationConfigOptions = generationConfigOptionsForPurpose(
    generationConfigOptions,
    "text",
    draft.resourceGroupId,
  );
  const imageGenerationConfigOptions = generationConfigOptionsForPurpose(
    generationConfigOptions,
    "image",
    draft.resourceGroupId,
  );
  const availableSources = orderDeckSourcesForDraft(
    sourcesQuery.data?.available_sources ?? [],
    draft.deckSourceOrder,
    draft.deckExcludedSourceItemIds,
  );
  const sourcePartitions = partitionDeckSources(sourcesQuery.data, availableSources);
  const unavailableSources = sourcesQuery.data?.unavailable_sources ?? [];
  const bindableSources = deckBindableSources(
    sourcesQuery.data
      ? { ...sourcesQuery.data, available_sources: availableSources }
      : undefined,
  );
  const flushDraftBeforeDeckAction = async () => {
    if (!onFlushDraft) {
      return;
    }
    await onFlushDraft();
  };
  const invalidateDeckQueries = async (nextDeck?: Deck) => {
    await queryClient.invalidateQueries({ queryKey: ["workflow-deck-sources", inspiration.id, node.id] });
    await queryClient.invalidateQueries({ queryKey: ["inspiration-workflow", inspiration.id] });
    await queryClient.invalidateQueries({ queryKey: ["decks", inspiration.id] });
    if (nextDeck?.id) {
      await queryClient.invalidateQueries({ queryKey: ["deck", nextDeck.id] });
    }
    if (deckId) {
      await queryClient.invalidateQueries({ queryKey: ["deck", deckId] });
    }
  };
  const onDeckError = (error: unknown) => {
    setLocalError(deckErrorMessage(error, t("detail.deck.actionFailed")));
  };
  const refreshSourcesMutation = useMutation({
    mutationFn: async () => {
      await flushDraftBeforeDeckAction();
      return api.refreshWorkflowDeckSources(inspiration.id, node.id, draft.deckIncludeTransitiveInputs);
    },
    onSuccess: async () => {
      setLocalError("");
      await invalidateDeckQueries(deck);
    },
    onError: onDeckError,
  });
  const outlineMutation = useMutation({
    mutationFn: async () => {
      await flushDraftBeforeDeckAction();
      return api.createWorkflowDeckOutline(inspiration.id, node.id, {
        resource_group_id: draft.resourceGroupId,
        text_generation_config_mode: draft.deckTextGenerationConfigMode,
        text_generation_config_id:
          draft.deckTextGenerationConfigMode === "manual" ? draft.deckTextGenerationConfigId : null,
        image_generation_config_mode: draft.deckImageGenerationConfigMode,
        image_generation_config_id:
          draft.deckImageGenerationConfigMode === "manual" ? draft.deckImageGenerationConfigId : null,
        title: deckTitleDraft.trim() || undefined,
        source_input: draft.deckSourceInput.trim() || undefined,
        max_slides: draft.deckSlideCountMode === "target" ? draft.deckMaxSlides : undefined,
        style_key: draft.deckStyleKey || undefined,
        include_transitive_inputs: draft.deckIncludeTransitiveInputs,
        planning_strategy: draft.deckPlanningStrategy,
        slide_count_mode: draft.deckSlideCountMode,
        group_by: draft.deckGroupBy,
        section_pages: draft.deckSectionPages,
        per_group_image_cap: draft.deckPerGroupImageCap,
        slide_context: buildDeckOutlineSlideContext(deck, outlineSlideDrafts),
      });
    },
    onSuccess: async (nextDeck) => {
      setLocalError("");
      await invalidateDeckQueries(nextDeck);
    },
    onError: onDeckError,
  });
  const styleMutation = useMutation({
    mutationFn: (styleKey: string) => api.setWorkflowDeckStyle(inspiration.id, node.id, { style_key: styleKey }),
    onSuccess: async (nextDeck) => {
      setLocalError("");
      await invalidateDeckQueries(nextDeck);
    },
    onError: onDeckError,
  });
  const metadataMutation = useMutation({
    mutationFn: (input: { title?: string; speaker_notes_enabled?: boolean }) =>
      api.renameWorkflowDeck(inspiration.id, node.id, input),
    onSuccess: async (nextDeck) => {
      setLocalError("");
      await invalidateDeckQueries(nextDeck);
    },
    onError: onDeckError,
  });
  const reorderMutation = useMutation({
    mutationFn: (slideIds: string[]) => api.reorderWorkflowDeckSlides(inspiration.id, node.id, slideIds),
    onSuccess: async (nextDeck) => {
      setLocalError("");
      await invalidateDeckQueries(nextDeck);
    },
    onError: onDeckError,
  });
  const updateSlideMutation = useMutation({
    mutationFn: (input: { slideId: string; payload: { title?: string; points?: string[]; speaker_notes?: string } }) =>
      api.updateWorkflowDeckSlide(inspiration.id, node.id, input.slideId, input.payload),
    onSuccess: async () => {
      setLocalError("");
      await invalidateDeckQueries(deck);
    },
    onError: onDeckError,
  });
  const regenerateSlideMutation = useMutation({
    mutationFn: async (slideId: string) => {
      await flushDraftBeforeDeckAction();
      return api.regenerateWorkflowDeckSlide(inspiration.id, node.id, slideId);
    },
    onSuccess: async () => {
      setLocalError("");
      await invalidateDeckQueries(deck);
    },
    onError: onDeckError,
  });
  const slideNotesMutation = useMutation({
    mutationFn: async (slideId: string) => {
      await flushDraftBeforeDeckAction();
      return api.generateWorkflowDeckSlideSpeakerNotes(inspiration.id, node.id, slideId);
    },
    onSuccess: async () => {
      setLocalError("");
      await invalidateDeckQueries(deck);
    },
    onError: onDeckError,
  });
  const enhanceMaterialMutation = useMutation({
    mutationFn: async (slideId: string) => {
      await flushDraftBeforeDeckAction();
      return api.enhanceWorkflowDeckSlideMaterial(inspiration.id, node.id, slideId, {});
    },
    onSuccess: async () => {
      setLocalError("");
      await invalidateDeckQueries(deck);
    },
    onError: onDeckError,
  });
  const sampleMutation = useMutation({
    mutationFn: async () => {
      await flushDraftBeforeDeckAction();
      return api.generateWorkflowDeckSample(inspiration.id, node.id);
    },
    onSuccess: async (nextDeck) => {
      setLocalError("");
      await invalidateDeckQueries(nextDeck);
    },
    onError: onDeckError,
  });
  const generateMutation = useMutation({
    mutationFn: async () => {
      await flushDraftBeforeDeckAction();
      return api.generateWorkflowDeck(inspiration.id, node.id);
    },
    onSuccess: async (nextDeck) => {
      setLocalError("");
      await invalidateDeckQueries(nextDeck);
    },
    onError: onDeckError,
  });
  const bindMutation = useMutation({
    mutationFn: (input: { slideId: string; sourceItemId: string }) =>
      api.bindWorkflowDeckSlideMaterial(inspiration.id, node.id, input.slideId, {
        source_item_id: input.sourceItemId,
        target_slot: "visual",
      }),
    onSuccess: async () => {
      setLocalError("");
      setBindingSlideId(null);
      await invalidateDeckQueries(deck);
    },
    onError: onDeckError,
  });
  const unbindMutation = useMutation({
    mutationFn: (slideId: string) =>
      api.unbindWorkflowDeckSlideMaterial(inspiration.id, node.id, slideId),
    onSuccess: async () => {
      setLocalError("");
      await invalidateDeckQueries(deck);
    },
    onError: onDeckError,
  });
  const exportMutation = useMutation({
    mutationFn: async () => {
      if (!deck || deck.generated_slide_count <= 0) {
        throw new Error(t("detail.deck.noGeneratedSlides"));
      }
      await exportDeckAsPptx(deck, { onProgress: setPptxProgress });
    },
    onSuccess: () => {
      setLocalError("");
      setPptxProgress(null);
    },
    onError: (error) => {
      setPptxProgress(null);
      onDeckError(error);
    },
  });
  const generating = deckIsActive(deck);
  const actionBusy =
    busy ||
    generating ||
    refreshSourcesMutation.isPending ||
    outlineMutation.isPending ||
    styleMutation.isPending ||
    metadataMutation.isPending ||
    reorderMutation.isPending ||
    updateSlideMutation.isPending ||
    regenerateSlideMutation.isPending ||
    slideNotesMutation.isPending ||
    enhanceMaterialMutation.isPending ||
    sampleMutation.isPending ||
    generateMutation.isPending ||
    bindMutation.isPending ||
    exportMutation.isPending;

  const commitDeckTitle = () => {
    if (!deck || metadataMutation.isPending) {
      return;
    }
    const nextTitle = deckTitleDraft.trim();
    if (!nextTitle) {
      setDeckTitleDraft(deck.title);
      return;
    }
    if (nextTitle !== deck.title) {
      metadataMutation.mutate({ title: nextTitle });
    }
  };

  const moveSlide = (slideId: string, direction: -1 | 1) => {
    if (!deck || reorderMutation.isPending) {
      return;
    }
    const slideIds = deck.slides.map((slide) => slide.id);
    const index = slideIds.indexOf(slideId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= slideIds.length) {
      return;
    }
    [slideIds[index], slideIds[nextIndex]] = [slideIds[nextIndex], slideIds[index]];
    reorderMutation.mutate(slideIds);
  };

  const setDeckSourceSelection = (sourceItemId: string, selected: boolean) => {
    const excludedSet = new Set(draft.deckExcludedSourceItemIds);
    if (selected) {
      excludedSet.delete(sourceItemId);
    } else {
      excludedSet.add(sourceItemId);
    }
    onDraftChange({
      ...draft,
      deckExcludedSourceItemIds: Array.from(excludedSet),
      deckSourceOrder: draft.deckSourceOrder.includes(sourceItemId)
        ? draft.deckSourceOrder
        : [...draft.deckSourceOrder, sourceItemId],
    });
  };

  const moveDeckSource = (sourceItemId: string, direction: -1 | 1) => {
    const currentOrder = availableSources.map((source) => source.source_item_id);
    const index = currentOrder.indexOf(sourceItemId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= currentOrder.length) {
      return;
    }
    [currentOrder[index], currentOrder[nextIndex]] = [currentOrder[nextIndex], currentOrder[index]];
    onDraftChange({
      ...draft,
      deckSourceOrder: currentOrder,
    });
  };
  const handleOutlineSlideDraftChange = useCallback(
    (slideId: string, payload: { title: string; points: string[] }) => {
      setOutlineSlideDrafts((current) => {
        const previous = current[slideId];
        if (
          previous &&
          previous.title === payload.title &&
          stringArraysEqual(previous.points, payload.points)
        ) {
          return current;
        }
        return {
          ...current,
          [slideId]: payload,
        };
      });
    },
    [],
  );

  return (
    <div className="space-y-4">
      {localError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200">
          <AlertCircle size={13} className="mr-1.5 inline" />
          {localError}
        </div>
      ) : null}
      <ResourceGroupSelector
        label={t("detail.inspector.resourceGroup")}
        draft={draft}
        resourceGroups={resourceGroups}
        onDraftChange={onDraftChange}
        t={t}
      />
      <div className="grid gap-3">
        <GenerationConfigSelector
          label={t("detail.inspector.textGenerationConfig")}
          helpKey="copyTextGenerationConfig"
          mode={draft.deckTextGenerationConfigMode}
          generationConfigId={draft.deckTextGenerationConfigId}
          options={textGenerationConfigOptions}
          onDraftChange={(next) =>
            onDraftChange({
              ...draft,
              deckTextGenerationConfigMode: next.mode,
              deckTextGenerationConfigId: next.generationConfigId,
            })
          }
          t={t}
        />
        <GenerationConfigSelector
          label={t("detail.inspector.imageGenerationConfig")}
          helpKey="imageGenerationConfig"
          mode={draft.deckImageGenerationConfigMode}
          generationConfigId={draft.deckImageGenerationConfigId}
          options={imageGenerationConfigOptions}
          onDraftChange={(next) =>
            onDraftChange({
              ...draft,
              deckImageGenerationConfigMode: next.mode,
              deckImageGenerationConfigId: next.generationConfigId,
            })
          }
          t={t}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <FieldLabel label={t("detail.deck.planningStrategy")} />
          <LayoutSelectField
            value={draft.deckPlanningStrategy}
            options={[
              { value: "hybrid", label: t("detail.deck.planningStrategy.hybrid") },
              { value: "copy_led", label: t("detail.deck.planningStrategy.copyLed") },
              { value: "image_led", label: t("detail.deck.planningStrategy.imageLed") },
            ]}
            onChange={(value) =>
              onDraftChange({
                ...draft,
                deckPlanningStrategy: value as NodeConfigDraft["deckPlanningStrategy"],
              })
            }
            ariaLabel={t("detail.deck.planningStrategy")}
            radius="lg"
            visualSize="sm"
          />
        </label>
        <label className="block">
          <FieldLabel label={t("detail.deck.slideCountMode")} />
          <LayoutSelectField
            value={draft.deckSlideCountMode}
            options={[
              { value: "auto", label: t("detail.deck.slideCountMode.auto") },
              { value: "target", label: t("detail.deck.slideCountMode.target") },
            ]}
            onChange={(value) =>
              onDraftChange({
                ...draft,
                deckSlideCountMode: value as NodeConfigDraft["deckSlideCountMode"],
              })
            }
            ariaLabel={t("detail.deck.slideCountMode")}
            radius="lg"
            visualSize="sm"
          />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block">
          <FieldLabel label={t("detail.deck.style")} />
          <LayoutSelectField
            value={draft.deckStyleKey}
            options={styles.map((style) => ({ value: style.key, label: style.label }))}
            onChange={(value) => {
              onDraftChange({ ...draft, deckStyleKey: value });
              if (deck) {
                styleMutation.mutate(value);
              }
            }}
            ariaLabel={t("detail.deck.style")}
            radius="lg"
            visualSize="sm"
          />
        </label>
        <label className="block">
          <FieldLabel label={t("detail.deck.slideImageSize")} />
          <LayoutSelectField
            value={draft.deckSlideSize ?? ""}
            options={[
              { value: "", label: t("detail.deck.slideImageSize.default") },
              ...DECK_SLIDE_SIZE_OPTIONS,
            ]}
            onChange={(value) => onDraftChange({ ...draft, deckSlideSize: value || null })}
            ariaLabel={t("detail.deck.slideImageSize")}
            radius="lg"
            visualSize="sm"
          />
        </label>
        <label className="block">
          <FieldLabel label={t("detail.deck.maxSlides")} />
          <LayoutTextInput
            type="number"
            min={1}
            max={50}
            value={draft.deckMaxSlides}
            disabled={draft.deckSlideCountMode !== "target"}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                deckMaxSlides: Math.max(1, Math.min(50, Number.parseInt(event.target.value || "8", 10))),
              })
            }
            size="default"
          />
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <FieldLabel label={t("detail.deck.groupBy")} />
          <LayoutSelectField
            value={draft.deckGroupBy}
            options={[
              { value: "tail_item", label: t("detail.deck.groupBy.tailItem") },
              { value: "source_node", label: t("detail.deck.groupBy.sourceNode") },
            ]}
            onChange={(value) =>
              onDraftChange({
                ...draft,
                deckGroupBy: value as NodeConfigDraft["deckGroupBy"],
              })
            }
            ariaLabel={t("detail.deck.groupBy")}
            radius="lg"
            visualSize="sm"
          />
        </label>
        <label className="block">
          <FieldLabel label={t("detail.deck.perGroupImageCap")} />
          <LayoutTextInput
            type="number"
            min={1}
            max={12}
            value={draft.deckPerGroupImageCap}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                deckPerGroupImageCap: Math.max(1, Math.min(12, Number.parseInt(event.target.value || "3", 10))),
              })
            }
            size="default"
          />
        </label>
        <LayoutCheckbox
          checked={draft.deckSectionPages}
          onChange={(event) => onDraftChange({ ...draft, deckSectionPages: event.target.checked })}
          variant="card"
        >
          {t("detail.deck.sectionPages")}
        </LayoutCheckbox>
      </div>
      <LayoutCheckbox
        checked={draft.deckIncludeTransitiveInputs}
        onChange={(event) => onDraftChange({ ...draft, deckIncludeTransitiveInputs: event.target.checked })}
        variant="card"
      >
        {t("detail.deck.includeTransitive")}
      </LayoutCheckbox>
      {!deck ? (
        <label className="block">
          <FieldLabel label={t("detail.deck.deckTitle")} />
          <LayoutTextInput
            type="text"
            value={deckTitleDraft}
            disabled={actionBusy}
            onChange={(event) => setDeckTitleDraft(event.target.value)}
            size="default"
            placeholder={t("detail.deck.deckTitle")}
          />
        </label>
      ) : null}
      <InspectorTextArea
        label={t("detail.deck.sourceInput")}
        value={draft.deckSourceInput}
        onChange={(value) => onDraftChange({ ...draft, deckSourceInput: value })}
        minRows={3}
        maxRows={6}
        placeholder={t("detail.deck.sourceInputPlaceholder")}
      />
      <div className="rounded-xl border pf-hairline bg-[rgba(255,255,255,0.8)] p-3 dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)]">
        <div className="mb-2 flex items-center justify-between gap-2">
          <FieldLabel label={t("detail.deck.sources")} className="text-xs font-semibold pf-ink-muted dark:text-[color:var(--pf-muted)]" />
          <ActionButton
            disabled={actionBusy}
            onClick={() => refreshSourcesMutation.mutate()}
            preset="secondary"
            size="sm"
            loading={refreshSourcesMutation.isPending}
            leadingIcon={<RefreshCcw size={12} />}
          >
            {t("detail.deck.refreshSources")}
          </ActionButton>
        </div>
        <AsyncContent
          state={sourcesViewState}
          refreshIntent="background"
          loadingLabel={t("app.loading")}
          skeleton={(
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" rounded="lg" />
              <Skeleton className="h-8 w-full" rounded="lg" />
            </div>
          )}
          initialError={(
            <AsyncErrorState
              title={t("detail.deck.sourcesLoadFailed")}
              retryLabel={t("common.retry")}
              retryingLabel={t("app.loading")}
              retrying={sourcesViewState.fetch === "fetching"}
              onRetry={() => void sourcesQuery.refetch()}
            />
          )}
          paused={(
            <AsyncPausedState
              title={t("app.requestPaused.title")}
              message={t("app.requestPaused.message")}
              retryLabel={t("common.retry")}
              onRetry={() => void sourcesQuery.refetch()}
            />
          )}
          inactive={null}
          empty={(
            <div className="rounded-lg border border-dashed pf-hairline-strong px-3 py-5 text-center text-xs pf-ink-muted dark:border-[color:var(--pf-border)] dark:text-[color:var(--pf-muted)]">
              {t("detail.deck.noSources")}
            </div>
          )}
          refreshFeedback={sourcesViewState.error === "refresh" ? (
            <AsyncErrorState
              className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-100"
              title={t("detail.deck.sourcesLoadFailed")}
              retryLabel={t("common.retry")}
              retryingLabel={t("app.loading")}
              retrying={sourcesViewState.fetch === "fetching"}
              onRetry={() => void sourcesQuery.refetch()}
            />
          ) : null}
        >
          <>
            {availableSources.length ? (
              <div className="space-y-3">
                <DeckSourceSection
                  title={t("detail.deck.primarySources")}
                  emptyLabel={t("detail.deck.noPrimarySources")}
                  sources={sourcePartitions.primarySources}
                  orderedSourceIds={availableSources.map((source) => source.source_item_id)}
                  actionBusy={actionBusy}
                  onPreviewImage={onPreviewImage}
                  onToggleSelection={setDeckSourceSelection}
                  onMoveSource={moveDeckSource}
                  t={t}
                />
                <DeckSourceSection
                  title={t("detail.deck.alternateSources")}
                  emptyLabel={t("detail.deck.noAlternateSources")}
                  sources={sourcePartitions.alternateSources}
                  orderedSourceIds={availableSources.map((source) => source.source_item_id)}
                  actionBusy={actionBusy}
                  onPreviewImage={onPreviewImage}
                  onToggleSelection={setDeckSourceSelection}
                  onMoveSource={moveDeckSource}
                  t={t}
                />
              </div>
            ) : (
              <div className="rounded-lg border border-dashed pf-hairline-strong px-3 py-5 text-center text-xs pf-ink-muted dark:border-[color:var(--pf-border)] dark:text-[color:var(--pf-muted)]">
                {t("detail.deck.noSources")}
              </div>
            )}
            {unavailableSources.length ? (
              <div className="mt-3 space-y-1.5">
                <div className="text-[11px] font-medium text-amber-700 dark:text-amber-200">
                  {t("detail.deck.unavailableSources", { count: unavailableSources.length })}
                </div>
                {unavailableSources.map((source) => (
                  <div
                    key={source.source_item_id}
                    className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-100"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-semibold">{source.workflow_node_title}</span>
                      {source.kind ? (
                        <span className="shrink-0 rounded-full border border-amber-200 bg-[rgba(255,255,255,0.8)] px-2 py-0.5 text-[10px] text-amber-700 dark:border-amber-300/20 dark:bg-[color:var(--pf-deep)] dark:text-amber-100">
                          {deckSourceKindLabel(source.kind, t)}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1">{deckUnavailableReasonLabel(source.reason, t)}</div>
                    {source.summary ? <div className="mt-1 opacity-80">{source.summary}</div> : null}
                  </div>
                ))}
              </div>
            ) : null}
            {sourcesQuery.data?.source_stale ? (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-100">
                {t("detail.deck.sourceStale")}
              </div>
            ) : null}
          </>
        </AsyncContent>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <ActionButton
          disabled={actionBusy}
          onClick={() => outlineMutation.mutate()}
          title={t("detail.deck.outline")}
          preset={deck ? "secondary" : "primary"}
          size="md"
          loading={outlineMutation.isPending}
          leadingIcon={<Settings2 size={13} />}
        >
          {deck ? t("detail.deck.refreshOutline") : t("detail.deck.outline")}
        </ActionButton>
        <ActionButton
          disabled={actionBusy || !deck || generating}
          onClick={() => sampleMutation.mutate()}
          preset="secondary"
          size="md"
          loading={sampleMutation.isPending}
          leadingIcon={<Wand2 size={13} />}
        >
          {t("detail.deck.sample")}
        </ActionButton>
        <ActionButton
          disabled={actionBusy || !deck || generating}
          onClick={() => generateMutation.mutate()}
          preset="primary"
          size="md"
          loading={generateMutation.isPending || generating}
          leadingIcon={<Sparkles size={13} />}
        >
          {generating ? t("detail.deck.generating") : t("detail.deck.generate")}
        </ActionButton>
      </div>
      {deck ? (
        <div className="rounded-xl border pf-hairline bg-[rgba(255,255,255,0.8)] p-3 dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)]">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <label className="block">
                <FieldLabel label={t("detail.deck.deckTitle")} />
                <LayoutTextInput
                  type="text"
                  value={deckTitleDraft}
                  disabled={metadataMutation.isPending}
                  onChange={(event) => setDeckTitleDraft(event.target.value)}
                  onBlur={commitDeckTitle}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur();
                    }
                  }}
                  size="compact"
                  className="font-semibold"
                  placeholder={t("detail.deck.deckTitle")}
                />
              </label>
              <div className="text-[11px] pf-ink-muted dark:text-[color:var(--pf-muted)]">
                {t(DECK_STATUS_LABEL_KEYS[deck.status])} · {t("detail.deck.slideCount", { count: deck.slides.length })} · {t("detail.deck.generatedCount", { count: deck.generated_slide_count })}
              </div>
              <LayoutCheckbox
                checked={deck.speaker_notes_enabled}
                disabled={metadataMutation.isPending}
                onChange={(event) => metadataMutation.mutate({ speaker_notes_enabled: event.target.checked })}
                size="sm"
                wrapperClassName="mt-2 text-[11px] font-medium pf-ink-muted dark:text-[color:var(--pf-muted)]"
              >
                {t("detail.deck.speakerNotesEnabled")}
              </LayoutCheckbox>
            </div>
            {deck.generated_slide_count > 0 ? (
              <ActionButton
                disabled={exportMutation.isPending}
                onClick={() => exportMutation.mutate()}
                preset="secondary"
                size="sm"
                loading={exportMutation.isPending}
                leadingIcon={<Download size={12} />}
              >
                {exportMutation.isPending && pptxProgress
                  ? t("detail.deck.exportingPptx", pptxProgress)
                  : t("detail.deck.exportPptx")}
              </ActionButton>
            ) : null}
          </div>
          <div className="space-y-2">
            {deck.slides.map((slide, index) => (
              <DeckNodeSlideRow
                key={slide.id}
                slide={slide}
                index={index}
                canMoveUp={index > 0}
                canMoveDown={index < deck.slides.length - 1}
                availableSources={availableSources}
                bindableSources={bindableSources}
                bindingSlideId={bindingSlideId}
                slideId={slide.id}
                onSetBindingSlideId={setBindingSlideId}
                onMoveUp={() => moveSlide(slide.id, -1)}
                onMoveDown={() => moveSlide(slide.id, 1)}
                onUpdate={(payload) => updateSlideMutation.mutate({ slideId: slide.id, payload })}
                onRegenerate={() => regenerateSlideMutation.mutate(slide.id)}
                onGenerateNotes={() => slideNotesMutation.mutate(slide.id)}
                onEnhanceMaterial={() => enhanceMaterialMutation.mutate(slide.id)}
                onBind={(sourceItemId) => bindMutation.mutate({ slideId: slide.id, sourceItemId })}
                onUnbind={() => unbindMutation.mutate(slide.id)}
                onDraftChange={handleOutlineSlideDraftChange}
                onPreviewImage={onPreviewImage}
                actionBusy={actionBusy}
                updateBusy={updateSlideMutation.isPending && updateSlideMutation.variables?.slideId === slide.id}
                regenerateBusy={regenerateSlideMutation.isPending && regenerateSlideMutation.variables === slide.id}
                notesBusy={slideNotesMutation.isPending && slideNotesMutation.variables === slide.id}
                enhanceBusy={enhanceMaterialMutation.isPending && enhanceMaterialMutation.variables === slide.id}
                bindingBusy={bindMutation.isPending && bindMutation.variables?.slideId === slide.id}
                unbindBusy={unbindMutation.isPending && unbindMutation.variables === slide.id}
                t={t}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DeckNodeSlideRow({
  slide,
  index,
  canMoveUp,
  canMoveDown,
  availableSources,
  bindableSources,
  bindingSlideId,
  slideId,
  onSetBindingSlideId,
  onMoveUp,
  onMoveDown,
  onUpdate,
  onRegenerate,
  onGenerateNotes,
  onEnhanceMaterial,
  onBind,
  onUnbind,
  onDraftChange,
  onPreviewImage,
  actionBusy,
  updateBusy,
  regenerateBusy,
  notesBusy,
  enhanceBusy,
  bindingBusy,
  unbindBusy,
  t,
}: {
  slide: DeckSlide;
  index: number;
  canMoveUp: boolean;
  canMoveDown: boolean;
  availableSources: DeckSourceItem[];
  bindableSources: DeckSourceItem[];
  bindingSlideId: string | null;
  slideId: string;
  onSetBindingSlideId: (slideId: string | null) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onUpdate: (payload: { title?: string; points?: string[]; speaker_notes?: string }) => void;
  onRegenerate: () => void;
  onGenerateNotes: () => void;
  onEnhanceMaterial: () => void;
  onBind: (sourceItemId: string) => void;
  onUnbind: () => void;
  onDraftChange: (slideId: string, payload: { title: string; points: string[] }) => void;
  onPreviewImage: (image: DownloadableImage) => void;
  actionBusy: boolean;
  updateBusy: boolean;
  regenerateBusy: boolean;
  notesBusy: boolean;
  enhanceBusy: boolean;
  bindingBusy: boolean;
  unbindBusy: boolean;
  t: TFunction;
}) {
  const [titleDraft, setTitleDraft] = useState(slide.title);
  const [pointsDraft, setPointsDraft] = useState(deckPointsDraft(slide.points));
  const [notesDraft, setNotesDraft] = useState(slide.speaker_notes ?? "");
  const slidePlan = readDeckSlideSourcePlan(slide);
  const selectedSourceItemId = slidePlan.selectedSourceItemId ?? "";
  const bindingOpen = bindingSlideId === slide.id;
  const groupLabel = slidePlan.groupLabel ?? deckGroupLabel(slidePlan.groupId, t);
  const plannedSourceRefs = slidePlan.sourceRefIds.map((sourceItemId) => ({
    sourceItemId,
    source: availableSources.find((candidate) => candidate.source_item_id === sourceItemId) ?? null,
  }));
  const selectedBoundSource =
    availableSources.find((source) => source.source_item_id === selectedSourceItemId) ?? null;
  const generatedImage = deckGeneratedSlidePreviewImage(slide, t);
  const materialPreviewImage = deckMaterialPreviewImage(slide, selectedBoundSource, t);
  const hasPreviewRail = Boolean(generatedImage || materialPreviewImage);

  useEffect(() => {
    setTitleDraft(slide.title);
    setPointsDraft(deckPointsDraft(slide.points));
    setNotesDraft(slide.speaker_notes ?? "");
  }, [slide.id, slide.title, slide.points, slide.speaker_notes]);
  useEffect(() => {
    onDraftChange(slideId, {
      title: titleDraft,
      points: deckPointsFromDraft(pointsDraft),
    });
  }, [onDraftChange, pointsDraft, slideId, titleDraft]);

  const commitSlideDraft = () => {
    if (updateBusy) {
      return;
    }
    const nextTitle = titleDraft.trim();
    const nextPoints = deckPointsFromDraft(pointsDraft);
    const nextNotes = notesDraft;
    const payload: { title?: string; points?: string[]; speaker_notes?: string } = {};
    if (nextTitle && nextTitle !== slide.title) {
      payload.title = nextTitle;
    }
    if (!nextTitle) {
      setTitleDraft(slide.title);
    }
    if (!stringArraysEqual(nextPoints, slide.points)) {
      payload.points = nextPoints;
    }
    if (nextNotes !== (slide.speaker_notes ?? "")) {
      payload.speaker_notes = nextNotes;
    }
    if (Object.keys(payload).length) {
      onUpdate(payload);
    }
  };

  return (
    <div className="rounded-lg border pf-hairline pf-surface-soft px-2.5 py-2 dark:border-[color:var(--pf-border)] dark:bg-[#0b1220]">
      <div className={`grid gap-3 ${hasPreviewRail ? "lg:grid-cols-[minmax(0,1fr)_11.5rem]" : ""}`}>
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full pf-surface text-[11px] font-semibold pf-ink-muted shadow-sm dark:bg-[color:var(--pf-deep)] dark:text-[color:var(--pf-muted)]">
                {index + 1}
              </span>
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold pf-ink-muted dark:text-[color:var(--pf-muted)]">
                  {titleDraft || slide.title}
                </div>
                <div className="mt-0.5 text-[11px] pf-ink-muted dark:text-[color:var(--pf-muted)]">
                  {t(DECK_SLIDE_STATUS_LABEL_KEYS[slide.slide_status])}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-1">
              <ActionButton
                disabled={actionBusy || !canMoveUp}
                onClick={onMoveUp}
                aria-label={t("detail.deck.moveUp")}
                title={t("detail.deck.moveUp")}
                preset="secondary"
                size="icon-sm"
                leadingIcon={<ChevronUp size={13} />}
              />
              <ActionButton
                disabled={actionBusy || !canMoveDown}
                onClick={onMoveDown}
                aria-label={t("detail.deck.moveDown")}
                title={t("detail.deck.moveDown")}
                preset="secondary"
                size="icon-sm"
                leadingIcon={<ChevronDown size={13} />}
              />
              <ActionButton
                disabled={actionBusy}
                onClick={commitSlideDraft}
                aria-label={t("detail.deck.saveSlide")}
                title={t("detail.deck.saveSlide")}
                preset="secondary"
                size="icon-sm"
                loading={updateBusy}
                leadingIcon={<Save size={13} />}
              />
              <ActionButton
                disabled={actionBusy || slide.slide_status === "queued" || slide.slide_status === "running"}
                onClick={onRegenerate}
                aria-label={t("detail.deck.regenerateSlide")}
                title={t("detail.deck.regenerateSlide")}
                preset="secondary"
                size="icon-sm"
                loading={regenerateBusy}
                leadingIcon={<Wand2 size={13} />}
              />
              <ActionButton
                disabled={actionBusy}
                onClick={onGenerateNotes}
                aria-label={t("detail.deck.generateSpeakerNotes")}
                title={t("detail.deck.generateSpeakerNotes")}
                preset="secondary"
                size="icon-sm"
                loading={notesBusy}
                leadingIcon={<FileText size={13} />}
              />
              <ActionButton
                disabled={actionBusy || !slide.material_url}
                onClick={onEnhanceMaterial}
                aria-label={t("detail.deck.enhanceMaterial")}
                title={t("detail.deck.enhanceMaterial")}
                preset="secondary"
                size="icon-sm"
                loading={enhanceBusy}
                leadingIcon={<Sparkles size={13} />}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <label className="block">
              <FieldLabel label={t("detail.deck.slideTitle")} />
              <LayoutTextInput
                type="text"
                value={titleDraft}
                disabled={actionBusy}
                onChange={(event) => setTitleDraft(event.target.value)}
                onBlur={commitSlideDraft}
                size="compact"
                placeholder={t("detail.deck.slideTitle")}
              />
            </label>
            <label className="block">
              <FieldLabel label={t("detail.deck.slidePoints")} />
              <LayoutTextarea
                value={pointsDraft}
                disabled={actionBusy}
                onChange={(event) => setPointsDraft(event.target.value)}
                onBlur={commitSlideDraft}
                size="compact"
                minRows={3}
                placeholder={t("detail.deck.slidePointsPlaceholder")}
              />
            </label>
            <label className="block">
              <FieldLabel label={t("detail.deck.speakerNotes")} />
              <LayoutTextarea
                value={notesDraft}
                disabled={actionBusy}
                onChange={(event) => setNotesDraft(event.target.value)}
                onBlur={commitSlideDraft}
                size="compact"
                minRows={3}
                placeholder={t("detail.deck.speakerNotesPlaceholder")}
              />
            </label>
            {slidePlan.pageType ||
            slidePlan.captionSource ||
            groupLabel ||
            plannedSourceRefs.length ||
            slidePlan.materialHint ||
            selectedSourceItemId ? (
              <div className="border-t pf-hairline pt-2 text-[11px] dark:border-[color:var(--pf-border)]">
                <div className="flex flex-wrap gap-1">
                  {slidePlan.pageType ? <DeckMetaChip label={deckPageTypeLabel(slidePlan.pageType, t)} /> : null}
                  {groupLabel ? <DeckMetaChip label={groupLabel} title={slidePlan.groupId ?? undefined} /> : null}
                  {slidePlan.captionSource ? <DeckMetaChip label={deckCaptionSourceLabel(slidePlan.captionSource, t)} /> : null}
                </div>
                {plannedSourceRefs.length ? (
                  <div className="mt-2">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest pf-ink-muted dark:text-[color:var(--pf-muted)]">
                      {t("detail.deck.plannedSources")}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {plannedSourceRefs.map(({ sourceItemId, source }) => (
                        <DeckMetaChip
                          key={sourceItemId}
                          label={source ? deckSourceBadgeLabel(source, t) : sourceItemId}
                          title={sourceItemId}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
                {selectedSourceItemId ? (
                  <div className="mt-2">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest pf-ink-muted dark:text-[color:var(--pf-muted)]">
                      {t("detail.deck.currentMaterial")}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <DeckMetaChip
                        label={selectedBoundSource ? deckSourceBadgeLabel(selectedBoundSource, t) : selectedSourceItemId}
                        title={selectedSourceItemId}
                      />
                    </div>
                  </div>
                ) : null}
                {slidePlan.materialHint ? (
                  <div className="mt-2">
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest pf-ink-muted dark:text-[color:var(--pf-muted)]">
                      {t("detail.deck.materialHint")}
                    </div>
                    <div className="leading-5 pf-ink-muted dark:text-[color:var(--pf-muted)]">{slidePlan.materialHint}</div>
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="flex items-center gap-1.5">
              <ActionButton
                disabled={actionBusy}
                onClick={() => onSetBindingSlideId(bindingOpen ? null : slide.id)}
                preset="secondary"
                size="sm"
                leadingIcon={<ImageIcon size={12} />}
              >
                {selectedSourceItemId ? t("detail.deck.changeMaterial") : t("detail.deck.bindMaterial")}
              </ActionButton>
              {selectedSourceItemId ? (
                <ActionButton
                  disabled={actionBusy || unbindBusy}
                  onClick={() => onUnbind()}
                  preset="danger"
                  size="sm"
                  loading={unbindBusy}
                >
                  {t("detail.deck.unbindMaterial")}
                </ActionButton>
              ) : null}
            </div>
          </div>
        </div>
        {hasPreviewRail ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
            <DeckPreviewSurface
              label={t("detail.deck.generatedImage")}
              image={generatedImage}
              caption={slide.image_width && slide.image_height ? `${slide.image_width}x${slide.image_height}` : null}
              emptyLabel={t(DECK_SLIDE_STATUS_LABEL_KEYS[slide.slide_status])}
              onPreviewImage={onPreviewImage}
              t={t}
            />
            {materialPreviewImage ? (
              <DeckPreviewSurface
                label={t("detail.deck.currentMaterial")}
                image={materialPreviewImage}
                thumbnailUrl={
                  slide.material_url
                    ? toImageUrl(slide.material_url)
                    : selectedBoundSource
                      ? toImageUrl(
                          selectedBoundSource.thumbnail_url,
                          selectedBoundSource.preview_url,
                          selectedBoundSource.download_url,
                        )
                      : undefined
                }
                caption={selectedBoundSource ? deckSourceBadgeLabel(selectedBoundSource, t) : null}
                emptyLabel={t("detail.deck.bindMaterial")}
                aspectClassName="aspect-[4/3]"
                onPreviewImage={onPreviewImage}
                t={t}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      {bindingOpen ? (
        <div className="mt-2 grid gap-1.5">
          {bindableSources.length ? (
            bindableSources.map((source) => {
              const previewImage = deckSourcePreviewImage(source, t);
              const isSelected = selectedSourceItemId === source.source_item_id;
              return (
                <div
                  key={source.source_item_id}
                  className={`flex items-center justify-between gap-2 rounded-lg border px-2 py-2 text-[11px] transition-colors ${
                    isSelected
                      ? "border-blue-300 bg-blue-50 text-blue-700 dark:border-sky-300/40 dark:bg-sky-400/15 dark:text-sky-100"
                      : "pf-hairline pf-surface pf-ink-muted dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)] dark:text-[color:var(--pf-muted)]"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {previewImage ? (
                      <MediaPreviewTrigger
                        onPreview={() => onPreviewImage(previewImage)}
                        className="group relative h-11 w-11 shrink-0 overflow-hidden rounded-md"
                        aria-label={t("detail.previewImage", { alt: previewImage.alt })}
                        title={t("detail.previewImage", { alt: previewImage.alt })}
                      >
                        <img
                          src={toImageUrl(source.thumbnail_url, source.preview_url, source.download_url)}
                          alt={previewImage.alt}
                          className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.03]"
                        />
                      </MediaPreviewTrigger>
                    ) : (
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-dashed pf-hairline-strong pf-surface-soft pf-ink-muted dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)] dark:text-[color:var(--pf-muted)]">
                        <ImageIcon size={14} />
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{source.workflow_node_title}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1">
                        <DeckMetaChip label={deckSourceKindLabel(source.kind, t)} />
                        {source.group_id ? (
                          <DeckMetaChip label={deckGroupLabel(source.group_id, t) ?? source.group_id} />
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <ActionButton
                    disabled={bindingBusy || isSelected}
                    onClick={() => onBind(source.source_item_id)}
                    preset="secondary"
                    size="sm"
                    aria-pressed={isSelected}
                    loading={bindingBusy && isSelected}
                  >
                    {isSelected ? t("detail.deck.currentMaterial") : t("detail.deck.bindMaterial")}
                  </ActionButton>
                </div>
              );
            })
          ) : (
            <div className="rounded-lg border border-dashed pf-hairline-strong px-2 py-2 text-[11px] pf-ink-muted dark:border-[color:var(--pf-border)] dark:text-[color:var(--pf-muted)]">
              {t("detail.deck.noBindableSources")}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function GenerationConfigSelector({
  label,
  helpKey,
  mode,
  generationConfigId,
  options,
  onDraftChange,
  t,
}: {
  label: string;
  helpKey: ParameterHelpKey;
  mode: "auto" | "manual";
  generationConfigId: string | null;
  options: GenerationConfigOption[];
  onDraftChange: (next: { mode: "auto" | "manual"; generationConfigId: string | null }) => void;
  t: TFunction;
}) {
  return (
    <div className="space-y-2 rounded-xl border pf-hairline pf-surface-soft px-3 py-3 dark:border-[color:var(--pf-border)] dark:bg-[#0b1220]">
      <FieldLabel
        label={label}
        helpKey={helpKey}
        className="text-xs font-semibold pf-ink-muted dark:text-[color:var(--pf-muted)]"
      />
      <div className="grid gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <LayoutSelectField
          value={mode}
          options={[
            { value: "auto", label: t("detail.inspector.generationConfigAuto") },
            { value: "manual", label: t("detail.inspector.generationConfigManual") },
          ]}
          onChange={(value) => {
            const nextMode = value === "manual" ? "manual" : "auto";
            onDraftChange({
              mode: nextMode,
              generationConfigId: nextMode === "manual" ? generationConfigId : null,
            });
          }}
          ariaLabel={label}
          radius="lg"
          visualSize="sm"
        />
        <LayoutSelectField
          value={mode === "manual" ? (generationConfigId ?? "") : ""}
          options={[
            {
              value: "",
              label: options.length
                ? t("detail.inspector.selectGenerationConfig")
                : t("detail.inspector.noGenerationConfigs"),
              disabled: true,
            },
            ...options.map((config) => ({
              value: config.id,
              label: generationConfigOptionLabel(
                config,
                t("detail.inspector.generationConfigDisabled"),
                t("detail.inspector.generationConfigFrozen"),
              ),
              disabled: !config.enabled,
            })),
          ]}
          onChange={(value) => onDraftChange({ mode, generationConfigId: value || null })}
          ariaLabel={label}
          radius="lg"
          visualSize="sm"
          disabled={mode !== "manual"}
        />
      </div>
    </div>
  );
}

function CopyNodeInspector({
  node,
  draft,
  resourceGroups,
  generationConfigOptions,
  onDraftChange,
  t,
}: {
  node: WorkflowNode;
  draft: NodeConfigDraft;
  resourceGroups: GenerationResourceGroup[];
  generationConfigOptions: GenerationConfigOption[];
  onDraftChange: (draft: NodeConfigDraft) => void;
  t: TFunction;
}) {
  const hasCopy = Boolean(
    node.output_json && outputText(node.output_json, "copy_set_id"),
  );
  const copyPayload = draft.copyStructuredPayload;
  return (
    <div className="space-y-3">
      <InspectorTextArea
        label={t("detail.inspector.copyInstruction")}
        value={draft.instruction}
        onChange={(value) => onDraftChange({ ...draft, instruction: value })}
        helpKey="copyInstruction"
      />
      <ResourceGroupSelector
        label={t("detail.inspector.resourceGroup")}
        draft={draft}
        resourceGroups={resourceGroups}
        onDraftChange={onDraftChange}
        t={t}
      />
      <GenerationConfigSelector
        label={t("detail.inspector.textGenerationConfig")}
        helpKey="copyTextGenerationConfig"
        mode={draft.generationConfigMode}
        generationConfigId={draft.generationConfigId}
        options={generationConfigOptions}
        onDraftChange={(next) =>
          onDraftChange({
            ...draft,
            generationConfigMode: next.mode,
            generationConfigId: next.generationConfigId,
          })
        }
        t={t}
      />
      <div className="block">
        <FieldLabel label={t("detail.inspector.tone")} helpKey="copyTone" />
        <LayoutTextInput
          value={draft.tone}
          onChange={(event) =>
            onDraftChange({ ...draft, tone: event.target.value })
          }
          size="compact"
        />
      </div>
      <div className="block">
        <FieldLabel label={t("detail.inspector.channel")} helpKey="copyChannel" />
        <LayoutTextInput
          value={draft.channel}
          onChange={(event) =>
            onDraftChange({ ...draft, channel: event.target.value })
          }
          size="compact"
        />
      </div>
      {hasCopy ? (
        <div className="space-y-3 rounded-2xl border pf-hairline bg-[color:var(--pf-panel-soft)] p-3 dark:border-[color:var(--pf-border)] dark:bg-[#0b1220]">
          <div className="text-[10px] font-semibold uppercase tracking-widest pf-ink-muted dark:text-[color:var(--pf-muted)]">
            {t("detail.inspector.editCopy")}
          </div>
          {copyPayload ? (
            <StructuredCopyEditor
              payload={copyPayload}
              onChange={(copyStructuredPayload) => onDraftChange({ ...draft, copyStructuredPayload })}
              t={t}
            />
          ) : null}
          <div className="rounded-md border pf-hairline pf-surface-soft px-3 py-2 text-[11px] leading-5 pf-ink-muted dark:border-[color:var(--pf-border)] dark:bg-[#151f33] dark:text-[color:var(--pf-muted)]">
            {t("detail.inspector.copyAutosave")}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TailSplitterInspector({
  node,
  draft,
  tailSplitterMaxItems,
  resourceGroups,
  generationConfigOptions,
  onDraftChange,
  onCreateDeckFromTail,
  createDeckPending,
  t,
}: {
  node: WorkflowNode;
  draft: NodeConfigDraft;
  tailSplitterMaxItems: number;
  resourceGroups: GenerationResourceGroup[];
  generationConfigOptions: GenerationConfigOption[];
  onDraftChange: (draft: NodeConfigDraft) => void;
  onCreateDeckFromTail?: (tailNode: WorkflowNode) => void;
  createDeckPending?: boolean;
  t: TFunction;
}) {
  const appliedBatchCount = (node.output_json?.applied_batches as unknown[] | undefined)?.length ?? 0;

  return (
    <div className="space-y-3">
      <InspectorTextArea
        label={t("detail.inspector.tailSourceText")}
        value={draft.sourceNote}
        onChange={(sourceNote) => onDraftChange({ ...draft, sourceNote })}
        minRows={4}
        maxRows={14}
        helpKey="tailSourceText"
      />
      <InspectorTextArea
        label={t("detail.inspector.tailDescription")}
        value={draft.instruction}
        onChange={(instruction) => onDraftChange({ ...draft, instruction })}
        minRows={2}
        maxRows={10}
        helpKey="tailDescription"
      />
      <div className="block">
        <FieldLabel label={t("detail.inspector.tailMaxItems")} helpKey="tailMaxItems" />
        <LayoutTextInput
          type="number"
          min={1}
          max={tailSplitterMaxItems}
          value={draft.channel}
          onChange={(event) => onDraftChange({ ...draft, channel: event.target.value })}
          size="compact"
        />
        <span className="mt-1 block text-[11px] leading-5 pf-ink-muted dark:text-[color:var(--pf-muted)]">
          {t("detail.inspector.tailMaxItemsHint", { max: tailSplitterMaxItems })}
        </span>
      </div>
      <ResourceGroupSelector
        label={t("detail.inspector.resourceGroup")}
        draft={draft}
        resourceGroups={resourceGroups}
        onDraftChange={onDraftChange}
        t={t}
      />
      <GenerationConfigSelector
        label={t("detail.inspector.textGenerationConfig")}
        helpKey="copyTextGenerationConfig"
        mode={draft.generationConfigMode}
        generationConfigId={draft.generationConfigId}
        options={generationConfigOptions}
        onDraftChange={(next) =>
          onDraftChange({
            ...draft,
            generationConfigMode: next.mode,
            generationConfigId: next.generationConfigId,
          })
        }
        t={t}
      />
      {appliedBatchCount > 0 && onCreateDeckFromTail ? (
        <div className="rounded-xl border pf-hairline pf-surface-soft px-3 py-3 dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)]">
          <div className="text-[11px] leading-5 pf-ink-muted dark:text-[color:var(--pf-muted)]">
            {t("detail.tailPlan.createDeckDescription", { count: appliedBatchCount })}
          </div>
          <ActionButton
            onClick={() => onCreateDeckFromTail(node)}
            disabled={createDeckPending}
            preset="primary"
            size="md"
            className="mt-3"
            loading={createDeckPending}
            leadingIcon={<Presentation size={14} />}
          >
            {t("detail.tailPlan.createDeck")}
          </ActionButton>
        </div>
      ) : null}
    </div>
  );
}

function ImageEnhanceInspector({
  draft,
  imageSizeOptions,
  imageGenerationMaxDimension,
  resourceGroups,
  generationConfigOptions,
  onDraftChange,
  t,
}: {
  draft: NodeConfigDraft;
  imageSizeOptions: ImageSizeOption[];
  imageGenerationMaxDimension: number;
  resourceGroups: GenerationResourceGroup[];
  generationConfigOptions: GenerationConfigOption[];
  onDraftChange: (draft: NodeConfigDraft) => void;
  t: TFunction;
}) {
  const strategyOptions = [
    { value: "direct", label: t("enhance.strategy.direct") },
    { value: "tiled", label: t("enhance.strategy.tiled") },
  ];
  const scaleOptions = [
    { value: "2", label: "2x" },
    { value: "3", label: "3x" },
    { value: "4", label: "4x" },
  ];
  const maxTileBaseSize = Math.max(256, Math.min(2048, imageGenerationMaxDimension));
  const directSizeValue =
    imageSizeValueFromDimensions(
      draft.imageEnhanceTargetWidth,
      draft.imageEnhanceTargetHeight,
      imageGenerationMaxDimension,
    ) ?? "";
  const inputAppearance = layoutInputAppearance(useInspectorWorkspaceSubpage());

  return (
    <div className="space-y-3">
      <div className="space-y-2 rounded-xl border pf-hairline pf-surface-soft px-3 py-3 dark:border-[color:var(--pf-border)] dark:bg-[#0b1220]">
        <FieldLabel
          label={t("enhance.strategy")}
          className="text-xs font-semibold pf-ink-muted dark:text-[color:var(--pf-muted)]"
        />
        <LayoutSelectField
          value={draft.imageEnhanceStrategy}
          options={strategyOptions}
          onChange={(value) =>
            onDraftChange({
              ...draft,
              imageEnhanceStrategy: value === "tiled" ? "tiled" : "direct",
            })
          }
          ariaLabel={t("enhance.strategy")}
          radius="lg"
          visualSize="sm"
        />
        <div className="text-[11px] leading-5 pf-ink-muted dark:text-[color:var(--pf-muted)]">
          {draft.imageEnhanceStrategy === "tiled"
            ? t("enhance.strategy.tiledHelp")
            : t("enhance.strategy.directHelp")}
        </div>
      </div>

      {draft.imageEnhanceStrategy === "direct" ? (
        <div className="space-y-2 rounded-xl border pf-hairline pf-surface-soft px-3 py-3 dark:border-[color:var(--pf-border)] dark:bg-[#0b1220]">
          <FieldLabel
            label={t("enhance.directSize")}
            className="text-xs font-semibold pf-ink-muted dark:text-[color:var(--pf-muted)]"
          />
          <ImageSizePicker
            value={directSizeValue}
            presets={imageSizeOptions}
            maxDimension={imageGenerationMaxDimension}
            appearance={inputAppearance}
            onChange={(value) => {
              const parsed = parseImageSizeValue(value, imageGenerationMaxDimension);
              if (!parsed) {
                return;
              }
              onDraftChange({
                ...draft,
                imageEnhanceTargetWidth: String(parsed.width),
                imageEnhanceTargetHeight: String(parsed.height),
              });
            }}
          />
        </div>
      ) : (
        <div className="space-y-3 rounded-xl border pf-hairline pf-surface-soft px-3 py-3 dark:border-[color:var(--pf-border)] dark:bg-[#0b1220]">
          <label className="block">
            <FieldLabel label={t("enhance.tiledScale")} />
            <LayoutSelectField
              value={draft.imageEnhanceScale}
              options={scaleOptions}
              onChange={(value) =>
                onDraftChange({
                  ...draft,
                  imageEnhanceScale: value,
                })
              }
              ariaLabel={t("enhance.tiledScale")}
              radius="lg"
              visualSize="sm"
            />
          </label>
          <label className="block">
            <FieldLabel label={t("enhance.tileBaseSize")} />
            <LayoutTextInput
              type="number"
              min={256}
              max={maxTileBaseSize}
              step={128}
              value={draft.imageEnhanceTileBaseSize}
              onChange={(event) =>
                onDraftChange({
                  ...draft,
                  imageEnhanceTileBaseSize: event.target.value,
                })
              }
              size="compact"
            />
          </label>
          <div className="rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-[11px] leading-5 text-indigo-700 dark:border-violet-400/35 dark:bg-violet-500/10 dark:text-violet-100">
            {t("detail.inspector.imageEnhanceTileHint")}
          </div>
        </div>
      )}

      <ResourceGroupSelector
        label={t("detail.inspector.resourceGroup")}
        draft={draft}
        resourceGroups={resourceGroups}
        onDraftChange={onDraftChange}
        t={t}
      />
      <GenerationConfigSelector
        label={t("detail.inspector.imageGenerationConfig")}
        helpKey="imageGenerationConfig"
        mode={draft.generationConfigMode}
        generationConfigId={draft.generationConfigId}
        options={generationConfigOptions}
        onDraftChange={(next) =>
          onDraftChange({
            ...draft,
            generationConfigMode: next.mode,
            generationConfigId: next.generationConfigId,
          })
        }
        t={t}
      />
    </div>
  );
}

function StructuredCopyEditor({
  payload,
  onChange,
  t,
}: {
  payload: CopyPayloadV2;
  onChange: (payload: CopyPayloadV2) => void;
  t: TFunction;
}) {
  const content = payload.content;
  return (
    <div className="space-y-3">
      <TextArea
        label={t("detail.inspector.summary")}
        value={payload.summary}
        onChange={(summary) => onChange({ ...payload, summary })}
        minRows={1}
        maxRows={6}
      />
      {content.kind === "freeform" ? (
        <TextArea
          label={t("detail.inspector.body")}
          value={content.text}
          onChange={(text) => onChange({ ...payload, content: { kind: "freeform", text } })}
          minRows={3}
          maxRows={18}
        />
      ) : null}
      {content.kind === "blocks" ? (
        <div className="space-y-2">
          {content.blocks.map((block, index) => (
            <CopyBlockEditor
              key={block.id}
              block={block}
              onRemove={
                content.blocks.length > 1
                  ? () =>
                      onChange({
                        ...payload,
                        content: {
                          kind: "blocks",
                          blocks: content.blocks.filter((_, blockIndex) => blockIndex !== index),
                        },
                      })
                  : undefined
              }
              onChange={(nextBlock) => {
                const blocks = [...content.blocks];
                blocks[index] = nextBlock;
                onChange({ ...payload, content: { kind: "blocks", blocks } });
              }}
              t={t}
            />
          ))}
        </div>
      ) : null}
      {content.kind === "layout_brief" ? (
        <div className="space-y-2">
          {content.sections.map((section, index) => (
            <CopySectionEditor
              key={section.id}
              section={section}
              onRemove={
                content.sections.length > 1
                  ? () =>
                      onChange({
                        ...payload,
                        content: {
                          kind: "layout_brief",
                          sections: content.sections.filter((_, sectionIndex) => sectionIndex !== index),
                        },
                      })
                  : undefined
              }
              onChange={(nextSection) => {
                const sections = [...content.sections];
                sections[index] = nextSection;
                onChange({ ...payload, content: { kind: "layout_brief", sections } });
              }}
              t={t}
            />
          ))}
        </div>
      ) : null}
      <OptionalTextArea
        label={t("detail.inspector.visualGuidance")}
        value={payload.visual_guidance?.composition_hint ?? ""}
        addLabel={t("detail.inspector.addVisualGuidance")}
        placeholder={t("detail.inspector.visualGuidancePlaceholder")}
        helpKey="copyVisualGuidance"
        onChange={(composition_hint) =>
          onChange({
            ...payload,
            visual_guidance: {
              main_message: payload.visual_guidance?.main_message ?? "",
              hierarchy: payload.visual_guidance?.hierarchy ?? [],
              composition_hint,
              text_density: payload.visual_guidance?.text_density ?? "medium",
              avoid: payload.visual_guidance?.avoid ?? [],
            },
          })
        }
      />
    </div>
  );
}

function CopyBlockEditor({
  block,
  onChange,
  onRemove,
  t,
}: {
  block: CopyBlock;
  onChange: (block: CopyBlock) => void;
  onRemove?: () => void;
  t: TFunction;
}) {
  return (
    <div className="copy-editor-card space-y-3 p-3">
      <CopyEditorRemoveButton label={t("detail.inspector.removeCopyBlock")} onRemove={onRemove} />
      <OptionalTextInput
        label={t("detail.inspector.label")}
        value={block.label ?? ""}
        addLabel={t("detail.inspector.addLabel")}
        placeholder={t("detail.inspector.label")}
        onChange={(label) => onChange({ ...block, label })}
      />
      <TextArea
        label={t("detail.inspector.body")}
        value={block.text}
        onChange={(text) => onChange({ ...block, text })}
        minRows={1}
        maxRows={12}
      />
      <OptionalTextArea
        label={t("detail.inspector.visualExpression")}
        value={block.visual_hint ?? ""}
        addLabel={t("detail.inspector.addVisualExpression")}
        placeholder={t("detail.inspector.visualExpressionPlaceholder")}
        helpKey="copyVisualExpression"
        onChange={(visual_hint) => onChange({ ...block, visual_hint })}
      />
    </div>
  );
}

function CopySectionEditor({
  section,
  onChange,
  onRemove,
  t,
}: {
  section: CopySection;
  onChange: (section: CopySection) => void;
  onRemove?: () => void;
  t: TFunction;
}) {
  return (
    <div className="copy-editor-card space-y-3 p-3">
      <CopyEditorRemoveButton label={t("detail.inspector.removeCopySection")} onRemove={onRemove} />
      <OptionalTextInput
        label={t("detail.inspector.sectionTitle")}
        value={section.title ?? ""}
        addLabel={t("detail.inspector.addSectionTitle")}
        placeholder={t("detail.inspector.sectionTitle")}
        onChange={(title) => onChange({ ...section, title })}
      />
      <OptionalTextArea
        label={t("detail.inspector.description")}
        value={section.body ?? ""}
        addLabel={t("detail.inspector.addDescription")}
        placeholder={t("detail.inspector.sectionDescriptionPlaceholder")}
        onChange={(body) => onChange({ ...section, body })}
      />
      {section.items.length ? (
        <div className="space-y-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-widest pf-ink-muted dark:text-[color:var(--pf-muted)]">
            {t("detail.inspector.items")}
          </div>
          <div className="space-y-1.5">
            {section.items.map((item, index) => (
              <CopySectionItemEditor
                key={item.id}
                block={item}
                onRemove={
                  canRemoveCopySectionItem(section)
                    ? () =>
                        onChange({
                          ...section,
                          items: section.items.filter((_, itemIndex) => itemIndex !== index),
                        })
                    : undefined
                }
                onChange={(nextItem) => {
                  const items = [...section.items];
                  items[index] = nextItem;
                  onChange({ ...section, items });
                }}
                t={t}
              />
            ))}
          </div>
        </div>
      ) : null}
      <OptionalTextArea
        label={t("detail.inspector.visualGuidance")}
        value={section.visual_hint ?? ""}
        addLabel={t("detail.inspector.addVisualGuidance")}
        placeholder={t("detail.inspector.sectionVisualPlaceholder")}
        helpKey="copyVisualGuidance"
        onChange={(visual_hint) => onChange({ ...section, visual_hint })}
      />
    </div>
  );
}

function CopySectionItemEditor({
  block,
  onChange,
  onRemove,
  t,
}: {
  block: CopyBlock;
  onChange: (block: CopyBlock) => void;
  onRemove?: () => void;
  t: TFunction;
}) {
  return (
    <div className="copy-editor-item space-y-2">
      <CopyEditorRemoveButton label={t("detail.inspector.removeCopyItem")} onRemove={onRemove} compact />
      <OptionalTextInput
        label={t("detail.inspector.label")}
        value={block.label ?? ""}
        addLabel={t("detail.inspector.addLabel")}
        placeholder={t("detail.inspector.label")}
        onChange={(label) => onChange({ ...block, label })}
      />
      <TextArea
        label={t("detail.inspector.body")}
        value={block.text}
        onChange={(text) => onChange({ ...block, text })}
        minRows={1}
        maxRows={8}
      />
      <OptionalTextArea
        label={t("detail.inspector.visualExpression")}
        value={block.visual_hint ?? ""}
        addLabel={t("detail.inspector.addVisualExpression")}
        placeholder={t("detail.inspector.itemVisualPlaceholder")}
        helpKey="copyVisualExpression"
        onChange={(visual_hint) => onChange({ ...block, visual_hint })}
      />
    </div>
  );
}

function CopyEditorRemoveButton({
  label,
  onRemove,
  compact = false,
}: {
  label: string;
  onRemove?: () => void;
  compact?: boolean;
}) {
  if (!onRemove) {
    return null;
  }
  return (
    <div className="flex justify-end">
      <ActionButton
        onClick={onRemove}
        preset="danger"
        size={compact ? "icon-sm" : "icon-md"}
        aria-label={label}
        title={label}
        leadingIcon={<Trash2 size={compact ? 12 : 14} />}
      />
    </div>
  );
}

function canRemoveCopySectionItem(section: CopySection): boolean {
  return (
    section.items.length > 1 ||
    hasText(section.title) ||
    hasText(section.body) ||
    hasText(section.visual_hint)
  );
}

function OptionalTextInput({
  label,
  value,
  addLabel,
  placeholder,
  onChange,
  helpKey,
}: {
  label: string;
  value: string;
  addLabel: string;
  placeholder?: string;
  onChange: (value: string) => void;
  helpKey?: ParameterHelpKey;
}) {
  const [isEditing, setIsEditing] = useState(hasText(value));
  const actionAppearance = useInspectorActionAppearance();
  const addCopyFieldButtonClassName = inspectorAddCopyFieldButtonClassName(actionAppearance);
  const shouldShowInput = isEditing || hasText(value);

  if (!shouldShowInput) {
    return (
      <ActionButton
        className={addCopyFieldButtonClassName}
        onClick={() => setIsEditing(true)}
        preset="secondary"
        size="sm"
        leadingIcon={<Plus size={12} />}
      >
        {addLabel}
      </ActionButton>
    );
  }

  const input = (
    <LayoutTextInput
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={() => {
        if (!hasText(value)) {
          setIsEditing(false);
        }
      }}
      placeholder={placeholder}
      size="compact"
    />
  );

  if (helpKey) {
    return (
      <div className="block">
        <FieldLabel label={label} helpKey={helpKey} />
        {input}
      </div>
    );
  }

  return (
    <label className="block">
      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-widest pf-ink-muted dark:text-[color:var(--pf-muted)]">
        {label}
      </span>
      {input}
    </label>
  );
}

function OptionalTextArea({
  label,
  value,
  addLabel,
  placeholder,
  onChange,
  helpKey,
}: {
  label: string;
  value: string;
  addLabel: string;
  placeholder?: string;
  onChange: (value: string) => void;
  helpKey?: ParameterHelpKey;
}) {
  const [isEditing, setIsEditing] = useState(hasText(value));
  const actionAppearance = useInspectorActionAppearance();
  const addCopyFieldButtonClassName = inspectorAddCopyFieldButtonClassName(actionAppearance);
  const shouldShowTextArea = isEditing || hasText(value);

  if (!shouldShowTextArea) {
    return (
      <ActionButton
        className={addCopyFieldButtonClassName}
        onClick={() => setIsEditing(true)}
        preset="secondary"
        size="sm"
        leadingIcon={<Plus size={12} />}
      >
        {addLabel}
      </ActionButton>
    );
  }

  if (helpKey) {
    return (
      <InspectorTextArea
        label={label}
        value={value}
        onChange={onChange}
        onBlur={() => {
          if (!hasText(value)) {
            setIsEditing(false);
          }
        }}
        minRows={1}
        maxRows={12}
        placeholder={placeholder}
        helpKey={helpKey}
      />
    );
  }

  return (
    <TextArea
      label={label}
      value={value}
      onChange={onChange}
      onBlur={() => {
        if (!hasText(value)) {
          setIsEditing(false);
        }
      }}
      minRows={1}
      maxRows={12}
      placeholder={placeholder}
    />
  );
}

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

function ImageGenerationInspector({
  node,
  draft,
  imageSizeOptions,
  imageGenerationMaxDimension,
  imageToolAllowedFields,
  resourceGroups,
  generationConfigOptions,
  onDraftChange,
  downstreamReferenceCount,
  onPreviewPrompt,
  t,
}: {
  node: WorkflowNode;
  draft: NodeConfigDraft;
  imageSizeOptions: ImageSizeOption[];
  imageGenerationMaxDimension: number;
  imageToolAllowedFields: readonly ImageToolOptionKey[];
  resourceGroups: GenerationResourceGroup[];
  generationConfigOptions: GenerationConfigOption[];
  onDraftChange: (draft: NodeConfigDraft) => void;
  downstreamReferenceCount: number;
  onPreviewPrompt: (preview: PromptPreview) => void;
  t: TFunction;
}) {
  const [settingsTab, setSettingsTab] = useState<ImageGenerationSettingsTab>("basic");
  const savedInstruction = node.output_json ? outputText(node.output_json, "instruction") : "";
  const previewText = savedInstruction || draft.instruction;
  const promptMeta = savedInstruction ? t("detail.inspector.savedPromptMeta") : t("detail.inspector.currentDraft");
  const inputAppearance = layoutInputAppearance(useInspectorWorkspaceSubpage());

  return (
    <div className="space-y-3">
      {downstreamReferenceCount === 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-200">
          {t("detail.inspector.connectImageNodeFirst")}
        </div>
      ) : null}
      <ImageGenerationSettingsTabs
        value={settingsTab}
        onChange={setSettingsTab}
        basic={
          <div className="space-y-3">
            <div className="rounded-xl border pf-hairline pf-surface-soft px-3 py-2 dark:border-[color:var(--pf-border)] dark:bg-[#0b1220]">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold pf-ink-muted dark:text-[color:var(--pf-muted)]">{t("detail.inspector.generationCount")}</div>
                  <div className="mt-1 text-[11px] leading-5 pf-ink-muted dark:text-[color:var(--pf-muted)]">
                    {t("detail.inspector.downstreamImageCount", { count: downstreamReferenceCount })}
                  </div>
                </div>
                <span className="shrink-0 rounded-full border pf-hairline pf-surface px-2.5 py-1 text-xs font-semibold pf-ink-muted dark:border-[color:var(--pf-border)] dark:bg-[#151f33] dark:text-[color:var(--pf-muted)]">
                  {t("detail.inspector.imageCount", { count: downstreamReferenceCount })}
                </span>
              </div>
            </div>
            <InspectorTextArea
              label={t("detail.inspector.imageDescription")}
              value={draft.instruction}
              onChange={(value) => onDraftChange({ ...draft, instruction: value })}
              helpKey="imageDescription"
            />
            <ResourceGroupSelector
              label={t("detail.inspector.resourceGroup")}
              draft={draft}
              resourceGroups={resourceGroups}
              onDraftChange={onDraftChange}
              t={t}
            />
            <GenerationConfigSelector
              label={t("detail.inspector.imageGenerationConfig")}
              helpKey="imageGenerationConfig"
              mode={draft.generationConfigMode}
              generationConfigId={draft.generationConfigId}
              options={generationConfigOptions}
              onDraftChange={(next) =>
                onDraftChange({
                  ...draft,
                  generationConfigMode: next.mode,
                  generationConfigId: next.generationConfigId,
                })
              }
              t={t}
            />
            {previewText.trim() ? (
              <ActionButton
                onClick={() =>
                  onPreviewPrompt({
                    title: t("detail.inspector.imagePrompt"),
                    text: previewText,
                    meta: promptMeta,
                  })
                }
                preset="secondary"
                size="md"
                fullWidth
                leadingIcon={<FileText size={13} />}
              >
                {t("detail.inspector.reviewPrompt")}
              </ActionButton>
            ) : null}
            <ImageGenerationSettingsPanel
              surface="plain"
              size={draft.size}
              sizeOptions={imageSizeOptions}
              maxDimension={imageGenerationMaxDimension}
              appearance={inputAppearance}
              toolOptions={draft.toolOptions}
              allowedToolFields={imageToolAllowedFields}
              onSizeChange={(size) => onDraftChange({ ...draft, size })}
              onToolOptionsChange={(toolOptions) => onDraftChange({ ...draft, toolOptions })}
              showToolOptions={false}
              helpUiType="inspirationDetail"
            />
          </div>
        }
        advanced={
          <div className="space-y-3">
            <FieldLabel
              label={t("detail.inspector.imageToolOptions")}
              helpKey="imageToolOptions"
              className="text-xs font-semibold pf-ink-muted dark:text-[color:var(--pf-muted)]"
            />
            <ImageToolControls
              surface="plain"
              value={draft.toolOptions}
              allowedFields={imageToolAllowedFields}
              helpUiType="inspirationDetail"
              appearance={inputAppearance}
              onChange={(toolOptions) => onDraftChange({ ...draft, toolOptions })}
            />
          </div>
        }
      />
    </div>
  );
}
