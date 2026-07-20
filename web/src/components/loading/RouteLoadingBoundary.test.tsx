/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../../test/setup";
import { RouteChunkLoadError } from "../../routes/pageModules";
import { RouteErrorBoundary, RouteLoadingBoundary } from "./RouteLoadingBoundary";

const schemeContext = vi.hoisted(() => ({
  activeScheme: "classic" as const,
  resolutionStatus: "resolved" as "disabled" | "resolving" | "resolved" | "fallback-error",
}));

vi.mock("../../lib/uiLayoutSchemePreference", () => ({
  useUiLayoutScheme: () => schemeContext,
}));

function ThrowError({ error }: { error: Error }): never {
  throw error;
}

const boundaryProps = {
  chunkErrorTitle: "Chunk failed",
  chunkErrorMessage: "Reload the page",
  reloadLabel: "Reload",
  renderErrorTitle: "Render failed",
  renderErrorMessage: "Try rendering again",
  retryLabel: "Retry",
};

const loadingBoundaryProps = {
  ...boundaryProps,
  loadingLabel: "Loading route",
  layoutResolvingLabel: "Resolving layout",
};

describe("RouteErrorBoundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("classifies chunk failures and uses the reload recovery path", async () => {
    const onReload = vi.fn();
    render(
      <RouteErrorBoundary resetKey="location-a" {...boundaryProps} onReload={onReload}>
        <ThrowError error={new RouteChunkLoadError("gallery", new Error("offline"))} />
      </RouteErrorBoundary>,
    );

    expect(screen.getByRole("alert").textContent).toContain("Chunk failed");
    await userEvent.setup().click(screen.getByRole("button", { name: "Reload" }));
    expect(onReload).toHaveBeenCalledOnce();
  });

  it("lets a normal render error retry in place", async () => {
    let shouldThrow = true;
    function MaybeThrow() {
      if (shouldThrow) {
        throw new Error("render bug");
      }
      return <div>Recovered page</div>;
    }

    render(
      <RouteErrorBoundary resetKey="location-a" {...boundaryProps}>
        <MaybeThrow />
      </RouteErrorBoundary>,
    );
    shouldThrow = false;
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByText("Recovered page")).toBeTruthy();
  });

  it("resets a failure when location or scheme changes", async () => {
    const { rerender } = render(
      <RouteErrorBoundary resetKey="location-a:classic" {...boundaryProps}>
        <ThrowError error={new Error("render bug")} />
      </RouteErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toBeTruthy();

    rerender(
      <RouteErrorBoundary resetKey="location-b:workspace" {...boundaryProps}>
        <div>Next route</div>
      </RouteErrorBoundary>,
    );
    expect(await screen.findByText("Next route")).toBeTruthy();
  });
});

describe("RouteLoadingBoundary", () => {
  beforeEach(() => {
    schemeContext.activeScheme = "classic";
    schemeContext.resolutionStatus = "resolved";
  });

  it("shows a stable layout-resolving shell before mounting a scheme-dependent route", () => {
    schemeContext.resolutionStatus = "resolving";
    render(
      <MemoryRouter initialEntries={["/gallery"]}>
        <RouteLoadingBoundary {...loadingBoundaryProps}>
          <div>Gallery page</div>
        </RouteLoadingBoundary>
      </MemoryRouter>,
    );

    expect(screen.getByRole("status").textContent).toContain("Resolving layout");
    expect(screen.queryByText("Gallery page")).toBeNull();
  });

  it("uses the route-profile Suspense fallback after layout resolution", () => {
    const pending = new Promise<never>(() => undefined);
    function SuspendedRoute(): never {
      throw pending;
    }

    render(
      <MemoryRouter initialEntries={["/gallery"]}>
        <RouteLoadingBoundary {...loadingBoundaryProps}>
          <SuspendedRoute />
        </RouteLoadingBoundary>
      </MemoryRouter>,
    );

    expect(screen.getByRole("status").textContent).toContain("Loading route");
  });

  it("does not gate the public login route on layout resolution", () => {
    schemeContext.resolutionStatus = "resolving";
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <RouteLoadingBoundary {...loadingBoundaryProps}>
          <div>Login page</div>
        </RouteLoadingBoundary>
      </MemoryRouter>,
    );

    expect(screen.getByText("Login page")).toBeTruthy();
    expect(screen.queryByText("Resolving layout")).toBeNull();
  });
});
