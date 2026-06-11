import { describe, expect, it } from "vitest";

import type { TranslationKey, TranslationParams } from "../../lib/i18n";
import { galleryAdminRemovedLabel } from "./moderation";

const t = (key: TranslationKey, params?: TranslationParams): string => {
  if (key === "gallery.adminRemovedWithReason") {
    return `管理员已移除：${params?.reason}`;
  }
  if (key === "gallery.adminRemoved") {
    return "管理员已移除";
  }
  return key;
};

describe("gallery moderation helpers", () => {
  it("returns null for usable gallery entries", () => {
    expect(galleryAdminRemovedLabel({ enabled: true, effective_enabled: true }, t)).toBeNull();
  });

  it("returns the gallery admin-removed label for directly disabled entries", () => {
    expect(
      galleryAdminRemovedLabel(
        {
          enabled: false,
          disabled_reason: null,
          effective_enabled: false,
          effective_disabled_reason: null,
        },
        t,
      ),
    ).toBe("管理员已移除");
  });

  it("includes the effective disabled reason when available", () => {
    expect(
      galleryAdminRemovedLabel(
        {
          enabled: true,
          disabled_reason: null,
          effective_enabled: false,
          effective_disabled_reason: "内容不合规",
        },
        t,
      ),
    ).toBe("管理员已移除：内容不合规");
  });
});
