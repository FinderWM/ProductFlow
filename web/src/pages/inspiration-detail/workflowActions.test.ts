import { describe, expect, it } from "vitest";

import type { WorkflowNode } from "../../lib/types";
import {
  buildWorkflowDeckNodeEdgeInputs,
  buildWorkflowCanvasActionItems,
  getWorkflowCanvasActionTargetForNodeToolbar,
  getWorkflowCanvasActionTargetNodeIds,
  planWorkflowDeckNodeCreation,
  summarizeWorkflowDeckSourceSelection,
  workflowHasActiveDeckGeneration,
  workflowNodeDeckSourceUnavailableReasonKey,
  workflowNodeHasUsableDeckSourceOutput,
  workflowTemplateGroupNodeIdsFromSelection,
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

    expect(items.map((item) => item.id)).toEqual([
      "run",
      "runAfter",
      "duplicate",
      "fitSelected",
      "createDeck",
      "delete",
    ]);
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

    expect(items.map((item) => item.id)).toEqual(["duplicate", "fitSelected", "createDeck", "saveTemplate", "delete"]);
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

  it("hides regular run actions for deck-generation nodes", () => {
    const items = buildWorkflowCanvasActionItems(
      { kind: "single", nodeId: "deck" },
      {
        primaryNode: {
          ...baseNode,
          id: "deck",
          node_type: "deck_generation",
        },
      },
    );

    expect(items.map((item) => item.id)).toEqual(["duplicate", "fitSelected", "delete"]);
  });

  it("disables create-deck when selected nodes have no usable deck sources", () => {
    const items = buildWorkflowCanvasActionItems(
      {
        kind: "group",
        primaryNodeId: "copy",
        nodeIds: ["copy", "image"],
      },
      {
        primaryNode: {
          ...baseNode,
          id: "copy",
          node_type: "copy_generation",
          status: "failed",
        },
        targetNodes: [
          {
            ...baseNode,
            id: "copy",
            node_type: "copy_generation",
            status: "failed",
          },
          {
            ...baseNode,
            id: "image",
            node_type: "image_generation",
            status: "succeeded",
            output_json: {},
          },
        ],
      },
    );

    expect(items.find((item) => item.id === "createDeck")).toMatchObject({ disabled: true });
  });

  it("keeps create-deck enabled when at least one selected node has reusable output", () => {
    const items = buildWorkflowCanvasActionItems(
      {
        kind: "group",
        primaryNodeId: "copy",
        nodeIds: ["copy", "image"],
      },
      {
        primaryNode: {
          ...baseNode,
          id: "copy",
          node_type: "copy_generation",
          status: "failed",
        },
        targetNodes: [
          {
            ...baseNode,
            id: "copy",
            node_type: "copy_generation",
            status: "failed",
          },
          {
            ...baseNode,
            id: "image",
            node_type: "image_generation",
            status: "succeeded",
            output_json: { generated_poster_variant_ids: ["poster-1"] },
          },
        ],
      },
    );

    expect(items.find((item) => item.id === "createDeck")).toMatchObject({ disabled: false });
  });

  it("detects deck-source usability from workflow node outputs", () => {
    expect(
      workflowNodeHasUsableDeckSourceOutput({
        ...baseNode,
        node_type: "copy_generation",
        status: "succeeded",
        output_json: { copy_set_id: "copy-1" },
      }),
    ).toBe(true);
    expect(
      workflowNodeHasUsableDeckSourceOutput({
        ...baseNode,
        node_type: "reference_image",
        status: "succeeded",
        output_json: { source_asset_ids: ["asset-1"] },
      }),
    ).toBe(true);
    expect(
      workflowNodeHasUsableDeckSourceOutput({
        ...baseNode,
        node_type: "tail_splitter",
        status: "succeeded",
        output_json: { latest_plan: { plan_id: "plan-1" }, applied_batches: [] },
      }),
    ).toBe(true);
    expect(
      workflowNodeHasUsableDeckSourceOutput({
        ...baseNode,
        node_type: "image_generation",
        status: "succeeded",
        output_json: {},
      }),
    ).toBe(false);
    expect(
      workflowNodeDeckSourceUnavailableReasonKey({
        ...baseNode,
        node_type: "image_generation",
        status: "succeeded",
        output_json: {},
      }),
    ).toBe("detail.deck.unavailableReason.emptyOutput");
  });

  it("summarizes usable and unavailable deck sources in a selection", () => {
    expect(
      summarizeWorkflowDeckSourceSelection([
        {
          ...baseNode,
          id: "copy",
          node_type: "copy_generation",
          status: "succeeded",
          output_json: { copy_set_id: "copy-1" },
        },
        {
          ...baseNode,
          id: "image",
          node_type: "image_generation",
          status: "failed",
        },
      ]),
    ).toEqual({
      eligibleNodeCount: 2,
      usableNodeCount: 1,
      unavailableNodeCount: 1,
      firstUnavailableReasonKey: "detail.deck.unavailableReason.nodeNotSucceeded",
    });
  });

  it("builds a deck node creation plan from selected nodes and auto-connect inputs", () => {
    const plan = planWorkflowDeckNodeCreation(
      ["copy", "deck", "inspiration", "image", "missing"],
      [
        {
          ...baseNode,
          id: "copy",
          position_x: 120,
          position_y: 280,
          node_type: "copy_generation",
          status: "succeeded",
          output_json: { copy_set_id: "copy-1" },
        },
        {
          ...baseNode,
          id: "deck",
          position_x: 460,
          position_y: 120,
          node_type: "deck_generation",
        },
        {
          ...baseNode,
          id: "inspiration",
          position_x: 40,
          position_y: 80,
          node_type: "inspiration_context",
        },
        {
          ...baseNode,
          id: "image",
          position_x: 320,
          position_y: 160,
          node_type: "image_generation",
          status: "succeeded",
          output_json: { generated_poster_variant_ids: ["poster-1"] },
        },
      ],
      160,
    );

    expect(plan.sourceNodes.map((node) => node.id)).toEqual(["copy", "image"]);
    expect(plan.usableSourceNodes.map((node) => node.id)).toEqual(["copy", "image"]);
    expect(plan.sourceSelectionSummary).toEqual({
      eligibleNodeCount: 2,
      usableNodeCount: 2,
      unavailableNodeCount: 0,
      firstUnavailableReasonKey: null,
    });
    expect(plan.nextPosition).toEqual({ x: 480, y: 160 });
    expect(buildWorkflowDeckNodeEdgeInputs(plan.sourceNodes, "deck-new")).toEqual([
      {
        source_node_id: "copy",
        target_node_id: "deck-new",
        source_handle: "output",
        target_handle: "input",
      },
      {
        source_node_id: "image",
        target_node_id: "deck-new",
        source_handle: "output",
        target_handle: "input",
      },
    ]);
  });

  it("filters deck-generation nodes out of template group saves", () => {
    expect(
      workflowTemplateGroupNodeIdsFromSelection(
        ["copy", "deck", "image"],
        [
          {
            ...baseNode,
            id: "copy",
            node_type: "copy_generation",
          },
          {
            ...baseNode,
            id: "deck",
            node_type: "deck_generation",
          },
          {
            ...baseNode,
            id: "image",
            node_type: "image_generation",
          },
        ],
      ),
    ).toEqual(["copy", "image"]);
  });

  it("detects active deck generation for workflow polling", () => {
    expect(
      workflowHasActiveDeckGeneration([
        {
          ...baseNode,
          id: "deck",
          node_type: "deck_generation",
          output_json: { deck_status: "generating" },
        },
      ]),
    ).toBe(true);
    expect(
      workflowHasActiveDeckGeneration([
        {
          ...baseNode,
          id: "deck",
          node_type: "deck_generation",
          output_json: { deck_status: "completed" },
        },
      ]),
    ).toBe(false);
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
