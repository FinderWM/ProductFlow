import { describe, expect, it } from "vitest";

import { getDesktopNavLayout, type DesktopNavLayoutInput } from "./TopNav";

function item(
  key: string,
  width: number,
  priority: DesktopNavLayoutInput["priority"] = "primary",
  active = false,
): DesktopNavLayoutInput {
  return { key, width, priority, active };
}

describe("getDesktopNavLayout", () => {
  it("keeps every desktop nav item visible when the measured row fits", () => {
    const layout = getDesktopNavLayout({
      items: [
        item("products", 80),
        item("gallery", 80),
        item("usage", 72, "secondary"),
        item("help", 64, "secondary"),
      ],
      availableWidth: 320,
      moreButtonWidth: 40,
      gap: 0,
    });

    expect(layout.visibleKeys).toEqual(["products", "gallery", "usage", "help"]);
    expect(layout.overflowKeys).toEqual([]);
  });

  it("moves rightmost secondary items into overflow before primary items", () => {
    const layout = getDesktopNavLayout({
      items: [
        item("products", 90),
        item("gallery", 80),
        item("usage", 70, "secondary"),
        item("rbac", 70, "secondary"),
        item("settings", 90),
        item("help", 60, "secondary"),
      ],
      availableWidth: 350,
      moreButtonWidth: 40,
      gap: 0,
    });

    expect(layout.visibleKeys).toEqual(["products", "gallery", "settings"]);
    expect(layout.overflowKeys).toEqual(["usage", "rbac", "help"]);
  });

  it("counts the more button width after the first item enters overflow", () => {
    const layout = getDesktopNavLayout({
      items: [
        item("products", 100),
        item("gallery", 100),
        item("usage", 80, "secondary"),
        item("help", 80, "secondary"),
      ],
      availableWidth: 290,
      moreButtonWidth: 60,
      gap: 0,
    });

    expect(layout.visibleKeys).toEqual(["products", "gallery"]);
    expect(layout.overflowKeys).toEqual(["usage", "help"]);
  });

  it("keeps an active secondary item until inactive secondary items are collapsed", () => {
    const layout = getDesktopNavLayout({
      items: [
        item("products", 100),
        item("usage", 80, "secondary", true),
        item("help", 80, "secondary"),
      ],
      availableWidth: 230,
      moreButtonWidth: 40,
      gap: 0,
    });

    expect(layout.visibleKeys).toEqual(["products", "usage"]);
    expect(layout.overflowKeys).toEqual(["help"]);
  });
});
