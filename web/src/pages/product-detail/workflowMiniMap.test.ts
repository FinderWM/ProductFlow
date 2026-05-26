import { describe, expect, it } from "vitest";

import {
  workflowMiniMapNodeClassName,
  workflowMiniMapNodeColor,
  workflowMiniMapNodeStrokeColor,
} from "./workflowMiniMap";

describe("workflowMiniMap", () => {
  it("uses a neutral fill for non-running nodes and an emphasis fill for running nodes", () => {
    expect(workflowMiniMapNodeColor({ status: "idle" })).toBe("#d4d4d8");
    expect(workflowMiniMapNodeColor({ status: "queued" })).toBe("#d4d4d8");
    expect(workflowMiniMapNodeColor({ status: "succeeded" })).toBe("#d4d4d8");
    expect(workflowMiniMapNodeColor({ status: "running" })).toBe("#2563eb");
  });

  it("marks only the currently running node status with a minimap emphasis class", () => {
    expect(workflowMiniMapNodeClassName({ status: "running" })).toBe("workflow-canvas-minimap-node-running");
    expect(workflowMiniMapNodeClassName({ status: "queued" })).toBe("");
    expect(workflowMiniMapNodeClassName({ status: "succeeded" })).toBe("");
    expect(workflowMiniMapNodeClassName({ status: "idle" })).toBe("");
  });

  it("keeps running stroke emphasized and selected non-running strokes neutral", () => {
    expect(
      workflowMiniMapNodeStrokeColor(
        { status: "running" },
        { primarySelected: true, secondarySelected: false },
      ),
    ).toBe("#1d4ed8");
    expect(
      workflowMiniMapNodeStrokeColor(
        { status: "queued" },
        { primarySelected: false, secondarySelected: true },
      ),
    ).toBe("#71717a");
    expect(
      workflowMiniMapNodeStrokeColor(
        { status: "queued" },
        { primarySelected: false, secondarySelected: false },
      ),
    ).toBe("#cbd5e1");
  });
});
