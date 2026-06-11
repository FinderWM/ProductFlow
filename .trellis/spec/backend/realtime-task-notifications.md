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
  - `workflow_run_notification_event(run: WorkflowRun)`
- Safe publishers:
  - `publish_image_session_generation_task_notification_safely(task)`
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
  - `event_id`: stable duplicate key including task kind, task id, status, and finished timestamp.
  - `task_kind`: `"image_session_generation"` or `"inspiration_workflow"`.
  - `task_id`: generation task id or workflow run id.
  - `owner_user_id`: owner account id for server-side broadcast filtering.
  - `status`: `"succeeded"`, `"failed"`, or `"cancelled"`.
  - `title`: image session title or inspiration name.
  - `failure_reason`: nullable user-facing failure reason.
  - `finished_at`: nullable ISO timestamp.
  - `resource_id`: image session id or inspiration id.
- Frontend must ignore unknown event types, task kinds, and statuses. `cancelled` does not create a popup notification.

### 4. Validation & Error Matrix

- Missing session cookie -> WebSocket closes without registering a connection.
- Disabled or archived user -> WebSocket closes without registering a connection.
- Redis unavailable during publish -> task remains terminal; backend logs the publish failure.
- Redis listener unavailable in API process -> app startup must continue; listener retries asynchronously.
- Event owner has no open sockets -> broadcast is a no-op.
- Event owner has multiple open sockets -> each socket receives the same JSON message.
- Event for user A while user B is connected -> user B receives nothing.
- Duplicate event or page-poll fallback for the same task/status -> frontend dedupe prevents duplicate visible popups.

### 5. Good/Base/Bad Cases

- Good: a continuous image task succeeds in a worker; the worker commits `succeeded`, publishes Redis event, API process
  broadcasts to the owner, and the frontend top-right notification appears on any route.
- Good: a workflow run fails after node execution; the failure reason is included and the frontend error notification does
  not auto-close.
- Base: page-local lightweight status polling still updates detailed task progress and may remain as a fallback source.
- Bad: a route page opens its own per-page WebSocket for task results; global notifications belong in the app shell bridge.
- Bad: worker publishes before commit; consumers may announce a result that later rolls back.
- Bad: API process uses an in-memory queue for worker messages; worker and API may run in separate processes.

### 6. Tests Required

- Backend unit tests for event JSON round-trip and rejection of unknown payloads.
- Backend unit tests for image-session task and workflow-run event construction from ORM rows.
- Backend async unit test for `TaskNotificationConnectionManager.broadcast(...)` filtering by `owner_user_id`.
- Backend route/RBAC contract test must still pass; WebSocket route auth is session-cookie based.
- Frontend unit tests for WebSocket event parsing, event-to-notification mapping, failed workflow notification, and
  cancelled-event no-op behavior.
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
