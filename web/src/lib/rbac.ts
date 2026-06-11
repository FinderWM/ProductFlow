import type { SessionState } from "./types";

export const API_INSPIRATIONS_READ = "inspirations:read";
export const API_INSPIRATIONS_WRITE = "inspirations:write";
export const API_INSPIRATIONS_GENERATE = "inspirations:generate";
export const API_IMAGE_CHAT_READ = "image_chat:read";
export const API_IMAGE_CHAT_WRITE = "image_chat:write";
export const API_IMAGE_CHAT_GENERATE = "image_chat:generate";
export const API_GALLERY_READ = "gallery:read";
export const API_GALLERY_WRITE = "gallery:write";
export const API_STATUS_READ = "status:read";
export const API_USAGE_STATS_READ = "usage_stats:read";
export const API_SETTINGS_READ = "settings:read";
export const API_SETTINGS_WRITE = "settings:write";
export const API_SETTINGS_PROVIDER_WRITE = "settings:provider_write";
export const API_SETTINGS_MIGRATE = "settings:migrate";
export const API_GLOBAL_TEMPLATES_MANAGE = "templates:manage_global";
export const API_RESOURCES_MODERATE = "resources:moderate";
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

export function hasSessionMenuApiPermission(
  session: SessionState | null,
  menuCode: string,
  permissionCode: string,
): boolean {
  return hasSessionMenu(session, menuCode) && hasSessionApiPermission(session, permissionCode);
}

export function hasSettingsPageAccess(session: SessionState | null): boolean {
  return hasSessionMenuApiPermission(session, "settings", API_SETTINGS_READ);
}

export function hasRbacManagementAccess(session: SessionState | null): boolean {
  return hasSessionAdminApiPermission(session, RBAC_MANAGE_PERMISSION);
}
