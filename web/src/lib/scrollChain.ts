export interface ScrollChainNodeLike {
  parentNode: ScrollChainNodeLike | null;
}

export interface ScrollChainContainerLike extends ScrollChainNodeLike {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}

export interface ScrollChainRootLike extends ScrollChainContainerLike {
  contains(node: ScrollChainNodeLike | null): boolean;
}

function isScrollChainNodeLike(value: unknown): value is ScrollChainNodeLike {
  return value !== null && typeof value === "object" && "parentNode" in value;
}

function isScrollChainContainerLike(value: unknown): value is ScrollChainContainerLike {
  if (!isScrollChainNodeLike(value)) {
    return false;
  }
  const candidate = value as Partial<ScrollChainContainerLike>;
  return (
    typeof candidate.scrollTop === "number" &&
    typeof candidate.clientHeight === "number" &&
    typeof candidate.scrollHeight === "number" &&
    typeof candidate.scrollLeft === "number" &&
    typeof candidate.clientWidth === "number" &&
    typeof candidate.scrollWidth === "number"
  );
}

export function canScrollInDirection(element: ScrollChainContainerLike, deltaX: number, deltaY: number): boolean {
  const canScrollY =
    deltaY < 0
      ? element.scrollTop > 0
      : deltaY > 0
        ? element.scrollTop + element.clientHeight < element.scrollHeight - 1
        : false;
  const canScrollX =
    deltaX < 0
      ? element.scrollLeft > 0
      : deltaX > 0
        ? element.scrollLeft + element.clientWidth < element.scrollWidth - 1
        : false;
  return canScrollX || canScrollY;
}

export function shouldPreventScrollChain(
  root: ScrollChainRootLike | null,
  target: EventTarget | ScrollChainNodeLike | null,
  deltaX: number,
  deltaY: number,
): boolean {
  if (!root || !isScrollChainNodeLike(target)) {
    return true;
  }
  let node: ScrollChainNodeLike | null = target;
  while (node && node !== root.parentNode) {
    if (isScrollChainContainerLike(node) && root.contains(node) && canScrollInDirection(node, deltaX, deltaY)) {
      return false;
    }
    if (node === root) {
      break;
    }
    node = node.parentNode;
  }
  return true;
}
