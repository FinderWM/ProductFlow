import { describe, expect, it } from "vitest";

import type { CopyPayloadV2, ProductDetail, WorkflowNode } from "../../lib/types";
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

const product: ProductDetail = {
  id: "product-1",
  resource_group_id: defaultResourceGroup.id,
  resource_group: defaultResourceGroup,
  name: "商品",
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
    const draft = draftFromNode(baseNode, product);

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
  });

  it("round-trips resource group selection and forces auto scheduling on generative nodes", () => {
    const node = {
      ...baseNode,
      config_json: {
        instruction: "生成文案",
        resource_group_id: "group-text",
        generation_config_mode: "manual",
        generation_config_id: "config-text",
      },
    };
    const draft = draftFromNode(node, product);

    expect(draft.resourceGroupId).toBe("group-text");
    expect(nodeConfigFromDraft(node, draft)).toMatchObject({
      resource_group_id: "group-text",
      generation_config_mode: "auto",
      generation_config_id: null,
    });
  });

  it("falls back from blank product context text config to product source note", () => {
    const node: WorkflowNode = {
      ...baseNode,
      id: "context-node",
      node_type: "product_context",
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
        ...product,
        source_note: "三阶魔方展示图，分三个角度",
      },
      "tail",
    );

    expect(draft.longText).toBe("三阶魔方展示图，分三个角度");
    expect(draft.sourceNote).toBe("三阶魔方展示图，分三个角度");
  });

  it("round-trips generalized product context fields", () => {
    const node: WorkflowNode = {
      ...baseNode,
      id: "context-node",
      node_type: "product_context",
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

    const draft = draftFromNode(node, product, "tail");
    expect(draft.productName).toBe("露营灯");
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

  it("clears product context document fields when the document is removed from the draft", () => {
    const node: WorkflowNode = {
      ...baseNode,
      id: "context-node",
      node_type: "product_context",
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

    const draft = draftFromNode(node, product, "copy");
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
