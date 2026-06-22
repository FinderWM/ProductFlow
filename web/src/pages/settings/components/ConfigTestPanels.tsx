// 生成配置的本地测试草稿面板（文本 / 图像）。从 SettingsPage.tsx 抽出，行为不变。

import { Loader2, Save } from "lucide-react";

import { ImageSizePicker } from "../../../components/ImageSizePicker";
import { DEFAULT_IMAGE_SIZE_OPTIONS } from "../../../lib/imageSizes";
import { useI18n } from "../../../lib/preferences";
import type {
  ImageConfigTestDraft,
  ImageConfigTestState,
  TextConfigTestDraft,
  TextConfigTestState,
} from "../configTestState";
import { SettingsCollapsibleModule } from "./SettingsCollapsibleModule";
import { SettingsFormField } from "./SettingsFormField";
import { INPUT_CLASS, SETTINGS_COMPACT_ACTION_CLASS, TEXTAREA_CLASS } from "./styles";

export function TextConfigTestPanel({
  state,
  onDraftChange,
}: {
  state: TextConfigTestState;
  onDraftChange: (draft: TextConfigTestDraft) => void;
}) {
  const { t } = useI18n();
  const runningCount = Object.values(state.records).filter((record) => record.testing).length;
  const activitySignal = runningCount > 0 ? `running:${runningCount}` : "";

  return (
    <SettingsCollapsibleModule
      title={t("settings.generation.testTitle")}
      description={t("settings.generation.testDescription")}
      activitySignal={activitySignal}
    >
      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:bg-[#0b1220] dark:text-slate-400">
        {t("settings.generation.localTestDraftNote")}
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        <SettingsFormField label={t("settings.generation.testInspirationName")}>
          <input
            value={state.draft.inspirationName}
            onChange={(event) => onDraftChange({ ...state.draft, inspirationName: event.target.value })}
            className={INPUT_CLASS}
          />
        </SettingsFormField>
        <SettingsFormField label={t("settings.generation.testCategory")}>
          <input
            value={state.draft.category}
            onChange={(event) => onDraftChange({ ...state.draft, category: event.target.value })}
            className={INPUT_CLASS}
          />
        </SettingsFormField>
        <SettingsFormField label={t("settings.generation.testPrice")}>
          <input
            value={state.draft.price}
            onChange={(event) => onDraftChange({ ...state.draft, price: event.target.value })}
            className={INPUT_CLASS}
          />
        </SettingsFormField>
        <SettingsFormField label={t("settings.generation.testInstruction")}>
          <input
            value={state.draft.instruction}
            onChange={(event) => onDraftChange({ ...state.draft, instruction: event.target.value })}
            className={INPUT_CLASS}
          />
        </SettingsFormField>
      </div>
      <SettingsFormField label={t("settings.generation.testSourceNote")}>
        <textarea
          value={state.draft.sourceNote}
          onChange={(event) => onDraftChange({ ...state.draft, sourceNote: event.target.value })}
          className={`${TEXTAREA_CLASS} min-h-24 resize-y`}
        />
      </SettingsFormField>
      {runningCount > 0 ? (
        <div className="flex items-start gap-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-3 text-sm text-indigo-800 dark:border-violet-400/35 dark:bg-violet-500/12 dark:text-violet-100">
          <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin" />
          <div>
            <div className="font-semibold">{t("settings.generation.testRunning")}</div>
            <div className="mt-0.5 text-xs text-indigo-700/80 dark:text-violet-100/75">
              {t("settings.generation.testRunningDetail")}
            </div>
          </div>
        </div>
      ) : null}
    </SettingsCollapsibleModule>
  );
}

export function ImageConfigTestPanel({
  state,
  onDraftChange,
  onSaveDraft,
}: {
  state: ImageConfigTestState;
  onDraftChange: (draft: ImageConfigTestDraft) => void;
  onSaveDraft: () => void;
}) {
  const { t } = useI18n();
  const runningCount = Object.values(state.records).filter((record) => record.testing).length;
  const activitySignal = runningCount > 0 ? `running:${runningCount}` : "";

  return (
    <SettingsCollapsibleModule
      title={t("settings.generation.imageTestTitle")}
      description={t("settings.generation.imageTestDescription")}
      activitySignal={activitySignal}
    >
      <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:border-slate-700 dark:bg-[#0b1220] dark:text-slate-400">
        {t("settings.generation.localTestDraftNote")}
      </p>
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
      />
      <SettingsFormField label={t("settings.generation.imageTestPrompt")}>
        <textarea
          value={state.draft.prompt}
          onChange={(event) => onDraftChange({ ...state.draft, prompt: event.target.value })}
          className={`${TEXTAREA_CLASS} min-h-28 resize-y`}
        />
      </SettingsFormField>
      {runningCount > 0 ? (
        <div className="flex items-start gap-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-3 text-sm text-indigo-800 dark:border-violet-400/35 dark:bg-violet-500/12 dark:text-violet-100">
          <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin" />
          <div>
            <div className="font-semibold">{t("settings.generation.imageTestRunning")}</div>
            <div className="mt-0.5 text-xs text-indigo-700/80 dark:text-violet-100/75">
              {t("settings.generation.imageTestRunningDetail")}
            </div>
          </div>
        </div>
      ) : null}
    </SettingsCollapsibleModule>
  );
}
