import type { DeckSlide } from "../../lib/types";

export interface DeckSlideSourcePlan {
  pageType: string | null;
  groupId: string | null;
  groupLabel: string | null;
  sourceRefIds: string[];
  materialHint: string | null;
  captionSource: string | null;
  selectedSourceItemId: string | null;
}

export interface DeckGroupDescriptor {
  kind: "tail" | "node" | "other";
  raw: string;
  shortId: string;
}

export function readDeckSlideSourcePlan(
  slide: Pick<DeckSlide, "source_manifest_json">,
): DeckSlideSourcePlan {
  const manifest = slide.source_manifest_json;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return emptyDeckSlideSourcePlan();
  }
  const sourceRefIds = stringArray(
    manifest.source_ref_ids ?? manifest.source_item_ids,
  );
  return {
    pageType: optionalString(manifest.page_type),
    groupId: optionalString(manifest.group_id),
    groupLabel: optionalString(manifest.group_label),
    sourceRefIds,
    materialHint: optionalString(manifest.material_hint),
    captionSource: optionalString(manifest.caption_source),
    selectedSourceItemId: optionalString(manifest.source_item_id),
  };
}

export function describeDeckGroupId(groupId: string | null): DeckGroupDescriptor | null {
  if (!groupId) {
    return null;
  }
  if (groupId.startsWith("tail:")) {
    const rawId = groupId.slice("tail:".length);
    return { kind: "tail", raw: groupId, shortId: shortStableId(rawId) };
  }
  if (groupId.startsWith("node:")) {
    const rawId = groupId.slice("node:".length);
    return { kind: "node", raw: groupId, shortId: shortStableId(rawId) };
  }
  return { kind: "other", raw: groupId, shortId: shortStableId(groupId) };
}

function emptyDeckSlideSourcePlan(): DeckSlideSourcePlan {
  return {
    pageType: null,
    groupId: null,
    groupLabel: null,
    sourceRefIds: [],
    materialHint: null,
    captionSource: null,
    selectedSourceItemId: null,
  };
}

function optionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => optionalString(item))
    .filter((item): item is string => Boolean(item));
}

function shortStableId(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    return "";
  }
  return normalized.length <= 12 ? normalized : `${normalized.slice(0, 8)}...`;
}
