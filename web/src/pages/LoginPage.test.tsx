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
