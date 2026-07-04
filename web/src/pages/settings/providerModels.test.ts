import { describe, expect, it } from "vitest";

import {
  canFetchProviderModels,
  filterProviderModels,
  PROVIDER_MODELS_QUERY_GC_TIME_MS,
  PROVIDER_MODELS_QUERY_STALE_TIME_MS,
  shouldEnableProviderModelsQuery,
} from "./providerModels";

describe("providerModels query helpers", () => {
  it("only enables model queries after the input has been activated in view", () => {
    expect(shouldEnableProviderModelsQuery("profile-1", "openai", false)).toBe(false);
    expect(shouldEnableProviderModelsQuery("profile-1", "openai", true)).toBe(true);
    expect(shouldEnableProviderModelsQuery("", "openai", true)).toBe(false);
    expect(shouldEnableProviderModelsQuery("profile-1", "mock", true)).toBe(false);
  });

  it("keeps fetched model lists permanently fresh in the page cache until manual refresh", () => {
    expect(PROVIDER_MODELS_QUERY_STALE_TIME_MS).toBe(Number.POSITIVE_INFINITY);
    expect(PROVIDER_MODELS_QUERY_GC_TIME_MS).toBe(Number.POSITIVE_INFINITY);
  });

  it("treats only real provider profiles as fetchable", () => {
    expect(canFetchProviderModels("profile-1", "openai")).toBe(true);
    expect(canFetchProviderModels("", "openai")).toBe(false);
    expect(canFetchProviderModels("profile-1", "mock")).toBe(false);
  });

  it("filters model options by id and label case-insensitively", () => {
    const models = [
      { id: "gpt-4.1", label: "GPT 4.1", owned_by: null, created: null },
      { id: "gemini-2.5-flash-image", label: "Gemini Flash", owned_by: null, created: null },
    ];

    expect(filterProviderModels(models, "4.1").map((model) => model.id)).toEqual(["gpt-4.1"]);
    expect(filterProviderModels(models, "flash").map((model) => model.id)).toEqual(["gemini-2.5-flash-image"]);
  });
});
