import { describe, expect, it } from "vitest";

import type { GalleryEntry, GenerationResourceGroupTag, ImageSessionSummary, InspirationSummary } from "../../lib/types";
import {
  galleryEntryWorkspaceImageUrl,
  isWorkspacePublicResourceGroup,
  nextWorkspaceGalleryLoopOffset,
  workspaceArtImageOrientationFromSize,
  workspaceFirstPreviewImageUrl,
  workspaceGalleryArtImageUrl,
  workspaceGalleryRetainedOffsets,
  workspaceHomeActiveAnchorId,
  workspaceHomeAnchorPath,
  workspaceHomeAnchorSelectionOffset,
  workspaceHomeGreetingKey,
  workspaceHomeQuickNavShouldCollapse,
  workspaceHomeVisibleAnchorIds,
  workspaceImageChatWorkbenchPath,
  workspaceImageSessionArtImageUrl,
  workspaceImageSessionListThumbnailUrl,
  workspaceInspirationArtImageUrl,
  workspaceInspirationListThumbnailUrl,
  workspaceResourceLibraryArtImageUrl,
  workspaceVisibleImageSessions,
  workspaceVisibleInspirations,
} from "./WorkspaceLandingPages";

function group(id: string, blurImagesByDefault: boolean): GenerationResourceGroupTag {
  return {
    id,
    key: id,
    name: id,
    blur_images_by_default: blurImagesByDefault,
  };
}

function inspiration(
  id: string,
  resourceGroup: GenerationResourceGroupTag,
  overrides: Partial<InspirationSummary> = {},
): InspirationSummary {
  return {
    id,
    resource_group: resourceGroup,
    latest_generated_image_download_url: null,
    latest_generated_image_preview_url: null,
    latest_generated_image_thumbnail_url: null,
    source_image_download_url: null,
    source_image_preview_url: null,
    source_image_thumbnail_url: null,
    ...overrides,
  } as InspirationSummary;
}

function imageSession(
  id: string,
  resourceGroup: GenerationResourceGroupTag | null,
  overrides: Partial<ImageSessionSummary> = {},
): ImageSessionSummary {
  return {
    id,
    latest_resource_group: resourceGroup,
    latest_generated_asset: null,
    ...overrides,
  } as ImageSessionSummary;
}

function galleryEntryImageUrls({
  actualSize = null,
  downloadUrl,
  previewUrl,
  size = null,
  thumbnailUrl,
}: {
  actualSize?: string | null;
  downloadUrl: string;
  previewUrl: string;
  size?: string | null;
  thumbnailUrl: string;
}): GalleryEntry {
  return {
    image: {
      download_url: downloadUrl,
      preview_url: previewUrl,
      thumbnail_url: thumbnailUrl,
    },
    actual_size: actualSize,
    size,
  } as GalleryEntry;
}

describe("workspace landing privacy filters", () => {
  it("treats blur-by-default groups as hidden from workspace latest lists", () => {
    expect(isWorkspacePublicResourceGroup(group("public", false))).toBe(true);
    expect(isWorkspacePublicResourceGroup(group("private", true))).toBe(false);
    expect(isWorkspacePublicResourceGroup(null)).toBe(true);
  });

  it("filters private inspiration groups before applying the visible limit", () => {
    const publicGroup = group("public", false);
    const privateGroup = group("private", true);

    expect(
      workspaceVisibleInspirations(
        [
          inspiration("private-1", privateGroup),
          inspiration("public-1", publicGroup),
          inspiration("private-2", privateGroup),
          inspiration("public-2", publicGroup),
          inspiration("public-3", publicGroup),
          inspiration("public-4", publicGroup),
        ],
        3,
      ).map((item) => item.id),
    ).toEqual(["public-1", "public-2", "public-3"]);
  });

  it("filters private image-session groups before applying the visible limit", () => {
    const publicGroup = group("public", false);
    const privateGroup = group("private", true);

    expect(
      workspaceVisibleImageSessions(
        [
          imageSession("private-1", privateGroup),
          imageSession("public-1", publicGroup),
          imageSession("legacy-ungrouped", null),
          imageSession("private-2", privateGroup),
          imageSession("public-2", publicGroup),
        ],
        3,
      ).map((item) => item.id),
    ).toEqual(["public-1", "legacy-ungrouped", "public-2"]);
  });

  it("carries workspace image-chat list filters into the workbench route", () => {
    expect(workspaceImageChatWorkbenchPath({ ownerUserId: "user-1" })).toBe(
      "/image-chat/workbench?owner_user_id=user-1",
    );
    expect(
      workspaceImageChatWorkbenchPath({
        ownerUserId: "user-1",
        resourceGroupId: "group-1",
        sessionId: "session-1",
      }),
    ).toBe("/image-chat/workbench?resource_group_id=group-1&owner_user_id=user-1&session_id=session-1");
    expect(workspaceImageChatWorkbenchPath({ ownerUserId: null })).toBe("/image-chat/workbench");
    expect(workspaceImageChatWorkbenchPath({ ownerUserId: "user-1", createSession: true })).toBe(
      "/image-chat/workbench?owner_user_id=user-1&create_session=1",
    );
  });

  it("keeps home anchor targets for the workspace quick nav", () => {
    expect(workspaceHomeAnchorPath("chat")).toBe("/inspirations#chat");
    expect(workspaceHomeAnchorPath("resource-library")).toBe("/inspirations#resource-library");
  });

  it("filters workspace home quick nav anchors by visible section access", () => {
    expect(
      workspaceHomeVisibleAnchorIds({
        resourceLibrary: true,
        inspirations: false,
        imageChat: true,
        gallery: false,
        status: true,
        usageStats: false,
      }),
    ).toEqual(["resource-library", "chat", "status"]);
  });

  it("keeps gallery first in the workspace home quick nav order", () => {
    expect(
      workspaceHomeVisibleAnchorIds({
        resourceLibrary: true,
        inspirations: true,
        imageChat: true,
        gallery: true,
        status: true,
        usageStats: true,
      }),
    ).toEqual(["gallery", "resource-library", "workspace", "chat", "status", "usage-stats"]);
  });

  it("uses the same anchor activation offset as the section scroll margin contract", () => {
    expect(workspaceHomeAnchorSelectionOffset(981)).toBe(112);
    expect(workspaceHomeAnchorSelectionOffset(980)).toBe(94);
    expect(workspaceHomeAnchorSelectionOffset(640)).toBe(94);
  });

  it("collapses the compact quick nav after tapping outside the expanded drawer", () => {
    expect(
      workspaceHomeQuickNavShouldCollapse({
        compactMode: true,
        expandedAnchorId: "chat",
        targetInsideQuickNav: false,
      }),
    ).toBe(true);

    expect(
      workspaceHomeQuickNavShouldCollapse({
        compactMode: true,
        expandedAnchorId: "chat",
        targetInsideQuickNav: true,
      }),
    ).toBe(false);

    expect(
      workspaceHomeQuickNavShouldCollapse({
        compactMode: false,
        expandedAnchorId: "chat",
        targetInsideQuickNav: false,
      }),
    ).toBe(false);
  });

  it("selects the section whose viewport band contains the activation offset", () => {
    expect(
      workspaceHomeActiveAnchorId(
        [
          { id: "resource-library", top: -240, bottom: 60 },
          { id: "workspace", top: 80, bottom: 420 },
          { id: "chat", top: 440, bottom: 760 },
        ],
        112,
      ),
    ).toBe("workspace");

    expect(
      workspaceHomeActiveAnchorId(
        [
          { id: "resource-library", top: -240, bottom: 60 },
          { id: "workspace", top: 128, bottom: 420 },
          { id: "chat", top: 440, bottom: 760 },
        ],
        112,
      ),
    ).toBe("workspace");

    expect(
      workspaceHomeActiveAnchorId(
        [
          { id: "resource-library", top: 180, bottom: 520 },
          { id: "workspace", top: 560, bottom: 920 },
        ],
        112,
      ),
    ).toBeNull();
  });

  it("selects the greeting by local hour", () => {
    expect(workspaceHomeGreetingKey(new Date(2026, 0, 1, 8))).toBe("workspaceHome.greeting.morning");
    expect(workspaceHomeGreetingKey(new Date(2026, 0, 1, 12))).toBe("workspaceHome.greeting.afternoon");
    expect(workspaceHomeGreetingKey(new Date(2026, 0, 1, 18))).toBe("workspaceHome.greeting.evening");
    expect(workspaceHomeGreetingKey(new Date(2026, 0, 1, 3))).toBe("workspaceHome.greeting.evening");
  });

  it("uses thumbnail images for the workspace gallery strip before heavier previews or downloads", () => {
    expect(
      galleryEntryWorkspaceImageUrl(
        galleryEntryImageUrls({
          downloadUrl: "/download/full.png",
          previewUrl: "/preview/large.png",
          thumbnailUrl: "/thumb/small.png",
        }),
      ),
    ).toBe("/thumb/small.png");
  });

  it("detects known workspace module art image orientation from actual or requested size", () => {
    expect(workspaceArtImageOrientationFromSize({ actualSize: "1024x1536", size: "1536x1024" })).toBe("portrait");
    expect(workspaceArtImageOrientationFromSize({ size: "1536x1024" })).toBe("landscape");
    expect(workspaceArtImageOrientationFromSize({ size: "1024x1024" })).toBe("square");
    expect(workspaceArtImageOrientationFromSize({ size: null })).toBe("unknown");
  });

  it("uses portrait previews for workspace module art and falls back to downloads", () => {
    expect(
      workspaceFirstPreviewImageUrl([
        null,
        { preview_url: "/landscape/preview.png", download_url: "/landscape/full.png", size: "1536x1024" },
        { preview_url: "/portrait/preview.png", download_url: "/portrait/full.png", size: "1024x1536" },
      ]),
    ).toBe("/portrait/preview.png");

    expect(
      workspaceFirstPreviewImageUrl([
        { preview_url: "", download_url: "" },
        { preview_url: null, download_url: "/download/original.png", size: "1536x1024" },
      ]),
    ).toBe("/download/original.png");

    expect(
      workspaceResourceLibraryArtImageUrl([{ preview_url: "/resource/preview.png", download_url: "/resource/full.png" }]),
    ).toBe("/resource/preview.png");
  });

  it("derives the inspiration module art image from the first visible image item", () => {
    const publicGroup = group("public", false);

    expect(
      workspaceInspirationArtImageUrl([
        inspiration("text-only", publicGroup),
        inspiration("generated", publicGroup, {
          latest_generated_image_download_url: "/generated/full.png",
          latest_generated_image_preview_url: "/generated/preview.png",
          latest_generated_image_thumbnail_url: "/generated/thumb.png",
          source_image_download_url: "/source/full.png",
          source_image_preview_url: "/source/preview.png",
          source_image_thumbnail_url: "/source/thumb.png",
        }),
      ]),
    ).toBe("/generated/preview.png");

    expect(
      workspaceInspirationArtImageUrl([
        inspiration("source-only", publicGroup, {
          source_image_download_url: "/source/full.png",
        }),
      ]),
    ).toBe("/source/full.png");

    expect(
      workspaceInspirationListThumbnailUrl(
        inspiration("source-thumb", publicGroup, {
          source_image_preview_url: "/source/preview.png",
          source_image_thumbnail_url: "/source/thumb.png",
        }),
      ),
    ).toBe("/source/thumb.png");
  });

  it("uses latest generated image assets for image-chat module thumbnails and art", () => {
    const publicGroup = group("public", false);
    const session = imageSession("session-1", publicGroup, {
      latest_generated_asset: {
        id: "asset-1",
        kind: "generated_image",
        original_filename: "session.png",
        mime_type: "image/png",
        gallery_saved: false,
        gallery_entry_id: null,
        thumbnail_url: "/session/thumb.png",
        preview_url: "/session/preview.png",
        download_url: "/session/full.png",
        created_at: "2026-06-11T00:00:00Z",
      },
    });

    expect(workspaceImageSessionListThumbnailUrl(session)).toBe("/session/thumb.png");
    expect(workspaceImageSessionArtImageUrl([session])).toBe("/session/preview.png");
  });

  it("uses gallery previews instead of strip thumbnails for workspace module art", () => {
    expect(
      workspaceGalleryArtImageUrl([
        galleryEntryImageUrls({
          downloadUrl: "/gallery/landscape-full.png",
          previewUrl: "/gallery/landscape-preview.png",
          size: "1536x1024",
          thumbnailUrl: "/gallery/landscape-thumb.png",
        }),
        galleryEntryImageUrls({
          actualSize: "1024x1536",
          downloadUrl: "/gallery/portrait-full.png",
          previewUrl: "/gallery/portrait-preview.png",
          size: "1536x1024",
          thumbnailUrl: "/gallery/portrait-thumb.png",
        }),
      ]),
    ).toBe("/gallery/portrait-preview.png");
  });

  it("advances to the next gallery page and loops the final page back to the beginning", () => {
    expect(
      nextWorkspaceGalleryLoopOffset({
        galleryOffset: 12,
        hasNextGalleryPage: true,
        nextGalleryOffset: 18,
      }),
    ).toBe(18);

    expect(
      nextWorkspaceGalleryLoopOffset({
        galleryOffset: 18,
        hasNextGalleryPage: false,
        nextGalleryOffset: null,
      }),
    ).toBe(0);

    expect(
      nextWorkspaceGalleryLoopOffset({
        galleryOffset: 0,
        hasNextGalleryPage: false,
        nextGalleryOffset: null,
      }),
    ).toBeNull();
  });

  it("retains only the current gallery page and the next loop target", () => {
    expect(workspaceGalleryRetainedOffsets({ galleryOffset: 12, loopTargetOffset: 18 })).toEqual([12, 18]);
    expect(workspaceGalleryRetainedOffsets({ galleryOffset: 18, loopTargetOffset: 0 })).toEqual([18, 0]);
    expect(workspaceGalleryRetainedOffsets({ galleryOffset: 0, loopTargetOffset: null })).toEqual([0]);
  });
});
