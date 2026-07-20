import { matchPath } from "react-router-dom";

import type { UiLayoutScheme } from "../lib/uiLayoutScheme";
import { SETTINGS_DEFAULT_SECTION_ID, settingsPathForSection } from "../pages/settings/sections";
import type { PageSkeletonProfile } from "../components/loading/PageLoadingSkeleton";

export class RouteChunkLoadError extends Error {
  readonly routeId: string;

  constructor(routeId: string, cause: unknown) {
    super(`Failed to load route chunk: ${routeId}`, { cause });
    this.name = "RouteChunkLoadError";
    this.routeId = routeId;
  }
}

export interface PageModuleLoader<TModule> {
  readonly key: string;
  load: () => Promise<TModule>;
  prefetch: () => Promise<void>;
}

export function createPageModuleLoader<TModule>(
  key: string,
  importer: () => Promise<TModule>,
): PageModuleLoader<TModule> {
  let inFlight: Promise<TModule> | null = null;
  let resolvedModule: TModule | undefined;
  let resolved = false;

  const load = (): Promise<TModule> => {
    if (resolved) {
      return Promise.resolve(resolvedModule as TModule);
    }
    if (inFlight) {
      return inFlight;
    }

    let imported: Promise<TModule>;
    try {
      imported = importer();
    } catch (error) {
      imported = Promise.reject(error);
    }
    const request = imported.catch((error: unknown) => {
      throw error instanceof RouteChunkLoadError ? error : new RouteChunkLoadError(key, error);
    });
    inFlight = request;

    void request
      .then(
        (module) => {
          resolvedModule = module;
          resolved = true;
        },
        () => undefined,
      )
      .finally(() => {
        if (inFlight === request) {
          inFlight = null;
        }
      });

    return request;
  };

  return {
    key,
    load,
    prefetch: () => load().then(() => undefined),
  };
}

const loadWorkspaceLandingPages = () => import("../pages/workspace/WorkspaceLandingPages");

export const pageModuleLoaders = {
  gallery: createPageModuleLoader("gallery", () =>
    import("../pages/GalleryPage").then((module) => ({ default: module.GalleryPage }))),
  enhance: createPageModuleLoader("enhance", () =>
    import("../pages/EnhancePage").then((module) => ({ default: module.EnhancePage }))),
  imageToCode: createPageModuleLoader("image-to-code", () =>
    import("../pages/ImageToCodePage").then((module) => ({ default: module.ImageToCodePage }))),
  help: createPageModuleLoader("help", () =>
    import("../pages/HelpPage").then((module) => ({ default: module.HelpPage }))),
  login: createPageModuleLoader("login", () =>
    import("../pages/LoginPage").then((module) => ({ default: module.LoginPage }))),
  imageChat: createPageModuleLoader("image-chat", () =>
    import("../pages/ImageChatPage").then((module) => ({ default: module.ImageChatPage }))),
  inspirationCreate: createPageModuleLoader("inspiration-create", () =>
    import("../pages/InspirationCreatePage").then((module) => ({ default: module.InspirationCreatePage }))),
  inspirationDetail: createPageModuleLoader("inspiration-detail", () =>
    import("../pages/InspirationDetailPage").then((module) => ({ default: module.InspirationDetailPage }))),
  inspirationList: createPageModuleLoader("inspiration-list", () =>
    import("../pages/InspirationListPage").then((module) => ({ default: module.InspirationListPage }))),
  rbac: createPageModuleLoader("rbac", () =>
    import("../pages/RbacPage").then((module) => ({ default: module.RbacPage }))),
  resourceLibrary: createPageModuleLoader("resource-library", () =>
    import("../pages/ResourceLibraryPage").then((module) => ({ default: module.ResourceLibraryPage }))),
  settings: createPageModuleLoader("settings", () =>
    import("../pages/SettingsPage").then((module) => ({ default: module.SettingsPage }))),
  status: createPageModuleLoader("status", () =>
    import("../pages/StatusPage").then((module) => ({ default: module.StatusPage }))),
  templateManagement: createPageModuleLoader("template-management", () =>
    import("../pages/TemplateManagementPage").then((module) => ({ default: module.TemplateManagementPage }))),
  usageStats: createPageModuleLoader("usage-stats", () =>
    import("../pages/UsageStatsPage").then((module) => ({ default: module.UsageStatsPage }))),
  workspaceHome: createPageModuleLoader("workspace-home", () =>
    loadWorkspaceLandingPages().then((module) => ({ default: module.WorkspaceHomePage }))),
  workspaceImageChat: createPageModuleLoader("workspace-image-chat", () =>
    loadWorkspaceLandingPages().then((module) => ({ default: module.WorkspaceImageChatPage }))),
  workspaceGallery: createPageModuleLoader("workspace-gallery", () =>
    loadWorkspaceLandingPages().then((module) => ({ default: module.WorkspaceGalleryPage }))),
  workspaceStatus: createPageModuleLoader("workspace-status", () =>
    loadWorkspaceLandingPages().then((module) => ({ default: module.WorkspaceStatusPage }))),
} as const;

export const PAGE_PATHS = {
  login: "/login",
  loginCommandOrbit: "/login/command-orbit",
  loginFluidMist: "/login/fluid-mist",
  loginImageLab: "/login/image-lab",
  inspirations: "/inspirations",
  inspirationList: "/inspirations/list",
  inspirationAll: "/inspirations/all",
  inspirationCreate: "/inspirations/new",
  inspirationDetail: "/inspirations/:inspirationId",
  inspirationImageChat: "/inspirations/:inspirationId/image-chat",
  templateManagement: "/workflow/templates",
  imageChat: "/image-chat",
  imageChatWorkbench: "/image-chat/workbench",
  resourceLibrary: "/resource-library",
  resourceLibraryManage: "/resource-library/manage",
  enhance: "/enhance",
  imageToCode: "/image-to-code",
  gallery: "/gallery",
  galleryBrowse: "/gallery/browse",
  galleryManage: "/gallery/manage",
  help: "/help",
  settings: "/settings",
  settingsGlobalTemplates: "/settings/global-templates",
  settingsSection: "/settings/:sectionSlug",
  rbac: "/rbac",
  status: "/status",
  statusDetail: "/status/detail",
  usageStats: "/usage-stats",
  usageStatsDetail: "/usage-stats/detail",
  wildcard: "*",
} as const;

export type NavigationRouteId =
  | "inspirations"
  | "templates"
  | "imageChat"
  | "resourceLibrary"
  | "gallery"
  | "enhance"
  | "imageToCode"
  | "status"
  | "usageStats"
  | "settings"
  | "globalTemplates"
  | "rbac"
  | "help";

interface NavigationTargetDefinition {
  canonical: string;
  workspace?: string;
}

export const NAVIGATION_TARGETS: Readonly<Record<NavigationRouteId, NavigationTargetDefinition>> = {
  inspirations: { canonical: PAGE_PATHS.inspirations, workspace: PAGE_PATHS.inspirationList },
  templates: { canonical: PAGE_PATHS.templateManagement },
  imageChat: { canonical: PAGE_PATHS.imageChat, workspace: PAGE_PATHS.imageChatWorkbench },
  resourceLibrary: { canonical: PAGE_PATHS.resourceLibrary, workspace: PAGE_PATHS.resourceLibraryManage },
  gallery: { canonical: PAGE_PATHS.gallery, workspace: PAGE_PATHS.galleryManage },
  enhance: { canonical: PAGE_PATHS.enhance },
  imageToCode: { canonical: PAGE_PATHS.imageToCode },
  status: { canonical: PAGE_PATHS.status, workspace: PAGE_PATHS.statusDetail },
  usageStats: { canonical: PAGE_PATHS.usageStats, workspace: PAGE_PATHS.usageStatsDetail },
  settings: { canonical: settingsPathForSection(SETTINGS_DEFAULT_SECTION_ID) },
  globalTemplates: { canonical: PAGE_PATHS.settingsGlobalTemplates },
  rbac: { canonical: PAGE_PATHS.rbac },
  help: { canonical: PAGE_PATHS.help },
};

export interface PageRouteDefinition {
  id: string;
  pattern: string;
  representativePath: string;
  matchPriority: number;
  modules: Readonly<Record<UiLayoutScheme, PageModuleLoader<unknown>>>;
  profiles: Readonly<Record<UiLayoutScheme, PageSkeletonProfile>>;
  navItemId: NavigationRouteId | null;
  suppressWorkspaceNavSelection?: boolean;
}

function sameModule(
  loader: PageModuleLoader<unknown>,
  profile: PageSkeletonProfile,
): Pick<PageRouteDefinition, "modules" | "profiles"> {
  return {
    modules: { classic: loader, workspace: loader },
    profiles: { classic: profile, workspace: profile },
  };
}

const PAGE_ROUTE_DEFINITIONS = [
  {
    id: "login-command-orbit",
    pattern: PAGE_PATHS.loginCommandOrbit,
    representativePath: PAGE_PATHS.loginCommandOrbit,
    matchPriority: 430,
    ...sameModule(pageModuleLoaders.login, "auth-command-orbit"),
    navItemId: null,
  },
  {
    id: "login-fluid-mist",
    pattern: PAGE_PATHS.loginFluidMist,
    representativePath: PAGE_PATHS.loginFluidMist,
    matchPriority: 430,
    ...sameModule(pageModuleLoaders.login, "auth-fluid-mist"),
    navItemId: null,
  },
  {
    id: "login-image-lab",
    pattern: PAGE_PATHS.loginImageLab,
    representativePath: PAGE_PATHS.loginImageLab,
    matchPriority: 430,
    ...sameModule(pageModuleLoaders.login, "auth-image-lab"),
    navItemId: null,
  },
  {
    id: "login",
    pattern: PAGE_PATHS.login,
    representativePath: PAGE_PATHS.login,
    matchPriority: 420,
    ...sameModule(pageModuleLoaders.login, "auth"),
    navItemId: null,
  },
  {
    id: "inspiration-image-chat",
    pattern: PAGE_PATHS.inspirationImageChat,
    representativePath: "/inspirations/example/image-chat",
    matchPriority: 390,
    ...sameModule(pageModuleLoaders.imageChat, "workbench"),
    navItemId: "imageChat",
  },
  {
    id: "inspiration-create",
    pattern: PAGE_PATHS.inspirationCreate,
    representativePath: PAGE_PATHS.inspirationCreate,
    matchPriority: 440,
    ...sameModule(pageModuleLoaders.inspirationCreate, "workbench"),
    navItemId: "inspirations",
  },
  {
    id: "inspiration-list",
    pattern: PAGE_PATHS.inspirationList,
    representativePath: PAGE_PATHS.inspirationList,
    matchPriority: 440,
    ...sameModule(pageModuleLoaders.inspirationList, "list"),
    navItemId: "inspirations",
  },
  {
    id: "inspiration-all",
    pattern: PAGE_PATHS.inspirationAll,
    representativePath: PAGE_PATHS.inspirationAll,
    matchPriority: 440,
    ...sameModule(pageModuleLoaders.inspirationList, "list"),
    navItemId: "inspirations",
  },
  {
    id: "inspirations",
    pattern: PAGE_PATHS.inspirations,
    representativePath: PAGE_PATHS.inspirations,
    matchPriority: 420,
    modules: { classic: pageModuleLoaders.inspirationList, workspace: pageModuleLoaders.workspaceHome },
    profiles: { classic: "list", workspace: "workspace-landing" },
    navItemId: "inspirations",
    suppressWorkspaceNavSelection: true,
  },
  {
    id: "template-management",
    pattern: PAGE_PATHS.templateManagement,
    representativePath: PAGE_PATHS.templateManagement,
    matchPriority: 430,
    ...sameModule(pageModuleLoaders.templateManagement, "side-rail"),
    navItemId: "templates",
  },
  {
    id: "image-chat-workbench",
    pattern: PAGE_PATHS.imageChatWorkbench,
    representativePath: PAGE_PATHS.imageChatWorkbench,
    matchPriority: 430,
    ...sameModule(pageModuleLoaders.imageChat, "workbench"),
    navItemId: "imageChat",
  },
  {
    id: "image-chat",
    pattern: PAGE_PATHS.imageChat,
    representativePath: PAGE_PATHS.imageChat,
    matchPriority: 420,
    modules: { classic: pageModuleLoaders.imageChat, workspace: pageModuleLoaders.workspaceImageChat },
    profiles: { classic: "workbench", workspace: "workspace-landing" },
    navItemId: "imageChat",
  },
  {
    id: "resource-library-manage",
    pattern: PAGE_PATHS.resourceLibraryManage,
    representativePath: PAGE_PATHS.resourceLibraryManage,
    matchPriority: 430,
    ...sameModule(pageModuleLoaders.resourceLibrary, "side-rail"),
    navItemId: "resourceLibrary",
  },
  {
    id: "resource-library",
    pattern: PAGE_PATHS.resourceLibrary,
    representativePath: PAGE_PATHS.resourceLibrary,
    matchPriority: 420,
    ...sameModule(pageModuleLoaders.resourceLibrary, "side-rail"),
    navItemId: "resourceLibrary",
  },
  {
    id: "enhance",
    pattern: PAGE_PATHS.enhance,
    representativePath: PAGE_PATHS.enhance,
    matchPriority: 420,
    ...sameModule(pageModuleLoaders.enhance, "workbench"),
    navItemId: "enhance",
  },
  {
    id: "image-to-code",
    pattern: PAGE_PATHS.imageToCode,
    representativePath: PAGE_PATHS.imageToCode,
    matchPriority: 420,
    ...sameModule(pageModuleLoaders.imageToCode, "workbench"),
    navItemId: "imageToCode",
  },
  {
    id: "gallery-browse",
    pattern: PAGE_PATHS.galleryBrowse,
    representativePath: PAGE_PATHS.galleryBrowse,
    matchPriority: 430,
    ...sameModule(pageModuleLoaders.gallery, "grid"),
    navItemId: "gallery",
  },
  {
    id: "gallery-manage",
    pattern: PAGE_PATHS.galleryManage,
    representativePath: PAGE_PATHS.galleryManage,
    matchPriority: 430,
    ...sameModule(pageModuleLoaders.gallery, "grid"),
    navItemId: "gallery",
  },
  {
    id: "gallery",
    pattern: PAGE_PATHS.gallery,
    representativePath: PAGE_PATHS.gallery,
    matchPriority: 420,
    modules: { classic: pageModuleLoaders.gallery, workspace: pageModuleLoaders.workspaceGallery },
    profiles: { classic: "grid", workspace: "workspace-landing" },
    navItemId: "gallery",
  },
  {
    id: "help",
    pattern: PAGE_PATHS.help,
    representativePath: PAGE_PATHS.help,
    matchPriority: 420,
    ...sameModule(pageModuleLoaders.help, "standard"),
    navItemId: "help",
  },
  {
    id: "settings-global-templates",
    pattern: PAGE_PATHS.settingsGlobalTemplates,
    representativePath: PAGE_PATHS.settingsGlobalTemplates,
    matchPriority: 440,
    ...sameModule(pageModuleLoaders.templateManagement, "side-rail"),
    navItemId: "globalTemplates",
  },
  {
    id: "settings-section",
    pattern: PAGE_PATHS.settingsSection,
    representativePath: settingsPathForSection(SETTINGS_DEFAULT_SECTION_ID),
    matchPriority: 330,
    ...sameModule(pageModuleLoaders.settings, "side-rail"),
    navItemId: "settings",
  },
  {
    id: "settings",
    pattern: PAGE_PATHS.settings,
    representativePath: PAGE_PATHS.settings,
    matchPriority: 420,
    ...sameModule(pageModuleLoaders.settings, "side-rail"),
    navItemId: "settings",
  },
  {
    id: "rbac",
    pattern: PAGE_PATHS.rbac,
    representativePath: PAGE_PATHS.rbac,
    matchPriority: 420,
    ...sameModule(pageModuleLoaders.rbac, "side-rail"),
    navItemId: "rbac",
  },
  {
    id: "status-detail",
    pattern: PAGE_PATHS.statusDetail,
    representativePath: PAGE_PATHS.statusDetail,
    matchPriority: 430,
    ...sameModule(pageModuleLoaders.status, "analytics"),
    navItemId: "status",
  },
  {
    id: "status",
    pattern: PAGE_PATHS.status,
    representativePath: PAGE_PATHS.status,
    matchPriority: 420,
    modules: { classic: pageModuleLoaders.status, workspace: pageModuleLoaders.workspaceStatus },
    profiles: { classic: "analytics", workspace: "workspace-landing" },
    navItemId: "status",
  },
  {
    id: "usage-stats-detail",
    pattern: PAGE_PATHS.usageStatsDetail,
    representativePath: PAGE_PATHS.usageStatsDetail,
    matchPriority: 430,
    ...sameModule(pageModuleLoaders.usageStats, "analytics"),
    navItemId: "usageStats",
  },
  {
    id: "usage-stats",
    pattern: PAGE_PATHS.usageStats,
    representativePath: PAGE_PATHS.usageStats,
    matchPriority: 420,
    ...sameModule(pageModuleLoaders.usageStats, "analytics"),
    navItemId: "usageStats",
  },
  {
    id: "inspiration-detail",
    pattern: PAGE_PATHS.inspirationDetail,
    representativePath: "/inspirations/example",
    matchPriority: 320,
    ...sameModule(pageModuleLoaders.inspirationDetail, "workbench"),
    navItemId: "inspirations",
  },
  {
    id: "not-found",
    pattern: PAGE_PATHS.wildcard,
    representativePath: "/not-found",
    matchPriority: 0,
    ...sameModule(pageModuleLoaders.help, "standard"),
    navItemId: null,
  },
] satisfies PageRouteDefinition[];

export const PAGE_ROUTES: readonly PageRouteDefinition[] = [...PAGE_ROUTE_DEFINITIONS]
  .sort((left, right) => right.matchPriority - left.matchPriority);

export function matchingPageRoutes(pathname: string): PageRouteDefinition[] {
  return PAGE_ROUTES.filter((route) => matchPath({ path: route.pattern, end: true }, pathname));
}

export function matchPageRoute(pathname: string): PageRouteDefinition {
  return matchingPageRoutes(pathname)[0] ?? PAGE_ROUTES[PAGE_ROUTES.length - 1];
}

export function resolvePageModule(pathname: string, scheme: UiLayoutScheme): PageModuleLoader<unknown> {
  return matchPageRoute(pathname).modules[scheme];
}

export function resolvePageSkeletonProfile(pathname: string, scheme: UiLayoutScheme): PageSkeletonProfile {
  return matchPageRoute(pathname).profiles[scheme];
}

export function resolveUnresolvedSchemeSkeletonProfile(pathname: string): PageSkeletonProfile {
  const route = matchPageRoute(pathname);
  return route.profiles.classic === route.profiles.workspace
    ? route.profiles.classic
    : "workspace-landing";
}

export function pageRouteRequiresResolvedScheme(pathname: string): boolean {
  const route = matchPageRoute(pathname);
  return !route.id.startsWith("login") && route.id !== "not-found";
}

export function candidatePageModuleLoaders(
  pathname: string,
  scheme?: UiLayoutScheme,
): PageModuleLoader<unknown>[] {
  const route = matchPageRoute(pathname);
  const candidates = scheme ? [route.modules[scheme]] : [route.modules.classic, route.modules.workspace];
  return [...new Map(candidates.map((loader) => [loader.key, loader])).values()];
}

export async function prefetchPageModuleLoaders(loaders: readonly PageModuleLoader<unknown>[]): Promise<void> {
  await Promise.all(loaders.map((loader) => loader.prefetch().catch(() => undefined)));
}

export function prefetchPageModulesForPathname(pathname: string, scheme?: UiLayoutScheme): Promise<void> {
  return prefetchPageModuleLoaders(candidatePageModuleLoaders(pathname, scheme));
}

export function resolveNavigationTarget(routeId: NavigationRouteId, scheme: UiLayoutScheme): string {
  const target = NAVIGATION_TARGETS[routeId];
  return scheme === "workspace" ? target.workspace ?? target.canonical : target.canonical;
}

export function isNavigationRouteActive(
  routeId: NavigationRouteId,
  pathname: string,
  scheme: UiLayoutScheme,
): boolean {
  const route = matchPageRoute(pathname);
  if (scheme === "workspace" && route.suppressWorkspaceNavSelection) {
    return false;
  }
  return route.navItemId === routeId;
}

export function prefetchNavigationRoute(routeId: NavigationRouteId, scheme: UiLayoutScheme): Promise<void> {
  return prefetchPageModulesForPathname(resolveNavigationTarget(routeId, scheme), scheme);
}
