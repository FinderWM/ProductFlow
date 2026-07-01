import { DEFAULT_IMAGE_TOOL_ALLOWED_FIELDS } from "../lib/imageToolOptions";
import type { ParameterHelpKey, ParameterHelpUiType } from "../lib/parameterHelp";
import { useI18n } from "../lib/preferences";
import type { ImageToolOptionKey, ImageToolOptions } from "../lib/types";
import { ParameterHelpLabel } from "./ParameterHelp";
import type { SelectFieldOption } from "./SelectField";
import { SelectField } from "./SelectField";

interface ImageToolControlsProps {
  value: ImageToolOptions;
  onChange: (value: ImageToolOptions) => void;
  surface?: "card" | "plain";
  allowedFields?: readonly ImageToolOptionKey[];
  helpUiType?: ParameterHelpUiType;
  disabled?: boolean;
}

function parseOptionalNumber(value: string): number | null {
  if (!value.trim()) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function ImageToolControls({
  value,
  onChange,
  surface = "card",
  allowedFields = DEFAULT_IMAGE_TOOL_ALLOWED_FIELDS,
  helpUiType = "default",
  disabled = false,
}: ImageToolControlsProps) {
  const { t } = useI18n();
  const update = (next: Partial<ImageToolOptions>) => onChange({ ...value, ...next });
  const allowed = new Set(allowedFields);
  if (!allowed.size) {
    return null;
  }
  const containerClassName =
    surface === "card" ? "rounded-2xl border border-slate-200 bg-white p-4" : "space-y-3";
  return (
    <div className={containerClassName}>
      <div className="mb-3 text-sm font-semibold text-slate-950">{t("imageTool.provider")}</div>
      <div className="grid grid-cols-2 gap-2">
        {allowed.has("model") ? (
          <CompactInput
            label={t("imageTool.tool")}
            helpKey="imageToolModel"
            helpUiType={helpUiType}
            value={value.model ?? ""}
            placeholder={t("imageTool.default")}
            onChange={(next) => update({ model: next || null })}
            disabled={disabled}
          />
        ) : null}
        {allowed.has("quality") ? (
          <CompactSelect
            label={t("imageTool.quality")}
            helpKey="imageToolQuality"
            helpUiType={helpUiType}
            value={value.quality ?? ""}
            onChange={(next) => update({ quality: (next || null) as ImageToolOptions["quality"] })}
            options={[
              { value: "", label: t("imageTool.default") },
              { value: "auto", label: "Auto" },
              { value: "low", label: "Low" },
              { value: "medium", label: "Medium" },
              { value: "high", label: "High" },
            ]}
            disabled={disabled}
          />
        ) : null}
        {allowed.has("output_format") ? (
          <CompactSelect
            label={t("imageTool.format")}
            helpKey="imageToolFormat"
            helpUiType={helpUiType}
            value={value.output_format ?? ""}
            onChange={(next) => update({ output_format: (next || null) as ImageToolOptions["output_format"] })}
            options={[
              { value: "", label: t("imageTool.default") },
              { value: "png", label: "PNG" },
              { value: "jpeg", label: "JPEG" },
              { value: "webp", label: "WebP" },
            ]}
            disabled={disabled}
          />
        ) : null}
        {allowed.has("output_compression") ? (
          <CompactInput
            label={t("imageTool.compression")}
            helpKey="imageToolCompression"
            helpUiType={helpUiType}
            value={value.output_compression ?? ""}
            inputMode="numeric"
            placeholder={t("imageTool.default")}
            onChange={(next) => update({ output_compression: parseOptionalNumber(next) })}
            disabled={disabled}
          />
        ) : null}
        {allowed.has("background") ? (
          <CompactSelect
            label={t("imageTool.background")}
            helpKey="imageToolBackground"
            helpUiType={helpUiType}
            value={value.background ?? ""}
            onChange={(next) => update({ background: (next || null) as ImageToolOptions["background"] })}
            options={[
              { value: "", label: t("imageTool.default") },
              { value: "auto", label: "Auto" },
              { value: "opaque", label: "Opaque" },
              { value: "transparent", label: "Transparent" },
            ]}
            disabled={disabled}
          />
        ) : null}
        {allowed.has("moderation") ? (
          <CompactSelect
            label={t("imageTool.moderation")}
            helpKey="imageToolModeration"
            helpUiType={helpUiType}
            value={value.moderation ?? ""}
            onChange={(next) => update({ moderation: (next || null) as ImageToolOptions["moderation"] })}
            options={[
              { value: "", label: t("imageTool.default") },
              { value: "auto", label: "Auto" },
              { value: "low", label: "Low" },
            ]}
            disabled={disabled}
          />
        ) : null}
        {allowed.has("action") ? (
          <CompactSelect
            label={t("imageTool.action")}
            helpKey="imageToolAction"
            helpUiType={helpUiType}
            value={value.action ?? ""}
            onChange={(next) => update({ action: (next || null) as ImageToolOptions["action"] })}
            options={[
              { value: "", label: t("imageTool.default") },
              { value: "auto", label: "Auto" },
              { value: "generate", label: "Generate" },
              { value: "edit", label: "Edit" },
            ]}
            disabled={disabled}
          />
        ) : null}
        {allowed.has("input_fidelity") ? (
          <CompactSelect
            label={t("imageTool.inputFidelity")}
            helpKey="imageToolInputFidelity"
            helpUiType={helpUiType}
            value={value.input_fidelity ?? ""}
            onChange={(next) => update({ input_fidelity: (next || null) as ImageToolOptions["input_fidelity"] })}
            options={[
              { value: "", label: t("imageTool.default") },
              { value: "low", label: "Low" },
              { value: "high", label: "High" },
            ]}
            disabled={disabled}
          />
        ) : null}
        {allowed.has("partial_images") ? (
          <CompactInput
            label={t("imageTool.partialImages")}
            helpKey="imageToolPartialImages"
            helpUiType={helpUiType}
            value={value.partial_images ?? ""}
            inputMode="numeric"
            placeholder={t("imageTool.default")}
            onChange={(next) => update({ partial_images: parseOptionalNumber(next) })}
            disabled={disabled}
          />
        ) : null}
      </div>
    </div>
  );
}

function CompactInput({
  label,
  value,
  placeholder,
  inputMode,
  helpKey,
  helpUiType,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string | number;
  placeholder?: string;
  inputMode?: "text" | "numeric";
  helpKey?: ParameterHelpKey;
  helpUiType?: ParameterHelpUiType;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold text-slate-500">
        {helpKey ? <ParameterHelpLabel label={label} helpKey={helpKey} uiType={helpUiType} /> : label}
      </span>
      <input
        value={value}
        inputMode={inputMode}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="pf-input-compact w-full"
      />
    </label>
  );
}

function CompactSelect({
  label,
  value,
  onChange,
  options,
  helpKey,
  helpUiType,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectFieldOption[];
  helpKey?: ParameterHelpKey;
  helpUiType?: ParameterHelpUiType;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold text-slate-500">
        {helpKey ? <ParameterHelpLabel label={label} helpKey={helpKey} uiType={helpUiType} /> : label}
      </span>
      <SelectField
        value={value}
        options={options}
        onChange={onChange}
        radius="lg"
        visualSize="sm"
        disabled={disabled}
      />
    </label>
  );
}
