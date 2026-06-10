import { useMemo } from "react";

import { useI18n, type TranslateFunction } from "../lib/preferences";
import {
  UI_LAYOUT_SCHEME_METADATA,
  isUiLayoutScheme,
} from "../lib/uiLayoutScheme";
import { useUiLayoutScheme } from "../lib/uiLayoutSchemePreference";
import { SelectField, type SelectFieldOption } from "./SelectField";

interface UiLayoutSchemeSettingsControlProps {
  className?: string;
}

export function uiLayoutSchemeSelectOptions(t: TranslateFunction): SelectFieldOption[] {
  return UI_LAYOUT_SCHEME_METADATA.filter((scheme) => scheme.supported).map((scheme) => ({
    value: scheme.id,
    label: t(scheme.labelKey),
  }));
}

export function UiLayoutSchemeSettingsControl({ className = "" }: UiLayoutSchemeSettingsControlProps) {
  const { t } = useI18n();
  const { defaultScheme, saveDefaultScheme, isLoadingDefaultScheme, isSavingDefaultScheme } = useUiLayoutScheme();
  const options = useMemo(() => uiLayoutSchemeSelectOptions(t), [t]);
  const selectedScheme = UI_LAYOUT_SCHEME_METADATA.find((scheme) => scheme.id === defaultScheme);
  const disabled = isLoadingDefaultScheme || isSavingDefaultScheme;

  function handleSchemeChange(value: string) {
    if (isUiLayoutScheme(value)) {
      saveDefaultScheme(value);
    }
  }

  return (
    <section
      className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/60 dark:border-slate-800 dark:bg-slate-950 dark:shadow-black/20 ${className}`}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(14rem,18rem)] lg:items-start">
        <div>
          <h2 className="text-base font-semibold text-slate-950 dark:text-white">
            {t("settings.layoutScheme.title")}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">
            {t("settings.layoutScheme.description")}
          </p>
          {selectedScheme ? (
            <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-slate-400">
              {t(selectedScheme.descriptionKey)}
            </p>
          ) : null}
        </div>
        <label className="block space-y-2">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
            {t("settings.layoutScheme.default")}
          </span>
          <SelectField
            value={defaultScheme}
            options={options}
            onChange={handleSchemeChange}
            ariaLabel={t("settings.layoutScheme.default")}
            disabled={disabled}
            radius="lg"
          />
          {isSavingDefaultScheme ? (
            <span className="block text-xs text-slate-500 dark:text-slate-400">
              {t("settings.layoutScheme.saving")}
            </span>
          ) : null}
        </label>
      </div>
    </section>
  );
}
