import { getResourceDisabledReason, isResourceBlocked } from "../../components/ResourceGovernance";
import type { TranslationKey, TranslationParams } from "../../lib/i18n";
import type { GalleryEntry } from "../../lib/types";

type GalleryModerationEntry = Pick<
  GalleryEntry,
  "enabled" | "disabled_reason" | "effective_enabled" | "effective_disabled_reason"
>;

type Translate = (key: TranslationKey, params?: TranslationParams) => string;

export function galleryAdminRemovedLabel(entry: GalleryModerationEntry, t: Translate): string | null {
  if (!isResourceBlocked(entry)) {
    return null;
  }
  const reason = getResourceDisabledReason(entry);
  return reason ? t("gallery.adminRemovedWithReason", { reason }) : t("gallery.adminRemoved");
}
