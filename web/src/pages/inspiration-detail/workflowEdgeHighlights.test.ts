import { describe, expect, it } from "vitest";

import { buildWorkflowEdgeTraceMap, SELECTED_WORKFLOW_EDGE_TRACE_COLOR } from "./workflowEdgeHighlights";

function node(id: string, status: "idle" | "running" = "idle") {
  return { id, status };
}

function edge(id: string, sourceNodeId: string, targetNodeId: string) {
  return {
    id,
    source_node_id: sourceNodeId,
    target_node_id: targetNodeId,
  };
}

describe("workflow edge highlights", () => {
  it("marks every recursive upstream edge for a single selected node", () => {
    const traceMap = buildWorkflowEdgeTraceMap(
      {
        nodes: [node("a"), node("b"), node("c"), node("d"), node("e")],
        edges: [
          edge("a-b", "a", "b"),
          edge("b-c", "b", "c"),
          edge("a-d", "a", "d"),
          edge("d-c", "d", "c"),
          edge("c-e", "c", "e"),
        ],
      },
      { selectedNodeId: "c", selectedNodeIds: ["c"] },
    );

    expect(Object.keys(traceMap).sort()).toEqual(["a-b", "a-d", "b-c", "d-c"]);
    expect(traceMap["a-b"]).toEqual({
      kind: "selected",
      color: SELECTED_WORKFLOW_EDGE_TRACE_COLOR,
      targetNodeId: "c",
    });
  });

  it("does not mark selected traces during multi-select", () => {
    const traceMap = buildWorkflowEdgeTraceMap(
      {
        nodes: [node("a"), node("b"), node("c")],
        edges: [edge("a-b", "a", "b"), edge("b-c", "b", "c")],
      },
      { selectedNodeId: "c", selectedNodeIds: ["b", "c"] },
    );

    expect(traceMap).toEqual({});
  });

  it("keeps running node upstream traces animated with unique node colors", () => {
    const traceMap = buildWorkflowEdgeTraceMap(
      {
        nodes: [node("a"), node("b"), node("c", "running"), node("d", "running")],
        edges: [edge("a-b", "a", "b"), edge("b-c", "b", "c"), edge("c-d", "c", "d")],
      },
      { selectedNodeId: null, selectedNodeIds: [] },
    );

    expect(traceMap["b-c"].kind).toBe("running");
    expect(traceMap["c-d"].kind).toBe("running");
    expect(traceMap["b-c"].color).not.toBe(traceMap["c-d"].color);
  });

  it("lets running traces override selected traces on shared upstream edges", () => {
    const traceMap = buildWorkflowEdgeTraceMap(
      {
        nodes: [node("a"), node("b"), node("c", "running")],
        edges: [edge("a-b", "a", "b"), edge("b-c", "b", "c")],
      },
      { selectedNodeId: "c", selectedNodeIds: ["c"] },
    );

    expect(traceMap["a-b"].kind).toBe("running");
    expect(traceMap["b-c"].kind).toBe("running");
  });

  it("terminates when the graph contains a cycle", () => {
    const traceMap = buildWorkflowEdgeTraceMap(
      {
        nodes: [node("a"), node("b")],
        edges: [edge("a-b", "a", "b"), edge("b-a", "b", "a")],
      },
      { selectedNodeId: "b", selectedNodeIds: ["b"] },
    );

    expect(Object.keys(traceMap).sort()).toEqual(["a-b", "b-a"]);
  });
});
