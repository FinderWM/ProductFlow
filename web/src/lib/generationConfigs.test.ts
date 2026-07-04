import { describe, expect, it } from "vitest";

import type { GenerationConfigOption } from "./types";
import {
  generationConfigOptionEffectiveMaxDimension,
  generationConfigOptionLabel,
  generationConfigOptionsMaxDimension,
  generationConfigOptionsForPurpose,
  generationConfigResourceGroupIds,
  generationConfigSelectionMaxDimension,
} from "./generationConfigs";

function option(input: Partial<GenerationConfigOption> & Pick<GenerationConfigOption, "id" | "name">): GenerationConfigOption {
  return {
    resource_group_id: null,
    resource_group_ids: [],
    purpose: "text",
    provider_kind: "mock",
    enabled: true,
    effective_enabled: input.effective_enabled ?? input.enabled ?? true,
    priority: 100,
    frozen_until: null,
    provider_max_dimension: input.provider_max_dimension ?? null,
    ...input,
  };
}

describe("generation config helpers", () => {
  it("reads multi-group bindings and falls back to the legacy group field", () => {
    expect(generationConfigResourceGroupIds(option({ id: "multi", name: "多分组", resource_group_ids: ["a", "b"] }))).toEqual([
      "a",
      "b",
    ]);
    expect(generationConfigResourceGroupIds(option({ id: "legacy", name: "旧分组", resource_group_id: "legacy" }))).toEqual([
      "legacy",
    ]);
  });

  it("filters by purpose, selected group, effective enabled state, and priority", () => {
    const configs = [
      option({ id: "text-low", name: "低优先级", resource_group_ids: ["group"], priority: 10 }),
      option({ id: "text-high", name: "高优先级", resource_group_ids: ["group"], priority: 200 }),
      option({ id: "image", name: "图片", purpose: "image", resource_group_ids: ["group"], priority: 300 }),
      option({ id: "disabled", name: "停用", resource_group_ids: ["group"], enabled: false, priority: 400 }),
      option({ id: "effective-disabled", name: "有效停用", resource_group_ids: ["group"], effective_enabled: false, priority: 500 }),
      option({ id: "other-group", name: "其它分组", resource_group_ids: ["other"], priority: 500 }),
    ];

    expect(generationConfigOptionsForPurpose(configs, "text", "group").map((config) => config.id)).toEqual([
      "text-high",
      "text-low",
    ]);
  });

  it("resolves option and option-list max dimension with global fallback", () => {
    expect(generationConfigOptionEffectiveMaxDimension(option({ id: "c1", name: "无限制", provider_max_dimension: null }), 4096)).toBe(4096);
    expect(generationConfigOptionEffectiveMaxDimension(option({ id: "c2", name: "2048", provider_max_dimension: 2048 }), 4096)).toBe(2048);
    expect(
      generationConfigOptionsMaxDimension(
        [
          option({ id: "c3", name: "1024", provider_max_dimension: 1024 }),
          option({ id: "c4", name: "无限制", provider_max_dimension: null }),
        ],
        4096,
      ),
    ).toBe(4096);
  });

  it("resolves selection max dimension from manual config, group capability, and global fallback", () => {
    const configs = [
      option({ id: "image-1", name: "图片一", purpose: "image", provider_max_dimension: 2048 }),
      option({ id: "image-2", name: "图片二", purpose: "image", provider_max_dimension: null }),
    ];

    expect(
      generationConfigSelectionMaxDimension({
        mode: "manual",
        generationConfigId: "image-1",
        resourceGroupId: "group-a",
        resourceGroupMaxDimension: 3072,
        options: configs,
        globalMaxDimension: 4096,
      }),
    ).toBe(2048);

    expect(
      generationConfigSelectionMaxDimension({
        mode: "auto",
        generationConfigId: null,
        resourceGroupId: "group-a",
        resourceGroupMaxDimension: 3072,
        options: configs,
        globalMaxDimension: 4096,
      }),
    ).toBe(3072);

    expect(
      generationConfigSelectionMaxDimension({
        mode: "auto",
        generationConfigId: null,
        resourceGroupId: "group-a",
        resourceGroupMaxDimension: null,
        options: configs,
        globalMaxDimension: 4096,
      }),
    ).toBe(4096);

    expect(
      generationConfigSelectionMaxDimension({
        mode: "manual",
        generationConfigId: "missing",
        resourceGroupId: null,
        resourceGroupMaxDimension: null,
        options: configs,
        globalMaxDimension: 4096,
      }),
    ).toBe(4096);
  });

  it("adds disabled and frozen markers to labels", () => {
    expect(
      generationConfigOptionLabel(
        option({ id: "frozen", name: "冻结配置", enabled: false, frozen_until: "2999-06-10T00:00:00Z" }),
        "停用",
        "冻结",
      ),
    ).toBe("冻结配置 · mock (停用 · 冻结)");
  });

  it("does not add frozen marker after frozen_until expires", () => {
    expect(
      generationConfigOptionLabel(
        option({ id: "expired-frozen", name: "已过期冻结", frozen_until: "2000-01-01T00:00:00Z" }),
        "停用",
        "冻结",
      ),
    ).toBe("已过期冻结 · mock");
  });
});
