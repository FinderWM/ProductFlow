import { Check, Image as ImageIcon, ImagePlus, Library, Loader2, Trash2 } from "lucide-react";

import { ActionButton, actionButtonClassName, actionSurfaceClassName } from "../../components/ActionButton";
import { ClipboardImageButton } from "../../components/ClipboardImageButton";
import { ImageDropZone } from "../../components/ImageDropZone";
import { ParameterHelpLabel } from "../../components/ParameterHelp";
import {
  getResourceBlockedActionTitle,
  isResourceBlocked,
  ResourceMetaBadges,
} from "../../components/ResourceGovernance";
import { WorkspaceCheckbox, WorkspaceSelectField } from "../../components/workspaceInputs";
import { api } from "../../lib/api";
import { formatImageSizeValue } from "../../lib/imageSizes";
import type { ImageSessionAsset, ImageSessionRound, InspirationDetail, InspirationSummary, SourceAsset } from "../../lib/types";
import type { ImageChatTranslate } from "./display";

const IMAGE_CHAT_SECONDARY_ACTION_CLASS = actionButtonClassName({ preset: "secondary", size: "lg" });
const IMAGE_CHAT_DANGER_ICON_ACTION_CLASS = actionButtonClassName({ preset: "danger", size: "icon-sm" });
const IMAGE_CHAT_REFERENCE_LOAD_ACTION_CLASS = actionSurfaceClassName({
  preset: "secondary",
  focusWithin: true,
  className:
    "pf-action-surface--dashed flex h-full min-h-11 w-full items-center justify-center px-3 py-2 text-center text-sm font-semibold leading-4",
});

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
          className={`${IMAGE_CHAT_REFERENCE_LOAD_ACTION_CLASS} cursor-pointer`}
          activeClassName="pf-action-surface--active"
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
          <ActionButton
            preset="secondary"
            size="lg"
            onClick={onOpenResourceLibrary}
            disabled={Boolean(resourceLibraryDisabledTitle)}
            title={resourceLibraryDisabledTitle ?? t("chat.resourceLibrary.addReference")}
            leadingIcon={<Library size={15} className="shrink-0" />}
            className="h-full min-h-11 w-full whitespace-normal px-3 py-2 text-center leading-4"
          >
            {t("chat.resourceLibrary.addReference")}
          </ActionButton>
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
                <WorkspaceCheckbox
                  checked={selected}
                  size="sm"
                  disabled={selectionDisabled || selectionLimitReached || (assetBlocked && !selected)}
                  onChange={(event) => onToggle(asset.id, event.target.checked)}
                  aria-label={t("chat.useReference")}
                  title={assetBlocked ? assetBlockedTitle : t("chat.useReference")}
                  wrapperClassName="absolute bottom-1 left-1 flex h-6 w-6 items-center justify-center gap-0 rounded-md bg-white/95 p-0 text-slate-700 shadow-sm ring-1 ring-slate-200 dark:bg-slate-950/90 dark:text-violet-100 dark:ring-violet-400/35"
                  controlClassName="mt-0 h-3 w-3"
                />
                <ActionButton
                  preset="danger"
                  size="icon-sm"
                  aria-label={t("chat.deleteSessionReference")}
                  onClick={() => onDelete(asset.id)}
                  disabled={deleting || disabled || assetBlocked}
                  title={assetBlocked ? assetBlockedTitle : t("chat.deleteSessionReference")}
                  loading={deleting}
                  leadingIcon={<Trash2 size={13} />}
                  className={`absolute right-1 top-1 bg-white/90 opacity-100 dark:bg-slate-950/90 md:opacity-0 md:group-hover:opacity-100 ${IMAGE_CHAT_DANGER_ICON_ACTION_CLASS}`}
                >
                </ActionButton>
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
          <WorkspaceSelectField
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
            size="compact"
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
                <ActionButton
                  preset="danger"
                  size="icon-sm"
                  aria-label={t("chat.deleteInspirationReference")}
                  onClick={() => onDeleteReference(asset.id)}
                  disabled={deleting || assetBlocked || Boolean(editBlockedTitle)}
                  title={editBlockedTitle ?? (assetBlocked ? assetBlockedTitle : t("chat.deleteInspirationReference"))}
                  loading={deleting}
                  leadingIcon={<Trash2 size={12} />}
                  className={`absolute right-1 top-1 h-6 w-6 min-h-6 min-w-6 bg-white/90 opacity-100 dark:bg-slate-950/90 md:opacity-0 md:group-hover:opacity-100 ${IMAGE_CHAT_DANGER_ICON_ACTION_CLASS}`}
                >
                </ActionButton>
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
          <ActionButton
            preset="primary"
            size="md"
            onClick={() => onAttach("reference")}
            disabled={saveDisabled}
            title={saveDisabledTitle || t("chat.addReference")}
            loading={attachBusy}
            leadingIcon={<Check size={14} />}
            className="px-3 py-2 text-sm"
          >
            {isInspirationMode ? t("chat.addReference") : t("chat.saveAsReference")}
          </ActionButton>
          {isInspirationMode ? (
            <ActionButton
              preset="primary"
              size="md"
              onClick={() => onAttach("main_source")}
              disabled={saveDisabled}
              title={saveDisabledTitle || t("chat.setMainSource")}
              loading={attachBusy}
              leadingIcon={<ImageIcon size={14} />}
              className="px-3 py-2 text-sm"
            >
              {t("chat.setMainSource")}
            </ActionButton>
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
