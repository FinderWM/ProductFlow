import { Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import { SensitiveImageOverlay, sensitiveImageClassName } from "../../components/SensitiveImageMask";
import { api } from "../../lib/api";
import { shouldMaskSensitiveImage } from "../../lib/sensitiveImages";
import type { ImageSessionGenerationTask, ImageSessionRound } from "../../lib/types";
import type { ImageHistoryPlaceholderCandidate } from "./branching";
import { GenerationCanvasPlaceholder } from "./GenerationCanvasPlaceholder";
import type { ImageChatTranslate } from "./display";

interface ImageChatMainStageProps {
  selectedRound: ImageSessionRound | null;
  selectedPlaceholder: ImageHistoryPlaceholderCandidate | null;
  retryingTaskId: string | null;
  cancellingTaskId: string | null;
  regenerating: boolean;
  maskSensitiveImages: boolean;
  generationBlockedTitle?: string | null;
  stageInfo?: ReactNode;
  stageActions?: ReactNode;
  onPreviewRound: (round: ImageSessionRound) => void;
  onRetryGenerationTask: (task: ImageSessionGenerationTask) => void;
  onCancelGenerationTask: (task: ImageSessionGenerationTask) => void;
  onRegenerateGenerationTask: (task: ImageSessionGenerationTask) => void;
  t: ImageChatTranslate;
}

export function ImageChatMainStage({
  selectedRound,
  selectedPlaceholder,
  retryingTaskId,
  cancellingTaskId,
  regenerating,
  maskSensitiveImages,
  generationBlockedTitle = null,
  stageInfo,
  stageActions,
  onPreviewRound,
  onRetryGenerationTask,
  onCancelGenerationTask,
  onRegenerateGenerationTask,
  t,
}: ImageChatMainStageProps) {
  const selectedImageMasked = shouldMaskSensitiveImage(maskSensitiveImages, selectedRound?.resource_group);

  return (
    <div className="relative flex min-h-[18rem] flex-1 items-center justify-center overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-600/80 dark:bg-[#121b2d] dark:shadow-[0_0_0_1px_rgba(139,92,246,0.10),0_24px_80px_rgba(0,0,0,0.35)] sm:min-h-[22rem] lg:min-h-[360px]">
      <div className="absolute inset-0 bg-[radial-gradient(#cbd5e1_1px,transparent_1px)] [background-size:20px_20px] dark:bg-[radial-gradient(rgba(148,163,184,0.26)_1px,transparent_1px)]" />
      {stageInfo || stageActions ? (
        <div className="pointer-events-none absolute inset-x-3 top-3 z-20 flex flex-wrap items-start justify-end gap-2 sm:inset-x-4 sm:top-4">
          {stageInfo ? <div className="pointer-events-auto min-w-0 max-w-full">{stageInfo}</div> : null}
          {stageActions ? (
            <div className="pointer-events-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1.5">
              {stageActions}
            </div>
          ) : null}
        </div>
      ) : null}

      {selectedRound ? (
        <div className="absolute inset-0 z-0 flex min-h-0 w-full items-center justify-center px-2 py-2 sm:px-3 sm:py-3">
          <button
            type="button"
            onClick={() => onPreviewRound(selectedRound)}
            className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-violet-400"
            aria-label={t("chat.previewCurrent")}
            title={t("chat.previewCurrent")}
          >
            <img
              src={api.toApiUrl(selectedRound.generated_asset.preview_url)}
              alt={t("chat.currentResultAlt")}
              decoding="async"
              className={sensitiveImageClassName(
                selectedImageMasked,
                "max-h-full max-w-full object-contain drop-shadow-2xl",
                "strong",
              )}
            />
            <SensitiveImageOverlay masked={selectedImageMasked} label={t("common.sensitiveImageMasked")} intensity="strong" />
          </button>
        </div>
      ) : selectedPlaceholder ? (
        <GenerationCanvasPlaceholder
          candidate={selectedPlaceholder}
          retrying={retryingTaskId === selectedPlaceholder.task_id}
          cancelling={cancellingTaskId === selectedPlaceholder.task_id}
          regenerating={regenerating}
          actionBlockedTitle={generationBlockedTitle}
          onRetry={onRetryGenerationTask}
          onCancel={onCancelGenerationTask}
          onRegenerate={onRegenerateGenerationTask}
          t={t}
        />
      ) : (
        <div className="relative z-0 flex flex-col items-center gap-4 text-center text-slate-400 dark:text-slate-100">
          <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-white shadow-sm ring-1 ring-slate-200 dark:bg-slate-950/86 dark:text-violet-200 dark:ring-violet-400/35">
            <Sparkles size={28} />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-600 dark:text-white">{t("chat.noResult")}</div>
          </div>
        </div>
      )}
    </div>
  );
}
