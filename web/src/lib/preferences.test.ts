import { describe, expect, it } from "vitest";

import { DEFAULT_LOCALE, interpolate, resolveLocale, translate } from "./i18n";
import { resolveTheme, resolveThemePreference } from "./theme";

describe("i18n helpers", () => {
  it("resolves supported locales and falls back to Chinese", () => {
    expect(resolveLocale("en-US")).toBe("en-US");
    expect(resolveLocale("zh-CN")).toBe("zh-CN");
    expect(resolveLocale("fr-FR")).toBe(DEFAULT_LOCALE);
    expect(resolveLocale(null)).toBe(DEFAULT_LOCALE);
  });

  it("translates keys with interpolation", () => {
    expect(translate("zh-CN", "inspirations.paginationSummary", { page: 2, totalPages: 5, total: 48 })).toBe(
      "第 2 / 5 页 · 共 48 个灵感",
    );
    expect(translate("en-US", "inspirations.paginationSummary", { page: 2, totalPages: 5, total: 48 })).toBe(
      "Page 2 / 5 · 48 inspirations",
    );
    expect(interpolate("Hello {name}, {missing}", { name: "Ada" })).toBe("Hello Ada, {missing}");
  });
});

describe("theme helpers", () => {
  it("resolves persisted theme preference values", () => {
    expect(resolveThemePreference("dark")).toBe("dark");
    expect(resolveThemePreference("light")).toBe("light");
    expect(resolveThemePreference("system")).toBe("system");
    expect(resolveThemePreference("sepia")).toBe("system");
  });

  it("resolves system mode from prefers-color-scheme", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });
});
