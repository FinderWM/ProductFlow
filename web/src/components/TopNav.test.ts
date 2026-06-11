import { describe, expect, it } from "vitest";

import {
  getDesktopNavAvailableWidth,
  getDesktopNavLayout,
  getWorkspaceNavLayout,
  isPointerInWorkspaceThemeDockRevealZone,
  type DesktopNavLayoutInput,
  type WorkspaceThemeDockRect,
  type WorkspaceNavLayoutInput,
} from "./TopNav";

function item(
  key: string,
  width: number,
  priority: DesktopNavLayoutInput["priority"] = "primary",
  active = false,
): DesktopNavLayoutInput {
  return { key, width, priority, active };
}

function workspaceItem(
  key: string,
  width: number,
  priority: WorkspaceNavLayoutInput["priority"] = "primary",
): WorkspaceNavLayoutInput {
  return { key, width, priority };
}

describe("getDesktopNavLayout", () => {
  it("subtracts right-side control overflow from the classic desktop nav budget", () => {
    expect(
      getDesktopNavAvailableWidth({
        navAreaWidth: 520,
        rightSlotWidth: 224,
        rightControlsWidth: 320,
        horizontalChrome: 36,
      }),
    ).toBe(388);
  });

  it("does not reduce the classic desktop nav budget when right controls fit their slot", () => {
    expect(
      getDesktopNavAvailableWidth({
        navAreaWidth: 520,
        rightSlotWidth: 224,
        rightControlsWidth: 180,
        horizontalChrome: 36,
      }),
    ).toBe(484);
  });

  it("keeps secondary desktop nav items in overflow even when the measured row fits", () => {
    const layout = getDesktopNavLayout({
      items: [
        item("inspirations", 80),
        item("gallery", 80),
        item("usage", 72, "secondary"),
        item("help", 64, "secondary"),
      ],
      availableWidth: 320,
      moreButtonWidth: 40,
      gap: 0,
    });

    expect(layout.visibleKeys).toEqual(["inspirations", "gallery"]);
    expect(layout.overflowKeys).toEqual(["usage", "help"]);
  });

  it("moves rightmost secondary items into overflow before primary items", () => {
    const layout = getDesktopNavLayout({
      items: [
        item("inspirations", 90),
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

    expect(layout.visibleKeys).toEqual(["inspirations", "gallery", "settings"]);
    expect(layout.overflowKeys).toEqual(["usage", "rbac", "help"]);
  });

  it("counts the more button width after the first item enters overflow", () => {
    const layout = getDesktopNavLayout({
      items: [
        item("inspirations", 100),
        item("gallery", 100),
        item("usage", 80, "secondary"),
        item("help", 80, "secondary"),
      ],
      availableWidth: 290,
      moreButtonWidth: 60,
      gap: 0,
    });

    expect(layout.visibleKeys).toEqual(["inspirations", "gallery"]);
    expect(layout.overflowKeys).toEqual(["usage", "help"]);
  });

  it("counts the more button width when a primary item first enters overflow", () => {
    const layout = getDesktopNavLayout({
      items: [
        item("inspirations", 100),
        item("image-chat", 100),
        item("gallery", 100),
      ],
      availableWidth: 250,
      moreButtonWidth: 60,
      gap: 0,
    });

    expect(layout.visibleKeys).toEqual(["inspirations"]);
    expect(layout.overflowKeys).toEqual(["image-chat", "gallery"]);
  });

  it("keeps active secondary items in overflow", () => {
    const layout = getDesktopNavLayout({
      items: [
        item("inspirations", 100),
        item("usage", 80, "secondary", true),
        item("help", 80, "secondary"),
      ],
      availableWidth: 230,
      moreButtonWidth: 40,
      gap: 0,
    });

    expect(layout.visibleKeys).toEqual(["inspirations"]);
    expect(layout.overflowKeys).toEqual(["usage", "help"]);
  });
});

describe("getWorkspaceNavLayout", () => {
  it("keeps secondary workspace nav items in More without hiding primary items when the row fits", () => {
    const layout = getWorkspaceNavLayout({
      items: [
        workspaceItem("resource-library", 92),
        workspaceItem("inspirations", 72),
        workspaceItem("image-chat", 84),
        workspaceItem("help", 58, "secondary"),
      ],
      availableWidth: 940,
      fixedControlWidths: [220, 116, 92, 86],
      moreButtonWidth: 58,
      gap: 10,
    });

    expect(layout.visibleKeys).toEqual(["resource-library", "inspirations", "image-chat"]);
    expect(layout.overflowKeys).toEqual(["help"]);
  });

  it("moves primary workspace nav items into More from right to left when available width shrinks", () => {
    const layout = getWorkspaceNavLayout({
      items: [
        workspaceItem("resource-library", 92),
        workspaceItem("inspirations", 72),
        workspaceItem("image-chat", 84),
        workspaceItem("gallery", 64),
        workspaceItem("status", 64),
        workspaceItem("usage", 82),
        workspaceItem("settings", 64),
        workspaceItem("help", 58, "secondary"),
      ],
      availableWidth: 900,
      fixedControlWidths: [220, 116, 92, 86],
      moreButtonWidth: 58,
      gap: 10,
    });

    expect(layout.visibleKeys).toEqual(["resource-library", "inspirations", "image-chat"]);
    expect(layout.overflowKeys).toEqual(["gallery", "status", "usage", "settings", "help"]);
  });
});

describe("isPointerInWorkspaceThemeDockRevealZone", () => {
  const rect: WorkspaceThemeDockRect = {
    bottom: 160,
    left: 240,
    right: 360,
    top: 120,
  };

  it("returns true when the pointer is inside the dock rect", () => {
    expect(
      isPointerInWorkspaceThemeDockRevealZone({
        clientX: 300,
        clientY: 140,
        rect,
      }),
    ).toBe(true);
  });

  it("returns true when the pointer is outside the dock rect but inside the reveal margin", () => {
    expect(
      isPointerInWorkspaceThemeDockRevealZone({
        clientX: 232,
        clientY: 112,
        margin: 10,
        rect,
      }),
    ).toBe(true);
  });

  it("returns false when the pointer is outside the reveal margin", () => {
    expect(
      isPointerInWorkspaceThemeDockRevealZone({
        clientX: 220,
        clientY: 108,
        margin: 10,
        rect,
      }),
    ).toBe(false);
  });

  it("returns false without a saved dock rect", () => {
    expect(
      isPointerInWorkspaceThemeDockRevealZone({
        clientX: 300,
        clientY: 140,
        rect: null,
      }),
    ).toBe(false);
  });
});
