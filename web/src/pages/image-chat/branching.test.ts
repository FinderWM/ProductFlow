import { describe, expect, it } from "vitest";

import type { ImageSessionAsset, ImageSessionDetail, ImageSessionGenerationTask, ImageSessionRound, ImageSessionStatus } from "../../lib/types";
import {
  buildImageGenerationSubmitSignature,
  buildImageSessionHistoryTree,
  canStartImageSessionNewRound,
  clampGenerationCount,
  clampImageGenerationTaskCandidateCount,
  effectiveImageGenerationSubmitCount,
  findImageGenerationTaskPlaceholderRound,
  findImageHistoryPlaceholder,
  groupImageSessionRounds,
  imageChatSessionFilterRouteStateFromSearchParams,
  imageGenerationRetryMetadata,
  imageGenerationTaskSubmitPayload,
  imageSessionNewRoundDefaultResourceGroupId,
  isImageSessionGenerationTaskActive,
  isImageSessionGenerationTaskAutoRetrying,
  isCurrentImageSessionGenerationTask,
  isImageSessionGenerationTaskRegeneratable,
  isImageSessionGenerationTaskRetryable,
  latestImageSessionGenerationState,
  mergeImageSessionStatusIntoDetail,
  reconcileImageSessionSelection,
  requiresImageSessionGenerationBase,
  selectImageGenerationTaskNextPlaceholderId,
  selectSubmittedImageGenerationTaskPlaceholderId,
  shouldBlockDuplicateGenerationSubmit,
  shouldRefreshImageSessionDetailFromStatus,
} from "./branching";

const createdAt = "2026-04-27T00:00:00Z";
const resourceGroup = { id: "group-default", key: "default", name: "default" };

function asset(id: string): ImageSessionAsset {
  return {
    id,
    kind: "generated_image",
    original_filename: `${id}.png`,
    mime_type: "image/png",
    download_url: `/download/${id}`,
    preview_url: `/preview/${id}`,
    thumbnail_url: `/thumb/${id}`,
    gallery_saved: false,
    gallery_entry_id: null,
    created_at: createdAt,
  };
}

function round(overrides: Partial<ImageSessionRound>): ImageSessionRound {
  return {
    id: "round-1",
    prompt: "prompt",
    assistant_message: "done",
    size: "1024x1024",
    model_name: "mock",
    provider_name: "mock",
    prompt_version: "v1",
    provider_response_id: null,
    previous_response_id: null,
    image_generation_call_id: null,
    generation_config_id: null,
    resource_group_id: resourceGroup.id,
    resource_group: resourceGroup,
    generation_group_id: null,
    candidate_index: 1,
    candidate_count: 1,
    base_asset_ids: [],
    base_asset_id: null,
    selected_reference_asset_ids: [],
    actual_size: null,
    provider_notes: [],
    generated_asset: asset("asset-1"),
    created_at: createdAt,
    ...overrides,
  };
}

function task(overrides: Partial<ImageSessionGenerationTask>): ImageSessionGenerationTask {
  return {
    id: "task-1",
    session_id: "session-1",
    status: "succeeded",
    prompt: "prompt",
    size: "1024x1024",
    base_asset_ids: [],
    base_asset_id: null,
    selected_reference_asset_ids: [],
    generation_config_mode: "auto",
    requested_generation_config_id: null,
    used_generation_config_id: null,
    resource_group_id: resourceGroup.id,
    resource_group: resourceGroup,
    generation_count: 1,
    completed_candidates: 0,
    active_candidate_index: null,
    progress_phase: null,
    progress_updated_at: null,
    provider_response_id: null,
    provider_response_status: null,
    progress_metadata: null,
    failure_reason: null,
    result_generation_group_id: null,
    tool_options: null,
    provider_notes: [],
    attempts: 0,
    is_retryable: true,
    is_cancelable: false,
    created_at: createdAt,
    started_at: null,
    finished_at: null,
    queue_active_count: 0,
    queue_running_count: 0,
    queue_queued_count: 0,
    queue_max_concurrent_tasks: 3,
    queued_ahead_count: null,
    queue_position: null,
    ...overrides,
  };
}

function detail(overrides: Partial<ImageSessionDetail>): ImageSessionDetail {
  return {
    id: "session-1",
    inspiration_id: null,
    title: "会话",
    assets: [],
    rounds: [],
    generation_tasks: [],
    created_at: createdAt,
    updated_at: createdAt,
    ...overrides,
  };
}

function status(overrides: Partial<ImageSessionStatus>): ImageSessionStatus {
  return {
    id: "session-1",
    inspiration_id: null,
    title: "会话",
    rounds_count: 0,
    latest_round_id: null,
    latest_generation_group_id: null,
    has_active_generation_task: false,
    generation_tasks: [],
    created_at: createdAt,
    updated_at: createdAt,
    ...overrides,
  };
}

describe("image chat branching helpers", () => {
  it("groups multi-candidate rounds by generation group and sorts candidates", () => {
    const groups = groupImageSessionRounds([
      round({ id: "r1", generation_group_id: "g1", candidate_index: 2, generated_asset: asset("a2") }),
      round({ id: "r0", generation_group_id: "g1", candidate_index: 1, generated_asset: asset("a1") }),
      round({ id: "r2", generation_group_id: null, generated_asset: asset("a3") }),
    ]);

    expect(groups.map((group) => group.id)).toEqual(["g1", "r2"]);
    expect(groups[0].rounds.map((item) => item.generated_asset.id)).toEqual(["a1", "a2"]);
  });

  it("keeps the visible generation count in the standard range and task counts in the provider batch range", () => {
    expect(clampGenerationCount(0)).toBe(1);
    expect(clampGenerationCount(3.6)).toBe(4);
    expect(clampGenerationCount(10)).toBe(10);
    expect(clampGenerationCount(12)).toBe(10);
    expect(clampImageGenerationTaskCandidateCount(10)).toBe(10);
    expect(clampImageGenerationTaskCandidateCount(12)).toBe(10);
    expect(effectiveImageGenerationSubmitCount(4, { n: 10 })).toBe(4);
  });

  it("builds lightweight history groups with task-derived placeholders", () => {
    const branches = buildImageSessionHistoryTree(
      [
        round({
          id: "root-round",
          generation_group_id: "root-group",
          generated_asset: asset("root-asset"),
          candidate_index: 1,
          candidate_count: 1,
        }),
      ],
      [
        task({
          id: "task-branch",
          status: "running",
          base_asset_id: "root-asset",
          generation_count: 4,
          completed_candidates: 1,
          active_candidate_index: 2,
          created_at: "2026-04-27T00:01:00Z",
        }),
      ],
    );

    expect(branches).toHaveLength(2);
    expect(branches.map((branch) => [branch.id, branch.depth, branch.branch_index, branch.parent_group_id])).toEqual([
      ["root-group", 0, null, null],
      ["task:task-branch", 0, 1, null],
    ]);
    expect(branches[1].candidates).toHaveLength(4);
    expect(branches[1].candidates.map((candidate) => candidate.status)).toEqual([
      "completed",
      "running",
      "running",
      "running",
    ]);
  });

  it("keeps later groups at the same depth and assigns visible indexes by history order", () => {
    const branches = buildImageSessionHistoryTree(
      [
        round({
          id: "root-round",
          generation_group_id: "root-group",
          generated_asset: asset("root-asset"),
          created_at: "2026-04-27T00:00:00Z",
        }),
        round({
          id: "branch-round-1",
          generation_group_id: "branch-group-1",
          base_asset_id: "root-asset",
          generated_asset: asset("branch-asset-1"),
          created_at: "2026-04-27T00:01:00Z",
        }),
        round({
          id: "branch-round-2",
          generation_group_id: "branch-group-2",
          base_asset_id: "root-asset",
          generated_asset: asset("branch-asset-2"),
          created_at: "2026-04-27T00:02:00Z",
        }),
      ],
      [],
    );

    expect(branches.map((branch) => [branch.id, branch.depth, branch.branch_index])).toEqual([
      ["root-group", 0, null],
      ["branch-group-1", 0, 1],
      ["branch-group-2", 0, 2],
    ]);
  });

  it("keeps high-count generation task placeholders up to 10 candidates", () => {
    const branches = buildImageSessionHistoryTree(
      [],
      [
        task({
          id: "high-count-task",
          status: "running",
          generation_count: 10,
          completed_candidates: 1,
          active_candidate_index: 2,
        }),
      ],
    );

    expect(branches[0].candidates).toHaveLength(10);
    expect(branches[0].candidates.map((candidate) => candidate.candidate_count)).toEqual(Array(10).fill(10));
    expect(branches[0].candidates.at(-1)?.id).toBe("task:high-count-task:candidate:10");
  });

  it("keeps completed rounds in the same task branch and only fills missing candidates with placeholders", () => {
    const branches = buildImageSessionHistoryTree(
      [
        round({
          id: "root-round",
          generation_group_id: "root-group",
          generated_asset: asset("root-asset"),
        }),
        round({
          id: "branch-round-1",
          generation_group_id: "branch-group",
          base_asset_id: "root-asset",
          generated_asset: asset("branch-asset-1"),
          candidate_index: 1,
          candidate_count: 3,
          created_at: "2026-04-27T00:02:00Z",
        }),
      ],
      [
        task({
          id: "task-branch",
          status: "running",
          base_asset_id: "root-asset",
          generation_count: 3,
          completed_candidates: 1,
          result_generation_group_id: "branch-group",
          created_at: "2026-04-27T00:01:00Z",
        }),
      ],
    );

    const branch = branches.find((item) => item.id === "branch-group");
    expect(branch?.depth).toBe(0);
    expect(branch?.candidates.map((candidate) => [candidate.kind, candidate.candidate_index])).toEqual([
      ["round", 1],
      ["placeholder", 2],
      ["placeholder", 3],
    ]);
    expect(findImageHistoryPlaceholder(branches, "task:task-branch:candidate:2")?.candidate_index).toBe(2);
  });

  it("creates placeholders for queued and failed generation tasks", () => {
    const branches = buildImageSessionHistoryTree([], [
      task({
        id: "queued-task",
        status: "queued",
        generation_count: 2,
        created_at: "2026-04-27T00:01:00Z",
      }),
      task({
        id: "failed-task",
        status: "failed",
        generation_count: 3,
        failure_reason: "provider failed",
        created_at: "2026-04-27T00:02:00Z",
      }),
    ]);

    expect(branches.map((branch) => branch.id)).toEqual(["task:queued-task", "task:failed-task"]);
    expect(branches.map((branch) => branch.branch_index)).toEqual([null, 1]);
    expect(branches[0].candidates.map((candidate) => candidate.status)).toEqual(["queued", "queued"]);
    expect(branches[1].candidates.map((candidate) => candidate.status)).toEqual(["failed", "failed", "failed"]);
    expect(findImageHistoryPlaceholder(branches, "task:failed-task:candidate:3")?.failure_reason).toBe(
      "provider failed",
    );
  });

  it("does not require a generated base after prior results or active generation tasks", () => {
    expect(requiresImageSessionGenerationBase([], [])).toBe(false);
    expect(
      requiresImageSessionGenerationBase(
        [
          round({
            id: "root-round",
            generated_asset: asset("root-asset"),
          }),
        ],
        [],
      ),
    ).toBe(false);
    expect(
      requiresImageSessionGenerationBase(
        [],
        [
          task({
            id: "queued-task",
            status: "queued",
          }),
        ],
      ),
    ).toBe(false);
    expect(
      requiresImageSessionGenerationBase(
        [],
        [
          task({
            id: "failed-task",
            status: "failed",
          }),
        ],
      ),
    ).toBe(false);
  });

  it("finds the generated round that replaces a selected task placeholder", () => {
    const rounds = [
      round({
        id: "branch-round-2",
        generation_group_id: "branch-group",
        generated_asset: asset("branch-asset-2"),
        candidate_index: 2,
        candidate_count: 3,
      }),
    ];
    const tasks = [
      task({
        id: "task-branch",
        generation_count: 3,
        result_generation_group_id: "branch-group",
      }),
    ];

    expect(findImageGenerationTaskPlaceholderRound(rounds, tasks, "task:task-branch:candidate:2")?.generated_asset.id).toBe(
      "branch-asset-2",
    );
    expect(findImageGenerationTaskPlaceholderRound(rounds, tasks, "task:task-branch:candidate:3")).toBeNull();
    expect(findImageGenerationTaskPlaceholderRound(rounds, tasks, "not-a-placeholder")).toBeNull();
  });

  it("reconciles a selected placeholder to the generated replacement round", () => {
    const rounds = [
      round({
        id: "branch-round-2",
        generation_group_id: "branch-group",
        generated_asset: asset("branch-asset-2"),
        candidate_index: 2,
        candidate_count: 3,
      }),
    ];
    const tasks = [
      task({
        id: "task-branch",
        generation_count: 3,
        result_generation_group_id: "branch-group",
      }),
    ];

    expect(
      reconcileImageSessionSelection({
        rounds,
        generationTasks: tasks,
        historyBranches: buildImageSessionHistoryTree(rounds, tasks),
        selectedGeneratedAssetId: null,
        selectedTaskPlaceholderId: "task:task-branch:candidate:2",
        selectedBaseAssetIds: [],
        availableBaseAssetIds: [],
        maxSelectedBaseCount: 6,
        pendingGeneratedRoundCount: null,
      }),
    ).toMatchObject({
      selectedGeneratedAssetId: "branch-asset-2",
      selectedTaskPlaceholderId: null,
      selectedBaseAssetIds: [],
    });
  });

  it("falls back to the latest generated asset when the selected round no longer exists", () => {
    const rounds = [
      round({ id: "round-1", generated_asset: asset("asset-1"), created_at: "2026-04-27T00:00:00Z" }),
      round({ id: "round-2", generated_asset: asset("asset-2"), created_at: "2026-04-27T00:01:00Z" }),
    ];

    expect(
      reconcileImageSessionSelection({
        rounds,
        generationTasks: [],
        historyBranches: buildImageSessionHistoryTree(rounds, []),
        selectedGeneratedAssetId: "gone",
        selectedTaskPlaceholderId: null,
        selectedBaseAssetIds: ["gone"],
        availableBaseAssetIds: [],
        maxSelectedBaseCount: 6,
        pendingGeneratedRoundCount: null,
      }),
    ).toMatchObject({
      selectedGeneratedAssetId: "asset-2",
      selectedTaskPlaceholderId: null,
      selectedBaseAssetIds: [],
    });
  });

  it("prunes unavailable base selections while preserving valid order", () => {
    const reconciled = reconcileImageSessionSelection({
      rounds: [],
      generationTasks: [],
      historyBranches: [],
      selectedGeneratedAssetId: null,
      selectedTaskPlaceholderId: null,
      selectedBaseAssetIds: ["ref-1", "gone", "ref-2", "ref-1", "ref-3"],
      availableBaseAssetIds: ["ref-1", "ref-2", "ref-3"],
      maxSelectedBaseCount: 2,
      pendingGeneratedRoundCount: null,
    });

    expect(reconciled.selectedBaseAssetIds).toEqual(["ref-1", "ref-2"]);
  });

  it("marks a pending generation complete when the round count increases", () => {
    const rounds = [round({ id: "round-1", generated_asset: asset("asset-1") })];

    expect(
      reconcileImageSessionSelection({
        rounds,
        generationTasks: [],
        historyBranches: buildImageSessionHistoryTree(rounds, []),
        selectedGeneratedAssetId: null,
        selectedTaskPlaceholderId: null,
        selectedBaseAssetIds: [],
        availableBaseAssetIds: [],
        maxSelectedBaseCount: 6,
        pendingGeneratedRoundCount: 0,
      }),
    ).toMatchObject({
      selectedGeneratedAssetId: "asset-1",
      selectedTaskPlaceholderId: null,
      selectedBaseAssetIds: [],
      pendingGeneratedRoundCount: null,
      generatedRoundCompleted: true,
    });
  });

  it("selects the matching submitted generation task placeholder after submit", () => {
    const payload = {
      prompt: "prompt",
      size: "1024x1024",
      base_asset_ids: ["base-1", "ref-1"],
      base_asset_id: "base-1",
      selected_reference_asset_ids: ["ref-1"],
      generation_count: 3,
      tool_options: { quality: "high" as const },
      resource_group_id: resourceGroup.id,
    };
    const tasks = [
      task({
        id: "newest-but-other",
        status: "queued",
        prompt: "other",
        generation_count: 1,
        created_at: "2026-04-27T00:03:00Z",
      }),
      task({
        id: "matching",
        status: "running",
        prompt: "prompt",
        size: "1024x1024",
        base_asset_ids: ["base-1", "ref-1"],
        base_asset_id: "base-1",
        selected_reference_asset_ids: ["ref-1"],
        generation_count: 3,
        completed_candidates: 1,
        active_candidate_index: 2,
        tool_options: { quality: "high" },
        created_at: "2026-04-27T00:02:00Z",
      }),
    ];

    expect(selectSubmittedImageGenerationTaskPlaceholderId(tasks, payload)).toBe("task:matching:candidate:2");
  });

  it("prefers an active matching submitted task over a newer cancelled task with the same payload", () => {
    const payload = {
      prompt: "prompt",
      size: "1024x1024",
      base_asset_ids: [],
      base_asset_id: null,
      selected_reference_asset_ids: [],
      generation_count: 1,
      tool_options: null,
      resource_group_id: resourceGroup.id,
    };
    const tasks = [
      task({
        id: "cancelled-newer",
        status: "cancelled",
        created_at: "2026-04-27T00:02:00Z",
      }),
      task({
        id: "queued-new-task",
        status: "queued",
        is_cancelable: true,
        created_at: "2026-04-27T00:01:00Z",
      }),
    ];

    expect(selectSubmittedImageGenerationTaskPlaceholderId(tasks, payload)).toBe("task:queued-new-task:candidate:1");
  });

  it("matches submitted high-count generation tasks", () => {
    const payload = {
      prompt: "prompt",
      size: "1024x1024",
      base_asset_ids: [],
      base_asset_id: null,
      selected_reference_asset_ids: [],
      generation_count: 10,
      tool_options: null,
      resource_group_id: resourceGroup.id,
    };

    expect(
      selectSubmittedImageGenerationTaskPlaceholderId(
        [
          task({
            id: "matching-n",
            status: "running",
            prompt: "prompt",
            generation_count: 10,
            active_candidate_index: 1,
            tool_options: null,
          }),
        ],
        payload,
      ),
    ).toBe("task:matching-n:candidate:1");
  });

  it("falls back to the newest active task placeholder when submit payload has no exact match", () => {
    const payload = {
      prompt: "missing",
      size: "1024x1024",
      base_asset_ids: [],
      base_asset_id: null,
      selected_reference_asset_ids: [],
      generation_count: 1,
      tool_options: null,
      resource_group_id: resourceGroup.id,
    };

    expect(
      selectSubmittedImageGenerationTaskPlaceholderId(
        [
          task({ id: "old-failed", status: "failed", created_at: "2026-04-27T00:01:00Z" }),
          task({
            id: "new-running",
            status: "running",
            generation_count: 4,
            completed_candidates: 2,
            active_candidate_index: null,
            created_at: "2026-04-27T00:02:00Z",
          }),
        ],
        payload,
      ),
    ).toBe("task:new-running:candidate:3");
  });

  it("selects the next retry placeholder from active candidate or completed count", () => {
    expect(
      selectImageGenerationTaskNextPlaceholderId(
        task({
          id: "retry-active",
          generation_count: 4,
          completed_candidates: 1,
          active_candidate_index: 3,
        }),
      ),
    ).toBe("task:retry-active:candidate:3");
    expect(
      selectImageGenerationTaskNextPlaceholderId(
        task({
          id: "retry-next",
          generation_count: 4,
          completed_candidates: 2,
          active_candidate_index: null,
        }),
      ),
    ).toBe("task:retry-next:candidate:3");
  });

  it("detects active generation tasks", () => {
    expect(isImageSessionGenerationTaskActive(task({ status: "queued" }))).toBe(true);
    expect(isImageSessionGenerationTaskActive(task({ status: "running" }))).toBe(true);
    expect(isImageSessionGenerationTaskActive(task({ status: "succeeded" }))).toBe(false);
    expect(isImageSessionGenerationTaskActive(task({ status: "failed" }))).toBe(false);
  });

  it("detects failed tasks that can be manually retried", () => {
    expect(isImageSessionGenerationTaskRetryable(task({ status: "failed", is_retryable: true }))).toBe(true);
    expect(isImageSessionGenerationTaskRetryable(task({ status: "failed", is_retryable: false }))).toBe(true);
    expect(isImageSessionGenerationTaskRetryable(task({ status: "cancelled", is_retryable: false }))).toBe(false);
    expect(isImageSessionGenerationTaskRetryable(task({ status: "queued", is_retryable: true }))).toBe(false);
  });

  it("builds a generation form payload from a failed task with all original config", () => {
    const failedTask = task({
      status: "failed",
      prompt: "same prompt",
      size: "1536x1024",
      base_asset_ids: ["base-1", "ref-1", "ref-2"],
      base_asset_id: "base-1",
      selected_reference_asset_ids: ["ref-1", "ref-2"],
      generation_count: 3,
      tool_options: { model: "image-model", quality: "high" },
      resource_group_id: "group-failed",
      resource_group: { id: "group-failed", key: "failed", name: "Failed group" },
      generation_config_mode: "manual",
      requested_generation_config_id: "config-1",
    });

    expect(isImageSessionGenerationTaskRetryable(failedTask)).toBe(true);
    expect(imageGenerationTaskSubmitPayload(failedTask)).toEqual({
      prompt: "same prompt",
      size: "1536x1024",
      base_asset_ids: ["base-1", "ref-1", "ref-2"],
      base_asset_id: "base-1",
      selected_reference_asset_ids: ["ref-1", "ref-2"],
      generation_count: 3,
      tool_options: { model: "image-model", quality: "high" },
      resource_group_id: "group-failed",
      generation_config_mode: "manual",
      generation_config_id: "config-1",
    });
  });

  it("allows cancelled tasks through the direct regenerate path", () => {
    expect(isImageSessionGenerationTaskRegeneratable(task({ status: "cancelled" }))).toBe(true);
    expect(isImageSessionGenerationTaskRegeneratable(task({ status: "failed" }))).toBe(false);
    expect(isImageSessionGenerationTaskRegeneratable(task({ status: "succeeded" }))).toBe(false);
  });

  it("detects the latest generation state so only the current round is actionable", () => {
    const firstRound = round({
      id: "first-round",
      generated_asset: asset("first-asset"),
      created_at: "2026-04-27T00:01:00Z",
    });
    const failedAfterFirstRound = task({
      id: "latest-failed",
      status: "failed",
      created_at: "2026-04-27T00:02:00Z",
    });

    expect(latestImageSessionGenerationState([firstRound], [failedAfterFirstRound])).toMatchObject({
      status: "failed",
      task: { id: "latest-failed" },
      round: null,
    });
    expect(isCurrentImageSessionGenerationTask(failedAfterFirstRound, [firstRound], [failedAfterFirstRound])).toBe(true);
    expect(
      isCurrentImageSessionGenerationTask(
        task({ id: "older-failed", status: "failed", created_at: "2026-04-27T00:00:30Z" }),
        [firstRound],
        [failedAfterFirstRound],
      ),
    ).toBe(false);
  });

  it("treats a newer successful round as the latest state for starting a new round", () => {
    const olderFailedTask = task({
      id: "older-failed",
      status: "failed",
      created_at: "2026-04-27T00:01:00Z",
    });
    const latestRound = round({
      id: "latest-round",
      generated_asset: asset("latest-asset"),
      created_at: "2026-04-27T00:02:00Z",
    });

    expect(latestImageSessionGenerationState([latestRound], [olderFailedTask])).toMatchObject({
      status: "succeeded",
      round: { id: "latest-round" },
      task: null,
    });
    expect(isCurrentImageSessionGenerationTask(olderFailedTask, [latestRound], [olderFailedTask])).toBe(false);
  });

  it("allows a cancelled latest generation state to start a new round", () => {
    expect(
      canStartImageSessionNewRound({
        status: "cancelled",
        round: null,
        task: task({ status: "cancelled" }),
      }),
    ).toBe(true);
    expect(
      canStartImageSessionNewRound({
        status: "failed",
        round: null,
        task: task({ status: "failed" }),
      }),
    ).toBe(true);
    expect(
      canStartImageSessionNewRound({
        status: "active",
        round: null,
        task: task({ status: "running" }),
      }),
    ).toBe(false);
  });

  it("detects a cancelled task after a successful round as the current generation state", () => {
    const firstRound = round({
      id: "first-round",
      generated_asset: asset("first-asset"),
      created_at: "2026-04-27T00:01:00Z",
    });
    const cancelledTask = task({
      id: "latest-cancelled",
      status: "cancelled",
      created_at: "2026-04-27T00:02:00Z",
    });

    expect(latestImageSessionGenerationState([firstRound], [cancelledTask])).toMatchObject({
      status: "cancelled",
      task: { id: "latest-cancelled" },
      round: null,
    });
    expect(isCurrentImageSessionGenerationTask(cancelledTask, [firstRound], [cancelledTask])).toBe(true);
  });

  it("uses terminal task time when a multi-candidate generation fails after partial success", () => {
    const partialRound = round({
      id: "partial-round",
      generated_asset: asset("partial-asset"),
      generation_group_id: "group-1",
      candidate_index: 1,
      candidate_count: 2,
      created_at: "2026-04-27T00:02:00Z",
    });
    const failedTask = task({
      id: "failed-after-partial",
      status: "failed",
      result_generation_group_id: "group-1",
      generation_count: 2,
      completed_candidates: 1,
      failure_reason: "second candidate failed",
      created_at: "2026-04-27T00:01:00Z",
      finished_at: "2026-04-27T00:03:00Z",
    });

    expect(latestImageSessionGenerationState([partialRound], [failedTask])).toMatchObject({
      status: "failed",
      task: { id: "failed-after-partial" },
      round: null,
    });
  });

  it("detects active auto retry tasks and parses retry metadata", () => {
    const retryingTask = task({
      status: "queued",
      progress_phase: "auto_retry_queued",
      progress_metadata: {
        last_failure_reason: "图片供应商请求超时，请稍后重试",
        last_failure_category: "timeout",
        last_failure_retryable: true,
        retry_hint: "retry_later",
        auto_retry_attempt: 1,
        max_attempts: 3,
      },
    });

    expect(isImageSessionGenerationTaskAutoRetrying(retryingTask)).toBe(true);
    expect(imageGenerationRetryMetadata(retryingTask)).toEqual({
      last_failure_reason: "图片供应商请求超时，请稍后重试",
      last_failure_category: "timeout",
      last_failure_retryable: true,
      retry_hint: "retry_later",
      auto_retry_attempt: 1,
      max_attempts: 3,
    });
    expect(isImageSessionGenerationTaskAutoRetrying(task({ status: "running", progress_phase: "auto_retry_queued" }))).toBe(false);
  });

  it("merges lightweight session status into cached detail without replacing rounds and assets", () => {
    const cached = detail({
      title: "旧标题",
      assets: [asset("asset-1")],
      rounds: [round({ id: "round-1" })],
      generation_tasks: [task({ id: "task-1", status: "queued" })],
      updated_at: "2026-04-27T00:00:00Z",
    });
    const merged = mergeImageSessionStatusIntoDetail(
      cached,
      status({
        title: "新标题",
        generation_tasks: [
          task({
            id: "task-1",
            status: "queued",
            progress_phase: "auto_retry_queued",
            progress_metadata: { last_failure_reason: "timeout", auto_retry_attempt: 1, max_attempts: 3 },
            queue_running_count: 1,
          }),
        ],
        updated_at: "2026-04-27T00:00:10Z",
      }),
    );

    expect(merged.title).toBe("新标题");
    expect(merged.assets).toBe(cached.assets);
    expect(merged.rounds).toBe(cached.rounds);
    expect(merged.generation_tasks[0].status).toBe("queued");
    expect(merged.generation_tasks[0].progress_metadata).toEqual({
      last_failure_reason: "timeout",
      auto_retry_attempt: 1,
      max_attempts: 3,
    });
    expect(merged.updated_at).toBe("2026-04-27T00:00:10Z");
  });

  it("refreshes full detail when lightweight status reaches terminal state or new rounds", () => {
    const cached = detail({
      rounds: [round({ id: "round-1" })],
      generation_tasks: [task({ id: "task-1", status: "running" })],
    });

    expect(
      shouldRefreshImageSessionDetailFromStatus(
        cached,
        status({ rounds_count: 1, latest_round_id: "round-1", generation_tasks: [task({ id: "task-1", status: "running" })] }),
      ),
    ).toBe(false);
    expect(
      shouldRefreshImageSessionDetailFromStatus(
        cached,
        status({ rounds_count: 1, latest_round_id: "round-1", generation_tasks: [task({ id: "task-1", status: "failed" })] }),
      ),
    ).toBe(true);
    expect(
      shouldRefreshImageSessionDetailFromStatus(
        cached,
        status({ rounds_count: 2, latest_round_id: "round-2", generation_tasks: [task({ id: "task-1", status: "succeeded" })] }),
      ),
    ).toBe(true);
  });

  it("builds duplicate-submit signatures from every generation input that changes output", () => {
    const payload = {
      prompt: "  prompt  ",
      size: "1024x1024",
      base_asset_ids: ["base-1", "ref-1", "ref-2"],
      base_asset_id: "base-1",
      selected_reference_asset_ids: ["ref-1", "ref-2"],
      generation_count: 2,
      tool_options: {
        quality: "high" as const,
        output_format: "png" as const,
      },
      resource_group_id: resourceGroup.id,
    };

    const signature = buildImageGenerationSubmitSignature(payload);
    expect(signature).toBe(
      buildImageGenerationSubmitSignature({
        ...payload,
        prompt: "prompt",
        tool_options: {
          output_format: "png",
          quality: "high",
        },
      }),
    );
    expect(signature).not.toBe(buildImageGenerationSubmitSignature({ ...payload, prompt: "changed" }));
    expect(signature).not.toBe(buildImageGenerationSubmitSignature({ ...payload, size: "1536x1024" }));
    expect(signature).not.toBe(buildImageGenerationSubmitSignature({ ...payload, base_asset_ids: ["base-1"] }));
    expect(signature).not.toBe(
      buildImageGenerationSubmitSignature({ ...payload, selected_reference_asset_ids: ["ref-2", "ref-1"] }),
    );
    expect(signature).not.toBe(buildImageGenerationSubmitSignature({ ...payload, generation_count: 3 }));
    expect(signature).not.toBe(
      buildImageGenerationSubmitSignature({ ...payload, tool_options: { quality: "low", output_format: "png" } }),
    );
    expect(signature).not.toBe(
      buildImageGenerationSubmitSignature({
        ...payload,
        generation_config_mode: "manual",
        generation_config_id: "config-1",
      }),
    );
    expect(signature).not.toBe(buildImageGenerationSubmitSignature({ ...payload, resource_group_id: "other-group" }));
    expect(signature).not.toBe(
      buildImageGenerationSubmitSignature({ ...payload, retry_generation_task_id: "failed-task-1" }),
    );
  });

  it("blocks identical duplicate submits only inside the short guard window", () => {
    const signature = buildImageGenerationSubmitSignature({
      prompt: "prompt",
      size: "1024x1024",
      base_asset_ids: [],
      base_asset_id: null,
      selected_reference_asset_ids: [],
      generation_count: 1,
      tool_options: null,
      resource_group_id: resourceGroup.id,
    });

    expect(shouldBlockDuplicateGenerationSubmit({ signature, submittedAt: 1_000 }, signature, 2_000, 1_800)).toBe(true);
    expect(shouldBlockDuplicateGenerationSubmit({ signature, submittedAt: 1_000 }, signature, 3_000, 1_800)).toBe(false);
    expect(shouldBlockDuplicateGenerationSubmit({ signature: "other", submittedAt: 1_000 }, signature, 1_200, 1_800)).toBe(
      false,
    );
  });

  it("parses image-chat session filters from workspace handoff search params", () => {
    expect(
      imageChatSessionFilterRouteStateFromSearchParams(
        new URLSearchParams("resource_group_id=group-1&owner_user_id=user-1&session_id=session-1&only_deleted=true"),
      ),
    ).toEqual({
      selectedSessionId: "session-1",
      selectedSessionResourceGroupId: "group-1",
      selectedSessionOwnerUserId: "user-1",
      onlyDeletedSessions: true,
    });
    expect(
      imageChatSessionFilterRouteStateFromSearchParams(new URLSearchParams("resource_group_id=&owner_user_id=user-1")),
    ).toEqual({
      selectedSessionId: null,
      selectedSessionResourceGroupId: null,
      selectedSessionOwnerUserId: "user-1",
      onlyDeletedSessions: false,
    });
    expect(imageChatSessionFilterRouteStateFromSearchParams(new URLSearchParams(""))).toBeNull();
  });

  it("uses the session group as the default resource group for a new round", () => {
    expect(
      imageSessionNewRoundDefaultResourceGroupId({
        sessionSummary: { latest_resource_group_id: "session-group" },
        imageSession: detail({
          generation_tasks: [task({ resource_group_id: "task-group" })],
          rounds: [round({ resource_group_id: "round-group" })],
        }),
      }),
    ).toBe("session-group");

    expect(
      imageSessionNewRoundDefaultResourceGroupId({
        sessionSummary: null,
        imageSession: detail({
          generation_tasks: [task({ resource_group_id: "task-group" })],
          rounds: [round({ resource_group_id: "round-group" })],
        }),
      }),
    ).toBe("task-group");
  });
});
