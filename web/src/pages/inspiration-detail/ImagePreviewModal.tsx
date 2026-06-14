import { X } from "lucide-react";

import { ModalShell } from "../../components/ModalShell";
import { ZoomableImage } from "../../components/ZoomableImage";
import type { DownloadableImage } from "../../lib/image-downloads";
import { useI18n } from "../../lib/preferences";
import { IMAGE_PREVIEW_SURFACE_CLASS_NAME } from "./constants";
import { DownloadLink } from "./ImageDownloadComponents";

interface ImagePreviewModalProps {
  image: DownloadableImage;
  onClose: () => void;
}

export function ImagePreviewModal({ image, onClose }: ImagePreviewModalProps) {
  const { t } = useI18n();

  return (
    <ModalShell
      onClose={onClose}
      ariaLabel={image.alt}
      overlayClassName="pointer-events-auto z-[100] bg-zinc-950/70 p-6"
      panelClassName="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
    >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
          <div className="min-w-0 truncate text-sm font-medium text-zinc-800">
            {image.alt}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <DownloadLink image={image} />
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 text-zinc-500 hover:bg-zinc-50 hover:text-zinc-800"
              aria-label={t("detail.preview.close")}
            >
              <X size={16} />
            </button>
          </div>
        </div>
        <ZoomableImage
          src={image.previewUrl}
          alt={image.alt}
          zoomOutLabel={t("imagePreview.zoomOut")}
          zoomInLabel={t("imagePreview.zoomIn")}
          resetLabel={t("imagePreview.reset")}
          className={`h-[calc(100vh-11rem)] p-4 ${IMAGE_PREVIEW_SURFACE_CLASS_NAME}`}
        />
    </ModalShell>
  );
}
