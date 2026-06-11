import { describe, expect, it } from "vitest";

import type { WorkflowNode } from "../../lib/types";
import {
  buildWorkflowCanvasActionItems,
  getWorkflowCanvasActionTargetForNodeToolbar,
  getWorkflowCanvasActionTargetNodeIds,
} from "./workflowActions";

const baseNode: WorkflowNode = {
  id: "copy",
  workflow_id: "workflow",
  node_type: "copy_generation",
  title: "Copy",
  position_x: 0,
  position_y: 0,
  config_json: {},
  output_json: null,
  status: "idle",
  failure_reason: null,
  retry_hint: null,
  non_retryable_reason: null,
  is_retryable: true,
  attempt_count: 0,
  retry_count: 0,
  last_run_at: null,
  created_at: "2026-05-16T00:00:00Z",
  updated_at: "2026-05-16T00:00:00Z",
};

describe("workflow canvas actions", () => {
  it("does not build a toolbar target for an unselected node", () => {
    const target = getWorkflowCanvasActionTargetForNodeToolbar("copy", "image", ["image", "reference"]);

    expect(target).toBeNull();
  });

  it("anchors a selected group toolbar to the primary selected node", () => {
    const target = getWorkflowCanvasActionTargetForNodeToolbar("image", "image", ["copy", "image", "reference"]);

    expect(target).toEqual({
      kind: "group",
      primaryNodeId: "image",
      nodeIds: ["copy", "image", "reference"],
    });
    expect(target ? getWorkflowCanvasActionTargetNodeIds(target) : []).toEqual(["copy", "image", "reference"]);
  });

  it("does not render a duplicate group toolbar on secondary selected nodes", () => {
    const target = getWorkflowCanvasActionTargetForNodeToolbar("copy", "image", ["copy", "image", "reference"]);

    expect(target).toBeNull();
  });

  it("builds a single-node toolbar target for the primary node", () => {
    const target = getWorkflowCanvasActionTargetForNodeToolbar("copy", "copy", ["copy"]);

    expect(target).toEqual({ kind: "single", nodeId: "copy" });
    expect(target ? getWorkflowCanvasActionTargetNodeIds(target) : []).toEqual(["copy"]);
  });

  it("builds single-node actions without local-only destructive shortcuts", () => {
    const items = buildWorkflowCanvasActionItems(
      { kind: "single", nodeId: "copy" },
      {
        primaryNode: baseNode,
        runActionState: {
          disabled: false,
          pending: false,
          label: "Run",
          title: "Run node",
        },
      },
    );

    expect(items.map((item) => item.id)).toEqual(["run", "runAfter", "duplicate", "fitSelected", "delete"]);
  });

  it("disables delete when the selected node is queued or running", () => {
    for (const status of ["queued", "running"] as const) {
      const items = buildWorkflowCanvasActionItems(
        { kind: "single", nodeId: "copy" },
        {
          primaryNode: {
            ...baseNode,
            status,
          },
        },
      );

      expect(items.find((item) => item.id === "delete")).toMatchObject({ disabled: true });
    }
  });

  it("builds group actions with save-template and without single-node run", () => {
    const items = buildWorkflowCanvasActionItems({
      kind: "group",
      primaryNodeId: "copy",
      nodeIds: ["copy", "image"],
    });

    expect(items.map((item) => item.id)).toEqual(["duplicate", "fitSelected", "saveTemplate", "delete"]);
  });

  it("disables group delete when any selected target node is queued or running", () => {
    const items = buildWorkflowCanvasActionItems(
      {
        kind: "group",
        primaryNodeId: "copy",
        nodeIds: ["copy", "image"],
      },
      {
        primaryNode: baseNode,
        targetNodes: [
          baseNode,
          {
            ...baseNode,
            id: "image",
            node_type: "image_generation",
            status: "running",
          },
        ],
      },
    );

    expect(items.find((item) => item.id === "delete")).toMatchObject({ disabled: true });
  });

  it("hides run actions for inspiration-context nodes", () => {
    const items = buildWorkflowCanvasActionItems(
      { kind: "single", nodeId: "inspiration" },
      {
        primaryNode: {
          ...baseNode,
          id: "inspiration",
          node_type: "inspiration_context",
        },
      },
    );

    expect(items.map((item) => item.id)).toEqual(["fitSelected"]);
  });

  it("keeps inspiration-context groups away from template and delete actions", () => {
    const items = buildWorkflowCanvasActionItems(
      {
        kind: "group",
        primaryNodeId: "inspiration",
        nodeIds: ["inspiration", "copy"],
      },
      {
        primaryNode: {
          ...baseNode,
          id: "inspiration",
          node_type: "inspiration_context",
        },
        targetNodes: [
          {
            ...baseNode,
            id: "inspiration",
            node_type: "inspiration_context",
          },
          baseNode,
        ],
      },
    );

    expect(items.map((item) => item.id)).toEqual(["duplicate", "fitSelected"]);
  });

});
