import { api } from "./api";
import type { TranslationKey } from "./i18n";
import type { CurrentWeather, WeatherLocation, WeatherSourceId } from "./types";

export const WEATHER_SOURCE_STORAGE_KEY = "inspiration-one.weather-source";
export const WEATHER_REFRESH_MINUTES_STORAGE_KEY = "inspiration-one.weather-refresh-minutes";
export const DEFAULT_WEATHER_SOURCE_ID: WeatherSourceId = "open_meteo";
export const DEFAULT_WEATHER_REFRESH_MINUTES = 15;
export const MIN_WEATHER_REFRESH_MINUTES = 1;
export const MAX_WEATHER_REFRESH_MINUTES = 120;
export const WEATHER_SETTINGS_CHANGE_EVENT = "inspiration-one:weather-settings-change";

export interface WeatherLocationSearchInput {
  query: string;
  language?: string;
}

export interface WeatherSource {
  id: WeatherSourceId;
  labelKey: TranslationKey;
  searchLocations: (input: WeatherLocationSearchInput) => Promise<WeatherLocation[]>;
  getCurrentWeather: (location: WeatherLocation) => Promise<CurrentWeather>;
}

export interface WeatherSettings {
  sourceId: WeatherSourceId;
  refreshMinutes: number;
}

export const weatherSources: Record<WeatherSourceId, WeatherSource> = {
  open_meteo: {
    id: "open_meteo",
    labelKey: "weather.source.openMeteo",
    searchLocations: (input) => api.searchWeatherLocations(input),
    getCurrentWeather: (location) => api.getCurrentWeather(location),
  },
};

export const WEATHER_SOURCE_IDS = Object.keys(weatherSources) as WeatherSourceId[];

export function isWeatherSourceId(value: string | null | undefined): value is WeatherSourceId {
  return Boolean(value && value in weatherSources);
}

export function normalizeWeatherSourceId(value: string | null | undefined): WeatherSourceId {
  return isWeatherSourceId(value) ? value : DEFAULT_WEATHER_SOURCE_ID;
}

export function normalizeWeatherRefreshMinutes(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return DEFAULT_WEATHER_REFRESH_MINUTES;
  }
  return Math.min(MAX_WEATHER_REFRESH_MINUTES, Math.max(MIN_WEATHER_REFRESH_MINUTES, Math.round(parsed)));
}

export function readWeatherSettings(): WeatherSettings {
  if (typeof window === "undefined") {
    return {
      sourceId: DEFAULT_WEATHER_SOURCE_ID,
      refreshMinutes: DEFAULT_WEATHER_REFRESH_MINUTES,
    };
  }

  return {
    sourceId: normalizeWeatherSourceId(window.localStorage.getItem(WEATHER_SOURCE_STORAGE_KEY)),
    refreshMinutes: normalizeWeatherRefreshMinutes(window.localStorage.getItem(WEATHER_REFRESH_MINUTES_STORAGE_KEY)),
  };
}

export function writeWeatherSourceId(sourceId: WeatherSourceId): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(WEATHER_SOURCE_STORAGE_KEY, sourceId);
  window.dispatchEvent(new CustomEvent(WEATHER_SETTINGS_CHANGE_EVENT));
}

export function writeWeatherRefreshMinutes(refreshMinutes: number): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(WEATHER_REFRESH_MINUTES_STORAGE_KEY, String(normalizeWeatherRefreshMinutes(refreshMinutes)));
  window.dispatchEvent(new CustomEvent(WEATHER_SETTINGS_CHANGE_EVENT));
}

export function subscribeWeatherSettingsChange(listener: () => void): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  const handleStorage = (event: StorageEvent) => {
    if (event.key === WEATHER_SOURCE_STORAGE_KEY || event.key === WEATHER_REFRESH_MINUTES_STORAGE_KEY) {
      listener();
    }
  };
  const handleLocalChange = () => listener();
  window.addEventListener("storage", handleStorage);
  window.addEventListener(WEATHER_SETTINGS_CHANGE_EVENT, handleLocalChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(WEATHER_SETTINGS_CHANGE_EVENT, handleLocalChange);
  };
}

export function searchWeatherLocations(
  sourceId: WeatherSourceId,
  input: WeatherLocationSearchInput,
): Promise<WeatherLocation[]> {
  return weatherSources[sourceId].searchLocations(input);
}

export function getCurrentWeatherFromSource(
  sourceId: WeatherSourceId,
  location: WeatherLocation,
): Promise<CurrentWeather> {
  return weatherSources[sourceId].getCurrentWeather(location);
}
