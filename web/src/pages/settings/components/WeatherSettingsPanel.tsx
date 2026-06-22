// 天气设置面板：天气源与刷新间隔，写入本地偏好。

import { useState } from "react";

import { Save } from "lucide-react";

import { SelectField } from "../../../components/SelectField";
import { useI18n } from "../../../lib/preferences";
import {
  MAX_WEATHER_REFRESH_MINUTES,
  MIN_WEATHER_REFRESH_MINUTES,
  WEATHER_SOURCE_IDS,
  normalizeWeatherSourceId,
  readWeatherSettings,
  weatherSources,
  writeWeatherRefreshMinutes,
  writeWeatherSourceId,
} from "../../../lib/weatherSources";
import { SettingsFormField } from "./SettingsFormField";
import { INPUT_CLASS, PANEL_CLASS, SETTINGS_COMPACT_ACTION_CLASS } from "./styles";

export function WeatherSettingsPanel({ onSaved }: { onSaved: () => void }) {
  const { t } = useI18n();
  const [weatherSettings, setWeatherSettings] = useState(readWeatherSettings);
  const saveWeatherSettings = () => {
    const sourceId = normalizeWeatherSourceId(weatherSettings.sourceId);
    writeWeatherSourceId(sourceId);
    writeWeatherRefreshMinutes(weatherSettings.refreshMinutes);
    setWeatherSettings(readWeatherSettings());
    onSaved();
  };

  return (
    <section className={`${PANEL_CLASS} space-y-5`}>
      <div>
        <h2 className="text-base font-semibold text-slate-950 dark:text-white">
          {t("settings.weather.title")}
        </h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">
          {t("settings.weather.description")}
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <SettingsFormField label={t("settings.weather.source")}>
          <SelectField
            value={weatherSettings.sourceId}
            options={WEATHER_SOURCE_IDS.map((sourceId) => ({
              value: sourceId,
              label: t(weatherSources[sourceId].labelKey),
            }))}
            onChange={(value) => {
              const sourceId = normalizeWeatherSourceId(value);
              setWeatherSettings((current) => ({ ...current, sourceId }));
            }}
            radius="lg"
          />
        </SettingsFormField>
        <SettingsFormField label={t("settings.weather.refreshMinutes")}>
          <input
            type="number"
            min={MIN_WEATHER_REFRESH_MINUTES}
            max={MAX_WEATHER_REFRESH_MINUTES}
            value={weatherSettings.refreshMinutes}
            onChange={(event) => {
              const nextValue = Number(event.target.value);
              setWeatherSettings((current) => ({ ...current, refreshMinutes: nextValue }));
            }}
            className={INPUT_CLASS}
          />
        </SettingsFormField>
      </div>
      <div className="flex justify-end">
        <button type="button" onClick={saveWeatherSettings} className={SETTINGS_COMPACT_ACTION_CLASS}>
          <Save size={14} className="mr-1.5" />
          {t("common.save")}
        </button>
      </div>
    </section>
  );
}
