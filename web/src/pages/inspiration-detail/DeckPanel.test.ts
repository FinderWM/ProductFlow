import { describe, expect, it } from "vitest";

import {
  canOpenWorkflowDeckNode,
  deckAllowsLegacyMutation,
  deckHistoryAccessoryKind,
  deckSupportsFrontendPptxExport,
  hasDeletedWorkflowDeckNode,
  isWorkflowDeck,
} from "./deckPanelState";

describe("DeckPanel workflow deck state", () => {
  it("treats only null workflow_node_id as legacy deck", () => {
    expect(isWorkflowDeck({ workflow_node_id: null, workflow_node_exists: null })).toBe(false);
    expect(isWorkflowDeck({ workflow_node_id: "node-1", workflow_node_exists: true })).toBe(true);
    expect(isWorkflowDeck({ workflow_node_id: "node-1", workflow_node_exists: false })).toBe(true);
  });

  it("opens only workflow decks whose source node is not known deleted", () => {
    expect(canOpenWorkflowDeckNode({ workflow_node_id: "node-1", workflow_node_exists: true })).toBe(true);
    expect(canOpenWorkflowDeckNode({ workflow_node_id: "node-1", workflow_node_exists: null })).toBe(true);
    expect(canOpenWorkflowDeckNode({ workflow_node_id: "node-1", workflow_node_exists: false })).toBe(false);
    expect(canOpenWorkflowDeckNode({ workflow_node_id: null, workflow_node_exists: null })).toBe(false);
  });

  it("detects deleted source nodes without downgrading the deck to legacy editing", () => {
    expect(hasDeletedWorkflowDeckNode({ workflow_node_id: "node-1", workflow_node_exists: false })).toBe(true);
    expect(hasDeletedWorkflowDeckNode({ workflow_node_id: null, workflow_node_exists: false })).toBe(false);
  });

  it("disables legacy mutations for workflow-backed decks only", () => {
    expect(deckAllowsLegacyMutation({ workflow_node_id: null, workflow_node_exists: null })).toBe(true);
    expect(deckAllowsLegacyMutation({ workflow_node_id: "node-1", workflow_node_exists: true })).toBe(false);
    expect(deckAllowsLegacyMutation({ workflow_node_id: "node-1", workflow_node_exists: false })).toBe(false);
  });

  it("chooses history accessory by workflow source state", () => {
    expect(
      deckHistoryAccessoryKind({ workflow_node_id: "node-1", workflow_node_exists: true }, true),
    ).toBe("openWorkflowNode");
    expect(
      deckHistoryAccessoryKind({ workflow_node_id: "node-1", workflow_node_exists: true }, false),
    ).toBe("workflowHint");
    expect(
      deckHistoryAccessoryKind({ workflow_node_id: "node-1", workflow_node_exists: false }, true),
    ).toBe("workflowDeleted");
    expect(
      deckHistoryAccessoryKind({ workflow_node_id: null, workflow_node_exists: null }, true),
    ).toBe("delete");
  });

  it("allows frontend PPTX export for generated slides or loaded slide images", () => {
    expect(
      deckSupportsFrontendPptxExport({
        generated_slide_count: 0,
        slides: [{ image_url: null }],
      }),
    ).toBe(false);
    expect(
      deckSupportsFrontendPptxExport({
        generated_slide_count: 2,
        slides: [{ image_url: null }],
      }),
    ).toBe(true);
    expect(
      deckSupportsFrontendPptxExport({
        generated_slide_count: 0,
        slides: [{ image_url: "/api/deck-slides/slide-1/image" }],
      }),
    ).toBe(true);
  });
});
