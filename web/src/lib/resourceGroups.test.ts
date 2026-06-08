import { describe, expect, it } from "vitest";

import type { GenerationResourceGroup } from "./types";
import {
  activeGenerationResourceGroupsByPriority,
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
    archived_at: null,
    created_at: "2026-06-01T00:00:00Z",
    updated_at: "2026-06-01T00:00:00Z",
    ...overrides,
  };
}

describe("resource group selection helpers", () => {
  it("sorts usable groups by descending priority and filters unavailable groups", () => {
    const sorted = activeGenerationResourceGroupsByPriority([
      group({ id: "default", name: "default", sort_order: 0 }),
      group({ id: "disabled", name: "Disabled", sort_order: 300, enabled: false }),
      group({ id: "archived", name: "Archived", sort_order: 300, archived_at: "2026-06-02T00:00:00Z" }),
      group({ id: "premium-later", name: "Premium Later", sort_order: 200, created_at: "2026-06-03T00:00:00Z" }),
      group({ id: "premium-earlier", name: "Premium Earlier", sort_order: 200, created_at: "2026-06-02T00:00:00Z" }),
      group({ id: "campaign", name: "Campaign", sort_order: 100 }),
    ]);

    expect(sorted.map((item) => item.id)).toEqual(["premium-earlier", "premium-later", "campaign", "default"]);
  });

  it("selects the first concrete group after priority sorting", () => {
    expect(
      firstActiveGenerationResourceGroupId([
        group({ id: "default", sort_order: 0 }),
        group({ id: "campaign", sort_order: 100 }),
      ]),
    ).toBe("campaign");
    expect(firstActiveGenerationResourceGroupId([])).toBe("");
  });
});
