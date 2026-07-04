import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LayoutSwitchTabs, layoutSwitchTabClassName, layoutSwitchTabsClassName } from "./LayoutSwitchTabs";

describe("LayoutSwitchTabs", () => {
  it("builds layout-specific horizontal switch classes", () => {
    expect(layoutSwitchTabsClassName("classic", "extra-class")).toBe(
      "pf-settings-generation-tabs pf-classic-horizontal-switch-tabs flex flex-wrap gap-1 extra-class",
    );
    expect(layoutSwitchTabsClassName("workspace")).toBe(
      "pf-settings-generation-tabs pf-workspace-horizontal-switch-tabs flex flex-wrap gap-1",
    );
    expect(layoutSwitchTabClassName(true, "flex-1")).toBe(
      "pf-settings-generation-tab inline-flex min-h-9 items-center justify-center px-3 py-2 text-sm font-semibold transition-all is-active flex-1",
    );
  });

  it("renders tabs with selected state instead of action-button classes", () => {
    const markup = renderToStaticMarkup(
      createElement(LayoutSwitchTabs, {
        appearance: "workspace",
        value: "users",
        items: [
          { value: "users", label: "Users" },
          { value: "roles", label: "Roles" },
        ],
        ariaLabel: "RBAC",
        onChange: () => undefined,
      }),
    );

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('role="tab"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('aria-current="true"');
    expect(markup).toContain("pf-workspace-horizontal-switch-tabs");
    expect(markup).toContain("pf-settings-generation-tab");
    expect(markup).not.toContain("pf-workspace-action-button");
    expect(markup).not.toContain("pf-classic-action-button");
  });
});
