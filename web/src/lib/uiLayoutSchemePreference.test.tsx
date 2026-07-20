/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import "../test/setup";

const mocks = vi.hoisted(() => ({
  getUserUiPreferences: vi.fn(),
  setThemePreference: vi.fn(),
  updateUserUiPreferences: vi.fn(),
}));

vi.mock("./api", () => ({
  api: {
    getUserUiPreferences: mocks.getUserUiPreferences,
    updateUserUiPreferences: mocks.updateUserUiPreferences,
  },
}));

vi.mock("./preferences", () => ({
  usePreferences: () => ({
    setThemePreference: mocks.setThemePreference,
    workspaceAppearance: "mist",
  }),
}));

import { UiLayoutSchemeProvider, useUiLayoutScheme } from "./uiLayoutSchemePreference";

function SchemeProbe() {
  const context = useUiLayoutScheme();
  return (
    <>
      <div data-testid="active-scheme">{context.activeScheme}</div>
      <div data-testid="resolution-status">{context.resolutionStatus}</div>
      <button type="button" onClick={context.retryDefaultScheme}>
        retry
      </button>
    </>
  );
}

function renderProvider() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retryDelay: 0 },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <UiLayoutSchemeProvider enabled>
        <SchemeProbe />
      </UiLayoutSchemeProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  delete document.documentElement.dataset.uiLayoutScheme;
  mocks.getUserUiPreferences.mockReset();
  mocks.setThemePreference.mockReset();
  mocks.updateUserUiPreferences.mockReset();
});

describe("UiLayoutSchemeProvider resolution", () => {
  it("falls back to classic after initial failure and switches only after an explicit retry succeeds", async () => {
    mocks.getUserUiPreferences
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        user_id: "user-1",
        ui_layout_scheme: "workspace",
        mask_sensitive_images_in_inspirations: true,
        mask_sensitive_images_in_image_chat: true,
        created_at: "2026-07-19T00:00:00Z",
        updated_at: "2026-07-19T00:00:00Z",
      });

    renderProvider();

    expect(screen.getByTestId("resolution-status").textContent).toBe("resolving");
    await waitFor(() => expect(screen.getByTestId("resolution-status").textContent).toBe("fallback-error"));
    expect(screen.getByTestId("active-scheme").textContent).toBe("classic");
    expect(document.documentElement.dataset.uiLayoutScheme).toBe("classic");

    await userEvent.setup().click(screen.getByRole("button", { name: "retry" }));

    await waitFor(() => expect(screen.getByTestId("resolution-status").textContent).toBe("resolved"));
    expect(screen.getByTestId("active-scheme").textContent).toBe("workspace");
    expect(document.documentElement.dataset.uiLayoutScheme).toBe("workspace");
    expect(mocks.getUserUiPreferences).toHaveBeenCalledTimes(3);
  });
});
