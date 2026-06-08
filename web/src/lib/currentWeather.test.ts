import { describe, expect, it } from "vitest";

import { translate } from "./i18n";
import { buildCurrentWeatherNotification } from "./currentWeather";
import type { CurrentWeather, WeatherLocation } from "./types";

const location: WeatherLocation = {
  id: 1,
  name: "Haizhu",
  admin1: "Guangdong",
  country: "China",
  latitude: 23.09,
  longitude: 113.31,
};

const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
  translate("zh-CN", key, params);

function weather(input: Partial<CurrentWeather>): CurrentWeather {
  return {
    weather_code: 0,
    condition: "clear",
    temperature_celsius: 26,
    is_day: true,
    ...input,
  };
}

describe("buildCurrentWeatherNotification", () => {
  it("builds latest weather notifications for good weather", () => {
    const notification = buildCurrentWeatherNotification({
      location,
      locationQuery: "广州海珠区",
      reason: "latest",
      t,
      weather: weather({ condition: "clear", weather_code: 0 }),
    });

    expect(notification.title).toBe("最新天气");
    expect(notification.variant).toBe("info");
    expect(notification.bodyLines?.map((line) => line.tone ?? "default")).toEqual([
      "default",
      "default",
      "muted",
    ]);
  });

  it("emphasizes bad weather without using the extreme tone", () => {
    const notification = buildCurrentWeatherNotification({
      location,
      locationQuery: "广州海珠区",
      reason: "latest",
      t,
      weather: weather({ condition: "rain", weather_code: 63 }),
    });

    expect(notification.title).toBe("最新天气");
    expect(notification.variant).toBe("warning");
    expect(notification.bodyLines?.map((line) => line.tone ?? "default")).toEqual([
      "default",
      "warning",
      "warning",
    ]);
  });

  it("uses error treatment for extreme weather", () => {
    const notification = buildCurrentWeatherNotification({
      location,
      locationQuery: "广州海珠区",
      reason: "bad",
      t,
      weather: weather({ condition: "thunderstorm", weather_code: 95 }),
    });

    expect(notification.title).toBe("极端天气提醒");
    expect(notification.variant).toBe("error");
    expect(notification.bodyLines?.map((line) => line.tone ?? "default")).toEqual([
      "default",
      "danger",
      "danger",
    ]);
  });
});
