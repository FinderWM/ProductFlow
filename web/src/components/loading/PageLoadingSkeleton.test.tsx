/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import "../../test/setup";
import { AppBootstrapError, PageLoadingSkeleton } from "./PageLoadingSkeleton";

describe("PageLoadingSkeleton", () => {
  it.each(["standard", "list", "grid", "analytics", "side-rail", "workbench", "workspace-landing"] as const)(
    "renders the %s profile with one status region",
    (profile) => {
      const { unmount } = render(<PageLoadingSkeleton profile={profile} label={`${profile} loading`} />);
      expect(screen.getAllByRole("status")).toHaveLength(1);
      expect(screen.getByText(`${profile} loading`)).toBeTruthy();
      unmount();
    },
  );

  it("uses an auth shell without authenticated navigation", () => {
    const { container } = render(<PageLoadingSkeleton profile="auth-image-lab" label="Login loading" />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(container.querySelector("header")).toBeNull();
  });

  it("exposes session bootstrap recovery and locks the action while retrying", async () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <AppBootstrapError
        title="Session failed"
        message="Try again"
        retryLabel="Retry"
        retryingLabel="Retrying"
        onRetry={onRetry}
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();

    rerender(
      <AppBootstrapError
        title="Session failed"
        message="Try again"
        retryLabel="Retry"
        retryingLabel="Retrying"
        retrying
        onRetry={onRetry}
      />,
    );
    expect((screen.getByRole("button", { name: "Retrying" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
