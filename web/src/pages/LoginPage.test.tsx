/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import "../test/setup";
import { api } from "../lib/api";
import { LoginPage } from "./LoginPage";

function LocationProbe() {
  const location = useLocation();
  return <div>{location.pathname}</div>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LoginPage authenticated redirect", () => {
  it("redirects an authenticated account to the permission-aware path supplied by App", async () => {
    vi.spyOn(api, "getLoginPageConfig").mockImplementation(() => new Promise(() => undefined));
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/login"]}>
          <Routes>
            <Route
              path="/login"
              element={(
                <LoginPage
                  authenticated
                  authenticatedRedirectPath="/resource-library"
                />
              )}
            />
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("/resource-library")).toBeTruthy();
  });
});

describe("Command Orbit ambient effects", () => {
  it("keeps page arcs outside the form and attaches the vertical scanner to the auth core", () => {
    vi.spyOn(api, "getLoginPageConfig").mockImplementation(() => new Promise(() => undefined));
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    const { container } = render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/login"]}>
          <LoginPage authenticated={false} authenticatedRedirectPath="/resource-library" />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const stage = container.querySelector<HTMLElement>(".stage");
    const shell = container.querySelector<HTMLElement>(".auth-shell");
    const core = shell?.querySelector<HTMLElement>(":scope > .auth-core");
    const form = core?.querySelector("form");
    const scanner = core?.querySelector(":scope > .auth-scanner") ?? null;

    expect(container.querySelector(".auth-energy-bed")).toBeNull();
    expect(stage?.querySelector(":scope > .page-electric-arcs")?.getAttribute("aria-hidden")).toBe("true");
    expect(shell?.querySelector(":scope > .shell-electric-arc")).toBeNull();
    expect(scanner?.getAttribute("aria-hidden")).toBe("true");
    expect(scanner?.querySelector("svg")).toBeNull();
    expect(form).toBeTruthy();
    expect(form?.contains(scanner)).toBe(false);
  });
});
