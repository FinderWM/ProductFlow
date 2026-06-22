// 生成资源分组的表单草稿类型与纯逻辑：草稿构造、配置计数、提交载荷、草稿 key。
// 从 SettingsPage.tsx 抽出。

import type {
  GenerationConfig,
  GenerationResourceGroup,
  GenerationResourceGroupCreateRequest,
  GenerationResourceGroupUpdateRequest,
} from "../../lib/types";
import { numberDraftValue } from "./draftValues";

export function generationConfigResourceGroupIds(config: GenerationConfig): string[] {
  return config.resource_group_ids?.length ? config.resource_group_ids : config.resource_group_id ? [config.resource_group_id] : [];
}

export interface GenerationResourceGroupDraft {
  id: string | null;
  key: string;
  name: string;
  description: string;
  sort_order: string;
  enabled: boolean;
  blur_images_by_default: boolean;
}

export function emptyGenerationResourceGroupDraft(): GenerationResourceGroupDraft {
  return {
    id: null,
    key: "",
    name: "",
    description: "",
    sort_order: "100",
    enabled: true,
    blur_images_by_default: false,
  };
}

export function generationResourceGroupDraft(group: GenerationResourceGroup): GenerationResourceGroupDraft {
  return {
    id: group.id,
    key: group.key,
    name: group.name,
    description: group.description ?? "",
    sort_order: String(group.sort_order),
    enabled: group.enabled,
    blur_images_by_default: Boolean(group.blur_images_by_default),
  };
}

export function generationConfigCountsForResourceGroup(
  generationConfigs: GenerationConfig[],
  resourceGroupId: string,
): { text: number; image: number } {
  return generationConfigs.reduce(
    (counts, generationConfig) => {
      if (!generationConfigResourceGroupIds(generationConfig).includes(resourceGroupId)) {
        return counts;
      }
      if (generationConfig.purpose === "text") {
        counts.text += 1;
      }
      if (generationConfig.purpose === "image") {
        counts.image += 1;
      }
      return counts;
    },
    { text: 0, image: 0 },
  );
}

export function generationResourceGroupPayloadFromDraft(
  draft: GenerationResourceGroupDraft,
): GenerationResourceGroupCreateRequest | GenerationResourceGroupUpdateRequest {
  return {
    key: draft.key.trim(),
    name: draft.name.trim(),
    description: draft.description.trim() || null,
    sort_order: numberDraftValue(draft.sort_order, 100),
    enabled: draft.enabled,
    blur_images_by_default: draft.blur_images_by_default,
  };
}

export function generationResourceGroupDraftKey(draft: GenerationResourceGroupDraft): string {
  return draft.id ?? "new-generation-resource-group";
}
