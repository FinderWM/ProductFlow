/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import "../../test/setup";
import { WorkspaceErrorState, WorkspaceRegionSkeleton } from "./WorkspaceLandingPages";

describe("workspace async region states", () => {
  it.each([
    ["latest", 9],
    ["metrics", 9],
    ["gallery", 6],
    ["summary", 18],
  ] as const)("renders structural %s skeleton geometry", (profile, minimumBlocks) => {
    const { container } = render(<WorkspaceRegionSkeleton profile={profile} metricCount={3} />);

    expect(container.querySelectorAll(".pf-skeleton").length).toBeGreaterThanOrEqual(minimumBlocks);
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("exposes a retry action for a failed workspace summary", async () => {
    const onRetry = vi.fn();
    render(
      <WorkspaceErrorState
        message="Summary failed"
        retryLabel="Retry"
        onRetry={onRetry}
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("keeps the retry action disabled while the request is retrying", () => {
    render(
      <WorkspaceErrorState
        message="Summary failed"
        retryLabel="Retry"
        retryingLabel="Retrying"
        retrying
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Retrying" }).hasAttribute("disabled")).toBe(true);
  });
});
