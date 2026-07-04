import type { MouseEvent as ReactMouseEvent } from "react";
import {
  Check,
  FileText,
  Image as ImageIcon,
  ImagePlus,
  Loader2,
  Presentation,
  Sparkles,
} from "lucide-react";

import { formatDateTime } from "../../lib/format";
import type { DownloadableImage } from "../../lib/image-downloads";
import { useI18n } from "../../lib/preferences";
import type { LayoutActionAppearance } from "../../components/layoutActionButtons";
import type { WorkflowNode } from "../../lib/types";
import { readDeckNodeCardState } from "./deckNodeCardState";
import { DownloadLink } from "./ImageDownloadComponents";
import {
  IMAGE_PREVIEW_SURFACE_CLASS_NAME,
} from "./constants";
import { workflowNodeDisplayLabel, workflowNodeDisplayTitle } from "./nodeDisplay";
import {
  imageWorkflowNodeWaitingLabel,
  isImageWorkflowNodeWaiting,
  statusClass,
  workflowNodeActivityText,
  workflowRetryHintLabel,
  workflowNodeStatusLabel,
} from "./utils";

interface WorkflowNodeCardProps {
  node: WorkflowNode;
  nodeRef?: (element: HTMLDivElement | null) => void;
  image: DownloadableImage | null;
  primarySelected: boolean;
  secondarySelected: boolean;
  previewSelected: boolean;
  dragging: boolean;
  appearance?: LayoutActionAppearance;
  onSelect: (event: ReactMouseEvent<HTMLElement>) => void;
  onPreviewImage?: (image: DownloadableImage) => void;
}

export function WorkflowNodeCard({
  node,
  nodeRef,
  image,
  primarySelected,
  secondarySelected,
  previewSelected,
  dragging,
  appearance = "classic",
  onSelect,
  onPreviewImage,
}: WorkflowNodeCardProps) {
  const { t } = useI18n();
  const icon = {
    inspiration_context: FileText,
    reference_image: ImagePlus,
    copy_generation: FileText,
    image_generation: ImageIcon,
    image_enhance: ImageIcon,
    tail_splitter: Sparkles,
    deck_generation: Presentation,
  }[node.node_type];
  const Icon = icon;
  const displayTitle = workflowNodeDisplayTitle(node, t);
  const displayLabel = workflowNodeDisplayLabel(node, t);
  const imageWaiting = isImageWorkflowNodeWaiting(node);
  const waitingLabel = imageWorkflowNodeWaitingLabel(node, t);
  const activityText = workflowNodeActivityText(node, t);
  const deckNodeState = readDeckNodeCardState(node);
  const statusTone = deckNodeState?.badgeTone ?? node.status;
  const statusLabel = deckNodeState ? t(deckNodeState.badgeLabelKey) : workflowNodeStatusLabel(node, t);
  const selectedClassName = primarySelected
    ? "border-indigo-300 shadow-lg shadow-indigo-950/10 ring-2 ring-indigo-200/70 dark:border-violet-400 dark:shadow-indigo-950/30 dark:ring-violet-300/60"
    : secondarySelected || previewSelected
      ? "border-sky-300 shadow-md shadow-sky-950/5 ring-2 ring-sky-100 dark:border-sky-400 dark:shadow-sky-950/25 dark:ring-sky-300/45"
      : "pf-hairline dark:border-[color:var(--pf-border)] dark:ring-1 dark:ring-[color:var(--pf-border-soft)]";

  return (
    <div
      ref={nodeRef}
      data-workflow-node-id={node.id}
      className={`nopan relative w-[272px] touch-none select-none rounded-2xl border bg-[rgba(255,255,255,0.95)] p-3 text-left shadow-sm backdrop-blur dark:bg-[#1c2940]/96 dark:shadow-[0_18px_42px_rgba(0,0,0,0.34)] transition-[border-color,box-shadow,transform] transition-spring animate-spring-node-in ${
        dragging ? "cursor-grabbing" : "hover:-translate-y-0.5 hover:shadow-md dark:hover:border-[color:var(--pf-border)] dark:hover:shadow-[0_20px_46px_rgba(0,0,0,0.42)]"
      } ${selectedClassName} ${
        statusTone === "running"
          ? "animate-running-glow"
          : statusTone === "queued"
            ? "animate-queued-glow"
            : ""
      }`}
    >
      {primarySelected || secondarySelected || previewSelected ? (
        <div
          className={`pointer-events-none absolute right-2 top-2 z-20 flex h-5 w-5 items-center justify-center rounded-full border pf-surface shadow-sm dark:bg-[#111b2d] ${
            primarySelected
              ? "border-indigo-200 text-indigo-600 dark:border-indigo-300 dark:text-indigo-200"
              : "border-sky-200 text-sky-600 dark:border-sky-300 dark:text-sky-200"
          }`}
          aria-hidden="true"
        >
          <Check size={12} strokeWidth={2.5} />
        </div>
      ) : null}
      <div onClick={onSelect} className="cursor-grab active:cursor-grabbing">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="flex min-w-0 gap-2">
            <span className="mt-0.5 rounded-xl border pf-hairline pf-surface-soft p-1.5 pf-ink-muted dark:border-[color:var(--pf-border)] dark:bg-[#111b2d] dark:text-[color:var(--pf-muted)]">
              <Icon size={14} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold pf-ink dark:text-[#fff]">
                {displayTitle}
              </div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wider pf-ink-muted dark:text-[color:var(--pf-muted)]">
                {displayLabel}
              </div>
            </div>
          </div>
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusClass(statusTone)}`}
          >
            {statusLabel}
          </span>
        </div>
        {image ? (
          <div
            className={`relative mb-2 flex h-28 items-center justify-center overflow-hidden rounded-xl border pf-hairline p-2 ${IMAGE_PREVIEW_SURFACE_CLASS_NAME} ${onPreviewImage ? "cursor-zoom-in" : ""}`}
            onClick={onPreviewImage ? (e) => { e.stopPropagation(); onPreviewImage(image); } : undefined}
          >
            <img
              src={image.previewUrl}
              alt={image.alt}
              className="h-full w-full object-contain"
            />
            <DownloadLink image={image} appearance={appearance} variant="overlay" />
            {imageWaiting ? (
              <div className="absolute inset-x-2 bottom-2 flex items-center justify-center rounded-lg bg-[rgba(255,255,255,0.9)] px-2 py-1 text-[11px] font-medium text-indigo-700 shadow-sm ring-1 ring-indigo-100 backdrop-blur dark:bg-[color:var(--pf-deep)] dark:text-indigo-100 dark:ring-indigo-400/30">
                <Loader2 size={11} className="mr-1 animate-spin" />
                {waitingLabel}
              </div>
            ) : null}
          </div>
        ) : imageWaiting ? (
          <div className="relative mb-2 flex h-28 flex-col items-center justify-center overflow-hidden rounded-xl border border-indigo-200/50 bg-indigo-950/10 text-indigo-700 dark:border-indigo-400/20 dark:bg-[color:var(--pf-deep)] dark:text-indigo-100 shadow-inner">
            <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-xl">
              <div className="absolute inset-0 bg-gradient-to-b from-indigo-950/5 via-indigo-900/10 to-purple-950/15 dark:from-[rgba(15,23,42,0.1)] dark:to-[rgba(15,23,42,0.2)]" />
              <div className="absolute left-[35%] bottom-0 w-3 h-3 rounded-full bg-indigo-400/60 blur-[2px] animate-particle-1" />
              <div className="absolute left-[50%] bottom-0 w-2.5 h-2.5 rounded-full bg-purple-400/50 blur-[1px] animate-particle-2" />
              <div className="absolute left-[42%] bottom-0 w-4 h-4 rounded-full bg-violet-400/40 blur-[3px] animate-particle-3" />
              <div className="absolute left-[58%] bottom-0 w-2 h-2 rounded-full bg-pink-400/60 blur-[1px] animate-particle-4" />
              <div className="absolute left-[38%] bottom-0 w-3.5 h-3.5 rounded-full bg-indigo-300/50 blur-[2px] animate-particle-5" />
              <div className="absolute left-[48%] bottom-0 w-3 h-3 rounded-full bg-purple-300/60 blur-[2px] animate-particle-6" />
            </div>
            <div className="relative z-10 flex flex-col items-center justify-center">
              <Loader2 size={18} className="animate-spin text-indigo-500 dark:text-indigo-300 opacity-80" />
              <div className="mt-2 text-xs font-semibold tracking-wide text-indigo-900 dark:text-indigo-200 bg-[rgba(255,255,255,0.4)] px-2 py-0.5 rounded-md backdrop-blur-sm shadow-sm dark:bg-[color:var(--pf-deep)]">
                {waitingLabel}
              </div>
            </div>
          </div>
        ) : null}
        {activityText && !imageWaiting ? (
          <div className="mb-2 flex items-start gap-2 rounded-lg border border-indigo-100 bg-indigo-50 px-2.5 py-2 text-xs leading-5 text-indigo-700 dark:border-violet-400/30 dark:bg-violet-500/10 dark:text-violet-100">
            <Loader2 size={13} className="mt-0.5 shrink-0 animate-spin" />
            <div className="min-w-0">
              <div className="font-semibold">{activityText}</div>
              {node.last_run_at ? (
                <div className="mt-0.5 text-[10px] text-indigo-600/70 dark:text-violet-100/70">
                  {t("detail.recent", { time: formatDateTime(node.last_run_at) })}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        {deckNodeState ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {deckNodeState.sourceItemCount > 0 ? (
              <span className="rounded-full border pf-hairline pf-surface-soft px-2 py-0.5 text-[10px] font-medium pf-ink-muted dark:border-[color:var(--pf-border)] dark:bg-[#111b2d] dark:text-[color:var(--pf-muted)]">
                {t("detail.deck.sourceCount", { count: deckNodeState.sourceItemCount })}
              </span>
            ) : null}
            {deckNodeState.slideCount !== null ? (
              <span className="rounded-full border pf-hairline pf-surface-soft px-2 py-0.5 text-[10px] font-medium pf-ink-muted dark:border-[color:var(--pf-border)] dark:bg-[#111b2d] dark:text-[color:var(--pf-muted)]">
                {t("detail.deck.slideCount", { count: deckNodeState.slideCount })}
              </span>
            ) : null}
            {deckNodeState.generatedSlideCount !== null ? (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-400/40 dark:bg-emerald-500/15 dark:text-emerald-100">
                {t("detail.deck.generatedCount", { count: deckNodeState.generatedSlideCount })}
              </span>
            ) : null}
          </div>
        ) : null}
        {deckNodeState?.sourceStale ? (
          <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] leading-5 text-amber-800 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-100">
            {t("detail.deck.sourceStale")}
          </div>
        ) : null}
        {node.failure_reason ? (
          <div
            className={`rounded-lg border px-2.5 py-1.5 text-xs leading-relaxed ${
              node.status === "cancelled"
                ? "pf-hairline pf-surface-soft pf-ink-muted dark:border-[color:var(--pf-border)] dark:bg-[#0b1220] dark:text-[color:var(--pf-muted)]"
                : "border-red-100 bg-red-50 text-red-700 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-200"
            }`}
          >
            <div className="line-clamp-2">{node.failure_reason}</div>
            {node.status === "failed" && node.is_retryable ? (
              <div className="mt-1 text-[10px] font-medium text-red-600 dark:text-red-200">{t("detail.retryable")}</div>
            ) : null}
            {node.status === "failed" && !node.is_retryable ? (
              <div className="mt-1 text-[10px] font-medium text-red-600 dark:text-red-200">{t("detail.notRetryable")}</div>
            ) : null}
            {node.attempt_count > 0 ? (
              <div className="mt-1 text-[10px] text-red-600/80 dark:text-red-200/80">
                {t("detail.nodeAttemptSummary", { attempts: node.attempt_count, retries: node.retry_count })}
              </div>
            ) : null}
            {node.status === "failed" && !node.is_retryable && node.non_retryable_reason ? (
              <div className="mt-1 line-clamp-2 text-[10px] text-red-600/80 dark:text-red-200/80">
                {t("detail.nonRetryableReason", { reason: node.non_retryable_reason })}
              </div>
            ) : null}
            {node.status === "failed" && node.retry_hint ? (
              <div className="mt-1 text-[10px] text-red-600/80 dark:text-red-200/80">
                {workflowRetryHintLabel(node.retry_hint, t)}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="mt-3 flex items-center gap-2 text-[10px] pf-ink-muted dark:text-[color:var(--pf-muted)]">
        <span className="min-w-0 flex-1 truncate text-left leading-tight">
          {node.last_run_at ? t("detail.recent", { time: formatDateTime(node.last_run_at) }) : displayLabel}
        </span>
      </div>
    </div>
  );
}
