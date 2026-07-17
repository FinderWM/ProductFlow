import { useEffect, useId, useMemo, useState } from "react";

import type { ImageSizeOption } from "../lib/imageSizes";
import {
  IMAGE_GENERATION_MAX_ASPECT_RATIO,
  IMAGE_GENERATION_MIN_DIMENSION,
  aspectFromImageSize,
  buildCustomAspectSizeOptions,
  buildImageAspectOptions,
  formatImageSizeValue,
  getImageSizePresetDisplay,
  imageSizeOptionsForAspect,
  isImageAspectWithinBounds,
  labelForImageAspect,
  normalizeImageSizeValue,
  parseImageAspectValue,
  parseImageSizeValue,
  resolveImageSize,
} from "../lib/imageSizes";
import { useI18n } from "../lib/preferences";
import { ClassicOptionToggle, ClassicTextInput } from "./classicInputs";
import { WorkspaceOptionToggle, WorkspaceTextInput } from "./workspaceInputs";

interface ImageSizePickerProps {
  value: string;
  presets: ImageSizeOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  maxDimension?: number;
  appearance: "classic" | "workspace";
}

function splitSize(value: string, maxDimension?: number): { width: string; height: string } {
  const parsed = parseImageSizeValue(value, maxDimension);
  if (!parsed) {
    return { width: "", height: "" };
  }
  return { width: String(parsed.width), height: String(parsed.height) };
}

function resolveCustomDraft(width: string, height: string, maxDimension?: number) {
  if (!/^\d+$/.test(width) || !/^\d+$/.test(height)) {
    return null;
  }
  return resolveImageSize(Number(width), Number(height), maxDimension);
}

function resolutionOptionsForAspect(aspect: string, presets: ImageSizeOption[], maxDimension?: number): ImageSizeOption[] {
  const presetOptions = imageSizeOptionsForAspect(presets, aspect);
  return presetOptions.length > 0 ? presetOptions : buildCustomAspectSizeOptions(aspect, maxDimension);
}

function imageSizeArea(value: string, maxDimension?: number): number | null {
  const parsed = parseImageSizeValue(value, maxDimension);
  return parsed ? parsed.width * parsed.height : null;
}

function chooseResolutionForAspect(
  aspect: string,
  presets: ImageSizeOption[],
  currentValue: string | null,
  maxDimension?: number,
): string | null {
  const options = resolutionOptionsForAspect(aspect, presets, maxDimension);
  if (options.length === 0) {
    return null;
  }
  if (currentValue && aspectFromImageSize(currentValue, maxDimension) === aspect) {
    return currentValue;
  }
  const currentArea = currentValue ? imageSizeArea(currentValue, maxDimension) : null;
  if (!currentArea) {
    return options[0].value;
  }
  return options
    .slice()
    .sort((left, right) => {
      const leftArea = imageSizeArea(left.value, maxDimension) ?? 0;
      const rightArea = imageSizeArea(right.value, maxDimension) ?? 0;
      return Math.abs(leftArea - currentArea) - Math.abs(rightArea - currentArea) || leftArea - rightArea;
    })[0].value;
}

function frameClassName(aspect: string): string {
  const parsed = parseImageAspectValue(aspect);
  if (!parsed || parsed.widthRatio === parsed.heightRatio) {
    return "h-8 w-8";
  }
  const ratio = parsed.widthRatio / parsed.heightRatio;
  if (ratio < 0.7) {
    return "h-10 w-7";
  }
  if (ratio < 1) {
    return "h-10 w-8";
  }
  if (ratio > 1.45) {
    return "h-7 w-10";
  }
  return "h-8 w-10";
}

export function ImageSizePicker({
  value,
  presets,
  onChange,
  disabled = false,
  maxDimension,
  appearance,
}: ImageSizePickerProps) {
  const { locale, t } = useI18n();
  const aspectGroupName = useId();
  const resolutionGroupName = useId();
  const useWorkspaceInputs = appearance === "workspace";
  const LayoutOptionToggle = useWorkspaceInputs ? WorkspaceOptionToggle : ClassicOptionToggle;
  const LayoutTextInput = useWorkspaceInputs ? WorkspaceTextInput : ClassicTextInput;
  const aspectOptions = useMemo(() => buildImageAspectOptions(presets), [presets]);
  const aspectOptionValues = useMemo(() => new Set(aspectOptions.map((option) => option.value)), [aspectOptions]);
  const normalizedValue = normalizeImageSizeValue(value, maxDimension);
  const hydratedAspect = normalizedValue ? aspectFromImageSize(normalizedValue, maxDimension) : null;
  const defaultAspect = hydratedAspect ?? aspectOptions[0]?.value ?? "1:1";
  const [selectedAspect, setSelectedAspect] = useState(defaultAspect);
  const [customAspectDraft, setCustomAspectDraft] = useState(defaultAspect);
  const [{ width, height }, setCustomDraft] = useState(() => splitSize(value, maxDimension));
  const customResolution = resolveCustomDraft(width, height, maxDimension);
  const resolutionOptions = useMemo(
    () => resolutionOptionsForAspect(selectedAspect, presets, maxDimension),
    [maxDimension, presets, selectedAspect],
  );
  const customAspect = parseImageAspectValue(customAspectDraft);
  const customAspectInvalid =
    customAspectDraft.trim() !== "" && (!customAspect || !isImageAspectWithinBounds(customAspect.value));
  const customAspectActive = customAspect !== null && customAspect.value === selectedAspect && !aspectOptionValues.has(selectedAspect);

  useEffect(() => {
    const parsed = splitSize(value, maxDimension);
    const nextAspect = aspectFromImageSize(value, maxDimension) ?? aspectOptions[0]?.value ?? "1:1";
    setSelectedAspect(nextAspect);
    setCustomAspectDraft(nextAspect);
    setCustomDraft(parsed);
  }, [aspectOptions, maxDimension, value]);

  const selectAspect = (nextAspect: string) => {
    setSelectedAspect(nextAspect);
    setCustomAspectDraft(nextAspect);
    const nextResolution = chooseResolutionForAspect(nextAspect, presets, normalizedValue, maxDimension);
    if (nextResolution && nextResolution !== normalizedValue) {
      onChange(nextResolution);
    }
  };

  const updateCustomAspect = (nextValue: string) => {
    setCustomAspectDraft(nextValue);
    const nextAspect = parseImageAspectValue(nextValue);
    if (!nextAspect) {
      return;
    }
    setSelectedAspect(nextAspect.value);
    if (!isImageAspectWithinBounds(nextAspect.value)) {
      return;
    }
    const nextResolution = chooseResolutionForAspect(nextAspect.value, presets, normalizedValue, maxDimension);
    if (nextResolution && nextResolution !== normalizedValue) {
      onChange(nextResolution);
    }
  };

  const updateCustom = (nextWidth: string, nextHeight: string) => {
    setCustomDraft({ width: nextWidth, height: nextHeight });
    const nextResolution = resolveCustomDraft(nextWidth, nextHeight, maxDimension);
    if (nextResolution) {
      const nextAspect = aspectFromImageSize(nextResolution.value, maxDimension);
      if (nextAspect) {
        setSelectedAspect(nextAspect);
        setCustomAspectDraft(nextAspect);
      }
      onChange(nextResolution.value);
    }
  };

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-slate-700 dark:text-slate-100">{t("imageSize.aspect")}</div>
          <div className="shrink-0 text-[11px] font-medium text-slate-400 dark:text-slate-500">
            {labelForImageAspect(selectedAspect, locale)}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {aspectOptions.map((option) => {
            const active = option.value === selectedAspect;
            const optionContent = (
              <>
                <span
                  className={`mb-1 flex items-center justify-center rounded-sm border-2 border-current text-[9px] font-black leading-none ${frameClassName(option.value)}`}
                />
                <span>{option.label}</span>
              </>
            );
            return (
              <LayoutOptionToggle
                key={option.value}
                checked={active}
                disabled={disabled}
                layout="card"
                selectionMode="single"
                name={aspectGroupName}
                title={labelForImageAspect(option.value, locale)}
                className="h-20 w-full !items-center justify-center px-2 py-2 text-center text-xs font-semibold"
                onChange={(checked) => {
                  if (checked) {
                    selectAspect(option.value);
                  }
                }}
              >
                <span className="flex min-w-0 flex-col items-center justify-center">{optionContent}</span>
              </LayoutOptionToggle>
            );
          })}
        </div>
        <label
          className={`block rounded-lg border p-3 transition-colors ${
            customAspectActive
              ? "border-slate-900 bg-slate-50 dark:border-slate-100 dark:bg-slate-100/10"
              : "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950/50"
          }`}
        >
          <span className="mb-1.5 block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            {t("imageSize.customAspect")}
          </span>
          <LayoutTextInput
            value={customAspectDraft}
            onChange={(event) => updateCustomAspect(event.target.value)}
            disabled={disabled}
            size="compact"
            className="w-full disabled:bg-slate-100 dark:disabled:bg-slate-950"
            placeholder="4:5"
          />
          <span
            className={`mt-1.5 block text-[11px] leading-5 ${
              customAspectInvalid ? "text-rose-600 dark:text-rose-300" : "text-slate-500 dark:text-slate-400"
            }`}
          >
            {customAspectInvalid
              ? t("imageSize.invalidAspect", { max: IMAGE_GENERATION_MAX_ASPECT_RATIO })
              : t("imageSize.customAspectHint")}
          </span>
        </label>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-slate-700 dark:text-slate-100">{t("imageSize.resolution")}</div>
          <div className="shrink-0 text-[11px] font-medium text-slate-400 dark:text-slate-500">
            {t("imageSize.current", { size: normalizedValue ? formatImageSizeValue(normalizedValue) : t("imageSize.unset") })}
          </div>
        </div>
        {resolutionOptions.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {resolutionOptions.map((option) => {
              const active = option.value === normalizedValue;
              const display = getImageSizePresetDisplay(option, locale);
              const optionContent = (
                <>
                  <span className="text-sm font-black">{display.tierLabel}</span>
                  <span className="mt-1 text-[10px] font-medium text-slate-400 dark:text-slate-500">
                    {display.dimensionLabel}
                  </span>
                </>
              );
              return (
                <LayoutOptionToggle
                  key={option.value}
                  checked={active}
                  disabled={disabled}
                  layout="card"
                  selectionMode="single"
                  name={resolutionGroupName}
                  title={formatImageSizeValue(option.value)}
                  className="h-20 w-full !items-center justify-center px-2 py-2 text-center text-xs font-semibold"
                  onChange={(checked) => {
                    if (checked) {
                      onChange(option.value);
                    }
                  }}
                >
                  <span className="flex min-w-0 flex-col items-center justify-center">{optionContent}</span>
                </LayoutOptionToggle>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-500 dark:border-slate-700 dark:bg-slate-950/50 dark:text-slate-400">
            {t("imageSize.noResolutionOptions")}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950/50">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-xs font-semibold text-slate-700 dark:text-slate-100">{t("imageSize.custom")}</div>
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
          <label className="block min-w-0">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
              {t("imageSize.width")}
            </span>
            <LayoutTextInput
              value={width}
              inputMode="numeric"
              pattern="[0-9]*"
              onChange={(event) => updateCustom(event.target.value, height)}
              disabled={disabled}
              size="compact"
              className="px-2 text-xs disabled:bg-slate-100 dark:disabled:bg-slate-950"
              placeholder="2048"
            />
          </label>
          <span className="pb-2 text-xs text-slate-400 dark:text-slate-500">×</span>
          <label className="block min-w-0">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
              {t("imageSize.height")}
            </span>
            <LayoutTextInput
              value={height}
              inputMode="numeric"
              pattern="[0-9]*"
              onChange={(event) => updateCustom(width, event.target.value)}
              disabled={disabled}
              size="compact"
              className="px-2 text-xs disabled:bg-slate-100 dark:disabled:bg-slate-950"
              placeholder="2048"
            />
          </label>
        </div>
        <div className="mt-2 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
          {customResolution ? (
            <>
              {t("imageSize.output", { size: formatImageSizeValue(customResolution.value) })}
              {customResolution.calibrated
                ? t("imageSize.calibrated", { min: IMAGE_GENERATION_MIN_DIMENSION, max: maxDimension ?? 3840 })
                : ""}
            </>
          ) : (
            t("imageSize.invalid")
          )}
        </div>
      </section>
    </div>
  );
}
