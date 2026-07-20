/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import "../../../test/setup";
import type { AsyncViewState } from "../../../lib/asyncViewState";
import type { ResourceLibraryAsset, ResourceLibraryAssetKind } from "../../../lib/types";
import { LoginPageAssetStatus, loginPageSelectableAssets } from "./LoginPageSettingsPanel";

const loadingState: AsyncViewState = {
  participation: "active",
  content: "none",
  fetch: "fetching",
  error: "none",
};

function asset(kind: ResourceLibraryAssetKind, overrides: Partial<ResourceLibraryAsset> = {}): ResourceLibraryAsset {
  return {
    id: kind,
    owner_user_id: "user-1",
    kind,
    original_filename: `${kind}.bin`,
    mime_type: "application/octet-stream",
    source_type: "upload",
    source_resource_id: null,
    groups: [],
    group_ids: [],
    download_url: "",
    preview_url: "",
    thumbnail_url: "",
    archived_at: null,
    created_at: "2026-07-19T00:00:00Z",
    updated_at: "2026-07-19T00:00:00Z",
    ...overrides,
  };
}

describe("LoginPageAssetStatus", () => {
  it("treats archived, disabled, and non-image resources as unavailable", () => {
    expect(loginPageSelectableAssets([
      asset("document"),
      asset("image", { id: "archived", archived_at: "2026-07-19T00:00:00Z" }),
      asset("image", { id: "disabled", effective_enabled: false }),
      asset("image", { id: "available", effective_enabled: true }),
    ])).toHaveLength(1);
  });

  it("uses a structural skeleton instead of a content spinner", () => {
    const { container } = render(<LoginPageAssetStatus state={loadingState} assetCount={0} onRetry={vi.fn()} />);
    expect(container.querySelector(".pf-skeleton")).toBeTruthy();
    expect(container.querySelector(".animate-spin")).toBeNull();
  });

  it("keeps an initial failure distinct from empty data and exposes retry", async () => {
    const onRetry = vi.fn();
    render(
      <LoginPageAssetStatus
        state={{ ...loadingState, fetch: "idle", error: "initial" }}
        assetCount={0}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText("资源库图片加载失败。")).toBeTruthy();
    expect(screen.queryByText("资源库暂无可用图片。")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("shows the business empty state only after a successful empty response", () => {
    render(
      <LoginPageAssetStatus
        state={{ ...loadingState, content: "empty", fetch: "idle" }}
        assetCount={0}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText("资源库暂无可用图片。")).toBeTruthy();
  });
});
