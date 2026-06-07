import { describe, expect, it } from "vitest";

import {
  buildPermissionGroups,
  rbacUserListQueryKey,
  rbacUserResourceGroupLabels,
  rolePermissionDraftFromResponse,
  toggleApiPermissionDraft,
  toggleMenuPermissionDraft,
  type RolePermissionDraft,
} from "./RbacPage";
import type { RbacPermissionCatalog, RbacRolePermissions, RbacUser } from "../lib/types";

function permissionCatalog(): RbacPermissionCatalog {
  return {
    menus: [
      { code: "settings", title: "设置", sort_order: 90, enabled: true },
      { code: "status", title: "状态", sort_order: 40, enabled: true },
    ],
    api_permissions: [
      {
        code: "settings:read",
        menu_code: "settings",
        title: "查看设置",
        description: "查看系统设置",
        sort_order: 10,
        enabled: true,
      },
      {
        code: "settings:provider_write",
        menu_code: "settings",
        title: "维护供应商配置",
        description: "修改 provider 档案",
        sort_order: 30,
        enabled: true,
      },
      {
        code: "status:read",
        menu_code: "status",
        title: "查看状态",
        description: "查看生成状态",
        sort_order: 10,
        enabled: true,
      },
    ],
  };
}

function rolePermissions(overrides: Partial<RbacRolePermissions> = {}): RbacRolePermissions {
  return {
    role_id: overrides.role_id ?? "role-1",
    menu_codes: overrides.menu_codes ?? [],
    api_permission_codes: overrides.api_permission_codes ?? [],
  };
}

function rbacUser(overrides: Partial<RbacUser> = {}): RbacUser {
  return {
    id: overrides.id ?? "user-1",
    username: overrides.username ?? "alice",
    display_name: overrides.display_name ?? "Alice",
    role_id: overrides.role_id ?? "role-1",
    role_name: overrides.role_name ?? "普通用户",
    is_admin: overrides.is_admin ?? false,
    enabled: overrides.enabled ?? true,
    password_pending: overrides.password_pending ?? false,
    resource_groups: overrides.resource_groups ?? [],
    archived_at: overrides.archived_at,
  };
}

describe("RbacPage permission helpers", () => {
  it("builds permission groups by menu order", () => {
    const groups = buildPermissionGroups(permissionCatalog());

    expect(groups.map((group) => group.menuCode)).toEqual(["settings", "status"]);
    expect(groups[0]?.apiPermissions.map((permission) => permission.code)).toEqual([
      "settings:read",
      "settings:provider_write",
    ]);
  });

  it("hydrates a draft from role permissions", () => {
    const draft = rolePermissionDraftFromResponse(
      rolePermissions({
        menu_codes: ["settings"],
        api_permission_codes: ["settings:read"],
      }),
    );

    expect(draft).toEqual({
      menu_codes: ["settings"],
      api_permission_codes: ["settings:read"],
    });
  });

  it("removes child api permissions when a menu permission is unchecked", () => {
    const groups = buildPermissionGroups(permissionCatalog());
    const settingsGroup = groups[0]!;
    const draft: RolePermissionDraft = {
      menu_codes: ["settings", "status"],
      api_permission_codes: ["settings:read", "settings:provider_write", "status:read"],
    };

    expect(toggleMenuPermissionDraft(draft, settingsGroup, false)).toEqual({
      menu_codes: ["status"],
      api_permission_codes: ["status:read"],
    });
  });

  it("adds only base read api permissions when a menu permission is checked", () => {
    const groups = buildPermissionGroups(permissionCatalog());
    const settingsGroup = groups[0]!;
    const draft: RolePermissionDraft = {
      menu_codes: [],
      api_permission_codes: [],
    };

    expect(toggleMenuPermissionDraft(draft, settingsGroup, true)).toEqual({
      menu_codes: ["settings"],
      api_permission_codes: ["settings:read"],
    });
  });

  it("auto-adds the parent menu when an api permission is checked", () => {
    const draft: RolePermissionDraft = {
      menu_codes: [],
      api_permission_codes: [],
    };

    expect(toggleApiPermissionDraft(draft, "settings", "settings:provider_write", true)).toEqual({
      menu_codes: ["settings"],
      api_permission_codes: ["settings:provider_write"],
    });
  });

  it("returns generation group labels for the user list column", () => {
    expect(
      rbacUserResourceGroupLabels(
        rbacUser({ resource_groups: [{ id: "group-1", key: "campaign", name: "活动分组" }] }),
        "未授权分组",
      ),
    ).toEqual(["活动分组"]);
  });

  it("returns the fallback label when a user has no generation group grants", () => {
    expect(rbacUserResourceGroupLabels(rbacUser(), "未授权分组")).toEqual(["未授权分组"]);
  });

  it("builds the rbac user list query key from current filters", () => {
    expect(rbacUserListQueryKey(2, "alice", "role-1")).toEqual(["rbac-users", 2, "alice", "role-1"]);
  });
});
