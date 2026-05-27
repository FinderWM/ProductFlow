import { lazy, Suspense, useEffect, useMemo, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { api } from "./lib/api";
import { PreferencesProvider, useI18n } from "./lib/preferences";
import { hasSessionApiPermission, hasSessionMenu } from "./lib/rbac";
import { SessionStateProvider } from "./lib/session";

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
const ProductCreatePage = lazy(() =>
  import("./pages/ProductCreatePage").then((module) => ({ default: module.ProductCreatePage })),
);
const ProductDetailPage = lazy(() =>
  import("./pages/ProductDetailPage").then((module) => ({ default: module.ProductDetailPage })),
);
const loadProductListPage = () =>
  import("./pages/ProductListPage").then((module) => ({ default: module.ProductListPage }));
const ProductListPage = lazy(loadProductListPage);
const RbacPage = lazy(() =>
  import("./pages/RbacPage").then((module) => ({ default: module.RbacPage })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage").then((module) => ({ default: module.SettingsPage })),
);
const StatusPage = lazy(() =>
  import("./pages/StatusPage").then((module) => ({ default: module.StatusPage })),
);
const UsageStatsPage = lazy(() =>
  import("./pages/UsageStatsPage").then((module) => ({ default: module.UsageStatsPage })),
);

const menuHomeRoutes: Array<{ code: string; to: string; requiredPermission?: string }> = [
  { code: "inspirations", to: "/products" },
  { code: "image_chat", to: "/image-chat" },
  { code: "gallery", to: "/gallery" },
  { code: "status", to: "/status" },
  { code: "usage_stats", to: "/usage-stats" },
  { code: "settings", to: "/settings", requiredPermission: "settings:read" },
  { code: "rbac", to: "/rbac" },
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

function AppRoutes() {
  const sessionQuery = useQuery({
    queryKey: ["session"],
    queryFn: api.getSessionState,
    retry: false,
  });

  const sessionState = sessionQuery.data ?? null;
  const authenticated = Boolean(sessionState?.authenticated);
  const hasMenuRouteAccess = (menuCode: string): boolean => {
    const route = menuHomeRoutes.find((item) => item.code === menuCode);
    if (!route) {
      return false;
    }
    if (route.requiredPermission) {
      return hasSessionMenu(sessionState, menuCode) && hasSessionApiPermission(sessionState, route.requiredPermission);
    }
    return hasSessionMenu(sessionState, menuCode);
  };
  const defaultAuthenticatedPath = menuHomeRoutes.find((route) => hasMenuRouteAccess(route.code))?.to ?? "/help";

  useEffect(() => {
    if (!authenticated) {
      return;
    }
    void loadProductListPage();
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

  return (
    <SessionStateProvider value={sessionState}>
      <Suspense fallback={<LoadingScreen />}>
        <Routes>
          <Route path="/login" element={<LoginPage authenticated={authenticated} />} />
          <Route path="/products" element={menuRoute("inspirations", <ProductListPage />)} />
          <Route path="/products/new" element={menuRoute("inspirations", <ProductCreatePage />)} />
          <Route path="/image-chat" element={menuRoute("image_chat", <ImageChatPage />)} />
          <Route path="/gallery" element={menuRoute("gallery", <GalleryPage />)} />
          <Route path="/help" element={authenticatedRoute(<HelpPage />)} />
          <Route path="/settings" element={menuRoute("settings", <SettingsPage />)} />
          <Route path="/rbac" element={menuRoute("rbac", <RbacPage />)} />
          <Route path="/status" element={menuRoute("status", <StatusPage />)} />
          <Route path="/usage-stats" element={menuRoute("usage_stats", <UsageStatsPage />)} />
          <Route
            path="/products/:productId/image-chat"
            element={menuRoute("image_chat", <ImageChatPage />)}
          />
          <Route
            path="/products/:productId"
            element={menuRoute("inspirations", <ProductDetailPage />)}
          />
          <Route path="*" element={<Navigate to={authenticated ? defaultAuthenticatedPath : "/login"} replace />} />
        </Routes>
      </Suspense>
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
        <BrowserRouter>
          <div className="min-h-screen bg-white font-sans text-zinc-900 selection:bg-zinc-200 dark:bg-[#060a12] dark:text-slate-100 dark:selection:bg-indigo-500/30">
            <AppRoutes />
          </div>
        </BrowserRouter>
      </PreferencesProvider>
    </QueryClientProvider>
  );
}
