import { describe, expect, it } from "vitest";

import type { WorkflowNode } from "../../lib/types";
import { readDeckNodeCardState } from "./deckNodeCardState";

const baseNode: WorkflowNode = {
  id: "node-1",
  workflow_id: "workflow-1",
  node_type: "deck_generation",
  title: "演示节点",
  position_x: 0,
  position_y: 0,
  config_json: {},
  output_json: null,
  status: "idle",
  failure_reason: null,
  is_retryable: false,
  attempt_count: 0,
  retry_count: 0,
  non_retryable_reason: null,
  retry_hint: null,
  last_run_at: null,
  created_at: "2026-06-27T00:00:00Z",
  updated_at: "2026-06-27T00:00:00Z",
};

describe("readDeckNodeCardState", () => {
  it("treats empty deck nodes as ready editors", () => {
    expect(readDeckNodeCardState(baseNode)).toEqual({
      badgeTone: "idle",
      badgeLabelKey: "detail.nodeStatus.available",
      slideCount: null,
      generatedSlideCount: null,
      sourceItemCount: 0,
      sourceStale: false,
    });
  });

  it("reads deck snapshot metrics from node output", () => {
    expect(
      readDeckNodeCardState({
        ...baseNode,
        output_json: {
          deck_status: "generating",
          slide_count: 8,
          generated_slide_count: 3,
          source_stale: true,
          source_manifest: {
            source_item_ids: ["node:copy:1", "node:image:1", "", 3],
          },
        },
      }),
    ).toEqual({
      badgeTone: "running",
      badgeLabelKey: "detail.deck.status.generating",
      slideCount: 8,
      generatedSlideCount: 3,
      sourceItemCount: 2,
      sourceStale: true,
    });
  });

  it("maps completed and failed deck snapshots to workflow badge tones", () => {
    expect(
      readDeckNodeCardState({
        ...baseNode,
        output_json: { deck_status: "completed", slide_count: 6, generated_slide_count: 6 },
      }),
    ).toMatchObject({
      badgeTone: "succeeded",
      badgeLabelKey: "detail.deck.status.completed",
    });
    expect(
      readDeckNodeCardState({
        ...baseNode,
        output_json: { deck_status: "failed", slide_count: 6, generated_slide_count: 2 },
      }),
    ).toMatchObject({
      badgeTone: "failed",
      badgeLabelKey: "detail.deck.status.failed",
    });
  });

  it("returns null for non-deck nodes", () => {
    expect(readDeckNodeCardState({ ...baseNode, node_type: "image_generation" })).toBeNull();
  });
});
