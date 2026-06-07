import type { InspirationSummary } from "../lib/types";

export type InspirationKeyInfo =
  | { kind: "image"; thumbnailUrl: string; previewUrl: string | null; filename: string | null }
  | { kind: "text"; text: string }
  | { kind: "empty" };

export function inspirationMainThumbnailUrl(inspiration: InspirationSummary): string | null {
  return inspiration.latest_generated_image_thumbnail_url ?? inspiration.latest_generated_image_preview_url;
}

export function inspirationStartImageThumbnailUrl(inspiration: InspirationSummary): string | null {
  return inspiration.source_image_thumbnail_url ?? inspiration.source_image_preview_url;
}

export function inspirationKeyInfo(inspiration: InspirationSummary): InspirationKeyInfo {
  const startImageUrl = inspirationStartImageThumbnailUrl(inspiration);
  if (inspiration.initial_workflow_entry === "image" || (!inspiration.initial_workflow_entry && startImageUrl)) {
    if (!startImageUrl) {
      return { kind: "empty" };
    }
    return {
      kind: "image",
      thumbnailUrl: startImageUrl,
      previewUrl: inspiration.source_image_preview_url,
      filename: inspiration.source_image_filename,
    };
  }
  if (
    (inspiration.initial_workflow_entry === "copy" || inspiration.initial_workflow_entry === "tail") &&
    (inspiration.initial_entry_text || inspiration.initial_entry_text_excerpt)
  ) {
    const text = (inspiration.initial_entry_text ?? inspiration.initial_entry_text_excerpt ?? "").trim();
    return text ? { kind: "text", text } : { kind: "empty" };
  }
  return { kind: "empty" };
}
