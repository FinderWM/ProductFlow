import type { TranslationKey } from "./i18n";
import type { CurrentWeather, CurrentWeatherCondition, WeatherLocation } from "./types";

const conditionLabelKeys = {
  clear: "weather.clear",
  partly_cloudy: "weather.partlyCloudy",
  cloudy: "weather.cloudy",
  fog: "weather.fog",
  drizzle: "weather.drizzle",
  rain: "weather.rain",
  snow: "weather.snow",
  thunderstorm: "weather.thunderstorm",
} satisfies Record<CurrentWeatherCondition, TranslationKey>;

export function weatherConditionFromCode(code: number): CurrentWeatherCondition {
  if (!Number.isFinite(code)) {
    return "cloudy";
  }

  if (code === 0) {
    return "clear";
  }
  if (code === 1 || code === 2) {
    return "partly_cloudy";
  }
  if (code === 3) {
    return "cloudy";
  }
  if (code === 45 || code === 48) {
    return "fog";
  }
  if (code >= 51 && code <= 57) {
    return "drizzle";
  }
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) {
    return "rain";
  }
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) {
    return "snow";
  }
  if (code >= 95 && code <= 99) {
    return "thunderstorm";
  }

  return "cloudy";
}

export function weatherConditionTranslationKey(condition: CurrentWeatherCondition): TranslationKey {
  return conditionLabelKeys[condition];
}

export function isLocalDaytime(date = new Date()): boolean {
  const hour = date.getHours();
  return hour >= 6 && hour < 18;
}

export function isBadWeatherCondition(condition: CurrentWeatherCondition): boolean {
  return (
    condition === "fog" ||
    condition === "drizzle" ||
    condition === "rain" ||
    condition === "snow" ||
    condition === "thunderstorm"
  );
}

export function isExtremeWeatherCode(code: number): boolean {
  if (!Number.isFinite(code)) {
    return false;
  }
  return (
    code === 65 ||
    code === 66 ||
    code === 67 ||
    code === 75 ||
    code === 77 ||
    code === 82 ||
    code === 86 ||
    (code >= 95 && code <= 99)
  );
}

export function isExtremeWeather(weather: CurrentWeather): boolean {
  return isExtremeWeatherCode(weather.weather_code);
}

export function weatherLocationDisplayName(location: WeatherLocation | null): string {
  if (!location) {
    return "";
  }
  return [location.name, location.admin1, location.country].filter(Boolean).join(", ");
}
