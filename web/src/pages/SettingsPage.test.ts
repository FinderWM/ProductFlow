import { describe, expect, it } from "vitest";

import {
  configCategoryGroups,
  configValuesFromChangedDrafts,
  draftsFromConfig,
  filterProviderModels,
  generationConfigPayloadFromDraft,
  markTextConfigTestFailed,
  markTextConfigTestStarted,
  markTextConfigTestSucceeded,
  providerDisableBlocked,
  providerDrawerCreateState,
  providerDrawerEditState,
  providerFormFromProfile,
  providerProfileCreatePayload,
  providerProfileUpdatePayload,
  providerUsageFromGenerationConfigs,
  providerUsageLabelKeys,
  settingsSectionIds,
  settingsGenerationResourceGroupsInApiOrder,
  shouldShowSettingsMigrationPanel,
  textConfigTestRecordForKey,
  type TextConfigTestState,
} from "./SettingsPage";
import {
  isSettingsExportPayload,
  settingsExportFilename,
  settingsImportSummaryCounts,
} from "./settings/importExport";
import { translate } from "../lib/i18n";
import type {
  ConfigItem,
  ConfigResponse,
  GenerationConfig,
  GenerationResourceGroup,
  ProviderCapability,
  ProviderModel,
  ProviderProfile,
  SettingsImportPreviewResponse,
  TextGenerationConfigTestResponse,
} from "../lib/types";

function configItem(overrides: Partial<ConfigItem> & Pick<ConfigItem, "key" | "value">): ConfigItem {
  return {
    key: overrides.key,
    label: overrides.label ?? overrides.key,
    category: overrides.category ?? "测试",
    input_type: overrides.input_type ?? "text",
    description: overrides.description ?? "",
    value: overrides.value,
    source: overrides.source ?? "env_default",
    secret: overrides.secret ?? false,
    has_value: overrides.has_value ?? false,
    options: overrides.options ?? [],
    minimum: overrides.minimum ?? null,
    maximum: overrides.maximum ?? null,
    updated_at: overrides.updated_at ?? null,
  };
}

function configResponse(items: ConfigItem[]): ConfigResponse {
  return { items };
}

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
    created_at: overrides.created_at ?? "2026-05-13T00:00:00Z",
    updated_at: overrides.updated_at ?? "2026-05-13T00:00:00Z",
  };
}

function generationConfig(overrides: Partial<GenerationConfig> & Pick<GenerationConfig, "purpose">): GenerationConfig {
  return {
    id: overrides.id ?? `${overrides.purpose}-config`,
    resource_group_id: overrides.resource_group_id ?? "group-default",
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
    created_at: overrides.created_at ?? "2026-05-13T00:00:00Z",
    updated_at: overrides.updated_at ?? "2026-05-13T00:00:00Z",
    state: overrides.state ?? null,
    today_stat: overrides.today_stat ?? null,
  };
}

function generationResourceGroup(overrides: Partial<GenerationResourceGroup> = {}): GenerationResourceGroup {
  return {
    id: overrides.id ?? "group-default",
    key: overrides.key ?? "default",
    name: overrides.name ?? "default",
    description: overrides.description ?? null,
    sort_order: overrides.sort_order ?? 0,
    enabled: overrides.enabled ?? true,
    archived_at: overrides.archived_at ?? null,
    created_at: overrides.created_at ?? "2026-05-13T00:00:00Z",
    updated_at: overrides.updated_at ?? "2026-05-13T00:00:00Z",
  };
}

function textConfigTestState(): TextConfigTestState {
  return {
    draft: {
      inspirationName: "测试灵感产物",
      category: "电商灵感产物",
      price: "",
      sourceNote: "测试备注",
      instruction: "输出短文案",
    },
    latestKey: null,
    records: {},
  };
}

function textConfigTestResponse(model: string): TextGenerationConfigTestResponse {
  return {
    generation_config_id: null,
    provider_kind: "openai",
    brief_model: model,
    copy_model: model,
    brief: { positioning: model },
    copy_result: { summary: model },
    duration_ms: 1200,
  };
}

describe("SettingsPage draft helpers", () => {
  it("only submits changed non-secret values instead of rewriting the whole config page", () => {
    const items = [
      configItem({ key: "deletion_enabled", input_type: "boolean", value: true }),
      configItem({ key: "image_main_image_size", value: "1024x1024" }),
      configItem({ key: "image_tool_allowed_fields", input_type: "multi_select", value: ["model", "quality"] }),
    ];
    const state = draftsFromConfig(configResponse(items));

    const values = configValuesFromChangedDrafts(
      items,
      {
        ...state.drafts,
        image_main_image_size: "1536x1024",
      },
      state.snapshots,
      {},
    );

    expect(values).toEqual({ image_main_image_size: "1536x1024" });
  });

  it("keeps untouched secrets out but submits touched secrets", () => {
    const items = [
      configItem({ key: "local_secret", input_type: "password", secret: true, has_value: true, value: "" }),
    ];
    const state = draftsFromConfig(configResponse(items));

    expect(configValuesFromChangedDrafts(items, state.drafts, state.snapshots, {})).toEqual({});
    expect(
      configValuesFromChangedDrafts(
        items,
        { ...state.drafts, local_secret: "sk-new" },
        state.snapshots,
        { local_secret: true },
      ),
    ).toEqual({ local_secret: "sk-new" });
  });

  it("detects multi-select changes by ordered option values", () => {
    const items = [configItem({ key: "image_tool_allowed_fields", input_type: "multi_select", value: ["model"] })];
    const state = draftsFromConfig(configResponse(items));

    const unchanged = configValuesFromChangedDrafts(items, state.drafts, state.snapshots, {});
    const changed = configValuesFromChangedDrafts(
      items,
      { image_tool_allowed_fields: ["model", "quality"] },
      state.snapshots,
      {},
    );

    expect(unchanged).toEqual({});
    expect(changed).toEqual({ image_tool_allowed_fields: ["model", "quality"] });
  });

  it("groups global generation config items by backend category suffix", () => {
    const groups = configCategoryGroups([
      configItem({
        key: "generation_max_concurrent_tasks",
        category: "全局生成配置 / 队列容量",
        value: 3,
      }),
      configItem({
        key: "generation_tail_splitter_max_items",
        category: "全局生成配置 / 工作流生成",
        value: 36,
      }),
      configItem({
        key: "workflow_image_generation_provider_timeout_seconds",
        category: "全局生成配置 / 工作流生成",
        value: 900,
      }),
      configItem({
        key: "workflow_node_max_retry_count",
        category: "全局生成配置 / 工作流生成",
        value: 10,
      }),
      configItem({
        key: "workflow_node_retry_delay_ms",
        category: "全局生成配置 / 工作流生成",
        value: 2000,
      }),
    ]);

    expect(groups.map((group) => [group.title, group.items.map((item) => item.key)])).toEqual([
      ["队列容量", ["generation_max_concurrent_tasks"]],
      [
        "工作流生成",
        [
          "generation_tail_splitter_max_items",
          "workflow_image_generation_provider_timeout_seconds",
          "workflow_node_max_retry_count",
          "workflow_node_retry_delay_ms",
        ],
      ],
    ]);
  });
});

describe("SettingsPage text config test state", () => {
  it("keeps concurrent test records isolated by generation config key", () => {
    const firstResult = textConfigTestResponse("brief-a");
    let state = textConfigTestState();

    state = markTextConfigTestStarted(state, "config-a");
    state = markTextConfigTestStarted(state, "config-b");
    state = markTextConfigTestSucceeded(state, "config-a", firstResult);
    state = markTextConfigTestFailed(state, "config-b", "provider failed");

    expect(textConfigTestRecordForKey(state, "config-a")).toEqual({
      testing: false,
      result: firstResult,
      error: "",
    });
    expect(textConfigTestRecordForKey(state, "config-b")).toEqual({
      testing: false,
      result: null,
      error: "provider failed",
    });
  });

  it("clears only the retried config result when starting another test", () => {
    const firstResult = textConfigTestResponse("brief-a");
    const secondResult = textConfigTestResponse("brief-b");
    let state = textConfigTestState();

    state = markTextConfigTestSucceeded(state, "config-a", firstResult);
    state = markTextConfigTestSucceeded(state, "config-b", secondResult);
    state = markTextConfigTestStarted(state, "config-b");

    expect(textConfigTestRecordForKey(state, "config-a")?.result).toBe(firstResult);
    expect(textConfigTestRecordForKey(state, "config-b")).toEqual({
      testing: true,
      result: null,
      error: "",
    });
    expect(state.latestKey).toBe("config-b");
  });
});

describe("SettingsPage provider profile helpers", () => {
  it("filters fetched provider models by typed id or label", () => {
    const models: ProviderModel[] = [
      { id: "openai/gpt-4.1", label: "GPT-4.1", owned_by: "openai", created: 1 },
      { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", owned_by: "google", created: 2 },
      { id: "anthropic/claude-opus-4", label: "Claude Opus 4", owned_by: "anthropic", created: 3 },
    ];

    expect(filterProviderModels(models, "").map((model) => model.id)).toEqual([
      "openai/gpt-4.1",
      "google/gemini-2.5-flash",
      "anthropic/claude-opus-4",
    ]);
    expect(filterProviderModels(models, " FLASH ").map((model) => model.id)).toEqual([
      "google/gemini-2.5-flash",
    ]);
    expect(filterProviderModels(models, "opus").map((model) => model.id)).toEqual(["anthropic/claude-opus-4"]);
    expect(filterProviderModels(models, "dall-e")).toEqual([]);
  });

  it("opens the drawer in create mode with a clean provider form", () => {
    expect(providerDrawerCreateState()).toEqual({
      open: true,
      editingProfileId: null,
      form: {
        name: "",
        provider_type: "openai_compatible",
        base_url: "",
        api_key: "",
        capabilities: ["text_responses", "image_images"],
        enabled: true,
      },
    });
  });

  it("opens the drawer in edit mode without echoing the existing API key", () => {
    const profile = providerProfile({
      id: "profile-edit",
      name: "Custom",
      base_url: null,
      capabilities: ["text_responses", "image_responses"],
      enabled: false,
      has_api_key: true,
    });

    expect(providerDrawerEditState(profile)).toEqual({
      open: true,
      editingProfileId: "profile-edit",
      form: {
        name: "Custom",
        provider_type: "openai_compatible",
        base_url: "",
        api_key: "",
        capabilities: ["text_responses", "image_responses"],
        enabled: false,
      },
    });
    expect(providerFormFromProfile(profile).api_key).toBe("");
  });

  it("opens the drawer for a Google Gemini profile with native provider metadata", () => {
    const profile = providerProfile({
      id: "profile-gemini",
      name: "Gemini",
      provider_type: "google_gemini",
      base_url: null,
      capabilities: ["image_google_gemini"],
    });

    expect(providerDrawerEditState(profile)).toEqual({
      open: true,
      editingProfileId: "profile-gemini",
      form: {
        name: "Gemini",
        provider_type: "google_gemini",
        base_url: "",
        api_key: "",
        capabilities: ["image_google_gemini"],
        enabled: true,
      },
    });
  });

  it("builds create and edit payloads while preserving blank-key edit semantics", () => {
    const form = {
      name: "  OpenRouter  ",
      provider_type: "openai_compatible" as const,
      base_url: "  https://openrouter.ai/api/v1  ",
      api_key: "",
      capabilities: ["text_responses", "image_images"] as ProviderCapability[],
      enabled: true,
    };

    expect(providerProfileCreatePayload(form)).toEqual({
      name: "OpenRouter",
      provider_type: "openai_compatible",
      base_url: "https://openrouter.ai/api/v1",
      api_key: null,
      capabilities: ["text_responses", "image_images"],
      enabled: true,
    });
    expect(providerProfileUpdatePayload(form)).toEqual({
      name: "OpenRouter",
      provider_type: "openai_compatible",
      base_url: "https://openrouter.ai/api/v1",
      api_key: "",
      capabilities: ["text_responses", "image_images"],
      enabled: true,
    });
  });

  it("builds Google Gemini provider payloads without custom base URL", () => {
    const form = {
      name: "  Gemini  ",
      provider_type: "google_gemini" as const,
      base_url: "https://should-not-submit.example",
      api_key: "  google-key  ",
      capabilities: ["image_google_gemini"] as ProviderCapability[],
      enabled: true,
    };

    expect(providerProfileCreatePayload(form)).toEqual({
      name: "Gemini",
      provider_type: "google_gemini",
      base_url: null,
      api_key: "google-key",
      capabilities: ["image_google_gemini"],
      enabled: true,
    });
    expect(providerProfileUpdatePayload(form)).toEqual({
      name: "Gemini",
      provider_type: "google_gemini",
      base_url: null,
      api_key: "  google-key  ",
      capabilities: ["image_google_gemini"],
      enabled: true,
    });
  });

  it("derives card usage labels from text and image generation configs", () => {
    const usage = providerUsageFromGenerationConfigs(
      [
        generationConfig({ purpose: "text", provider_profile_id: "profile-1" }),
        generationConfig({ purpose: "image", provider_profile_id: "profile-1", provider_kind: "openai_images" }),
        generationConfig({ purpose: "image", provider_profile_id: "other", provider_kind: "openai_images" }),
      ],
      "profile-1",
    );

    expect(usage).toEqual({ text: true, image: true });
    expect(providerUsageLabelKeys(usage)).toEqual([
      "settings.provider.usageText",
      "settings.provider.usageImage",
    ]);
  });

  it("builds Google Gemini image generation config payloads without OpenAI-specific config", () => {
    expect(
      generationConfigPayloadFromDraft({
        id: null,
        resource_group_id: "group-default",
        purpose: "image",
        name: "Gemini image",
        provider_kind: "google_gemini_image",
        provider_profile_id: "profile-gemini",
        brief_model: "",
        copy_model: "",
        model: " gemini-2.5-flash-image ",
        images_quality: "high",
        images_style: "vivid",
        responses_background_enabled: true,
        gemini_api_version: "v1beta",
        gemini_output_mime_type: " image/png ",
        priority: "80",
        max_concurrency: "2",
        enabled: true,
        availability_window_minutes: "15",
        failure_threshold: "4",
        cooldown_minutes: "20",
      }),
    ).toEqual({
      resource_group_id: "group-default",
      name: "Gemini image",
      purpose: "image",
      provider_kind: "google_gemini_image",
      provider_profile_id: "profile-gemini",
      model_settings: { model: "gemini-2.5-flash-image" },
      config: { gemini_api_version: "v1beta", gemini_output_mime_type: "image/png" },
      priority: 80,
      max_concurrency: 2,
      enabled: true,
      availability_window_minutes: 15,
      failure_threshold: 4,
      cooldown_minutes: 20,
    });
  });

  it("builds text generation config payloads with text models only", () => {
    expect(
      generationConfigPayloadFromDraft({
        id: null,
        resource_group_id: "group-default",
        purpose: "text",
        name: "Primary text",
        provider_kind: "openai",
        provider_profile_id: "profile-1",
        brief_model: " gpt-5.4 ",
        copy_model: " gpt-5.4 ",
        model: "",
        images_quality: "",
        images_style: "",
        responses_background_enabled: true,
        gemini_api_version: "v1beta",
        gemini_output_mime_type: "",
        priority: "100",
        max_concurrency: "1",
        enabled: true,
        availability_window_minutes: "10",
        failure_threshold: "3",
        cooldown_minutes: "10",
      }),
    ).toEqual({
      resource_group_id: "group-default",
      name: "Primary text",
      purpose: "text",
      provider_kind: "openai",
      provider_profile_id: "profile-1",
      model_settings: {
        brief_model: "gpt-5.4",
        copy_model: "gpt-5.4",
      },
      config: {},
      priority: 100,
      max_concurrency: 1,
      enabled: true,
      availability_window_minutes: 10,
      failure_threshold: 3,
      cooldown_minutes: 10,
    });
  });

  it("leaves blank scheduler policy fields as runtime defaults", () => {
    expect(
      generationConfigPayloadFromDraft({
        id: null,
        resource_group_id: "group-default",
        purpose: "text",
        name: "Default policy text",
        provider_kind: "mock",
        provider_profile_id: "",
        brief_model: "mock-brief",
        copy_model: "mock-copy",
        model: "",
        images_quality: "",
        images_style: "",
        responses_background_enabled: true,
        gemini_api_version: "v1beta",
        gemini_output_mime_type: "",
        priority: "100",
        max_concurrency: "1",
        enabled: true,
        availability_window_minutes: "",
        failure_threshold: "",
        cooldown_minutes: "",
      }),
    ).toMatchObject({
      availability_window_minutes: null,
      failure_threshold: null,
      cooldown_minutes: null,
    });
  });

  it("blocks disabling an enabled provider that is currently used by a generation config", () => {
    expect(providerDisableBlocked(providerProfile({ enabled: true }), { text: true, image: false })).toBe(true);
    expect(providerDisableBlocked(providerProfile({ enabled: true }), { text: false, image: false })).toBe(false);
    expect(providerDisableBlocked(providerProfile({ enabled: false }), { text: true, image: true })).toBe(false);
  });

  it("keeps settings generation groups in API order while keeping disabled groups visible", () => {
    const groups = settingsGenerationResourceGroupsInApiOrder([
      generationResourceGroup({ id: "default", name: "default", sort_order: 0 }),
      generationResourceGroup({ id: "disabled", name: "Disabled", sort_order: 300, enabled: false }),
      generationResourceGroup({ id: "archived", name: "Archived", sort_order: 500, archived_at: "2026-06-02T00:00:00Z" }),
      generationResourceGroup({ id: "premium", name: "Premium", sort_order: 200 }),
      generationResourceGroup({ id: "campaign", name: "Campaign", sort_order: 100 }),
    ]);

    expect(groups.map((group) => group.id)).toEqual(["default", "disabled", "premium", "campaign"]);
  });

  it("localizes the provider delete confirmation dialog copy", () => {
    expect(translate("zh-CN", "settings.provider.deleteConfirmTitle")).toBe("删除供应商");
    expect(translate("zh-CN", "settings.provider.deleteConfirm", { name: "OpenRouter" })).toBe(
      "确定删除「OpenRouter」吗？",
    );
    expect(translate("zh-CN", "settings.provider.deleteConfirmLabel")).toBe("删除");
    expect(translate("en-US", "settings.provider.deleteConfirmTitle")).toBe("Delete provider");
    expect(translate("en-US", "settings.provider.deleteConfirm", { name: "OpenRouter" })).toBe(
      'Delete "OpenRouter"?',
    );
    expect(translate("en-US", "settings.provider.deleteConfirmLabel")).toBe("Delete");
  });

  it("localizes Google Gemini provider labels", () => {
    expect(translate("zh-CN", "settings.provider.capability.imageGoogleGemini")).toBe("Google Gemini 图片");
    expect(translate("zh-CN", "settings.provider.type.googleGemini")).toBe("Google Gemini");
    expect(translate("zh-CN", "settings.provider.interface.googleGeminiImage")).toBe(
      "Google Gemini Image (未实测)",
    );
    expect(translate("en-US", "settings.provider.capability.imageGoogleGemini")).toBe("Google Gemini image");
    expect(translate("en-US", "settings.provider.type.googleGemini")).toBe("Google Gemini");
    expect(translate("en-US", "settings.provider.interface.googleGeminiImage")).toBe(
      "Google Gemini Image (untested)",
    );
  });
});

describe("SettingsPage import/export helpers", () => {
  it("keeps import and export controls on a dedicated settings section", () => {
    const sectionIds = settingsSectionIds();

    expect(sectionIds).toContain("resourceGroups");
    expect(sectionIds).toContain("migration");
    expect(shouldShowSettingsMigrationPanel("resourceGroups")).toBe(false);
    expect(shouldShowSettingsMigrationPanel("migration")).toBe(true);
    for (const sectionId of sectionIds.filter((sectionId) => sectionId !== "migration")) {
      expect(shouldShowSettingsMigrationPanel(sectionId)).toBe(false);
    }
  });

  it("builds a stable JSON export filename from the export timestamp", () => {
    expect(settingsExportFilename("2026-05-14T01:02:03Z")).toBe("inspiration-one-settings-2026-05-14-010203.json");
    expect(settingsExportFilename(null)).toBe("inspiration-one-settings.json");
  });

  it("normalizes import preview summary counts for confirmation copy", () => {
    const preview: SettingsImportPreviewResponse = {
      schema_version: 1,
      runtime_config_count: 14,
      provider_profile_count: 2,
      provider_binding_count: 2,
      generation_resource_group_count: 1,
      generation_config_count: 2,
      canvas_template_category_count: 3,
      canvas_template_count: 7,
      provider_profile_names: ["主供应商", "备用供应商"],
      provider_binding_purposes: ["image", "text"],
      includes_api_keys: true,
      provider_profiles_with_api_key_count: 1,
      canvas_template_keys: ["global:one"],
      canvas_template_category_names: ["平台首图"],
    };

    expect(settingsImportSummaryCounts(preview)).toEqual({
      runtimeConfigCount: 14,
      providerProfileCount: 2,
      providerBindingCount: 2,
      generationResourceGroupCount: 1,
      generationConfigCount: 2,
      canvasTemplateCategoryCount: 3,
      canvasTemplateCount: 7,
      providerProfilesWithApiKeyCount: 1,
    });
  });

  it("accepts only settings export payload shapes for import preview", () => {
    const payload = {
      metadata: { exported_at: "2026-05-14T01:02:03Z" },
      runtime_config: {},
      provider_profiles: [],
      provider_bindings: [],
      generation_resource_groups: [],
      generation_configs: [],
      canvas_template_categories: [],
      canvas_templates: [],
    };

    expect(isSettingsExportPayload(payload)).toBe(true);
    expect(isSettingsExportPayload({ ...payload, provider_profiles: {} })).toBe(false);
    expect(isSettingsExportPayload({ ...payload, generation_resource_groups: {} })).toBe(false);
    expect(isSettingsExportPayload(null)).toBe(false);
  });
});
