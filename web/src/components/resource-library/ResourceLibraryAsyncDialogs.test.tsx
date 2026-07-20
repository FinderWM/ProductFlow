/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "../../test/setup";
import { api } from "../../lib/api";
import { ResourceLibraryModal } from "./ResourceLibraryModal";
import { SaveToResourceLibraryDialog } from "./SaveToResourceLibraryDialog";

function renderWithQueryClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resource library async dialogs", () => {
  it("keeps a source-status failure out of the unsaved state and retries it", async () => {
    vi.spyOn(api, "listResourceLibraryGroups").mockResolvedValue({ items: [] });
    const sourceStatusRequest = vi
      .spyOn(api, "listResourceLibrarySourceStatus")
      .mockRejectedValue(new Error("offline"));

    renderWithQueryClient(
      <SaveToResourceLibraryDialog
        source={{ source_type: "image_session_asset", source_id: "asset-1", title: "Candidate" }}
        canWrite
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText("资源保存状态加载失败")).toBeTruthy();
    const saveButton = screen.getByRole("button", { name: "保存到资源库" });
    expect(saveButton.hasAttribute("disabled")).toBe(true);

    await userEvent.setup().click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(sourceStatusRequest).toHaveBeenCalledTimes(2));
  });

  it("shows a recoverable asset-grid error without replacing the modal shell", async () => {
    vi.spyOn(api, "listResourceLibraryGroups").mockResolvedValue({ items: [] });
    const assetsRequest = vi
      .spyOn(api, "listResourceLibraryAssets")
      .mockRejectedValue(new Error("offline"));

    renderWithQueryClient(
      <ResourceLibraryModal
        open
        canRead
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText("资源库加载失败")).toBeTruthy();
    expect(screen.getByText("资源库")).toBeTruthy();

    await userEvent.setup().click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(assetsRequest).toHaveBeenCalledTimes(2));
  });
});
