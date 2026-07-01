import { afterEach, describe, expect, it, vi } from "vitest";

import { api, resourceGroupMaxDimension } from "./api";
import type { GenerationConfig } from "./types";

function inspirationDetailResponse() {
  return new Response(
    JSON.stringify({
      id: "inspiration-1",
      owner_user_id: "user-1",
      owner_username: null,
      resource_group_id: "group-default",
      resource_group: { id: "group-default", key: "default", name: "default" },
      name: "三阶魔方",
      category: null,
      price: null,
      source_note: "顺滑磁吸结构",
      workflow_state: "draft",
      source_assets: [],
      latest_brief: null,
      current_confirmed_copy_set: null,
      copy_sets: [],
      poster_variants: [],
      created_at: "2026-06-03T00:00:00Z",
      updated_at: "2026-06-03T00:00:00Z",
    }),
    { status: 201, headers: { "Content-Type": "application/json" } },
  );
}

describe("api.createInspiration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("serializes rich inspiration context fields into multipart form data", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(inspirationDetailResponse());
    const image = new File(["image"], "cube.png", { type: "image/png" });
    const documentFile = new File(["brief"], "brief.md", { type: "text/markdown" });

    await api.createInspiration({
      name: "三阶魔方",
      resource_group_id: "group-default",
      long_text: "顺滑磁吸结构",
      dynamic_fields: { magnetic: true, level: 3, note: null },
      initial_workflow_entry: "copy",
      entry_text: "顺滑磁吸结构",
      file: image,
      contextDocumentFile: documentFile,
    });

    const [, init] = fetchMock.mock.calls[0];
    const body = init?.body as FormData;
    expect(body.get("name")).toBe("三阶魔方");
    expect(body.get("resource_group_id")).toBe("group-default");
    expect(body.has("owner_id")).toBe(false);
    expect(body.get("long_text")).toBe("顺滑磁吸结构");
    expect(body.get("initial_workflow_entry")).toBe("copy");
    expect(body.get("entry_text")).toBe("顺滑磁吸结构");
    expect(body.get("dynamic_fields_json")).toBe(JSON.stringify({ magnetic: true, level: 3, note: null }));
    expect(body.get("image")).toBe(image);
    expect(body.get("context_document")).toBe(documentFile);
  });
});

describe("api.listRbacUsers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the owner search keyword as an API query parameter", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ items: [], total: 0, page: 1, page_size: 30 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await api.listRbacUsers({ page_size: 30, query: "负责人" });

    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/rbac/users?page=1&page_size=30&query=");
    expect(decodeURIComponent(String(fetchMock.mock.calls[0][0]))).toContain("query=负责人");
  });
});

describe("api.findWeatherLocation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to Nominatim when Open-Meteo cannot resolve a district query", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ generationtime_ms: 0.2 })))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              place_id: 246041329,
              lat: "23.0859958",
              lon: "113.3119935",
              name: "海珠区",
              display_name: "海珠区, 广州市, 广东省, 中国",
            },
          ]),
        ),
      );

    const location = await api.findWeatherLocation({ query: "广州海珠区", language: "zh" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("geocoding-api.open-meteo.com");
    expect(String(fetchMock.mock.calls[1][0])).toContain("nominatim.openstreetmap.org");
    expect(location).toEqual({
      id: 246041329,
      name: "海珠区, 广州市, 广东省, 中国",
      latitude: 23.0859958,
      longitude: 113.3119935,
      country: null,
      admin1: null,
      timezone: null,
    });
  });
});

describe("api.getCurrentWeather", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes humidity and pressure when the weather source provides them", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          current: {
            time: "2026-06-07T10:30",
            temperature_2m: 28.4,
            relative_humidity_2m: 83,
            surface_pressure: 1006.2,
            weather_code: 82,
            is_day: 1,
          },
          timezone: "Asia/Shanghai",
        }),
      ),
    );

    const weather = await api.getCurrentWeather({ latitude: 23.086, longitude: 113.312 });

    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "current=temperature_2m%2Crelative_humidity_2m%2Csurface_pressure%2Cpressure_msl%2Cweather_code%2Cis_day",
    );
    expect(weather).toEqual({
      weather_code: 82,
      condition: "rain",
      temperature_celsius: 28.4,
      humidity_percent: 83,
      pressure_hpa: 1006.2,
      is_day: true,
      observed_at: "2026-06-07T10:30",
      timezone: "Asia/Shanghai",
    });
  });
});

describe("resourceGroupMaxDimension", () => {
  const mockConfigs: GenerationConfig[] = [
    {
      id: "config-1",
      resource_group_id: "group-a",
      resource_group_ids: ["group-a"],
      purpose: "image",
      name: "Config 1024",
      provider_kind: "openai_images",
      provider_profile_id: "provider-1",
      provider_max_dimension: 1024,
      model_settings: { model: "dall-e-3" },
      config: {},
      enabled: true,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    },
    {
      id: "config-2",
      resource_group_id: "group-a",
      resource_group_ids: ["group-a"],
      purpose: "image",
      name: "Config 2048",
      provider_kind: "openai_images",
      provider_profile_id: "provider-2",
      provider_max_dimension: 2048,
      model_settings: { model: "dall-e-3" },
      config: {},
      enabled: true,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    },
    {
      id: "config-3",
      resource_group_id: "group-a",
      resource_group_ids: ["group-a"],
      purpose: "image",
      name: "Config 3840",
      provider_kind: "openai_images",
      provider_profile_id: "provider-3",
      provider_max_dimension: 3840,
      model_settings: { model: "dall-e-3" },
      config: {},
      enabled: true,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    },
    {
      id: "config-4",
      resource_group_id: "group-b",
      resource_group_ids: ["group-b"],
      purpose: "image",
      name: "Config 4096",
      provider_kind: "openai_images",
      provider_profile_id: "provider-4",
      provider_max_dimension: 4096,
      model_settings: { model: "dall-e-3" },
      config: {},
      enabled: true,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    },
    {
      id: "config-5",
      resource_group_id: "group-a",
      resource_group_ids: ["group-a"],
      purpose: "image",
      name: "Config Disabled",
      provider_kind: "openai_images",
      provider_profile_id: "provider-5",
      provider_max_dimension: 8192,
      model_settings: { model: "dall-e-3" },
      config: {},
      enabled: false,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-01T00:00:00Z",
    },
  ];

  it("aggregates max dimension across multiple configs", () => {
    const result = resourceGroupMaxDimension(mockConfigs, "group-a", 3840);
    expect(result).toBe(3840);
  });

  it("returns globalMax when group is empty", () => {
    const result = resourceGroupMaxDimension(mockConfigs, "group-empty", 3840);
    expect(result).toBe(3840);
  });

  it("uses globalMax when providerMaxDimension is null", () => {
    const configsWithNull: GenerationConfig[] = [
      {
        ...mockConfigs[0],
        resource_group_ids: ["group-a"],
        provider_max_dimension: null,
      },
    ];
    const result = resourceGroupMaxDimension(configsWithNull, "group-a", 3840);
    expect(result).toBe(3840);
  });

  it("excludes disabled configs from aggregation", () => {
    const result = resourceGroupMaxDimension(mockConfigs, "group-a", 4096);
    expect(result).toBe(3840);
  });

  it("returns max from different resource group", () => {
    const result = resourceGroupMaxDimension(mockConfigs, "group-b", 3840);
    expect(result).toBe(4096);
  });

  it("handles all configs with null provider_max_dimension", () => {
    const configsAllNull: GenerationConfig[] = [
      { ...mockConfigs[0], resource_group_ids: ["group-a"], provider_max_dimension: null },
      { ...mockConfigs[1], resource_group_ids: ["group-a"], provider_max_dimension: null },
    ];
    const result = resourceGroupMaxDimension(configsAllNull, "group-a", 2048);
    expect(result).toBe(2048);
  });

  it("handles empty config list", () => {
    const result = resourceGroupMaxDimension([], "group-a", 3840);
    expect(result).toBe(3840);
  });

  it("returns correct max when some configs have null", () => {
    const mixedConfigs: GenerationConfig[] = [
      { ...mockConfigs[0], resource_group_ids: ["group-a"], provider_max_dimension: 1024 },
      { ...mockConfigs[1], resource_group_ids: ["group-a"], provider_max_dimension: null },
      { ...mockConfigs[2], resource_group_ids: ["group-a"], provider_max_dimension: 2048 },
    ];
    const result = resourceGroupMaxDimension(mixedConfigs, "group-a", 3840);
    expect(result).toBe(3840);
  });
});
