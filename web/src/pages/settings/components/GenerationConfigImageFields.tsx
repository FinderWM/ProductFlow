// 图像生成配置的专属字段（模型选择 + Gemini/Images/Responses 参数）。从 SettingsPage.tsx 抽出，行为不变。

import { ParameterHelpLabel } from "../../../components/ParameterHelp";
import { SelectField } from "../../../components/SelectField";
import { useI18n } from "../../../lib/preferences";
import type { GenerationConfigDraft } from "../generationConfig";
import { ProviderModelInput } from "./ProviderModelInput";
import { SettingsFormField } from "./SettingsFormField";
import { INPUT_CLASS } from "./styles";
import { SettingsOptionToggle } from "./Toggles";

export function GenerationConfigImageFields({
  draft,
  pending,
  onChange,
  configId,
}: {
  draft: GenerationConfigDraft;
  pending: boolean;
  onChange: (next: GenerationConfigDraft) => void;
  configId: string;
}) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      <ProviderModelInput
        idPrefix={`image-model-${configId}`}
        label={t("settings.provider.imageModelLabel")}
        value={draft.model}
        placeholder={t("settings.provider.imageModelPlaceholder")}
        providerKind={
          draft.provider_kind === "openai_responses" ||
          draft.provider_kind === "openai_images" ||
          draft.provider_kind === "openai_chat_image" ||
          draft.provider_kind === "google_gemini_image"
            ? draft.provider_kind
            : "mock"
        }
        providerProfileId={draft.provider_profile_id}
        disabled={pending}
        helpKey="settingsImageModel"
        onChange={(model) => onChange({ ...draft, model })}
      />
      {draft.provider_kind === "google_gemini_image" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <SettingsFormField label={t("settings.provider.geminiApiVersionLabel")} helpKey="settingsGeminiApiVersion">
            <SelectField
              value={draft.gemini_api_version}
              options={[
                { value: "v1beta", label: "v1beta" },
                { value: "v1", label: "v1" },
              ]}
              onChange={(value) => onChange({ ...draft, gemini_api_version: value === "v1" ? "v1" : "v1beta" })}
              disabled={pending}
              radius="lg"
            />
          </SettingsFormField>
          <SettingsFormField label={t("settings.provider.geminiOutputMimeTypeLabel")} helpKey="settingsGeminiOutputMimeType">
            <SelectField
              value={draft.gemini_output_mime_type}
              options={[
                { value: "", label: t("settings.provider.geminiOutputMimeTypeDefault") },
                { value: "image/png", label: "image/png" },
                { value: "image/jpeg", label: "image/jpeg" },
                { value: "image/webp", label: "image/webp" },
              ]}
              onChange={(value) => onChange({ ...draft, gemini_output_mime_type: value })}
              disabled={pending}
              radius="lg"
            />
          </SettingsFormField>
        </div>
      ) : null}
      {draft.provider_kind === "openai_images" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <SettingsFormField label={t("settings.provider.imagesQualityLabel")} helpKey="settingsImagesQuality">
            <input
            value={draft.images_quality}
            disabled={pending}
            onChange={(event) => onChange({ ...draft, images_quality: event.target.value })}
              className={INPUT_CLASS}
              placeholder={t("settings.provider.imagesQualityPlaceholder")}
            />
          </SettingsFormField>
          <SettingsFormField label={t("settings.provider.imagesStyleLabel")} helpKey="settingsImagesStyle">
            <input
            value={draft.images_style}
            disabled={pending}
            onChange={(event) => onChange({ ...draft, images_style: event.target.value })}
              className={INPUT_CLASS}
              placeholder={t("settings.provider.imagesStylePlaceholder")}
            />
          </SettingsFormField>
        </div>
      ) : null}
      {draft.provider_kind === "openai_responses" ? (
        <div className="max-w-md">
          <SettingsOptionToggle
            checked={draft.responses_background_enabled}
            disabled={pending}
            onChange={(responses_background_enabled) => onChange({ ...draft, responses_background_enabled })}
          >
          <ParameterHelpLabel
            label={t("settings.provider.responsesBackground")}
            helpKey="settingsResponsesBackground"
            uiType="settings"
          />
          </SettingsOptionToggle>
        </div>
      ) : null}
    </div>
  );
}
