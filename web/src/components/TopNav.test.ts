import { describe, expect, it } from "vitest";

import {
  getDesktopNavAvailableWidth,
  getDesktopNavLayout,
  getWorkspaceHomeLeadingSpace,
  getWorkspaceNavAvailableWidth,
  getWorkspaceNavLayout,
  isPointerInWorkspaceThemeDockRevealZone,
  nextDesktopMoreMenuState,
  shouldSuppressTopNavSelection,
  shouldCloseDesktopMoreOnBlur,
  workspaceTopNavTarget,
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
  it("subtracts the independent workspace brand from the nav budget", () => {
    expect(
      getWorkspaceNavAvailableWidth({
        viewportWidth: 1180,
        brandWidth: 238,
        horizontalChrome: 36,
        brandGap: 14,
      }),
    ).toBe(892);
  });

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

describe("getWorkspaceHomeLeadingSpace", () => {
  it("keeps the greeting 50px below the brand bottom when the shell ends 10px lower", () => {
    expect(
      getWorkspaceHomeLeadingSpace({
        brandBottom: 76,
        shellBottom: 86,
      }),
    ).toBe(40);
  });

  it("expands the leading space as the collapsed shell bottom approaches the brand", () => {
    expect(
      getWorkspaceHomeLeadingSpace({
        brandBottom: 76,
        shellBottom: 78,
      }),
    ).toBe(48);
  });

  it("never returns a negative leading space", () => {
    expect(
      getWorkspaceHomeLeadingSpace({
        brandBottom: 60,
        shellBottom: 140,
      }),
    ).toBe(0);
  });
});

describe("workspaceTopNavTarget", () => {
  it("uses the workspace-specific business route when provided", () => {
    expect(workspaceTopNavTarget({ to: "/image-chat", workspaceTo: "/image-chat/workbench" })).toBe(
      "/image-chat/workbench",
    );
    expect(workspaceTopNavTarget({ to: "/resource-library", workspaceTo: "/resource-library/manage" })).toBe(
      "/resource-library/manage",
    );
    expect(workspaceTopNavTarget({ to: "/gallery", workspaceTo: "/gallery/manage" })).toBe("/gallery/manage");
    expect(workspaceTopNavTarget({ to: "/usage-stats", workspaceTo: "/usage-stats/detail" })).toBe(
      "/usage-stats/detail",
    );
  });

  it("falls back to the normal top-level route without a workspace override", () => {
    expect(workspaceTopNavTarget({ to: "/workflow/templates" })).toBe("/workflow/templates");
  });
});

describe("shouldSuppressTopNavSelection", () => {
  it("suppresses first-level nav selection on the workspace home route", () => {
    expect(shouldSuppressTopNavSelection("/inspirations", "workspace")).toBe(true);
  });

  it("keeps first-level nav selection on classic inspirations routes and workspace subpages", () => {
    expect(shouldSuppressTopNavSelection("/inspirations", "classic")).toBe(false);
    expect(shouldSuppressTopNavSelection("/inspirations/list", "workspace")).toBe(false);
  });
});

describe("nextDesktopMoreMenuState", () => {
  it("opens from hover without pinning the menu", () => {
    expect(nextDesktopMoreMenuState({ open: false, pinned: false }, "hover-open")).toEqual({
      open: true,
      pinned: false,
    });
  });

  it("pins a hover-open menu on the first button click", () => {
    expect(nextDesktopMoreMenuState({ open: true, pinned: false }, "button-click")).toEqual({
      open: true,
      pinned: true,
    });
  });

  it("closes and unpins a pinned menu on the second button click", () => {
    expect(nextDesktopMoreMenuState({ open: true, pinned: true }, "button-click")).toEqual({
      open: false,
      pinned: false,
    });
  });

  it("resets pinned state on close before the next hover-open cycle", () => {
    const closed = nextDesktopMoreMenuState({ open: true, pinned: true }, "close");
    const reopened = nextDesktopMoreMenuState(closed, "hover-open");

    expect(closed).toEqual({ open: false, pinned: false });
    expect(reopened).toEqual({ open: true, pinned: false });
  });
});

describe("shouldCloseDesktopMoreOnBlur", () => {
  it("keeps the menu open when focus moves into the portal menu", () => {
    expect(
      shouldCloseDesktopMoreOnBlur({
        hasNextTarget: true,
        nextTargetInsideTrigger: false,
        nextTargetInsideMenu: true,
      }),
    ).toBe(false);
  });

  it("keeps the menu open when focus stays inside the trigger wrapper", () => {
    expect(
      shouldCloseDesktopMoreOnBlur({
        hasNextTarget: true,
        nextTargetInsideTrigger: true,
        nextTargetInsideMenu: false,
      }),
    ).toBe(false);
  });

  it("closes the menu when focus moves outside both trigger and portal menu", () => {
    expect(
      shouldCloseDesktopMoreOnBlur({
        hasNextTarget: true,
        nextTargetInsideTrigger: false,
        nextTargetInsideMenu: false,
      }),
    ).toBe(true);
  });

  it("closes the menu when the next focus target is unavailable", () => {
    expect(
      shouldCloseDesktopMoreOnBlur({
        hasNextTarget: false,
        nextTargetInsideTrigger: false,
        nextTargetInsideMenu: false,
      }),
    ).toBe(true);
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
