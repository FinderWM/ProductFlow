import { describe, expect, it } from "vitest";

import type { Deck, DeckSourceItem } from "../../lib/types";
import { buildDeckOutlineSlideContext, partitionDeckSources } from "./deckSourcePlanning";

const baseSource = (
  overrides: Partial<DeckSourceItem> & Pick<DeckSourceItem, "source_item_id" | "workflow_node_id">,
): DeckSourceItem => ({
  source_item_id: overrides.source_item_id,
  workflow_node_id: overrides.workflow_node_id,
  workflow_node_title: overrides.workflow_node_title ?? overrides.workflow_node_id,
  workflow_node_type: overrides.workflow_node_type ?? "image_generation",
  kind: overrides.kind ?? "poster",
  group_id: overrides.group_id ?? null,
  selected: overrides.selected ?? true,
  planning_role: overrides.planning_role ?? null,
  summary: overrides.summary ?? null,
  copy_set_id: overrides.copy_set_id ?? null,
  source_asset_id: overrides.source_asset_id ?? null,
  poster_variant_id: overrides.poster_variant_id ?? null,
  tail_batch_id: overrides.tail_batch_id ?? null,
  tail_item_id: overrides.tail_item_id ?? null,
  download_url: overrides.download_url ?? null,
  preview_url: overrides.preview_url ?? null,
  thumbnail_url: overrides.thumbnail_url ?? null,
});

const baseDeck: Pick<Deck, "slides"> = {
  slides: [
    {
      id: "slide-1",
      order_index: 0,
      title: "封面",
      points: ["主标题", "副标题"],
      speaker_notes: null,
      slide_status: "pending",
      last_error: null,
      image_url: null,
      image_width: null,
      image_height: null,
      material_source: null,
      material_url: null,
      material_enhance_job_id: null,
      source_manifest_json: null,
      created_at: "2026-06-28T00:00:00Z",
      updated_at: "2026-06-28T00:00:00Z",
    },
    {
      id: "slide-2",
      order_index: 1,
      title: "第二页",
      points: [],
      speaker_notes: null,
      slide_status: "pending",
      last_error: null,
      image_url: null,
      image_width: null,
      image_height: null,
      material_source: null,
      material_url: null,
      material_enhance_job_id: null,
      source_manifest_json: null,
      created_at: "2026-06-28T00:00:00Z",
      updated_at: "2026-06-28T00:00:00Z",
    },
  ],
};

describe("deckSourcePlanning", () => {
  it("splits alternate visuals from primary/supporting sources", () => {
    const primaryCopy = baseSource({
      source_item_id: "node:copy-1:copy:copy-1",
      workflow_node_id: "copy-1",
      workflow_node_type: "copy_generation",
      kind: "copy",
      planning_role: "supporting",
    });
    const primaryPoster = baseSource({
      source_item_id: "node:image-1:poster:poster-1",
      workflow_node_id: "image-1",
      planning_role: "primary",
    });
    const alternatePoster = baseSource({
      source_item_id: "node:image-1:poster:poster-2",
      workflow_node_id: "image-1",
      planning_role: null,
    });

    const result = partitionDeckSources(
      { alternate_visual_source_item_ids: [alternatePoster.source_item_id] },
      [primaryCopy, primaryPoster, alternatePoster],
    );

    expect(result.primarySources.map((item) => item.source_item_id)).toEqual([
      primaryCopy.source_item_id,
      primaryPoster.source_item_id,
    ]);
    expect(result.alternateSources.map((item) => item.source_item_id)).toEqual([alternatePoster.source_item_id]);
  });

  it("builds outline slide context from unsaved local drafts", () => {
    const result = buildDeckOutlineSlideContext(baseDeck, {
      "slide-1": {
        title: "  新封面  ",
        points: [" 卖点一 ", "", "卖点二"],
      },
      "slide-2": {
        title: "   ",
        points: [" 第二维度 "],
      },
    });

    expect(result).toEqual([
      { title: "新封面", points: ["卖点一", "卖点二"] },
      { points: ["第二维度"] },
    ]);
  });
});
