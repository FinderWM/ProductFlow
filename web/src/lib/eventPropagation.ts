interface EventWithOptionalNative {
  nativeEvent?: unknown;
}

export interface PropagationBoundaryEvent extends EventWithOptionalNative {
  preventDefault?: () => void;
  stopPropagation?: () => void;
  stopImmediatePropagation?: () => void;
}

function nativeStopImmediatePropagation(event: EventWithOptionalNative): (() => void) | null {
  const nativeEvent = event.nativeEvent;
  if (!nativeEvent || typeof nativeEvent !== "object") {
    return null;
  }
  const stopImmediatePropagation = (nativeEvent as { stopImmediatePropagation?: unknown }).stopImmediatePropagation;
  return typeof stopImmediatePropagation === "function"
    ? stopImmediatePropagation.bind(nativeEvent)
    : null;
}

export function stopPropagationBoundary(
  event: PropagationBoundaryEvent,
  options: { preventDefault?: boolean; immediate?: boolean } = {},
): void {
  if (options.preventDefault) {
    event.preventDefault?.();
  }
  event.stopPropagation?.();
  if (!options.immediate) {
    return;
  }
  if (typeof event.stopImmediatePropagation === "function") {
    event.stopImmediatePropagation();
    return;
  }
  nativeStopImmediatePropagation(event)?.();
}
