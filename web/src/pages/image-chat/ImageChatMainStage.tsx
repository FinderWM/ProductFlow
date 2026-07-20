import { Sparkles } from "lucide-react";
import { useEffect, useRef, type ReactNode, type UIEvent as ReactUIEvent } from "react";

import { type LayoutActionAppearance } from "../../components/layoutActionButtons";
import { AsyncContent, AsyncErrorState, AsyncPausedState } from "../../components/loading/AsyncContent";
import { Skeleton } from "../../components/loading/Skeleton";
import { MediaPreviewTrigger } from "../../components/MediaPreviewTrigger";
import { SensitiveImageOverlay, sensitiveImageClassName } from "../../components/SensitiveImageMask";
import { api } from "../../lib/api";
import type { AsyncViewState } from "../../lib/asyncViewState";
import { shouldMaskSensitiveImage } from "../../lib/sensitiveImages";
import type { ImageSessionGenerationTask, ImageSessionRound } from "../../lib/types";
import type { ImageHistoryPlaceholderCandidate } from "./branching";
import { GenerationCanvasPlaceholder } from "./GenerationCanvasPlaceholder";
import type { ImageChatTranslate } from "./display";

const MOBILE_CAROUSEL_SETTLE_DELAY_MS = 180;

interface ImageChatMainStageProps {
  state: AsyncViewState;
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
  onRetrySession: () => void;
  t: ImageChatTranslate;
}

export function ImageChatMainStage({
  state,
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
  onRetrySession,
  t,
}: ImageChatMainStageProps) {
  const previewButtonClassName =
    "relative flex h-full w-full items-center justify-center overflow-hidden rounded-2xl";
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

  const resolvedStageContent = selectedRound ? (
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
              <MediaPreviewTrigger
                onPreview={() => onPreviewRound(round)}
                className={previewButtonClassName}
                aria-label={t("chat.previewCurrent")}
                title={t("chat.previewCurrent")}
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
              </MediaPreviewTrigger>
            </div>
          );
        })}
      </div>
      <div className="absolute inset-0 z-0 hidden min-h-0 w-full items-center justify-center px-2 py-2 sm:px-3 sm:py-3 lg:flex">
        <MediaPreviewTrigger
          onPreview={() => onPreviewRound(selectedRound)}
          className={previewButtonClassName}
          aria-label={t("chat.previewCurrent")}
          title={t("chat.previewCurrent")}
        >
          <img
            src={api.toApiUrl(selectedRound.generated_asset.preview_url)}
            alt={t("chat.currentResultAlt")}
            draggable={false}
            decoding="async"
            className={sensitiveImageClassName(
              selectedImageMasked,
              "max-h-full max-w-full object-contain drop-shadow-2xl",
              "strong",
            )}
          />
          <SensitiveImageOverlay
            masked={selectedImageMasked}
            label={t("common.sensitiveImageMasked")}
            intensity="strong"
          />
        </MediaPreviewTrigger>
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
  );

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

      <AsyncContent
        state={state}
        refreshIntent="background"
        loadingLabel={t("app.loading")}
        skeleton={(
          <div className="absolute inset-4 z-10 flex flex-col gap-4">
            <Skeleton className="min-h-0 flex-1" rounded="lg" />
            <div className="mx-auto flex w-full max-w-md gap-3">
              <Skeleton className="h-8 flex-1" />
              <Skeleton className="h-8 w-24" />
            </div>
          </div>
        )}
        initialError={(
          <AsyncErrorState
            className="relative z-10 mx-4 max-w-md rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-100"
            title={t("chat.loadSessionFailed")}
            retryLabel={t("common.retry")}
            retryingLabel={t("app.loading")}
            retrying={state.fetch === "fetching"}
            onRetry={onRetrySession}
          />
        )}
        paused={(
          <AsyncPausedState
            className="relative z-10 mx-4 max-w-md rounded-xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-300/30 dark:bg-amber-400/10 dark:text-amber-100"
            title={t("app.requestPaused.title")}
            message={t("app.requestPaused.message")}
            retryLabel={t("common.retry")}
            onRetry={onRetrySession}
          />
        )}
        inactive={(
          <div className="relative z-0 flex flex-col items-center gap-4 px-6 text-center pf-ink-muted dark:text-[color:var(--pf-muted)]">
            <div className="flex h-16 w-16 items-center justify-center rounded-3xl pf-surface shadow-sm ring-1 ring-[color:var(--pf-border-soft)] dark:bg-[color:var(--pf-deep)] dark:text-violet-200 dark:ring-violet-400/35">
              <Sparkles size={28} />
            </div>
            <div className="text-sm font-semibold pf-ink-muted dark:text-white">{t("chat.selectSession")}</div>
          </div>
        )}
        empty={resolvedStageContent}
        refreshFeedback={state.error === "refresh" ? (
          <div className="pointer-events-auto absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 shadow-sm dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-100">
            <span>{t("chat.loadSessionFailed")}</span>
            <button type="button" className="font-semibold underline" onClick={onRetrySession}>{t("common.retry")}</button>
          </div>
        ) : null}
        className="contents"
      >
        {resolvedStageContent}
      </AsyncContent>
    </div>
  );
}
