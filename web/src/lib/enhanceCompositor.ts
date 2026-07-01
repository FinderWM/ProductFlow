import { api } from "./api";
import type { EnhanceResultManifest, EnhanceTileManifest } from "./types";

export interface EnhanceCompositeOptions {
  outputType?: string;
  quality?: number;
  maxPixels?: number;
}

const DEFAULT_MAX_PIXELS = 8192 * 8192;

export function enhanceFinalSize(manifest: EnhanceResultManifest): { width: number; height: number } {
  const sourceWidth = positiveInteger(manifest.source_w) || positiveInteger(manifest.source?.width);
  const sourceHeight = positiveInteger(manifest.source_h) || positiveInteger(manifest.source?.height);
  const width = positiveInteger(manifest.final_width) || positiveInteger(manifest.final_w) || sourceWidth * positiveInteger(manifest.scale);
  const height =
    positiveInteger(manifest.final_height) || positiveInteger(manifest.final_h) || sourceHeight * positiveInteger(manifest.scale);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Invalid enhance manifest final size");
  }
  return { width, height };
}

export function enhanceTileCallCount(manifest: EnhanceResultManifest): number {
  const rows = positiveInteger(manifest.rows);
  const cols = positiveInteger(manifest.cols);
  if (rows && cols) {
    return rows * cols;
  }
  return manifest.tiles.length;
}

export function estimateEnhanceTileCallCount(input: {
  sourceWidth: number;
  sourceHeight: number;
  scale: number;
  tileBaseSize: number;
}): number | null {
  const sourceWidth = positiveInteger(input.sourceWidth);
  const sourceHeight = positiveInteger(input.sourceHeight);
  const scale = positiveInteger(input.scale);
  const tileBaseSize = positiveInteger(input.tileBaseSize);
  if (!sourceWidth || !sourceHeight || !scale || !tileBaseSize) {
    return null;
  }
  const finalWidth = sourceWidth * scale;
  const finalHeight = sourceHeight * scale;
  return Math.ceil(finalWidth / tileBaseSize) * Math.ceil(finalHeight / tileBaseSize);
}

export async function compositeEnhanceTiles(
  manifest: EnhanceResultManifest,
  options: EnhanceCompositeOptions = {},
): Promise<Blob> {
  const { width, height } = enhanceFinalSize(manifest);
  const maxPixels = options.maxPixels ?? DEFAULT_MAX_PIXELS;
  if (width * height > maxPixels) {
    throw new Error("Enhance final image is too large for browser composition");
  }
  if (!manifest.tiles.length) {
    throw new Error("Enhance manifest has no tiles");
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D context is unavailable");
  }
  ctx.clearRect(0, 0, width, height);

  const tiles = [...manifest.tiles].sort((left, right) => left.row - right.row || left.col - right.col);
  for (const tile of tiles) {
    await drawTile(ctx, tile, manifest.overlap_pct ?? 10);
  }

  return canvasToBlob(canvas, options.outputType ?? "image/png", options.quality);
}

async function drawTile(ctx: CanvasRenderingContext2D, tile: EnhanceTileManifest, overlapPct: number): Promise<void> {
  if (!tile.download_url) {
    throw new Error(`Enhance tile ${tile.row},${tile.col} has no download URL`);
  }
  const targetWidth = positiveInteger(tile.target_width);
  const targetHeight = positiveInteger(tile.target_height);
  if (!targetWidth || !targetHeight) {
    throw new Error(`Enhance tile ${tile.row},${tile.col} has invalid geometry`);
  }

  const image = await loadImage(api.toApiUrl(tile.download_url));
  const tileCanvas = document.createElement("canvas");
  tileCanvas.width = targetWidth;
  tileCanvas.height = targetHeight;
  const tileCtx = tileCanvas.getContext("2d");
  if (!tileCtx) {
    throw new Error("Canvas 2D context is unavailable");
  }

  tileCtx.drawImage(image, 0, 0, targetWidth, targetHeight);
  applyBlendMask(tileCtx, tile, overlapPct);
  ctx.drawImage(tileCanvas, tile.target_x, tile.target_y, targetWidth, targetHeight);
}

export function applyBlendMask(
  ctx: CanvasRenderingContext2D,
  tile: Pick<EnhanceTileManifest, "blend_edges" | "target_width" | "target_height">,
  overlapPct: number,
): void {
  if (!tile.blend_edges.length) {
    return;
  }
  const width = positiveInteger(tile.target_width);
  const height = positiveInteger(tile.target_height);
  if (!width || !height) {
    return;
  }
  const horizontalFeather = featherSize(width, overlapPct);
  const verticalFeather = featherSize(height, overlapPct);

  ctx.save();
  ctx.globalCompositeOperation = "destination-in";
  for (const edge of tile.blend_edges) {
    const gradient =
      edge === "left" || edge === "right"
        ? ctx.createLinearGradient(edge === "left" ? 0 : width, 0, edge === "left" ? horizontalFeather : width - horizontalFeather, 0)
        : ctx.createLinearGradient(0, edge === "top" ? 0 : height, 0, edge === "top" ? verticalFeather : height - verticalFeather);
    gradient.addColorStop(0, "rgba(0,0,0,0)");
    gradient.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = gradient;
    if (edge === "left") {
      ctx.fillRect(0, 0, horizontalFeather, height);
    } else if (edge === "right") {
      ctx.fillRect(width - horizontalFeather, 0, horizontalFeather, height);
    } else if (edge === "top") {
      ctx.fillRect(0, 0, width, verticalFeather);
    } else {
      ctx.fillRect(0, height - verticalFeather, width, verticalFeather);
    }
  }
  ctx.restore();
}

function featherSize(size: number, overlapPct: number): number {
  const pct = Number.isFinite(overlapPct) ? Math.max(0, Math.min(50, overlapPct)) : 10;
  return Math.max(1, Math.min(Math.floor(size / 2), Math.round(size * (pct / 100))));
}

function positiveInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Enhance tile image failed to load"));
    image.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error("Enhance canvas export failed"));
      },
      type,
      quality,
    );
  });
}
