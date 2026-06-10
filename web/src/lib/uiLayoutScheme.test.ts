import { describe, expect, it } from "vitest";

import {
  DEFAULT_UI_LAYOUT_SCHEME,
  UI_LAYOUT_SCHEME_METADATA,
  UI_LAYOUT_SCHEMES,
  isUiLayoutScheme,
  resolveUiLayoutScheme,
  resolveUiLayoutSchemePreference,
  uiLayoutSchemePreferenceUpdate,
} from "./uiLayoutScheme";

describe("ui layout scheme helpers", () => {
  it("keeps a stable extensible scheme order", () => {
    expect(UI_LAYOUT_SCHEMES).toEqual(["classic", "workspace"]);
    expect(UI_LAYOUT_SCHEME_METADATA.map((item) => item.id)).toEqual(UI_LAYOUT_SCHEMES);
    expect(UI_LAYOUT_SCHEME_METADATA.every((item) => item.supported)).toBe(true);
  });

  it("recognizes supported schemes", () => {
    expect(isUiLayoutScheme("classic")).toBe(true);
    expect(isUiLayoutScheme("workspace")).toBe(true);
    expect(isUiLayoutScheme("future")).toBe(false);
    expect(isUiLayoutScheme(null)).toBe(false);
  });

  it("falls back to classic for missing or unknown stored values", () => {
    expect(DEFAULT_UI_LAYOUT_SCHEME).toBe("classic");
    expect(resolveUiLayoutScheme("classic")).toBe("classic");
    expect(resolveUiLayoutScheme("workspace")).toBe("workspace");
    expect(resolveUiLayoutScheme("future")).toBe("classic");
    expect(resolveUiLayoutScheme(null)).toBe("classic");
    expect(resolveUiLayoutScheme(undefined)).toBe("classic");
  });

  it("resolves account preference-like payloads", () => {
    expect(resolveUiLayoutSchemePreference({ ui_layout_scheme: "workspace" })).toBe("workspace");
    expect(resolveUiLayoutSchemePreference({ ui_layout_scheme: "future" })).toBe("classic");
    expect(resolveUiLayoutSchemePreference({})).toBe("classic");
    expect(resolveUiLayoutSchemePreference(null)).toBe("classic");
  });

  it("builds partial account preference updates", () => {
    expect(uiLayoutSchemePreferenceUpdate("workspace")).toEqual({ ui_layout_scheme: "workspace" });
  });
});
