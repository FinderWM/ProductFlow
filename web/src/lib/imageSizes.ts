import { DEFAULT_LOCALE, translate, type Locale } from "./i18n";

export interface ImageSizeOption {
  value: string;
  label: string;
  description: string;
  aspect: string;
}

export interface ImageSizePresetDefinition {
  aspect: string;
  value: string;
  tierLabel?: string;
}

export interface ImageAspectValue {
  widthRatio: number;
  heightRatio: number;
  value: string;
}

export interface ImageAspectOption {
  value: string;
  label: string;
  description: string;
}

export interface ImageSizeResolution {
  width: number;
  height: number;
  value: string;
  calibrated: boolean;
}

export interface ImageSizePresetDisplay {
  aspectLabel: string;
  tierLabel: string;
  dimensionLabel: string;
}

export const IMAGE_SIZE_PATTERN = /^\d+x\d+$/;
export const DEFAULT_IMAGE_GENERATION_MAX_DIMENSION = 3840;
export const IMAGE_GENERATION_MIN_DIMENSION = 512;
export const IMAGE_GENERATION_DIMENSION_MULTIPLE = 16;
export const IMAGE_GENERATION_MIN_MAX_DIMENSION = 512;
export const IMAGE_GENERATION_MAX_MAX_DIMENSION = 8192;
export const IMAGE_GENERATION_MAX_DIMENSION = DEFAULT_IMAGE_GENERATION_MAX_DIMENSION;
export const IMAGE_GENERATION_MAX_PIXELS = 8_294_400;
export const IMAGE_GENERATION_MAX_ASPECT_RATIO = 3;

const BUILT_IN_IMAGE_ASPECT_ORDER = ["1:1", "4:5", "5:4", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "7:3"];
const IMAGE_ASPECT_DISPLAY_ALIASES: Record<string, string> = {
  "7:3": "21:9",
};
const CUSTOM_ASPECT_SCALE_STEPS = [128, 256, 384, 512, 768];

export const DEFAULT_IMAGE_SIZE_PRESET_DEFINITIONS: readonly ImageSizePresetDefinition[] = [
  { aspect: "1:1", value: "1024x1024" },
  { aspect: "1:1", value: "1536x1536" },
  { aspect: "1:1", value: "2048x2048" },
  { aspect: "1:1", value: "2880x2880", tierLabel: "2.8K" },
  { aspect: "4:5", value: "1024x1280" },
  { aspect: "4:5", value: "1536x1920" },
  { aspect: "4:5", value: "2048x2560" },
  { aspect: "4:5", value: "2560x3200" },
  { aspect: "5:4", value: "1280x1024" },
  { aspect: "5:4", value: "1920x1536" },
  { aspect: "5:4", value: "2560x2048" },
  { aspect: "5:4", value: "3200x2560" },
  { aspect: "2:3", value: "1024x1536" },
  { aspect: "2:3", value: "1280x1920" },
  { aspect: "2:3", value: "1536x2304" },
  { aspect: "2:3", value: "2048x3072" },
  { aspect: "3:2", value: "1536x1024" },
  { aspect: "3:2", value: "1920x1280" },
  { aspect: "3:2", value: "2304x1536" },
  { aspect: "3:2", value: "3072x2048" },
  { aspect: "3:4", value: "768x1024" },
  { aspect: "3:4", value: "1152x1536" },
  { aspect: "3:4", value: "1536x2048" },
  { aspect: "3:4", value: "2304x3072" },
  { aspect: "4:3", value: "1024x768" },
  { aspect: "4:3", value: "1536x1152" },
  { aspect: "4:3", value: "2048x1536" },
  { aspect: "4:3", value: "3072x2304" },
  { aspect: "9:16", value: "720x1280", tierLabel: "HD" },
  { aspect: "9:16", value: "1152x2048" },
  { aspect: "9:16", value: "1440x2560", tierLabel: "2.5K" },
  { aspect: "9:16", value: "2160x3840" },
  { aspect: "16:9", value: "1024x576" },
  { aspect: "16:9", value: "1280x720", tierLabel: "HD" },
  { aspect: "16:9", value: "2048x1152" },
  { aspect: "16:9", value: "2560x1440" },
  { aspect: "16:9", value: "3840x2160" },
  { aspect: "7:3", value: "1344x576" },
  { aspect: "7:3", value: "1792x768" },
  { aspect: "7:3", value: "2688x1152" },
  { aspect: "7:3", value: "3360x1440" },
];

function buildImageSizeOptionFromDefinition(definition: ImageSizePresetDefinition): ImageSizeOption {
  return builtInImageSizeOption(definition.aspect, definition.value, definition.tierLabel);
}

const BUILT_IN_IMAGE_SIZE_OPTIONS: ImageSizeOption[] = DEFAULT_IMAGE_SIZE_PRESET_DEFINITIONS.map(
  buildImageSizeOptionFromDefinition,
);

function builtInImageSizeOption(aspect: string, value: string, tierLabel?: string): ImageSizeOption {
  const parsed = parseImageSizeValue(value, DEFAULT_IMAGE_GENERATION_MAX_DIMENSION);
  const kindLabel = parsed && parsed.width === parsed.height
    ? "方图"
    : parsed && parsed.width < parsed.height
      ? "竖图"
      : "横图";
  const resolvedTierLabel = tierLabel ?? (parsed ? imageSizeTierLabel(parsed.width, parsed.height) : value);
  return {
    label: `${kindLabel} · ${resolvedTierLabel}`,
    description: `${formatImageAspectValue(aspect)} · ${formatImageSizeValue(value)}`,
    aspect,
    value,
  };
}

function normalizeMaxDimension(maxDimension?: number): number {
  if (!Number.isFinite(maxDimension)) {
    return DEFAULT_IMAGE_GENERATION_MAX_DIMENSION;
  }
  const rounded = Math.round(maxDimension ?? DEFAULT_IMAGE_GENERATION_MAX_DIMENSION);
  return Math.min(IMAGE_GENERATION_MAX_MAX_DIMENSION, Math.max(IMAGE_GENERATION_MIN_MAX_DIMENSION, rounded));
}

function imageGenerationMaxDimensionMultiple(maxDimension: number): number {
  return maxDimension - (maxDimension % IMAGE_GENERATION_DIMENSION_MULTIPLE);
}

function nearestImageGenerationDimensionMultiple(value: number, maxDimension: number): number {
  const lower = Math.floor(value / IMAGE_GENERATION_DIMENSION_MULTIPLE) * IMAGE_GENERATION_DIMENSION_MULTIPLE;
  const upper = lower + IMAGE_GENERATION_DIMENSION_MULTIPLE;
  const candidates = [lower, upper].filter(
    (candidate) => candidate >= IMAGE_GENERATION_MIN_DIMENSION && candidate <= maxDimension,
  );
  if (candidates.length > 0) {
    return candidates.sort((left, right) => Math.abs(left - value) - Math.abs(right - value) || left - right)[0];
  }
  return value < IMAGE_GENERATION_MIN_DIMENSION ? IMAGE_GENERATION_MIN_DIMENSION : maxDimension;
}

function constrainImageGenerationAspectRatio(width: number, height: number): { width: number; height: number } {
  if (width <= 0 || height <= 0) {
    return { width, height };
  }
  const ratio = Math.max(width, height) / Math.min(width, height);
  if (ratio <= IMAGE_GENERATION_MAX_ASPECT_RATIO) {
    return { width, height };
  }
  if (width >= height) {
    return { width, height: Math.max(height, Math.round(width / IMAGE_GENERATION_MAX_ASPECT_RATIO)) };
  }
  return { width: Math.max(width, Math.round(height / IMAGE_GENERATION_MAX_ASPECT_RATIO)), height };
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a || 1;
}

function reduceImageAspect(width: number, height: number): ImageAspectValue | null {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  const divisor = greatestCommonDivisor(width, height);
  const widthRatio = width / divisor;
  const heightRatio = height / divisor;
  return {
    widthRatio,
    heightRatio,
    value: `${widthRatio}:${heightRatio}`,
  };
}

export function normalizeImageSizeValue(value: string, maxDimension?: number): string | null {
  const normalized = value.trim().toLowerCase();
  return IMAGE_SIZE_PATTERN.test(normalized) ? normalizeImageSizeDimensions(normalized, maxDimension) : null;
}

export function parseImageSizeValue(value: string, maxDimension?: number): { width: number; height: number } | null {
  const normalized = normalizeImageSizeValue(value, maxDimension);
  if (!normalized) {
    return null;
  }
  const [width, height] = normalized.split("x", 2).map(Number);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

export function resolveImageSize(width: number, height: number, maxDimension?: number): ImageSizeResolution | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  const requestedWidth = Math.round(width);
  const requestedHeight = Math.round(height);
  if (requestedWidth <= 0 || requestedHeight <= 0) {
    return null;
  }
  const resolvedMaxDimension = imageGenerationMaxDimensionMultiple(normalizeMaxDimension(maxDimension));
  const maxPixels = Math.min(IMAGE_GENERATION_MAX_PIXELS, resolvedMaxDimension * resolvedMaxDimension);

  const aspectConstrained = constrainImageGenerationAspectRatio(requestedWidth, requestedHeight);
  let scale = Math.min(1, resolvedMaxDimension / aspectConstrained.width, resolvedMaxDimension / aspectConstrained.height);
  const dimensionCalibrated = scale < 1;
  let resolvedWidth = Math.min(
    resolvedMaxDimension,
    Math.max(IMAGE_GENERATION_MIN_DIMENSION, Math.round(aspectConstrained.width * scale)),
  );
  let resolvedHeight = Math.min(
    resolvedMaxDimension,
    Math.max(IMAGE_GENERATION_MIN_DIMENSION, Math.round(aspectConstrained.height * scale)),
  );

  const resolvedPixels = resolvedWidth * resolvedHeight;
  let pixelCalibrated = false;
  if (resolvedPixels > maxPixels) {
    scale = Math.sqrt(maxPixels / resolvedPixels);
    resolvedWidth = Math.max(1, Math.floor(resolvedWidth * scale));
    resolvedHeight = Math.max(1, Math.floor(resolvedHeight * scale));
    pixelCalibrated = true;
  }
  resolvedWidth = nearestImageGenerationDimensionMultiple(resolvedWidth, resolvedMaxDimension);
  resolvedHeight = nearestImageGenerationDimensionMultiple(resolvedHeight, resolvedMaxDimension);
  if (resolvedWidth * resolvedHeight > maxPixels) {
    scale = Math.sqrt(maxPixels / (resolvedWidth * resolvedHeight));
    resolvedWidth = nearestImageGenerationDimensionMultiple(
      Math.max(IMAGE_GENERATION_MIN_DIMENSION, Math.floor(resolvedWidth * scale)),
      resolvedMaxDimension,
    );
    resolvedHeight = nearestImageGenerationDimensionMultiple(
      Math.max(IMAGE_GENERATION_MIN_DIMENSION, Math.floor(resolvedHeight * scale)),
      resolvedMaxDimension,
    );
  }

  const value = `${resolvedWidth}x${resolvedHeight}`;
  return {
    width: resolvedWidth,
    height: resolvedHeight,
    value,
    calibrated:
      dimensionCalibrated ||
      pixelCalibrated ||
      aspectConstrained.width !== requestedWidth ||
      aspectConstrained.height !== requestedHeight ||
      value !== `${requestedWidth}x${requestedHeight}`,
  };
}

export function normalizeImageSizeDimensions(value: string, maxDimension?: number): string | null {
  const [widthRaw, heightRaw] = value.trim().toLowerCase().split("x", 2);
  if (!/^\d+$/.test(widthRaw) || !/^\d+$/.test(heightRaw)) {
    return null;
  }
  const resolution = resolveImageSize(Number(widthRaw), Number(heightRaw), maxDimension);
  return resolution?.value ?? null;
}

export function imageSizeValueFromDimensions(
  width: number | string,
  height: number | string,
  maxDimension?: number,
): string | null {
  const widthText = typeof width === "number" ? String(width) : width.trim();
  const heightText = typeof height === "number" ? String(height) : height.trim();
  if (!/^\d+$/.test(widthText) || !/^\d+$/.test(heightText)) {
    return null;
  }
  return resolveImageSize(Number(widthText), Number(heightText), maxDimension)?.value ?? null;
}

export function parseImageAspectValue(value: string): ImageAspectValue | null {
  const match = value.trim().toLowerCase().match(/^(\d+)\s*[:/x×]\s*(\d+)$/u);
  if (!match) {
    return null;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  return reduceImageAspect(width, height);
}

export function isImageAspectWithinBounds(value: string): boolean {
  const aspect = parseImageAspectValue(value);
  if (!aspect) {
    return false;
  }
  return Math.max(aspect.widthRatio, aspect.heightRatio) / Math.min(aspect.widthRatio, aspect.heightRatio) <=
    IMAGE_GENERATION_MAX_ASPECT_RATIO;
}

export function aspectFromImageSize(value: string, maxDimension?: number): string | null {
  const parsed = parseImageSizeValue(value, maxDimension);
  if (!parsed) {
    return null;
  }
  return reduceImageAspect(parsed.width, parsed.height)?.value ?? null;
}

export function buildImageSizeOptions(
  maxDimension?: number,
  presetDefinitions: readonly ImageSizePresetDefinition[] = DEFAULT_IMAGE_SIZE_PRESET_DEFINITIONS,
): ImageSizeOption[] {
  return presetDefinitions.map(buildImageSizeOptionFromDefinition).filter((option) => {
    const parsed = parseImageSizeValue(option.value, DEFAULT_IMAGE_GENERATION_MAX_DIMENSION);
    if (!parsed) {
      return false;
    }
    const resolved = resolveImageSize(parsed.width, parsed.height, maxDimension);
    return resolved?.value === option.value && !resolved.calibrated;
  });
}

export const DEFAULT_IMAGE_SIZE_OPTIONS: ImageSizeOption[] = buildImageSizeOptions(DEFAULT_IMAGE_GENERATION_MAX_DIMENSION);

function imageSizeTierLabel(width: number, height: number): string {
  const longEdge = Math.max(width, height);
  if (longEdge >= 3840) {
    return "4K";
  }
  if (longEdge >= 3072) {
    return "3K";
  }
  if (longEdge >= 2048) {
    return "2K";
  }
  if (longEdge >= 1536) {
    return "1.5K";
  }
  if (longEdge >= 1024) {
    return "1K";
  }
  return `${longEdge}px`;
}

function imageAspectSortIndex(aspect: string): number {
  const index = BUILT_IN_IMAGE_ASPECT_ORDER.indexOf(aspect);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export function formatImageAspectValue(value: string): string {
  const parsed = parseImageAspectValue(value);
  const normalized = parsed?.value ?? value;
  return IMAGE_ASPECT_DISPLAY_ALIASES[normalized] ?? normalized;
}

export function buildImageAspectOptions(presets: ImageSizeOption[] = DEFAULT_IMAGE_SIZE_OPTIONS): ImageAspectOption[] {
  const discovered = new Set<string>();
  for (const aspect of BUILT_IN_IMAGE_ASPECT_ORDER) {
    discovered.add(aspect);
  }
  for (const option of presets) {
    const aspect = parseImageAspectValue(option.aspect)?.value ?? aspectFromImageSize(option.value);
    if (aspect) {
      discovered.add(aspect);
    }
  }
  return Array.from(discovered)
    .sort((left, right) => imageAspectSortIndex(left) - imageAspectSortIndex(right) || left.localeCompare(right))
    .map((aspect) => ({
      value: aspect,
      label: formatImageAspectValue(aspect),
      description: formatImageAspectValue(aspect),
    }));
}

export function imageSizeOptionsForAspect(presets: ImageSizeOption[], aspect: string): ImageSizeOption[] {
  const selectedAspect = parseImageAspectValue(aspect);
  if (!selectedAspect) {
    return [];
  }
  return presets.filter((option) => {
    const optionAspect = parseImageAspectValue(option.aspect)?.value ?? aspectFromImageSize(option.value);
    return optionAspect === selectedAspect.value;
  });
}

export function buildCustomAspectSizeOptions(aspect: string, maxDimension?: number): ImageSizeOption[] {
  const selectedAspect = parseImageAspectValue(aspect);
  if (!selectedAspect || !isImageAspectWithinBounds(selectedAspect.value)) {
    return [];
  }

  const options: ImageSizeOption[] = [];
  const seen = new Set<string>();
  for (const scale of CUSTOM_ASPECT_SCALE_STEPS) {
    const requestedWidth = selectedAspect.widthRatio * scale;
    const requestedHeight = selectedAspect.heightRatio * scale;
    const resolved = resolveImageSize(requestedWidth, requestedHeight, maxDimension);
    if (!resolved || seen.has(resolved.value)) {
      continue;
    }
    const resolvedAspect = reduceImageAspect(resolved.width, resolved.height);
    if (resolvedAspect?.value !== selectedAspect.value) {
      continue;
    }
    seen.add(resolved.value);
    options.push({
      value: resolved.value,
      aspect: selectedAspect.value,
      label: `自定义 · ${imageSizeTierLabel(resolved.width, resolved.height)}`,
      description: `${formatImageAspectValue(selectedAspect.value)} · ${formatImageSizeValue(resolved.value)}`,
    });
  }
  return options;
}

export function formatImageSizeValue(value: string): string {
  return value.replace("x", "×");
}

function imageSizeKindLabel(aspect: string, locale: Locale): string {
  const parsedAspect = parseImageAspectValue(aspect);
  if (!parsedAspect || parsedAspect.widthRatio === parsedAspect.heightRatio) {
    return translate(locale, "imageSize.square");
  }
  if (parsedAspect.widthRatio < parsedAspect.heightRatio) {
    return translate(locale, "imageSize.portrait");
  }
  return translate(locale, "imageSize.landscape");
}

export function labelForImageAspect(value: string, locale: Locale = DEFAULT_LOCALE): string {
  const aspect = parseImageAspectValue(value);
  if (!aspect) {
    return value;
  }
  return `${imageSizeKindLabel(aspect.value, locale)} · ${formatImageAspectValue(aspect.value)}`;
}

export function labelForImageSize(value: string, locale: Locale = DEFAULT_LOCALE): string {
  const preset = BUILT_IN_IMAGE_SIZE_OPTIONS.find((option) => option.value === value);
  if (preset) {
    return `${imageSizeKindLabel(preset.aspect, locale)} · ${getImageSizePresetDisplay(preset, locale).tierLabel}`;
  }
  return `${translate(locale, "imageSize.customLabel")} · ${formatImageSizeValue(value)}`;
}

export function getImageSizePresetDisplay(
  option: ImageSizeOption,
  localeOrIndex: Locale | number = DEFAULT_LOCALE,
): ImageSizePresetDisplay {
  void localeOrIndex;
  const [, tier] = option.label.split("·", 2);
  return {
    aspectLabel: formatImageAspectValue(option.aspect),
    tierLabel: tier?.trim() || option.label,
    dimensionLabel: formatImageSizeValue(option.value),
  };
}
