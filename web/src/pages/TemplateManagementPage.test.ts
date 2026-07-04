import { describe, expect, it } from "vitest";

import type { CanvasTemplateSummary } from "../lib/types";
import {
  sortTemplateManagementTemplates,
  templateManagementInitialWorkflowEntry,
  templateManagementTemplateQueryInputs,
} from "./TemplateManagementPage";

function templateSummary(
  overrides: Partial<CanvasTemplateSummary> & Pick<CanvasTemplateSummary, "key" | "title" | "entry_mode">,
): CanvasTemplateSummary {
  return {
    key: overrides.key,
    template_id: overrides.template_id ?? overrides.key,
    version: overrides.version ?? 1,
    kind: overrides.kind ?? "full_canvas",
    entry_mode: overrides.entry_mode,
    sort_order: overrides.sort_order ?? 100,
    title: overrides.title,
    description: overrides.description ?? "",
    source: overrides.source ?? "user",
    user_template_id: overrides.user_template_id ?? overrides.key,
    scope: overrides.scope ?? "user",
    category_id: overrides.category_id ?? null,
    category_name: overrides.category_name ?? null,
    owner_user_id: overrides.owner_user_id ?? "user-1",
    owner_username: overrides.owner_username ?? "tester",
    enabled: overrides.enabled ?? true,
    effective_enabled: overrides.effective_enabled ?? true,
    disabled_reason: overrides.disabled_reason ?? null,
    review_status: overrides.review_status ?? "approved",
    review_note: overrides.review_note ?? null,
    review_submitted_at: overrides.review_submitted_at ?? null,
    reviewed_at: overrides.reviewed_at ?? null,
    reviewed_by_user_id: overrides.reviewed_by_user_id ?? null,
    reviewed_by_username: overrides.reviewed_by_username ?? null,
    scenario: overrides.scenario ?? {
      scenario: "main_image",
      title: "Main image",
      description: "",
      ecommerce_stage: "discover",
      tags: [],
    },
    preview_nodes: overrides.preview_nodes ?? [],
    preview_edges: overrides.preview_edges ?? [],
    output_slots: overrides.output_slots ?? [],
    reference_input_hints: overrides.reference_input_hints ?? [],
    suggested_connections: overrides.suggested_connections ?? [],
    default_external_connections: overrides.default_external_connections ?? [],
  };
}

describe("TemplateManagementPage helpers", () => {
  it("maps the all entry filter to an omitted workflow entry", () => {
    expect(templateManagementInitialWorkflowEntry("all")).toBeUndefined();
    expect(templateManagementInitialWorkflowEntry("image")).toBe("image");
  });

  it("builds a single server-side query for personal template management", () => {
    expect(
      templateManagementTemplateQueryInputs({
        mode: "personal",
        search: "  主图  ",
        categoryFilter: "cat-1",
        entryFilter: "image",
      }),
    ).toEqual([
      {
        scope: "user",
        search: "主图",
        category_id: "cat-1",
        initial_workflow_entry: "image",
      },
    ]);
  });

  it("splits global template management into global templates and user copy sources", () => {
    expect(
      templateManagementTemplateQueryInputs({
        mode: "global",
        search: "  详情页  ",
        categoryFilter: "global-cat",
        entryFilter: "tail",
      }),
    ).toEqual([
      {
        scope: "global",
        search: "详情页",
        category_id: "global-cat",
        initial_workflow_entry: "tail",
      },
      {
        scope: "user",
        search: "详情页",
        initial_workflow_entry: "tail",
      },
    ]);
  });

  it("preserves backend-like ordering after merging split template queries", () => {
    const sorted = sortTemplateManagementTemplates([
      templateSummary({
        key: "user-copy-z",
        title: "用户尾图",
        entry_mode: "copy",
        scope: "user",
        sort_order: 20,
      }),
      templateSummary({
        key: "global-copy-a",
        title: "全局文案",
        entry_mode: "copy",
        scope: "global",
        sort_order: 10,
      }),
      templateSummary({
        key: "user-image-a",
        title: "用户主图",
        entry_mode: "image",
        scope: "user",
        sort_order: 5,
      }),
      templateSummary({
        key: "global-tail-a",
        title: "全局尾图",
        entry_mode: "tail",
        scope: "global",
        sort_order: 1,
      }),
    ]);

    expect(sorted.map((template) => template.key)).toEqual([
      "user-image-a",
      "global-copy-a",
      "user-copy-z",
      "global-tail-a",
    ]);
  });
});
