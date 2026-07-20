import { describe, expect, it } from "vitest";

import {
  asyncRefreshFeedback,
  asyncViewIsBusy,
  asyncViewPhase,
  asyncViewStateFromQuery,
  combineAsyncViewStates,
  validateAsyncViewState,
  type AsyncViewState,
} from "./asyncViewState";

function queryState(
  overrides: Partial<Parameters<typeof asyncViewStateFromQuery<string[]>>[0]> = {},
): AsyncViewState {
  return asyncViewStateFromQuery<string[]>({
    active: true,
    data: undefined,
    isSuccess: false,
    isError: false,
    fetchStatus: "fetching",
    isEmpty: (data) => data.length === 0,
    ...overrides,
  });
}

describe("asyncViewStateFromQuery", () => {
  it.each([
    {
      name: "disabled query",
      input: { active: false },
      expected: ["inactive", "none", "idle", "none"],
    },
    {
      name: "initial fetch",
      input: {},
      expected: ["active", "none", "fetching", "none"],
    },
    {
      name: "initial pause",
      input: { fetchStatus: "paused" as const },
      expected: ["active", "none", "paused", "none"],
    },
    {
      name: "initial failure",
      input: { fetchStatus: "idle" as const, isError: true },
      expected: ["active", "none", "idle", "initial"],
    },
    {
      name: "retrying initial failure",
      input: { fetchStatus: "fetching" as const, isError: true },
      expected: ["active", "none", "fetching", "initial"],
    },
    {
      name: "confirmed empty while refreshing",
      input: { data: [], dataUpdatedAt: 1, fetchStatus: "fetching" as const },
      expected: ["active", "empty", "fetching", "none"],
    },
    {
      name: "cached content after refresh failure",
      input: { data: ["cached"], dataUpdatedAt: 1, fetchStatus: "idle" as const, isError: true },
      expected: ["active", "ready", "idle", "refresh"],
    },
  ])("resolves $name without treating undefined as empty", ({ input, expected }) => {
    const state = queryState(input);
    expect([state.participation, state.content, state.fetch, state.error]).toEqual(expected);
  });

  it("does not accept undefined as a successful empty response", () => {
    expect(queryState({ data: undefined, isSuccess: true, fetchStatus: "idle" }).content).toBe("none");
  });
});

describe("combineAsyncViewStates", () => {
  it("keeps a required dependency inactive instead of declaring an early empty state", () => {
    const state = combineAsyncViewStates({
      active: true,
      critical: [queryState({ active: false }), queryState({ data: [], isSuccess: true, fetchStatus: "idle" })],
      isEmpty: true,
    });
    expect(asyncViewPhase(state)).toBe("inactive");
  });

  it("waits for all critical queries and prioritizes fetching over paused", () => {
    const state = combineAsyncViewStates({
      active: true,
      critical: [
        queryState({ data: ["ready"], isSuccess: true, fetchStatus: "paused" }),
        queryState({ fetchStatus: "fetching" }),
      ],
      isEmpty: false,
    });
    expect(state).toMatchObject({ content: "none", fetch: "fetching", error: "none" });
    expect(asyncViewPhase(state)).toBe("loading");
  });

  it("keeps initial error context while retrying", () => {
    const state = combineAsyncViewStates({
      active: true,
      critical: [queryState({ isError: true, fetchStatus: "fetching" })],
      isEmpty: false,
    });
    expect(asyncViewPhase(state)).toBe("initial-error");
    expect(asyncViewIsBusy(state, "user-refresh")).toBe(true);
  });

  it("preserves confirmed empty content during refresh", () => {
    const state = combineAsyncViewStates({
      active: true,
      critical: [queryState({ data: [], dataUpdatedAt: 1, fetchStatus: "fetching" })],
      isEmpty: true,
    });
    expect(asyncViewPhase(state)).toBe("empty");
    expect(asyncRefreshFeedback(state, "silent-poll")).toBe("none");
    expect(asyncRefreshFeedback(state, "user-refresh")).toBe("refreshing");
    expect(asyncViewIsBusy(state, "silent-poll")).toBe(false);
    expect(asyncViewIsBusy(state, "user-refresh")).toBe(true);
  });

  it("keeps silent polling quiet while surfacing persistent refresh failures and pauses", () => {
    const refreshing = queryState({ data: ["cached"], dataUpdatedAt: 1, fetchStatus: "fetching" });
    const failed = queryState({
      data: ["cached"],
      dataUpdatedAt: 1,
      isError: true,
      fetchStatus: "idle",
    });
    const paused = queryState({ data: ["cached"], dataUpdatedAt: 1, fetchStatus: "paused" });

    expect(asyncRefreshFeedback(refreshing, "silent-poll")).toBe("none");
    expect(asyncRefreshFeedback(failed, "silent-poll")).toBe("refresh-error");
    expect(asyncRefreshFeedback(paused, "silent-poll")).toBe("paused");
    expect(asyncViewIsBusy(failed, "silent-poll")).toBe(false);
    expect(asyncViewIsBusy(paused, "silent-poll")).toBe(false);
  });

  it("does not turn a cached refresh failure into an initial error while another query loads", () => {
    const state = combineAsyncViewStates({
      active: true,
      critical: [
        queryState({ data: ["cached"], dataUpdatedAt: 1, isError: true, fetchStatus: "idle" }),
        queryState({ fetchStatus: "fetching" }),
      ],
      isEmpty: false,
    });
    expect(state).toMatchObject({ content: "none", fetch: "fetching", error: "none" });
    expect(asyncViewPhase(state)).toBe("loading");
  });
});

describe("validateAsyncViewState", () => {
  it("reports illegal orthogonal combinations", () => {
    expect(
      validateAsyncViewState({ participation: "active", content: "ready", fetch: "idle", error: "initial" }),
    ).toEqual(["initial-error-requires-no-content"]);
    expect(
      validateAsyncViewState({ participation: "active", content: "none", fetch: "idle", error: "refresh" }),
    ).toEqual(["refresh-error-requires-resolved-content"]);
    expect(
      validateAsyncViewState({ participation: "inactive", content: "empty", fetch: "paused", error: "refresh" }),
    ).toContain("inactive-state-must-not-carry-content-fetch-or-error");
  });
});
