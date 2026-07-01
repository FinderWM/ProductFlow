import { describe, expect, it } from "vitest";

import { canScrollInDirection, shouldPreventScrollChain } from "./scrollChain";

type MockScrollNode = {
  parentNode: MockScrollNode | MockTargetNode | null;
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
};

type MockTargetNode = {
  parentNode: MockScrollNode | MockTargetNode | null;
};

function createScrollNode(
  metrics: Partial<Omit<MockScrollNode, "parentNode">>,
  parentNode: MockScrollNode | MockTargetNode | null = null,
): MockScrollNode {
  return {
    parentNode,
    scrollTop: metrics.scrollTop ?? 0,
    clientHeight: metrics.clientHeight ?? 0,
    scrollHeight: metrics.scrollHeight ?? 0,
    scrollLeft: metrics.scrollLeft ?? 0,
    clientWidth: metrics.clientWidth ?? 0,
    scrollWidth: metrics.scrollWidth ?? 0,
  };
}

function createTargetNode(parentNode: MockScrollNode | MockTargetNode | null): MockTargetNode {
  return { parentNode };
}

function createRoot(metrics: Partial<Omit<MockScrollNode, "parentNode">>) {
  const root = {
    ...createScrollNode(metrics),
    contains(node: MockScrollNode | MockTargetNode | null) {
      let current = node;
      while (current) {
        if (current === root) {
          return true;
        }
        current = current.parentNode;
      }
      return false;
    },
  };
  return root;
}

describe("scrollChain", () => {
  it("detects when an element can continue vertical scrolling", () => {
    const element = createScrollNode({
      scrollTop: 40,
      clientHeight: 120,
      scrollHeight: 400,
    });

    expect(canScrollInDirection(element, 0, -1)).toBe(true);
    expect(canScrollInDirection(element, 0, 1)).toBe(true);
  });

  it("prevents scroll chaining when the rail is already at the top boundary", () => {
    const rail = createRoot({
      scrollTop: 0,
      clientHeight: 180,
      scrollHeight: 420,
    });
    const button = createTargetNode(rail);

    expect(shouldPreventScrollChain(rail, button, 0, -80)).toBe(true);
  });

  it("allows the active rail to keep consuming wheel deltas while it can still scroll", () => {
    const rail = createRoot({
      scrollTop: 120,
      clientHeight: 180,
      scrollHeight: 420,
    });
    const button = createTargetNode(rail);

    expect(shouldPreventScrollChain(rail, button, 0, 80)).toBe(false);
  });

  it("respects nested scrollable regions before blocking the page", () => {
    const rail = createRoot({
      scrollTop: 0,
      clientHeight: 200,
      scrollHeight: 200,
    });
    const nestedScroller = createScrollNode({
      scrollTop: 24,
      clientHeight: 80,
      scrollHeight: 200,
    }, rail);
    const button = createTargetNode(nestedScroller);

    expect(shouldPreventScrollChain(rail, button, 0, -60)).toBe(false);
  });
});
