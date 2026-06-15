import { describe, expect, it } from "vitest";

import {
  filterGenerationConfigsByName,
  filterProviderProfilesByName,
} from "./SettingsPage";
import type { GenerationConfig, ProviderProfile } from "../lib/types";

function providerProfile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: overrides.id ?? "profile-1",
    name: overrides.name ?? "OpenRouter",
    provider_type: overrides.provider_type ?? "openai_compatible",
    base_url: "base_url" in overrides ? (overrides.base_url ?? null) : "https://openrouter.ai/api/v1",
    capabilities: overrides.capabilities ?? ["text_responses", "image_images"],
    default_models: overrides.default_models ?? {},
    config: overrides.config ?? {},
    enabled: overrides.enabled ?? true,
    archived_at: overrides.archived_at ?? null,
    has_api_key: overrides.has_api_key ?? true,
    created_at: overrides.created_at ?? "2026-06-12T00:00:00Z",
    updated_at: overrides.updated_at ?? "2026-06-12T00:00:00Z",
  };
}

function generationConfig(
  overrides: Partial<GenerationConfig> & Pick<GenerationConfig, "purpose">,
): GenerationConfig {
  return {
    id: overrides.id ?? `${overrides.purpose}-config`,
    resource_group_id: overrides.resource_group_id ?? "group-default",
    resource_group_ids: overrides.resource_group_ids ?? ["group-default"],
    purpose: overrides.purpose,
    name: overrides.name ?? `${overrides.purpose} config`,
    provider_kind: overrides.provider_kind ?? "openai",
    provider_profile_id: overrides.provider_profile_id ?? "profile-1",
    model_settings: overrides.model_settings ?? {},
    config: overrides.config ?? {},
    priority: overrides.priority ?? 100,
    max_concurrency: overrides.max_concurrency ?? 1,
    enabled: overrides.enabled ?? true,
    availability_window_minutes: overrides.availability_window_minutes ?? 10,
    failure_threshold: overrides.failure_threshold ?? 3,
    cooldown_minutes: overrides.cooldown_minutes ?? 10,
    archived_at: overrides.archived_at ?? null,
    created_at: overrides.created_at ?? "2026-06-12T00:00:00Z",
    updated_at: overrides.updated_at ?? "2026-06-12T00:00:00Z",
    state: overrides.state ?? null,
    today_stat: overrides.today_stat ?? null,
    latest_test_result: overrides.latest_test_result ?? null,
  };
}

describe("SettingsPage search helpers", () => {
  it("filters provider profiles by display name only", () => {
    const profiles = [
      providerProfile({ id: "openrouter-main", name: "OpenRouter", base_url: "https://openrouter.ai/api/v1" }),
      providerProfile({ id: "gemini-image", name: "Gemini Image", provider_type: "google_gemini", base_url: null }),
      providerProfile({ id: "backup", name: "Backup Gateway", base_url: "https://gateway.example/v1" }),
    ];

    expect(filterProviderProfilesByName(profiles, "").map((profile) => profile.id)).toEqual([
      "openrouter-main",
      "gemini-image",
      "backup",
    ]);
    expect(filterProviderProfilesByName(profiles, " image ").map((profile) => profile.id)).toEqual(["gemini-image"]);
    expect(filterProviderProfilesByName(profiles, "GATEWAY").map((profile) => profile.id)).toEqual(["backup"]);
    expect(filterProviderProfilesByName(profiles, "openrouter.ai")).toEqual([]);
  });

  it("filters text and image generation configs by name only", () => {
    const configs = [
      generationConfig({ id: "primary-text", purpose: "text", name: "Primary Text" }),
      generationConfig({ id: "seasonal-image", purpose: "image", name: "Seasonal Image" }),
      generationConfig({ id: "backup", purpose: "text", name: "Backup Copy", provider_kind: "mock" }),
    ];

    expect(filterGenerationConfigsByName(configs, "").map((config) => config.id)).toEqual([
      "primary-text",
      "seasonal-image",
      "backup",
    ]);
    expect(filterGenerationConfigsByName(configs, " image ").map((config) => config.id)).toEqual(["seasonal-image"]);
    expect(filterGenerationConfigsByName(configs, "COPY").map((config) => config.id)).toEqual(["backup"]);
    expect(filterGenerationConfigsByName(configs, "mock")).toEqual([]);
  });
});
