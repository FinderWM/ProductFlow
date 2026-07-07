import { Download, Sparkles } from "lucide-react";

import { MediaPreviewTrigger } from "../../components/MediaPreviewTrigger";
import {
  actionButtonClassNameForAppearance,
  actionButtonComponentForAppearance,
  type LayoutActionAppearance,
} from "../../components/layoutActionButtons";
import { formatDateTime } from "../../lib/format";
import type { DownloadableImage } from "../../lib/image-downloads";
import { useI18n } from "../../lib/preferences";
import type { PosterVariant, InspirationDetail, SourceAsset } from "../../lib/types";
import { buildPosterDownload, buildSourceImageDownload } from "./imageDownloads";

export function DownloadLink({
  image,
  appearance,
  variant = "button",
}: {
  image: DownloadableImage;
  appearance: LayoutActionAppearance;
  variant?: "button" | "overlay";
}) {
  const { t } = useI18n();
  const className = actionButtonClassNameForAppearance(appearance, {
    preset: "secondary",
    size: "sm",
    className:
      variant === "overlay"
        ? "nodrag nopan nowheel absolute bottom-2 right-2 text-[10px] shadow-md backdrop-blur-sm"
        : "nodrag nopan nowheel text-[10px]",
  });
  return (
    <a
      data-node-action
      href={image.downloadUrl}
      download={image.filename}
      onClick={(event) => event.stopPropagation()}
      target="_blank"
      rel="noreferrer"
      className={className}
      title={t("detail.downloadImage", { filename: image.filename })}
      aria-label={t("detail.downloadImage", { filename: image.filename })}
    >
      <Download size={11} className="mr-1" /> {t("detail.download")}
    </a>
  );
}

export function PosterThumb({
  poster,
  inspirationName,
  onPreview,
  onUseAsReference,
  appearance,
  useAsReferenceDisabled = false,
  useAsReferenceBusy = false,
}: {
  poster: PosterVariant;
  inspirationName: string;
  onPreview?: (image: DownloadableImage) => void;
  onUseAsReference?: () => void;
  appearance: LayoutActionAppearance;
  useAsReferenceDisabled?: boolean;
  useAsReferenceBusy?: boolean;
}) {
  const { t } = useI18n();
  const ActionButton = actionButtonComponentForAppearance(appearance);
  const image = buildPosterDownload(inspirationName, poster, undefined, t);
  const thumbnailImage = buildPosterDownload(inspirationName, poster, poster.thumbnail_url, t);
  return (
    <div className="group overflow-hidden rounded-2xl shadow-sm transition-all hover:scale-[1.01] config-bubble">
      <MediaPreviewTrigger
        onPreview={() => onPreview?.(image)}
        className="block w-full overflow-hidden"
        aria-label={t("detail.previewImage", { alt: image.alt })}
      >
        <div className="aspect-square bg-zinc-100 dark:bg-[#0b1220]">
          <img
            src={thumbnailImage.previewUrl}
            alt={image.alt}
            className="h-full w-full object-cover transition-all duration-300 group-hover:scale-105"
          />
        </div>
      </MediaPreviewTrigger>
      <div className="flex items-center justify-between gap-2 border-t border-zinc-100 px-2.5 py-1.5 text-[10px] text-zinc-500 dark:border-slate-800 dark:text-slate-400">
        <span className="min-w-0 truncate">
          {poster.kind === "main_image" ? t("detail.mainImage") : t("detail.promoImage")} ·{" "}
          {formatDateTime(poster.created_at)}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {onUseAsReference ? (
            <ActionButton
              data-node-action
              onClick={(event) => {
                event.stopPropagation();
                onUseAsReference();
              }}
              disabled={useAsReferenceDisabled || useAsReferenceBusy}
              preset="secondary"
              size="sm"
              className="px-2 py-1 text-[10px]"
              title={t("detail.fillCurrentNode")}
            >
              {useAsReferenceBusy ? t("detail.filling") : t("detail.fill")}
            </ActionButton>
          ) : null}
          <DownloadLink image={image} appearance={appearance} />
        </div>
      </div>
    </div>
  );
}

export function SourceAssetThumb({
  asset,
  inspiration,
  onPreview,
  onUseAsReference,
  appearance,
  useAsReferenceDisabled = false,
  useAsReferenceBusy = false,
}: {
  asset: SourceAsset;
  inspiration: InspirationDetail;
  onPreview?: (image: DownloadableImage) => void;
  onUseAsReference?: () => void;
  appearance: LayoutActionAppearance;
  useAsReferenceDisabled?: boolean;
  useAsReferenceBusy?: boolean;
}) {
  const { t } = useI18n();
  const ActionButton = actionButtonComponentForAppearance(appearance);
  const image = buildSourceImageDownload(
    inspiration,
    asset,
    asset.kind === "original_image" ? t("detail.mainImage") : t("detail.referenceImage"),
    undefined,
    t,
  );
  const thumbnailImage = buildSourceImageDownload(
    inspiration,
    asset,
    asset.kind === "original_image" ? t("detail.mainImage") : t("detail.referenceImage"),
    asset.thumbnail_url,
    t,
  );
  return (
    <div className="group overflow-hidden rounded-2xl shadow-sm transition-all hover:scale-[1.01] config-bubble">
      <MediaPreviewTrigger
        onPreview={() => onPreview?.(image)}
        className="block w-full overflow-hidden"
        aria-label={t("detail.previewImage", { alt: image.alt })}
      >
        <div className="flex aspect-square items-center justify-center bg-zinc-100 p-2 dark:bg-[#0b1220]">
          <img
            src={thumbnailImage.previewUrl}
            alt={image.alt}
            className="h-full w-full object-contain transition-all duration-300 group-hover:scale-105"
          />
        </div>
      </MediaPreviewTrigger>
      <div className="flex items-center justify-between gap-2 border-t border-zinc-100 px-2.5 py-1.5 text-[10px] text-zinc-500 dark:border-slate-800 dark:text-slate-400">
        <span className="min-w-0 truncate">
          {t("detail.referenceImage")} · {formatDateTime(asset.created_at)}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {onUseAsReference ? (
            <ActionButton
              data-node-action
              onClick={(event) => {
                event.stopPropagation();
                onUseAsReference();
              }}
              disabled={useAsReferenceDisabled || useAsReferenceBusy}
              preset="secondary"
              size="sm"
              className="px-2 py-1 text-[10px]"
              title={t("detail.fillCurrentNode")}
            >
              {useAsReferenceBusy ? t("detail.filling") : t("detail.fill")}
            </ActionButton>
          ) : null}
          <DownloadLink image={image} appearance={appearance} />
        </div>
      </div>
      {onUseAsReference ? (
        <div className="flex items-center border-t border-slate-100 px-2 py-1.5 text-[10px] leading-4 text-zinc-500 dark:border-slate-800 dark:text-slate-300">
          <Sparkles size={11} className="mr-1 shrink-0 text-indigo-500 dark:text-violet-400" />
          {t("detail.canUseAsReference")}
        </div>
      ) : null}
    </div>
  );
}
