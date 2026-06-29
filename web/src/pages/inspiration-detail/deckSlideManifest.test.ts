import { describe, expect, it } from "vitest";

import { describeDeckGroupId, readDeckSlideSourcePlan } from "./deckSlideManifest";

describe("readDeckSlideSourcePlan", () => {
  it("reads page planning fields from slide manifest", () => {
    const plan = readDeckSlideSourcePlan({
      source_manifest_json: {
        page_type: "image",
        group_id: "tail:item-1234567890",
        group_label: "第一组",
        source_ref_ids: ["node:image:1", "node:copy:1", "", 3],
        material_hint: "主画面用成品图",
        caption_source: "copy_summary",
        source_item_id: "node:image:1",
      },
    });

    expect(plan).toEqual({
      pageType: "image",
      groupId: "tail:item-1234567890",
      groupLabel: "第一组",
      sourceRefIds: ["node:image:1", "node:copy:1"],
      materialHint: "主画面用成品图",
      captionSource: "copy_summary",
      selectedSourceItemId: "node:image:1",
    });
  });

  it("falls back to source_item_ids when source_ref_ids are absent", () => {
    const plan = readDeckSlideSourcePlan({
      source_manifest_json: {
        source_item_ids: ["node:image:1", "node:copy:1"],
      },
    });

    expect(plan.sourceRefIds).toEqual(["node:image:1", "node:copy:1"]);
  });

  it("returns an empty plan for invalid manifests", () => {
    expect(readDeckSlideSourcePlan({ source_manifest_json: null })).toEqual({
      pageType: null,
      groupId: null,
      groupLabel: null,
      sourceRefIds: [],
      materialHint: null,
      captionSource: null,
      selectedSourceItemId: null,
    });
    expect(readDeckSlideSourcePlan({ source_manifest_json: ["bad"] as unknown as Record<string, unknown> })).toEqual({
      pageType: null,
      groupId: null,
      groupLabel: null,
      sourceRefIds: [],
      materialHint: null,
      captionSource: null,
      selectedSourceItemId: null,
    });
  });
});

describe("describeDeckGroupId", () => {
  it("classifies tail and node groups with short ids", () => {
    expect(describeDeckGroupId("tail:item-1234567890")).toEqual({
      kind: "tail",
      raw: "tail:item-1234567890",
      shortId: "item-123...",
    });
    expect(describeDeckGroupId("node:node-abcdef123456")).toEqual({
      kind: "node",
      raw: "node:node-abcdef123456",
      shortId: "node-abc...",
    });
  });

  it("keeps unknown groups as generic", () => {
    expect(describeDeckGroupId("custom-group")).toEqual({
      kind: "other",
      raw: "custom-group",
      shortId: "custom-group",
    });
    expect(describeDeckGroupId(null)).toBeNull();
  });
});
