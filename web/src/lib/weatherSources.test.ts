import { describe, expect, it } from "vitest";

import {
  DEFAULT_WEATHER_REFRESH_MINUTES,
  DEFAULT_WEATHER_SOURCE_ID,
  MAX_WEATHER_REFRESH_MINUTES,
  MIN_WEATHER_REFRESH_MINUTES,
  normalizeWeatherRefreshMinutes,
  normalizeWeatherSourceId,
} from "./weatherSources";

describe("normalizeWeatherSourceId", () => {
  it("keeps supported sources and falls back for unknown values", () => {
    expect(normalizeWeatherSourceId("open_meteo")).toBe("open_meteo");
    expect(normalizeWeatherSourceId("unknown")).toBe(DEFAULT_WEATHER_SOURCE_ID);
    expect(normalizeWeatherSourceId(null)).toBe(DEFAULT_WEATHER_SOURCE_ID);
  });
});

describe("normalizeWeatherRefreshMinutes", () => {
  it("clamps invalid and out-of-range refresh intervals", () => {
    expect(normalizeWeatherRefreshMinutes("bad")).toBe(DEFAULT_WEATHER_REFRESH_MINUTES);
    expect(normalizeWeatherRefreshMinutes(0)).toBe(MIN_WEATHER_REFRESH_MINUTES);
    expect(normalizeWeatherRefreshMinutes(500)).toBe(MAX_WEATHER_REFRESH_MINUTES);
    expect(normalizeWeatherRefreshMinutes(12.4)).toBe(12);
  });
});
