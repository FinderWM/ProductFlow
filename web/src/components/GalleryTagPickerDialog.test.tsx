/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import "../test/setup";
import type { AsyncViewState } from "../lib/asyncViewState";
import { GalleryTagPickerDialog } from "./GalleryTagPickerDialog";

const loadingState: AsyncViewState = {
  participation: "active",
  content: "none",
  fetch: "fetching",
  error: "none",
};

function renderDialog(state: AsyncViewState, onRetry = vi.fn()) {
  return render(
    <GalleryTagPickerDialog
      open
      appearance="classic"
      tags={[]}
      state={state}
      onRetry={onRetry}
      onConfirm={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

describe("GalleryTagPickerDialog async states", () => {
  it("announces one loading region and renders pill skeletons", () => {
    renderDialog(loadingState);

    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(document.querySelectorAll(".pf-skeleton").length).toBe(10);
    expect(document.querySelector(".animate-spin")).toBeNull();
  });

  it("keeps an initial query failure out of the empty state and retries", async () => {
    const onRetry = vi.fn();
    renderDialog({ ...loadingState, fetch: "idle", error: "initial" }, onRetry);

    expect(screen.getByText("标签加载失败")).toBeTruthy();
    expect(screen.queryByText("暂无可选标签")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("shows the tag empty state only after a successful empty response", () => {
    renderDialog({ participation: "active", content: "empty", fetch: "idle", error: "none" });

    expect(screen.getByText("暂无可选标签")).toBeTruthy();
  });
});
