/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "../test/setup";
import type { CurrentWeather, WeatherLocation } from "./types";

const mocks = vi.hoisted(() => ({
  getCurrentWeather: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("./preferences", () => ({
  usePreferences: () => ({
    locale: "en-US",
    t: (key: string) => key,
  }),
}));

vi.mock("./notifications", () => ({
  useNotifications: () => ({ notify: mocks.notify }),
}));

vi.mock("./weatherSources", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./weatherSources")>();
  return {
    ...actual,
    getCurrentWeatherFromSource: mocks.getCurrentWeather,
    subscribeWeatherSettingsChange: () => () => undefined,
  };
});

import {
  CurrentWeatherProvider,
  useCurrentWeather,
  WEATHER_LOCATION_STORAGE_KEY,
  WEATHER_LOCATION_V2_STORAGE_KEY,
} from "./currentWeather";

const location: WeatherLocation = {
  name: "Shanghai",
  country: "China",
  latitude: 31.23,
  longitude: 121.47,
};

const clearWeather: CurrentWeather = {
  weather_code: 0,
  condition: "clear",
  temperature_celsius: 26,
  humidity_percent: 55,
  pressure_hpa: 1012,
  is_day: true,
  observed_at: "2026-07-19T08:00:00Z",
  timezone: "Asia/Shanghai",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function WeatherStateProbe() {
  const weatherState = useCurrentWeather();
  return (
    <>
      <div data-testid="condition">{weatherState.weather?.condition ?? "none"}</div>
      <div data-testid="fetch-state">{weatherState.viewState.fetch}</div>
      <div data-testid="refreshing">{String(weatherState.isRefreshingWeather)}</div>
      <div data-testid="error-key">{weatherState.errorKey ?? "none"}</div>
      <button type="button" onClick={() => void weatherState.refreshWeather()}>
        refresh
      </button>
    </>
  );
}

function renderWeatherProvider(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CurrentWeatherProvider enabled>{children}</CurrentWeatherProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("CurrentWeatherProvider manual refresh", () => {
  it("keeps cached weather visible across a failed refresh and clears the error after success", async () => {
    window.localStorage.setItem(WEATHER_LOCATION_STORAGE_KEY, "Shanghai");
    window.localStorage.setItem(
      WEATHER_LOCATION_V2_STORAGE_KEY,
      JSON.stringify({ sourceId: "open_meteo", query: "Shanghai", location }),
    );
    mocks.getCurrentWeather.mockResolvedValueOnce(clearWeather);

    renderWeatherProvider(<WeatherStateProbe />);

    await waitFor(() => expect(screen.getByTestId("condition").textContent).toBe("clear"));
    expect(screen.getByTestId("error-key").textContent).toBe("none");

    const failedRefresh = deferred<CurrentWeather>();
    mocks.getCurrentWeather.mockReturnValueOnce(failedRefresh.promise);
    await userEvent.setup().click(screen.getByRole("button", { name: "refresh" }));

    await waitFor(() => expect(screen.getByTestId("refreshing").textContent).toBe("true"));
    expect(screen.getByTestId("fetch-state").textContent).toBe("fetching");
    expect(screen.getByTestId("condition").textContent).toBe("clear");

    await act(async () => {
      failedRefresh.reject(new Error("offline"));
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId("error-key").textContent).toBe("weather.loadFailed"));
    expect(screen.getByTestId("refreshing").textContent).toBe("false");
    expect(screen.getByTestId("condition").textContent).toBe("clear");

    const refreshedWeather: CurrentWeather = {
      ...clearWeather,
      condition: "rain",
      weather_code: 61,
      observed_at: "2026-07-19T08:10:00Z",
    };
    mocks.getCurrentWeather.mockResolvedValueOnce(refreshedWeather);
    await userEvent.setup().click(screen.getByRole("button", { name: "refresh" }));

    await waitFor(() => expect(screen.getByTestId("condition").textContent).toBe("rain"));
    expect(screen.getByTestId("error-key").textContent).toBe("none");
    expect(screen.getByTestId("refreshing").textContent).toBe("false");
  });
});
