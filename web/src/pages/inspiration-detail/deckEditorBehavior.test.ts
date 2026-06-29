import { describe, expect, it } from "vitest";

import { resolveDeckEditorAutoOpenDecision } from "./deckEditorBehavior";

describe("resolveDeckEditorAutoOpenDecision", () => {
  it("opens when a deck node is newly selected in details", () => {
    expect(
      resolveDeckEditorAutoOpenDecision({
        activeSidebarTab: "details",
        selectedNode: { id: "deck-1", node_type: "deck_generation" },
        lastAutoOpenedDeckNodeId: null,
      }),
    ).toEqual({
      action: "open",
      nextLastAutoOpenedDeckNodeId: "deck-1",
    });
  });

  it("stays idle after the same deck node has already auto-opened", () => {
    expect(
      resolveDeckEditorAutoOpenDecision({
        activeSidebarTab: "details",
        selectedNode: { id: "deck-1", node_type: "deck_generation" },
        lastAutoOpenedDeckNodeId: "deck-1",
      }),
    ).toEqual({
      action: "idle",
      nextLastAutoOpenedDeckNodeId: "deck-1",
    });
  });

  it("reopens when the user switches to a different deck node", () => {
    expect(
      resolveDeckEditorAutoOpenDecision({
        activeSidebarTab: "details",
        selectedNode: { id: "deck-2", node_type: "deck_generation" },
        lastAutoOpenedDeckNodeId: "deck-1",
      }),
    ).toEqual({
      action: "open",
      nextLastAutoOpenedDeckNodeId: "deck-2",
    });
  });

  it("closes and clears the remembered auto-open node outside details", () => {
    expect(
      resolveDeckEditorAutoOpenDecision({
        activeSidebarTab: "runs",
        selectedNode: { id: "deck-1", node_type: "deck_generation" },
        lastAutoOpenedDeckNodeId: "deck-1",
      }),
    ).toEqual({
      action: "close",
      nextLastAutoOpenedDeckNodeId: null,
    });
  });

  it("closes for non-deck selections", () => {
    expect(
      resolveDeckEditorAutoOpenDecision({
        activeSidebarTab: "details",
        selectedNode: { id: "node-1", node_type: "reference_image" },
        lastAutoOpenedDeckNodeId: "deck-1",
      }),
    ).toEqual({
      action: "close",
      nextLastAutoOpenedDeckNodeId: null,
    });
  });
});
