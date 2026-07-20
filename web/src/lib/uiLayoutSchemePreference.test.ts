import { describe, expect, it } from "vitest";

import {
  fallbackUserUiPreferences,
  mergeUiLayoutSchemePreference,
  resolveActiveSchemeAfterDefaultSaveError,
  resolveActiveSchemeFromDefaultLoad,
  resolveUiLayoutSchemeResolutionStatus,
} from "./uiLayoutSchemePreference";

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

  it("initializes active scheme from default only before the user chooses a runtime scheme", () => {
    expect(
      resolveActiveSchemeFromDefaultLoad({
        enabled: true,
        initializedFromDefault: false,
        hasPreferencesData: true,
        activeScheme: "classic",
        defaultScheme: "workspace",
      }),
    ).toEqual({
      activeScheme: "workspace",
      initializedFromDefault: true,
    });

    expect(
      resolveActiveSchemeFromDefaultLoad({
        enabled: true,
        initializedFromDefault: true,
        hasPreferencesData: true,
        activeScheme: "workspace",
        defaultScheme: "classic",
      }),
    ).toEqual({
      activeScheme: "workspace",
      initializedFromDefault: true,
    });
  });

  it("resets runtime scheme when preference loading is disabled", () => {
    expect(
      resolveActiveSchemeFromDefaultLoad({
        enabled: false,
        initializedFromDefault: true,
        hasPreferencesData: true,
        activeScheme: "workspace",
        defaultScheme: "workspace",
      }),
    ).toEqual({
      activeScheme: "classic",
      initializedFromDefault: false,
    });
  });

  it("rolls back a failed default save without overwriting a later runtime choice", () => {
    expect(
      resolveActiveSchemeAfterDefaultSaveError({
        currentScheme: "workspace",
        attemptedScheme: "workspace",
        previousActiveScheme: "classic",
      }),
    ).toBe("classic");

    expect(
      resolveActiveSchemeAfterDefaultSaveError({
        currentScheme: "classic",
        attemptedScheme: "workspace",
        previousActiveScheme: "classic",
      }),
    ).toBe("classic");
  });

  it("keeps scheme routes gated until preference resolution reaches a terminal state", () => {
    expect(
      resolveUiLayoutSchemeResolutionStatus({
        enabled: true,
        initializedFromDefault: false,
        hasPreferencesData: false,
        hasInitialError: false,
      }),
    ).toBe("resolving");
    expect(
      resolveUiLayoutSchemeResolutionStatus({
        enabled: true,
        initializedFromDefault: false,
        hasPreferencesData: false,
        hasInitialError: true,
      }),
    ).toBe("fallback-error");
    expect(
      resolveUiLayoutSchemeResolutionStatus({
        enabled: true,
        initializedFromDefault: true,
        hasPreferencesData: true,
        hasInitialError: false,
      }),
    ).toBe("resolved");
    expect(
      resolveUiLayoutSchemeResolutionStatus({
        enabled: false,
        initializedFromDefault: false,
        hasPreferencesData: false,
        hasInitialError: false,
      }),
    ).toBe("disabled");
  });
});
