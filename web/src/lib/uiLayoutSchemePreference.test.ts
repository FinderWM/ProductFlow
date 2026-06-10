import { describe, expect, it } from "vitest";

import { fallbackUserUiPreferences, mergeUiLayoutSchemePreference } from "./uiLayoutSchemePreference";

describe("ui layout scheme preference helpers", () => {
  it("builds a complete fallback preference payload", () => {
    expect(fallbackUserUiPreferences()).toEqual({
      user_id: "",
      ui_layout_scheme: "classic",
      mask_sensitive_images_in_inspirations: true,
      mask_sensitive_images_in_image_chat: true,
      created_at: "",
      updated_at: "",
    });
  });

  it("merges layout scheme without dropping sensitive image preferences", () => {
    expect(
      mergeUiLayoutSchemePreference(
        {
          user_id: "user-1",
          ui_layout_scheme: "classic",
          mask_sensitive_images_in_inspirations: false,
          mask_sensitive_images_in_image_chat: true,
          created_at: "2026-06-09T00:00:00Z",
          updated_at: "2026-06-09T00:00:00Z",
        },
        "workspace",
      ),
    ).toEqual({
      user_id: "user-1",
      ui_layout_scheme: "workspace",
      mask_sensitive_images_in_inspirations: false,
      mask_sensitive_images_in_image_chat: true,
      created_at: "2026-06-09T00:00:00Z",
      updated_at: "2026-06-09T00:00:00Z",
    });
  });
});
