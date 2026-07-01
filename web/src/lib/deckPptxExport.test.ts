import { describe, expect, it } from "vitest";

import type { Deck, DeckSlide } from "./types";
import { deckExportableSlides, deckPptxFilename } from "./deckPptxExport";

const baseSlide: DeckSlide = {
  id: "slide-1",
  order_index: 0,
  title: "Slide",
  points: [],
  speaker_notes: null,
  slide_status: "completed",
  last_error: null,
  image_url: "/api/deck-slides/slide-1/image",
  image_width: 1600,
  image_height: 900,
  material_source: null,
  material_url: null,
  material_enhance_job_id: null,
  source_manifest_json: null,
  created_at: "2026-06-26T00:00:00Z",
  updated_at: "2026-06-26T00:00:00Z",
};

const baseDeck: Deck = {
  id: "deck-1",
  inspiration_id: "inspiration-1",
  title: "汇报/演示",
  status: "completed",
  resource_group_id: "group-1",
  source_input: null,
  style_key: "clean_business",
  style_reference_asset_id: null,
  speaker_notes_enabled: true,
  pptx_url: null,
  workflow_node_id: null,
  workflow_node_exists: null,
  workflow_node_title: null,
  generated_slide_count: 1,
  source_manifest_json: null,
  slides: [],
  created_at: "2026-06-26T00:00:00Z",
  updated_at: "2026-06-26T00:00:00Z",
};

describe("deckPptxExport helpers", () => {
  it("exports only generated slides in slide order", () => {
    const deck = {
      ...baseDeck,
      slides: [
        { ...baseSlide, id: "slide-3", order_index: 3, image_url: "/api/deck-slides/slide-3/image" },
        { ...baseSlide, id: "slide-1", order_index: 1, image_url: null },
        { ...baseSlide, id: "slide-2", order_index: 2, image_url: "/api/deck-slides/slide-2/image" },
      ],
    };

    expect(deckExportableSlides(deck).map((slide) => slide.id)).toEqual(["slide-2", "slide-3"]);
  });

  it("uses a safe PPTX filename", () => {
    expect(deckPptxFilename("汇报/演示")).toBe("汇报-演示.pptx");
    expect(deckPptxFilename("")).toBe("deck.pptx");
  });
});
