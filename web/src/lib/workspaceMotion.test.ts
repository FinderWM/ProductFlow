/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";

import {
  quantizeWorkspacePointerCoordinate,
  workspaceAmbientGlowTransform,
  workspaceAmbientPointerOnBackground,
  workspaceContinuousMotionAllowed,
  workspaceDocumentMotionState,
  workspaceGalleryClampOffset,
  workspaceGalleryMaxOffset,
  workspaceGalleryTrackTransform,
  workspacePointerCssValues,
  WORKSPACE_AMBIENT_GLOW_CLASS,
  WORKSPACE_DOCUMENT_MOTION_ACTIVE,
  WORKSPACE_DOCUMENT_MOTION_PAUSED,
} from "./workspaceMotion";

describe("workspace pointer motion helpers", () => {
  it("converts viewport-relative pointer coordinates into quantized CSS pixels", () => {
    expect(
      workspacePointerCssValues(340.4, 120.6, {
        width: 800,
        height: 600,
      }),
    ).toEqual({ x: "344px", y: "120px" });
  });

  it("accounts for visual viewport offsets", () => {
    expect(
      workspacePointerCssValues(120, 90, {
        width: 300,
        height: 200,
        offsetLeft: 20,
        offsetTop: 40,
      }),
    ).toEqual({ x: "104px", y: "48px" });
  });

  it("clamps invalid or outside coordinates inside the current viewport", () => {
    expect(
      workspacePointerCssValues(Number.NaN, 500, {
        width: 320,
        height: 240,
      }),
    ).toEqual({ x: "0px", y: "240px" });

    expect(
      workspacePointerCssValues(-30, -10, {
        width: 320,
        height: 240,
      }),
    ).toEqual({ x: "0px", y: "0px" });
  });

  it("quantizes coordinates to the ambient glow step", () => {
    expect(quantizeWorkspacePointerCoordinate(11)).toBe(8);
    expect(quantizeWorkspacePointerCoordinate(12)).toBe(16);
    expect(workspacePointerCssValues(11, 15, { width: 800, height: 600 }, 8)).toEqual({
      x: "8px",
      y: "16px",
    });
  });

  it("builds a compositor-friendly ambient transform", () => {
    expect(workspaceAmbientGlowTransform({ x: "120px", y: "80px" })).toBe("translate3d(120px, 80px, 0)");
  });

  it("tracks ambient glow only on the shell host or glow node, not page UI", () => {
    const host = document.createElement("div");
    host.className = "pf-workspace";
    const main = document.createElement("main");
    const glow = document.createElement("div");
    glow.className = WORKSPACE_AMBIENT_GLOW_CLASS;
    host.append(glow, main);

    expect(workspaceAmbientPointerOnBackground(host, host)).toBe(true);
    expect(workspaceAmbientPointerOnBackground(glow, host)).toBe(true);
    expect(workspaceAmbientPointerOnBackground(main, host)).toBe(false);
    expect(workspaceAmbientPointerOnBackground(null, host)).toBe(false);
    expect(workspaceAmbientPointerOnBackground(host, null)).toBe(false);
  });
});

describe("workspace continuous motion lifecycle", () => {
  it("maps document visibility to the root motion dataset values", () => {
    expect(workspaceDocumentMotionState(false)).toBe(WORKSPACE_DOCUMENT_MOTION_ACTIVE);
    expect(workspaceDocumentMotionState(true)).toBe(WORKSPACE_DOCUMENT_MOTION_PAUSED);
  });

  it("allows continuous motion only when on-screen and the tab is visible", () => {
    expect(workspaceContinuousMotionAllowed({ inView: true, documentHidden: false })).toBe(true);
    expect(workspaceContinuousMotionAllowed({ inView: false, documentHidden: false })).toBe(false);
    expect(workspaceContinuousMotionAllowed({ inView: true, documentHidden: true })).toBe(false);
  });

  it("builds gallery track transforms and clamps auto-scroll offsets", () => {
    expect(workspaceGalleryTrackTransform(48)).toBe("translate3d(-48px, 0, 0)");
    expect(workspaceGalleryTrackTransform(-12)).toBe("translate3d(0px, 0, 0)");
    expect(workspaceGalleryMaxOffset(900, 320)).toBe(580);
    expect(workspaceGalleryMaxOffset(200, 320)).toBe(0);
    expect(workspaceGalleryClampOffset(700, 580)).toBe(580);
    expect(workspaceGalleryClampOffset(-20, 580)).toBe(0);
  });
});
