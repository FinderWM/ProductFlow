import { useEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Plus } from "lucide-react";

import {
  actionButtonComponentForAppearance,
  actionButtonToneStyle,
  actionSurfaceClassNameForAppearance,
  transparentActionToneVars,
  type ActionButtonToneVars,
  type LayoutActionAppearance,
} from "../../components/layoutActionButtons";
import { AsyncContent, AsyncErrorState, AsyncPausedState } from "../../components/loading/AsyncContent";
import { Skeleton } from "../../components/loading/Skeleton";
import type { PromptPreview } from "../../components/PromptPreviewDialog";
import type { AsyncViewState } from "../../lib/asyncViewState";
import { getVerticalWheelMappedScrollLeft } from "./resizableLayout";
import type { ImageHistoryBranch } from "./branching";
import type { ImageChatTranslate } from "./display";
import { HistoryBranchStrip } from "./HistoryBranchStrip";

function handleHistoryWheelScroll(event: WheelEvent, container: HTMLDivElement) {
  if (event.ctrlKey) {
    return;
  }
  const nextScrollLeft = getVerticalWheelMappedScrollLeft(container, event);
  if (nextScrollLeft === null) {
    return;
  }
  event.preventDefault();
  container.scrollLeft = nextScrollLeft;
}

interface ImageChatHistoryPanelProps {
  state: AsyncViewState;
  historyBranches: ImageHistoryBranch[];
  selectedGeneratedAssetId: string | null;
  selectedTaskPlaceholderId: string | null;
  selectedBaseAssetIds: string[];
  variant?: "desktop" | "mobileDrawer";
  appearance?: LayoutActionAppearance;
  style?: CSSProperties;
  onResizeStart?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onSelectRound: (assetId: string) => void;
  onAddRoundToBase?: (assetId: string) => void;
  onSelectPlaceholder: (placeholderId: string) => void;
  onRetry: () => void;
  onStartNewRound?: () => void;
  newRoundDisabled?: boolean;
  newRoundActive?: boolean;
  newRoundTitle?: string;
  maskSensitiveImages: boolean;
  onPreviewPrompt: (preview: PromptPreview) => void;
  t: ImageChatTranslate;
}

export function ImageChatHistoryPanel({
  state,
  historyBranches,
  selectedGeneratedAssetId,
  selectedTaskPlaceholderId,
  selectedBaseAssetIds,
  variant = "desktop",
  appearance = "classic",
  style,
  onResizeStart,
  onSelectRound,
  onAddRoundToBase,
  onSelectPlaceholder,
  onRetry,
  onStartNewRound,
  newRoundDisabled = false,
  newRoundActive = false,
  newRoundTitle,
  maskSensitiveImages,
  onPreviewPrompt,
  t,
}: ImageChatHistoryPanelProps) {
  const historyState: AsyncViewState = state.content === "ready" && historyBranches.length === 0
    ? { ...state, content: "empty" }
    : state;
  const ActionButton = actionButtonComponentForAppearance(appearance);
  const resizeHandleToneVars: ActionButtonToneVars = {
    ...transparentActionToneVars,
    "--pf-action-bg-hover": "color-mix(in srgb, var(--pf-accent) 14%, transparent)",
  };
  const resizeHandleClassName = actionSurfaceClassNameForAppearance(appearance, {
    preset: "secondary",
    focusWithin: true,
    className: "absolute inset-x-0 -top-1 z-20 hidden h-3 cursor-row-resize items-center justify-center border-0 shadow-none lg:flex",
  });
  const desktopHistoryScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = desktopHistoryScrollRef.current;
    if (!container) {
      return;
    }
    const handleWheel = (event: WheelEvent) => handleHistoryWheelScroll(event, container);
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", handleWheel);
    };
  }, [variant, historyBranches.length]);

  if (variant === "mobileDrawer") {
    return (
      <div className="relative flex min-h-0 flex-1 flex-col bg-white dark:bg-[#0f1726]">
        {onStartNewRound ? (
          <div className="border-b border-slate-200 px-2 py-2 dark:border-slate-800">
            <ActionButton
              preset="primary"
              size="lg"
              onClick={onStartNewRound}
              disabled={newRoundDisabled}
              title={newRoundTitle ?? t("chat.newRound")}
              aria-pressed={newRoundActive}
              leadingIcon={<Plus size={14} />}
              className="min-h-10 w-full px-3 text-xs"
            >
              {t("chat.newRound")}
            </ActionButton>
          </div>
        ) : null}
        <AsyncContent
          state={historyState}
          refreshIntent="background"
          loadingLabel={t("app.loading")}
          skeleton={(
            <div className="min-h-0 flex-1 space-y-3 overflow-hidden px-2 py-3">
              {[1, 2, 3].map((item) => <Skeleton key={item} className="h-24 w-full" rounded="lg" />)}
            </div>
          )}
          inactive={(
            <div className="flex min-h-0 flex-1 items-center justify-center px-3 py-6 text-center text-xs pf-ink-muted">
              {t("chat.selectSession")}
            </div>
          )}
          initialError={(
            <AsyncErrorState
              className="mx-2 my-3 rounded-xl border-[color:var(--pf-border)] pf-surface-soft px-3 py-3 text-xs text-[color:var(--pf-danger)]"
              title={t("chat.loadSessionFailed")}
              retryLabel={t("common.retry")}
              retryingLabel={t("app.loading")}
              retrying={historyState.fetch === "fetching"}
              onRetry={onRetry}
            />
          )}
          paused={(
            <AsyncPausedState
              className="mx-2 my-3 rounded-xl border-[color:var(--pf-border)] pf-surface-soft px-3 py-3 text-xs text-[color:var(--pf-accent-2)]"
              title={t("app.requestPaused.title")}
              message={t("app.requestPaused.message")}
              retryLabel={t("common.retry")}
              onRetry={onRetry}
            />
          )}
          empty={(
            <div className="flex min-h-0 flex-1 items-center justify-center px-2 py-6">
              <div className="flex min-h-24 w-full items-center justify-center rounded-2xl border border-dashed pf-hairline px-2 text-center text-xs pf-ink-muted">
                {t("chat.resultsAppearHere")}
              </div>
            </div>
          )}
          refreshFeedback={historyState.error === "refresh" ? (
            <div className="absolute inset-x-2 bottom-2 z-20 flex items-center justify-between gap-2 rounded-lg border-[color:var(--pf-border)] pf-surface-soft px-2 py-1.5 text-[11px] text-[color:var(--pf-accent-2)] shadow-sm">
              <span>{t("chat.loadSessionFailed")}</span>
              <button type="button" className="font-semibold underline" onClick={onRetry}>{t("common.retry")}</button>
            </div>
          ) : null}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-2 py-3">
            {historyBranches.map((branch) => (
              <HistoryBranchStrip
                key={branch.id}
                branch={branch}
                selectedGeneratedAssetId={selectedGeneratedAssetId}
                selectedTaskPlaceholderId={selectedTaskPlaceholderId}
                selectedBaseAssetIds={selectedBaseAssetIds}
                variant="mobileDrawer"
                appearance={appearance}
                maskSensitiveImages={maskSensitiveImages}
                onSelectRound={onSelectRound}
                onAddRoundToBase={onAddRoundToBase}
                onSelectPlaceholder={onSelectPlaceholder}
                onPreviewPrompt={onPreviewPrompt}
                t={t}
              />
            ))}
          </div>
        </AsyncContent>
      </div>
    );
  }

  return (
    <div
      className="relative hidden shrink-0 flex-col border-t border-slate-200 bg-white/95 px-2.5 py-2 shadow-[0_-8px_24px_rgba(15,23,42,0.04)] dark:border-slate-700/80 dark:bg-[#0f1726] dark:shadow-[0_-18px_40px_rgba(0,0,0,0.24)] lg:flex lg:h-[var(--image-chat-history-panel-height)] lg:px-3 lg:py-2.5"
      style={style}
    >
      {onResizeStart ? (
        <button
          type="button"
          aria-label={t("chat.resizeHistory")}
          title={t("chat.resizeHistoryTitle")}
          onPointerDown={onResizeStart}
          className={resizeHandleClassName}
          style={actionButtonToneStyle(resizeHandleToneVars)}
        >
          <span className="h-1 w-12 rounded-full bg-slate-300 dark:bg-slate-600" />
        </button>
      ) : null}
      <div className="mb-1 flex items-center justify-between gap-3 lg:mb-2">
        <div>
          <div className="text-sm font-semibold text-slate-950 dark:text-white">{t("chat.history")}</div>
        </div>
        <div className="flex min-w-0 items-center justify-end gap-2">
          <div className="truncate rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-950/45 dark:text-slate-300">
            {t("chat.historyMultiRoundHint")}
          </div>
          {onStartNewRound ? (
            <ActionButton
              preset="primary"
              size="sm"
              onClick={onStartNewRound}
              disabled={newRoundDisabled}
              title={newRoundTitle ?? t("chat.newRound")}
              aria-pressed={newRoundActive}
              leadingIcon={<Plus size={13} />}
              className="h-8 shrink-0 px-3 text-xs"
            >
              {t("chat.newRound")}
            </ActionButton>
          ) : selectedBaseAssetIds.length ? (
            <div className="shrink-0 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700 dark:border-violet-400/40 dark:bg-violet-500/15 dark:text-violet-100">
              {t("chat.clickHistoryBase")}
            </div>
          ) : null}
        </div>
      </div>

      <AsyncContent
        state={historyState}
        refreshIntent="background"
        loadingLabel={t("app.loading")}
        skeleton={(
          <div className="flex min-h-20 flex-1 gap-3 overflow-hidden pb-1">
            {[1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-full min-w-36 flex-1" rounded="lg" />)}
          </div>
        )}
        inactive={(
          <div className="flex min-h-0 flex-1 items-center justify-center rounded-2xl border border-dashed pf-hairline pf-surface-soft text-sm pf-ink-muted">
            {t("chat.selectSession")}
          </div>
        )}
        initialError={(
          <AsyncErrorState
            className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-2xl border-[color:var(--pf-border)] pf-surface-soft px-4 text-center text-sm text-[color:var(--pf-danger)]"
            title={t("chat.loadSessionFailed")}
            retryLabel={t("common.retry")}
            retryingLabel={t("app.loading")}
            retrying={historyState.fetch === "fetching"}
            onRetry={onRetry}
          />
        )}
        paused={(
          <AsyncPausedState
            className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-2xl border-[color:var(--pf-border)] pf-surface-soft px-4 text-center text-sm text-[color:var(--pf-accent-2)]"
            title={t("app.requestPaused.title")}
            message={t("app.requestPaused.message")}
            retryLabel={t("common.retry")}
            onRetry={onRetry}
          />
        )}
        empty={(
          <div className="flex min-h-0 flex-1 items-center justify-center rounded-2xl border border-dashed pf-hairline pf-surface-soft text-sm pf-ink-muted">
            {t("chat.resultsAppearHere")}
          </div>
        )}
        refreshFeedback={historyState.error === "refresh" ? (
          <div className="absolute bottom-2 right-3 z-20 flex items-center gap-3 rounded-lg border-[color:var(--pf-border)] pf-surface-soft px-3 py-2 text-xs text-[color:var(--pf-accent-2)] shadow-sm">
            <span>{t("chat.loadSessionFailed")}</span>
            <button type="button" className="font-semibold underline" onClick={onRetry}>{t("common.retry")}</button>
          </div>
        ) : null}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div
          ref={desktopHistoryScrollRef}
          className="image-chat-history-scroll flex min-h-0 flex-1 gap-3 overflow-x-auto overscroll-x-contain pb-1"
        >
          {historyBranches.map((branch) => (
            <HistoryBranchStrip
              key={branch.id}
              branch={branch}
              selectedGeneratedAssetId={selectedGeneratedAssetId}
              selectedTaskPlaceholderId={selectedTaskPlaceholderId}
              selectedBaseAssetIds={selectedBaseAssetIds}
              appearance={appearance}
              maskSensitiveImages={maskSensitiveImages}
              onSelectRound={onSelectRound}
              onAddRoundToBase={onAddRoundToBase}
              onSelectPlaceholder={onSelectPlaceholder}
              onPreviewPrompt={onPreviewPrompt}
              t={t}
            />
          ))}
        </div>
      </AsyncContent>
    </div>
  );
}
