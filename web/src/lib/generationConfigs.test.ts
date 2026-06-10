import { describe, expect, it } from "vitest";

import type { GenerationConfigOption } from "./types";
import {
  generationConfigOptionLabel,
  generationConfigOptionsForPurpose,
  generationConfigResourceGroupIds,
} from "./generationConfigs";

function option(input: Partial<GenerationConfigOption> & Pick<GenerationConfigOption, "id" | "name">): GenerationConfigOption {
  return {
    resource_group_id: null,
    resource_group_ids: [],
    purpose: "text",
    provider_kind: "mock",
    enabled: true,
    priority: 100,
    frozen_until: null,
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

  it("filters by purpose, selected group, enabled state, and priority", () => {
    const configs = [
      option({ id: "text-low", name: "低优先级", resource_group_ids: ["group"], priority: 10 }),
      option({ id: "text-high", name: "高优先级", resource_group_ids: ["group"], priority: 200 }),
      option({ id: "image", name: "图片", purpose: "image", resource_group_ids: ["group"], priority: 300 }),
      option({ id: "disabled", name: "停用", resource_group_ids: ["group"], enabled: false, priority: 400 }),
      option({ id: "other-group", name: "其它分组", resource_group_ids: ["other"], priority: 500 }),
    ];

    expect(generationConfigOptionsForPurpose(configs, "text", "group").map((config) => config.id)).toEqual([
      "text-high",
      "text-low",
    ]);
  });

  it("adds disabled and frozen markers to labels", () => {
    expect(
      generationConfigOptionLabel(
        option({ id: "frozen", name: "冻结配置", enabled: false, frozen_until: "2026-06-10T00:00:00Z" }),
        "停用",
        "冻结",
      ),
    ).toBe("冻结配置 · mock (停用 · 冻结)");
  });
});
