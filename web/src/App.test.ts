import { describe, expect, it } from "vitest";

import { API_INSPIRATIONS_READ } from "./lib/rbac";
import type { SessionState } from "./lib/types";
import { resolveAppPageModulePrefetchTarget, resolveDefaultAuthenticatedPath } from "./App";

const authenticatedSession: SessionState = {
  authenticated: true,
  access_required: true,
  user: {
    id: "user-1",
    username: "alice",
    display_name: "Alice",
    role_id: "role-1",
    is_admin: false,
    enabled: true,
    password_pending: false,
  },
  menus: [],
  api_permissions: [],
};

describe("App authenticated routing", () => {
  it("uses the first route the authenticated account can actually access", () => {
    expect(resolveDefaultAuthenticatedPath(authenticatedSession)).toBe("/resource-library");
    expect(resolveDefaultAuthenticatedPath({
      ...authenticatedSession,
      menus: [{ code: "inspirations", title: "灵感", sort_order: 10 }],
      api_permissions: [API_INSPIRATIONS_READ],
    })).toBe("/inspirations");
  });

  it("waits for authenticated layout resolution before choosing one page module", () => {
    expect(resolveAppPageModulePrefetchTarget({
      authenticated: true,
      pathname: "/login",
      defaultAuthenticatedPath: "/resource-library",
      activeScheme: "classic",
      resolutionStatus: "resolving",
    })).toBeNull();

    expect(resolveAppPageModulePrefetchTarget({
      authenticated: true,
      pathname: "/login",
      defaultAuthenticatedPath: "/resource-library",
      activeScheme: "workspace",
      resolutionStatus: "resolved",
    })).toEqual({ pathname: "/resource-library", scheme: "workspace" });
  });

  it("uses the classic login module while unauthenticated and the fallback scheme after a preference error", () => {
    expect(resolveAppPageModulePrefetchTarget({
      authenticated: false,
      pathname: "/gallery",
      defaultAuthenticatedPath: "/help",
      activeScheme: "workspace",
      resolutionStatus: "disabled",
    })).toEqual({ pathname: "/login", scheme: "classic" });

    expect(resolveAppPageModulePrefetchTarget({
      authenticated: true,
      pathname: "/gallery",
      defaultAuthenticatedPath: "/resource-library",
      activeScheme: "classic",
      resolutionStatus: "fallback-error",
    })).toEqual({ pathname: "/gallery", scheme: "classic" });
  });
});
