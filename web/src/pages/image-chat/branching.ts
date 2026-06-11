import type {
  ImageSessionDetail,
  ImageSessionGenerationTask,
  ImageSessionRound,
  ImageSessionSummary,
  ImageSessionStatus,
  ImageToolOptions,
  GenerationConfigSelectionMode,
} from "../../lib/types";
import { compactImageToolOptions, pruneSelectedReferenceIds } from "../../lib/imageToolOptions";

export { compactImageToolOptions, pruneSelectedReferenceIds };

export interface ImageRoundGroup {
  id: string;
  base_asset_ids: string[];
  base_asset_id: string | null;
  prompt: string;
  rounds: ImageSessionRound[];
}

export type ImageHistoryPlaceholderStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface ImageHistoryRoundCandidate {
  id: string;
  kind: "round";
  group_id: string;
  candidate_index: number;
  candidate_count: number;
  status: "succeeded";
  round: ImageSessionRound;
  prompt: string;
  size: string;
  base_asset_ids: string[];
  base_asset_id: string | null;
  provider_notes: string[];
  failure_reason: null;
  created_at: string;
}

export interface ImageHistoryPlaceholderCandidate {
  id: string;
  kind: "placeholder";
  group_id: string;
  task_id: string;
  candidate_index: number;
  candidate_count: number;
  status: ImageHistoryPlaceholderStatus;
  task_status: ImageSessionGenerationTask["status"];
  task: ImageSessionGenerationTask;
  prompt: string;
  size: string;
  base_asset_ids: string[];
  base_asset_id: string | null;
  provider_notes: string[];
  failure_reason: string | null;
  created_at: string;
}

export type ImageHistoryCandidate = ImageHistoryRoundCandidate | ImageHistoryPlaceholderCandidate;

export interface ImageHistoryBranch {
  id: string;
  base_asset_ids: string[];
  base_asset_id: string | null;
  parent_group_id: string | null;
  depth: number;
  branch_index: number | null;
  prompt: string;
  created_at: string;
  candidates: ImageHistoryCandidate[];
}

export interface ImageGenerationSubmitPayload {
  prompt: string;
  resource_group_id: string;
  size: string;
  base_asset_ids: string[];
  base_asset_id: string | null;
  selected_reference_asset_ids: string[];
  generation_count: number;
  tool_options?: ImageToolOptions | null;
  generation_config_mode?: GenerationConfigSelectionMode;
  generation_config_id?: string | null;
  retry_generation_task_id?: string | null;
}

export interface ImageGenerationSubmitGuard {
  signature: string;
  submittedAt: number;
}

export interface ImageGenerationRetryMetadata {
  last_failure_reason?: string;
  last_failure_category?: string;
  last_failure_retryable?: boolean;
  retry_hint?: "retry_later" | "revise_input" | "check_settings";
  auto_retry_attempt?: number;
  max_attempts?: number;
}

export interface ImageChatSessionFilterRouteState {
  selectedSessionId: string | null;
  selectedSessionResourceGroupId: string | null;
  selectedSessionOwnerUserId: string;
  onlyDeletedSessions: boolean;
}

export type LatestImageSessionGenerationState =
  | { status: "empty"; round: null; task: null }
  | { status: "active"; round: null; task: ImageSessionGenerationTask }
  | { status: "failed"; round: null; task: ImageSessionGenerationTask }
  | { status: "cancelled"; round: null; task: ImageSessionGenerationTask }
  | { status: "refreshing"; round: null; task: ImageSessionGenerationTask }
  | { status: "succeeded"; round: ImageSessionRound; task: null };

export interface ImageSessionSelectionState {
  selectedGeneratedAssetId: string | null;
  selectedTaskPlaceholderId: string | null;
  selectedBaseAssetIds: string[];
  pendingGeneratedRoundCount: number | null;
}

export interface ImageSessionSelectionReconciliationInput extends ImageSessionSelectionState {
  rounds: ImageSessionRound[];
  generationTasks: ImageSessionGenerationTask[];
  historyBranches: ImageHistoryBranch[];
  availableBaseAssetIds: string[];
  maxSelectedBaseCount: number;
}

export interface ImageSessionSelectionReconciliation extends ImageSessionSelectionState {
  generatedRoundCompleted: boolean;
}

const IMAGE_CHAT_GENERATION_COUNT_MAX = 10;
const IMAGE_CHAT_TASK_CANDIDATE_COUNT_MAX = 10;

export function imageChatSessionFilterRouteStateFromSearchParams(
  searchParams: URLSearchParams,
): ImageChatSessionFilterRouteState | null {
  const hasSessionResourceGroup = searchParams.has("resource_group_id");
  const hasSessionOwner = searchParams.has("owner_user_id");
  const hasSelectedSession = searchParams.has("session_id");
  const hasOnlyDeleted = searchParams.has("only_deleted");
  if (!hasSessionResourceGroup && !hasSessionOwner && !hasSelectedSession && !hasOnlyDeleted) {
    return null;
  }
  return {
    selectedSessionId: hasSelectedSession ? (searchParams.get("session_id") ?? "").trim() || null : null,
    selectedSessionResourceGroupId: hasSessionResourceGroup
      ? (searchParams.get("resource_group_id") ?? "").trim() || null
      : null,
    selectedSessionOwnerUserId: hasSessionOwner ? (searchParams.get("owner_user_id") ?? "").trim() : "",
    onlyDeletedSessions: hasOnlyDeleted && searchParams.get("only_deleted") === "true",
  };
}

export function imageSessionNewRoundDefaultResourceGroupId({
  sessionSummary,
  imageSession,
}: {
  sessionSummary?: Pick<ImageSessionSummary, "latest_resource_group_id"> | null;
  imageSession?: Pick<ImageSessionDetail, "rounds" | "generation_tasks"> | null;
}): string | null {
  return (
    sessionSummary?.latest_resource_group_id ||
    imageSession?.generation_tasks.find((task) => task.resource_group_id)?.resource_group_id ||
    imageSession?.rounds.at(-1)?.resource_group_id ||
    null
  );
}

export function uniqueImageAssetIds(ids: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    values.push(id);
  }
  return values;
}

export function addImageBaseAssetIds(
  currentIds: readonly string[],
  idsToAdd: readonly (string | null | undefined)[],
  maxCount: number,
): string[] {
  return uniqueImageAssetIds([...currentIds, ...idsToAdd]).slice(0, maxCount);
}

export function removeImageBaseAssetId(currentIds: readonly string[], assetId: string): string[] {
  return currentIds.filter((id) => id !== assetId);
}

export function imageGenerationBaseAssetIds(
  source: Pick<
    ImageSessionRound | ImageSessionGenerationTask,
    "base_asset_ids" | "base_asset_id" | "selected_reference_asset_ids"
  >,
): string[] {
  return source.base_asset_ids?.length
    ? uniqueImageAssetIds(source.base_asset_ids)
    : uniqueImageAssetIds([source.base_asset_id, ...source.selected_reference_asset_ids]);
}

export function legacyBaseAssetIdFromBaseAssetIds(baseAssetIds: readonly string[]): string | null {
  return baseAssetIds[0] ?? null;
}

export function groupImageSessionRounds(rounds: ImageSessionRound[]): ImageRoundGroup[] {
  const groups = new Map<string, ImageRoundGroup>();
  for (const round of rounds) {
    const groupId = round.generation_group_id ?? round.id;
    const existing = groups.get(groupId);
    if (existing) {
      existing.rounds.push(round);
      continue;
    }
    groups.set(groupId, {
      id: groupId,
      base_asset_ids: imageGenerationBaseAssetIds(round),
      base_asset_id: round.base_asset_id,
      prompt: round.prompt,
      rounds: [round],
    });
  }
  return [...groups.values()].map((group) => ({
    ...group,
    rounds: [...group.rounds].sort((a, b) => a.candidate_index - b.candidate_index),
  }));
}

function compareCreatedAt(left: string, right: string): number {
  return Date.parse(left) - Date.parse(right);
}

function taskGenerationEventAt(task: ImageSessionGenerationTask): string {
  return task.finished_at ?? task.progress_updated_at ?? task.started_at ?? task.created_at;
}

function getRoundGroupId(round: ImageSessionRound): string {
  return round.generation_group_id ?? round.id;
}

function getTaskGroupId(task: ImageSessionGenerationTask): string {
  return task.result_generation_group_id ?? `task:${task.id}`;
}

export function getImageGenerationTaskPlaceholderId(task: ImageSessionGenerationTask, candidateIndex: number): string {
  return `task:${task.id}:candidate:${candidateIndex}`;
}

function taskMatchesSubmitPayload(task: ImageSessionGenerationTask, payload: ImageGenerationSubmitPayload): boolean {
  return (
    buildImageGenerationSubmitSignature({
      prompt: task.prompt,
      size: task.size,
      base_asset_ids: imageGenerationBaseAssetIds(task),
      base_asset_id: task.base_asset_id,
      selected_reference_asset_ids: task.selected_reference_asset_ids,
      generation_count: task.generation_count,
      tool_options: task.tool_options,
      resource_group_id: task.resource_group_id ?? "",
      generation_config_mode: task.generation_config_mode,
      generation_config_id: task.requested_generation_config_id,
      retry_generation_task_id: payload.retry_generation_task_id === task.id ? task.id : null,
    }) === buildImageGenerationSubmitSignature(payload)
  );
}

export function selectImageGenerationTaskNextPlaceholderId(task: ImageSessionGenerationTask): string {
  const candidateIndex = Math.min(
    clampImageGenerationTaskCandidateCount(task.generation_count || 1),
    task.active_candidate_index ?? Math.max(1, task.completed_candidates + 1),
  );
  return getImageGenerationTaskPlaceholderId(task, candidateIndex);
}

export function imageGenerationTaskSubmitPayload(task: ImageSessionGenerationTask): ImageGenerationSubmitPayload {
  return {
    prompt: task.prompt,
    size: task.size,
    base_asset_ids: imageGenerationBaseAssetIds(task),
    base_asset_id: task.base_asset_id,
    selected_reference_asset_ids: task.selected_reference_asset_ids,
    generation_count: clampGenerationCount(task.generation_count),
    tool_options: task.tool_options,
    resource_group_id: task.resource_group_id ?? "",
    generation_config_mode: task.generation_config_mode,
    generation_config_id: task.requested_generation_config_id,
  };
}

export function selectSubmittedImageGenerationTaskPlaceholderId(
  tasks: ImageSessionGenerationTask[],
  payload: ImageGenerationSubmitPayload,
): string | null {
  const newestTasks = [...tasks].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
  const matchingTasks = newestTasks.filter((item) => taskMatchesSubmitPayload(item, payload));
  const task =
    matchingTasks.find(isImageSessionGenerationTaskActive) ??
    matchingTasks[0] ??
    newestTasks.find(isImageSessionGenerationTaskActive) ??
    newestTasks[0];
  return task ? selectImageGenerationTaskNextPlaceholderId(task) : null;
}

function getPlaceholderCandidateStatus(
  task: ImageSessionGenerationTask,
  candidateIndex: number,
): ImageHistoryPlaceholderStatus {
  if (task.status === "failed") {
    return "failed";
  }
  if (task.status === "cancelled") {
    return "cancelled";
  }
  if (task.status === "succeeded") {
    return "completed";
  }
  if (task.status === "queued") {
    return "queued";
  }
  if (candidateIndex <= task.completed_candidates) {
    return "completed";
  }
  return "running";
}

function sortCandidates(left: ImageHistoryCandidate, right: ImageHistoryCandidate): number {
  const indexDelta = left.candidate_index - right.candidate_index;
  if (indexDelta !== 0) {
    return indexDelta;
  }
  if (left.kind === right.kind) {
    return left.id.localeCompare(right.id);
  }
  return left.kind === "round" ? -1 : 1;
}

function sortBranches(branches: ImageHistoryBranch[]): ImageHistoryBranch[] {
  const childrenByParent = new Map<string | null, ImageHistoryBranch[]>();
  for (const branch of branches) {
    const siblings = childrenByParent.get(branch.parent_group_id) ?? [];
    siblings.push(branch);
    childrenByParent.set(branch.parent_group_id, siblings);
  }
  for (const siblings of childrenByParent.values()) {
    siblings.sort((left, right) => compareCreatedAt(left.created_at, right.created_at) || left.id.localeCompare(right.id));
  }

  const ordered: ImageHistoryBranch[] = [];
  const appendBranch = (branch: ImageHistoryBranch) => {
    ordered.push(branch);
    for (const child of childrenByParent.get(branch.id) ?? []) {
      appendBranch(child);
    }
  };
  for (const root of childrenByParent.get(null) ?? []) {
    appendBranch(root);
  }

  const orderedIds = new Set(ordered.map((branch) => branch.id));
  for (const branch of branches) {
    if (!orderedIds.has(branch.id)) {
      ordered.push(branch);
    }
  }
  return ordered;
}

export function buildImageSessionHistoryTree(
  rounds: ImageSessionRound[],
  tasks: ImageSessionGenerationTask[],
): ImageHistoryBranch[] {
  const branchesById = new Map<
    string,
    Omit<ImageHistoryBranch, "depth" | "branch_index" | "candidates"> & { candidates: ImageHistoryCandidate[] }
  >();
  const ensureBranch = (input: {
    id: string;
    base_asset_ids: string[];
    base_asset_id: string | null;
    prompt: string;
    created_at: string;
  }) => {
    const existing = branchesById.get(input.id);
    if (existing) {
      return existing;
    }
    const branch = {
      id: input.id,
      base_asset_ids: input.base_asset_ids,
      base_asset_id: input.base_asset_id,
      parent_group_id: null,
      prompt: input.prompt,
      created_at: input.created_at,
      candidates: [],
    };
    branchesById.set(input.id, branch);
    return branch;
  };

  for (const round of [...rounds].sort((left, right) => compareCreatedAt(left.created_at, right.created_at))) {
    const groupId = getRoundGroupId(round);
    const branch = ensureBranch({
      id: groupId,
      base_asset_ids: imageGenerationBaseAssetIds(round),
      base_asset_id: round.base_asset_id,
      prompt: round.prompt,
      created_at: round.created_at,
    });
    branch.candidates.push({
      id: round.generated_asset.id,
      kind: "round",
      group_id: groupId,
      candidate_index: round.candidate_index,
      candidate_count: round.candidate_count,
      status: "succeeded",
      round,
      prompt: round.prompt,
      size: round.size,
      base_asset_ids: imageGenerationBaseAssetIds(round),
      base_asset_id: round.base_asset_id,
      provider_notes: round.provider_notes,
      failure_reason: null,
      created_at: round.created_at,
    });
  }

  for (const task of [...tasks].sort((left, right) => compareCreatedAt(left.created_at, right.created_at))) {
    if (task.status === "succeeded" && !task.result_generation_group_id) {
      continue;
    }
    const groupId = getTaskGroupId(task);
    const branch = ensureBranch({
      id: groupId,
      base_asset_ids: imageGenerationBaseAssetIds(task),
      base_asset_id: task.base_asset_id,
      prompt: task.prompt,
      created_at: task.created_at,
    });
    const existingCandidateIndexes = new Set(
      branch.candidates
        .filter((candidate) => candidate.kind === "round")
        .map((candidate) => candidate.candidate_index),
    );
    const total = clampImageGenerationTaskCandidateCount(task.generation_count || 1);
    for (let candidateIndex = 1; candidateIndex <= total; candidateIndex += 1) {
      if (existingCandidateIndexes.has(candidateIndex)) {
        continue;
      }
      branch.candidates.push({
        id: getImageGenerationTaskPlaceholderId(task, candidateIndex),
        kind: "placeholder",
        group_id: groupId,
        task_id: task.id,
        candidate_index: candidateIndex,
        candidate_count: total,
        status: getPlaceholderCandidateStatus(task, candidateIndex),
        task_status: task.status,
        task,
        prompt: task.prompt,
        size: task.size,
        base_asset_ids: imageGenerationBaseAssetIds(task),
        base_asset_id: task.base_asset_id,
        provider_notes: task.provider_notes,
        failure_reason: task.failure_reason,
        created_at: task.created_at,
      });
    }
  }

  const branches = [...branchesById.entries()].map(([id, branch]) => ({
    ...branch,
    id,
    depth: 0,
    branch_index: null,
    candidates: [...branch.candidates].sort(sortCandidates),
  }));
  let nextBranchIndex = 1;
  return sortBranches(branches).map((branch, index) => ({
    ...branch,
    branch_index: index > 0 ? nextBranchIndex++ : null,
  }));
}

export function requiresImageSessionGenerationBase(
  rounds: ImageSessionRound[],
  tasks: ImageSessionGenerationTask[],
): boolean {
  void rounds;
  void tasks;
  return false;
}

export function findImageHistoryPlaceholder(
  branches: ImageHistoryBranch[],
  placeholderId: string | null,
): ImageHistoryPlaceholderCandidate | null {
  if (!placeholderId) {
    return null;
  }
  for (const branch of branches) {
    for (const candidate of branch.candidates) {
      if (candidate.kind === "placeholder" && candidate.id === placeholderId) {
        return candidate;
      }
    }
  }
  return null;
}

function parseImageGenerationTaskPlaceholderId(
  placeholderId: string | null,
): { taskId: string; candidateIndex: number } | null {
  const match = placeholderId?.match(/^task:([^:]+):candidate:(\d+)$/);
  if (!match) {
    return null;
  }
  const candidateIndex = Number(match[2]);
  if (!Number.isInteger(candidateIndex) || candidateIndex < 1) {
    return null;
  }
  return { taskId: match[1], candidateIndex };
}

export function findImageGenerationTaskPlaceholderRound(
  rounds: ImageSessionRound[],
  tasks: ImageSessionGenerationTask[],
  placeholderId: string | null,
): ImageSessionRound | null {
  const parsed = parseImageGenerationTaskPlaceholderId(placeholderId);
  if (!parsed) {
    return null;
  }
  const task = tasks.find((item) => item.id === parsed.taskId);
  if (!task?.result_generation_group_id) {
    return null;
  }
  return (
    rounds.find(
      (round) =>
        getRoundGroupId(round) === task.result_generation_group_id &&
        round.candidate_index === parsed.candidateIndex,
    ) ?? null
  );
}

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function latestGeneratedAssetId(rounds: ImageSessionRound[]): string | null {
  return rounds.at(-1)?.generated_asset.id ?? null;
}

function generatedAssetIds(rounds: ImageSessionRound[]): Set<string> {
  return new Set(rounds.map((round) => round.generated_asset.id));
}

export function reconcileImageSessionSelection({
  rounds,
  generationTasks,
  historyBranches,
  selectedGeneratedAssetId,
  selectedTaskPlaceholderId,
  selectedBaseAssetIds,
  availableBaseAssetIds,
  maxSelectedBaseCount,
  pendingGeneratedRoundCount,
}: ImageSessionSelectionReconciliationInput): ImageSessionSelectionReconciliation {
  const roundAssetIds = generatedAssetIds(rounds);
  const latestAssetId = latestGeneratedAssetId(rounds);
  const selectedPlaceholderStillExists = Boolean(
    selectedTaskPlaceholderId && findImageHistoryPlaceholder(historyBranches, selectedTaskPlaceholderId),
  );
  const selectedPlaceholderReplacementRound =
    selectedTaskPlaceholderId && !selectedPlaceholderStillExists
      ? findImageGenerationTaskPlaceholderRound(rounds, generationTasks, selectedTaskPlaceholderId)
      : null;
  const selectedPlaceholderWasReplaced = Boolean(selectedTaskPlaceholderId && !selectedPlaceholderStillExists);

  let nextSelectedGeneratedAssetId = selectedGeneratedAssetId;
  let nextSelectedTaskPlaceholderId = selectedTaskPlaceholderId;
  let nextPendingGeneratedRoundCount = pendingGeneratedRoundCount;
  let generatedRoundCompleted = false;

  if (selectedTaskPlaceholderId && !selectedPlaceholderStillExists) {
    nextSelectedTaskPlaceholderId = null;
    nextSelectedGeneratedAssetId = selectedPlaceholderReplacementRound?.generated_asset.id ?? latestAssetId;
  } else if (
    !selectedTaskPlaceholderId &&
    (!selectedGeneratedAssetId || !roundAssetIds.has(selectedGeneratedAssetId))
  ) {
    nextSelectedGeneratedAssetId = latestAssetId;
  }

  const availableBaseAssetIdSet = new Set(availableBaseAssetIds);
  const prunedBaseAssetIds = uniqueImageAssetIds(selectedBaseAssetIds)
    .filter((assetId) => availableBaseAssetIdSet.has(assetId))
    .slice(0, maxSelectedBaseCount);

  if (pendingGeneratedRoundCount !== null && rounds.length > pendingGeneratedRoundCount) {
    nextPendingGeneratedRoundCount = null;
    generatedRoundCompleted = true;
    if (!selectedTaskPlaceholderId || selectedPlaceholderWasReplaced) {
      nextSelectedTaskPlaceholderId = null;
      if (!selectedPlaceholderReplacementRound) {
        nextSelectedGeneratedAssetId = latestAssetId;
      }
    }
  }

  return {
    selectedGeneratedAssetId: nextSelectedGeneratedAssetId,
    selectedTaskPlaceholderId: nextSelectedTaskPlaceholderId,
    selectedBaseAssetIds: sameStringList(selectedBaseAssetIds, prunedBaseAssetIds)
      ? selectedBaseAssetIds
      : prunedBaseAssetIds,
    pendingGeneratedRoundCount: nextPendingGeneratedRoundCount,
    generatedRoundCompleted,
  };
}

export function clampGenerationCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(IMAGE_CHAT_GENERATION_COUNT_MAX, Math.max(1, Math.round(value)));
}

export function clampImageGenerationTaskCandidateCount(value: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(IMAGE_CHAT_TASK_CANDIDATE_COUNT_MAX, Math.max(1, Math.round(value)));
}

export function effectiveImageGenerationSubmitCount(
  generationCount: number,
  toolOptions: ImageToolOptions | null | undefined,
): number {
  void toolOptions;
  return clampGenerationCount(generationCount);
}

export function isImageSessionGenerationTaskActive(task: ImageSessionGenerationTask): boolean {
  return task.status === "queued" || task.status === "running";
}

export function isImageSessionGenerationTaskRetryable(task: ImageSessionGenerationTask): boolean {
  return task.status === "failed";
}

export function isImageSessionGenerationTaskRegeneratable(task: ImageSessionGenerationTask): boolean {
  void task;
  return false;
}

export function imageGenerationRetryMetadata(task: ImageSessionGenerationTask): ImageGenerationRetryMetadata | null {
  const metadata = task.progress_metadata;
  if (!metadata || typeof metadata !== "object") {
    return null;
  }
  const output: ImageGenerationRetryMetadata = {};
  if (typeof metadata.last_failure_reason === "string" && metadata.last_failure_reason.trim()) {
    output.last_failure_reason = metadata.last_failure_reason;
  }
  if (typeof metadata.last_failure_category === "string" && metadata.last_failure_category.trim()) {
    output.last_failure_category = metadata.last_failure_category;
  }
  if (typeof metadata.last_failure_retryable === "boolean") {
    output.last_failure_retryable = metadata.last_failure_retryable;
  }
  if (
    metadata.retry_hint === "retry_later" ||
    metadata.retry_hint === "revise_input" ||
    metadata.retry_hint === "check_settings"
  ) {
    output.retry_hint = metadata.retry_hint;
  }
  if (typeof metadata.auto_retry_attempt === "number" && Number.isFinite(metadata.auto_retry_attempt)) {
    output.auto_retry_attempt = metadata.auto_retry_attempt;
  }
  if (typeof metadata.max_attempts === "number" && Number.isFinite(metadata.max_attempts)) {
    output.max_attempts = metadata.max_attempts;
  }
  return Object.keys(output).length ? output : null;
}

export function isImageSessionGenerationTaskAutoRetrying(task: ImageSessionGenerationTask): boolean {
  return task.status === "queued" && task.progress_phase === "auto_retry_queued";
}

export function isImageSessionGenerationTaskCancelable(task: ImageSessionGenerationTask): boolean {
  return (task.status === "queued" || task.status === "running") && task.is_cancelable;
}

export function latestImageSessionGenerationState(
  rounds: ImageSessionRound[],
  tasks: ImageSessionGenerationTask[],
): LatestImageSessionGenerationState {
  const events: Array<
    | { status: "active" | "failed" | "cancelled" | "refreshing"; created_at: string; task: ImageSessionGenerationTask }
    | { status: "succeeded"; created_at: string; round: ImageSessionRound }
  > = [];

  for (const round of rounds) {
    events.push({ status: "succeeded", created_at: round.created_at, round });
  }
  for (const task of tasks) {
    if (task.status === "queued" || task.status === "running") {
      events.push({ status: "active", created_at: taskGenerationEventAt(task), task });
      continue;
    }
    if (task.status === "failed" || task.status === "cancelled") {
      events.push({ status: task.status, created_at: taskGenerationEventAt(task), task });
      continue;
    }
    if (task.status === "succeeded" && !task.result_generation_group_id) {
      events.push({ status: "refreshing", created_at: taskGenerationEventAt(task), task });
    }
  }

  const latest = events.sort((left, right) => {
    const createdAtDelta = Date.parse(right.created_at) - Date.parse(left.created_at);
    if (createdAtDelta !== 0) {
      return createdAtDelta;
    }
    return right.status.localeCompare(left.status);
  })[0];

  if (!latest) {
    return { status: "empty", round: null, task: null };
  }
  if (latest.status === "succeeded") {
    return { status: "succeeded", round: latest.round, task: null };
  }
  return { status: latest.status, round: null, task: latest.task };
}

export function isCurrentImageSessionGenerationTask(
  task: ImageSessionGenerationTask,
  rounds: ImageSessionRound[],
  tasks: ImageSessionGenerationTask[],
): boolean {
  return latestImageSessionGenerationState(rounds, tasks).task?.id === task.id;
}

export function mergeImageSessionStatusIntoDetail(
  detail: ImageSessionDetail,
  status: ImageSessionStatus,
): ImageSessionDetail {
  return {
    ...detail,
    title: status.title,
    updated_at: status.updated_at,
    generation_tasks: status.generation_tasks,
  };
}

export function shouldRefreshImageSessionDetailFromStatus(
  detail: ImageSessionDetail | undefined,
  status: ImageSessionStatus,
): boolean {
  if (!detail) {
    return false;
  }
  if (status.rounds_count > detail.rounds.length) {
    return true;
  }
  if (status.latest_round_id && !detail.rounds.some((round) => round.id === status.latest_round_id)) {
    return true;
  }
  const previousTasksById = new Map(detail.generation_tasks.map((task) => [task.id, task]));
  return status.generation_tasks.some((task) => {
    const previousTask = previousTasksById.get(task.id);
    return Boolean(previousTask && isImageSessionGenerationTaskActive(previousTask) && !isImageSessionGenerationTaskActive(task));
  });
}

function normalizeSubmitToolOptions(toolOptions: ImageToolOptions | null | undefined): Record<string, unknown> | null {
  if (!toolOptions) {
    return null;
  }
  const entries = Object.entries(toolOptions)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  return entries.length ? Object.fromEntries(entries) : null;
}

export function buildImageGenerationSubmitSignature(payload: ImageGenerationSubmitPayload): string {
  return JSON.stringify({
    prompt: payload.prompt.trim(),
    size: payload.size,
    base_asset_ids: payload.base_asset_ids,
    base_asset_id: payload.base_asset_id ?? null,
    selected_reference_asset_ids: payload.selected_reference_asset_ids,
    generation_count: effectiveImageGenerationSubmitCount(payload.generation_count, payload.tool_options),
    tool_options: normalizeSubmitToolOptions(payload.tool_options),
    resource_group_id: payload.resource_group_id,
    generation_config_mode: payload.generation_config_mode ?? "auto",
    generation_config_id: payload.generation_config_mode === "manual" ? (payload.generation_config_id ?? null) : null,
    retry_generation_task_id: payload.retry_generation_task_id ?? null,
  });
}

export function shouldBlockDuplicateGenerationSubmit(
  previous: ImageGenerationSubmitGuard | null,
  nextSignature: string,
  now: number,
  windowMs = 1800,
): boolean {
  if (!previous || previous.signature !== nextSignature) {
    return false;
  }
  return now - previous.submittedAt < windowMs;
}
