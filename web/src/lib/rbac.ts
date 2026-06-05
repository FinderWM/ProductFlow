import type { SessionState } from "./types";

export const RBAC_MANAGE_PERMISSION = "rbac:manage";

export function hasSessionMenu(session: SessionState | null, menuCode: string): boolean {
  return Boolean(session?.menus?.some((menu) => menu.code === menuCode));
}

export function hasSessionApiPermission(session: SessionState | null, permissionCode: string): boolean {
  return Boolean(session?.api_permissions?.includes(permissionCode));
}

export function hasSessionAdminApiPermission(session: SessionState | null, permissionCode: string): boolean {
  return Boolean(session?.user?.is_admin) && hasSessionApiPermission(session, permissionCode);
}

export function hasSettingsPageAccess(session: SessionState | null): boolean {
  return hasSessionMenu(session, "settings") && hasSessionApiPermission(session, "settings:read");
}

export function hasRbacManagementAccess(session: SessionState | null): boolean {
  return hasSessionAdminApiPermission(session, RBAC_MANAGE_PERMISSION);
}
