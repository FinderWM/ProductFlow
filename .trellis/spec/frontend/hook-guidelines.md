# Frontend Hook Guidelines

> How React hooks and TanStack Query are currently used in ProductFlow.

---

## Overview

There are no custom hook modules in `web/src/` today. Hooks are used directly inside page components and `AppRoutes()`.
Server state uses TanStack Query; local UI/form state uses React's built-in hooks.

Real hook-heavy files:

- `web/src/App.tsx`
- `web/src/pages/InspirationListPage.tsx`
- `web/src/pages/InspirationDetailPage.tsx`
- `web/src/pages/ImageChatPage.tsx`
- `web/src/pages/SettingsPage.tsx`

---

## Server State Hooks

Use `useQuery` for reads and `useMutation` for writes. Query keys are small arrays of stable values:

```tsx
const inspirationQuery = useQuery({
  queryKey: ["inspiration", inspirationId],
  queryFn: () => api.getProduct(inspirationId),
  enabled: Boolean(inspirationId),
});
```

Examples:

- `App.tsx` uses `['session']` for `api.getSessionState` with `retry: false`.
- `InspirationListPage.tsx` uses `['inspirations']` for `api.listProducts`.
- `InspirationDetailPage.tsx` uses `['inspiration', inspirationId]`, `['inspiration-history', inspirationId]`,
  `['inspiration-workflow', inspirationId]`, `['inspiration-workflow-status', inspirationId]`, and `['runtime-config']`.
- `ImageChatPage.tsx` uses `['image-sessions', inspirationId ?? 'standalone']`, `['image-session', selectedSessionId]`,
  `['image-session-status', selectedSessionId]`, `['config']`, and inspiration queries.
- `SettingsPage.tsx` uses `['config']` for runtime settings.

Use `enabled` when an ID is required. Do not call an API with an empty ID just because a route param has not loaded.

---

## Mutations and Cache Updates

Use `useMutation` for writes and update/invalidate TanStack Query caches in `onSuccess`:

- Logout mutations invalidate `['session']` and navigate to `/login`.
- Inspiration/detail mutations invalidate `['inspiration', inspirationId]`, `['inspiration-history', inspirationId]`, and/or `['inspirations']`.
- Image session mutations often call `queryClient.setQueryData(['image-session', id], updated)` and invalidate the session
  list.
- Settings save/reset mutations update `['config']` with `queryClient.setQueryData(...)`.

Keep cache keys consistent with the page that reads them. If a mutation changes list and detail data, invalidate both.

---

## Polling Pattern

Long-running inspiration workflow and continuous image-session tasks are polled through their owning status/detail queries.
Polling must stop when no durable run/task is still `queued` or `running`:

```tsx
refetchInterval: (query) => {
  const data = query.state.data as InspirationWorkflowStatus | undefined;
  if (!data || hasActiveWorkflow(data)) {
    return 1000;
  }
  return false;
}
```

Keep workflow polling status-specific: use the lightweight workflow status DTO and derive active state from queued/running
nodes or running workflow runs.

## Scenario: ImageChat active-task lightweight status polling

### 1. Scope / Trigger

- Trigger: changing `ImageChatPage` generation polling, image-session API DTOs, or continuous image task visibility.
- Goal: active task status updates should be lightweight while full generated history remains loaded through the detail
  query.

### 2. Signatures

- Full detail query key: `['image-session', selectedSessionId]` -> `api.getImageSession(sessionId)`.
- Lightweight status query key: `['image-session-status', selectedSessionId]` ->
  `api.getImageSessionStatus(sessionId)`.
- Backend status fields used by the page: `rounds_count`, `latest_round_id`, `has_active_generation_task`,
  `generation_tasks`, `updated_at`, and `title`.
- Generate submit payload includes `retry_generation_task_id?: string | null`. It is set only when the user restored the
  current latest failed task's configuration and confirms generation from that restored draft.

### 3. Contracts

- Do not put `refetchInterval` on the full `['image-session', selectedSessionId]` query for active generation.
- Enable the status query only when the cached full detail has an active queued/running generation task.
- Each status response should merge `title`, `updated_at`, and `generation_tasks` into the cached full detail so task
  cards, queue position, failure reason, provider notes, and history placeholders stay current.
- Active `generation_tasks` must not be used as a session-wide submit lock. The submit button may be disabled while the
  current mutation is pending, but queued/running tasks in the same session still allow a changed prompt, size, branch
  base image, reference selection, generation count, or tool-options payload to submit immediately.
- Failed ImageChat generation-task placeholders should expose manual retry whenever `task.status === "failed"`. Do not
  hide the retry action based on `task.is_retryable`; backend failure classification only controls automatic retry, while
  manual retry reuses the saved task payload so users do not rebuild prompt, size, references, group, or tool options.
- Restored failed-task drafts must submit through `POST /api/image-sessions/{id}/generate` with the original task id in
  `retry_generation_task_id`. The page must not call the legacy retry endpoint from this flow, and it must not allow a
  restored retry draft to degrade into a new task if the hidden task id is missing.
- The new-round action is available when the latest generation state is succeeded or failed. For a failed latest state,
  new-round creates a new task and does not pass `retry_generation_task_id`; restore/retry is the separate action that
  updates the failed task.
- Only the latest failed generation state exposes restore/retry. Historical failed tasks must remain visible but
  non-actionable.
- Accidental duplicate prevention for ImageChat is a short local guard keyed by prompt, size, branch base image, selected
  references, generation count, normalized tool options, generation config selection, resource group, and
  `retry_generation_task_id`. It blocks only very-short-window identical payload repeats.
- When status shows a new round count/latest round or a task changes from active to terminal, invalidate/refetch the full
  detail query once so generated candidates/history appear.
- Keep write mutations authoritative: create/update/upload/delete/generate handlers may still set full detail cache from
  mutation responses and invalidate the session list.
- Keep ImageChat selection reconciliation out of long page effects. Selection state that depends on fetched rounds,
  task-derived placeholders, selected generated assets, branch base images, reference uploads, and pending round counts
  belongs in a page-local pure helper such as `image-chat/branching.ts::reconcileImageSessionSelection(...)`; the page
  effect should only apply the helper result and set user-facing success/error messages.

### 4. Validation & Error Matrix

- No selected session -> status query disabled.
- Full detail has no active generation task -> status query disabled; do not poll.
- Status still active -> merge task status only, no full detail refetch.
- Status terminal or new latest round -> invalidate `['image-session', selectedSessionId]` and the session list key.
- Status API error -> normal React Query error state; do not clear existing full detail cache only because a status poll
  failed.
- Failed task with `is_retryable=false` from older cache/API data -> still render manual retry because `failed` is the
  user-action contract for ImageChat generation tasks.
- Restored retry draft with a missing hidden task id -> show the current-failed-round recovery message and do not submit.
- Historical failed task selected while a newer failure, active task, or successful round is latest -> show the history
  locked message and do not restore that task.
- Latest failed task + user chooses new round -> open a new-round draft. If no successful round exists yet, submit without
  a base image; if a successful round exists, preselect the latest available generated image as the base.
- Latest successful round -> retry/restore is unavailable; user uses the new-round action before submitting another
  generated result.
- Selected task placeholder no longer exists because the generated round arrived -> select the matching generated round
  when possible; otherwise fall back to the latest generated asset.
- Selected generated asset or branch base no longer exists -> clear or fall back through the selection reconciliation
  helper, not through ad hoc page-level branches.
- Uploaded/deleted reference images change the available id set -> prune selected reference ids through the shared helper
  and preserve valid order.

### 5. Good/Base/Bad Cases

- Good: active task updates the visible queue position every 1500ms without refetching every historical round and asset.
- Good: one queued/running task is visible in the history tree while a different payload can be submitted immediately.
- Good: a failed task that stopped automatic retry because of provider policy or parameter rejection still shows the same
  restore button and then submits `retry_generation_task_id` through `api.generateImageSessionRound(...)` after user
  confirmation.
- Good: a latest failed first round still enables "new round"; the resulting submit omits `retry_generation_task_id` and
  creates a separate task.
- Good: a failed task with partial candidates keeps the same task placeholder and result group; restored submission fills
  remaining candidates into that same round group.
- Base: a task failure appears in the task card, then full detail is refetched once.
- Bad: status polling replaces the detail cache with a partial object missing `assets` or `rounds`.
- Bad: broadening this ImageChat status query to InspirationDetail workflow polling without a separate workflow DTO.
- Bad: disabling ImageChat submission solely because `has_active_generation_task` is true.
- Bad: treating `ImageSessionGenerationTask.is_retryable=false` as a reason to hide the failed-task manual retry button.
- Bad: restored failed-task configuration calls `api.retryImageSessionGenerationTask(...)` immediately, because the user
  cannot review or adjust the saved settings before resubmission.
- Bad: restored failed-task configuration omits `retry_generation_task_id`, because the backend creates a new task/round
  instead of updating the current failed round.
- Bad: latest failed state disables the new-round button; users must be able to abandon the failed round without
  overwriting it.

### 6. Tests Required

- Pure helper tests for active-task detection.
- Pure helper tests for merging status into cached detail without replacing `assets` or `rounds`.
- Pure helper tests for deciding when status requires a full detail refresh.
- Pure helper tests for task-derived history placeholders/tree structure and the short duplicate-submit guard.
- Pure helper tests for failed-task retry visibility ignoring `is_retryable`.
- Pure helper tests for latest generation state so only the current failed task is retry-actionable.
- Pure helper tests for duplicate-submit signatures including `retry_generation_task_id`.
- Pure helper tests for ImageChat selection reconciliation: placeholder-to-round replacement, selected asset fallback,
  branch base cleanup, reference selection pruning, and pending generation completion.
- Run `pnpm --dir web lint`, `pnpm --dir web test:run`, and `just web-build`.

### 7. Wrong vs Correct

Wrong:

```tsx
useQuery({ queryKey: ["image-session", id], refetchInterval: 1500 });
```

Correct:

```tsx
useQuery({ queryKey: ["image-session-status", id], refetchInterval: 1500 });
```

Wrong:

```tsx
api.generateImageSessionRound(sessionId, imageGenerationTaskSubmitPayload(failedTask));
```

Correct:

```tsx
api.generateImageSessionRound(sessionId, {
  ...imageGenerationTaskSubmitPayload(failedTask),
  retry_generation_task_id: failedTask.id,
});
```

## Scenario: InspirationDetail active-workflow lightweight status polling

### 1. Scope / Trigger

- Trigger: changing `InspirationDetailPage` workflow polling, inspiration-workflow API DTOs, or active workflow status visibility.
- Goal: active workflow polling should be lightweight while full DAG structure and artifacts remain loaded through the
  workflow detail query.

### 2. Signatures

- Full workflow query key: `['inspiration-workflow', inspirationId]` -> `api.getInspirationWorkflow(inspirationId)`.
- Lightweight status query key: `['inspiration-workflow-status', inspirationId]` ->
  `api.getInspirationWorkflowStatus(inspirationId)`.
- Backend status fields used by the page: `has_active_workflow`, node `status` / `failure_reason` / `last_run_at`,
  run `status` / `failure_reason` / `finished_at`, node-run status fields, and workflow `updated_at`.

### 3. Contracts

- Do not put active-run `refetchInterval` on the full `['inspiration-workflow', inspirationId]` query.
- Enable the status query only when the cached full workflow has a running run or queued/running node.
- Each status response may merge only workflow/node/run status metadata into the cached full workflow. It must not replace
  `edges`, node `config_json`, node `output_json`, or node-run artifact fields such as `output_json`, `copy_set_id`,
  `poster_variant_id`, and `image_session_asset_id`.
- When status shows an active workflow becoming terminal, invalidate/refetch the full workflow once and let the existing
  active-to-inactive path refresh `['inspiration', inspirationId]`, `['inspiration-history', inspirationId]`, and `['inspirations']`.
- Keep write mutations authoritative: node/edge/update/run handlers may still set the full workflow cache from mutation
  responses and refresh inspiration artifact queries.

### 4. Validation & Error Matrix

- No inspiration id -> status query disabled.
- Full workflow has no active run/node -> status query disabled; do not poll.
- Status still active -> merge status metadata only, no full workflow refetch.
- Status terminal -> merge terminal status, invalidate `['inspiration-workflow', inspirationId]`, and refresh artifact-bearing
  inspiration queries through the workflow active-to-inactive transition.
- Status API error -> normal React Query error state; do not clear existing full workflow cache only because a status poll
  failed.

### 5. Good/Base/Bad Cases

- Good: active workflow updates node/run status every 1200ms without refetching all edges, node config/output JSON, and
  artifact-bearing run payloads.
- Base: a failed node shows the failure reason promptly, then full workflow and inspiration artifacts refetch once.
- Bad: status polling replaces the detail cache with a partial object missing `edges` or node `config_json`.
- Bad: workflow terminal status refreshes only `['inspiration-workflow', inspirationId]` and leaves inspiration detail/history/list
  artifact surfaces stale.

### 6. Tests Required

- Pure helper tests for status active detection.
- Pure helper tests for merging status into cached workflow without replacing structure or artifact fields.
- Pure helper tests for deciding when status requires a full workflow refresh.
- Run `pnpm --dir web lint`, `pnpm --dir web test:run`, and `just web-build`.

### 7. Wrong vs Correct

Wrong:

```tsx
useQuery({ queryKey: ["inspiration-workflow", inspirationId], refetchInterval: 1200 });
```

Correct:

```tsx
useQuery({ queryKey: ["inspiration-workflow-status", inspirationId], refetchInterval: 1200 });
```

---

## Local State and Derived State

Use `useState` for local form/UI state:

- `InspirationCreatePage.tsx`: inspiration form fields, selected file(s), error text.
- `InspirationDetailPage.tsx`: copy editing state, selected workbench/canvas state, error text.
- `ImageChatPage.tsx`: selected session/asset IDs, draft prompt, size, rename mode, target inspiration, messages.
- `SettingsPage.tsx`: draft config values, touched secret keys, resetting key, saved/error messages.

Use `useMemo` for derived values that depend on fetched data or local state:

- `InspirationDetailPage.tsx` derives `workingCopy`.
- `ImageChatPage.tsx` derives allowed size options, selected round, source image, and reference images.
- `SettingsPage.tsx` groups config items by category.

Use `useEffect` for synchronization side effects, not for deriving values that can be calculated during render. Current
examples include auth redirects in `LoginPage.tsx`, workflow status completion invalidation in
`InspirationDetailPage.tsx`, and draft reset from fetched config in `SettingsPage.tsx`.

---

## Custom Hooks

Custom hooks should stay rare and intentional. For cross-page/shared behavior, extract a hook only when at least two
pages/components need the same behavior. Follow React naming rules (`useSomething`) and keep API calls typed through
`web/src/lib/api.ts`.

### Page-local controller hooks

An oversized route page may extract a page-local controller hook or controller component under that page's local directory
even before there is cross-page reuse, when the extraction isolates a cohesive browser interaction boundary and materially
reduces route complexity. For InspirationDetail-style workbench interactions, keep the boundary page-local (for example
`web/src/pages/inspiration-detail/WorkflowCanvas.tsx`, or a page-local hook when no component boundary is involved) and pass
API/cache work in as callbacks instead of hiding TanStack Query mutations inside the controller.

Correct:

```tsx
<WorkflowCanvas
  workflow={workflow}
  onNodePositionCommit={(input) => updateNodePositionMutation.mutate(input)}
  onConnectionCreate={(input) => createEdgeMutation.mutate(input)}
/>
```

Wrong:

```tsx
function useWorkflowCanvas(inspirationId: string) {
  return useMutation({ mutationFn: () => api.createWorkflowEdge(inspirationId, input) });
}
```

Likely future extraction candidates, if duplication grows:

- session/logout behavior shared by `InspirationListPage.tsx`, `ImageChatPage.tsx`, and `SettingsPage.tsx`.
- workflow status polling behavior from `InspirationDetailPage.tsx`.
- config draft handling from `SettingsPage.tsx`.

Do not create a `hooks/` directory for one-off logic that is still page-specific.

---

## Avoid

- Calling hooks conditionally or after early returns. Keep hooks at the top of component functions.
- Using `useEffect` to mirror fetched data into local state unless the user can edit that local draft (`SettingsPage.tsx`
  is an example where mirroring is intentional).
- Forgetting `enabled` for queries that require route params or selected IDs.
- Invalidating only detail cache when a mutation also affects list summaries.
- Adding custom hooks that hide query keys or API behavior before there is real reuse.
