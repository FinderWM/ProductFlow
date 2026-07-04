import { describe, expect, it } from "vitest";

import type { GenerationResourceGroup } from "./types";
import {
  activeGenerationResourceGroupsInApiOrder,
  firstActiveGenerationResourceGroupId,
} from "./resourceGroups";

function group(overrides: Partial<GenerationResourceGroup>): GenerationResourceGroup {
  return {
    id: "group-default",
    key: "default",
    name: "default",
    description: null,
    sort_order: 0,
    enabled: true,
    image_max_dimension: null,
    blur_images_by_default: false,
    archived_at: null,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

describe("resource group selection helpers", () => {
  it("filters unavailable groups while preserving API order", () => {
    const filtered = activeGenerationResourceGroupsInApiOrder([
      group({ id: "default", name: "default", sort_order: 0 }),
      group({ id: "disabled", name: "Disabled", sort_order: 300, enabled: false }),
      group({ id: "archived", name: "Archived", sort_order: 300, archived_at: "2026-06-02T00:00:00Z" }),
      group({ id: "premium-later", name: "Premium Later", sort_order: 200, created_at: "2026-06-03T00:00:00Z" }),
      group({ id: "premium-earlier", name: "Premium Earlier", sort_order: 200, created_at: "2026-06-02T00:00:00Z" }),
      group({ id: "campaign", name: "Campaign", sort_order: 100 }),
    ]);

    expect(filtered.map((item) => item.id)).toEqual(["default", "premium-later", "premium-earlier", "campaign"]);
  });

  it("selects the first concrete group from API order", () => {
    expect(
      firstActiveGenerationResourceGroupId([
        group({ id: "campaign", sort_order: 100 }),
        group({ id: "default", sort_order: 0 }),
      ]),
    ).toBe("campaign");
    expect(firstActiveGenerationResourceGroupId([])).toBe("");
  });
});
