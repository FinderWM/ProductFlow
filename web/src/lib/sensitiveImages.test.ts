import { describe, expect, it } from "vitest";

import {
  resolveSensitiveImageMaskPreference,
  sensitiveImageMaskPreferenceField,
  sensitiveImageMaskPreferenceUpdate,
} from "./sensitiveImagePreferences";
import { shouldMaskSensitiveImage, shouldShowSensitiveImageMaskPreference } from "./sensitiveImages";

describe("sensitive image masking helpers", () => {
  it("masks only when the personal preference and resource group flag are both enabled", () => {
    expect(shouldMaskSensitiveImage(true, { blur_images_by_default: true })).toBe(true);
    expect(shouldMaskSensitiveImage(false, { blur_images_by_default: true })).toBe(false);
    expect(shouldMaskSensitiveImage(true, { blur_images_by_default: false })).toBe(false);
    expect(shouldMaskSensitiveImage(true, null)).toBe(false);
  });

  it("shows the mask preference only for all groups or sensitive group filters", () => {
    const resourceGroups = [
      { id: "public", blur_images_by_default: false },
      { id: "sensitive", blur_images_by_default: true },
    ];

    expect(shouldShowSensitiveImageMaskPreference("", resourceGroups)).toBe(true);
    expect(shouldShowSensitiveImageMaskPreference("sensitive", resourceGroups)).toBe(true);
    expect(shouldShowSensitiveImageMaskPreference("public", resourceGroups)).toBe(false);
    expect(shouldShowSensitiveImageMaskPreference("missing", resourceGroups)).toBe(false);
    expect(shouldShowSensitiveImageMaskPreference(null, resourceGroups)).toBe(false);
  });

  it("defaults list masking to enabled until account preferences are loaded", () => {
    expect(resolveSensitiveImageMaskPreference(null, "inspirations")).toBe(true);
    expect(resolveSensitiveImageMaskPreference(undefined, "image-chat")).toBe(true);
  });

  it("maps preference scopes to account preference fields and patch payloads", () => {
    expect(sensitiveImageMaskPreferenceField("inspirations")).toBe("mask_sensitive_images_in_inspirations");
    expect(sensitiveImageMaskPreferenceField("image-chat")).toBe("mask_sensitive_images_in_image_chat");
    expect(sensitiveImageMaskPreferenceUpdate("inspirations", false)).toEqual({
      mask_sensitive_images_in_inspirations: false,
    });
    expect(sensitiveImageMaskPreferenceUpdate("image-chat", false)).toEqual({
      mask_sensitive_images_in_image_chat: false,
    });
  });

  it("keeps layout scheme out of sensitive mask patch payloads", () => {
    expect(sensitiveImageMaskPreferenceUpdate("inspirations", true)).toEqual({
      mask_sensitive_images_in_inspirations: true,
    });
  });

  it("reads the matching account preference field for each list", () => {
    const preferences = {
      user_id: "user-1",
      mask_sensitive_images_in_inspirations: false,
      mask_sensitive_images_in_image_chat: true,
      created_at: "2026-06-09T00:00:00+00:00",
      updated_at: "2026-06-09T00:00:00+00:00",
    };

    expect(resolveSensitiveImageMaskPreference(preferences, "inspirations")).toBe(false);
    expect(resolveSensitiveImageMaskPreference(preferences, "image-chat")).toBe(true);
  });
});
