import type { Deck, DeckSourceItem, DeckSourceManifest } from "../../lib/types";

export interface DeckOutlineSlideContextItem {
  title?: string;
  points?: string[];
}

export interface DeckOutlineSlideDraft {
  title: string;
  points: string[];
}

export function partitionDeckSources(
  manifest: Pick<DeckSourceManifest, "alternate_visual_source_item_ids"> | undefined,
  sources: DeckSourceItem[],
): {
  primarySources: DeckSourceItem[];
  alternateSources: DeckSourceItem[];
} {
  const alternateSourceIds = new Set(manifest?.alternate_visual_source_item_ids ?? []);
  const primarySources: DeckSourceItem[] = [];
  const alternateSources: DeckSourceItem[] = [];

  for (const source of sources) {
    const isAlternate =
      source.planning_role === "alternate" || alternateSourceIds.has(source.source_item_id);
    if (isAlternate) {
      alternateSources.push(source);
      continue;
    }
    primarySources.push(source);
  }

  return { primarySources, alternateSources };
}

export function buildDeckOutlineSlideContext(
  deck: Pick<Deck, "slides"> | undefined,
  slideDrafts: Record<string, DeckOutlineSlideDraft>,
): DeckOutlineSlideContextItem[] {
  if (!deck) {
    return [];
  }
  return deck.slides.flatMap((slide) => {
    const draft = slideDrafts[slide.id];
    const title = normalizeOptionalText(draft?.title ?? slide.title);
    const points = normalizePoints(draft?.points ?? slide.points);
    if (!title && !points.length) {
      return [];
    }
    return [
      {
        ...(title ? { title } : {}),
        ...(points.length ? { points } : {}),
      },
    ];
  });
}

function normalizeOptionalText(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
}

function normalizePoints(points: string[]): string[] {
  return points
    .map((point) => normalizeOptionalText(point))
    .filter((point): point is string => Boolean(point));
}
