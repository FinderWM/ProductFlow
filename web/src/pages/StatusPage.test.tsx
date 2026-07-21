/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import "../test/setup";
import { api, ApiError } from "../lib/api";
import type { GenerationConfigStatusSummary } from "../lib/types";
import { StatusPage } from "./StatusPage";

vi.mock("../components/TopNav", () => ({
  TopNav: () => <nav aria-label="test-navigation" />,
}));

const statusSummary: GenerationConfigStatusSummary = {
  total_count: 1,
  enabled_count: 1,
  frozen_count: 0,
  running_count: 0,
  start_date: "2026-07-21",
  end_date: "2026-07-21",
  range_attempt_count: 7,
  range_success_count: 6,
  range_failure_count: 1,
  range_text_attempt_count: 7,
  range_image_attempt_count: 0,
  today_attempt_count: 7,
  today_success_count: 6,
  today_failure_count: 1,
  today_text_attempt_count: 7,
  today_image_attempt_count: 0,
  configs: [
    {
      id: "config-1",
      resource_group_id: null,
      resource_group_ids: [],
      purpose: "text",
      name: "Cached config",
      provider_kind: "mock",
      priority: 1,
      max_concurrency: 2,
      enabled: true,
      effective_enabled: true,
      state: null,
      today_stat: null,
      range_stat: {
        attempt_count: 7,
        success_count: 6,
        failure_count: 1,
        timeout_count: 0,
        throttled_count: 0,
        generated_unit_count: 6,
        total_latency_ms: 1200,
        freeze_count: 0,
        last_success_at: null,
        last_failure_at: null,
      },
    },
  ],
};

function renderStatusPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <StatusPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("StatusPage refresh feedback", () => {
  it("keeps cached metrics visible when a manual refresh fails and exposes a retry", async () => {
    const statusRequest = vi
      .spyOn(api, "getGenerationConfigStatus")
      .mockResolvedValueOnce(statusSummary)
      .mockRejectedValueOnce(new ApiError(503, "刷新状态失败，请重试"))
      .mockResolvedValueOnce(statusSummary);

    renderStatusPage();

    expect(await screen.findByText("Cached config")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "刷新" }));

    expect(await screen.findByText("刷新状态失败，请重试")).toBeTruthy();
    expect(screen.getByText("Cached config")).toBeTruthy();

    await userEvent.setup().click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() => expect(statusRequest).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.queryByText("刷新状态失败，请重试")).toBeNull());
    expect(screen.getByText("Cached config")).toBeTruthy();
  });
});
