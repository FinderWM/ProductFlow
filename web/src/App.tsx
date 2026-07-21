import { lazy, useEffect, useMemo, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";

import { GlobalBrandMark } from "./components/TopNav";
import { AppBootstrapError, AppBootstrapSkeleton } from "./components/loading/PageLoadingSkeleton";
import { RouteLoadingBoundary } from "./components/loading/RouteLoadingBoundary";
import { api } from "./lib/api";
import { CurrentWeatherProvider } from "./lib/currentWeather";
import { NotificationProvider } from "./lib/notifications";
import { PreferencesProvider, useI18n } from "./lib/preferences";
import {
  API_ENHANCE_READ,
  API_GALLERY_READ,
  API_GLOBAL_TEMPLATES_MANAGE,
  API_IMAGE_CHAT_READ,
  API_IMAGE_TO_CODE_READ,
  API_INSPIRATIONS_READ,
  API_INSPIRATIONS_WRITE,
  API_SETTINGS_READ,
  API_STATUS_READ,
  API_USAGE_STATS_READ,
  hasRbacManagementAccess,
  hasSessionMenuApiPermission,
} from "./lib/rbac";
import { SessionStateProvider } from "./lib/session";
import { SessionActionsProvider } from "./lib/sessionActions";
import { TaskNotificationBridge } from "./lib/taskNotifications";
import { TopNavStateProvider } from "./lib/topNavState";
import type { SessionState } from "./lib/types";
import type { UiLayoutScheme } from "./lib/uiLayoutScheme";
import {
  UiLayoutSchemeProvider,
  useUiLayoutScheme,
  type UiLayoutSchemeResolutionStatus,
} from "./lib/uiLayoutSchemePreference";
import {
  PAGE_PATHS,
  pageModuleLoaders,
  prefetchPageModulesForPathname,
  resolveNavigationTarget,
} from "./routes/pageModules";

const GalleryPage = lazy(pageModuleLoaders.gallery.load);
const EnhancePage = lazy(pageModuleLoaders.enhance.load);
const ImageToCodePage = lazy(pageModuleLoaders.imageToCode.load);
const HelpPage = lazy(pageModuleLoaders.help.load);
const LoginPage = lazy(pageModuleLoaders.login.load);
const ImageChatPage = lazy(pageModuleLoaders.imageChat.load);
const InspirationCreatePage = lazy(pageModuleLoaders.inspirationCreate.load);
const InspirationDetailPage = lazy(pageModuleLoaders.inspirationDetail.load);
const InspirationListPage = lazy(pageModuleLoaders.inspirationList.load);
const RbacPage = lazy(pageModuleLoaders.rbac.load);
const ResourceLibraryPage = lazy(pageModuleLoaders.resourceLibrary.load);
const SettingsPage = lazy(pageModuleLoaders.settings.load);
const StatusPage = lazy(pageModuleLoaders.status.load);
const TemplateManagementPage = lazy(pageModuleLoaders.templateManagement.load);
const UsageStatsPage = lazy(pageModuleLoaders.usageStats.load);
const WorkspaceHomePage = lazy(pageModuleLoaders.workspaceHome.load);
const WorkspaceImageChatPage = lazy(pageModuleLoaders.workspaceImageChat.load);
const WorkspaceGalleryPage = lazy(pageModuleLoaders.workspaceGallery.load);
const WorkspaceStatusPage = lazy(pageModuleLoaders.workspaceStatus.load);

if (typeof window !== "undefined") {
  void prefetchPageModulesForPathname(window.location.pathname);
}

const menuHomeRoutes: Array<{
  code: string;
  to: string;
  requiredPermission?: string;
  hasAccess?: (sessionState: SessionState | null) => boolean;
}> = [
  { code: "inspirations", to: resolveNavigationTarget("inspirations", "classic"), requiredPermission: API_INSPIRATIONS_READ },
  { code: "resource_library", to: resolveNavigationTarget("resourceLibrary", "classic"), hasAccess: (sessionState) => Boolean(sessionState?.authenticated) },
  { code: "enhance", to: resolveNavigationTarget("enhance", "classic"), requiredPermission: API_ENHANCE_READ },
  { code: "image_to_code", to: resolveNavigationTarget("imageToCode", "classic"), requiredPermission: API_IMAGE_TO_CODE_READ },
  { code: "image_chat", to: resolveNavigationTarget("imageChat", "classic"), requiredPermission: API_IMAGE_CHAT_READ },
  { code: "gallery", to: resolveNavigationTarget("gallery", "classic"), requiredPermission: API_GALLERY_READ },
  { code: "status", to: resolveNavigationTarget("status", "classic"), requiredPermission: API_STATUS_READ },
  { code: "usage_stats", to: resolveNavigationTarget("usageStats", "classic"), requiredPermission: API_USAGE_STATS_READ },
  { code: "settings", to: resolveNavigationTarget("settings", "classic"), requiredPermission: API_SETTINGS_READ },
  { code: "rbac", to: resolveNavigationTarget("rbac", "classic"), hasAccess: hasRbacManagementAccess },
];

function hasMenuRouteAccessForSession(sessionState: SessionState | null, menuCode: string): boolean {
  const route = menuHomeRoutes.find((item) => item.code === menuCode);
  if (!route) {
    return false;
  }
  if (route.hasAccess) {
    return route.hasAccess(sessionState);
  }
  if (route.requiredPermission) {
    return hasSessionMenuApiPermission(sessionState, menuCode, route.requiredPermission);
  }
  return false;
}

export function resolveDefaultAuthenticatedPath(sessionState: SessionState | null): string {
  return menuHomeRoutes.find((route) => hasMenuRouteAccessForSession(sessionState, route.code))?.to ?? PAGE_PATHS.help;
}

interface AppPageModulePrefetchTarget {
  pathname: string;
  scheme: UiLayoutScheme;
}

export function resolveAppPageModulePrefetchTarget({
  authenticated,
  pathname,
  defaultAuthenticatedPath,
  activeScheme,
  resolutionStatus,
}: {
  authenticated: boolean;
  pathname: string;
  defaultAuthenticatedPath: string;
  activeScheme: UiLayoutScheme;
  resolutionStatus: UiLayoutSchemeResolutionStatus;
}): AppPageModulePrefetchTarget | null {
  if (authenticated && resolutionStatus === "resolving") {
    return null;
  }
  return {
    pathname: authenticated
      ? pathname.startsWith(PAGE_PATHS.login)
        ? defaultAuthenticatedPath
        : pathname
      : PAGE_PATHS.login,
    scheme: authenticated ? activeScheme : "classic",
  };
}

function PageModulePrefetchCoordinator({
  authenticated,
  defaultAuthenticatedPath,
}: {
  authenticated: boolean;
  defaultAuthenticatedPath: string;
}) {
  const location = useLocation();
  const { activeScheme, resolutionStatus } = useUiLayoutScheme();

  useEffect(() => {
    const target = resolveAppPageModulePrefetchTarget({
      authenticated,
      pathname: location.pathname,
      defaultAuthenticatedPath,
      activeScheme,
      resolutionStatus,
    });
    if (target) {
      void prefetchPageModulesForPathname(target.pathname, target.scheme);
    }
  }, [activeScheme, authenticated, defaultAuthenticatedPath, location.pathname, resolutionStatus]);

  return null;
}

function LayoutSchemeRoute({ classic, workspace }: { classic: ReactNode; workspace: ReactNode }) {
  const { activeScheme } = useUiLayoutScheme();
  return activeScheme === "workspace" ? workspace : classic;
}

function LayoutFallbackNotice() {
  const { t } = useI18n();
  const { resolutionStatus, retryDefaultScheme, isLoadingDefaultScheme } = useUiLayoutScheme();

  if (resolutionStatus !== "fallback-error") {
    return null;
  }

  return (
    <div
      className="relative z-[80] flex flex-wrap items-center justify-center gap-2 border-b border-amber-300/60 bg-amber-50 px-4 py-2 text-xs text-amber-950 dark:border-amber-300/25 dark:bg-amber-400/10 dark:text-amber-100"
      role="status"
    >
      <span className="font-semibold">{t("app.layoutFallback.title")}</span>
      <span>{t("app.layoutFallback.message")}</span>
      <button
        type="button"
        className="rounded-md border border-current px-2 py-1 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current disabled:cursor-not-allowed disabled:opacity-60"
        disabled={isLoadingDefaultScheme}
        onClick={retryDefaultScheme}
      >
        {isLoadingDefaultScheme ? t("app.loading") : t("common.retry")}
      </button>
    </div>
  );
}

function AppRoutes() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({
    queryKey: ["session"],
    queryFn: api.getSessionState,
    retry: false,
  });
  const logoutMutation = useMutation({
    mutationFn: api.destroySession,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    },
  });

  const sessionState = sessionQuery.data ?? null;
  const authenticated = Boolean(sessionState?.authenticated);
  const defaultAuthenticatedPath = resolveDefaultAuthenticatedPath(sessionState);

  if (sessionQuery.isPending && sessionQuery.data === undefined) {
    return <AppBootstrapSkeleton label={t("app.loading")} />;
  }

  if (sessionQuery.isError && sessionQuery.data === undefined) {
    return (
      <AppBootstrapError
        title={t("app.sessionLoadFailed.title")}
        message={t("app.sessionLoadFailed.message")}
        retryLabel={t("common.retry")}
        retryingLabel={t("app.loading")}
        retrying={sessionQuery.isFetching}
        onRetry={() => {
          void sessionQuery.refetch();
        }}
      />
    );
  }

  function authenticatedRoute(element: ReactNode): ReactNode {
    return authenticated ? element : <Navigate to={PAGE_PATHS.login} replace />;
  }

  function menuRoute(menuCode: string, element: ReactNode): ReactNode {
    if (!authenticated) {
      return <Navigate to={PAGE_PATHS.login} replace />;
    }
    if (!hasMenuRouteAccessForSession(sessionState, menuCode)) {
      return <Navigate to={defaultAuthenticatedPath} replace />;
    }
    return element;
  }

  function permissionRoute(menuCode: string, permissionCode: string, element: ReactNode): ReactNode {
    if (!authenticated) {
      return <Navigate to={PAGE_PATHS.login} replace />;
    }
    if (!hasSessionMenuApiPermission(sessionState, menuCode, permissionCode)) {
      return <Navigate to={defaultAuthenticatedPath} replace />;
    }
    return element;
  }

  return (
    <SessionStateProvider value={sessionState}>
      <SessionActionsProvider value={{ logout: authenticated ? () => logoutMutation.mutate() : undefined }}>
        <TopNavStateProvider enabled={authenticated}>
          <UiLayoutSchemeProvider enabled={authenticated}>
            <CurrentWeatherProvider enabled={authenticated}>
              <PageModulePrefetchCoordinator
                authenticated={authenticated}
                defaultAuthenticatedPath={defaultAuthenticatedPath}
              />
              <LayoutFallbackNotice />
              {authenticated ? <GlobalBrandMark to={defaultAuthenticatedPath} /> : null}
              <TaskNotificationBridge enabled={authenticated} />
              <RouteLoadingBoundary
                loadingLabel={t("app.loading")}
                layoutResolvingLabel={t("app.layoutResolving")}
                chunkErrorTitle={t("app.routeChunkLoadFailed.title")}
                chunkErrorMessage={t("app.routeChunkLoadFailed.message")}
                reloadLabel={t("common.reload")}
                renderErrorTitle={t("app.routeRenderFailed.title")}
                renderErrorMessage={t("app.routeRenderFailed.message")}
                retryLabel={t("common.retry")}
              >
                <Routes>
                  <Route
                    path={PAGE_PATHS.login}
                    element={(
                      <LoginPage
                        authenticated={authenticated}
                        authenticatedRedirectPath={defaultAuthenticatedPath}
                      />
                    )}
                  />
                  <Route
                    path={PAGE_PATHS.loginCommandOrbit}
                    element={(
                      <LoginPage
                        authenticated={authenticated}
                        authenticatedRedirectPath={defaultAuthenticatedPath}
                        templateId="command-orbit"
                      />
                    )}
                  />
                  <Route
                    path={PAGE_PATHS.loginFluidMist}
                    element={(
                      <LoginPage
                        authenticated={authenticated}
                        authenticatedRedirectPath={defaultAuthenticatedPath}
                        templateId="fluid-mist"
                      />
                    )}
                  />
                  <Route
                    path={PAGE_PATHS.loginImageLab}
                    element={(
                      <LoginPage
                        authenticated={authenticated}
                        authenticatedRedirectPath={defaultAuthenticatedPath}
                        templateId="image-lab"
                      />
                    )}
                  />
                  <Route
                    path={PAGE_PATHS.inspirations}
                    element={menuRoute(
                      "inspirations",
                      <LayoutSchemeRoute classic={<InspirationListPage />} workspace={<WorkspaceHomePage />} />,
                    )}
                  />
                  <Route path={PAGE_PATHS.inspirationList} element={menuRoute("inspirations", <InspirationListPage mode="full" />)} />
                  <Route path={PAGE_PATHS.inspirationAll} element={menuRoute("inspirations", <InspirationListPage mode="full" />)} />
                  <Route
                    path={PAGE_PATHS.inspirationCreate}
                    element={permissionRoute(
                      "inspirations",
                      API_INSPIRATIONS_WRITE,
                      <InspirationCreatePage />,
                    )}
                  />
                <Route path={PAGE_PATHS.templateManagement} element={menuRoute("inspirations", <TemplateManagementPage mode="personal" />)} />
                <Route
                  path={PAGE_PATHS.imageChat}
                  element={menuRoute(
                    "image_chat",
                    <LayoutSchemeRoute classic={<ImageChatPage />} workspace={<WorkspaceImageChatPage />} />,
                  )}
                />
                <Route
                  path={PAGE_PATHS.imageChatWorkbench}
                  element={menuRoute("image_chat", <ImageChatPage mode="workbench" />)}
                />
                <Route path={PAGE_PATHS.resourceLibrary} element={menuRoute("resource_library", <ResourceLibraryPage />)} />
                <Route
                  path={PAGE_PATHS.resourceLibraryManage}
                  element={menuRoute("resource_library", <ResourceLibraryPage mode="manage" />)}
                />
                <Route path={PAGE_PATHS.enhance} element={menuRoute("enhance", <EnhancePage />)} />
                <Route path={PAGE_PATHS.imageToCode} element={menuRoute("image_to_code", <ImageToCodePage />)} />
                <Route
                  path={PAGE_PATHS.gallery}
                  element={menuRoute(
                    "gallery",
                    <LayoutSchemeRoute classic={<GalleryPage />} workspace={<WorkspaceGalleryPage />} />,
                  )}
                />
                <Route path={PAGE_PATHS.galleryBrowse} element={menuRoute("gallery", <GalleryPage mode="manage" />)} />
                <Route path={PAGE_PATHS.galleryManage} element={menuRoute("gallery", <GalleryPage mode="manage" />)} />
                <Route path={PAGE_PATHS.help} element={authenticatedRoute(<HelpPage />)} />
                <Route
                  path={PAGE_PATHS.settings}
                  element={menuRoute(
                    "settings",
                    <Navigate to={resolveNavigationTarget("settings", "classic")} replace />,
                  )}
                />
                <Route
                  path={PAGE_PATHS.settingsGlobalTemplates}
                  element={permissionRoute("settings", API_GLOBAL_TEMPLATES_MANAGE, <TemplateManagementPage mode="global" />)}
                />
                <Route path={PAGE_PATHS.settingsSection} element={menuRoute("settings", <SettingsPage />)} />
                <Route path={PAGE_PATHS.rbac} element={menuRoute("rbac", <RbacPage />)} />
                <Route
                  path={PAGE_PATHS.status}
                  element={menuRoute(
                    "status",
                    <LayoutSchemeRoute classic={<StatusPage />} workspace={<WorkspaceStatusPage />} />,
                  )}
                />
                <Route path={PAGE_PATHS.statusDetail} element={menuRoute("status", <StatusPage mode="detail" />)} />
                <Route path={PAGE_PATHS.usageStats} element={menuRoute("usage_stats", <UsageStatsPage />)} />
                <Route
                  path={PAGE_PATHS.usageStatsDetail}
                  element={menuRoute("usage_stats", <UsageStatsPage mode="detail" />)}
                />
                <Route
                  path={PAGE_PATHS.inspirationImageChat}
                  element={menuRoute("image_chat", <ImageChatPage />)}
                />
                <Route
                  path={PAGE_PATHS.inspirationDetail}
                  element={menuRoute("inspirations", <InspirationDetailPage />)}
                />
                <Route path={PAGE_PATHS.wildcard} element={<Navigate to={authenticated ? defaultAuthenticatedPath : PAGE_PATHS.login} replace />} />
                </Routes>
              </RouteLoadingBoundary>
            </CurrentWeatherProvider>
          </UiLayoutSchemeProvider>
        </TopNavStateProvider>
      </SessionActionsProvider>
    </SessionStateProvider>
  );
}

export function App() {
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
          },
        },
      }),
    [],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <PreferencesProvider>
        <NotificationProvider>
          <BrowserRouter>
            <div className="pf-root-shell min-h-screen bg-white font-sans text-zinc-900 selection:bg-zinc-200 dark:bg-[#060a12] dark:text-slate-100 dark:selection:bg-indigo-500/30">
              <AppRoutes />
            </div>
          </BrowserRouter>
        </NotificationProvider>
      </PreferencesProvider>
    </QueryClientProvider>
  );
}
