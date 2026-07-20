/** @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import "../../test/setup";
import type { AsyncViewState } from "../../lib/asyncViewState";
import type { ImageChatTranslate } from "./display";
import { ImageChatHistoryPanel } from "./ImageChatHistoryPanel";
import { ImageChatMainStage } from "./ImageChatMainStage";
import { InspirationAssociationPanel } from "./ReferencePanels";

const t = ((key: string) => key) as ImageChatTranslate;

const loadingState: AsyncViewState = {
  participation: "active",
  content: "none",
  fetch: "fetching",
  error: "none",
};

function renderMainStage(state: AsyncViewState, onRetrySession = vi.fn()) {
  return render(
    <ImageChatMainStage
      state={state}
      sessionRounds={[]}
      selectedRound={null}
      selectedPlaceholder={null}
      retryingTaskId={null}
      cancellingTaskId={null}
      regenerating={false}
      maskSensitiveImages={false}
      onSelectRound={vi.fn()}
      onPreviewRound={vi.fn()}
      onRetryGenerationTask={vi.fn()}
      onCancelGenerationTask={vi.fn()}
      onRegenerateGenerationTask={vi.fn()}
      onRetrySession={onRetrySession}
      t={t}
    />,
  );
}

function renderAssociation(state: AsyncViewState, onRetry = vi.fn()) {
  return render(
    <InspirationAssociationPanel
      state={state}
      isInspirationMode={false}
      inspiration={undefined}
      inspirations={[]}
      targetInspirationId=""
      sourceImage={null}
      referenceImages={[]}
      selectedRound={null}
      attachBusy={false}
      deletingReferenceAssetId={null}
      onTargetInspirationChange={vi.fn()}
      onDeleteReference={vi.fn()}
      onPreviewReference={vi.fn()}
      onAttach={vi.fn()}
      onRetry={onRetry}
      t={t}
    />,
  );
}

function renderHistory(state: AsyncViewState, variant: "desktop" | "mobileDrawer" = "desktop", onRetry = vi.fn()) {
  return render(
    <ImageChatHistoryPanel
      state={state}
      historyBranches={[]}
      selectedGeneratedAssetId={null}
      selectedTaskPlaceholderId={null}
      selectedBaseAssetIds={[]}
      variant={variant}
      maskSensitiveImages={false}
      onSelectRound={vi.fn()}
      onSelectPlaceholder={vi.fn()}
      onRetry={onRetry}
      onPreviewPrompt={vi.fn()}
      t={t}
    />,
  );
}

describe("ImageChatMainStage async states", () => {
  it("renders a stable canvas skeleton during the initial session read", () => {
    renderMainStage(loadingState);

    expect(screen.getByRole("status").getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("app.loading")).toBeTruthy();
    expect(screen.queryByText("chat.noResult")).toBeNull();
  });

  it("distinguishes an inactive session query from an empty session", () => {
    renderMainStage({ participation: "inactive", content: "none", fetch: "idle", error: "none" });

    expect(screen.getByText("chat.selectSession")).toBeTruthy();
    expect(screen.queryByText("chat.noResult")).toBeNull();
  });

  it("keeps the error context while retrying and exposes recovery", async () => {
    const onRetry = vi.fn();
    renderMainStage({ ...loadingState, error: "initial" }, onRetry);

    expect(screen.getByText("chat.loadSessionFailed")).toBeTruthy();
    expect(screen.getByRole("button", { name: "app.loading" }).hasAttribute("disabled")).toBe(true);

    const { unmount } = renderMainStage({ ...loadingState, fetch: "idle", error: "initial" }, onRetry);
    await userEvent.setup().click(screen.getAllByRole("button", { name: "common.retry" })[0]);
    expect(onRetry).toHaveBeenCalledOnce();
    unmount();
  });

  it("shows the business empty state only after session data resolves", () => {
    renderMainStage({ participation: "active", content: "ready", fetch: "idle", error: "none" });

    expect(screen.getByText("chat.noResult")).toBeTruthy();
  });
});

describe("InspirationAssociationPanel async states", () => {
  it("does not present an inactive dependency as an empty inspiration list", () => {
    renderAssociation({ participation: "inactive", content: "none", fetch: "idle", error: "none" });

    expect(screen.getByText("chat.resourceGroupRequired")).toBeTruthy();
    expect(screen.queryByText("chat.noInspirations")).toBeNull();
  });

  it("provides a retry for an initial source query failure", async () => {
    const onRetry = vi.fn();
    renderAssociation({ participation: "active", content: "none", fetch: "idle", error: "initial" }, onRetry);

    await userEvent.setup().click(screen.getByRole("button", { name: "common.retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe("ImageChatHistoryPanel async states", () => {
  it("exposes a retry action for an initial desktop history failure", async () => {
    const onRetry = vi.fn();
    renderHistory({ ...loadingState, fetch: "idle", error: "initial" }, "desktop", onRetry);

    await userEvent.setup().click(screen.getByRole("button", { name: "common.retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("keeps the mobile history empty state behind a resolved session", () => {
    renderHistory({ participation: "active", content: "ready", fetch: "idle", error: "none" }, "mobileDrawer");

    expect(screen.getByText("chat.resultsAppearHere")).toBeTruthy();
    expect(screen.queryByText("chat.loadSessionFailed")).toBeNull();
  });
});
