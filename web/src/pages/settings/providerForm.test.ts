import { describe, expect, it } from "vitest";

import type { GenerationConfig, ProviderProfile } from "../../lib/types";
import {
  coerceProviderImageMaxDimension,
  filterProviderProfilesByName,
  filterProviderProfilesForList,
  parseProviderImageMaxDimensionDraft,
  providerFormFromProfile,
  providerGenerationConfigsForUsage,
  providerImageMaxDimensionFormInvalid,
  providerImageMaxDimensionSelectValue,
} from "./providerForm";

function providerProfile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: overrides.id ?? "profile-1",
    name: overrides.name ?? "Provider",
    provider_type: overrides.provider_type ?? "openai_compatible",
    base_url: "base_url" in overrides ? (overrides.base_url ?? null) : "https://example.com/v1",
    api_key_preview:
      "api_key_preview" in overrides ? (overrides.api_key_preview ?? null) : overrides.has_api_key === false ? null : "provi*****file1",
    capabilities: overrides.capabilities ?? ["text_responses", "image_images"],
    default_models: overrides.default_models ?? {},
    config: overrides.config ?? {},
    enabled: overrides.enabled ?? true,
    archived_at: overrides.archived_at ?? null,
    has_api_key: overrides.has_api_key ?? true,
    created_at: overrides.created_at ?? "2026-05-13T00:00:00Z",
    updated_at: overrides.updated_at ?? "2026-05-13T00:00:00Z",
  };
}

function generationConfig(overrides: Partial<GenerationConfig> = {}): GenerationConfig {
  return {
    id: overrides.id ?? "config-1",
    name: overrides.name ?? "Config",
    purpose: overrides.purpose ?? "text",
    provider_kind: overrides.provider_kind ?? "openai",
    provider_profile_id: overrides.provider_profile_id ?? "profile-1",
    resource_group_id: overrides.resource_group_id ?? null,
    resource_group_ids: overrides.resource_group_ids ?? [],
    model_settings: overrides.model_settings ?? {},
    config: overrides.config ?? {},
    priority: overrides.priority ?? 100,
    max_concurrency: overrides.max_concurrency ?? 1,
    enabled: overrides.enabled ?? true,
    effective_enabled: overrides.effective_enabled ?? true,
    availability_window_minutes: overrides.availability_window_minutes ?? 10,
    failure_threshold: overrides.failure_threshold ?? 3,
    cooldown_minutes: overrides.cooldown_minutes ?? 15,
    provider_max_dimension: overrides.provider_max_dimension ?? null,
    state: overrides.state ?? null,
    today_stat: overrides.today_stat ?? null,
    latest_test_result: overrides.latest_test_result ?? null,
    archived_at: overrides.archived_at ?? null,
    created_at: overrides.created_at ?? "2026-05-13T00:00:00Z",
    updated_at: overrides.updated_at ?? "2026-05-13T00:00:00Z",
  };
}

describe("provider profile search helpers", () => {
  it("filters provider profiles by visible name only", () => {
    const profiles = [
      providerProfile({
        id: "free-provider",
        name: "DGB",
        base_url: "https://free.example.com/v1",
      }),
      providerProfile({
        id: "profile-2",
        name: "freeai-api",
        base_url: "https://example.com/v1",
      }),
    ];

    expect(filterProviderProfilesByName(profiles, "free")).toEqual([profiles[1]]);
  });

  it("combines archive, enabled-state, and visible-name filters for the provider list", () => {
    const profiles = [
      providerProfile({ id: "enabled-alpha", name: "Alpha", enabled: true }),
      providerProfile({ id: "disabled-alpha", name: "Alpha Disabled", enabled: false }),
      providerProfile({ id: "disabled-beta", name: "Beta", enabled: false }),
      providerProfile({ id: "archived-alpha", name: "Alpha Archived", archived_at: "2026-07-16T00:00:00Z" }),
    ];

    expect(filterProviderProfilesForList(profiles, "alpha", true).map((profile) => profile.id)).toEqual([
      "enabled-alpha",
    ]);
    expect(filterProviderProfilesForList(profiles, "alpha", false).map((profile) => profile.id)).toEqual([
      "disabled-alpha",
    ]);
  });
});

describe("provider image max dimension helpers", () => {
  it("coerces provider max dimension to the system step", () => {
    expect(coerceProviderImageMaxDimension(2050)).toBe(2048);
    expect(coerceProviderImageMaxDimension("2816")).toBe(2816);
    expect(coerceProviderImageMaxDimension("bad-input")).toBeNull();
  });

  it("parses custom draft values with range checks", () => {
    expect(parseProviderImageMaxDimensionDraft("2050")).toEqual({ value: 2048, invalid: false });
    expect(parseProviderImageMaxDimensionDraft("")).toEqual({ value: null, invalid: false });
    expect(parseProviderImageMaxDimensionDraft("500")).toEqual({ value: null, invalid: true });
  });

  it("hydrates preset and custom form modes from provider config", () => {
    expect(
      providerFormFromProfile(
        providerProfile({
          config: { capabilities: { image_max_dimension: 2050 } },
        }),
      ),
    ).toMatchObject({
      image_max_dimension: 2048,
      image_max_dimension_mode: "preset",
      image_max_dimension_custom_value: "",
    });

    expect(
      providerFormFromProfile(
        providerProfile({
          config: { capabilities: { image_max_dimension: 2816 } },
        }),
      ),
    ).toMatchObject({
      image_max_dimension: 2816,
      image_max_dimension_mode: "custom",
      image_max_dimension_custom_value: "2816",
    });
  });

  it("derives select value and invalid state from the form mode", () => {
    expect(
      providerImageMaxDimensionSelectValue({
        image_max_dimension: null,
        image_max_dimension_mode: "preset",
      }),
    ).toBe("__global__");
    expect(
      providerImageMaxDimensionSelectValue({
        image_max_dimension: 2816,
        image_max_dimension_mode: "custom",
      }),
    ).toBe("__custom__");
    expect(
      providerImageMaxDimensionFormInvalid({
        image_max_dimension_mode: "custom",
        image_max_dimension_custom_value: "499",
      }),
    ).toBe(true);
  });
});

describe("provider generation config usage helpers", () => {
  it("filters the provider configs by purpose and keeps display ordering", () => {
    const configs = [
      generationConfig({ id: "image-disabled", purpose: "image", name: "Image Disabled", enabled: false, effective_enabled: false }),
      generationConfig({ id: "text-low", purpose: "text", name: "Text Low", priority: 50, effective_enabled: true }),
      generationConfig({ id: "text-high", purpose: "text", name: "Text High", priority: 100, effective_enabled: true }),
      generationConfig({ id: "text-other", purpose: "text", name: "Other Provider", provider_profile_id: "profile-2" }),
      generationConfig({ id: "text-archived", purpose: "text", name: "Archived", archived_at: "2026-07-08T00:00:00Z" }),
    ];

    expect(providerGenerationConfigsForUsage(configs, "profile-1", "text").map((config) => config.id)).toEqual([
      "text-high",
      "text-low",
    ]);
    expect(providerGenerationConfigsForUsage(configs, "profile-1", "image").map((config) => config.id)).toEqual([
      "image-disabled",
    ]);
  });
});
