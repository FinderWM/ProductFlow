/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import "../test/setup";
import { api } from "../lib/api";
import type { ResourceLibraryAsset, ResourceLibraryGroup } from "../lib/types";
import { ResourceLibraryPage } from "./ResourceLibraryPage";

vi.mock("../components/TopNav", () => ({
  TopNav: () => <nav aria-label="test-navigation" />,
}));

const asset: ResourceLibraryAsset = {
  id: "asset-1",
  owner_user_id: "user-1",
  kind: "image",
  original_filename: "board.png",
  mime_type: "image/png",
  source_type: "upload",
  source_resource_id: null,
  groups: [],
  group_ids: [],
  download_url: "/api/resource-library/assets/asset-1/download",
  preview_url: "/api/resource-library/assets/asset-1/preview",
  thumbnail_url: "/api/resource-library/assets/asset-1/thumbnail",
  archived_at: null,
  effective_enabled: true,
  created_at: "2026-07-20T00:00:00Z",
  updated_at: "2026-07-20T00:00:00Z",
};

const group: ResourceLibraryGroup = {
  id: "group-1",
  owner_user_id: "user-1",
  name: "Campaign",
  sort_order: 0,
  created_at: "2026-07-20T00:00:00Z",
  updated_at: "2026-07-20T00:00:00Z",
};

function renderResourceLibraryPage() {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
    matches: true,
    media: "(min-width: 1024px)",
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ResourceLibraryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ResourceLibraryPage async regions", () => {
  it("keeps successful assets visible when the group rail fails and retries the rail locally", async () => {
    const groupsRequest = vi
      .spyOn(api, "listResourceLibraryGroups")
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ items: [group] });
    vi.spyOn(api, "listResourceLibraryAssets").mockResolvedValue({ items: [asset] });

    renderResourceLibraryPage();

    expect(await screen.findByText("board.png")).toBeTruthy();
    expect(await screen.findByText("资源库加载失败")).toBeTruthy();

    await userEvent.setup().click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() => expect(groupsRequest).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Campaign")).toBeTruthy();
    expect(screen.getByText("board.png")).toBeTruthy();
  });
});
