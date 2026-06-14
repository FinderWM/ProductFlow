import { Check, Image as ImageIcon, ImagePlus, Library, Loader2, Trash2 } from "lucide-react";

import { ClipboardImageButton } from "../../components/ClipboardImageButton";
import { ImageDropZone } from "../../components/ImageDropZone";
import { ParameterHelpLabel } from "../../components/ParameterHelp";
import {
  getResourceBlockedActionTitle,
  isResourceBlocked,
  ResourceMetaBadges,
} from "../../components/ResourceGovernance";
import { SelectField } from "../../components/SelectField";
import { api } from "../../lib/api";
import { formatImageSizeValue } from "../../lib/imageSizes";
import type { ImageSessionAsset, ImageSessionRound, InspirationDetail, InspirationSummary, SourceAsset } from "../../lib/types";
import type { ImageChatTranslate } from "./display";

const IMAGE_CHAT_GRADIENT_ACTION_CLASS =
  "inline-flex items-center justify-center rounded-xl border border-[#56B3FE] bg-gradient-to-r from-[#56B3FE] via-[#2F7CFF] to-[#8B5CF6] font-semibold text-white shadow-sm shadow-[#56B3FE]/25 transition-[background-color,border-color,box-shadow,transform] duration-200 ease-out hover:border-[#7C3AED] hover:shadow-md hover:shadow-[#2F7CFF]/35 active:translate-y-px active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#56B3FE]/40 disabled:border-slate-200 disabled:bg-slate-200 disabled:bg-none disabled:text-slate-500 disabled:shadow-none disabled:hover:border-slate-200 disabled:active:translate-y-0 disabled:active:scale-100 dark:disabled:border-slate-700 dark:disabled:bg-slate-800 dark:disabled:text-slate-500";
const IMAGE_CHAT_SECONDARY_ACTION_CLASS =
  "inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950/80 dark:text-slate-200 dark:hover:border-violet-400/55 dark:hover:bg-slate-900 dark:hover:text-white";
const IMAGE_CHAT_REFERENCE_LOAD_ACTION_CLASS =
  "flex h-full min-h-11 w-full items-center justify-center rounded-xl px-3 py-2 text-center text-sm font-semibold leading-4 transition-colors disabled:cursor-not-allowed disabled:opacity-60";

interface SessionReferencePanelProps {
  assets: ImageSessionAsset[];
  selectedAssetIds: string[];
  maxSelectedCount: number;
  uploadBusy: boolean;
  deletingAssetId: string | null;
  disabled: boolean;
  selectionDisabled?: boolean;
  resourceLibraryDisabledTitle?: string | null;
  onFiles: (files: File[]) => void;
  onClipboardError?: (message: string) => void;
  onOpenResourceLibrary?: () => void;
  onToggle: (assetId: string, checked: boolean) => void;
  onDelete: (assetId: string) => void;
  onPreview: (asset: ImageSessionAsset) => void;
  t: ImageChatTranslate;
}

export function SessionReferencePanel({
  assets,
  selectedAssetIds,
  maxSelectedCount,
  uploadBusy,
  deletingAssetId,
  disabled,
  selectionDisabled = disabled,
  resourceLibraryDisabledTitle = null,
  onFiles,
  onClipboardError,
  onOpenResourceLibrary,
  onToggle,
  onDelete,
  onPreview,
  t,
}: SessionReferencePanelProps) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700/80 dark:bg-[#151f33]">
      <div className="mb-2 text-sm font-semibold text-slate-950 dark:text-white">
        <ParameterHelpLabel label={t("chat.sessionReferences")} helpKey="imageSessionReferences" uiType="imageChat" />
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(8.75rem,1fr))] gap-2">
        <ImageDropZone
          ariaLabel={t("chat.uploadSessionReference")}
          multiple
          disabled={disabled || uploadBusy}
          className={`${IMAGE_CHAT_REFERENCE_LOAD_ACTION_CLASS} cursor-pointer border border-dashed border-slate-300 bg-slate-50 text-slate-600 hover:border-indigo-300 hover:bg-indigo-50/40 dark:border-slate-600/80 dark:bg-[#0b1220] dark:text-slate-300 dark:hover:border-violet-400/55 dark:hover:bg-violet-500/10`}
          activeClassName="border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-violet-400 dark:bg-violet-500/12 dark:text-violet-100"
          onFiles={onFiles}
        >
          {({ isDragging }) => (
            <span className="inline-flex items-center justify-center gap-2">
              {uploadBusy ? <Loader2 size={16} className="shrink-0 animate-spin" /> : <ImagePlus size={16} className="shrink-0" />}
              <span>{isDragging ? t("chat.dropUpload") : t("chat.uploadSessionReference")}</span>
            </span>
          )}
        </ImageDropZone>
        <ClipboardImageButton
          rootClassName="min-w-0"
          buttonClassName={`${IMAGE_CHAT_SECONDARY_ACTION_CLASS} h-full min-h-11 w-full whitespace-normal px-3 py-2 text-center leading-4`}
          multiple
          disabled={disabled || uploadBusy}
          label={t("common.pasteImage")}
          closeLabel={t("common.close")}
          pasteAreaLabel={t("common.pasteImageTarget")}
          pasteAreaPlaceholder={t("common.pasteImagePlaceholder")}
          noImageMessage={t("common.clipboardNoImage")}
          onFiles={onFiles}
          onError={onClipboardError}
        />
        {onOpenResourceLibrary ? (
          <button
            type="button"
            onClick={onOpenResourceLibrary}
            disabled={Boolean(resourceLibraryDisabledTitle)}
            title={resourceLibraryDisabledTitle ?? t("chat.resourceLibrary.addReference")}
            className={`${IMAGE_CHAT_SECONDARY_ACTION_CLASS} h-full min-h-11 w-full whitespace-normal px-3 py-2 text-center leading-4`}
          >
            <Library size={15} className="mr-2 shrink-0" />
            <span>{t("chat.resourceLibrary.addReference")}</span>
          </button>
        ) : null}
      </div>
      <div className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
        {t("chat.selectedReferences", { selected: selectedAssetIds.length, max: maxSelectedCount })}
      </div>
      {assets.length ? (
        <div className="mt-3 grid grid-cols-4 gap-2">
          {assets.map((asset) => {
            const deleting = deletingAssetId === asset.id;
            const selected = selectedAssetIds.includes(asset.id);
            const selectionLimitReached = !selected && selectedAssetIds.length >= maxSelectedCount;
            const assetBlocked = isResourceBlocked(asset);
            const assetBlockedTitle = getResourceBlockedActionTitle(asset, t("resource.blockedAction"));
            return (
              <div
                key={asset.id}
                className={`group relative overflow-hidden rounded-xl border bg-slate-50 dark:bg-[#0b1220] ${
                  selected
                    ? "border-indigo-500 ring-2 ring-indigo-100 dark:border-violet-400 dark:ring-violet-400/45"
                    : "border-slate-200 dark:border-slate-700"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onPreview(asset)}
                  title={asset.original_filename}
                  aria-label={t("detail.previewImage", { alt: asset.original_filename })}
                  className="block w-full"
                >
                  <img
                    src={api.toApiUrl(asset.thumbnail_url)}
                    alt={asset.original_filename}
                    loading="lazy"
                    decoding="async"
                    className="h-20 w-full object-cover"
                  />
                </button>
                <ResourceMetaBadges
                  resource={asset}
                  className="absolute left-1 top-1 max-w-[calc(100%-2.5rem)]"
                />
                <label className="absolute bottom-1 left-1 inline-flex h-6 w-6 items-center justify-center rounded-md bg-white/95 text-slate-700 shadow-sm ring-1 ring-slate-200 dark:bg-slate-950/90 dark:text-violet-100 dark:ring-violet-400/35">
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={selectionDisabled || selectionLimitReached || (assetBlocked && !selected)}
                    onChange={(event) => onToggle(asset.id, event.target.checked)}
                    aria-label={t("chat.useReference")}
                    title={assetBlocked ? assetBlockedTitle : t("chat.useReference")}
                    className="h-3 w-3 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="sr-only">{t("chat.useReference")}</span>
                </label>
                <button
                  type="button"
                  aria-label={t("chat.deleteSessionReference")}
                  onClick={() => onDelete(asset.id)}
                  disabled={deleting || disabled || assetBlocked}
                  title={assetBlocked ? assetBlockedTitle : t("chat.deleteSessionReference")}
                  className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-lg bg-white/90 text-slate-500 opacity-100 shadow-sm ring-1 ring-slate-200 transition-colors hover:text-red-600 disabled:opacity-60 dark:bg-slate-950/90 dark:text-slate-300 dark:ring-slate-700 dark:hover:text-red-300 md:opacity-0 md:group-hover:opacity-100"
                >
                  {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

interface InspirationAssociationPanelProps {
  isInspirationMode: boolean;
  inspiration: InspirationDetail | undefined;
  inspirations: InspirationSummary[];
  targetInspirationId: string;
  sourceImage: SourceAsset | null;
  referenceImages: SourceAsset[];
  selectedRound: ImageSessionRound | null;
  attachBusy: boolean;
  deletingReferenceAssetId: string | null;
  onTargetInspirationChange: (value: string) => void;
  onDeleteReference: (assetId: string) => void;
  onPreviewReference: (asset: SourceAsset) => void;
  onAttach: (target: "reference" | "main_source") => void;
  saveBlockedTitle?: string | null;
  editBlockedTitle?: string | null;
  t: ImageChatTranslate;
}

export function InspirationAssociationPanel({
  isInspirationMode,
  inspiration,
  inspirations,
  targetInspirationId,
  sourceImage,
  referenceImages,
  selectedRound,
  attachBusy,
  deletingReferenceAssetId,
  onTargetInspirationChange,
  onDeleteReference,
  onPreviewReference,
  onAttach,
  saveBlockedTitle = null,
  editBlockedTitle = null,
  t,
}: InspirationAssociationPanelProps) {
  const inspirationBlocked = isResourceBlocked(inspiration);
  const inspirationBlockedTitle = getResourceBlockedActionTitle(inspiration, t("resource.blockedAction"));
  const saveDisabled = attachBusy || !selectedRound || (!isInspirationMode && !targetInspirationId) || Boolean(saveBlockedTitle);
  const missingTargetTitle = inspirations.length ? t("chat.selectInspirationFirst") : t("chat.noInspirations");
  const saveDisabledTitle =
    saveBlockedTitle ?? (!selectedRound ? t("chat.selectHistoryFirst") : !isInspirationMode && !targetInspirationId ? missingTargetTitle : "");

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700/80 dark:bg-[#151f33]">
      <div className="mb-3 text-sm font-semibold text-zinc-900 dark:text-white">{t("chat.saveToInspiration")}</div>
      {isInspirationMode ? (
        inspiration ? (
          <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-3">
            <InspirationThumbnail sourceImage={sourceImage} alt={inspiration.name} />
            <div className="min-w-0 self-center">
              <div className="truncate text-sm font-medium text-zinc-900 dark:text-slate-100">{inspiration.name}</div>
              <div className="mt-1 text-xs text-zinc-500 dark:text-slate-400">{t("chat.inspirationReferenceCount", { count: referenceImages.length })}</div>
              <ResourceMetaBadges resource={inspiration} className="mt-1" showReason />
            </div>
          </div>
        ) : (
          <div className="flex justify-center py-6 text-zinc-400">
            <Loader2 size={16} className="animate-spin" />
          </div>
        )
      ) : (
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-200">{t("chat.targetInspiration")}</span>
          <SelectField
            value={targetInspirationId}
            options={
              inspirations.length
                ? inspirations.map((item) => ({
                    value: item.id,
                    label: isResourceBlocked(item) ? `${item.name} · ${t("resource.disabled")}` : item.name,
                    disabled: isResourceBlocked(item),
                  }))
                : [{ value: "", label: t("chat.noInspirations"), disabled: true }]
            }
            onChange={onTargetInspirationChange}
          />
        </label>
      )}

      {referenceImages.length ? (
        <div className="mt-3 grid grid-cols-4 gap-2">
          {referenceImages.slice(0, 4).map((asset) => {
            const deleting = deletingReferenceAssetId === asset.id;
            const assetBlocked = inspirationBlocked || isResourceBlocked(asset);
            const assetBlockedTitle = inspirationBlocked ? inspirationBlockedTitle : getResourceBlockedActionTitle(asset, t("resource.blockedAction"));
            return (
              <div key={asset.id} className="group relative overflow-hidden rounded-md border border-zinc-200 bg-white dark:border-slate-700 dark:bg-slate-950/70">
                <button
                  type="button"
                  onClick={() => onPreviewReference(asset)}
                  title={asset.original_filename}
                  aria-label={t("detail.previewImage", { alt: asset.original_filename })}
                  className="block w-full"
                >
                  <img
                    src={api.toApiUrl(asset.thumbnail_url)}
                    alt={asset.original_filename}
                    loading="lazy"
                    decoding="async"
                    className="h-16 w-full object-cover"
                  />
                </button>
                <ResourceMetaBadges
                  resource={assetBlocked && inspirationBlocked ? inspiration : asset}
                  className="absolute left-1 top-1 max-w-[calc(100%-2rem)]"
                />
                <button
                  type="button"
                  aria-label={t("chat.deleteInspirationReference")}
                  onClick={() => onDeleteReference(asset.id)}
                  disabled={deleting || assetBlocked || Boolean(editBlockedTitle)}
                  title={editBlockedTitle ?? (assetBlocked ? assetBlockedTitle : t("chat.deleteInspirationReference"))}
                  className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded bg-white/90 text-zinc-500 opacity-100 shadow-sm ring-1 ring-zinc-200 transition-colors hover:text-red-600 disabled:opacity-60 dark:bg-slate-950/90 dark:text-slate-300 dark:ring-slate-700 dark:hover:text-red-300 md:opacity-0 md:group-hover:opacity-100"
                >
                  {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="mt-4 border-t border-slate-200 pt-3 dark:border-slate-800">
        {selectedRound ? (
          <div className="mb-2 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
            {t("chat.selectedCandidate", { size: formatImageSizeValue(selectedRound.size) })}
          </div>
        ) : (
          <div className="mb-2 rounded-xl border border-dashed border-slate-200 bg-white px-3 py-2 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-950/45 dark:text-slate-500">
            {t("chat.selectHistoryFirst")}
          </div>
        )}
        <div className="grid gap-2">
          <button
            type="button"
            onClick={() => onAttach("reference")}
            disabled={saveDisabled}
            title={saveDisabledTitle || t("chat.addReference")}
            className={`${IMAGE_CHAT_GRADIENT_ACTION_CLASS} px-3 py-2 text-sm`}
          >
            {attachBusy ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Check size={14} className="mr-2" />}
            {isInspirationMode ? t("chat.addReference") : t("chat.saveAsReference")}
          </button>
          {isInspirationMode ? (
            <button
              type="button"
              onClick={() => onAttach("main_source")}
              disabled={saveDisabled}
              title={saveDisabledTitle || t("chat.setMainSource")}
              className={`${IMAGE_CHAT_GRADIENT_ACTION_CLASS} px-3 py-2 text-sm`}
            >
              {attachBusy ? <Loader2 size={14} className="mr-2 animate-spin" /> : <ImageIcon size={14} className="mr-2" />}
              {t("chat.setMainSource")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function InspirationThumbnail({ sourceImage, alt }: { sourceImage: SourceAsset | null; alt: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-slate-700 dark:bg-slate-950/70">
      {sourceImage ? (
        <img src={api.toApiUrl(sourceImage.thumbnail_url)} alt={alt} decoding="async" className="h-24 w-full object-cover" />
      ) : (
        <div className="flex h-24 items-center justify-center text-zinc-300 dark:text-slate-500">
          <ImageIcon size={20} />
        </div>
      )}
    </div>
  );
}
