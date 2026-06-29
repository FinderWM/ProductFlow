import { describe, expect, it } from "vitest";

import type { DeckSourceItem, WorkflowNode } from "../../lib/types";
import {
  buildDeckSourceOrderForNodes,
  collectDeckSourceNodesFromTailSplitter,
  deckSourceOrderNodeToken,
  deckSourceOrderTailToken,
  orderDeckSourcesForDraft,
} from "./deckSourceOrder";

const baseNode: WorkflowNode = {
  id: "node-base",
  workflow_id: "workflow-1",
  node_type: "copy_generation",
  title: "Node",
  position_x: 0,
  position_y: 0,
  config_json: {},
  status: "succeeded",
  output_json: null,
  failure_reason: null,
  is_retryable: true,
  attempt_count: 0,
  retry_count: 0,
  non_retryable_reason: null,
  retry_hint: null,
  last_run_at: null,
  created_at: "2026-06-25T00:00:00Z",
  updated_at: "2026-06-25T00:00:00Z",
};

const sourceItem = (
  overrides: Partial<DeckSourceItem> & Pick<DeckSourceItem, "source_item_id" | "workflow_node_id">,
): DeckSourceItem => ({
  source_item_id: overrides.source_item_id,
  workflow_node_id: overrides.workflow_node_id,
  workflow_node_title: overrides.workflow_node_title ?? overrides.workflow_node_id,
  workflow_node_type: overrides.workflow_node_type ?? "image_generation",
  kind: overrides.kind ?? "poster",
  group_id: overrides.group_id ?? `node:${overrides.workflow_node_id}`,
  selected: overrides.selected ?? true,
  planning_role: overrides.planning_role ?? null,
  summary: overrides.summary ?? overrides.source_item_id,
  copy_set_id: overrides.copy_set_id ?? null,
  source_asset_id: overrides.source_asset_id ?? null,
  poster_variant_id: overrides.poster_variant_id ?? null,
  tail_batch_id: overrides.tail_batch_id ?? null,
  tail_item_id: overrides.tail_item_id ?? null,
  download_url: overrides.download_url ?? null,
  preview_url: overrides.preview_url ?? null,
  thumbnail_url: overrides.thumbnail_url ?? null,
});

describe("deckSourceOrder helpers", () => {
  it("builds source-order tokens from selected nodes and tail metadata", () => {
    const tailNode: WorkflowNode = {
      ...baseNode,
      id: "tail-node",
      node_type: "tail_splitter",
      title: "Tail",
      output_json: {
        summary: "tail",
        latest_plan: {
          version: 1,
          plan_id: "plan-1",
          status: "applied",
          source_summary: "summary",
          created_at: "2026-06-25T00:00:00Z",
          items: [
            { id: "tail-item-1", order: 1, title: "One", instruction: "one", visual_intent: "one", source_refs: [] },
            { id: "tail-item-2", order: 2, title: "Two", instruction: "two", visual_intent: "two", source_refs: [] },
          ],
        },
        applied_batches: [],
      },
    };
    const childNode: WorkflowNode = {
      ...baseNode,
      id: "image-node",
      node_type: "image_generation",
      config_json: {
        generated_by: { item_id: "tail-item-2" },
      },
    };

    expect(buildDeckSourceOrderForNodes([tailNode, childNode])).toEqual([
      deckSourceOrderNodeToken("tail-node"),
      deckSourceOrderTailToken("tail-item-1"),
      deckSourceOrderTailToken("tail-item-2"),
      deckSourceOrderNodeToken("image-node"),
    ]);
  });

  it("collects tail deck source nodes in plan-item order and deduplicates child nodes", () => {
    const tailNode: WorkflowNode = {
      ...baseNode,
      id: "tail-node",
      node_type: "tail_splitter",
      title: "Tail",
      output_json: {
        summary: "tail",
        latest_plan: {
          version: 1,
          plan_id: "plan-1",
          status: "applied",
          source_summary: "summary",
          created_at: "2026-06-25T00:00:00Z",
          items: [
            { id: "tail-item-1", order: 1, title: "One", instruction: "one", visual_intent: "one", source_refs: [] },
            { id: "tail-item-2", order: 2, title: "Two", instruction: "two", visual_intent: "two", source_refs: [] },
          ],
        },
        applied_batches: [
          {
            batch_id: "batch-2",
            plan_id: "plan-1",
            item_ids: ["tail-item-2"],
            node_ids: ["node-b", "node-c"],
            created_at: "2026-06-25T00:00:02Z",
          },
          {
            batch_id: "batch-1",
            plan_id: "plan-1",
            item_ids: ["tail-item-1"],
            node_ids: ["node-a", "node-b"],
            created_at: "2026-06-25T00:00:01Z",
          },
        ],
      },
    };
    const childA: WorkflowNode = { ...baseNode, id: "node-a", node_type: "copy_generation", title: "A" };
    const childB: WorkflowNode = { ...baseNode, id: "node-b", node_type: "reference_image", title: "B" };
    const childC: WorkflowNode = { ...baseNode, id: "node-c", node_type: "image_generation", title: "C" };

    expect(
      collectDeckSourceNodesFromTailSplitter(tailNode, [tailNode, childA, childB, childC]).map((node) => node.id),
    ).toEqual(["tail-node", "node-a", "node-b", "node-c"]);
  });

  it("orders sources by the earliest configured source-order match", () => {
    const ordered = orderDeckSourcesForDraft(
      [
        sourceItem({
          source_item_id: "tail:tail-item-1:poster:poster-a",
          workflow_node_id: "node-a",
          tail_item_id: "tail-item-1",
        }),
        sourceItem({
          source_item_id: "tail:tail-item-1:poster:poster-b",
          workflow_node_id: "node-b",
          tail_item_id: "tail-item-1",
        }),
        sourceItem({
          source_item_id: "tail:tail-item-2:poster:poster-c",
          workflow_node_id: "node-c",
          tail_item_id: "tail-item-2",
        }),
      ],
      [
        deckSourceOrderNodeToken("node-a"),
        deckSourceOrderTailToken("tail-item-2"),
        deckSourceOrderNodeToken("node-c"),
        "tail:tail-item-1:poster:poster-b",
        "tail:tail-item-1:poster:poster-a",
      ],
      ["tail:tail-item-1:poster:poster-a"],
    );

    expect(ordered.map((item) => item.source_item_id)).toEqual([
      "tail:tail-item-1:poster:poster-a",
      "tail:tail-item-2:poster:poster-c",
      "tail:tail-item-1:poster:poster-b",
    ]);
    expect(ordered.map((item) => item.selected)).toEqual([false, true, true]);
  });

  it("accepts legacy raw node and tail ids in source order", () => {
    const ordered = orderDeckSourcesForDraft(
      [
        sourceItem({
          source_item_id: "node:node-a:copy:copy-a",
          workflow_node_id: "node-a",
          workflow_node_type: "copy_generation",
          kind: "copy",
        }),
        sourceItem({
          source_item_id: "tail:tail-item-1:poster:poster-a",
          workflow_node_id: "node-b",
          tail_item_id: "tail-item-1",
        }),
      ],
      ["tail-item-1", "node-a"],
      [],
    );

    expect(ordered.map((item) => item.source_item_id)).toEqual([
      "tail:tail-item-1:poster:poster-a",
      "node:node-a:copy:copy-a",
    ]);
  });
});
