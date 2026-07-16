import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ProviderProfile } from "../../../lib/types";
import { EMPTY_PROVIDER_FORM } from "../providerForm";
import { ProvidersSection } from "./ProvidersSection";

function providerProfile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: overrides.id ?? "provider-1",
    name: overrides.name ?? "Provider",
    provider_type: overrides.provider_type ?? "openai_compatible",
    base_url: overrides.base_url ?? "https://example.com/v1",
    api_key_preview: overrides.api_key_preview ?? "provi*****der1",
    capabilities: overrides.capabilities ?? ["text_responses"],
    default_models: overrides.default_models ?? {},
    config: overrides.config ?? {},
    enabled: overrides.enabled ?? true,
    archived_at: overrides.archived_at ?? null,
    has_api_key: overrides.has_api_key ?? true,
    created_at: overrides.created_at ?? "2026-07-16T00:00:00Z",
    updated_at: overrides.updated_at ?? "2026-07-16T00:00:00Z",
  };
}

function renderProvidersSection(workspaceSubpage: boolean): string {
  return renderToStaticMarkup(
    createElement(ProvidersSection, {
      profiles: [
        providerProfile({ id: "enabled", name: "Enabled Provider" }),
        providerProfile({ id: "disabled", name: "Disabled Provider", enabled: false }),
      ],
      profileForm: EMPTY_PROVIDER_FORM,
      editingProfileId: null,
      drawerOpen: false,
      pending: false,
      togglingProfileId: null,
      canWrite: true,
      workspaceSubpage,
      onProfileFormChange: () => undefined,
      onOpenCreate: () => undefined,
      onEditProfile: () => undefined,
      onCloseDrawer: () => undefined,
      onSubmitProfile: () => undefined,
      onDeleteProfile: () => undefined,
      onToggleProfileEnabled: () => undefined,
    }),
  );
}

describe("ProvidersSection status tabs", () => {
  it("renders the status tabs between search and the default enabled-provider cards", () => {
    const markup = renderProvidersSection(false);
    const searchIndex = markup.indexOf('type="search"');
    const tabsIndex = markup.indexOf('role="tablist"');
    const cardIndex = markup.indexOf("Enabled Provider");

    expect(searchIndex).toBeGreaterThanOrEqual(0);
    expect(tabsIndex).toBeGreaterThan(searchIndex);
    expect(cardIndex).toBeGreaterThan(tabsIndex);
    expect(markup).toContain("pf-classic-horizontal-switch-tabs");
    expect(markup).toContain("flex flex-wrap gap-1");
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain("已启用");
    expect(markup).toContain("未启用");
    expect(markup).not.toContain("Disabled Provider");
  });

  it("selects the workspace tab appearance for the workspace settings layout", () => {
    const markup = renderProvidersSection(true);

    expect(markup).toContain("pf-workspace-horizontal-switch-tabs");
    expect(markup).not.toContain("pf-classic-horizontal-switch-tabs");
    expect(markup).toContain("flex flex-wrap gap-1");
  });
});
