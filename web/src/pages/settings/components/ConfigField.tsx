// 单个运行时配置项的编辑控件（row / card 两种布局）。从 SettingsPage.tsx 抽出，行为不变。

import { useI18n } from "../../../lib/preferences";
import type { ConfigItem } from "../../../lib/types";
import { ParameterHelpLabel } from "../../../components/ParameterHelp";
import { ClassicSelectField, ClassicTextInput, ClassicTextarea } from "../../../components/classicInputs";
import { WorkspaceSelectField, WorkspaceTextInput, WorkspaceTextarea } from "../../../components/workspaceInputs";
import { configItemHelpContent } from "../configHelp";
import { sourceClassName, sourceLabel } from "../configSource";
import type { DraftValue } from "../types";
import { ConfigFieldResetButton } from "./ConfigFieldResetButton";
import { SETTINGS_FIELD_CARD_CLASS } from "./styles";
import { SettingsOptionToggle, SettingsSwitchToggle } from "./Toggles";

interface ConfigFieldProps {
  item: ConfigItem;
  value: DraftValue;
  secretTouched: boolean;
  isResetting: boolean;
  disabled?: boolean;
  layout?: "row" | "card";
  workspaceSubpage?: boolean;
  onChange: (value: DraftValue, touchedSecret?: boolean) => void;
  onReset: () => void;
}

export function ConfigField({
  item,
  value,
  secretTouched,
  isResetting,
  disabled = false,
  layout = "row",
  workspaceSubpage = false,
  onChange,
  onReset,
}: ConfigFieldProps) {
  const { t } = useI18n();
  const helpContent = configItemHelpContent(item, t);
  const helpKey = helpContent ? (`settings.config.${item.key}` as const) : null;
  const selectedMultiValues = Array.isArray(value) ? value : [];
  const toggleMultiValue = (optionValue: string) => {
    const selected = new Set(selectedMultiValues);
    if (selected.has(optionValue)) {
      selected.delete(optionValue);
    } else {
      selected.add(optionValue);
    }
    onChange(item.options.filter((option) => selected.has(option.value)).map((option) => option.value));
  };
  const resetControl =
    item.source === "database" ? (
      <ConfigFieldResetButton
        label={item.label}
        busy={isResetting}
        disabled={disabled}
        onReset={onReset}
      />
    ) : null;
  const keyLine = (
    <div className="pf-settings-config-key min-w-0 break-all font-mono text-[11px] leading-5 text-zinc-400 dark:text-slate-500">
      {item.key}
    </div>
  );

  const control =
    item.input_type === "multi_select" ? (
      <div className="grid gap-2 sm:grid-cols-2">
        {item.options.map((option) => (
          <SettingsOptionToggle
            key={`${item.key}-${option.value}`}
            checked={selectedMultiValues.includes(option.value)}
            disabled={disabled}
            workspaceSubpage={workspaceSubpage}
            onChange={() => toggleMultiValue(option.value)}
          >
            {option.label}
          </SettingsOptionToggle>
        ))}
      </div>
    ) : item.input_type === "select" ? (
      workspaceSubpage ? (
        <WorkspaceSelectField
          id={item.key}
          value={String(value)}
          options={item.options}
          onChange={onChange}
          disabled={disabled}
          size="tall"
        />
      ) : (
        <ClassicSelectField
          id={item.key}
          value={String(value)}
          options={item.options}
          onChange={onChange}
          disabled={disabled}
          radius="xl"
        />
      )
    ) : item.input_type === "textarea" ? (
      workspaceSubpage ? (
        <WorkspaceTextarea
          id={item.key}
          value={String(value)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          rows={item.key.startsWith("prompt_") ? 10 : 3}
          variant={item.key.startsWith("prompt_") ? "prompt" : "default"}
          className={item.key.startsWith("prompt_") ? "min-h-[240px]" : undefined}
        />
      ) : (
        <ClassicTextarea
          id={item.key}
          value={String(value)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          rows={item.key.startsWith("prompt_") ? 10 : 3}
          variant={item.key.startsWith("prompt_") ? "prompt" : "default"}
          className={item.key.startsWith("prompt_") ? "min-h-[240px]" : "leading-6"}
        />
      )
    ) : item.input_type === "boolean" ? (
      <SettingsSwitchToggle
        inputId={item.key}
        checked={Boolean(value)}
        disabled={disabled}
        workspaceSubpage={workspaceSubpage}
        onChange={(checked) => onChange(checked)}
      >
        {Boolean(value) ? t("settings.enabled") : t("settings.disabled")}
      </SettingsSwitchToggle>
    ) : (
      workspaceSubpage ? (
        <WorkspaceTextInput
          id={item.key}
          type={item.input_type === "password" ? "password" : item.input_type === "number" ? "number" : "text"}
          value={String(value)}
          min={item.minimum ?? undefined}
          max={item.maximum ?? undefined}
          placeholder={item.secret && item.has_value ? t("settings.secretPlaceholder") : item.description || undefined}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value, item.secret)}
          size="tall"
          autoComplete={item.secret ? "new-password" : undefined}
        />
      ) : (
        <ClassicTextInput
          id={item.key}
          type={item.input_type === "password" ? "password" : item.input_type === "number" ? "number" : "text"}
          value={String(value)}
          min={item.minimum ?? undefined}
          max={item.maximum ?? undefined}
          placeholder={item.secret && item.has_value ? t("settings.secretPlaceholder") : item.description || undefined}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value, item.secret)}
          size="tall"
          autoComplete={item.secret ? "new-password" : undefined}
        />
      )
    );

  if (layout === "card") {
    return (
      <div className={`${SETTINGS_FIELD_CARD_CLASS} rounded-2xl border border-slate-200 bg-white p-4 shadow-none dark:border-slate-800 dark:bg-[#0f1726]`}>
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={item.key} className="block text-sm font-semibold text-zinc-950 dark:text-white">
              {helpKey ? (
                <ParameterHelpLabel
                  label={item.label}
                  helpKey={helpKey}
                  uiType="settings"
                  content={helpContent ?? undefined}
                />
              ) : (
                item.label
              )}
            </label>
            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${sourceClassName(item)}`}>
              {sourceLabel(item, t)}
            </span>
          </div>
          {keyLine}
          <p className="min-h-4 text-xs leading-5 text-zinc-500 dark:text-slate-400">{item.description}</p>
          {item.secret && secretTouched ? (
            <div className="mt-1 text-xs text-amber-600 dark:text-amber-300">{t("settings.writeNewSecret")}</div>
          ) : null}
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">{control}</div>
          {resetControl}
        </div>
      </div>
    );
  }

  return (
    <div className="border-t border-slate-100 py-5 first:border-t-0 dark:border-slate-800">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={item.key} className="text-sm font-medium text-zinc-900 dark:text-white">
            {helpKey ? (
              <ParameterHelpLabel label={item.label} helpKey={helpKey} uiType="settings" content={helpContent ?? undefined} />
            ) : (
              item.label
            )}
          </label>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${sourceClassName(item)}`}>
            {sourceLabel(item, t)}
          </span>
        </div>
        {keyLine}
        <p className="min-h-4 text-xs leading-5 text-zinc-500 dark:text-slate-400">
          {item.description}
          {item.secret && secretTouched ? (
            <span className="ml-2 text-amber-600 dark:text-amber-300">{t("settings.writeNewSecret")}</span>
          ) : null}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">{control}</div>
          {resetControl}
        </div>
      </div>
    </div>
  );
}
