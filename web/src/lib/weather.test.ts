import { describe, expect, it } from "vitest";

import {
  isBadWeatherCondition,
  isExtremeWeather,
  isExtremeWeatherCode,
  isLocalDaytime,
  weatherConditionFromCode,
  weatherConditionTranslationKey,
  weatherLocationDisplayName,
} from "./weather";

describe("weatherConditionFromCode", () => {
  it("maps Open-Meteo clear and cloud codes", () => {
    expect(weatherConditionFromCode(0)).toBe("clear");
    expect(weatherConditionFromCode(1)).toBe("partly_cloudy");
    expect(weatherConditionFromCode(2)).toBe("partly_cloudy");
    expect(weatherConditionFromCode(3)).toBe("cloudy");
  });

  it("maps precipitation and storm codes", () => {
    expect(weatherConditionFromCode(45)).toBe("fog");
    expect(weatherConditionFromCode(53)).toBe("drizzle");
    expect(weatherConditionFromCode(63)).toBe("rain");
    expect(weatherConditionFromCode(81)).toBe("rain");
    expect(weatherConditionFromCode(73)).toBe("snow");
    expect(weatherConditionFromCode(95)).toBe("thunderstorm");
  });

  it("falls back to cloudy for unknown values", () => {
    expect(weatherConditionFromCode(500)).toBe("cloudy");
    expect(weatherConditionFromCode(Number.NaN)).toBe("cloudy");
  });
});

describe("weatherConditionTranslationKey", () => {
  it("returns stable i18n keys", () => {
    expect(weatherConditionTranslationKey("clear")).toBe("weather.clear");
    expect(weatherConditionTranslationKey("thunderstorm")).toBe("weather.thunderstorm");
  });
});

describe("isLocalDaytime", () => {
  it("uses local 06:00-17:59 as daytime", () => {
    expect(isLocalDaytime(new Date("2026-06-07T05:59:00"))).toBe(false);
    expect(isLocalDaytime(new Date("2026-06-07T06:00:00"))).toBe(true);
    expect(isLocalDaytime(new Date("2026-06-07T17:59:00"))).toBe(true);
    expect(isLocalDaytime(new Date("2026-06-07T18:00:00"))).toBe(false);
  });
});

describe("isBadWeatherCondition", () => {
  it("flags weather that should interrupt attention", () => {
    expect(isBadWeatherCondition("clear")).toBe(false);
    expect(isBadWeatherCondition("partly_cloudy")).toBe(false);
    expect(isBadWeatherCondition("cloudy")).toBe(false);
    expect(isBadWeatherCondition("drizzle")).toBe(true);
    expect(isBadWeatherCondition("rain")).toBe(true);
    expect(isBadWeatherCondition("snow")).toBe(true);
    expect(isBadWeatherCondition("thunderstorm")).toBe(true);
  });
});

describe("isExtremeWeather", () => {
  it("flags Open-Meteo severe precipitation and thunderstorm codes", () => {
    expect(isExtremeWeatherCode(0)).toBe(false);
    expect(isExtremeWeatherCode(63)).toBe(false);
    expect(isExtremeWeatherCode(65)).toBe(true);
    expect(isExtremeWeatherCode(82)).toBe(true);
    expect(isExtremeWeatherCode(95)).toBe(true);
    expect(
      isExtremeWeather({
        weather_code: 86,
        condition: "snow",
        temperature_celsius: null,
        is_day: true,
      }),
    ).toBe(true);
  });
});

describe("weatherLocationDisplayName", () => {
  it("joins available location labels", () => {
    expect(
      weatherLocationDisplayName({
        id: 1,
        name: "Hangzhou",
        admin1: "Zhejiang",
        country: "China",
        latitude: 30.25,
        longitude: 120.17,
      }),
    ).toBe("Hangzhou, Zhejiang, China");
    expect(weatherLocationDisplayName(null)).toBe("");
  });
});
