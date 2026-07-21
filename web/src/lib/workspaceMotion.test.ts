import { describe, expect, it } from "vitest";

import {
  quantizeWorkspacePointerCoordinate,
  workspaceAmbientGlowTransform,
  workspacePointerCssValues,
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
});
