// 生成配置的本地测试草稿面板（文本 / 图像）。从 SettingsPage.tsx 抽出，行为不变。

import { useState } from "react";
import { ImagePlus, Save, X } from "lucide-react";

import { ClassicSelectField, ClassicTextInput, ClassicTextarea } from "../../../components/classicInputs";
import { ImageSizePicker } from "../../../components/ImageSizePicker";
import { ResourceLibraryModal } from "../../../components/resource-library/ResourceLibraryModal";
import { WorkspaceSelectField, WorkspaceTextInput, WorkspaceTextarea } from "../../../components/workspaceInputs";
import { api } from "../../../lib/api";
import { DEFAULT_IMAGE_SIZE_OPTIONS } from "../../../lib/imageSizes";
import { useI18n } from "../../../lib/preferences";
import type { ResourceLibraryAsset } from "../../../lib/types";
import { DEFAULT_IMAGE_CONFIG_TEST_PRESETS, DEFAULT_TEXT_CONFIG_TEST_PRESETS } from "../configTestState";
import type {
  ImageConfigTestDraft,
  ImageConfigTestState,
  TextConfigTestDraft,
  TextConfigTestState,
} from "../configTestState";
import { SettingsCollapsibleModule } from "./SettingsCollapsibleModule";
import { SettingsFormField } from "./SettingsFormField";
import { useSettingsActionClassNames } from "./styles";

export function TextConfigTestPanel({
  state,
  selectedReferenceAssets,
  canReadResourceLibrary,
  onDraftChange,
  onPresetChange,
  onAddReferenceAsset,
  onRemoveReferenceAsset,
  workspaceSubpage = false,
}: {
  state: TextConfigTestState;
  selectedReferenceAssets: ResourceLibraryAsset[];
  canReadResourceLibrary: boolean;
  onDraftChange: (draft: TextConfigTestDraft) => void;
  onPresetChange: (presetId: string) => void;
  onAddReferenceAsset: (asset: ResourceLibraryAsset) => void;
  onRemoveReferenceAsset: (assetId: string) => void;
  workspaceSubpage?: boolean;
}) {
  const { t } = useI18n();
  const { SETTINGS_COMPACT_ACTION_CLASS, SETTINGS_ICON_ACTION_CLASS } = useSettingsActionClassNames();
  const runningCount = Object.values(state.records).filter((record) => record.testing).length;
  const activitySignal = runningCount > 0 ? `running:${runningCount}` : "";
  const SelectComponent = workspaceSubpage ? WorkspaceSelectField : ClassicSelectField;
  const [referenceLibraryOpen, setReferenceLibraryOpen] = useState(false);
  const selectedReferenceAssetIdSet = new Set(selectedReferenceAssets.map((asset) => asset.id));
  const unresolvedReferenceAssetIds = state.draft.referenceAssetIds.filter((id) => !selectedReferenceAssetIdSet.has(id));
  const referenceStatusLabel = state.draft.referenceAssetIds.length
    ? t("settings.generation.testReferenceStatusConnected", { count: state.draft.referenceAssetIds.length })
    : t("settings.generation.testReferenceStatus");

  return (
    <>
      <SettingsCollapsibleModule
        appearance={workspaceSubpage ? "workspace" : "classic"}
        title={t("settings.generation.testTitle")}
        description={t("settings.generation.testDescription")}
        activitySignal={activitySignal}
      >
        <p className="rounded-lg border pf-hairline pf-surface-soft px-3 py-2 text-xs pf-ink-muted">
          {t("settings.generation.localTestDraftNote")}
        </p>
        <SettingsFormField label={t("settings.generation.testPreset")}>
          <SelectComponent
            value={state.selectedPresetId}
            options={DEFAULT_TEXT_CONFIG_TEST_PRESETS.map((preset) => ({
              value: preset.id,
              label: `${preset.label} · ${preset.description}`,
            }))}
            onChange={onPresetChange}
            size="tall"
            radius="lg"
          />
        </SettingsFormField>
        <div className="grid gap-3 md:grid-cols-2">
          <SettingsFormField label={t("settings.generation.testInspirationName")}>
            {workspaceSubpage ? (
              <WorkspaceTextInput
                value={state.draft.inspirationName}
                onChange={(event) => onDraftChange({ ...state.draft, inspirationName: event.target.value })}
                size="tall"
              />
            ) : (
              <ClassicTextInput
                value={state.draft.inspirationName}
                onChange={(event) => onDraftChange({ ...state.draft, inspirationName: event.target.value })}
                size="tall"
              />
            )}
          </SettingsFormField>
          <SettingsFormField label={t("settings.generation.testCategory")}>
            {workspaceSubpage ? (
              <WorkspaceTextInput
                value={state.draft.category}
                onChange={(event) => onDraftChange({ ...state.draft, category: event.target.value })}
                size="tall"
              />
            ) : (
              <ClassicTextInput
                value={state.draft.category}
                onChange={(event) => onDraftChange({ ...state.draft, category: event.target.value })}
                size="tall"
              />
            )}
          </SettingsFormField>
          <SettingsFormField label={t("settings.generation.testPrice")}>
            {workspaceSubpage ? (
              <WorkspaceTextInput
                value={state.draft.price}
                onChange={(event) => onDraftChange({ ...state.draft, price: event.target.value })}
                size="tall"
              />
            ) : (
              <ClassicTextInput
                value={state.draft.price}
                onChange={(event) => onDraftChange({ ...state.draft, price: event.target.value })}
                size="tall"
              />
            )}
          </SettingsFormField>
          <SettingsFormField label={t("settings.generation.testInstruction")}>
            {workspaceSubpage ? (
              <WorkspaceTextInput
                value={state.draft.instruction}
                onChange={(event) => onDraftChange({ ...state.draft, instruction: event.target.value })}
                size="tall"
              />
            ) : (
              <ClassicTextInput
                value={state.draft.instruction}
                onChange={(event) => onDraftChange({ ...state.draft, instruction: event.target.value })}
                size="tall"
              />
            )}
          </SettingsFormField>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <SettingsFormField label={t("settings.generation.testPurpose")}>
            {workspaceSubpage ? (
              <WorkspaceTextInput
                value={state.draft.purpose}
                onChange={(event) => onDraftChange({ ...state.draft, purpose: event.target.value })}
                size="tall"
              />
            ) : (
              <ClassicTextInput
                value={state.draft.purpose}
                onChange={(event) => onDraftChange({ ...state.draft, purpose: event.target.value })}
                size="tall"
              />
            )}
          </SettingsFormField>
          <SettingsFormField label={t("settings.generation.testChannel")}>
            {workspaceSubpage ? (
              <WorkspaceTextInput
                value={state.draft.channel}
                onChange={(event) => onDraftChange({ ...state.draft, channel: event.target.value })}
                size="tall"
              />
            ) : (
              <ClassicTextInput
                value={state.draft.channel}
                onChange={(event) => onDraftChange({ ...state.draft, channel: event.target.value })}
                size="tall"
              />
            )}
          </SettingsFormField>
          <SettingsFormField label={t("settings.generation.testTone")}>
            {workspaceSubpage ? (
              <WorkspaceTextInput
                value={state.draft.tone}
                onChange={(event) => onDraftChange({ ...state.draft, tone: event.target.value })}
                size="tall"
              />
            ) : (
              <ClassicTextInput
                value={state.draft.tone}
                onChange={(event) => onDraftChange({ ...state.draft, tone: event.target.value })}
                size="tall"
              />
            )}
          </SettingsFormField>
          <SettingsFormField label={t("settings.generation.testOutputMode")}>
            <SelectComponent
              value={state.draft.outputMode}
              options={[
                { value: "freeform", label: t("settings.generation.outputModeFreeform") },
                { value: "blocks", label: t("settings.generation.outputModeBlocks") },
                { value: "layout_brief", label: t("settings.generation.outputModeLayoutBrief") },
              ]}
              onChange={(outputMode) =>
                onDraftChange({
                  ...state.draft,
                  outputMode: outputMode === "freeform" || outputMode === "layout_brief" ? outputMode : "blocks",
                })
              }
              size="tall"
              radius="lg"
            />
          </SettingsFormField>
        </div>
        <SettingsFormField label={t("settings.generation.testSourceNote")}>
          {workspaceSubpage ? (
            <WorkspaceTextarea
              value={state.draft.sourceNote}
              onChange={(event) => onDraftChange({ ...state.draft, sourceNote: event.target.value })}
              className="min-h-24"
            />
          ) : (
            <ClassicTextarea
              value={state.draft.sourceNote}
              onChange={(event) => onDraftChange({ ...state.draft, sourceNote: event.target.value })}
              className="min-h-24"
            />
          )}
        </SettingsFormField>
        <SettingsFormField label={t("settings.generation.testRequestedSlots")}>
          {workspaceSubpage ? (
            <WorkspaceTextarea
              value={state.draft.requestedSlotsText}
              onChange={(event) => onDraftChange({ ...state.draft, requestedSlotsText: event.target.value })}
              className="min-h-24 font-mono"
            />
          ) : (
            <ClassicTextarea
              value={state.draft.requestedSlotsText}
              onChange={(event) => onDraftChange({ ...state.draft, requestedSlotsText: event.target.value })}
              className="min-h-24 font-mono"
            />
          )}
        </SettingsFormField>
        <SettingsFormField label={t("settings.generation.testReferenceImages")}>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setReferenceLibraryOpen(true)}
                className={SETTINGS_COMPACT_ACTION_CLASS}
              >
                <ImagePlus size={14} className="mr-1.5" />
                {t("settings.generation.testSelectReferenceImage")}
              </button>
              <span className="text-xs pf-ink-muted">
                {t("settings.generation.testReferenceAutoSyncHint")}
              </span>
            </div>
            {state.draft.referenceAssetIds.length ? (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {selectedReferenceAssets.map((asset) => {
                  const thumbnailPath = asset.thumbnail_url || asset.preview_url || asset.download_url;
                  return (
                    <div
                      key={asset.id}
                      className="overflow-hidden rounded-xl border pf-hairline pf-surface shadow-sm"
                    >
                      {thumbnailPath ? (
                        <img
                          src={api.toApiUrl(thumbnailPath)}
                          alt={asset.original_filename}
                          loading="lazy"
                          decoding="async"
                          className="aspect-[4/3] w-full object-cover"
                        />
                      ) : null}
                      <div className="flex items-start justify-between gap-3 p-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium pf-ink">
                            {asset.original_filename}
                          </div>
                          <div className="mt-1 text-xs pf-ink-muted">
                            {asset.groups.map((group) => group.name).join(" / ") || t("resourceLibrary.allGroups")}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onRemoveReferenceAsset(asset.id)}
                          className={SETTINGS_ICON_ACTION_CLASS}
                          aria-label={t("settings.generation.testRemoveReferenceImage")}
                          title={t("settings.generation.testRemoveReferenceImage")}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {unresolvedReferenceAssetIds.map((assetId) => (
                  <div
                    key={assetId}
                    className="flex items-center justify-between gap-3 rounded-xl border border-dashed pf-hairline-strong pf-surface-soft px-3 py-2 text-sm pf-ink-muted"
                  >
                    <span className="truncate">{assetId}</span>
                    <button
                      type="button"
                      onClick={() => onRemoveReferenceAsset(assetId)}
                      className={SETTINGS_ICON_ACTION_CLASS}
                      aria-label={t("settings.generation.testRemoveReferenceImage")}
                      title={t("settings.generation.testRemoveReferenceImage")}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed pf-hairline-strong pf-surface-soft px-3 py-3 text-sm pf-ink-muted">
                {t("settings.generation.testReferenceEmpty")}
              </div>
            )}
          </div>
        </SettingsFormField>
        <div className="grid gap-2 text-xs pf-ink-muted sm:grid-cols-2">
          <div className="rounded-lg border pf-hairline pf-surface-soft px-3 py-2">
            {referenceStatusLabel}
          </div>
          <div className="rounded-lg border pf-hairline pf-surface-soft px-3 py-2">
            {t("settings.generation.testBriefContextStatus")}
          </div>
        </div>
      </SettingsCollapsibleModule>

      <ResourceLibraryModal
        open={referenceLibraryOpen}
        onClose={() => setReferenceLibraryOpen(false)}
        canRead={canReadResourceLibrary}
        appearance={workspaceSubpage ? "workspace" : "classic"}
        onSelectAsset={(asset) => {
          onAddReferenceAsset(asset);
          setReferenceLibraryOpen(false);
        }}
        selectLabel={t("settings.generation.testUseReferenceImage")}
        isAssetSelectable={(asset) => !state.draft.referenceAssetIds.includes(asset.id)}
        assetSelectDisabledTitle={t("settings.generation.testReferenceAlreadySelected")}
      />
    </>
  );
}

export function ImageConfigTestPanel({
  state,
  onDraftChange,
  onPresetChange,
  onSaveDraft,
  workspaceSubpage = false,
}: {
  state: ImageConfigTestState;
  onDraftChange: (draft: ImageConfigTestDraft) => void;
  onPresetChange: (presetId: string) => void;
  onSaveDraft: () => void;
  workspaceSubpage?: boolean;
}) {
  const { t } = useI18n();
  const { SETTINGS_COMPACT_ACTION_CLASS } = useSettingsActionClassNames();
  const runningCount = Object.values(state.records).filter((record) => record.testing).length;
  const activitySignal = runningCount > 0 ? `running:${runningCount}` : "";
  const SelectComponent = workspaceSubpage ? WorkspaceSelectField : ClassicSelectField;

  return (
    <SettingsCollapsibleModule
      appearance={workspaceSubpage ? "workspace" : "classic"}
      title={t("settings.generation.imageTestTitle")}
      description={t("settings.generation.imageTestDescription")}
      activitySignal={activitySignal}
    >
      <p className="rounded-lg border pf-hairline pf-surface-soft px-3 py-2 text-xs pf-ink-muted">
        {t("settings.generation.localTestDraftNote")}
      </p>
      <SettingsFormField label={t("settings.generation.testPreset")}>
        <SelectComponent
          value={state.selectedPresetId}
          options={DEFAULT_IMAGE_CONFIG_TEST_PRESETS.map((preset) => ({
            value: preset.id,
            label: `${preset.label} · ${preset.description}`,
          }))}
          onChange={onPresetChange}
          size="tall"
          radius="lg"
        />
      </SettingsFormField>
      <div className="flex justify-end">
        <button type="button" onClick={onSaveDraft} className={SETTINGS_COMPACT_ACTION_CLASS}>
          <Save size={14} className="mr-1.5" />
          {t("settings.generation.imageTestSaveDraft")}
        </button>
      </div>
      <ImageSizePicker
        value={state.draft.size}
        presets={DEFAULT_IMAGE_SIZE_OPTIONS}
        onChange={(size) => onDraftChange({ ...state.draft, size })}
        appearance={workspaceSubpage ? "workspace" : "classic"}
      />
      <SettingsFormField label={t("settings.generation.imageTestPrompt")}>
        {workspaceSubpage ? (
          <WorkspaceTextarea
            value={state.draft.prompt}
            onChange={(event) => onDraftChange({ ...state.draft, prompt: event.target.value })}
            className="min-h-28"
          />
        ) : (
          <ClassicTextarea
            value={state.draft.prompt}
            onChange={(event) => onDraftChange({ ...state.draft, prompt: event.target.value })}
            className="min-h-28"
          />
        )}
      </SettingsFormField>
    </SettingsCollapsibleModule>
  );
}
