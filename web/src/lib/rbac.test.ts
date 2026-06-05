import { describe, expect, it } from "vitest";

import {
  hasRbacManagementAccess,
  hasSessionAdminApiPermission,
  hasSessionApiPermission,
  hasSessionMenu,
  hasSettingsPageAccess,
} from "./rbac";
import type { SessionState, SessionUser } from "./types";

const baseUser: SessionUser = {
  id: "user-1",
  username: "member",
  display_name: "Member",
  role_id: "role-member",
  is_admin: false,
  enabled: true,
  password_pending: false,
};

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

  it("requires admin status and api permission for admin api helpers", () => {
    expect(
      hasSessionAdminApiPermission(
        sessionState({
          user: { ...baseUser, is_admin: true },
          api_permissions: [],
        }),
        "rbac:manage",
      ),
    ).toBe(false);
    expect(
      hasSessionAdminApiPermission(
        sessionState({
          user: baseUser,
          api_permissions: ["rbac:manage"],
        }),
        "rbac:manage",
      ),
    ).toBe(false);
    expect(
      hasSessionAdminApiPermission(
        sessionState({
          user: { ...baseUser, is_admin: true },
          api_permissions: ["rbac:manage"],
        }),
        "rbac:manage",
      ),
    ).toBe(true);
  });

  it("matches the backend rbac management gate", () => {
    expect(
      hasRbacManagementAccess(
        sessionState({
          menus: [{ code: "rbac", title: "权限管理", sort_order: 100 }],
          user: { ...baseUser, is_admin: true },
          api_permissions: [],
        }),
      ),
    ).toBe(false);
    expect(
      hasRbacManagementAccess(
        sessionState({
          menus: [{ code: "rbac", title: "权限管理", sort_order: 100 }],
          user: baseUser,
          api_permissions: ["rbac:manage"],
        }),
      ),
    ).toBe(false);
    expect(
      hasRbacManagementAccess(
        sessionState({
          user: { ...baseUser, is_admin: true },
          api_permissions: ["rbac:manage"],
        }),
      ),
    ).toBe(true);
  });
});
