import { describe, expect, it } from "vitest";

import { workspacePointerCssValues } from "./workspaceMotion";

describe("workspace pointer motion helpers", () => {
  it("converts viewport-relative pointer coordinates into rounded CSS pixels", () => {
    expect(
      workspacePointerCssValues(340.4, 120.6, {
        width: 800,
        height: 600,
      }),
    ).toEqual({ x: "340px", y: "121px" });
  });

  it("accounts for visual viewport offsets", () => {
    expect(
      workspacePointerCssValues(120, 90, {
        width: 300,
        height: 200,
        offsetLeft: 20,
        offsetTop: 40,
      }),
    ).toEqual({ x: "100px", y: "50px" });
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
});
