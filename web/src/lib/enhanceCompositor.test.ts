import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyBlendMask,
  compositeEnhanceTiles,
  enhanceFinalSize,
  enhanceTileCallCount,
  estimateEnhanceTileCallCount,
} from "./enhanceCompositor";
import type { EnhanceResultManifest } from "./types";

function manifest(overrides: Partial<EnhanceResultManifest> = {}): EnhanceResultManifest {
  return {
    scale: 2,
    source_w: 1000,
    source_h: 500,
    final_w: 2000,
    final_h: 1000,
    overlap_pct: 10,
    rows: 1,
    cols: 2,
    final_status: "pending_upload",
    final_download_url: null,
    tiles: [
      {
        row: 0,
        col: 0,
        rows: 1,
        cols: 2,
        storage_key: "enhance/job/tile-0-0.png",
        download_url: "/api/enhance-jobs/job/tiles/0/0",
        target_x: 0,
        target_y: 0,
        target_width: 1000,
        target_height: 1000,
        blend_edges: ["right"],
        width: 1000,
        height: 1000,
      },
      {
        row: 0,
        col: 1,
        rows: 1,
        cols: 2,
        storage_key: "enhance/job/tile-0-1.png",
        download_url: "/api/enhance-jobs/job/tiles/0/1",
        target_x: 1000,
        target_y: 0,
        target_width: 1000,
        target_height: 1000,
        blend_edges: ["left"],
        width: 1000,
        height: 1000,
      },
    ],
    ...overrides,
  };
}

describe("enhanceCompositor", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves explicit and derived final sizes", () => {
    expect(enhanceFinalSize(manifest())).toEqual({ width: 2000, height: 1000 });
    expect(enhanceFinalSize(manifest({ final_width: 2400, final_height: 1200 }))).toEqual({
      width: 2400,
      height: 1200,
    });
    expect(enhanceFinalSize(manifest({ final_w: undefined, final_h: undefined }))).toEqual({
      width: 2000,
      height: 1000,
    });
    expect(
      enhanceFinalSize(
        manifest({
          source_w: undefined,
          source_h: undefined,
          final_w: undefined,
          final_h: undefined,
          source: { width: 1000, height: 500 },
        }),
      ),
    ).toEqual({
      width: 2000,
      height: 1000,
    });
  });

  it("uses rows and cols for provider call count when present", () => {
    expect(enhanceTileCallCount(manifest({ rows: 4, cols: 4, tiles: [] }))).toBe(16);
    expect(enhanceTileCallCount(manifest({ rows: undefined, cols: undefined }))).toBe(2);
  });

  it("estimates provider calls from source size, scale, and tile size", () => {
    expect(estimateEnhanceTileCallCount({ sourceWidth: 1000, sourceHeight: 500, scale: 2, tileBaseSize: 1024 })).toBe(2);
    expect(estimateEnhanceTileCallCount({ sourceWidth: 2048, sourceHeight: 2048, scale: 2, tileBaseSize: 1024 })).toBe(16);
    expect(estimateEnhanceTileCallCount({ sourceWidth: 2048, sourceHeight: 2048, scale: 4, tileBaseSize: 1024 })).toBe(64);
    expect(estimateEnhanceTileCallCount({ sourceWidth: 0, sourceHeight: 2048, scale: 4, tileBaseSize: 1024 })).toBeNull();
  });

  it("applies blend masks to requested edges", () => {
    const addColorStop = vi.fn();
    const fillRect = vi.fn();
    const ctx = {
      save: vi.fn(),
      restore: vi.fn(),
      createLinearGradient: vi.fn(() => ({ addColorStop })),
      fillRect,
      set globalCompositeOperation(_value: string) {},
      set fillStyle(_value: unknown) {},
    } as unknown as CanvasRenderingContext2D;

    applyBlendMask(ctx, { blend_edges: ["left", "bottom"], target_width: 1000, target_height: 500 }, 10);

    expect(ctx.createLinearGradient).toHaveBeenCalledTimes(2);
    expect(addColorStop).toHaveBeenCalledTimes(4);
    expect(fillRect).toHaveBeenCalledWith(0, 0, 100, 500);
    expect(fillRect).toHaveBeenCalledWith(0, 450, 1000, 50);
  });

  it("composites a four-tile manifest into a PNG blob", async () => {
    const drawImage = vi.fn();
    const fillRect = vi.fn();
    const addColorStop = vi.fn();
    const createLinearGradient = vi.fn(() => ({ addColorStop }));
    const getContext = vi.fn(() => ({
      clearRect: vi.fn(),
      drawImage,
      save: vi.fn(),
      restore: vi.fn(),
      createLinearGradient,
      fillRect,
      set globalCompositeOperation(_value: string) {},
      set fillStyle(_value: unknown) {},
    }));
    const toBlob = vi.fn((callback: (blob: Blob | null) => void) => {
      callback(new Blob(["png"], { type: "image/png" }));
    });
    const createElement = vi.fn(() => ({
      width: 0,
      height: 0,
      getContext,
      toBlob,
    }));
    class MockImage {
      crossOrigin = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        this.onload?.();
      }
    }
    vi.stubGlobal("document", { createElement });
    vi.stubGlobal("Image", MockImage);

    const blob = await compositeEnhanceTiles(
      manifest({
        final_w: 2048,
        final_h: 2048,
        rows: 2,
        cols: 2,
        tiles: [0, 1].flatMap((row) =>
          [0, 1].map((col) => ({
            row,
            col,
            rows: 2,
            cols: 2,
            storage_key: `enhance/job/tile-${row}-${col}.png`,
            download_url: `/api/enhance-jobs/job/tiles/${row}/${col}`,
            target_x: col * 1024,
            target_y: row * 1024,
            target_width: 1024,
            target_height: 1024,
            blend_edges: [
              ...(col > 0 ? (["left"] as const) : []),
              ...(col < 1 ? (["right"] as const) : []),
              ...(row > 0 ? (["top"] as const) : []),
              ...(row < 1 ? (["bottom"] as const) : []),
            ],
            width: 1024,
            height: 1024,
          })),
        ),
      }),
    );

    expect(blob.type).toBe("image/png");
    expect(blob.size).toBeGreaterThan(0);
    expect(createElement).toHaveBeenCalledWith("canvas");
    expect(drawImage).toHaveBeenCalledTimes(8);
    expect(createLinearGradient).toHaveBeenCalled();
    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/png", undefined);
  });

  it("rejects browser composition when final pixels exceed the configured limit", async () => {
    await expect(
      compositeEnhanceTiles(
        manifest({
          final_w: 8192,
          final_h: 8192,
          rows: 8,
          cols: 8,
        }),
        { maxPixels: 4096 * 4096 },
      ),
    ).rejects.toThrow("Enhance final image is too large");
  });
});
