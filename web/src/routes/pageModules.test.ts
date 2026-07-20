import { describe, expect, it, vi } from "vitest";

import {
  PAGE_ROUTES,
  RouteChunkLoadError,
  candidatePageModuleLoaders,
  createPageModuleLoader,
  isNavigationRouteActive,
  matchPageRoute,
  matchingPageRoutes,
  pageRouteRequiresResolvedScheme,
  prefetchPageModuleLoaders,
  resolveNavigationTarget,
  resolvePageSkeletonProfile,
  resolveUnresolvedSchemeSkeletonProfile,
} from "./pageModules";

describe("page route registry", () => {
  it.each(PAGE_ROUTES.filter((route) => route.id !== "not-found"))(
    "matches $id from its representative path",
    (route) => {
      expect(matchPageRoute(route.representativePath).id).toBe(route.id);
    },
  );

  it("resolves static conflicts before parameterized routes", () => {
    expect(matchPageRoute("/inspirations/new").id).toBe("inspiration-create");
    expect(matchPageRoute("/inspirations/item-1").id).toBe("inspiration-detail");
    expect(matchPageRoute("/inspirations/item-1/image-chat").id).toBe("inspiration-image-chat");
    expect(matchPageRoute("/settings/global-templates").id).toBe("settings-global-templates");
    expect(matchPageRoute("/settings/providers").id).toBe("settings-section");
  });

  it("keeps wildcard last and selects exactly one non-wildcard winner", () => {
    for (const route of PAGE_ROUTES.filter((item) => item.id !== "not-found")) {
      const matches = matchingPageRoutes(route.representativePath);
      expect(matches[0]?.id).toBe(route.id);
      expect(matches.at(-1)?.id).toBe("not-found");
    }
    expect(PAGE_ROUTES.at(-1)?.id).toBe("not-found");
    expect(matchPageRoute("/does-not-exist").id).toBe("not-found");
  });

  it("resolves scheme-specific modules and profiles without duplicate candidates", () => {
    expect(candidatePageModuleLoaders("/inspirations")).toHaveLength(2);
    expect(candidatePageModuleLoaders("/inspirations/list")).toHaveLength(1);
    expect(resolvePageSkeletonProfile("/gallery", "classic")).toBe("grid");
    expect(resolvePageSkeletonProfile("/gallery", "workspace")).toBe("workspace-landing");
    expect(resolvePageSkeletonProfile("/login/image-lab", "classic")).toBe("auth-image-lab");
    expect(pageRouteRequiresResolvedScheme("/gallery/manage")).toBe(true);
    expect(pageRouteRequiresResolvedScheme("/login/fluid-mist")).toBe(false);
  });

  it("keeps layout-resolving skeletons aligned with scheme-independent route geometry", () => {
    expect(resolveUnresolvedSchemeSkeletonProfile("/settings/providers")).toBe("side-rail");
    expect(resolveUnresolvedSchemeSkeletonProfile("/inspirations/example")).toBe("workbench");
    expect(resolveUnresolvedSchemeSkeletonProfile("/gallery/manage")).toBe("grid");
    expect(resolveUnresolvedSchemeSkeletonProfile("/gallery")).toBe("workspace-landing");
  });

  it("owns navigation targets and selected nav metadata", () => {
    expect(resolveNavigationTarget("imageChat", "classic")).toBe("/image-chat");
    expect(resolveNavigationTarget("imageChat", "workspace")).toBe("/image-chat/workbench");
    expect(resolveNavigationTarget("templates", "workspace")).toBe("/workflow/templates");
    expect(isNavigationRouteActive("imageChat", "/inspirations/abc/image-chat", "classic")).toBe(true);
    expect(isNavigationRouteActive("inspirations", "/inspirations/abc/image-chat", "classic")).toBe(false);
    expect(isNavigationRouteActive("inspirations", "/inspirations", "workspace")).toBe(false);
  });
});

describe("createPageModuleLoader", () => {
  it("shares one in-flight promise and caches a successful module", async () => {
    let resolveImport: ((value: { default: string }) => void) | undefined;
    const importer = vi.fn(() => new Promise<{ default: string }>((resolve) => {
      resolveImport = resolve;
    }));
    const loader = createPageModuleLoader("shared", importer);

    const first = loader.load();
    const second = loader.load();
    expect(first).toBe(second);
    expect(importer).toHaveBeenCalledOnce();

    resolveImport?.({ default: "page" });
    await expect(first).resolves.toEqual({ default: "page" });
    await expect(loader.load()).resolves.toEqual({ default: "page" });
    expect(importer).toHaveBeenCalledOnce();
  });

  it("wraps import errors, clears failure cache, and allows a later retry", async () => {
    const importer = vi
      .fn<() => Promise<{ default: string }>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ default: "recovered" });
    const loader = createPageModuleLoader("retryable", importer);

    await expect(loader.load()).rejects.toMatchObject({
      name: "RouteChunkLoadError",
      routeId: "retryable",
    });
    await expect(loader.load()).resolves.toEqual({ default: "recovered" });
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it("normalizes a synchronous importer throw into a retryable promise rejection", async () => {
    const loader = createPageModuleLoader("sync-failure", () => {
      throw new Error("module evaluation failed");
    });

    await expect(loader.load()).rejects.toMatchObject({
      name: "RouteChunkLoadError",
      routeId: "sync-failure",
    });
  });

  it("consumes background prefetch rejection without changing load rejection", async () => {
    const loader = createPageModuleLoader("prefetch-failure", () => Promise.reject(new Error("offline")));
    await expect(prefetchPageModuleLoaders([loader])).resolves.toBeUndefined();
    await expect(loader.load()).rejects.toBeInstanceOf(RouteChunkLoadError);
  });
});
