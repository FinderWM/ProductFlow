import { describe, expect, it } from "vitest";

import { constrainedMainImagePreviewSize, contextDocumentFileForSubmit } from "./InspirationCreatePage";

describe("contextDocumentFileForSubmit", () => {
  it("submits the original selected document file without rewriting preview text", () => {
    const original = new File(["old"], "brief.md", { type: "text/markdown", lastModified: 123 });

    const nextFile = contextDocumentFileForSubmit(original);

    expect(nextFile).toBe(original);
  });

  it("omits the context document when no document is selected", () => {
    expect(contextDocumentFileForSubmit(null)).toBeUndefined();
  });
});

describe("constrainedMainImagePreviewSize", () => {
  it("uses a bounded 16:9 default before the image dimensions are known", () => {
    expect(constrainedMainImagePreviewSize(null)).toEqual({ width: 640, height: 360 });
  });

  it("fits landscape images into the preview bounds without using their source resolution", () => {
    expect(constrainedMainImagePreviewSize({ width: 3840, height: 2160 })).toEqual({ width: 640, height: 360 });
    expect(constrainedMainImagePreviewSize({ width: 1920, height: 1080 })).toEqual({ width: 640, height: 360 });
  });

  it("keeps square and portrait images within the same maximum height", () => {
    expect(constrainedMainImagePreviewSize({ width: 4000, height: 4000 })).toEqual({ width: 360, height: 360 });
    expect(constrainedMainImagePreviewSize({ width: 1080, height: 1920 })).toEqual({ width: 203, height: 360 });
  });

  it("falls back to the default for invalid dimensions", () => {
    expect(constrainedMainImagePreviewSize({ width: 0, height: 1080 })).toEqual({ width: 640, height: 360 });
    expect(constrainedMainImagePreviewSize({ width: Number.NaN, height: 1080 })).toEqual({ width: 640, height: 360 });
  });
});
