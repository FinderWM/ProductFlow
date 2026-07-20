export type AsyncParticipation = "active" | "inactive";
export type AsyncContentState = "none" | "empty" | "ready";
export type AsyncFetchState = "idle" | "fetching" | "paused";
export type AsyncErrorState = "none" | "initial" | "refresh";
export type AsyncRefreshIntent = "silent-poll" | "user-refresh" | "parameter-change" | "background";

export interface AsyncViewState {
  participation: AsyncParticipation;
  content: AsyncContentState;
  fetch: AsyncFetchState;
  error: AsyncErrorState;
}

export type AsyncViewPhase =
  | "inactive"
  | "initial-idle"
  | "loading"
  | "paused"
  | "initial-error"
  | "empty"
  | "ready";

export type AsyncRefreshFeedback = "none" | "refreshing" | "paused" | "refresh-error";

export interface AsyncQuerySnapshotInput<TData> {
  active: boolean;
  data: TData | undefined;
  dataUpdatedAt?: number;
  isSuccess: boolean;
  isError: boolean;
  fetchStatus: AsyncFetchState;
  isEmpty: (data: TData) => boolean;
}

export interface CombineAsyncViewStatesInput {
  active: boolean;
  critical: readonly AsyncViewState[];
  isEmpty: boolean;
}

export const INACTIVE_ASYNC_VIEW_STATE: AsyncViewState = Object.freeze({
  participation: "inactive",
  content: "none",
  fetch: "idle",
  error: "none",
});

export function asyncViewStateFromQuery<TData>({
  active,
  data,
  dataUpdatedAt = 0,
  isSuccess,
  isError,
  fetchStatus,
  isEmpty,
}: AsyncQuerySnapshotInput<TData>): AsyncViewState {
  if (!active) {
    return INACTIVE_ASYNC_VIEW_STATE;
  }

  const hasResolvedContent = data !== undefined && (isSuccess || dataUpdatedAt > 0);
  const content: AsyncContentState = hasResolvedContent ? (isEmpty(data) ? "empty" : "ready") : "none";

  return {
    participation: "active",
    content,
    fetch: fetchStatus,
    error: isError ? (hasResolvedContent ? "refresh" : "initial") : "none",
  };
}

export function combineAsyncViewStates({
  active,
  critical,
  isEmpty,
}: CombineAsyncViewStatesInput): AsyncViewState {
  if (!active || critical.some((state) => state.participation === "inactive")) {
    return INACTIVE_ASYNC_VIEW_STATE;
  }

  const allResolved = critical.length > 0 && critical.every((state) => state.content !== "none");
  const fetch: AsyncFetchState = critical.some((state) => state.fetch === "fetching")
    ? "fetching"
    : critical.some((state) => state.fetch === "paused")
      ? "paused"
      : "idle";
  const hasInitialError = critical.some((state) => state.error === "initial");
  const hasRefreshError = critical.some((state) => state.error === "refresh");

  return {
    participation: "active",
    content: allResolved ? (isEmpty ? "empty" : "ready") : "none",
    fetch,
    error: hasInitialError
      ? "initial"
      : allResolved && hasRefreshError
        ? "refresh"
        : "none",
  };
}

export function asyncViewPhase(state: AsyncViewState): AsyncViewPhase {
  if (state.participation === "inactive") {
    return "inactive";
  }
  if (state.content === "none" && state.error === "initial") {
    return "initial-error";
  }
  if (state.content === "none" && state.fetch === "paused") {
    return "paused";
  }
  if (state.content === "none" && state.fetch === "fetching") {
    return "loading";
  }
  if (state.content === "none") {
    return "initial-idle";
  }
  return state.content;
}

export function asyncRefreshFeedback(
  state: AsyncViewState,
  intent: AsyncRefreshIntent,
): AsyncRefreshFeedback {
  if (state.participation === "inactive" || state.content === "none") {
    return "none";
  }
  if (state.error === "refresh") {
    return "refresh-error";
  }
  if (state.fetch === "paused") {
    return "paused";
  }
  if (intent === "silent-poll") {
    return "none";
  }
  if (state.fetch === "fetching") {
    return "refreshing";
  }
  return "none";
}

export function asyncViewIsBusy(state: AsyncViewState, intent: AsyncRefreshIntent): boolean {
  if (state.participation === "inactive" || state.fetch !== "fetching") {
    return false;
  }
  if (state.content === "none") {
    return true;
  }
  return intent === "user-refresh";
}

export function validateAsyncViewState(state: AsyncViewState): string[] {
  const issues: string[] = [];

  if (
    state.participation === "inactive"
    && (state.content !== "none" || state.fetch !== "idle" || state.error !== "none")
  ) {
    issues.push("inactive-state-must-not-carry-content-fetch-or-error");
  }
  if (state.error === "initial" && state.content !== "none") {
    issues.push("initial-error-requires-no-content");
  }
  if (state.error === "refresh" && state.content === "none") {
    issues.push("refresh-error-requires-resolved-content");
  }

  return issues;
}
