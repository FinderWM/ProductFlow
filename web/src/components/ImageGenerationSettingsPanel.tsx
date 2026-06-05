import { ImageToolControls } from "./ImageToolControls";
import { ImageSizePicker } from "./ImageSizePicker";
import { ParameterHelpLabel } from "./ParameterHelp";
import { SelectField } from "./SelectField";
import type { ImageSizeOption } from "../lib/imageSizes";
import { formatImageSizeValue } from "../lib/imageSizes";
import type { ParameterHelpUiType } from "../lib/parameterHelp";
import { useI18n } from "../lib/preferences";
import type { ImageToolOptionKey, ImageToolOptions } from "../lib/types";

interface ImageGenerationSettingsPanelProps {
  size: string;
  sizeOptions: ImageSizeOption[];
  maxDimension: number;
  toolOptions: ImageToolOptions;
  allowedToolFields: readonly ImageToolOptionKey[];
  onSizeChange: (size: string) => void;
  onToolOptionsChange: (toolOptions: ImageToolOptions) => void;
  surface?: "card" | "plain";
  generationCount?: number;
  generationCountOptions?: readonly number[];
  generationCountLabel?: string;
  generationCountDescription?: string;
  onGenerationCountChange?: (count: number) => void;
  showToolOptions?: boolean;
  helpUiType?: ParameterHelpUiType;
  disabled?: boolean;
}

export function ImageGenerationSettingsPanel({
  size,
  sizeOptions,
  maxDimension,
  toolOptions,
  allowedToolFields,
  onSizeChange,
  onToolOptionsChange,
  surface = "card",
  generationCount,
  generationCountOptions,
  generationCountLabel,
  generationCountDescription,
  onGenerationCountChange,
  showToolOptions = true,
  helpUiType = "default",
  disabled = false,
}: ImageGenerationSettingsPanelProps) {
  const { t } = useI18n();
  const showCount = generationCount !== undefined && generationCountOptions?.length && onGenerationCountChange;
  const containerClassName = surface === "card" ? "rounded-2xl border border-slate-200 bg-white p-4" : "space-y-3";

  return (
    <div className={containerClassName}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-slate-950">{t("imageSettings.title")}</div>
        <span className="text-[11px] font-medium text-slate-400">{formatImageSizeValue(size)}</span>
      </div>
      <ImageSizePicker
        value={size}
        presets={sizeOptions}
        maxDimension={maxDimension}
        onChange={onSizeChange}
        disabled={disabled}
      />
      {showCount ? (
        <label className="mt-3 block" htmlFor="image-generation-count">
          <span className="mb-1.5 block text-xs font-semibold text-slate-700">
            <ParameterHelpLabel
              label={generationCountLabel ?? t("imageSettings.count")}
              helpKey="imageGenerationCount"
              uiType={helpUiType}
            />
          </span>
          {generationCountDescription ? (
            <span className="mb-1.5 block text-[11px] leading-5 text-slate-500">{generationCountDescription}</span>
          ) : null}
          <SelectField
            id="image-generation-count"
            value={String(generationCount)}
            options={generationCountOptions.map((count) => ({
              value: String(count),
              label: t("imageSettings.candidateCount", { count }),
            }))}
            onChange={(nextValue) => onGenerationCountChange(Number(nextValue))}
            disabled={disabled}
          />
        </label>
      ) : null}
      {showToolOptions ? (
        <div className="mt-3">
          <ImageToolControls
            surface="plain"
            value={toolOptions}
            allowedFields={allowedToolFields}
            helpUiType={helpUiType}
            onChange={onToolOptionsChange}
            disabled={disabled}
          />
        </div>
      ) : null}
    </div>
  );
}
