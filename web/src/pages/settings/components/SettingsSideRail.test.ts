import { describe, expect, it } from "vitest";

import {
  centeredRailScrollTop,
  railVisibleWindow,
  settingsDesktopRailLayoutStyles,
  shouldRestoreDesktopRailOnReload,
} from "./SettingsSideRail";

describe("SettingsSideRail centeredRailScrollTop", () => {
  it("centers the active item when there is enough scroll room", () => {
    expect(
      centeredRailScrollTop({
        containerHeight: 400,
        contentHeight: 1200,
        itemTop: 780,
        itemHeight: 60,
      }),
    ).toBe(610);
  });

  it("stops at the top boundary when the active item is near the start", () => {
    expect(
      centeredRailScrollTop({
        containerHeight: 400,
        contentHeight: 1200,
        itemTop: 40,
        itemHeight: 60,
      }),
    ).toBe(0);
  });

  it("stops at the bottom boundary when the active item is near the end", () => {
    expect(
      centeredRailScrollTop({
        containerHeight: 400,
        contentHeight: 1200,
        itemTop: 1100,
        itemHeight: 60,
      }),
    ).toBe(800);
  });
});

describe("SettingsSideRail railVisibleWindow", () => {
  it("measures the visible area from the rail top when the rail starts below the safe top", () => {
    expect(
      railVisibleWindow({
        containerTop: 220,
        containerBottom: 1420,
        safeTop: 80,
        viewportHeight: 1000,
      }),
    ).toEqual({
      top: 0,
      bottom: 780,
      height: 780,
    });
  });

  it("clips the visible top when the rail starts above the safe top", () => {
    expect(
      railVisibleWindow({
        containerTop: 20,
        containerBottom: 1220,
        safeTop: 80,
        viewportHeight: 1000,
      }),
    ).toEqual({
      top: 60,
      bottom: 980,
      height: 920,
    });
  });
});

describe("SettingsSideRail shouldRestoreDesktopRailOnReload", () => {
  it("restores a lower active item on reload when it falls below the initial visible window", () => {
    expect(
      shouldRestoreDesktopRailOnReload({
        navigationType: "reload",
        contentHeight: 1200,
        visibleTop: 0,
        visibleBottom: 780,
        itemTop: 860,
        itemHeight: 60,
      }),
    ).toBe(true);
  });

  it("does not restore when the page was not reloaded", () => {
    expect(
      shouldRestoreDesktopRailOnReload({
        navigationType: "navigate",
        contentHeight: 1200,
        visibleTop: 0,
        visibleBottom: 780,
        itemTop: 860,
        itemHeight: 60,
      }),
    ).toBe(false);
  });

  it("does not restore when the active item is already visible", () => {
    expect(
      shouldRestoreDesktopRailOnReload({
        navigationType: "reload",
        contentHeight: 1200,
        visibleTop: 0,
        visibleBottom: 780,
        itemTop: 620,
        itemHeight: 60,
      }),
    ).toBe(false);
  });
});

describe("SettingsSideRail settingsDesktopRailLayoutStyles", () => {
  it("lets the page move the rail before it reaches the top chrome", () => {
    expect(
      settingsDesktopRailLayoutStyles({
        isPinned: false,
        forceScrollableDesktopRail: false,
      }),
    ).toEqual({
      railStyle: {
        position: "static",
        top: "auto",
        height: "auto",
        maxHeight: "none",
        overflow: "visible",
      },
      scrollAreaStyle: {
        maxHeight: "none",
        overflow: "visible",
        overscrollBehavior: "auto",
      },
    });
  });

  it("pins the rail to the top chrome and gives it the remaining viewport height", () => {
    expect(
      settingsDesktopRailLayoutStyles({
        isPinned: true,
        forceScrollableDesktopRail: false,
      }),
    ).toEqual({
      railStyle: {
        position: "sticky",
        top: "var(--pf-top-chrome-safe-height)",
        height: "calc(100dvh - var(--pf-top-chrome-safe-height))",
        maxHeight: "calc(100dvh - var(--pf-top-chrome-safe-height))",
        overflow: "hidden",
      },
      scrollAreaStyle: {
        height: "100%",
        maxHeight: "100%",
        overflowY: "auto",
        overscrollBehaviorY: "contain",
      },
    });
  });

  it("can restore a lower active item on reload without making the rail sticky early", () => {
    expect(
      settingsDesktopRailLayoutStyles({
        isPinned: false,
        forceScrollableDesktopRail: true,
      }),
    ).toEqual({
      railStyle: {
        position: "static",
        top: "auto",
        height: "auto",
        maxHeight: "calc(100dvh - var(--pf-top-chrome-safe-height))",
        overflow: "hidden",
      },
      scrollAreaStyle: {
        maxHeight: "calc(100dvh - var(--pf-top-chrome-safe-height))",
        overflowY: "auto",
        overscrollBehaviorY: "contain",
      },
    });
  });
});
