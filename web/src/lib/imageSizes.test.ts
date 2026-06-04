import { describe, expect, it } from "vitest";

import {
  DEFAULT_IMAGE_SIZE_OPTIONS,
  aspectFromImageSize,
  buildCustomAspectSizeOptions,
  buildImageAspectOptions,
  buildImageSizeOptions,
  getImageSizePresetDisplay,
  imageSizeOptionsForAspect,
  isImageAspectWithinBounds,
  labelForImageSize,
  normalizeImageSizeValue,
  parseImageAspectValue,
  parseImageSizeValue,
  resolveImageSize,
} from "./imageSizes";

describe("image size helpers", () => {
  it("provides built-in ratio/tier presets without runtime config", () => {
    expect(DEFAULT_IMAGE_SIZE_OPTIONS.map((option) => option.value)).toEqual([
      "1024x1024",
      "1024x1536",
      "1536x1024",
      "2048x2048",
      "2048x3072",
      "3072x2048",
      "2160x3840",
      "3840x2160",
    ]);
    expect(DEFAULT_IMAGE_SIZE_OPTIONS[3]).toMatchObject({ label: "方图 · 2K", aspect: "1:1" });
    expect(DEFAULT_IMAGE_SIZE_OPTIONS.at(-1)?.description).toBe("16:9 · 3840×2160");
  });

  it("normalizes and parses custom size strings", () => {
    expect(normalizeImageSizeValue("3840X2160")).toBe("3840x2160");
    expect(parseImageSizeValue("1280x720")).toEqual({ width: 1280, height: 720 });
    expect(resolveImageSize(1500, 800)).toEqual({
      width: 1504,
      height: 800,
      value: "1504x800",
      calibrated: true,
    });
    expect(normalizeImageSizeValue("1500x800")).toBe("1504x800");
    expect(labelForImageSize("1280x720")).toBe("自定义 · 1280×720");
    expect(labelForImageSize("1280x720", "en-US")).toBe("Custom · 1280×720");
    expect(normalizeImageSizeValue("0x720")).toBeNull();
    expect(normalizeImageSizeValue("1024 * 1024")).toBeNull();
  });

  it("calibrates oversized dimensions to project safety bounds", () => {
    expect(resolveImageSize(5000, 2500)).toEqual({
      width: 3840,
      height: 1920,
      value: "3840x1920",
      calibrated: true,
    });
    expect(resolveImageSize(4000, 4000)).toEqual({
      width: 2880,
      height: 2880,
      value: "2880x2880",
      calibrated: true,
    });
    expect(resolveImageSize(9999, 1000)).toEqual({
      width: 3840,
      height: 1280,
      value: "3840x1280",
      calibrated: true,
    });
    expect(resolveImageSize(100, 0)).toBeNull();
  });

  it("calibrates undersized dimensions to provider minimum bounds", () => {
    expect(resolveImageSize(64, 64)).toEqual({
      width: 512,
      height: 512,
      value: "512x512",
      calibrated: true,
    });
    expect(normalizeImageSizeValue("64X64")).toBe("512x512");
    expect(resolveImageSize(256, 1024)).toEqual({
      width: 512,
      height: 1024,
      value: "512x1024",
      calibrated: true,
    });
  });

  it("filters built-in presets by runtime max dimension", () => {
    expect(buildImageSizeOptions(2048).map((option) => option.value)).toEqual([
      "1024x1024",
      "1024x1536",
      "1536x1024",
      "2048x2048",
    ]);
    expect(resolveImageSize(3072, 2048, 2048)).toEqual({
      width: 2048,
      height: 1360,
      value: "2048x1360",
      calibrated: true,
    });
    expect(normalizeImageSizeValue("3840X2160", 2048)).toBe("2048x1152");
  });

  it("derives preset display labels for the picker grid", () => {
    expect(labelForImageSize("1024x1024", "en-US")).toBe("Square · 1K");
    expect(labelForImageSize("1024x1536", "en-US")).toBe("Portrait · 1K");
    expect(labelForImageSize("1536x1024", "en-US")).toBe("Landscape · 1K");
    expect(DEFAULT_IMAGE_SIZE_OPTIONS.map(getImageSizePresetDisplay)).toEqual([
      { aspectLabel: "1:1", tierLabel: "1K", dimensionLabel: "1024×1024" },
      { aspectLabel: "2:3", tierLabel: "1K", dimensionLabel: "1024×1536" },
      { aspectLabel: "3:2", tierLabel: "1K", dimensionLabel: "1536×1024" },
      { aspectLabel: "1:1", tierLabel: "2K", dimensionLabel: "2048×2048" },
      { aspectLabel: "2:3", tierLabel: "2K", dimensionLabel: "2048×3072" },
      { aspectLabel: "3:2", tierLabel: "2K", dimensionLabel: "3072×2048" },
      { aspectLabel: "9:16", tierLabel: "4K", dimensionLabel: "2160×3840" },
      { aspectLabel: "16:9", tierLabel: "4K", dimensionLabel: "3840×2160" },
    ]);
  });

  it("builds stable aspect options and filters resolutions by selected aspect", () => {
    expect(buildImageAspectOptions(DEFAULT_IMAGE_SIZE_OPTIONS).map((option) => option.value)).toEqual([
      "1:1",
      "2:3",
      "3:2",
      "9:16",
      "16:9",
    ]);
    expect(imageSizeOptionsForAspect(DEFAULT_IMAGE_SIZE_OPTIONS, "1:1").map((option) => option.value)).toEqual([
      "1024x1024",
      "2048x2048",
    ]);
    expect(imageSizeOptionsForAspect(DEFAULT_IMAGE_SIZE_OPTIONS, "16/9").map((option) => option.value)).toEqual([
      "3840x2160",
    ]);
  });

  it("parses and normalizes custom aspect input forms", () => {
    expect(parseImageAspectValue("4:5")).toEqual({ widthRatio: 4, heightRatio: 5, value: "4:5" });
    expect(parseImageAspectValue(" 08 / 10 ")).toEqual({ widthRatio: 4, heightRatio: 5, value: "4:5" });
    expect(parseImageAspectValue("1920x1080")).toEqual({ widthRatio: 16, heightRatio: 9, value: "16:9" });
    expect(parseImageAspectValue("1920×1080")).toEqual({ widthRatio: 16, heightRatio: 9, value: "16:9" });
    expect(parseImageAspectValue("4 by 5")).toBeNull();
    expect(isImageAspectWithinBounds("4:5")).toBe(true);
    expect(isImageAspectWithinBounds("10:1")).toBe(false);
  });

  it("derives aspect from unknown valid image sizes for round-trip hydration", () => {
    expect(aspectFromImageSize("1280x720")).toBe("16:9");
    expect(aspectFromImageSize("1504x800")).toBe("47:25");
    expect(aspectFromImageSize("4000x4000")).toBe("1:1");
    expect(aspectFromImageSize("not-a-size")).toBeNull();
  });

  it("generates safe resolution candidates for custom aspects", () => {
    expect(buildCustomAspectSizeOptions("4:5").map((option) => option.value)).toEqual([
      "512x640",
      "1024x1280",
      "1536x1920",
      "2048x2560",
    ]);
    expect(buildCustomAspectSizeOptions("4:5", 1024).map((option) => option.value)).toEqual(["512x640"]);
    expect(buildCustomAspectSizeOptions("10:1")).toEqual([]);
  });
});
