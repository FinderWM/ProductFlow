import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import type { TranslationKey } from "./i18n";
import type { NotificationBodyLine, NotificationInput, NotificationVariant } from "./notifications";
import { useNotifications } from "./notifications";
import { usePreferences } from "./preferences";
import type { CurrentWeather, WeatherLocation, WeatherSourceId } from "./types";
import {
  isBadWeatherCondition,
  isExtremeWeather,
  isLocalDaytime,
  weatherConditionTranslationKey,
  weatherLocationDisplayName,
} from "./weather";
import {
  getCurrentWeatherFromSource,
  readWeatherSettings,
  searchWeatherLocations,
  subscribeWeatherSettingsChange,
  type WeatherSettings,
} from "./weatherSources";

export const WEATHER_LOCATION_STORAGE_KEY = "inspiration-one.weather-location";
export const WEATHER_LOCATION_V2_STORAGE_KEY = "inspiration-one.weather-location-v2";
const FALLBACK_CLOCK_REFRESH_MS = 60 * 1000;

interface SavedWeatherLocation {
  sourceId: WeatherSourceId | null;
  query: string;
  location: WeatherLocation | null;
}

interface CurrentWeatherContextValue {
  savedLocationQuery: string;
  resolvedLocation: WeatherLocation | null;
  weather: CurrentWeather | null;
  weatherSourceId: WeatherSourceId;
  weatherRefreshMinutes: number;
  hasSavedLocation: boolean;
  fallbackIsDay: boolean;
  isLoading: boolean;
  isRefreshingWeather: boolean;
  nextWeatherRefreshAt: number | null;
  errorKey: TranslationKey | null;
  setWeatherLocation: (location: WeatherLocation, query: string) => void;
  clearWeatherLocation: () => void;
  refreshWeather: () => Promise<void>;
}

const CurrentWeatherContext = createContext<CurrentWeatherContextValue | null>(null);

type WeatherNotificationReason = "latest" | "bad";
type Translate = (key: TranslationKey, params?: Record<string, string | number>) => string;

function readSavedLocationQuery(): string {
  if (typeof window === "undefined") {
    return "";
  }
  return window.localStorage.getItem(WEATHER_LOCATION_STORAGE_KEY)?.trim() ?? "";
}

function isWeatherLocation(value: unknown): value is WeatherLocation {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<WeatherLocation>;
  return (
    typeof candidate.name === "string" &&
    typeof candidate.latitude === "number" &&
    Number.isFinite(candidate.latitude) &&
    typeof candidate.longitude === "number" &&
    Number.isFinite(candidate.longitude)
  );
}

function readSavedWeatherLocation(): SavedWeatherLocation {
  if (typeof window === "undefined") {
    return { sourceId: null, query: "", location: null };
  }
  const raw = window.localStorage.getItem(WEATHER_LOCATION_V2_STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<SavedWeatherLocation>;
      if (typeof parsed.query === "string" && parsed.query.trim() && isWeatherLocation(parsed.location)) {
        return {
          sourceId: parsed.sourceId ?? null,
          query: parsed.query.trim(),
          location: parsed.location,
        };
      }
    } catch {
      // Ignore invalid legacy browser-local data and fall back to the old query key.
    }
  }
  const legacyQuery = readSavedLocationQuery();
  return { sourceId: null, query: legacyQuery, location: null };
}

function writeSavedWeatherLocation(savedLocation: SavedWeatherLocation) {
  if (typeof window === "undefined") {
    return;
  }
  const nextQuery = savedLocation.query.trim();
  if (nextQuery) {
    window.localStorage.setItem(WEATHER_LOCATION_STORAGE_KEY, nextQuery);
    if (savedLocation.location) {
      window.localStorage.setItem(
        WEATHER_LOCATION_V2_STORAGE_KEY,
        JSON.stringify({
          sourceId: savedLocation.sourceId,
          query: nextQuery,
          location: savedLocation.location,
        }),
      );
    }
    return;
  }
  window.localStorage.removeItem(WEATHER_LOCATION_STORAGE_KEY);
  window.localStorage.removeItem(WEATHER_LOCATION_V2_STORAGE_KEY);
}

export function weatherGeocodingLanguage(locale: string | undefined): string {
  if (locale === "en-US") {
    return "en";
  }
  if (locale === "ja-JP") {
    return "ja";
  }
  return "zh";
}

function weatherErrorKey({
  hasSavedLocation,
  locationError,
  locationLoaded,
  resolvedLocation,
  weatherError,
}: {
  hasSavedLocation: boolean;
  locationError: unknown;
  locationLoaded: boolean;
  resolvedLocation: WeatherLocation | null;
  weatherError: unknown;
}): TranslationKey | null {
  if (locationError) {
    return "weather.locationFailed";
  }
  if (hasSavedLocation && locationLoaded && !resolvedLocation) {
    return "weather.locationNotFound";
  }
  if (weatherError) {
    return "weather.loadFailed";
  }
  return null;
}

function weatherNotificationVariant(weather: CurrentWeather): NotificationVariant {
  if (isExtremeWeather(weather)) {
    return "error";
  }
  if (isBadWeatherCondition(weather.condition)) {
    return "warning";
  }
  return "info";
}

function weatherAlertKey(sourceId: WeatherSourceId, location: WeatherLocation, weather: CurrentWeather): string {
  return [
    sourceId,
    location.latitude.toFixed(4),
    location.longitude.toFixed(4),
    weather.condition,
    weather.observed_at ?? "unknown",
  ].join(":");
}

export function buildCurrentWeatherNotification({
  location,
  locationQuery,
  reason,
  t,
  weather,
}: {
  location: WeatherLocation;
  locationQuery: string;
  reason: WeatherNotificationReason;
  t: Translate;
  weather: CurrentWeather;
}): Pick<NotificationInput, "title" | "bodyLines" | "variant" | "autoClose"> {
  const locationName = weatherLocationDisplayName(location) || locationQuery;
  const condition = t(weatherConditionTranslationKey(weather.condition));
  const badWeather = isBadWeatherCondition(weather.condition);
  const extremeWeather = isExtremeWeather(weather);
  const conditionTone: NotificationBodyLine["tone"] = extremeWeather ? "danger" : badWeather ? "warning" : "default";
  const adviceTone: NotificationBodyLine["tone"] = extremeWeather ? "danger" : badWeather ? "warning" : "muted";
  const adviceKey = extremeWeather
    ? "weather.alert.extremeAdviceLine"
    : badWeather
      ? "weather.alert.badAdviceLine"
      : "weather.alert.latestAdviceLine";

  return {
    title:
      reason === "bad"
        ? t(extremeWeather ? "weather.alert.extremeTitle" : "weather.alert.badTitle")
        : t("weather.alert.latestTitle"),
    bodyLines: [
      { text: t("weather.alert.locationLine", { location: locationName }) },
      { text: t("weather.alert.conditionLine", { condition }), tone: conditionTone },
      { text: t(adviceKey), tone: adviceTone },
    ],
    variant: weatherNotificationVariant(weather),
    autoClose: true,
  };
}

export function CurrentWeatherProvider({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const { locale, t } = usePreferences();
  const { notify } = useNotifications();
  const [savedLocation, setSavedLocation] = useState(readSavedWeatherLocation);
  const [weatherSettings, setWeatherSettings] = useState<WeatherSettings>(readWeatherSettings);
  const [fallbackClock, setFallbackClock] = useState(() => Date.now());
  const [nextWeatherRefreshAt, setNextWeatherRefreshAt] = useState<number | null>(null);
  const notifiedWeatherKeysRef = useRef<Set<string>>(new Set());
  const startupWeatherNotificationSentRef = useRef(false);
  const manualRefreshNotificationSeqRef = useRef(0);
  const sourceLocationAlertKeysRef = useRef<Set<string>>(new Set());
  const sourceWeatherAlertKeysRef = useRef<Set<string>>(new Set());
  const pendingSourceSwitchWeatherKeyRef = useRef<string | null>(null);
  const savedLocationQuery = savedLocation.query;
  const hasSavedLocation = savedLocationQuery.trim().length > 0;
  const weatherRefreshMs = weatherSettings.refreshMinutes * 60 * 1000;

  useEffect(() => {
    if (hasSavedLocation) {
      return;
    }
    const timer = window.setInterval(() => setFallbackClock(Date.now()), FALLBACK_CLOCK_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [hasSavedLocation]);

  useEffect(() => subscribeWeatherSettingsChange(() => setWeatherSettings(readWeatherSettings())), []);

  const locationQuery = savedLocationQuery.trim();
  const locationNeedsLookup =
    hasSavedLocation && (!savedLocation.location || savedLocation.sourceId !== weatherSettings.sourceId);
  const locationQueryResult = useQuery({
    queryKey: ["weather-location", weatherSettings.sourceId, locationQuery, weatherGeocodingLanguage(locale)],
    queryFn: async () => {
      const locations = await searchWeatherLocations(weatherSettings.sourceId, {
        query: locationQuery,
        language: weatherGeocodingLanguage(locale),
      });
      return locations[0] ?? null;
    },
    enabled: enabled && locationNeedsLookup,
    retry: false,
    staleTime: weatherRefreshMs,
    gcTime: weatherRefreshMs,
  });
  const resolvedLocation = locationNeedsLookup ? (locationQueryResult.data ?? null) : savedLocation.location;

  useEffect(() => {
    if (!locationNeedsLookup || !locationQueryResult.data) {
      return;
    }
    if (savedLocation.sourceId && savedLocation.sourceId !== weatherSettings.sourceId) {
      pendingSourceSwitchWeatherKeyRef.current = [
        savedLocation.sourceId,
        weatherSettings.sourceId,
        locationQueryResult.data.latitude.toFixed(4),
        locationQueryResult.data.longitude.toFixed(4),
        locationQuery,
      ].join(":");
    }
    const nextSavedLocation = {
      sourceId: weatherSettings.sourceId,
      query: locationQuery,
      location: locationQueryResult.data,
    } satisfies SavedWeatherLocation;
    writeSavedWeatherLocation(nextSavedLocation);
    setSavedLocation(nextSavedLocation);
  }, [locationNeedsLookup, locationQuery, locationQueryResult.data, savedLocation.sourceId, weatherSettings.sourceId]);

  useEffect(() => {
    if (
      !enabled ||
      !locationNeedsLookup ||
      !savedLocation.sourceId ||
      savedLocation.sourceId === weatherSettings.sourceId ||
      !locationQueryResult.isSuccess ||
      locationQueryResult.data
    ) {
      return;
    }
    const alertKey = `${savedLocation.sourceId}:${weatherSettings.sourceId}:${locationQuery}`;
    if (sourceLocationAlertKeysRef.current.has(alertKey)) {
      return;
    }
    sourceLocationAlertKeysRef.current.add(alertKey);
    notify({
      title: t("weather.alert.sourceLocationMissingTitle"),
      body: t("weather.alert.sourceLocationMissingBody", { location: locationQuery }),
      variant: "warning",
      autoClose: false,
      dedupeKey: `weather-source-location-missing:${alertKey}`,
    });
  }, [
    enabled,
    locationNeedsLookup,
    locationQuery,
    locationQueryResult.data,
    locationQueryResult.isSuccess,
    notify,
    savedLocation.sourceId,
    t,
    weatherSettings.sourceId,
  ]);

  const weatherQuery = useQuery({
    queryKey: [
      "current-weather",
      weatherSettings.sourceId,
      resolvedLocation?.latitude.toFixed(4) ?? null,
      resolvedLocation?.longitude.toFixed(4) ?? null,
    ],
    queryFn: () => {
      if (!resolvedLocation) {
        return Promise.resolve(null);
      }
      return getCurrentWeatherFromSource(weatherSettings.sourceId, resolvedLocation);
    },
    enabled: enabled && Boolean(resolvedLocation),
    retry: false,
    staleTime: weatherRefreshMs,
  });
  const weatherQueryEnabled = enabled && Boolean(resolvedLocation);
  const weatherRefetchRef = useRef(weatherQuery.refetch);

  useEffect(() => {
    weatherRefetchRef.current = weatherQuery.refetch;
  }, [weatherQuery.refetch]);

  useEffect(() => {
    if (!weatherQueryEnabled) {
      setNextWeatherRefreshAt(null);
      return undefined;
    }
    const latestSettledAt = Math.max(weatherQuery.dataUpdatedAt, weatherQuery.errorUpdatedAt);
    const nextRefreshAt = (latestSettledAt > 0 ? latestSettledAt : Date.now()) + weatherRefreshMs;
    setNextWeatherRefreshAt(nextRefreshAt);
    const timer = window.setTimeout(() => {
      void weatherRefetchRef.current();
    }, Math.max(0, nextRefreshAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [weatherQuery.dataUpdatedAt, weatherQuery.errorUpdatedAt, weatherQueryEnabled, weatherRefreshMs]);

  useEffect(() => {
    if (!weatherQuery.data) {
      return;
    }
    pendingSourceSwitchWeatherKeyRef.current = null;
  }, [weatherQuery.data]);

  useEffect(() => {
    const alertKey = pendingSourceSwitchWeatherKeyRef.current;
    if (!enabled || !alertKey || !weatherQuery.error) {
      return;
    }
    if (sourceWeatherAlertKeysRef.current.has(alertKey)) {
      return;
    }
    sourceWeatherAlertKeysRef.current.add(alertKey);
    notify({
      title: t("weather.alert.sourceLocationMissingTitle"),
      body: t("weather.alert.sourceWeatherMissingBody", { location: locationQuery }),
      variant: "warning",
      autoClose: false,
      dedupeKey: `weather-source-weather-missing:${alertKey}`,
    });
  }, [enabled, locationQuery, notify, t, weatherQuery.error]);

  useEffect(() => {
    const weather = weatherQuery.data;
    if (
      !enabled ||
      !startupWeatherNotificationSentRef.current ||
      !weather ||
      !resolvedLocation ||
      !isBadWeatherCondition(weather.condition)
    ) {
      return;
    }
    const weatherKey = weatherAlertKey(weatherSettings.sourceId, resolvedLocation, weather);
    if (notifiedWeatherKeysRef.current.has(weatherKey)) {
      return;
    }
    notifiedWeatherKeysRef.current.add(weatherKey);
    notify({
      ...buildCurrentWeatherNotification({
        location: resolvedLocation,
        locationQuery,
        reason: "bad",
        t,
        weather,
      }),
      dedupeKey: `weather-bad:${weatherKey}`,
    });
  }, [enabled, locationQuery, notify, resolvedLocation, t, weatherQuery.data, weatherSettings.sourceId]);

  useEffect(() => {
    const weather = weatherQuery.data;
    if (!enabled || startupWeatherNotificationSentRef.current || !weather || !resolvedLocation) {
      return;
    }
    const weatherKey = weatherAlertKey(weatherSettings.sourceId, resolvedLocation, weather);
    const startupKey = `weather-startup:${weatherKey}`;
    startupWeatherNotificationSentRef.current = true;
    if (isBadWeatherCondition(weather.condition)) {
      notifiedWeatherKeysRef.current.add(weatherKey);
    }
    notify({
      ...buildCurrentWeatherNotification({
        location: resolvedLocation,
        locationQuery,
        reason: "latest",
        t,
        weather,
      }),
      dedupeKey: startupKey,
    });
  }, [enabled, locationQuery, notify, resolvedLocation, t, weatherQuery.data, weatherSettings.sourceId]);

  const setWeatherLocation = useCallback((location: WeatherLocation, query: string) => {
    const nextQuery = query.trim();
    const nextSavedLocation = {
      sourceId: weatherSettings.sourceId,
      query: nextQuery || weatherLocationDisplayName(location) || location.name,
      location,
    } satisfies SavedWeatherLocation;
    writeSavedWeatherLocation(nextSavedLocation);
    setSavedLocation(nextSavedLocation);
  }, [weatherSettings.sourceId]);
  const clearWeatherLocation = useCallback(() => {
    const nextSavedLocation = { sourceId: null, query: "", location: null } satisfies SavedWeatherLocation;
    writeSavedWeatherLocation(nextSavedLocation);
    setSavedLocation(nextSavedLocation);
  }, []);
  const refreshWeather = useCallback(async () => {
    if (!resolvedLocation) {
      return;
    }
    const result = await weatherRefetchRef.current();
    const weather = result.data ?? weatherQuery.data ?? null;
    if (!weather) {
      return;
    }
    const weatherKey = weatherAlertKey(weatherSettings.sourceId, resolvedLocation, weather);
    if (isBadWeatherCondition(weather.condition)) {
      notifiedWeatherKeysRef.current.add(weatherKey);
    }
    manualRefreshNotificationSeqRef.current += 1;
    notify({
      ...buildCurrentWeatherNotification({
        location: resolvedLocation,
        locationQuery,
        reason: "latest",
        t,
        weather,
      }),
      dedupeKey: `weather-manual:${weatherKey}:${manualRefreshNotificationSeqRef.current}`,
    });
  }, [locationQuery, notify, resolvedLocation, t, weatherQuery.data, weatherSettings.sourceId]);
  const value = useMemo<CurrentWeatherContextValue>(
    () => ({
      savedLocationQuery,
      resolvedLocation,
      weather: weatherQuery.data ?? null,
      weatherSourceId: weatherSettings.sourceId,
      weatherRefreshMinutes: weatherSettings.refreshMinutes,
      hasSavedLocation,
      fallbackIsDay: isLocalDaytime(new Date(fallbackClock)),
      isLoading: locationQueryResult.isLoading || weatherQuery.isLoading,
      isRefreshingWeather: weatherQuery.isFetching,
      nextWeatherRefreshAt,
      errorKey: weatherErrorKey({
        hasSavedLocation,
        locationError: locationQueryResult.error,
        locationLoaded: locationQueryResult.isSuccess,
        resolvedLocation,
        weatherError: weatherQuery.error,
      }),
      setWeatherLocation,
      clearWeatherLocation,
      refreshWeather,
    }),
    [
      clearWeatherLocation,
      fallbackClock,
      hasSavedLocation,
      nextWeatherRefreshAt,
      locationQueryResult.error,
      locationQueryResult.isLoading,
      locationQueryResult.isSuccess,
      refreshWeather,
      resolvedLocation,
      savedLocationQuery,
      setWeatherLocation,
      weatherSettings.refreshMinutes,
      weatherSettings.sourceId,
      weatherQuery.data,
      weatherQuery.error,
      weatherQuery.isFetching,
      weatherQuery.isLoading,
    ],
  );

  return <CurrentWeatherContext.Provider value={value}>{children}</CurrentWeatherContext.Provider>;
}

export function useCurrentWeather() {
  const context = useContext(CurrentWeatherContext);
  if (context) {
    return context;
  }
  return {
    savedLocationQuery: "",
    resolvedLocation: null,
    weather: null,
    weatherSourceId: "open_meteo",
    weatherRefreshMinutes: 15,
    hasSavedLocation: false,
    fallbackIsDay: isLocalDaytime(),
    isLoading: false,
    isRefreshingWeather: false,
    nextWeatherRefreshAt: null,
    errorKey: null,
    setWeatherLocation: () => undefined,
    clearWeatherLocation: () => undefined,
    refreshWeather: async () => undefined,
  } satisfies CurrentWeatherContextValue;
}
