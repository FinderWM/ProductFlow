/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import "../../test/setup";
import type { AsyncViewState } from "../../lib/asyncViewState";
import { AsyncContent, AsyncErrorState, AsyncPausedState } from "./AsyncContent";

const loadingState: AsyncViewState = {
  participation: "active",
  content: "none",
  fetch: "fetching",
  error: "none",
};

function renderContent(state: AsyncViewState, refreshIntent: "silent-poll" | "user-refresh" = "user-refresh") {
  return render(
    <AsyncContent
      state={state}
      refreshIntent={refreshIntent}
      loadingLabel="Loading region"
      skeleton={<div data-testid="skeleton">Skeleton</div>}
      initialError={<div>Initial error</div>}
      paused={<div>Paused</div>}
      empty={<div>Empty</div>}
      refreshFeedback={<div data-testid="refresh">Refreshing</div>}
    >
      <div>Ready</div>
    </AsyncContent>,
  );
}

describe("AsyncContent", () => {
  it("announces one initial loading status and hides skeleton geometry", () => {
    renderContent(loadingState);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("Loading region")).toBeTruthy();
    expect(screen.getByTestId("skeleton").parentElement?.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps cached content quiet during silent polling", () => {
    renderContent({ ...loadingState, content: "ready" }, "silent-poll");
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByTestId("refresh")).toBeNull();
    expect(screen.getByText("Ready").parentElement?.getAttribute("aria-busy")).toBeNull();
  });

  it("keeps cached content mounted and surfaces a silent-poll refresh failure", () => {
    renderContent({ ...loadingState, content: "ready", fetch: "idle", error: "refresh" }, "silent-poll");
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByTestId("refresh")).toBeTruthy();
    expect(screen.getByText("Ready").parentElement?.getAttribute("aria-busy")).toBeNull();
  });

  it("keeps cached refresh errors and pauses out of live announcements", () => {
    const { rerender } = render(
      <AsyncContent
        state={{ ...loadingState, content: "ready", fetch: "idle", error: "refresh" }}
        refreshIntent="silent-poll"
        loadingLabel="Loading region"
        skeleton={<div>Skeleton</div>}
        initialError={<div>Initial error</div>}
        paused={<div>Paused</div>}
        empty={<div>Empty</div>}
        refreshFeedback={<AsyncErrorState title="Refresh failed" />}
      >
        <div>Ready</div>
      </AsyncContent>,
    );

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("off");

    rerender(
      <AsyncContent
        state={{ ...loadingState, content: "ready", fetch: "paused", error: "none" }}
        refreshIntent="background"
        loadingLabel="Loading region"
        skeleton={<div>Skeleton</div>}
        initialError={<div>Initial error</div>}
        paused={<div>Paused</div>}
        empty={<div>Empty</div>}
        refreshFeedback={<AsyncPausedState title="Refresh paused" />}
      >
        <div>Ready</div>
      </AsyncContent>,
    );

    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("off");
  });

  it("marks an explicit user refresh busy without replacing content", () => {
    renderContent({ ...loadingState, content: "empty" }, "user-refresh");
    expect(screen.getByText("Empty")).toBeTruthy();
    expect(screen.getByTestId("refresh")).toBeTruthy();
    expect(screen.getByText("Empty").parentElement?.getAttribute("aria-busy")).toBe("true");
  });

  it("retains initial error context and exposes a keyboard retry", async () => {
    const onRetry = vi.fn();
    render(
      <AsyncErrorState
        title="Could not load"
        retryLabel="Retry"
        retryingLabel="Retrying"
        onRetry={onRetry}
      />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("supports explicit quiet semantics for page-level refresh feedback", () => {
    render(<AsyncErrorState title="Refresh failed" liveRegion="off" />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("off");
  });

  it("uses theme-aware semantic surfaces for shared error and paused states", () => {
    const { rerender } = render(<AsyncErrorState title="Could not load" className="custom-error" />);
    expect(screen.getByRole("alert").classList).toContain("pf-async-error");
    expect(screen.getByRole("alert").classList).toContain("custom-error");
    expect(screen.getByRole("alert").getAttribute("aria-live")).toBe("assertive");

    rerender(<AsyncPausedState title="Offline" className="custom-paused" />);
    expect(screen.getByRole("status").classList).toContain("pf-async-paused");
    expect(screen.getByRole("status").classList).toContain("custom-paused");
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
  });
});
