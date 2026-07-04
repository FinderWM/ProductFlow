import { Sparkles } from "lucide-react";
import { useEffect, useRef, type ReactNode, type UIEvent as ReactUIEvent } from "react";

import {
  actionButtonToneStyle,
  actionSurfaceClassNameForAppearance,
  transparentActionToneVars,
  type LayoutActionAppearance,
} from "../../components/layoutActionButtons";
import { SensitiveImageOverlay, sensitiveImageClassName } from "../../components/SensitiveImageMask";
import { api } from "../../lib/api";
import { shouldMaskSensitiveImage } from "../../lib/sensitiveImages";
import type { ImageSessionGenerationTask, ImageSessionRound } from "../../lib/types";
import type { ImageHistoryPlaceholderCandidate } from "./branching";
import { GenerationCanvasPlaceholder } from "./GenerationCanvasPlaceholder";
import type { ImageChatTranslate } from "./display";

const MOBILE_CAROUSEL_SETTLE_DELAY_MS = 180;

interface ImageChatMainStageProps {
  sessionRounds: ImageSessionRound[];
  selectedRound: ImageSessionRound | null;
  selectedPlaceholder: ImageHistoryPlaceholderCandidate | null;
  retryingTaskId: string | null;
  cancellingTaskId: string | null;
  regenerating: boolean;
  appearance?: LayoutActionAppearance;
  maskSensitiveImages: boolean;
  generationBlockedTitle?: string | null;
  stageInfo?: ReactNode;
  stageActions?: ReactNode;
  onSelectRound: (assetId: string) => void;
  onPreviewRound: (round: ImageSessionRound) => void;
  onRetryGenerationTask: (task: ImageSessionGenerationTask) => void;
  onCancelGenerationTask: (task: ImageSessionGenerationTask) => void;
  onRegenerateGenerationTask: (task: ImageSessionGenerationTask) => void;
  t: ImageChatTranslate;
}

export function ImageChatMainStage({
  sessionRounds = [],
  selectedRound,
  selectedPlaceholder,
  retryingTaskId,
  cancellingTaskId,
  regenerating,
  appearance = "classic",
  maskSensitiveImages,
  generationBlockedTitle = null,
  stageInfo,
  stageActions,
  onSelectRound,
  onPreviewRound,
  onRetryGenerationTask,
  onCancelGenerationTask,
  onRegenerateGenerationTask,
  t,
}: ImageChatMainStageProps) {
  const previewButtonClassName = actionSurfaceClassNameForAppearance(appearance, {
    preset: "secondary",
    focusWithin: true,
    className: "relative flex h-full w-full items-center justify-center overflow-hidden rounded-2xl border-0 shadow-none",
  });
  const previewButtonStyle = actionButtonToneStyle(transparentActionToneVars, { display: "flex" });
  const selectedImageMasked = shouldMaskSensitiveImage(maskSensitiveImages, selectedRound?.resource_group);
  const selectedRoundIndex = selectedRound
    ? sessionRounds.findIndex((round) => round.generated_asset.id === selectedRound.generated_asset.id)
    : -1;
  const mobileCarouselRef = useRef<HTMLDivElement | null>(null);
  const mobileScrollSelectionTimeoutRef = useRef<number | null>(null);
  const skipNextCarouselSyncRef = useRef(false);

  useEffect(() => {
    return () => {
      if (mobileScrollSelectionTimeoutRef.current !== null) {
        window.clearTimeout(mobileScrollSelectionTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const container = mobileCarouselRef.current;
    if (!container || selectedRoundIndex < 0) {
      return;
    }
    if (skipNextCarouselSyncRef.current) {
      skipNextCarouselSyncRef.current = false;
      return;
    }
    const targetScrollLeft = selectedRoundIndex * container.clientWidth;
    if (Math.abs(container.scrollLeft - targetScrollLeft) <= 1) {
      return;
    }
    container.scrollTo({ left: targetScrollLeft, behavior: "auto" });
  }, [selectedRoundIndex]);

  const handleMobileCarouselScroll = (event: ReactUIEvent<HTMLDivElement>) => {
    if (!sessionRounds.length) {
      return;
    }
    const container = event.currentTarget;
    if (mobileScrollSelectionTimeoutRef.current !== null) {
      window.clearTimeout(mobileScrollSelectionTimeoutRef.current);
    }
    mobileScrollSelectionTimeoutRef.current = window.setTimeout(() => {
      mobileScrollSelectionTimeoutRef.current = null;
      const nextIndex = Math.max(
        0,
        Math.min(sessionRounds.length - 1, Math.round(container.scrollLeft / Math.max(container.clientWidth, 1))),
      );
      const nextRound = sessionRounds[nextIndex];
      if (!nextRound || nextRound.generated_asset.id === selectedRound?.generated_asset.id) {
        return;
      }
      skipNextCarouselSyncRef.current = true;
      onSelectRound(nextRound.generated_asset.id);
    }, MOBILE_CAROUSEL_SETTLE_DELAY_MS);
  };

  return (
    <div className="relative flex min-h-[18rem] flex-1 items-center justify-center overflow-hidden rounded-3xl border pf-hairline pf-surface shadow-sm dark:border-[color:var(--pf-border)] dark:bg-[#121b2d] dark:shadow-[0_0_0_1px_rgba(139,92,246,0.10),0_24px_80px_rgba(0,0,0,0.35)] sm:min-h-[22rem] lg:min-h-[360px]">
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
        <>
          <div
            ref={mobileCarouselRef}
            onScroll={handleMobileCarouselScroll}
            className="image-chat-history-scroll absolute inset-0 z-0 flex min-h-0 w-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain touch-pan-x lg:hidden"
          >
            {sessionRounds.map((round) => {
              const imageMasked = shouldMaskSensitiveImage(maskSensitiveImages, round.resource_group);
              return (
                <div key={round.id} className="h-full w-full shrink-0 snap-start [scroll-snap-stop:always] px-2 py-2 sm:px-3 sm:py-3">
                  <button
                    type="button"
                    onClick={() => onPreviewRound(round)}
                    className={previewButtonClassName}
                    aria-label={t("chat.previewCurrent")}
                    title={t("chat.previewCurrent")}
                    style={previewButtonStyle}
                  >
                    <img
                      src={api.toApiUrl(round.generated_asset.preview_url)}
                      alt={t("chat.currentResultAlt")}
                      draggable={false}
                      decoding="async"
                      className={sensitiveImageClassName(
                        imageMasked,
                        "max-h-full max-w-full object-contain drop-shadow-2xl",
                        "strong",
                      )}
                    />
                    <SensitiveImageOverlay masked={imageMasked} label={t("common.sensitiveImageMasked")} intensity="strong" />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="absolute inset-0 z-0 hidden min-h-0 w-full items-center justify-center px-2 py-2 sm:px-3 sm:py-3 lg:flex">
            <button
              type="button"
              onClick={() => onPreviewRound(selectedRound)}
              className={previewButtonClassName}
              aria-label={t("chat.previewCurrent")}
              title={t("chat.previewCurrent")}
              style={previewButtonStyle}
            >
              <img
                src={api.toApiUrl(selectedRound.generated_asset.preview_url)}
                alt={t("chat.currentResultAlt")}
                draggable={false}
                decoding="async"
                className={sensitiveImageClassName(
                  shouldMaskSensitiveImage(maskSensitiveImages, selectedRound.resource_group),
                  "max-h-full max-w-full object-contain drop-shadow-2xl",
                  "strong",
                )}
              />
              <SensitiveImageOverlay
                masked={selectedImageMasked}
                label={t("common.sensitiveImageMasked")}
                intensity="strong"
              />
            </button>
          </div>
          {sessionRounds.length > 1 && selectedRoundIndex >= 0 ? (
            <div className="pointer-events-none absolute inset-x-3 bottom-3 z-20 flex justify-center lg:hidden">
              <span className="rounded-full border border-[color:var(--pf-border-soft)] bg-[rgba(255,255,255,0.9)] px-2.5 py-1 text-[11px] font-semibold pf-ink-muted shadow-sm shadow-slate-900/5 backdrop-blur-md dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)] dark:text-[color:var(--pf-muted)]">
                {selectedRoundIndex + 1}/{sessionRounds.length}
              </span>
            </div>
          ) : null}
        </>
      ) : selectedPlaceholder ? (
        <GenerationCanvasPlaceholder
          candidate={selectedPlaceholder}
          retrying={retryingTaskId === selectedPlaceholder.task_id}
          cancelling={cancellingTaskId === selectedPlaceholder.task_id}
          regenerating={regenerating}
          actionBlockedTitle={generationBlockedTitle}
          appearance={appearance}
          onRetry={onRetryGenerationTask}
          onCancel={onCancelGenerationTask}
          onRegenerate={onRegenerateGenerationTask}
          t={t}
        />
      ) : (
        <div className="relative z-0 flex flex-col items-center gap-4 text-center pf-ink-muted dark:text-[color:var(--pf-muted)]">
          <div className="flex h-16 w-16 items-center justify-center rounded-3xl pf-surface shadow-sm ring-1 ring-[color:var(--pf-border-soft)] dark:bg-[color:var(--pf-deep)] dark:text-violet-200 dark:ring-violet-400/35">
            <Sparkles size={28} />
          </div>
          <div>
            <div className="text-sm font-semibold pf-ink-muted dark:text-[#fff]">{t("chat.noResult")}</div>
          </div>
        </div>
      )}
    </div>
  );
}
