// 供应商配置缓存合并、生成配置测试载荷构造、归档错误信息。从 SettingsPage.tsx 抽出的纯逻辑。

import { ApiError } from "../../lib/api";
import type {
  GalleryEntry,
  GenerationConfig,
  GenerationConfigCreateRequest,
  GenerationResourceGroup,
  ImageGenerationConfigTestRequest,
  ImageGenerationConfigTestResponse,
  ProviderConfigResponse,
  ProviderProfile,
  CopySlotRequest,
  TextGenerationConfigJsonResponseFormatTestRequest,
  TextGenerationConfigTestRequest,
} from "../../lib/types";
import { DEFAULT_IMAGE_CONFIG_TEST_DRAFT, DEFAULT_TEXT_CONFIG_TEST_DRAFT } from "./configTestState";
import type { ImageConfigTestDraft, TextConfigTestDraft } from "./configTestState";
import { generationConfigPayloadFromDraft } from "./generationConfig";
import type { GenerationConfigDraft } from "./generationConfig";

function mergeActiveProviderConfigItem<T extends { id: string; archived_at?: string | null }>(items: T[], item: T): T[] {
  const existingIndex = items.findIndex((current) => current.id === item.id);
  if (item.archived_at) {
    return existingIndex === -1 ? items : items.filter((current) => current.id !== item.id);
  }
  if (existingIndex === -1) {
    return [...items, item];
  }
  return items.map((current) => (current.id === item.id ? item : current));
}

export function providerConfigWithProviderProfile(
  data: ProviderConfigResponse | undefined,
  profile: ProviderProfile,
): ProviderConfigResponse | undefined {
  if (!data) {
    return data;
  }
  return {
    ...data,
    profiles: mergeActiveProviderConfigItem(data.profiles, profile),
  };
}

export function providerConfigWithGenerationConfig(
  data: ProviderConfigResponse | undefined,
  generationConfig: GenerationConfig,
): ProviderConfigResponse | undefined {
  if (!data) {
    return data;
  }
  return {
    ...data,
    generation_configs: mergeActiveProviderConfigItem(data.generation_configs, generationConfig),
  };
}

export function providerConfigWithGenerationResourceGroup(
  data: ProviderConfigResponse | undefined,
  group: GenerationResourceGroup,
): ProviderConfigResponse | undefined {
  if (!data) {
    return data;
  }
  return {
    ...data,
    generation_resource_groups: mergeActiveProviderConfigItem(data.generation_resource_groups, group),
  };
}

export function textGenerationConfigTestPayload(
  generationConfigDraft: GenerationConfigDraft,
  testDraft: TextConfigTestDraft,
): TextGenerationConfigTestRequest {
  const generationConfig = generationConfigPayloadFromDraft(generationConfigDraft) as GenerationConfigCreateRequest;
  const requestedSlots = parseTextConfigRequestedSlots(testDraft.requestedSlotsText);
  return {
    generation_config_id: generationConfigDraft.id,
    generation_config: generationConfig,
    reference_asset_ids: [...testDraft.referenceAssetIds],
    inspiration: {
      name: testDraft.inspirationName.trim() || DEFAULT_TEXT_CONFIG_TEST_DRAFT.inspirationName,
      category: testDraft.category.trim() || null,
      price: testDraft.price.trim() || null,
      source_note: testDraft.sourceNote.trim() || null,
    },
    copy_request: {
      instruction: testDraft.instruction.trim() || DEFAULT_TEXT_CONFIG_TEST_DRAFT.instruction,
      purpose: testDraft.purpose.trim() || DEFAULT_TEXT_CONFIG_TEST_DRAFT.purpose,
      channel: testDraft.channel.trim() || DEFAULT_TEXT_CONFIG_TEST_DRAFT.channel,
      tone: testDraft.tone.trim() || DEFAULT_TEXT_CONFIG_TEST_DRAFT.tone,
      output_mode: testDraft.outputMode,
      requested_slots: requestedSlots,
    },
  };
}

export function parseTextConfigRequestedSlots(value: string): CopySlotRequest[] {
  const normalized = value.trim();
  if (!normalized) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new Error("可选槽位必须是有效 JSON 数组。");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("可选槽位必须是 JSON 数组。");
  }
  return parsed.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`可选槽位第 ${index + 1} 项必须是对象。`);
    }
    const record = item as Record<string, unknown>;
    const key = typeof record.key === "string" ? record.key.trim() : "";
    const label = typeof record.label === "string" ? record.label.trim() : "";
    if (!key || !label) {
      throw new Error(`可选槽位第 ${index + 1} 项必须包含 key 和 label。`);
    }
    return {
      key,
      label,
      required: typeof record.required === "boolean" ? record.required : false,
      hint: typeof record.hint === "string" && record.hint.trim() ? record.hint.trim() : null,
    };
  });
}

export function textGenerationConfigJsonResponseFormatTestPayload(
  generationConfigDraft: GenerationConfigDraft,
): TextGenerationConfigJsonResponseFormatTestRequest {
  const generationConfig = generationConfigPayloadFromDraft(generationConfigDraft) as GenerationConfigCreateRequest;
  return {
    generation_config_id: generationConfigDraft.id,
    generation_config: generationConfig,
  };
}

export function imageGenerationConfigTestPayload(
  generationConfigDraft: GenerationConfigDraft,
  testDraft: ImageConfigTestDraft,
  resourceGroupId: string,
): ImageGenerationConfigTestRequest {
  const generationConfig = generationConfigPayloadFromDraft(generationConfigDraft) as GenerationConfigCreateRequest;
  return {
    generation_config_id: generationConfigDraft.id,
    generation_config: generationConfig,
    resource_group_id: resourceGroupId,
    prompt: testDraft.prompt.trim() || DEFAULT_IMAGE_CONFIG_TEST_DRAFT.prompt,
    size: testDraft.size.trim() || DEFAULT_IMAGE_CONFIG_TEST_DRAFT.size,
  };
}

export function imageGenerationConfigTestResultWithGalleryEntry(
  result: ImageGenerationConfigTestResponse,
  entry: GalleryEntry,
): ImageGenerationConfigTestResponse {
  if (result.generated_asset.id !== entry.image.id) {
    return result;
  }
  return {
    ...result,
    generated_asset: entry.image,
    round: {
      ...result.round,
      generated_asset: entry.image,
    },
  };
}

export function archiveFailureMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.detail : fallback;
}
