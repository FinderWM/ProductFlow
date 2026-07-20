import { Image as ImageIcon, Save, X } from "lucide-react";
import {
  actionButtonComponentForAppearance,
  type LayoutActionAppearance,
} from "../../components/layoutActionButtons";
import { AsyncContent, AsyncErrorState, AsyncPausedState } from "../../components/loading/AsyncContent";
import { Skeleton, SkeletonCards } from "../../components/loading/Skeleton";
import {
  isResourceBlocked,
  ResourceBlockedNotice,
  ResourceMetaBadges,
} from "../../components/ResourceGovernance";
import { ModalShell } from "../../components/ModalShell";
import type { AsyncViewState } from "../../lib/asyncViewState";
import type { DownloadableImage } from "../../lib/image-downloads";
import { useI18n } from "../../lib/preferences";
import type { PosterVariant, InspirationDetail, SourceAsset, WorkflowNode } from "../../lib/types";

import { PosterThumb, SourceAssetThumb } from "./ImageDownloadComponents";
import { workflowNodeDisplayTitle } from "./nodeDisplay";

interface ImagesPanelProps {
  open: boolean;
  onClose: () => void;
  inspiration: InspirationDetail;
  posters: PosterVariant[];
  referenceAssets: SourceAsset[];
  artifactCount: number;
  state: AsyncViewState;
  onRetry: () => void;
  resourceStatusState: AsyncViewState;
  onRetryResourceStatus: () => void;
  selectedReferenceNode: WorkflowNode | null;
  posterSourceAssetIds: Map<string, string>;
  onPreviewImage: (image: DownloadableImage) => void;
  onFillFromSourceAsset: (sourceAssetId: string) => void;
  onFillFromPoster: (posterId: string) => void;
  onSavePosterToResourceLibrary?: (poster: PosterVariant) => void;
  onSaveSourceAssetToResourceLibrary?: (asset: SourceAsset) => void;
  savedPosterIds?: Set<string>;
  savedSourceAssetIds?: Set<string>;
  fillReferenceBusy: boolean;
  fillBlockedTitle?: string | null;
  resourceLibraryWriteDisabledTitle?: string | null;
  savingResourceLibrarySourceId?: string | null;
  workspaceSubpage?: boolean;
}

export function ImagesPanel({
  open,
  onClose,
  inspiration,
  posters,
  referenceAssets,
  artifactCount,
  state,
  onRetry,
  resourceStatusState,
  onRetryResourceStatus,
  selectedReferenceNode,
  posterSourceAssetIds,
  onPreviewImage,
  onFillFromSourceAsset,
  onFillFromPoster,
  onSavePosterToResourceLibrary,
  onSaveSourceAssetToResourceLibrary,
  savedPosterIds = new Set(),
  savedSourceAssetIds = new Set(),
  fillReferenceBusy,
  fillBlockedTitle = null,
  resourceLibraryWriteDisabledTitle = null,
  savingResourceLibrarySourceId = null,
  workspaceSubpage = false,
}: ImagesPanelProps) {
  const { t } = useI18n();
  const actionAppearance: LayoutActionAppearance = workspaceSubpage ? "workspace" : "classic";
  const PageActionButton = actionButtonComponentForAppearance(actionAppearance);
  const canFillReference = Boolean(selectedReferenceNode);
  const inspirationBlocked = isResourceBlocked(inspiration);
  const selectedReferenceLabel = selectedReferenceNode ? workflowNodeDisplayTitle(selectedReferenceNode, t) : "";
  const canSaveToResourceLibrary = Boolean(onSavePosterToResourceLibrary || onSaveSourceAssetToResourceLibrary);

  if (!open) {
    return null;
  }

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      ariaLabel={t("detail.images.galleryModalTitle")}
      overlayClassName="z-[74] bg-slate-950/55 px-3 py-4 backdrop-blur-sm sm:px-6"
      panelClassName="flex h-[min(880px,calc(100dvh-2rem))] w-full max-w-6xl min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-slate-700 dark:bg-[#0f1726] dark:shadow-black/45"
    >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800 sm:px-5">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-base font-semibold text-slate-950 dark:text-white">
                  <ImageIcon size={18} className="text-indigo-600 dark:text-violet-300" />
                  <span>{t("detail.images.galleryModalTitle")}</span>
                </div>
                <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {artifactCount ? t("detail.downloadableCount", { count: artifactCount }) : t("detail.waitingAssets")}
                </div>
              </div>
              <PageActionButton
                onClick={onClose}
                preset="secondary"
                size="icon-md"
                aria-label={t("resourceLibrary.close")}
                title={t("resourceLibrary.close")}
                leadingIcon={<X size={18} />}
              />
            </div>

            <div className="shrink-0 border-b border-slate-200 bg-slate-50/80 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/35 sm:px-5">
              <div className="min-w-0 space-y-1 text-xs text-slate-500 dark:text-slate-400">
                <ResourceBlockedNotice resource={inspiration} />
                {canFillReference ? (
                  <div className="font-semibold text-indigo-600 dark:text-violet-300">
                    {t("detail.fillInto", { label: selectedReferenceLabel })}
                  </div>
                ) : (
                  <div>{t("detail.selectImageNodeFirst")}</div>
                )}
                {resourceStatusState.error !== "none" || resourceStatusState.fetch === "fetching" ? (
                  <AsyncContent
                    state={resourceStatusState}
                    refreshIntent="background"
                    loadingLabel={t("app.loading")}
                    skeleton={<Skeleton className="h-3 w-44" />}
                    initialError={(
                      <AsyncErrorState
                        className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-100"
                        title={t("resourceLibrary.sourceStatusLoadFailed")}
                        retryLabel={t("common.retry")}
                        retryingLabel={t("app.loading")}
                        retrying={resourceStatusState.fetch === "fetching"}
                        onRetry={onRetryResourceStatus}
                      />
                    )}
                    paused={(
                      <AsyncPausedState
                        className="rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-300/30 dark:bg-amber-400/10 dark:text-amber-100"
                        title={t("app.requestPaused.title")}
                        message={t("app.requestPaused.message")}
                        retryLabel={t("common.retry")}
                        onRetry={onRetryResourceStatus}
                      />
                    )}
                    inactive={null}
                    empty={null}
                    refreshFeedback={
                      resourceStatusState.error === "refresh" ? (
                        <div className="flex items-center justify-between gap-2 text-xs text-red-600 dark:text-red-300">
                          <span>{t("resourceLibrary.sourceStatusLoadFailed")}</span>
                          <button type="button" className="font-semibold underline" onClick={onRetryResourceStatus}>
                            {t("common.retry")}
                          </button>
                        </div>
                      ) : null
                    }
                  >
                    {null}
                  </AsyncContent>
                ) : null}
                </div>
            </div>

            <AsyncContent
              state={state}
              refreshIntent="background"
              loadingLabel={t("app.loading")}
              className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4"
              skeleton={<SkeletonCards count={8} className="grid-cols-2 sm:grid-cols-3 xl:grid-cols-4" />}
              initialError={(
                <AsyncErrorState
                  title={t("detail.images.loadFailed")}
                  retryLabel={t("common.retry")}
                  retryingLabel={t("app.loading")}
                  retrying={state.fetch === "fetching"}
                  onRetry={onRetry}
                />
              )}
              paused={(
                <AsyncPausedState
                  title={t("app.requestPaused.title")}
                  message={t("app.requestPaused.message")}
                  retryLabel={t("common.retry")}
                  onRetry={onRetry}
                />
              )}
              inactive={null}
              empty={(
                <div className="glass-empty-state flex min-h-[320px] flex-col items-center justify-center gap-2 p-6 text-center text-xs leading-relaxed text-zinc-500 dark:text-slate-400">
                  <ImageIcon size={20} className="text-indigo-500 opacity-80 dark:text-violet-400" />
                  <div>{t("detail.noImages")}</div>
                </div>
              )}
              refreshFeedback={
                state.error === "refresh" ? (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-100">
                    <span>{t("detail.images.loadFailed")}</span>
                    <button type="button" className="font-semibold underline" onClick={onRetry}>
                      {t("common.retry")}
                    </button>
                  </div>
                ) : null
              }
            >
              {artifactCount ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {posters.map((poster) => {
            const sourceAssetId = posterSourceAssetIds.get(poster.id);
            const posterBlocked = inspirationBlocked || isResourceBlocked(poster);
            const saving = savingResourceLibrarySourceId === poster.id;
            return (
              <div key={poster.id} className="space-y-1.5">
                <PosterThumb
                  poster={poster}
                  inspirationName={inspiration.name}
                  appearance={actionAppearance}
                  onPreview={onPreviewImage}
                  onUseAsReference={
                    canFillReference
                      ? () => {
                          if (sourceAssetId) {
                            onFillFromSourceAsset(sourceAssetId);
                            return;
                          }
                          onFillFromPoster(poster.id);
                        }
                      : undefined
                  }
                  useAsReferenceDisabled={!canFillReference || posterBlocked || Boolean(fillBlockedTitle)}
                  useAsReferenceBusy={fillReferenceBusy}
                />
                <ResourceMetaBadges resource={poster} showReason />
                <ResourceGroupBadge name={poster.resource_group.name} />
                {onSavePosterToResourceLibrary ? (
                  <SaveToLibraryButton
                    busy={saving}
                    disabled={!canSaveToResourceLibrary || posterBlocked || Boolean(resourceLibraryWriteDisabledTitle)}
                    saved={savedPosterIds.has(poster.id)}
                    title={resourceLibraryWriteDisabledTitle ?? t("resourceLibrary.saveToLibrary")}
                    appearance={actionAppearance}
                    onClick={() => onSavePosterToResourceLibrary(poster)}
                  />
                ) : null}
              </div>
            );
          })}
          {referenceAssets.map((asset) => {
            const assetBlocked = inspirationBlocked || isResourceBlocked(asset);
            const saving = savingResourceLibrarySourceId === asset.id;
            return (
              <div key={asset.id} className="space-y-1.5">
                <SourceAssetThumb
                  asset={asset}
                  inspiration={inspiration}
                  appearance={actionAppearance}
                  onPreview={onPreviewImage}
                  onUseAsReference={
                    canFillReference
                      ? () => onFillFromSourceAsset(asset.id)
                      : undefined
                  }
                  useAsReferenceDisabled={!canFillReference || assetBlocked || Boolean(fillBlockedTitle)}
                  useAsReferenceBusy={fillReferenceBusy}
                />
                <ResourceMetaBadges resource={asset} showReason />
                {onSaveSourceAssetToResourceLibrary ? (
                  <SaveToLibraryButton
                    busy={saving}
                    disabled={!canSaveToResourceLibrary || assetBlocked || Boolean(resourceLibraryWriteDisabledTitle)}
                    saved={savedSourceAssetIds.has(asset.id)}
                    title={resourceLibraryWriteDisabledTitle ?? t("resourceLibrary.saveToLibrary")}
                    appearance={actionAppearance}
                    onClick={() => onSaveSourceAssetToResourceLibrary(asset)}
                  />
                ) : null}
              </div>
            );
          })}
                </div>
              ) : (
                <div className="glass-empty-state flex min-h-[320px] flex-col items-center justify-center gap-2 p-6 text-center text-xs leading-relaxed text-zinc-500 dark:text-slate-400">
                  <ImageIcon size={20} className="text-indigo-500 opacity-80 dark:text-violet-400" />
                  <div>{t("detail.noImages")}</div>
                </div>
              )}
            </AsyncContent>
    </ModalShell>
  );
}

function SaveToLibraryButton({
  busy,
  disabled,
  saved,
  title,
  appearance,
  onClick,
}: {
  busy: boolean;
  disabled: boolean;
  saved: boolean;
  title: string;
  appearance: LayoutActionAppearance;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const ActionButton = actionButtonComponentForAppearance(appearance);
  return (
    <ActionButton
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
      preset="primary"
      size="sm"
      fullWidth
      className="text-xs"
      loading={busy}
      leadingIcon={busy ? undefined : <Save size={14} />}
    >
      {saved ? t("resourceLibrary.alreadyInLibrary") : t("resourceLibrary.saveToLibrary")}
    </ActionButton>
  );
}

function ResourceGroupBadge({ name }: { name: string }) {
  return (
    <div className="inline-flex max-w-full rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 dark:border-violet-400/35 dark:bg-violet-500/12 dark:text-violet-100">
      <span className="truncate">{name}</span>
    </div>
  );
}
