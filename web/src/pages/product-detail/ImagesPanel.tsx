import { Image as ImageIcon } from "lucide-react";
import {
  isResourceBlocked,
  ResourceBlockedNotice,
  ResourceMetaBadges,
} from "../../components/ResourceGovernance";
import type { DownloadableImage } from "../../lib/image-downloads";
import { useI18n } from "../../lib/preferences";
import type { PosterVariant, ProductDetail, SourceAsset, WorkflowNode } from "../../lib/types";

import { PosterThumb, SourceAssetThumb } from "./ImageDownloadComponents";
import { workflowNodeDisplayTitle } from "./nodeDisplay";

interface ImagesPanelProps {
  product: ProductDetail;
  posters: PosterVariant[];
  referenceAssets: SourceAsset[];
  artifactCount: number;
  selectedReferenceNode: WorkflowNode | null;
  posterSourceAssetIds: Map<string, string>;
  onPreviewImage: (image: DownloadableImage) => void;
  onFillFromSourceAsset: (sourceAssetId: string) => void;
  onFillFromPoster: (posterId: string) => void;
  fillReferenceBusy: boolean;
  fillBlockedTitle?: string | null;
}

export function ImagesPanel({
  product,
  posters,
  referenceAssets,
  artifactCount,
  selectedReferenceNode,
  posterSourceAssetIds,
  onPreviewImage,
  onFillFromSourceAsset,
  onFillFromPoster,
  fillReferenceBusy,
  fillBlockedTitle = null,
}: ImagesPanelProps) {
  const { t } = useI18n();
  const canFillReference = Boolean(selectedReferenceNode);
  const productBlocked = isResourceBlocked(product);
  const selectedReferenceLabel = selectedReferenceNode ? workflowNodeDisplayTitle(selectedReferenceNode, t) : "";
  return (
    <section>
      <div className="mb-3 space-y-2 text-xs text-zinc-500 dark:text-slate-400">
        <ResourceBlockedNotice resource={product} />
        <div>{artifactCount ? t("detail.downloadableCount", { count: artifactCount }) : t("detail.waitingAssets")}</div>
        {canFillReference ? (
          <div className="text-indigo-600 dark:text-violet-400 font-semibold">
            {t("detail.fillInto", { label: selectedReferenceLabel })}
          </div>
        ) : (
          <div>{t("detail.selectImageNodeFirst")}</div>
        )}
      </div>
      {artifactCount ? (
        <div className="grid grid-cols-2 gap-2">
          {posters.map((poster) => {
            const sourceAssetId = posterSourceAssetIds.get(poster.id);
            const posterBlocked = productBlocked || isResourceBlocked(poster);
            return (
              <div key={poster.id} className="space-y-1.5">
                <PosterThumb
                  poster={poster}
                  productName={product.name}
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
              </div>
            );
          })}
          {referenceAssets.map((asset) => {
            const assetBlocked = productBlocked || isResourceBlocked(asset);
            return (
              <div key={asset.id} className="space-y-1.5">
                <SourceAssetThumb
                  asset={asset}
                  product={product}
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
              </div>
            );
          })}
        </div>
      ) : (
        <div className="glass-empty-state flex min-h-[160px] flex-col items-center justify-center gap-2 p-6 text-center text-xs leading-relaxed text-zinc-500 dark:text-slate-400">
          <ImageIcon size={18} className="text-indigo-500 opacity-80 dark:text-violet-400" />
          <div>{t("detail.noImages")}</div>
        </div>
      )}
    </section>
  );
}
