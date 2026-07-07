// 图片生成配置测试结果预览弹窗。纯展示组件，生命周期动作由 SettingsPage 管。

import { GalleryHorizontalEnd, MessageSquareText, Save } from "lucide-react";

import { GalleryImagePreviewDialog } from "../../../components/GalleryImagePreviewDialog";
import { actionButtonComponentForAppearance, type LayoutActionAppearance } from "../../../components/layoutActionButtons";
import { api } from "../../../lib/api";
import { formatImageSizeValue } from "../../../lib/imageSizes";
import { useI18n } from "../../../lib/preferences";
import type { ImageGenerationConfigTestResponse } from "../../../lib/types";

export function ImageConfigTestResultDialog({
  appearance,
  result,
  canSaveGallery,
  canSaveResourceLibrary,
  canKeepSession,
  busy,
  savingGallery,
  keepingSession,
  onSaveGallery,
  onSaveResourceLibrary,
  onKeepSession,
  onClose,
}: {
  appearance: LayoutActionAppearance;
  result: ImageGenerationConfigTestResponse;
  canSaveGallery: boolean;
  canSaveResourceLibrary: boolean;
  canKeepSession: boolean;
  busy: boolean;
  savingGallery: boolean;
  keepingSession: boolean;
  onSaveGallery: () => void;
  onSaveResourceLibrary: () => void;
  onKeepSession: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const ActionButtonComponent = actionButtonComponentForAppearance(appearance);
  const saved = result.generated_asset.gallery_saved;
  const saveGalleryTitle = !canSaveGallery
    ? t("chat.permission.galleryWriteRequired")
    : saved
      ? t("chat.alreadyInGallery")
      : t("settings.generation.imageTestSaveToGallery");

  return (
    <GalleryImagePreviewDialog
      appearance={appearance}
      ariaLabel={t("settings.generation.imageTestPreviewLabel")}
      imageUrl={api.toApiUrl(result.generated_asset.preview_url)}
      imageAlt={result.round.prompt}
      title={t("settings.generation.imageTestPreviewTitle")}
      subtitle={result.generated_asset.original_filename}
      body={result.round.prompt || t("gallery.noPrompt")}
      metadataRows={[
        {
          label: t("gallery.meta.size"),
          value: result.round.actual_size
            ? t("gallery.sizeActualRequested", {
                actual: formatImageSizeValue(result.round.actual_size),
                requested: formatImageSizeValue(result.round.size),
              })
            : formatImageSizeValue(result.round.size),
        },
        { label: t("gallery.meta.model"), value: result.model_name },
        { label: t("gallery.meta.resourceGroup"), value: result.round.resource_group.name },
        {
          label: t("settings.generation.imageTestDuration"),
          value: `${Math.max(1, Math.round(result.duration_ms))}ms`,
        },
      ]}
      providerNotes={result.round.provider_notes}
      providerNotesTitle={t("gallery.providerNotes")}
      downloadUrl={result.generated_asset.download_url}
      downloadLabel={t("gallery.download")}
      closeLabel={t("common.close")}
      onClose={onClose}
      footerExtra={
        <div className="grid gap-2">
          <ActionButtonComponent
            onClick={onSaveResourceLibrary}
            disabled={!canSaveResourceLibrary || busy}
            title={t("settings.generation.imageTestSaveToResourceLibrary")}
            aria-label={t("settings.generation.imageTestSaveToResourceLibrary")}
            preset="primary"
            size="md"
            fullWidth
            leadingIcon={<Save size={16} />}
          >
            {t("settings.generation.imageTestSaveToResourceLibrary")}
          </ActionButtonComponent>
          <ActionButtonComponent
            onClick={onSaveGallery}
            disabled={!canSaveGallery || saved || busy}
            loading={savingGallery}
            title={saveGalleryTitle}
            aria-label={saveGalleryTitle}
            preset="primary"
            size="md"
            fullWidth
            leadingIcon={<GalleryHorizontalEnd size={16} />}
          >
            {saved ? t("chat.alreadyInGallery") : t("settings.generation.imageTestSaveToGallery")}
          </ActionButtonComponent>
          <ActionButtonComponent
            onClick={onKeepSession}
            disabled={!canKeepSession || busy}
            loading={keepingSession}
            title={t("settings.generation.imageTestKeepSession")}
            aria-label={t("settings.generation.imageTestKeepSession")}
            preset="primary"
            size="md"
            fullWidth
            leadingIcon={<MessageSquareText size={16} />}
          >
            {t("settings.generation.imageTestKeepSession")}
          </ActionButtonComponent>
        </div>
      }
    />
  );
}
