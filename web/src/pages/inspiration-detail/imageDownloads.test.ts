import { describe, expect, it } from "vitest";

import type { InspirationDetail, SourceAsset, WorkflowNode } from "../../lib/types";
import { getNodeImageSourceAsset } from "./imageDownloads";

const createdAt = "2026-04-26T00:00:00Z";
const defaultResourceGroup = { id: "group-default", key: "default", name: "default" };

function sourceAsset(overrides: Partial<SourceAsset>): SourceAsset {
  return {
    id: "asset-1",
    kind: "reference_image",
    original_filename: "reference.png",
    mime_type: "image/png",
    download_url: "/media/reference.png",
    preview_url: "/media/reference-preview.png",
    thumbnail_url: "/media/reference-thumb.png",
    created_at: createdAt,
    ...overrides,
  };
}

function inspiration(sourceAssets: SourceAsset[]): InspirationDetail {
  return {
    id: "inspiration-1",
    resource_group_id: defaultResourceGroup.id,
    resource_group: defaultResourceGroup,
    name: "测试灵感产物",
    category: null,
    price: null,
    source_note: null,
    workflow_state: "draft",
    source_assets: sourceAssets,
    latest_brief: null,
    current_confirmed_copy_set: null,
    copy_sets: [],
    poster_variants: [],
    created_at: createdAt,
    updated_at: createdAt,
  };
}

function node(overrides: Partial<WorkflowNode>): WorkflowNode {
  return {
    id: "node-1",
    workflow_id: "workflow-1",
    node_type: "reference_image",
    title: "承载图片节点",
    position_x: 0,
    position_y: 0,
    config_json: {},
    status: "idle",
    output_json: null,
    failure_reason: null,
    is_retryable: false,
    attempt_count: 0,
    retry_count: 0,
    non_retryable_reason: null,
    retry_hint: null,
    last_run_at: null,
    created_at: createdAt,
    updated_at: createdAt,
    ...overrides,
  };
}

describe("inspiration-detail image downloads", () => {
  it("resolves the current reference node source asset", () => {
    const currentAsset = sourceAsset({ id: "current-reference" });

    expect(
      getNodeImageSourceAsset(
        node({ output_json: { source_asset_ids: ["current-reference"] } }),
        inspiration([sourceAsset({ id: "other-reference" }), currentAsset]),
      ),
    ).toBe(currentAsset);
  });

  it("falls back to the inspiration source image for the context node", () => {
    const originalAsset = sourceAsset({ id: "original", kind: "original_image" });

    expect(
      getNodeImageSourceAsset(
        node({ node_type: "inspiration_context", output_json: {} }),
        inspiration([originalAsset]),
      ),
    ).toBe(originalAsset);
  });
});
