import { describe, expect, it, vi } from "vitest";

import { stopPropagationBoundary } from "./eventPropagation";

describe("stopPropagationBoundary", () => {
  it("uses nativeEvent.stopImmediatePropagation for React-style synthetic events", () => {
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const stopImmediatePropagation = vi.fn();

    stopPropagationBoundary(
      {
        preventDefault,
        stopPropagation,
        nativeEvent: {
          stopImmediatePropagation,
        },
      },
      { preventDefault: true, immediate: true },
    );

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(stopImmediatePropagation).toHaveBeenCalledOnce();
  });

  it("uses stopImmediatePropagation directly for native events", () => {
    const stopPropagation = vi.fn();
    const stopImmediatePropagation = vi.fn();

    stopPropagationBoundary(
      {
        stopPropagation,
        stopImmediatePropagation,
      },
      { immediate: true },
    );

    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(stopImmediatePropagation).toHaveBeenCalledOnce();
  });

  it("does not throw when the event only supports stopPropagation", () => {
    const stopPropagation = vi.fn();

    expect(() => stopPropagationBoundary({ stopPropagation }, { immediate: true })).not.toThrow();
    expect(stopPropagation).toHaveBeenCalledOnce();
  });
});
