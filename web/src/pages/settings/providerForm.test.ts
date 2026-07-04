import { describe, expect, it } from "vitest";

import type { ProviderProfile } from "../../lib/types";
import {
  coerceProviderImageMaxDimension,
  parseProviderImageMaxDimensionDraft,
  providerFormFromProfile,
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
