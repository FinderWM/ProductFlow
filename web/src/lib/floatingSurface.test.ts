import { describe, expect, it } from "vitest";

import {
  FLOATING_LAYER_Z_INDEX,
  FLOATING_TOUCH_DISMISS_PROTECTION_DURATION_MS,
  createFloatingTouchDismissProtection,
  isFloatingTouchDismissProtectionHit,
  placeFloatingSurface,
  viewportFromVisualViewport,
} from "./floatingSurface";

describe("floating surface placement", () => {
  it("keeps the layer token order stable", () => {
    expect(FLOATING_LAYER_Z_INDEX).toEqual({
      nav: 30,
      stickyAction: 40,
      popover: 50,
      drawerOverlay: 60,
      drawer: 70,
      modalOverlay: 80,
      modal: 90,
      toast: 100,
    });
  });

  it("places below the trigger when there is enough room", () => {
    expect(
      placeFloatingSurface({
        triggerRect: { x: 80, y: 100, width: 140, height: 40 },
        surfaceSize: { width: 160, height: 200 },
        viewport: { x: 0, y: 0, width: 500, height: 600 },
      }),
    ).toEqual({
      left: 80,
      top: 146,
      width: 160,
      maxHeight: 446,
      placement: "bottom-start",
    });
  });

  it("flips to top when bottom space is constrained by the visual viewport", () => {
    const result = placeFloatingSurface({
      triggerRect: { x: 80, y: 520, width: 140, height: 40 },
      surfaceSize: { width: 160, height: 220 },
      viewport: { x: 0, y: 0, width: 500, height: 600 },
      preferredPlacement: "bottom-start",
    });
    expect(result.placement).toBe("top-start");
    expect(result.top).toBe(294);
    expect(result.maxHeight).toBe(506);
  });

  it("flips to bottom when preferred top space is too small", () => {
    const result = placeFloatingSurface({
      triggerRect: { x: 80, y: 18, width: 140, height: 40 },
      surfaceSize: { width: 160, height: 220 },
      viewport: { x: 0, y: 0, width: 500, height: 600 },
      preferredPlacement: "top-start",
    });
    expect(result.placement).toBe("bottom-start");
    expect(result.top).toBe(64);
  });

  it("shifts left and clamps width near the right edge", () => {
    const result = placeFloatingSurface({
      triggerRect: { x: 460, y: 120, width: 80, height: 36 },
      surfaceSize: { width: 240, height: 160 },
      viewport: { x: 0, y: 0, width: 520, height: 600 },
      preferredPlacement: "bottom-start",
    });
    expect(result.left).toBe(272);
    expect(result.width).toBe(240);
  });

  it("shifts right near the left visual viewport edge", () => {
    const result = placeFloatingSurface({
      triggerRect: { x: -20, y: 120, width: 80, height: 36 },
      surfaceSize: { width: 180, height: 160 },
      viewport: { x: 0, y: 0, width: 520, height: 600 },
      preferredPlacement: "bottom-start",
    });
    expect(result.left).toBe(8);
  });

  it("uses available height as max height for long content", () => {
    const result = placeFloatingSurface({
      triggerRect: { x: 80, y: 300, width: 140, height: 40 },
      surfaceSize: { width: 160, height: 900 },
      viewport: { x: 0, y: 0, width: 500, height: 600 },
      preferredPlacement: "bottom-start",
    });
    expect(result.placement).toBe("top-start");
    expect(result.maxHeight).toBe(286);
    expect(result.top).toBe(8);
  });

  it("honors visual viewport offsets from mobile chrome or zoom", () => {
    const viewport = viewportFromVisualViewport(
      { offsetLeft: 12, offsetTop: 64, width: 390, height: 520 },
      1024,
      768,
    );
    const result = placeFloatingSurface({
      triggerRect: { x: 360, y: 520, width: 80, height: 36 },
      surfaceSize: { width: 220, height: 240 },
      viewport,
      preferredPlacement: "bottom-end",
    });
    expect(viewport).toEqual({ x: 12, y: 64, width: 390, height: 520 });
    expect(result.left).toBe(174);
    expect(result.top).toBe(274);
    expect(result.placement).toBe("top-end");
  });

  it("creates touch dismiss protection from the triggering tap point", () => {
    expect(createFloatingTouchDismissProtection({ x: 128, y: 256 }, 1_000)).toEqual({
      x: 128,
      y: 256,
      expiresAt: 1_000 + FLOATING_TOUCH_DISMISS_PROTECTION_DURATION_MS,
    });
  });

  it("suppresses only nearby touch-dismiss ghost taps before expiry", () => {
    const protection = createFloatingTouchDismissProtection({ x: 100, y: 200 }, 5_000);
    expect(isFloatingTouchDismissProtectionHit(protection, { x: 116, y: 212 }, 5_100)).toBe(true);
    expect(isFloatingTouchDismissProtectionHit(protection, { x: 160, y: 260 }, 5_100)).toBe(false);
    expect(
      isFloatingTouchDismissProtectionHit(
        protection,
        { x: 100, y: 200 },
        5_000 + FLOATING_TOUCH_DISMISS_PROTECTION_DURATION_MS + 1,
      ),
    ).toBe(false);
  });
});
