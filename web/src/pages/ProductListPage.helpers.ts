import type { ProductSummary } from "../lib/types";

export type ProductKeyInfo =
  | { kind: "image"; thumbnailUrl: string; previewUrl: string | null; filename: string | null }
  | { kind: "text"; text: string }
  | { kind: "empty" };

export function productMainThumbnailUrl(product: ProductSummary): string | null {
  return product.latest_generated_image_thumbnail_url ?? product.latest_generated_image_preview_url;
}

export function productStartImageThumbnailUrl(product: ProductSummary): string | null {
  return product.source_image_thumbnail_url ?? product.source_image_preview_url;
}

export function productKeyInfo(product: ProductSummary): ProductKeyInfo {
  const startImageUrl = productStartImageThumbnailUrl(product);
  if (product.initial_workflow_entry === "image" || (!product.initial_workflow_entry && startImageUrl)) {
    if (!startImageUrl) {
      return { kind: "empty" };
    }
    return {
      kind: "image",
      thumbnailUrl: startImageUrl,
      previewUrl: product.source_image_preview_url,
      filename: product.source_image_filename,
    };
  }
  if (
    (product.initial_workflow_entry === "copy" || product.initial_workflow_entry === "tail") &&
    (product.initial_entry_text || product.initial_entry_text_excerpt)
  ) {
    const text = (product.initial_entry_text ?? product.initial_entry_text_excerpt ?? "").trim();
    return text ? { kind: "text", text } : { kind: "empty" };
  }
  return { kind: "empty" };
}
