import { describe, expect, it } from "vitest";

import type { InspirationSummary } from "../lib/types";
import { inspirationKeyInfo, inspirationMainThumbnailUrl, inspirationStartImageThumbnailUrl } from "./InspirationListPage.helpers";

const createdAt = "2026-06-03T00:00:00Z";
const defaultResourceGroup = { id: "group-default", key: "default", name: "default" };

function inspiration(overrides: Partial<InspirationSummary>): InspirationSummary {
  return {
    id: "inspiration-1",
    owner_user_id: "user-1",
    owner_username: "libow",
    resource_group_id: defaultResourceGroup.id,
    resource_group: defaultResourceGroup,
    name: "测试灵感",
    category: null,
    price: null,
    workflow_state: "draft",
    latest_copy_status: null,
    latest_poster_at: null,
    source_image_filename: null,
    source_image_download_url: null,
    source_image_preview_url: null,
    source_image_thumbnail_url: null,
    initial_workflow_entry: null,
    initial_entry_text: null,
    initial_entry_text_excerpt: null,
    latest_generated_image_download_url: null,
    latest_generated_image_preview_url: null,
    latest_generated_image_thumbnail_url: null,
    created_at: createdAt,
    updated_at: createdAt,
    ...overrides,
  };
}

describe("inspiration list display helpers", () => {
  it("uses only latest generated image fields for the main thumbnail", () => {
    const item = inspiration({
      source_image_thumbnail_url: "/source-thumb.png",
      source_image_preview_url: "/source-preview.png",
      latest_generated_image_preview_url: "/generated-preview.png",
      latest_generated_image_thumbnail_url: "/generated-thumb.png",
    });

    expect(inspirationMainThumbnailUrl(item)).toBe("/generated-thumb.png");
    expect(inspirationMainThumbnailUrl(inspiration({ source_image_thumbnail_url: "/source-thumb.png" }))).toBeNull();
  });

  it("uses the source image for image-entry key info", () => {
    const item = inspiration({
      initial_workflow_entry: "image",
      source_image_filename: "start.png",
      source_image_preview_url: "/source-preview.png",
      source_image_thumbnail_url: "/source-thumb.png",
      latest_generated_image_thumbnail_url: "/generated-thumb.png",
    });

    expect(inspirationStartImageThumbnailUrl(item)).toBe("/source-thumb.png");
    expect(inspirationKeyInfo(item)).toEqual({
      kind: "image",
      thumbnailUrl: "/source-thumb.png",
      previewUrl: "/source-preview.png",
      filename: "start.png",
    });
  });

  it("uses text excerpts for copy and tail entries", () => {
    expect(
      inspirationKeyInfo(
        inspiration({
          initial_workflow_entry: "copy",
          initial_entry_text: "免安装收纳架适配厨房场景",
          initial_entry_text_excerpt: "免安装收纳架",
          source_image_thumbnail_url: "/source-thumb.png",
        }),
      ),
    ).toEqual({ kind: "text", text: "免安装收纳架适配厨房场景" });
    expect(inspirationKeyInfo(inspiration({ initial_workflow_entry: "tail", initial_entry_text_excerpt: "场景拆分" }))).toEqual({
      kind: "text",
      text: "场景拆分",
    });
  });

  it("returns an empty key-info state for blank and generated-only rows", () => {
    expect(
      inspirationKeyInfo(
        inspiration({
          initial_workflow_entry: "blank",
          latest_generated_image_thumbnail_url: "/generated-thumb.png",
        }),
      ),
    ).toEqual({ kind: "empty" });
    expect(inspirationKeyInfo(inspiration({ initial_workflow_entry: "copy" }))).toEqual({ kind: "empty" });
  });
});
