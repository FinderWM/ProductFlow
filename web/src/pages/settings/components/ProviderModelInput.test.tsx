/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../../../test/setup";
import { api } from "../../../lib/api";
import { ProviderModelInput } from "./ProviderModelInput";

const originalIntersectionObserver = globalThis.IntersectionObserver;

beforeEach(() => {
  globalThis.IntersectionObserver = class MockIntersectionObserver implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin = "0px";
    readonly thresholds: readonly number[] = [];

    disconnect() {}
    observe() {}
    takeRecords(): IntersectionObserverEntry[] { return []; }
    unobserve() {}
  };
});

afterEach(() => {
  globalThis.IntersectionObserver = originalIntersectionObserver;
  vi.restoreAllMocks();
});

function renderInput() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProviderModelInput
        idPrefix="provider-model"
        label="模型"
        value=""
        placeholder="输入模型"
        providerKind="openai"
        providerProfileId="profile-1"
        onChange={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

describe("ProviderModelInput async states", () => {
  it("does not treat the unactivated model query as an empty response", () => {
    vi.spyOn(api, "listProviderModels").mockRejectedValue(new Error("offline"));
    renderInput();

    expect(screen.queryByText("供应商未返回可用模型，可手动输入。")).toBeNull();
    expect(screen.queryByText("模型列表拉取失败")).toBeNull();
  });

  it("shows an activated query failure and retries from the refresh action", async () => {
    const modelRequest = vi.spyOn(api, "listProviderModels").mockRejectedValue(new Error("offline"));
    renderInput();

    await userEvent.setup().click(screen.getByRole("combobox", { name: "模型" }));
    expect(await screen.findByText("模型列表拉取失败")).toBeTruthy();

    await userEvent.setup().click(screen.getByRole("button", { name: "刷新模型列表" }));
    await waitFor(() => expect(modelRequest).toHaveBeenCalledTimes(2));
  });
});
