import { describe, expect, it } from "vitest";

import type { CopyPayloadV2, InspirationDetail, WorkflowNode } from "../../lib/types";
import { defaultConfigForType, defaultTitleForType, draftFromNode, nodeConfigFromDraft } from "./workflowConfig";

const structuredPayload: CopyPayloadV2 = {
  version: 2,
  summary: "结构化摘要",
  content: {
    kind: "blocks",
    blocks: [{ id: "headline", role: "headline", label: "主信息", text: "结构化主信息" }],
  },
  visual_guidance: null,
};

const removedCopyOutputKeys = [
  "title",
  "selling" + "_points",
  "poster" + "_headline",
  "c" + "ta",
] as const;
const defaultResourceGroup = { id: "group-default", key: "default", name: "default" };

const baseNode: WorkflowNode = {
  id: "copy-node",
  workflow_id: "workflow-1",
  node_type: "copy_generation",
  title: "文案",
  position_x: 0,
  position_y: 0,
  config_json: {},
  status: "succeeded",
  output_json: {
    copy_set_id: "copy-set-1",
    structured_payload: structuredPayload,
    [removedCopyOutputKeys[0]]: "旧标题",
    [removedCopyOutputKeys[1]]: ["旧卖点"],
    [removedCopyOutputKeys[2]]: "旧海报标题",
    [removedCopyOutputKeys[3]]: "旧 CTA",
  },
  failure_reason: null,
  is_retryable: false,
  attempt_count: 0,
  retry_count: 0,
  non_retryable_reason: null,
  retry_hint: null,
  last_run_at: null,
  created_at: "2026-05-10T00:00:00Z",
  updated_at: "2026-05-10T00:00:00Z",
};

const inspiration: InspirationDetail = {
  id: "inspiration-1",
  resource_group_id: defaultResourceGroup.id,
  resource_group: defaultResourceGroup,
  name: "灵感产物",
  category: null,
  price: null,
  source_note: null,
  workflow_state: "draft",
  source_assets: [],
  latest_brief: null,
  current_confirmed_copy_set: null,
  copy_sets: [],
  poster_variants: [],
  created_at: "2026-05-10T00:00:00Z",
  updated_at: "2026-05-10T00:00:00Z",
};

describe("draftFromNode", () => {
  it("keeps copy draft on structured payload and ignores removed output fields", () => {
    const draft = draftFromNode(baseNode, inspiration);

    expect(draft.copyStructuredPayload).toEqual(structuredPayload);
    expect("copyTitle" in draft).toBe(false);
    expect("copySellingPoints" in draft).toBe(false);
    expect("copyPosterHeadline" in draft).toBe(false);
    expect("copyCta" in draft).toBe(false);
  });

  it("uses merchant-facing defaults for new nodes", () => {
    expect(defaultConfigForType("reference_image")).toMatchObject({ role: "reference", label: "" });
    expect(defaultTitleForType("reference_image", 1)).toBe("承载图片节点 1");
    expect(defaultTitleForType("copy_generation", 1)).toBe("文案生成节点 1");
    expect(defaultTitleForType("image_generation", 1)).toBe("生图触发器节点 1");
    expect(defaultConfigForType("deck_generation")).toMatchObject({
      resource_group_id: null,
      style_key: "clean_business",
      target_slide_count: 8,
      include_transitive_inputs: false,
      planning_strategy: "hybrid",
      slide_count_mode: "auto",
      group_by: "tail_item",
      section_pages: true,
      per_group_image_cap: 3,
      excluded_source_item_ids: [],
      source_order: [],
    });
  });

  it("round-trips deck source exclusion and ordering config", () => {
    const node: WorkflowNode = {
      ...baseNode,
      id: "deck-node",
      node_type: "deck_generation",
      title: "演示节点",
      config_json: {
        resource_group_id: "group-deck",
        style_key: "clean_business",
        source_input: "补充说明",
        target_slide_count: 12,
        include_transitive_inputs: true,
        planning_strategy: "image_led",
        slide_count_mode: "target",
        group_by: "source_node",
        section_pages: false,
        per_group_image_cap: 5,
        excluded_source_item_ids: ["node:copy:1", "node:image:2"],
        source_order: ["node:image:2", "node:copy:1", "node:context:3"],
      },
      output_json: null,
    };

    const draft = draftFromNode(node, inspiration);
    expect(draft.deckPlanningStrategy).toBe("image_led");
    expect(draft.deckSlideCountMode).toBe("target");
    expect(draft.deckGroupBy).toBe("source_node");
    expect(draft.deckSectionPages).toBe(false);
    expect(draft.deckPerGroupImageCap).toBe(5);
    expect(draft.deckExcludedSourceItemIds).toEqual(["node:copy:1", "node:image:2"]);
    expect(draft.deckSourceOrder).toEqual(["node:image:2", "node:copy:1", "node:context:3"]);

    expect(nodeConfigFromDraft(node, draft)).toMatchObject({
      planning_strategy: "image_led",
      slide_count_mode: "target",
      group_by: "source_node",
      section_pages: false,
      per_group_image_cap: 5,
      excluded_source_item_ids: ["node:copy:1", "node:image:2"],
      source_order: ["node:image:2", "node:copy:1", "node:context:3"],
    });
  });

  it("round-trips manual generation config selection on copy nodes", () => {
    const node = {
      ...baseNode,
      config_json: {
        instruction: "生成文案",
        resource_group_id: "group-text",
        generation_config_mode: "manual",
        generation_config_id: "config-text",
      },
    };
    const draft = draftFromNode(node, inspiration);

    expect(draft.resourceGroupId).toBe("group-text");
    expect(draft.generationConfigMode).toBe("manual");
    expect(draft.generationConfigId).toBe("config-text");
    expect(nodeConfigFromDraft(node, draft)).toMatchObject({
      resource_group_id: "group-text",
      generation_config_mode: "manual",
      generation_config_id: "config-text",
    });
  });

  it("round-trips manual generation config selection on image and tail nodes", () => {
    const imageNode: WorkflowNode = {
      ...baseNode,
      id: "image-node",
      node_type: "image_generation",
      config_json: {
        instruction: "生成图片",
        resource_group_id: "group-image",
        generation_config_mode: "manual",
        generation_config_id: "config-image",
      },
      output_json: null,
    };
    const tailNode: WorkflowNode = {
      ...baseNode,
      id: "tail-node",
      node_type: "tail_splitter",
      config_json: {
        source_text: "方向集合",
        description: "拆成生图方向",
        max_items: 4,
        resource_group_id: "group-text",
        generation_config_mode: "manual",
        generation_config_id: "config-text",
      },
      output_json: null,
    };

    const imageDraft = draftFromNode(imageNode, inspiration);
    const tailDraft = draftFromNode(tailNode, inspiration);

    expect(nodeConfigFromDraft(imageNode, imageDraft)).toMatchObject({
      resource_group_id: "group-image",
      generation_config_mode: "manual",
      generation_config_id: "config-image",
    });
    expect(nodeConfigFromDraft(tailNode, tailDraft)).toMatchObject({
      resource_group_id: "group-text",
      generation_config_mode: "manual",
      generation_config_id: "config-text",
    });
  });

  it("falls back from blank inspiration context text config to inspiration source note", () => {
    const node: WorkflowNode = {
      ...baseNode,
      id: "context-node",
      node_type: "inspiration_context",
      title: "灵感资料",
      config_json: {
        name: "三阶魔方",
        entry_type: "tail",
        long_text: "",
        source_note: "",
      },
      output_json: null,
    };
    const draft = draftFromNode(
      node,
      {
        ...inspiration,
        source_note: "三阶魔方展示图，分三个角度",
      },
      "tail",
    );

    expect(draft.longText).toBe("三阶魔方展示图，分三个角度");
    expect(draft.sourceNote).toBe("三阶魔方展示图，分三个角度");
  });

  it("round-trips generalized inspiration context fields", () => {
    const node: WorkflowNode = {
      ...baseNode,
      id: "context-node",
      node_type: "inspiration_context",
      title: "灵感资料",
      config_json: {
        name: "露营灯",
        owner_id: "goods-123",
        entry_type: "copy",
        category: "户外",
        price: "89",
        long_text: "主打轻量照明和帐篷氛围。",
        image_source_asset_id: "asset-image",
        document_source_asset_id: "asset-doc",
        document_filename: "brief.md",
        document_mime_type: "text/markdown",
        document_text: "文档内容",
        dynamic_fields: {
          waterproof: true,
          weight: 1.2,
          note: "暖光",
          empty: null,
        },
      },
      output_json: null,
    };

    const draft = draftFromNode(node, inspiration, "tail");
    expect(draft.inspirationName).toBe("露营灯");
    expect(draft.ownerId).toBe("goods-123");
    expect(draft.entryType).toBe("copy");
    expect(draft.longText).toBe("主打轻量照明和帐篷氛围。");
    expect(draft.documentFilename).toBe("brief.md");
    expect(draft.dynamicFields.map((field) => [field.key, field.value])).toEqual([
      ["waterproof", "true"],
      ["weight", "1.2"],
      ["note", "暖光"],
      ["empty", "null"],
    ]);

    const nextConfig = nodeConfigFromDraft(node, {
      ...draft,
      entryType: "blank",
      dynamicFields: [
        ...draft.dynamicFields,
        { id: "dynamic-new", key: "stock", value: "42" },
        { id: "dynamic-skip", key: " ", value: "ignored" },
      ],
    });
    expect(nextConfig).toMatchObject({
      name: "露营灯",
      owner_id: "goods-123",
      entry_type: "copy",
      long_text: "主打轻量照明和帐篷氛围。",
      source_note: "主打轻量照明和帐篷氛围。",
      image_source_asset_id: "asset-image",
      document_source_asset_id: "asset-doc",
      document_filename: "brief.md",
      document_mime_type: "text/markdown",
      document_text: "文档内容",
      dynamic_fields: {
        waterproof: true,
        weight: 1.2,
        note: "暖光",
        empty: null,
        stock: 42,
      },
    });
    expect(nextConfig).not.toHaveProperty("category");
    expect(nextConfig).not.toHaveProperty("price");
  });

  it("clears inspiration context document fields when the document is removed from the draft", () => {
    const node: WorkflowNode = {
      ...baseNode,
      id: "context-node",
      node_type: "inspiration_context",
      title: "灵感资料",
      config_json: {
        name: "露营灯",
        owner_id: "goods-123",
        entry_type: "copy",
        long_text: "主打轻量照明和帐篷氛围。",
        document_source_asset_id: "asset-doc",
        document_filename: "brief.md",
        document_mime_type: "text/markdown",
        document_text: "# brief",
      },
      output_json: null,
    };

    const draft = draftFromNode(node, inspiration, "copy");
    const nextConfig = nodeConfigFromDraft(node, {
      ...draft,
      documentSourceAssetId: "",
      documentFilename: "",
      documentMimeType: "",
      documentText: "",
    });

    expect(nextConfig).toMatchObject({
      document_source_asset_id: null,
      document_filename: null,
      document_mime_type: null,
      document_text: null,
    });
  });
});
