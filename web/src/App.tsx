import { lazy, Suspense, useEffect, useMemo, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { GlobalBrandMark, TopNav } from "./components/TopNav";
import { api } from "./lib/api";
import { CurrentWeatherProvider } from "./lib/currentWeather";
import { NotificationProvider } from "./lib/notifications";
import { PreferencesProvider, useI18n } from "./lib/preferences";
import {
  API_GALLERY_READ,
  API_GLOBAL_TEMPLATES_MANAGE,
  API_IMAGE_CHAT_READ,
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
import type { SessionState } from "./lib/types";
import { UiLayoutSchemeProvider, useUiLayoutScheme } from "./lib/uiLayoutSchemePreference";

const GalleryPage = lazy(() =>
  import("./pages/GalleryPage").then((module) => ({ default: module.GalleryPage })),
);
const HelpPage = lazy(() =>
  import("./pages/HelpPage").then((module) => ({ default: module.HelpPage })),
);
const LoginPage = lazy(() =>
  import("./pages/LoginPage").then((module) => ({ default: module.LoginPage })),
);
const loadImageChatPage = () =>
  import("./pages/ImageChatPage").then((module) => ({ default: module.ImageChatPage }));
const ImageChatPage = lazy(loadImageChatPage);
const InspirationCreatePage = lazy(() =>
  import("./pages/InspirationCreatePage").then((module) => ({ default: module.InspirationCreatePage })),
);
const InspirationDetailPage = lazy(() =>
  import("./pages/InspirationDetailPage").then((module) => ({ default: module.InspirationDetailPage })),
);
const loadInspirationListPage = () =>
  import("./pages/InspirationListPage").then((module) => ({ default: module.InspirationListPage }));
const InspirationListPage = lazy(loadInspirationListPage);
const RbacPage = lazy(() =>
  import("./pages/RbacPage").then((module) => ({ default: module.RbacPage })),
);
const ResourceLibraryPage = lazy(() =>
  import("./pages/ResourceLibraryPage").then((module) => ({ default: module.ResourceLibraryPage })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage })),
);
const StatusPage = lazy(() =>
  import("./pages/StatusPage").then((module) => ({ default: module.StatusPage })),
);
const TemplateManagementPage = lazy(() =>
  import("./pages/TemplateManagementPage").then((module) => ({ default: module.TemplateManagementPage })),
);
const UsageStatsPage = lazy(() =>
  import("./pages/UsageStatsPage").then((module) => ({ default: module.UsageStatsPage })),
);
const WorkspaceHomePage = lazy(() =>
  import("./pages/workspace/WorkspaceLandingPages").then((module) => ({ default: module.WorkspaceHomePage })),
);
const WorkspaceImageChatPage = lazy(() =>
  import("./pages/workspace/WorkspaceLandingPages").then((module) => ({ default: module.WorkspaceImageChatPage })),
);
const WorkspaceGalleryPage = lazy(() =>
  import("./pages/workspace/WorkspaceLandingPages").then((module) => ({ default: module.WorkspaceGalleryPage })),
);
const WorkspaceStatusPage = lazy(() =>
  import("./pages/workspace/WorkspaceLandingPages").then((module) => ({ default: module.WorkspaceStatusPage })),
);

const menuHomeRoutes: Array<{
  code: string;
  to: string;
  requiredPermission?: string;
  hasAccess?: (sessionState: SessionState | null) => boolean;
}> = [
  { code: "inspirations", to: "/inspirations", requiredPermission: API_INSPIRATIONS_READ },
  { code: "resource_library", to: "/resource-library", hasAccess: (sessionState) => Boolean(sessionState?.authenticated) },
  { code: "image_chat", to: "/image-chat", requiredPermission: API_IMAGE_CHAT_READ },
  { code: "gallery", to: "/gallery", requiredPermission: API_GALLERY_READ },
  { code: "status", to: "/status", requiredPermission: API_STATUS_READ },
  { code: "usage_stats", to: "/usage-stats", requiredPermission: API_USAGE_STATS_READ },
  { code: "settings", to: "/settings", requiredPermission: API_SETTINGS_READ },
  { code: "rbac", to: "/rbac", hasAccess: hasRbacManagementAccess },
];

function LoadingScreen() {
  const { t } = useI18n();

  return (
    <div className="flex min-h-screen items-center justify-center bg-white text-zinc-400 dark:bg-[#060a12] dark:text-slate-400">
      <Loader2 size={24} className="animate-spin" />
      <span className="sr-only">{t("app.loading")}</span>
    </div>
  );
}

function LayoutSchemeRoute({ classic, workspace }: { classic: ReactNode; workspace: ReactNode }) {
  const { activeScheme } = useUiLayoutScheme();
  return activeScheme === "workspace" ? workspace : classic;
}

function AppRoutes() {
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
  const hasMenuRouteAccess = (menuCode: string): boolean => {
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
  };
  const defaultAuthenticatedPath = menuHomeRoutes.find((route) => hasMenuRouteAccess(route.code))?.to ?? "/help";

  useEffect(() => {
    if (!authenticated) {
      return;
    }
    void loadInspirationListPage();
    void loadImageChatPage();
  }, [authenticated]);

  if (sessionQuery.isLoading) {
    return <LoadingScreen />;
  }

  function authenticatedRoute(element: ReactNode): ReactNode {
    return authenticated ? element : <Navigate to="/login" replace />;
  }

  function menuRoute(menuCode: string, element: ReactNode): ReactNode {
    if (!authenticated) {
      return <Navigate to="/login" replace />;
    }
    if (!hasMenuRouteAccess(menuCode)) {
      return <Navigate to={defaultAuthenticatedPath} replace />;
    }
    return element;
  }

  function permissionRoute(menuCode: string, permissionCode: string, element: ReactNode): ReactNode {
    if (!authenticated) {
      return <Navigate to="/login" replace />;
    }
    if (!hasSessionMenuApiPermission(sessionState, menuCode, permissionCode)) {
      return <Navigate to={defaultAuthenticatedPath} replace />;
    }
    return element;
  }

  return (
    <SessionStateProvider value={sessionState}>
      <SessionActionsProvider value={{ logout: authenticated ? () => logoutMutation.mutate() : undefined }}>
        <UiLayoutSchemeProvider enabled={authenticated}>
          <CurrentWeatherProvider enabled={authenticated}>
            {authenticated ? <GlobalBrandMark to={defaultAuthenticatedPath} /> : null}
            <TaskNotificationBridge enabled={authenticated} />
            <Suspense fallback={<LoadingScreen />}>
              <Routes>
                <Route path="/login" element={<LoginPage authenticated={authenticated} />} />
                <Route
                  path="/inspirations"
                  element={menuRoute(
                    "inspirations",
                    <LayoutSchemeRoute classic={<InspirationListPage />} workspace={<WorkspaceHomePage />} />,
                  )}
                />
                <Route path="/inspirations/list" element={menuRoute("inspirations", <InspirationListPage mode="full" />)} />
                <Route path="/inspirations/all" element={menuRoute("inspirations", <InspirationListPage mode="full" />)} />
                <Route
                  path="/inspirations/new"
                  element={permissionRoute(
                    "inspirations",
                    API_INSPIRATIONS_WRITE,
                    <>
                      <TopNav />
                      <InspirationCreatePage />
                    </>,
                  )}
                />
                <Route path="/workflow/templates" element={menuRoute("inspirations", <TemplateManagementPage mode="personal" />)} />
                <Route
                  path="/image-chat"
                  element={menuRoute(
                    "image_chat",
                    <LayoutSchemeRoute classic={<ImageChatPage />} workspace={<WorkspaceImageChatPage />} />,
                  )}
                />
                <Route
                  path="/image-chat/workbench"
                  element={menuRoute("image_chat", <ImageChatPage mode="workbench" />)}
                />
                <Route path="/resource-library" element={menuRoute("resource_library", <ResourceLibraryPage />)} />
                <Route
                  path="/resource-library/manage"
                  element={menuRoute("resource_library", <ResourceLibraryPage mode="manage" />)}
                />
                <Route
                  path="/gallery"
                  element={menuRoute(
                    "gallery",
                    <LayoutSchemeRoute classic={<GalleryPage />} workspace={<WorkspaceGalleryPage />} />,
                  )}
                />
                <Route path="/gallery/browse" element={menuRoute("gallery", <GalleryPage mode="manage" />)} />
                <Route path="/gallery/manage" element={menuRoute("gallery", <GalleryPage mode="manage" />)} />
                <Route path="/help" element={authenticatedRoute(<HelpPage />)} />
                <Route path="/settings" element={menuRoute("settings", <SettingsPage />)} />
                <Route
                  path="/settings/global-templates"
                  element={permissionRoute("settings", API_GLOBAL_TEMPLATES_MANAGE, <TemplateManagementPage mode="global" />)}
                />
                <Route path="/rbac" element={menuRoute("rbac", <RbacPage />)} />
                <Route
                  path="/status"
                  element={menuRoute(
                    "status",
                    <LayoutSchemeRoute classic={<StatusPage />} workspace={<WorkspaceStatusPage />} />,
                  )}
                />
                <Route path="/status/detail" element={menuRoute("status", <StatusPage mode="detail" />)} />
                <Route path="/usage-stats" element={menuRoute("usage_stats", <UsageStatsPage />)} />
                <Route
                  path="/usage-stats/detail"
                  element={menuRoute("usage_stats", <UsageStatsPage mode="detail" />)}
                />
                <Route
                  path="/inspirations/:inspirationId/image-chat"
                  element={menuRoute("image_chat", <ImageChatPage />)}
                />
                <Route
                  path="/inspirations/:inspirationId"
                  element={menuRoute("inspirations", <InspirationDetailPage />)}
                />
                <Route path="*" element={<Navigate to={authenticated ? defaultAuthenticatedPath : "/login"} replace />} />
              </Routes>
            </Suspense>
          </CurrentWeatherProvider>
        </UiLayoutSchemeProvider>
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
