import { Image as ImageIcon, Loader2, Save, X } from "lucide-react";
import {
  isResourceBlocked,
  ResourceBlockedNotice,
  ResourceMetaBadges,
} from "../../components/ResourceGovernance";
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
}

export function ImagesPanel({
  open,
  onClose,
  inspiration,
  posters,
  referenceAssets,
  artifactCount,
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
}: ImagesPanelProps) {
  const { t } = useI18n();
  const canFillReference = Boolean(selectedReferenceNode);
  const inspirationBlocked = isResourceBlocked(inspiration);
  const selectedReferenceLabel = selectedReferenceNode ? workflowNodeDisplayTitle(selectedReferenceNode, t) : "";
  const canSaveToResourceLibrary = Boolean(onSavePosterToResourceLibrary || onSaveSourceAssetToResourceLibrary);

  if (!open) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("detail.images.galleryModalTitle")}
      className="fixed inset-0 z-[74] flex items-center justify-center bg-slate-950/55 px-3 py-4 backdrop-blur-sm sm:px-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="flex h-[min(880px,calc(100dvh-2rem))] w-full max-w-6xl min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-slate-700 dark:bg-[#0f1726] dark:shadow-black/45">
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
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                aria-label={t("resourceLibrary.close")}
                title={t("resourceLibrary.close")}
              >
                <X size={18} />
              </button>
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
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
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
            </div>
          </div>
    </div>
  );
}

function SaveToLibraryButton({
  busy,
  disabled,
  saved,
  title,
  onClick,
}: {
  busy: boolean;
  disabled: boolean;
  saved: boolean;
  title: string;
  onClick: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
      className="inline-flex min-h-9 w-full items-center justify-center rounded-lg border border-[#56B3FE] bg-gradient-to-r from-[#56B3FE] via-[#2F7CFF] to-[#8B5CF6] px-3 text-xs font-semibold text-white shadow-sm shadow-[#56B3FE]/25 transition-[background-color,border-color,box-shadow,transform] duration-200 ease-out hover:border-[#7C3AED] hover:shadow-md hover:shadow-[#2F7CFF]/35 active:translate-y-px active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#56B3FE]/40 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-200 disabled:bg-none disabled:text-slate-500 disabled:shadow-none disabled:hover:border-slate-200 disabled:active:translate-y-0 disabled:active:scale-100 dark:disabled:border-slate-700 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
    >
      {busy ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : <Save size={14} className="mr-1.5" />}
      {saved ? t("resourceLibrary.alreadyInLibrary") : t("resourceLibrary.saveToLibrary")}
    </button>
  );
}

function ResourceGroupBadge({ name }: { name: string }) {
  return (
    <div className="inline-flex max-w-full rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 dark:border-violet-400/35 dark:bg-violet-500/12 dark:text-violet-100">
      <span className="truncate">{name}</span>
    </div>
  );
}
