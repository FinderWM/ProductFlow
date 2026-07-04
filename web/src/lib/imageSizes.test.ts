import { describe, expect, it } from "vitest";

import {
  DEFAULT_IMAGE_SIZE_OPTIONS,
  aspectFromImageSize,
  buildCustomAspectSizeOptions,
  buildImageAspectOptions,
  buildImageSizeOptions,
  imageSizeValueFromDimensions,
  formatImageAspectValue,
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
      "1536x1536",
      "2048x2048",
      "2880x2880",
      "1024x1280",
      "1536x1920",
      "2048x2560",
      "2560x3200",
      "1280x1024",
      "1920x1536",
      "2560x2048",
      "3200x2560",
      "1024x1536",
      "1280x1920",
      "1536x2304",
      "2048x3072",
      "1536x1024",
      "1920x1280",
      "2304x1536",
      "3072x2048",
      "768x1024",
      "1152x1536",
      "1536x2048",
      "2304x3072",
      "1024x768",
      "1536x1152",
      "2048x1536",
      "3072x2304",
      "720x1280",
      "1152x2048",
      "1440x2560",
      "2160x3840",
      "1024x576",
      "1280x720",
      "2048x1152",
      "2560x1440",
      "3840x2160",
      "1344x576",
      "1792x768",
      "2688x1152",
      "3360x1440",
    ]);
    expect(DEFAULT_IMAGE_SIZE_OPTIONS[3]).toMatchObject({ label: "方图 · 2.8K", aspect: "1:1" });
    expect(DEFAULT_IMAGE_SIZE_OPTIONS.at(-1)?.description).toBe("21:9 · 3360×1440");
  });

  it("normalizes and parses custom size strings", () => {
    expect(normalizeImageSizeValue("3840X2160")).toBe("3840x2160");
    expect(parseImageSizeValue("1280x720")).toEqual({ width: 1280, height: 720 });
    expect(imageSizeValueFromDimensions("1500", "800")).toBe("1504x800");
    expect(imageSizeValueFromDimensions(" ", "800")).toBeNull();
    expect(resolveImageSize(1500, 800)).toEqual({
      width: 1504,
      height: 800,
      value: "1504x800",
      calibrated: true,
    });
    expect(normalizeImageSizeValue("1500x800")).toBe("1504x800");
    expect(labelForImageSize("1280x720")).toBe("横图 · HD");
    expect(labelForImageSize("1280x720", "en-US")).toBe("Landscape · HD");
    expect(labelForImageSize("1504x800")).toBe("自定义 · 1504×800");
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
      "1536x1536",
      "2048x2048",
      "1024x1280",
      "1536x1920",
      "1280x1024",
      "1920x1536",
      "1024x1536",
      "1280x1920",
      "1536x1024",
      "1920x1280",
      "768x1024",
      "1152x1536",
      "1536x2048",
      "1024x768",
      "1536x1152",
      "2048x1536",
      "720x1280",
      "1152x2048",
      "1024x576",
      "1280x720",
      "2048x1152",
      "1344x576",
      "1792x768",
    ]);
    expect(resolveImageSize(3072, 2048, 2048)).toEqual({
      width: 2048,
      height: 1360,
      value: "2048x1360",
      calibrated: true,
    });
    expect(normalizeImageSizeValue("3840X2160", 2048)).toBe("2048x1152");
  });

  it("accepts capability-provided preset definitions", () => {
    expect(
      buildImageSizeOptions(2048, [
        { aspect: "1:1", value: "1024x1024" },
        { aspect: "16:9", value: "1280x720", tierLabel: "HD" },
        { aspect: "16:9", value: "3840x2160", tierLabel: "4K" },
      ]).map((option) => option.value),
    ).toEqual(["1024x1024", "1280x720"]);
  });

  it("derives preset display labels for the picker grid", () => {
    expect(labelForImageSize("1024x1024", "en-US")).toBe("Square · 1K");
    expect(labelForImageSize("1024x1536", "en-US")).toBe("Portrait · 1.5K");
    expect(labelForImageSize("1536x1024", "en-US")).toBe("Landscape · 1.5K");
    expect(DEFAULT_IMAGE_SIZE_OPTIONS.slice(0, 12).map(getImageSizePresetDisplay)).toEqual([
      { aspectLabel: "1:1", tierLabel: "1K", dimensionLabel: "1024×1024" },
      { aspectLabel: "1:1", tierLabel: "1.5K", dimensionLabel: "1536×1536" },
      { aspectLabel: "1:1", tierLabel: "2K", dimensionLabel: "2048×2048" },
      { aspectLabel: "1:1", tierLabel: "2.8K", dimensionLabel: "2880×2880" },
      { aspectLabel: "4:5", tierLabel: "1K", dimensionLabel: "1024×1280" },
      { aspectLabel: "4:5", tierLabel: "1.5K", dimensionLabel: "1536×1920" },
      { aspectLabel: "4:5", tierLabel: "2K", dimensionLabel: "2048×2560" },
      { aspectLabel: "4:5", tierLabel: "3K", dimensionLabel: "2560×3200" },
      { aspectLabel: "5:4", tierLabel: "1K", dimensionLabel: "1280×1024" },
      { aspectLabel: "5:4", tierLabel: "1.5K", dimensionLabel: "1920×1536" },
      { aspectLabel: "5:4", tierLabel: "2K", dimensionLabel: "2560×2048" },
      { aspectLabel: "5:4", tierLabel: "3K", dimensionLabel: "3200×2560" },
    ]);
    expect(getImageSizePresetDisplay(DEFAULT_IMAGE_SIZE_OPTIONS.at(-1) ?? DEFAULT_IMAGE_SIZE_OPTIONS[0])).toEqual({
      aspectLabel: "21:9",
      tierLabel: "3K",
      dimensionLabel: "3360×1440",
    });
  });

  it("builds stable aspect options and filters resolutions by selected aspect", () => {
    const aspectOptions = buildImageAspectOptions(DEFAULT_IMAGE_SIZE_OPTIONS);
    expect(aspectOptions.map((option) => option.value)).toEqual([
      "1:1",
      "4:5",
      "5:4",
      "2:3",
      "3:2",
      "3:4",
      "4:3",
      "9:16",
      "16:9",
      "7:3",
    ]);
    expect(aspectOptions.at(-1)).toEqual({ value: "7:3", label: "21:9", description: "21:9" });
    expect(imageSizeOptionsForAspect(DEFAULT_IMAGE_SIZE_OPTIONS, "1:1").map((option) => option.value)).toEqual([
      "1024x1024",
      "1536x1536",
      "2048x2048",
      "2880x2880",
    ]);
    expect(imageSizeOptionsForAspect(DEFAULT_IMAGE_SIZE_OPTIONS, "16/9").map((option) => option.value)).toEqual([
      "1024x576",
      "1280x720",
      "2048x1152",
      "2560x1440",
      "3840x2160",
    ]);
    expect(imageSizeOptionsForAspect(DEFAULT_IMAGE_SIZE_OPTIONS, "21:9").map((option) => option.value)).toEqual([
      "1344x576",
      "1792x768",
      "2688x1152",
      "3360x1440",
    ]);
    expect(formatImageAspectValue("7:3")).toBe("21:9");
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
