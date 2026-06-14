# Realtime Task Notifications

## Scenario: WebSocket Task-Result Notifications

### 1. Scope / Trigger

- Trigger: adding or changing global task-result notifications for durable generation work.
- Applies to backend task terminal-state publishers, Redis pub/sub wiring, `/api/task-notifications/ws`, and frontend
  consumers of the task notification event payload.
- Use this contract for result notifications that must be visible outside the page that owns the task's detail/status
  query.

### 2. Signatures

- Redis channel: `inspiration-one:task-notifications`.
- WebSocket route: `GET /api/task-notifications/ws` as a WebSocket upgrade.
- Backend event type: `TaskNotificationEvent`.
- Event builders:
  - `image_session_generation_task_notification_event(task: ImageSessionGenerationTask)`
  - `image_session_generation_attempt_failed_notification_event(task, *, reason, attempt, max_attempts)`
  - `workflow_run_notification_event(run: WorkflowRun)`
- Safe publishers:
  - `publish_image_session_generation_task_notification_safely(task)`
  - `publish_image_session_generation_attempt_failed_notification_safely(task, *, reason, attempt, max_attempts)`
  - `publish_workflow_run_notification_safely(run)`
- Frontend DTO mirror: `TaskNotificationEvent` in `web/src/lib/types.ts`.

### 3. Contracts

- WebSocket authentication reuses the signed session cookie. Anonymous, archived, disabled, or missing users are closed
  with policy-violation semantics.
- Worker/API cross-process delivery uses Redis pub/sub, not process-local memory.
- Publish only after the authoritative DB transaction has committed. Publish failures are logged and must not change task
  status persistence.
- WebSocket broadcast filters by `event.owner_user_id`; admin users do not receive other users' task notifications unless
  they own the task.
- Event payload fields:
  - `type`: always `"task_notification"`.
  - `event_id`: stable duplicate key. Terminal events include task kind, task id, status, and finished timestamp.
    `attempt_failed` events include task kind, task id, status, and attempt number.
  - `task_kind`: `"image_session_generation"` or `"inspiration_workflow"`.
  - `task_id`: generation task id or workflow run id.
  - `owner_user_id`: owner account id for server-side broadcast filtering.
  - `status`: `"succeeded"`, `"failed"`, `"cancelled"`, or `"attempt_failed"`.
  - `title`: image session title or inspiration name.
  - `failure_reason`: nullable user-facing failure reason.
  - `finished_at`: nullable ISO timestamp.
  - `resource_id`: image session id or inspiration id.
  - `generation_config_id`: nullable failed/used generation config id.
  - `generation_config_name`: nullable failed/used generation config display name.
  - `resource_group_id`: nullable resource group id.
  - `resource_group_name`: nullable resource group display name.
  - `attempt`: nullable failed attempt number.
  - `max_attempts`: nullable automatic retry attempt limit.
  - `next_attempt`: nullable next attempt number for `attempt_failed`.
  - `node_id`: nullable failed workflow node id.
  - `node_title`: nullable failed workflow node title.
- `attempt_failed` is non-terminal: the current image generation attempt failed, the durable task has already been reset
  to continue retrying, and a later `succeeded` or terminal `failed` event may still arrive for the same task.
- Continuous image generation publishes `attempt_failed` only after the transaction that records
  `progress_phase="auto_retry_queued"` and retry metadata commits. It does not publish before resetting the row.
- Terminal `failed` events keep terminal semantics and must not be used for automatic retry attempts that are still
  continuing.
- Event builders should resolve generation config and resource group names from the active ORM session when possible and
  fall back to ids/null when the names are unavailable.
- Workflow failure notifications should include best-effort failed-node context: prefer a failed `WorkflowNodeRun` whose
  failure reason is not `"上游节点失败"`, include `node_id`/`node_title`, and derive generation config/resource group from
  node-run output or manual node config when available.
- Frontend must ignore unknown event types, task kinds, and statuses. `cancelled` does not create a popup notification.
- Frontend WebSocket dedupe keys must distinguish repeated `attempt_failed` events by attempt number. Polling fallback
  should still dedupe terminal task/status transitions and must not synthesize `attempt_failed` from status polling because
  retry metadata can be observed repeatedly.

### 4. Validation & Error Matrix

- Missing session cookie -> WebSocket closes without registering a connection.
- Disabled or archived user -> WebSocket closes without registering a connection.
- Redis unavailable during publish -> task remains terminal; backend logs the publish failure.
- Redis listener unavailable in API process -> app startup must continue; listener retries asynchronously.
- Unknown `status` in backend or frontend parser -> event is rejected/ignored.
- Event owner has no open sockets -> broadcast is a no-op.
- Event owner has multiple open sockets -> each socket receives the same JSON message.
- Event for user A while user B is connected -> user B receives nothing.
- Duplicate event or page-poll fallback for the same task/status -> frontend dedupe prevents duplicate visible popups.
- Continuous image provider failure with remaining retry attempts -> publish one `attempt_failed` warning event with
  `attempt`, `max_attempts`, optional `next_attempt`, and `failure_reason`; task remains queued/running later.
- Continuous image final failure after retries are exhausted -> publish terminal `failed` event with the final
  `failure_reason` and generation context.

### 5. Good/Base/Bad Cases

- Good: a continuous image task succeeds in a worker; the worker commits `succeeded`, publishes Redis event, API process
  broadcasts to the owner, and the frontend top-right notification appears on any route.
- Good: a workflow run fails after node execution; the failure reason is included and the frontend error notification does
  not auto-close.
- Good: a continuous image task fails on attempt 1 of 3, commits `auto_retry_queued`, publishes `attempt_failed` with
  `attempt=1`, `max_attempts=3`, and the frontend shows a warning without suppressing a later success/failure popup.
- Good: a workflow run fails inside a node; the event includes the inspiration title plus best-effort node and generation
  config/resource group context.
- Base: page-local lightweight status polling still updates detailed task progress and may remain as a fallback source.
- Bad: a route page opens its own per-page WebSocket for task results; global notifications belong in the app shell bridge.
- Bad: worker publishes before commit; consumers may announce a result that later rolls back.
- Bad: an automatic retry failure is published as terminal `status="failed"` while the same durable task is still queued.
- Bad: API process uses an in-memory queue for worker messages; worker and API may run in separate processes.

### 6. Tests Required

- Backend unit tests for event JSON round-trip and rejection of unknown payloads.
- Backend unit tests for `attempt_failed` JSON round-trip and rejection of unknown statuses.
- Backend unit tests for image-session task, image-session attempt-failed, and workflow-run event construction from ORM
  rows, including generation config/resource group and failed-node context.
- Backend unit tests for automatic image retry publishing the attempt-failed safe publisher after retry metadata is
  persisted.
- Backend async unit test for `TaskNotificationConnectionManager.broadcast(...)` filtering by `owner_user_id`.
- Backend route/RBAC contract test must still pass; WebSocket route auth is session-cookie based.
- Frontend unit tests for WebSocket event parsing, `attempt_failed` warning notification mapping, failed workflow context
  notification, terminal dedupe behavior, and cancelled-event no-op behavior.
- Frontend build/type-check must pass because the WebSocket DTO is mirrored in `web/src/lib/types.ts`.

### 7. Wrong vs Correct

Wrong:

```python
session.commit()
for websocket in GLOBAL_CONNECTIONS:
    await websocket.send_text(payload)
```

Correct:

```python
session.commit()
publish_workflow_run_notification_safely(run)
```

Wrong:

```tsx
if (event.status === "cancelled") {
  notify({ title: "Cancelled", body: event.title });
}
```

Correct:

```tsx
const notification = buildTaskNotificationEventNotification(event, t);
if (notification) {
  notify(notification);
}
```

Wrong:

```python
_finish_image_generation_task(session, task=task, status=JobStatus.FAILED, failure_reason=reason, is_retryable=True)
enqueue_image_session_generation_task(task.id)
```

Correct:

```python
_reset_image_generation_task_for_retry(session, task=task, progress_phase="auto_retry_queued", progress_metadata=metadata)
publish_image_session_generation_attempt_failed_notification_safely(
    task,
    reason=reason,
    attempt=failed_attempt,
    max_attempts=IMAGE_SESSION_GENERATION_MAX_ATTEMPTS,
)
enqueue_image_session_generation_task(task.id)
```
