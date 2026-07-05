import { describe, expect, it } from "vitest";

import {
  configCategoryGroups,
  configItemHelpContent,
  configValuesFromChangedDrafts,
  clearTextConfigJsonResponseFormatTestRecord,
  clearTextConfigTestRecord,
  draftsFromConfig,
  filterConfigResponseForSettingsSection,
  filterGenerationConfigsByLatestTestFailure,
  filterGenerationConfigsByName,
  filterProviderModels,
  filterProviderProfiles,
  archiveFailureMessage,
  isSettingsSectionPathname,
  isLoginPageMode,
  isLoginPageTemplateId,
  loginPageTemplateConfigItem,
  loginPageTemplateIdFromConfigKey,
  SETTINGS_DEFAULT_SECTION_ID,
  type GenerationConfigDraft,
  generationConfigDraft as generationConfigDraftFromConfig,
  generationConfigDraftAfterProviderProfileSelection,
  generationConfigBatchFailedSelectableIds,
  generationConfigBatchSelectableIds,
  generationConfigsUsingProvider,
  generationConfigLatestTestDetail,
  generationConfigResourceGroupIds,
  generationConfigPayloadFromDraft,
  markTextConfigJsonResponseFormatTestFailed,
  markTextConfigJsonResponseFormatTestStarted,
  markTextConfigJsonResponseFormatTestSucceeded,
  markTextConfigTestFailed,
  markTextConfigTestStarted,
  markTextConfigTestSucceeded,
  newGenerationConfigDraft,
  normalizeImageConfigTestDraft,
  normalizeTextConfigTestDraft,
  providerDisableBlocked,
  providerConfigWithGenerationConfig,
  providerConfigWithGenerationResourceGroup,
  providerConfigWithProviderProfile,
  providerDrawerCreateState,
  providerDrawerEditState,
  providerFormFromProfile,
  providerProfilesForGenerationConfig,
  providerProfileCreatePayload,
  providerProfileUpdatePayload,
  providerUsageFromGenerationConfigs,
  providerUsageLabelKeys,
  parseLoginPageTemplateConfigDraft,
  runtimeConfigSectionForSettingsSection,
  settingsPathForSection,
  settingsSectionFromPathSegment,
  serializeLoginPageTemplateConfigDraft,
  settingsSectionIds,
  settingsGenerationResourceGroupsInApiOrder,
  shouldShowSettingsMigrationPanel,
  runGenerationConfigBatchTests,
  textConfigJsonResponseFormatTestRecordForKey,
  type TextConfigJsonResponseFormatTestState,
  textConfigTestRecordForKey,
  type TextConfigTestState,
} from "./SettingsPage";
import {
  isSettingsExportPayload,
  settingsExportFilename,
  settingsImportSummaryCounts,
} from "./settings/importExport";
import { ApiError } from "../lib/api";
import { translate } from "../lib/i18n";
import type {
  ConfigItem,
  ConfigResponse,
  GenerationConfig,
  GenerationConfigTestResult,
  GenerationResourceGroup,
  ProviderCapability,
  ProviderConfigResponse,
  ProviderModel,
  ProviderProfile,
  SettingsImportPreviewResponse,
  TextGenerationConfigJsonResponseFormatTestResponse,
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
    api_key_preview:
      "api_key_preview" in overrides ? (overrides.api_key_preview ?? null) : overrides.has_api_key === false ? null : "opena*****main1",
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
  const resourceGroupId =
    "resource_group_id" in overrides ? (overrides.resource_group_id ?? null) : "group-default";
  const resourceGroupIds =
    "resource_group_ids" in overrides
      ? (overrides.resource_group_ids ?? [])
      : resourceGroupId
        ? [resourceGroupId]
        : [];
  return {
    id: overrides.id ?? `${overrides.purpose}-config`,
    resource_group_id: resourceGroupId,
    resource_group_ids: resourceGroupIds,
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
    created_at: overrides.created_at ?? "2026-05-13T00:00:00Z",
    updated_at: overrides.updated_at ?? "2026-05-13T00:00:00Z",
    state: overrides.state ?? null,
    today_stat: overrides.today_stat ?? null,
    latest_test_result: overrides.latest_test_result ?? null,
    provider_max_dimension: overrides.provider_max_dimension ?? null,
  };
}

function generationConfigTestResult(overrides: Partial<GenerationConfigTestResult>): GenerationConfigTestResult {
  return {
    id: overrides.id ?? "test-result-1",
    generation_config_id: overrides.generation_config_id ?? "text-config",
    test_type: overrides.test_type ?? "text",
    status: overrides.status ?? "success",
    tested_at: overrides.tested_at ?? "2026-06-15T10:00:00Z",
    duration_ms: "duration_ms" in overrides ? (overrides.duration_ms ?? null) : 820,
    provider_kind: overrides.provider_kind ?? "mock",
    model_summary: overrides.model_summary ?? {},
    message: overrides.message ?? null,
    error_detail: overrides.error_detail ?? null,
  };
}

const zhT = Object.assign(
  (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) => translate("zh-CN", key, params),
  { locale: "zh-CN" as const },
);

function generationConfigDraft(overrides: Partial<GenerationConfigDraft> & Pick<GenerationConfigDraft, "purpose">): GenerationConfigDraft {
  return {
    id: null,
    resource_group_ids: ["group-default"],
    name: "Config",
    provider_kind: overrides.purpose === "text" ? "mock" : "mock",
    provider_profile_id: "",
    brief_model: "",
    copy_model: "",
    model: "",
    images_quality: "",
    images_style: "",
    responses_background_enabled: true,
    structured_output_enabled: false,
    structured_output_mode: "json_schema",
    structured_json_response_format_enabled: false,
    gemini_api_version: "v1beta",
    gemini_output_mime_type: "",
    priority: "100",
    max_concurrency: "1",
    enabled: true,
    availability_window_minutes: "10",
    failure_threshold: "3",
    cooldown_minutes: "10",
    ...overrides,
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
    image_max_dimension: overrides.image_max_dimension ?? null,
    blur_images_by_default: overrides.blur_images_by_default ?? false,
    archived_at: overrides.archived_at ?? null,
    created_at: overrides.created_at ?? "2026-05-13T00:00:00Z",
    updated_at: overrides.updated_at ?? "2026-05-13T00:00:00Z",
  };
}

function providerConfigResponse(overrides: Partial<ProviderConfigResponse> = {}): ProviderConfigResponse {
  return {
    profiles: overrides.profiles ?? [providerProfile()],
    generation_resource_groups: overrides.generation_resource_groups ?? [generationResourceGroup()],
    generation_configs: overrides.generation_configs ?? [generationConfig({ purpose: "text" })],
    status_summary: overrides.status_summary ?? null,
  };
}

function textConfigTestState(): TextConfigTestState {
  return {
    draft: {
      inspirationName: "蓝天白云青草地",
      category: "自然风景场景",
      price: "",
      sourceNote: "画面包含蓝天、白云和青草地。",
      instruction: "输出清新的短文案",
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

function textConfigJsonResponseFormatTestState(): TextConfigJsonResponseFormatTestState {
  return {
    latestKey: null,
    records: {},
  };
}

function textConfigJsonResponseFormatTestResponse(model: string): TextGenerationConfigJsonResponseFormatTestResponse {
  return {
    generation_config_id: null,
    provider_kind: "openai_chat_completions",
    model,
    parsed_json: { ok: true, model },
    duration_ms: 300,
  };
}

describe("SettingsPage generation config latest test result helpers", () => {
  it("summarizes successful text test models and duration", () => {
    const detail = generationConfigLatestTestDetail(
      generationConfigTestResult({
        test_type: "text",
        status: "success",
        duration_ms: 421,
        model_summary: { brief_model: "mock-brief-v1", copy_model: "mock-copy-v2" },
      }),
      zhT,
    );

    expect(detail).toBe("资料理解 mock-brief-v1 · 文案 mock-copy-v2 · 421ms");
  });

  it("summarizes failed test detail without model placeholders", () => {
    const detail = generationConfigLatestTestDetail(
      generationConfigTestResult({
        test_type: "json_response_format",
        status: "failed",
        duration_ms: null,
        error_detail: "请先启用文案结构化输出",
      }),
      zhT,
    );

    expect(detail).toBe("请先启用文案结构化输出");
  });

  it("summarizes image test model", () => {
    const detail = generationConfigLatestTestDetail(
      generationConfigTestResult({
        test_type: "image",
        status: "success",
        duration_ms: 93,
        model_summary: { model_name: "mock-image-chat-v1" },
      }),
      zhT,
    );

    expect(detail).toBe("模型 mock-image-chat-v1 · 93ms");
  });
});

describe("SettingsPage draft helpers", () => {
  it("maps settings sections to runtime-config query sections only when needed", () => {
    expect(runtimeConfigSectionForSettingsSection("prompts")).toBe("prompts");
    expect(runtimeConfigSectionForSettingsSection("upload")).toBe("upload");
    expect(runtimeConfigSectionForSettingsSection("queue")).toBe("queue");
    expect(runtimeConfigSectionForSettingsSection("layoutAppearance")).toBe("layoutAppearance");
    expect(runtimeConfigSectionForSettingsSection("loginPage")).toBe("loginPage");
    expect(runtimeConfigSectionForSettingsSection("security")).toBe("security");
    expect(runtimeConfigSectionForSettingsSection("providers")).toBeNull();
    expect(runtimeConfigSectionForSettingsSection("weather")).toBeNull();
    expect(runtimeConfigSectionForSettingsSection("migration")).toBeNull();
  });

  it("maps settings submenus to stable route paths", () => {
    expect(SETTINGS_DEFAULT_SECTION_ID).toBe("providers");
    expect(settingsPathForSection("providers")).toBe("/settings/providers");
    expect(settingsPathForSection("resourceGroups")).toBe("/settings/resource-groups");
    expect(settingsPathForSection("globalTemplates")).toBe("/settings/global-templates-hub");
    expect(settingsSectionFromPathSegment("providers")).toBe("providers");
    expect(settingsSectionFromPathSegment("resource-groups")).toBe("resourceGroups");
    expect(settingsSectionFromPathSegment("global-templates-hub")).toBe("globalTemplates");
    expect(settingsSectionFromPathSegment("global-templates")).toBeNull();
    expect(isSettingsSectionPathname("/settings")).toBe(true);
    expect(isSettingsSectionPathname("/settings/providers")).toBe(true);
    expect(isSettingsSectionPathname("/settings/resource-groups")).toBe(true);
    expect(isSettingsSectionPathname("/settings/global-templates")).toBe(false);
    expect(isSettingsSectionPathname("/settings/unknown")).toBe(false);
  });

  it("filters runtime config responses to the active settings submenu", () => {
    const config = configResponse([
      configItem({ key: "prompt_brief_system", category: "提示词", value: "brief" }),
      configItem({ key: "poster_generation_mode", category: "海报与上传", value: "template" }),
      configItem({ key: "image_tool_model", category: "图片工具参数", value: "" }),
      configItem({
        key: "text_generation_max_concurrent_tasks",
        category: "全局生成配置 / 队列容量",
        value: 3,
      }),
      configItem({ key: "ui_layout_scheme", category: "界面与外观", value: "classic" }),
      configItem({ key: "login_page_mode", category: "登录页", value: "random" }),
      configItem({ key: "auth_session_ttl_minutes", category: "安全与运维", value: 4320 }),
    ]);

    expect(filterConfigResponseForSettingsSection(config, "prompts").items.map((item) => item.key)).toEqual([
      "prompt_brief_system",
    ]);
    expect(filterConfigResponseForSettingsSection(config, "upload").items.map((item) => item.key)).toEqual([
      "poster_generation_mode",
      "image_tool_model",
    ]);
    expect(filterConfigResponseForSettingsSection(config, "queue").items.map((item) => item.key)).toEqual([
      "text_generation_max_concurrent_tasks",
    ]);
    expect(filterConfigResponseForSettingsSection(config, "layoutAppearance").items.map((item) => item.key)).toEqual([
      "ui_layout_scheme",
    ]);
    expect(filterConfigResponseForSettingsSection(config, "loginPage").items.map((item) => item.key)).toEqual([
      "login_page_mode",
    ]);
    expect(filterConfigResponseForSettingsSection(config, "security").items.map((item) => item.key)).toEqual([
      "auth_session_ttl_minutes",
    ]);
  });

  it("documents every supported prompt placeholder in settings help", () => {
    const t = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
      translate("zh-CN", key, params);
    const posterHelp = configItemHelpContent(
      configItem({
        key: "prompt_poster_image_template",
        category: "提示词",
        description: "template",
        value: "",
      }),
      t,
    );
    const chatHelp = configItemHelpContent(
      configItem({
        key: "prompt_image_chat_template",
        category: "提示词",
        description: "template",
        value: "",
      }),
      t,
    );
    const systemHelp = configItemHelpContent(
      configItem({
        key: "prompt_brief_system",
        category: "提示词",
        description: "system",
        value: "",
      }),
      t,
    );

    expect(posterHelp?.examples).toBeDefined();
    expect(chatHelp?.examples).toBeDefined();
    expect(systemHelp?.examples).toBeDefined();

    const posterExamples = posterHelp?.examples?.join("\n") ?? "";
    const chatExamples = chatHelp?.examples?.join("\n") ?? "";
    const systemExamples = systemHelp?.examples?.join("\n") ?? "";

    expect(posterExamples).toContain("{inspiration_name}");
    expect(posterExamples).toContain("{category}");
    expect(posterExamples).toContain("{price}");
    expect(posterExamples).toContain("{source_note}");
    expect(posterExamples).toContain("{instruction}");
    expect(posterExamples).toContain("{size}");
    expect(posterExamples).toContain("{context_block}");
    expect(posterExamples).toContain("{reference_policy}");
    expect(posterExamples).toContain("{kind}");
    expect(posterExamples).toContain("{kind_label}");
    expect(posterExamples).toContain("{kind_requirements}");
    expect(chatExamples).toContain("{prompt}");
    expect(chatExamples).toContain("{size}");
    expect(chatExamples).toContain("{history_block}");
    expect(systemExamples).toContain("不会经过占位符渲染");
  });

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

  it("normalizes generation config test drafts without discarding empty user text", () => {
    expect(
      normalizeTextConfigTestDraft({
        inspirationName: "测试",
        category: "",
        price: "12",
        sourceNote: "",
        instruction: "输出短句",
      }),
    ).toEqual({
      inspirationName: "测试",
      category: "",
      price: "12",
      sourceNote: "",
      instruction: "输出短句",
    });

    expect(normalizeImageConfigTestDraft({ size: "", prompt: "" })).toEqual({
      size: "1024x1024",
      prompt: "",
    });
  });

  it("migrates legacy default generation config test drafts to the current scene preset", () => {
    expect(
      normalizeTextConfigTestDraft({
        inspirationName: "测试灵感产物",
        category: "电商灵感产物",
        price: "",
        sourceNote: "用于验证当前文案生成配置的测试输入。",
        instruction: "输出适合主图的短文案。",
      }),
    ).toEqual({
      inspirationName: "蓝天白云青草地",
      category: "自然风景场景",
      price: "",
      sourceNote: "画面包含明亮蓝天、轻盈白云和连片青草地，氛围清新开阔，适合表达户外自然与舒展感。",
      instruction: "围绕蓝天白云青草地生成清晰、自然、适合画面展示的短文案。",
    });

    expect(
      normalizeImageConfigTestDraft({
        size: "1536x1024",
        prompt: "生成一张干净的产品展示图，主体清晰，背景简洁，适合验证当前图片生成配置。",
      }),
    ).toEqual({
      size: "1536x1024",
      prompt: "蓝天白云下，一片开阔柔软的青草地延伸到远处，阳光明亮，画面清新自然，空气通透，构图干净。",
    });
  });

  it("groups global generation config items by backend category suffix", () => {
    const groups = configCategoryGroups([
      configItem({
        key: "text_generation_max_concurrent_tasks",
        category: "全局生成配置 / 队列容量",
        value: 3,
      }),
      configItem({
        key: "image_generation_max_concurrent_tasks",
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
      ["队列容量", ["text_generation_max_concurrent_tasks", "image_generation_max_concurrent_tasks"]],
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

  it("treats login page selection as random plus concrete templates", () => {
    expect(isLoginPageTemplateId("command-orbit")).toBe(true);
    expect(isLoginPageTemplateId("fluid-mist")).toBe(true);
    expect(isLoginPageTemplateId("image-lab")).toBe(true);
    expect(isLoginPageTemplateId("random")).toBe(false);
    expect(isLoginPageTemplateId("selected")).toBe(false);
    expect(isLoginPageMode("random")).toBe(true);
    expect(isLoginPageMode("command-orbit")).toBe(true);
    expect(isLoginPageMode("selected")).toBe(false);
    expect(loginPageTemplateIdFromConfigKey("login_page_command_orbit_config")).toBe("command-orbit");
    expect(loginPageTemplateIdFromConfigKey("login_page_fluid_mist_config")).toBe("fluid-mist");
    expect(loginPageTemplateIdFromConfigKey("login_page_image_lab_config")).toBe("image-lab");
    expect(loginPageTemplateIdFromConfigKey("login_page_mode")).toBeNull();
  });

  it("keeps each login page JSON config isolated by template", () => {
    const items = [
      configItem({ key: "login_page_mode", category: "登录页", value: "random" }),
      configItem({
        key: "login_page_command_orbit_config",
        category: "登录页",
        input_type: "textarea",
        value: JSON.stringify({
          brand_subtitle: "Orbit",
          hero_title: "Console",
          hero_description: "Command copy",
        }),
      }),
      configItem({
        key: "login_page_image_lab_config",
        category: "登录页",
        input_type: "textarea",
        value: JSON.stringify({
          hero_description: "Image copy",
          hero_image_asset_id: "asset-1",
        }),
      }),
    ];

    expect(loginPageTemplateConfigItem(items, "command-orbit")?.key).toBe("login_page_command_orbit_config");
    expect(loginPageTemplateConfigItem(items, "image-lab")?.key).toBe("login_page_image_lab_config");

    const commandConfig = parseLoginPageTemplateConfigDraft(
      "command-orbit",
      items[1].value,
    );
    const imageLabConfig = parseLoginPageTemplateConfigDraft("image-lab", items[2].value);

    expect(commandConfig).toEqual({
      brand_subtitle: "Orbit",
      hero_title: "Console",
      hero_description: "Command copy",
    });
    expect(imageLabConfig).toEqual({
      hero_description: "Image copy",
      hero_image_asset_id: "asset-1",
    });
    expect(
      serializeLoginPageTemplateConfigDraft("image-lab", {
        ...imageLabConfig,
        hero_image_asset_id: "asset-2",
      }),
    ).toBe(JSON.stringify({ hero_description: "Image copy", hero_image_asset_id: "asset-2" }));
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

  it("keeps JSON response_format test records separate from text output tests", () => {
    const result = textConfigJsonResponseFormatTestResponse("grok-copy");
    let state = textConfigJsonResponseFormatTestState();

    state = markTextConfigJsonResponseFormatTestStarted(state, "config-a");
    state = markTextConfigJsonResponseFormatTestSucceeded(state, "config-a", result);
    state = markTextConfigJsonResponseFormatTestFailed(state, "config-b", "json mode failed");

    expect(textConfigJsonResponseFormatTestRecordForKey(state, "config-a")).toEqual({
      testing: false,
      result,
      error: "",
    });
    expect(textConfigJsonResponseFormatTestRecordForKey(state, "config-b")).toEqual({
      testing: false,
      result: null,
      error: "json mode failed",
    });
    expect(textConfigTestRecordForKey(textConfigTestState(), "config-a")).toBeNull();
  });

  it("clears stale create-dialog test records by key only", () => {
    const textResult = textConfigTestResponse("brief-a");
    const jsonResult = textConfigJsonResponseFormatTestResponse("json-a");
    let textState = textConfigTestState();
    let jsonState = textConfigJsonResponseFormatTestState();

    textState = markTextConfigTestSucceeded(textState, "new-text-group-a", textResult);
    textState = markTextConfigTestFailed(textState, "config-b", "provider failed");
    jsonState = markTextConfigJsonResponseFormatTestSucceeded(jsonState, "new-text-group-a", jsonResult);
    jsonState = markTextConfigJsonResponseFormatTestFailed(jsonState, "config-b", "json failed");

    textState = clearTextConfigTestRecord(textState, "new-text-group-a");
    jsonState = clearTextConfigJsonResponseFormatTestRecord(jsonState, "new-text-group-a");

    expect(textConfigTestRecordForKey(textState, "new-text-group-a")).toBeNull();
    expect(textConfigJsonResponseFormatTestRecordForKey(jsonState, "new-text-group-a")).toBeNull();
    expect(textConfigTestRecordForKey(textState, "config-b")?.error).toBe("provider failed");
    expect(textConfigJsonResponseFormatTestRecordForKey(jsonState, "config-b")?.error).toBe("json failed");
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

  it("filters provider profiles by name, id, base URL, or provider type", () => {
    const profiles = [
      providerProfile({ id: "openrouter-main", name: "OpenRouter", base_url: "https://openrouter.ai/api/v1" }),
      providerProfile({
        id: "gemini-image",
        name: "Gemini Image",
        provider_type: "google_gemini",
        base_url: null,
        capabilities: ["image_google_gemini"],
      }),
      providerProfile({ id: "backup", name: "Backup Gateway", base_url: "https://gateway.example/v1" }),
    ];

    expect(filterProviderProfiles(profiles, "").map((profile) => profile.id)).toEqual([
      "openrouter-main",
      "gemini-image",
      "backup",
    ]);
    expect(filterProviderProfiles(profiles, " ROUTER ").map((profile) => profile.id)).toEqual(["openrouter-main"]);
    expect(filterProviderProfiles(profiles, "google").map((profile) => profile.id)).toEqual(["gemini-image"]);
    expect(filterProviderProfiles(profiles, "gateway.example").map((profile) => profile.id)).toEqual(["backup"]);
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
        image_max_dimension: null,
        image_max_dimension_mode: "preset",
        image_max_dimension_custom_value: "",
      },
    });
  });

  it("creates clean generation config drafts for the active resource group", () => {
    expect(newGenerationConfigDraft("text", "group-a")).toMatchObject({
      id: null,
      purpose: "text",
      resource_group_ids: ["group-a"],
      name: "Text config",
      provider_kind: "mock",
      provider_profile_id: "",
    });
    expect(newGenerationConfigDraft("image", "")).toMatchObject({
      id: null,
      purpose: "image",
      resource_group_ids: [],
      name: "Image config",
      provider_kind: "mock",
      provider_profile_id: "",
    });
  });

  it("opens the drawer in edit mode without echoing the existing API key", () => {
    const profile = providerProfile({
      id: "profile-edit",
      name: "Custom",
      base_url: null,
      capabilities: ["text_responses", "image_responses"],
      config: { capabilities: { image_max_dimension: 3072 } },
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
        image_max_dimension: 3072,
        image_max_dimension_mode: "preset",
        image_max_dimension_custom_value: "",
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
        image_max_dimension: null,
        image_max_dimension_mode: "preset",
        image_max_dimension_custom_value: "",
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
      image_max_dimension: 2048,
      image_max_dimension_mode: "preset" as const,
      image_max_dimension_custom_value: "",
    };

    expect(providerProfileCreatePayload(form)).toEqual({
      name: "OpenRouter",
      provider_type: "openai_compatible",
      base_url: "https://openrouter.ai/api/v1",
      api_key: null,
      capabilities: ["text_responses", "image_images"],
      enabled: true,
      config: {
        capabilities: {
          image_max_dimension: 2048,
        },
      },
    });
    expect(providerProfileUpdatePayload(form)).toEqual({
      name: "OpenRouter",
      provider_type: "openai_compatible",
      base_url: "https://openrouter.ai/api/v1",
      api_key: "",
      capabilities: ["text_responses", "image_images"],
      enabled: true,
      config: {
        capabilities: {
          image_max_dimension: 2048,
        },
      },
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
      image_max_dimension: null,
      image_max_dimension_mode: "preset" as const,
      image_max_dimension_custom_value: "",
    };

    expect(providerProfileCreatePayload(form)).toEqual({
      name: "Gemini",
      provider_type: "google_gemini",
      base_url: null,
      api_key: "google-key",
      capabilities: ["image_google_gemini"],
      enabled: true,
      config: {
        capabilities: {
          image_max_dimension: null,
        },
      },
    });
    expect(providerProfileUpdatePayload(form)).toEqual({
      name: "Gemini",
      provider_type: "google_gemini",
      base_url: null,
      api_key: "  google-key  ",
      capabilities: ["image_google_gemini"],
      enabled: true,
      config: {
        capabilities: {
          image_max_dimension: null,
        },
      },
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
      generationConfigPayloadFromDraft(generationConfigDraft({
        purpose: "image",
        name: "Gemini image",
        provider_kind: "google_gemini_image",
        provider_profile_id: "profile-gemini",
        model: " gemini-2.5-flash-image ",
        images_quality: "high",
        images_style: "vivid",
        gemini_output_mime_type: " image/png ",
        priority: "80",
        max_concurrency: "2",
        availability_window_minutes: "15",
        failure_threshold: "4",
        cooldown_minutes: "20",
      })),
    ).toEqual({
      resource_group_id: "group-default",
      resource_group_ids: ["group-default"],
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

  it("builds OpenAI Chat image generation config payloads without Images or Responses config", () => {
    expect(
      generationConfigPayloadFromDraft(generationConfigDraft({
        purpose: "image",
        name: "Packy Banana",
        provider_kind: "openai_chat_image",
        provider_profile_id: "profile-packy",
        model: " gemini-3-pro-image-preview-16-9-4K ",
        images_quality: "high",
        images_style: "vivid",
        gemini_output_mime_type: " image/png ",
        priority: "80",
        max_concurrency: "2",
        availability_window_minutes: "15",
        failure_threshold: "4",
        cooldown_minutes: "20",
      })),
    ).toEqual({
      resource_group_id: "group-default",
      resource_group_ids: ["group-default"],
      name: "Packy Banana",
      purpose: "image",
      provider_kind: "openai_chat_image",
      provider_profile_id: "profile-packy",
      model_settings: { model: "gemini-3-pro-image-preview-16-9-4K" },
      config: {},
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
      generationConfigPayloadFromDraft(generationConfigDraft({
        purpose: "text",
        name: "Primary text",
        provider_kind: "openai",
        provider_profile_id: "profile-1",
        brief_model: " gpt-5.4 ",
        copy_model: " gpt-5.4 ",
      })),
    ).toEqual({
      resource_group_id: "group-default",
      resource_group_ids: ["group-default"],
      name: "Primary text",
      purpose: "text",
      provider_kind: "openai",
      provider_profile_id: "profile-1",
      model_settings: {
        brief_model: "gpt-5.4",
        copy_model: "gpt-5.4",
      },
      config: { structured_output: { enabled: false, mode: "json_schema" } },
      priority: 100,
      max_concurrency: 1,
      enabled: true,
      availability_window_minutes: 10,
      failure_threshold: 3,
      cooldown_minutes: 10,
    });
  });

  it("preserves Chat Completions text generation config kind in drafts and payloads", () => {
    const draft = generationConfigDraftFromConfig(
      generationConfig({
        purpose: "text",
        name: "Grok Chat",
        provider_kind: "openai_chat_completions",
        provider_profile_id: "profile-chat",
        model_settings: { brief_model: "grok-brief", copy_model: "grok-copy" },
      }),
    );

    expect(draft.provider_kind).toBe("openai_chat_completions");
    expect(
      generationConfigPayloadFromDraft({
        ...draft,
        availability_window_minutes: "10",
        failure_threshold: "3",
        cooldown_minutes: "10",
      }),
    ).toMatchObject({
      name: "Grok Chat",
      purpose: "text",
      provider_kind: "openai_chat_completions",
      provider_profile_id: "profile-chat",
      model_settings: {
        brief_model: "grok-brief",
        copy_model: "grok-copy",
      },
      config: { structured_output: { enabled: false, mode: "json_schema" } },
    });
  });

  it("round-trips legacy Chat Completions structured JSON response_format config", () => {
    const draft = generationConfigDraftFromConfig(
      generationConfig({
        purpose: "text",
        provider_kind: "openai_chat_completions",
        provider_profile_id: "profile-chat",
        model_settings: { brief_model: "grok-brief", copy_model: "grok-copy" },
        config: { structured_json_response_format_enabled: true },
      }),
    );

    expect(draft.structured_output_enabled).toBe(true);
    expect(draft.structured_output_mode).toBe("json_object");
    expect(draft.structured_json_response_format_enabled).toBe(true);
    expect(generationConfigPayloadFromDraft(draft)).toMatchObject({
      provider_kind: "openai_chat_completions",
      config: { structured_output: { enabled: true, mode: "json_object" } },
    });
  });

  it("round-trips Responses structured output config", () => {
    const draft = generationConfigDraftFromConfig(
      generationConfig({
        purpose: "text",
        provider_kind: "openai",
        provider_profile_id: "profile-responses",
        model_settings: { brief_model: "gpt-brief", copy_model: "gpt-copy" },
        config: { structured_output: { enabled: true, mode: "json_schema" } },
      }),
    );

    expect(draft.structured_output_enabled).toBe(true);
    expect(draft.structured_output_mode).toBe("json_schema");
    expect(generationConfigPayloadFromDraft(draft)).toMatchObject({
      provider_kind: "openai",
      config: { structured_output: { enabled: true, mode: "json_schema" } },
    });
  });

  it("filters Chat Completions text configs by text_chat_completions capability", () => {
    const profiles = [
      providerProfile({ id: "responses", capabilities: ["text_responses"] }),
      providerProfile({ id: "chat", capabilities: ["text_chat_completions"] }),
      providerProfile({ id: "disabled-chat", capabilities: ["text_chat_completions"], enabled: false }),
    ];

    expect(
      providerProfilesForGenerationConfig(
        profiles,
        generationConfigDraft({
          purpose: "text",
          provider_kind: "openai_chat_completions",
        }),
      ).map((profile) => profile.id),
    ).toEqual(["chat"]);
    expect(
      providerProfilesForGenerationConfig(
        profiles,
        generationConfigDraft({
          purpose: "text",
          provider_kind: "openai_chat_completions",
          provider_profile_id: "disabled-chat",
        }),
        "disabled-chat",
      ).map((profile) => profile.id),
    ).toEqual(["chat", "disabled-chat"]);
  });

  it("allows generation configs without a resource group", () => {
    expect(
      generationConfigPayloadFromDraft(generationConfigDraft({
        resource_group_ids: [],
        purpose: "text",
        name: "Unbound text",
        provider_kind: "mock",
        brief_model: "mock-brief",
        copy_model: "mock-copy",
        availability_window_minutes: "",
        failure_threshold: "",
        cooldown_minutes: "",
      })).resource_group_id,
    ).toBeNull();
  });

  it("leaves blank scheduler policy fields as runtime defaults", () => {
    expect(
      generationConfigPayloadFromDraft(generationConfigDraft({
        purpose: "text",
        name: "Default policy text",
        provider_kind: "mock",
        brief_model: "mock-brief",
        copy_model: "mock-copy",
        availability_window_minutes: "",
        failure_threshold: "",
        cooldown_minutes: "",
      })),
    ).toMatchObject({
      availability_window_minutes: null,
      failure_threshold: null,
      cooldown_minutes: null,
    });
  });

  it("mirrors multiple generation resource groups in payloads and legacy fallback helpers", () => {
    const payload = generationConfigPayloadFromDraft(
      generationConfigDraft({
        purpose: "text",
        resource_group_ids: ["group-default", "group-seasonal"],
        name: "Shared text",
        provider_kind: "mock",
        brief_model: "mock-brief",
        copy_model: "mock-copy",
      }),
    );

    expect(payload.resource_group_id).toBe("group-default");
    expect(payload.resource_group_ids).toEqual(["group-default", "group-seasonal"]);
    expect(
      generationConfigResourceGroupIds(
        generationConfig({
          purpose: "text",
          resource_group_id: "legacy-group",
          resource_group_ids: [],
        }),
      ),
    ).toEqual(["legacy-group"]);
  });

  it("allows disabling a provider that is currently used by generation configs", () => {
    expect(providerDisableBlocked(providerProfile({ enabled: true }), { text: true, image: false })).toBe(false);
    expect(providerDisableBlocked(providerProfile({ enabled: true }), { text: false, image: false })).toBe(false);
    expect(providerDisableBlocked(providerProfile({ enabled: false }), { text: true, image: true })).toBe(false);
    expect(
      generationConfigsUsingProvider(
        [
          generationConfig({ id: "text-a", purpose: "text", provider_profile_id: "profile-1" }),
          generationConfig({ id: "image-a", purpose: "image", provider_profile_id: "profile-1" }),
          generationConfig({
            id: "archived",
            purpose: "text",
            provider_profile_id: "profile-1",
            archived_at: "2026-06-16T00:00:00Z",
          }),
          generationConfig({ id: "other", purpose: "text", provider_profile_id: "profile-2" }),
        ],
        "profile-1",
      ).map((config) => config.id),
    ).toEqual(["text-a", "image-a"]);
  });

  it("auto-names new generation configs after provider selection while the name is unedited", () => {
    const profiles = [
      providerProfile({ id: "openrouter", name: "OpenRouter" }),
      providerProfile({ id: "packy", name: "Packy" }),
    ];

    expect(
      generationConfigDraftAfterProviderProfileSelection(
        generationConfigDraft({ purpose: "text", name: "Text config" }),
        profiles,
        "openrouter",
        { isNew: true },
      ).name,
    ).toBe("OpenRouter-");
    expect(
      generationConfigDraftAfterProviderProfileSelection(
        generationConfigDraft({ purpose: "text", name: "OpenRouter-" }),
        profiles,
        "packy",
        { isNew: true },
      ).name,
    ).toBe("Packy-");
    expect(
      generationConfigDraftAfterProviderProfileSelection(
        generationConfigDraft({ purpose: "text", name: "Custom" }),
        profiles,
        "openrouter",
        { isNew: true },
      ).name,
    ).toBe("Custom");
    expect(
      generationConfigDraftAfterProviderProfileSelection(
        generationConfigDraft({ purpose: "text", name: "Text config" }),
        profiles,
        "openrouter",
        { isNew: false },
      ).name,
    ).toBe("Text config");
  });

  it("runs batch generation config tests with a bounded concurrency", async () => {
    const items = [1, 2, 3, 4, 5, 6];
    const executed: number[] = [];
    let active = 0;
    let maxActive = 0;

    await runGenerationConfigBatchTests(items, 2, async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      executed.push(item);
      active -= 1;
    });

    expect(executed.sort((left, right) => left - right)).toEqual(items);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("selects only testable generation configs for batch tests", () => {
    const items = [
      { config: generationConfig({ id: "available", purpose: "text" }), disabled: false },
      { config: generationConfig({ id: "disabled", purpose: "text" }), disabled: true },
    ];

    expect(generationConfigBatchSelectableIds(items)).toEqual(["available"]);
  });

  it("selects only testable failed generation configs for batch tests", () => {
    const items = [
      {
        config: generationConfig({
          id: "failed",
          purpose: "text",
          latest_test_result: generationConfigTestResult({ status: "failed" }),
        }),
        disabled: false,
      },
      {
        config: generationConfig({
          id: "passed",
          purpose: "text",
          latest_test_result: generationConfigTestResult({ status: "success" }),
        }),
        disabled: false,
      },
      { config: generationConfig({ id: "untested", purpose: "text" }), disabled: false },
      {
        config: generationConfig({
          id: "disabled-failed",
          purpose: "text",
          latest_test_result: generationConfigTestResult({ status: "failed" }),
        }),
        disabled: true,
      },
    ];

    expect(generationConfigBatchFailedSelectableIds(items)).toEqual(["failed"]);
  });

  it("filters generation config lists by failed latest test after name search", () => {
    const configs = [
      generationConfig({
        id: "openai-failed",
        purpose: "text",
        name: "OpenAI failed config",
        latest_test_result: generationConfigTestResult({ status: "failed" }),
      }),
      generationConfig({
        id: "openai-passed",
        purpose: "text",
        name: "OpenAI passed config",
        latest_test_result: generationConfigTestResult({ status: "success" }),
      }),
      generationConfig({
        id: "mock-failed",
        purpose: "text",
        name: "Mock failed config",
        latest_test_result: generationConfigTestResult({ status: "failed" }),
      }),
      generationConfig({ id: "openai-untested", purpose: "text", name: "OpenAI untested config" }),
    ];

    const searchedConfigs = filterGenerationConfigsByName(configs, "openai");

    expect(filterGenerationConfigsByLatestTestFailure(searchedConfigs, false).map((config) => config.id)).toEqual([
      "openai-failed",
      "openai-passed",
      "openai-untested",
    ]);
    expect(filterGenerationConfigsByLatestTestFailure(searchedConfigs, true).map((config) => config.id)).toEqual([
      "openai-failed",
    ]);
  });

  it("merges provider profile mutation responses into provider config cache", () => {
    const cached = providerConfigResponse({
      profiles: [providerProfile({ id: "profile-1", name: "Old" })],
    });

    expect(
      providerConfigWithProviderProfile(cached, providerProfile({ id: "profile-1", name: "Updated" }))?.profiles,
    ).toMatchObject([{ id: "profile-1", name: "Updated" }]);
    expect(
      providerConfigWithProviderProfile(cached, providerProfile({ id: "profile-1", archived_at: "2026-06-13T00:00:00Z" }))
        ?.profiles,
    ).toEqual([]);
  });

  it("merges generation config mutation responses into provider config cache", () => {
    const cached = providerConfigResponse({
      generation_configs: [generationConfig({ id: "text-config", purpose: "text", name: "Old" })],
    });

    expect(
      providerConfigWithGenerationConfig(
        cached,
        generationConfig({ id: "text-config", purpose: "text", name: "Updated" }),
      )?.generation_configs,
    ).toMatchObject([{ id: "text-config", name: "Updated" }]);
    expect(
      providerConfigWithGenerationConfig(
        cached,
        generationConfig({
          id: "text-config",
          purpose: "text",
          archived_at: "2026-06-13T00:00:00Z",
        }),
      )?.generation_configs,
    ).toEqual([]);
  });

  it("merges generation resource group mutation responses into provider config cache", () => {
    const cached = providerConfigResponse({
      generation_resource_groups: [generationResourceGroup({ id: "group-default", name: "Old" })],
    });

    expect(
      providerConfigWithGenerationResourceGroup(
        cached,
        generationResourceGroup({ id: "group-default", name: "Updated" }),
      )?.generation_resource_groups,
    ).toMatchObject([{ id: "group-default", name: "Updated" }]);
    expect(
      providerConfigWithGenerationResourceGroup(
        cached,
        generationResourceGroup({ id: "group-default", archived_at: "2026-06-13T00:00:00Z" }),
      )?.generation_resource_groups,
    ).toEqual([]);
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

  it("localizes generation delete confirmation dialog copy", () => {
    expect(translate("zh-CN", "settings.resourceGroup.archiveConfirmTitle")).toBe("删除生成分组");
    expect(translate("zh-CN", "settings.resourceGroup.archiveConfirm", { name: "default" })).toBe(
      "确定删除生成分组「default」吗？删除后该分组不再出现在调度配置里。",
    );
    expect(translate("zh-CN", "settings.generation.archiveConfirmTitle")).toBe("删除生成配置");
    expect(translate("zh-CN", "settings.generation.archiveConfirm", { name: "main" })).toBe(
      "确定删除生成配置「main」吗？删除后该配置不再参与调度。",
    );
    expect(translate("en-US", "settings.resourceGroup.archiveConfirm", { name: "default" })).toBe(
      'Delete generation group "default"? It will no longer appear in scheduling settings.',
    );
    expect(translate("en-US", "settings.generation.archiveConfirm", { name: "main" })).toBe(
      'Delete generation config "main"? It will no longer participate in scheduling.',
    );
    expect(translate("ja-JP", "settings.resourceGroup.archiveConfirmTitle")).toBe("生成グループを削除");
    expect(translate("ja-JP", "settings.generation.archiveConfirmTitle")).toBe("生成設定を削除");
  });

  it("localizes runtime reset confirmation and split migration module copy", () => {
    expect(translate("zh-CN", "settings.restoreDefaultConfirmTitle")).toBe("恢复 env/default");
    expect(
      translate("zh-CN", "settings.restoreDefaultConfirm", {
        label: "启用业务删除",
        key: "deletion_enabled",
      }),
    ).toBe("确定恢复「启用业务删除」到 env/default 吗？这会删除数据库覆盖值（deletion_enabled）。");
    expect(translate("zh-CN", "settings.restoreDefaultConfirmLabel")).toBe("确认恢复");
    expect(translate("zh-CN", "settings.migration.exportTitle")).toBe("导出配置");
    expect(translate("zh-CN", "settings.migration.importTitle")).toBe("导入配置");

    expect(translate("en-US", "settings.restoreDefaultConfirmTitle")).toBe("Restore env/default");
    expect(
      translate("en-US", "settings.restoreDefaultConfirm", {
        label: "Business deletion",
        key: "deletion_enabled",
      }),
    ).toBe('Restore "Business deletion" to env/default? This removes the database override (deletion_enabled).');
    expect(translate("en-US", "settings.restoreDefaultConfirmLabel")).toBe("Restore");
    expect(translate("en-US", "settings.migration.exportTitle")).toBe("Export settings");
    expect(translate("en-US", "settings.migration.importTitle")).toBe("Import settings");

    expect(translate("ja-JP", "settings.restoreDefaultConfirmTitle")).toBe("env/default を復元");
    expect(translate("ja-JP", "settings.migration.exportTitle")).toBe("設定をエクスポート");
    expect(translate("ja-JP", "settings.migration.importTitle")).toBe("設定をインポート");
  });

  it("localizes Google Gemini provider labels", () => {
    expect(translate("zh-CN", "settings.provider.capability.imageChat")).toBe("Chat Completions 图片");
    expect(translate("zh-CN", "settings.provider.interface.openaiChatImage")).toBe("OpenAI Chat 图片");
    expect(translate("zh-CN", "settings.provider.capability.imageGoogleGemini")).toBe("Google Gemini 图片");
    expect(translate("zh-CN", "settings.provider.type.googleGemini")).toBe("Google Gemini");
    expect(translate("zh-CN", "settings.provider.interface.googleGeminiImage")).toBe(
      "Google Gemini Image (未实测)",
    );
    expect(translate("en-US", "settings.provider.capability.imageChat")).toBe("Chat Completions image");
    expect(translate("en-US", "settings.provider.interface.openaiChatImage")).toBe("OpenAI Chat Image");
    expect(translate("en-US", "settings.provider.capability.imageGoogleGemini")).toBe("Google Gemini image");
    expect(translate("en-US", "settings.provider.type.googleGemini")).toBe("Google Gemini");
    expect(translate("en-US", "settings.provider.interface.googleGeminiImage")).toBe(
      "Google Gemini Image (untested)",
    );
  });
});

describe("SettingsPage import/export helpers", () => {
  it("keeps archive API failure details for the confirmation dialog", () => {
    const fallback = "生成配置删除失败";

    expect(archiveFailureMessage(new ApiError(409, "仍被默认配置引用"), fallback)).toBe("仍被默认配置引用");
    expect(archiveFailureMessage(new Error("network"), fallback)).toBe(fallback);
  });

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
      generation_resource_group_count: 1,
      generation_config_count: 2,
      canvas_template_category_count: 3,
      canvas_template_count: 7,
      provider_profile_names: ["主供应商", "备用供应商"],
      includes_api_keys: true,
      provider_profiles_with_api_key_count: 1,
      canvas_template_keys: ["global:one"],
      canvas_template_category_names: ["平台首图"],
    };

    expect(settingsImportSummaryCounts(preview)).toEqual({
      runtimeConfigCount: 14,
      providerProfileCount: 2,
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
