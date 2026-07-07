import type { CSSProperties } from "react";

const DESKTOP_SIDE_RAIL_TOP = "var(--pf-top-chrome-safe-height)";
const DESKTOP_SIDE_RAIL_HEIGHT = "calc(100dvh - var(--pf-top-chrome-safe-height))";

interface DesktopSideRailLayoutStylesInput {
  isPinned: boolean;
  forceScrollableDesktopRail?: boolean;
}

interface DesktopSideRailLayoutStyles {
  railStyle: CSSProperties;
  scrollAreaStyle: CSSProperties;
}

export function desktopSideRailLayoutStyles({
  isPinned,
  forceScrollableDesktopRail = false,
}: DesktopSideRailLayoutStylesInput): DesktopSideRailLayoutStyles {
  if (isPinned) {
    return {
      railStyle: {
        position: "sticky",
        top: DESKTOP_SIDE_RAIL_TOP,
        height: DESKTOP_SIDE_RAIL_HEIGHT,
        maxHeight: DESKTOP_SIDE_RAIL_HEIGHT,
        overflow: "hidden",
      },
      scrollAreaStyle: {
        height: "100%",
        maxHeight: "100%",
        overflowY: "auto",
        overscrollBehaviorY: "contain",
      },
    };
  }

  if (forceScrollableDesktopRail) {
    return {
      railStyle: {
        position: "static",
        top: "auto",
        height: "auto",
        maxHeight: DESKTOP_SIDE_RAIL_HEIGHT,
        overflow: "hidden",
      },
      scrollAreaStyle: {
        maxHeight: DESKTOP_SIDE_RAIL_HEIGHT,
        overflowY: "auto",
        overscrollBehaviorY: "contain",
      },
    };
  }

  return {
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
  };
}
