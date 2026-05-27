import { describe, expect, it } from "vitest";

import { hasSessionApiPermission, hasSessionMenu, hasSettingsPageAccess } from "./rbac";
import type { SessionState } from "./types";

function sessionState(overrides: Partial<SessionState> = {}): SessionState {
  return {
    authenticated: true,
    access_required: true,
    user: null,
    menus: [],
    api_permissions: [],
    ...overrides,
  };
}

describe("rbac helpers", () => {
  it("checks session menu and api permissions independently", () => {
    const session = sessionState({
      menus: [{ code: "settings", title: "设置", sort_order: 90 }],
      api_permissions: ["settings:read"],
    });

    expect(hasSessionMenu(session, "settings")).toBe(true);
    expect(hasSessionMenu(session, "status")).toBe(false);
    expect(hasSessionApiPermission(session, "settings:read")).toBe(true);
    expect(hasSessionApiPermission(session, "settings:write")).toBe(false);
  });

  it("requires both settings menu and settings read permission for settings page access", () => {
    expect(
      hasSettingsPageAccess(
        sessionState({
          menus: [{ code: "settings", title: "设置", sort_order: 90 }],
          api_permissions: [],
        }),
      ),
    ).toBe(false);
    expect(
      hasSettingsPageAccess(
        sessionState({
          menus: [],
          api_permissions: ["settings:read"],
        }),
      ),
    ).toBe(false);
    expect(
      hasSettingsPageAccess(
        sessionState({
          menus: [{ code: "settings", title: "设置", sort_order: 90 }],
          api_permissions: ["settings:read"],
        }),
      ),
    ).toBe(true);
  });
});
