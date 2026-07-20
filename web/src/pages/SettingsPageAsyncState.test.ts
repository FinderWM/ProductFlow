import { describe, expect, it } from "vitest";

import type { AsyncViewState } from "../lib/asyncViewState";
import { settingsSectionAsyncState } from "./SettingsPage";

const ready: AsyncViewState = {
  participation: "active",
  content: "ready",
  fetch: "idle",
  error: "none",
};

const inactive: AsyncViewState = {
  participation: "inactive",
  content: "none",
  fetch: "idle",
  error: "none",
};

function sectionStates(overrides: Partial<Parameters<typeof settingsSectionAsyncState>[1]> = {}) {
  return {
    config: inactive,
    providerProfiles: inactive,
    generationResourceGroups: inactive,
    providerGenerationConfigs: inactive,
    resourceGroupGenerationConfigs: inactive,
    textGenerationConfigs: inactive,
    imageGenerationConfigs: inactive,
    ...overrides,
  };
}

describe("settingsSectionAsyncState", () => {
  it("keeps provider failures local to the provider section", () => {
    const failed: AsyncViewState = {
      participation: "active",
      content: "none",
      fetch: "idle",
      error: "initial",
    };

    expect(
      settingsSectionAsyncState(
        "providers",
        sectionStates({ providerProfiles: ready, providerGenerationConfigs: failed }),
      ),
    ).toEqual({
      participation: "active",
      content: "none",
      fetch: "idle",
      error: "initial",
    });
    expect(settingsSectionAsyncState("weather", sectionStates())).toEqual(ready);
  });

  it("waits for a dependent text-config query while resource groups are loading", () => {
    const fetching: AsyncViewState = {
      participation: "active",
      content: "none",
      fetch: "fetching",
      error: "none",
    };
    const waiting: AsyncViewState = {
      participation: "active",
      content: "none",
      fetch: "idle",
      error: "none",
    };

    expect(
      settingsSectionAsyncState(
        "text",
        sectionStates({
          providerProfiles: ready,
          generationResourceGroups: fetching,
          textGenerationConfigs: waiting,
        }),
      ),
    ).toEqual({
      participation: "active",
      content: "none",
      fetch: "fetching",
      error: "none",
    });
  });

  it("preserves cached runtime settings when a refresh fails", () => {
    const refreshFailed: AsyncViewState = {
      participation: "active",
      content: "ready",
      fetch: "idle",
      error: "refresh",
    };

    expect(settingsSectionAsyncState("security", sectionStates({ config: refreshFailed }))).toEqual(refreshFailed);
  });
});
