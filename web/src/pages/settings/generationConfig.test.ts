import { describe, expect, it } from "vitest";

import type { GenerationConfig } from "../../lib/types";
import {
  generationConfigBatchFailedSelectableIds,
  generationConfigBatchSelectableIds,
  generationConfigManualTestBlocked,
  generationConfigsForPurpose,
  sortGenerationConfigsForDisplay,
} from "./generationConfig";

function generationConfig(overrides: Partial<GenerationConfig> & Pick<GenerationConfig, "id" | "purpose">): GenerationConfig {
  return {
    id: overrides.id,
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
    effective_enabled: overrides.effective_enabled ?? overrides.enabled ?? true,
    availability_window_minutes: overrides.availability_window_minutes ?? 10,
    failure_threshold: overrides.failure_threshold ?? 3,
    cooldown_minutes: overrides.cooldown_minutes ?? 10,
    archived_at: overrides.archived_at ?? null,
    created_at: overrides.created_at ?? "2026-07-04T00:00:00Z",
    updated_at: overrides.updated_at ?? "2026-07-04T00:00:00Z",
    state: overrides.state ?? null,
    today_stat: overrides.today_stat ?? null,
    latest_test_result: overrides.latest_test_result ?? null,
    provider_max_dimension: overrides.provider_max_dimension ?? null,
  };
}

describe("generation config display sorting", () => {
  it("puts effective enabled configs first, then sorts by priority and name", () => {
    const configs = [
      generationConfig({
        id: "provider-disabled-high",
        purpose: "text",
        name: "Alpha",
        priority: 300,
        enabled: true,
        effective_enabled: false,
      }),
      generationConfig({ id: "enabled-low", purpose: "text", name: "Zulu", priority: 100, enabled: true }),
      generationConfig({ id: "enabled-high-b", purpose: "text", name: "Beta", priority: 200, enabled: true }),
      generationConfig({ id: "enabled-high-a", purpose: "text", name: "Alpha", priority: 200, enabled: true }),
    ];

    expect(sortGenerationConfigsForDisplay(configs).map((config) => config.id)).toEqual([
      "enabled-high-a",
      "enabled-high-b",
      "enabled-low",
      "provider-disabled-high",
    ]);
  });

  it("applies the same order after filtering by purpose", () => {
    const textEnabled = generationConfig({ id: "text-enabled", purpose: "text", name: "Alpha", priority: 100 });
    const textDisabled = generationConfig({
      id: "text-disabled",
      purpose: "text",
      name: "Zulu",
      priority: 200,
      enabled: true,
      effective_enabled: false,
    });
    const imageConfig = generationConfig({ id: "image-enabled", purpose: "image", name: "Image", priority: 999 });

    expect(
      generationConfigsForPurpose(
        {
          profiles: [],
          generation_resource_groups: [],
          generation_configs: [textDisabled, imageConfig, textEnabled],
          status_summary: null,
        },
        "text",
      ).map((config) => config.id),
    ).toEqual(["text-enabled", "text-disabled"]);
  });
});

describe("generation config testing helpers", () => {
  it("allows manual test for disabled configs but blocks provider-unavailable enabled configs", () => {
    expect(
      generationConfigManualTestBlocked(
        generationConfig({ id: "enabled-ok", purpose: "text", enabled: true, effective_enabled: true }),
      ),
    ).toBe(false);
    expect(
      generationConfigManualTestBlocked(
        generationConfig({ id: "config-disabled", purpose: "text", enabled: false, effective_enabled: false }),
      ),
    ).toBe(false);
    expect(
      generationConfigManualTestBlocked(
        generationConfig({ id: "provider-disabled", purpose: "text", enabled: true, effective_enabled: false }),
      ),
    ).toBe(true);
  });

  it("excludes disabled configs from batch auto-selection unless explicitly included", () => {
    const failedResult = {
      id: "test-result-failed",
      generation_config_id: "generation-config-under-test",
      test_type: "text" as const,
      status: "failed" as const,
      tested_at: "2026-07-08T00:00:00Z",
      duration_ms: 100,
      provider_kind: "openai",
      message: "failed",
      error_detail: "failed",
      model_summary: {},
    };
    const items = [
      {
        config: generationConfig({ id: "enabled", purpose: "text", enabled: true, effective_enabled: true }),
        disabled: false,
      },
      {
        config: generationConfig({
          id: "disabled-config",
          purpose: "text",
          enabled: false,
          effective_enabled: false,
          latest_test_result: failedResult,
        }),
        disabled: false,
      },
      {
        config: generationConfig({
          id: "enabled-failed",
          purpose: "text",
          enabled: true,
          effective_enabled: true,
          latest_test_result: failedResult,
        }),
        disabled: false,
      },
      {
        config: generationConfig({ id: "blocked", purpose: "text", enabled: true, effective_enabled: true }),
        disabled: true,
      },
    ];

    expect(generationConfigBatchSelectableIds(items)).toEqual(["enabled", "enabled-failed"]);
    expect(generationConfigBatchSelectableIds(items, { includeDisabledConfigs: true })).toEqual([
      "enabled",
      "disabled-config",
      "enabled-failed",
    ]);
    expect(generationConfigBatchFailedSelectableIds(items)).toEqual(["enabled-failed"]);
    expect(generationConfigBatchFailedSelectableIds(items, { includeDisabledConfigs: true })).toEqual([
      "disabled-config",
      "enabled-failed",
    ]);
  });
});
