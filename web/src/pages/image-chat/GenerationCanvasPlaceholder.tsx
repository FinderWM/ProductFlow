import { Loader2, OctagonX, RotateCcw, Sparkles } from "lucide-react";

import { ActionButton } from "../../components/ActionButton";
import { formatImageSizeValue } from "../../lib/imageSizes";
import type { ImageSessionGenerationTask } from "../../lib/types";
import {
  imageGenerationRetryMetadata,
  isImageSessionGenerationTaskCancelable,
  isImageSessionGenerationTaskRegeneratable,
  isImageSessionGenerationTaskRetryable,
} from "./branching";
import type { ImageHistoryPlaceholderCandidate } from "./branching";
import type { ImageChatTranslate } from "./display";
import { generationTaskQueueText, placeholderStatusLabel } from "./display";

interface GenerationCanvasPlaceholderProps {
  candidate: ImageHistoryPlaceholderCandidate;
  retrying: boolean;
  cancelling: boolean;
  regenerating: boolean;
  actionBlockedTitle?: string | null;
  onRetry: (task: ImageSessionGenerationTask) => void;
  onCancel: (task: ImageSessionGenerationTask) => void;
  onRegenerate: (task: ImageSessionGenerationTask) => void;
  t: ImageChatTranslate;
}

export function GenerationCanvasPlaceholder({
  candidate,
  retrying,
  cancelling,
  regenerating,
  actionBlockedTitle = null,
  onRetry,
  onCancel,
  onRegenerate,
  t,
}: GenerationCanvasPlaceholderProps) {
  const active = candidate.status === "queued" || candidate.status === "running";
  const failed = candidate.status === "failed";
  const cancelled = candidate.status === "cancelled";
  const retryable = isImageSessionGenerationTaskRetryable(candidate.task);
  const regeneratable = isImageSessionGenerationTaskRegeneratable(candidate.task);
  const queueText = generationTaskQueueText(candidate.task, t);
  const retryMetadata = imageGenerationRetryMetadata(candidate.task);
  const failureReason = candidate.failure_reason ?? retryMetadata?.last_failure_reason;

  return (
    <div className="relative z-0 h-full min-h-0 w-full overflow-hidden px-4 pb-4 pt-14 sm:px-6 sm:pb-6 sm:pt-16">
      <div className="pointer-events-none absolute inset-x-4 bottom-[10rem] top-14 flex items-center justify-center [container-type:size] sm:inset-x-6 sm:bottom-[10.75rem] sm:top-16">
        <div
          className={`relative flex size-[min(18rem,100cqw,100cqh)] items-center justify-center overflow-hidden rounded-[14%] border shadow-sm transition-[border-color,box-shadow,transform] transition-spring ${
            failed
              ? "border-red-200 bg-red-50 text-red-600 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200"
              : active
                ? "border-transparent bg-indigo-950/15 text-indigo-700 animate-running-glow shadow-[0_0_35px_rgba(99,102,241,0.22)]"
                : "border-indigo-100 bg-indigo-50 text-indigo-700 dark:border-violet-400/35 dark:bg-violet-500/14 dark:text-violet-100"
          }`}
        >
          {active ? (
            <>
              <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-[40px]">
                <div className="absolute inset-0 bg-gradient-to-b from-indigo-950/5 via-indigo-900/10 to-purple-950/15 dark:from-slate-950/10 dark:to-slate-900/20" />
                <div className="absolute left-[30%] bottom-0 w-5 h-5 rounded-full bg-indigo-400/60 blur-[3px] animate-large-p1" />
                <div className="absolute left-[52%] bottom-0 w-4 h-4 rounded-full bg-purple-400/50 blur-[2px] animate-large-p2" />
                <div className="absolute left-[40%] bottom-0 w-6 h-6 rounded-full bg-violet-400/40 blur-[4px] animate-large-p3" />
                <div className="absolute left-[62%] bottom-0 w-3 h-3 rounded-full bg-pink-400/60 blur-[1px] animate-large-p4" />
                <div className="absolute left-[35%] bottom-0 w-5.5 h-5.5 rounded-full bg-indigo-300/50 blur-[3px] animate-large-p5" />
                <div className="absolute left-[45%] bottom-0 w-4.5 h-4.5 rounded-full bg-purple-300/60 blur-[2px] animate-large-p6" />
              </div>
              <div className="absolute inset-6 rounded-[32px] bg-indigo-200/30 blur-2xl animate-pulse" />
              <Loader2 size={48} className="relative z-10 animate-spin text-indigo-600 dark:text-violet-300" />
            </>
          ) : (
            <Sparkles size={48} className="relative" />
          )}
        </div>
      </div>

      <div className="absolute inset-x-4 bottom-4 z-10 px-1 sm:inset-x-6 sm:bottom-6">
        <div className="mx-auto flex max-w-sm flex-col items-center gap-4 text-center">
          <div className="max-h-36 w-full overflow-y-auto px-1 sm:max-h-[9rem]">
          <div className="text-sm font-semibold text-slate-900 dark:text-white">{placeholderStatusLabel(candidate, t)}</div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t("chat.candidate", { index: candidate.candidate_index, count: candidate.candidate_count })} · {formatImageSizeValue(candidate.size)}
          </div>
          {queueText ? <div className="mt-3 text-xs leading-5 text-slate-500 dark:text-slate-400">{queueText}</div> : null}
          <div className="mt-4 line-clamp-3 rounded-xl border border-slate-200/80 bg-white/80 px-3 py-2 text-xs font-medium leading-5 text-[#334155] shadow-sm backdrop-blur dark:border-slate-700/70 dark:bg-slate-950/75 dark:text-[#e2e8f0]">
            {candidate.prompt}
          </div>
          {failed ? (
            <>
              {failureReason ? (
                <div className="mt-5 rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-medium leading-5 text-red-500 dark:border-red-400/40 dark:bg-[#0b1220] dark:text-red-200">
                  {failureReason}
                </div>
              ) : null}
            </>
          ) : cancelled ? (
            <>
              <div className="mt-5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-500 dark:border-slate-700 dark:bg-[#0b1220] dark:text-slate-300">
                {t("chat.taskCancelled")}
              </div>
            </>
          ) : null}
          </div>
          {isImageSessionGenerationTaskCancelable(candidate.task) ? (
            <ActionButton
              preset="danger"
              size="lg"
              onClick={() => onCancel(candidate.task)}
              disabled={cancelling || Boolean(actionBlockedTitle)}
              title={actionBlockedTitle ?? t("chat.cancelGeneration")}
              loading={cancelling}
              leadingIcon={<OctagonX size={15} />}
              className="px-4 text-sm"
            >
              {t("chat.cancelGeneration")}
            </ActionButton>
          ) : null}
          {failed && retryable ? (
            <ActionButton
              preset="danger"
              size="lg"
              onClick={() => onRetry(candidate.task)}
              disabled={retrying || Boolean(actionBlockedTitle)}
              title={actionBlockedTitle ?? t("chat.retryGeneration")}
              loading={retrying}
              leadingIcon={<RotateCcw size={15} />}
              className="px-4 text-sm"
            >
              {t("chat.retryGeneration")}
            </ActionButton>
          ) : null}
          {cancelled && regeneratable ? (
            <ActionButton
              preset="primary"
              size="lg"
              onClick={() => onRegenerate(candidate.task)}
              disabled={regenerating || Boolean(actionBlockedTitle)}
              title={actionBlockedTitle ?? t("chat.regenerateCancelled")}
              loading={regenerating}
              leadingIcon={<RotateCcw size={15} />}
              className="px-4 text-sm"
            >
              {t("chat.regenerateCancelled")}
            </ActionButton>
          ) : null}
        </div>
      </div>
    </div>
  );
}
