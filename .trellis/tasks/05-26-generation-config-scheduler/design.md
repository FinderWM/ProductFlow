# 生成配置池调度与状态重构 - Design

## Current Facts

- `ProviderProfile` already stores supplier connection data and capabilities.
- `ProviderBinding` currently has one unique row per purpose, so text/image generation are single active bindings.
- Existing queue admission controls global generation concurrency, not per generation config concurrency.
- Image session tasks and workflow node runs do not currently persist the selected generation config.
- Settings export/import currently exports provider profiles and provider bindings.

## Target Model

### Tables

`generation_configs`

- `id`
- `purpose`: `text` or `image`
- `name`
- `provider_kind`
- `provider_profile_id`
- `model_settings_json`
- `config_json`
- `priority`
- `max_concurrency`
- `enabled`
- `availability_window_minutes`
- `failure_threshold`
- `cooldown_minutes`
- `archived_at`
- timestamps

`generation_config_states`

- `generation_config_id`
- `current_concurrency`
- `frozen_until`
- `failure_window_started_at`
- `failure_count_in_window`
- `last_used_at`
- `last_success_at`
- `last_failure_at`
- `last_failure_reason`
- timestamps

`generation_config_daily_stats`

- `generation_config_id`
- `stat_date`
- `attempt_count`
- `success_count`
- `failure_count`
- `timeout_count`
- `throttled_count`
- `generated_unit_count`
- `total_latency_ms`
- `freeze_count`
- `last_success_at`
- `last_failure_at`

Unique key: `(generation_config_id, stat_date)`.

`stat_date` uses the current running machine timezone's local calendar date. Do not add a separate env-only timezone
setting for daily stats. Backend responses should expose the stored date, and the frontend should display backend-provided
date buckets instead of recalculating buckets.

Optional audit table: `generation_config_usage_events`.

- Useful for troubleshooting and provider traceability.
- Not used by status page aggregate queries.
- Can be deferred if implementation size is too high.

### Runtime Config

All scheduler timing and threshold defaults are runtime settings exposed in settings UI, not env-only settings:

- default availability window minutes
- default failure threshold
- default cooldown minutes
- capacity retry delay seconds/minutes if currently hard-coded and user-facing enough to configure

Per-config values override runtime defaults when set. New configs use runtime defaults.

## Scheduler

### Automatic Selection

1. Build candidate configs by purpose and requested provider kind compatibility.
2. Exclude configs that are disabled, archived, profile-disabled, capability-incompatible, frozen, or at max concurrency.
3. Score each candidate:

```text
score =
  priority_score * 0.50 +
  availability_score * 0.30 +
  capacity_score * 0.15 +
  latency_score * 0.05
```

- `priority_score`: normalized priority where a higher priority means preferred scheduling.
- `availability_score`: recent-window success ratio with smoothing so new configs are not unfairly penalized.
- `capacity_score`: `(max_concurrency - current_concurrency) / max_concurrency`.
- `latency_score`: lower average latency receives a slightly higher score. First implementation can use daily average.

4. Attempt atomic claim of the highest score candidate.
5. If claim fails because another worker took capacity first, retry the next candidate.
6. If no claim succeeds due to capacity/freeze only, keep task queued and requeue after the nearest useful retry time.
7. If no configured candidate exists, fail with a configuration error.

### Manual Selection

- Manual selection bypasses scoring and targets the selected config id.
- It still requires enabled, not archived, profile usable, capability-compatible, not frozen, and below max concurrency.
- If selected config is at capacity, the task remains queued for that config.
- If selected config is frozen, the task remains queued until `frozen_until`.
- If selected config is disabled, archived, deleted, or incompatible, the task fails with a user-actionable configuration error.
- Automatic scheduling should avoid or heavily down-rank a config that has queued manual tasks waiting for that same config.

### Atomic Concurrency

Use a database conditional update on `generation_config_states`:

```text
current_concurrency < max_concurrency
and (frozen_until is null or frozen_until <= now)
```

Only after the update succeeds may the provider call begin. Provider completion always releases concurrency in success and failure paths.

### Failure and Freezing

Only real provider execution failures count toward freeze windows:

- provider SDK exceptions
- provider HTTP errors
- provider timeout
- provider-level blocked/throttled responses

Do not count:

- invalid user input
- missing workflow references
- queue delivery failure before provider execution
- user cancellation
- product/workflow validation errors

On counted failure:

1. Update today's `generation_config_daily_stats`.
2. Update `generation_config_states`.
3. If the current failure window is expired, start a new window.
4. If failure count reaches threshold, set `frozen_until = now + cooldown_minutes`, increment daily `freeze_count`, and reset/close the failure window.

Frozen configs do not need a background unfreeze job. Scheduler and status serialization treat `frozen_until <= now` as thawed.

## API Contracts

Settings API should expose:

- provider profiles
- generation configs grouped by purpose
- config state and today stats for cards
- status tab summary
- create/update/archive/reorder endpoints
- manual sort refresh endpoint or deterministic server-side ordering response

Status page API:

- `GET /api/settings/generation-config-status`
- Requires the same secondary settings unlock as settings configuration APIs.
- Optional query parameters:
  - `start_date`: `YYYY-MM-DD`
  - `end_date`: `YYYY-MM-DD`
- When both dates are omitted, the selected range defaults to today's local stat date.
- When only one date is supplied, the backend treats it as both range start and range end.
- `end_date < start_date` returns a user-facing `400` validation error.
- Response preserves today fields and adds selected-range fields:
  - `start_date`, `end_date`
  - `range_attempt_count`, `range_success_count`, `range_failure_count`
  - `range_text_attempt_count`, `range_image_attempt_count`
  - `today_attempt_count`, `today_success_count`, `today_failure_count`
  - `today_text_attempt_count`, `today_image_attempt_count`
  - per-config `range_stat`
- Status aggregates read `generation_config_daily_stats` plus `generation_config_states`; do not scan historical
  workflow/image-session records to build the page.

Generation submit APIs should accept optional selection:

```json
{
  "generation_config_mode": "auto",
  "generation_config_id": null
}
```

For manual:

```json
{
  "generation_config_mode": "manual",
  "generation_config_id": "<id>"
}
```

Workflow node `config_json` should store the same pair for text/image node execution.

## Import/Export

This refactor replaces the old provider binding structure. Export document should contain:

- runtime config
- provider profiles
- generation configs

Statistics and current runtime state should not be exported by default because they are environment-local operational data.

## Frontend Shape

Top-level navigation includes Settings and Status separately.

Settings page owns configuration editing:

- Runtime config
- Provider profiles
- Generation configs
- Import/export

Generation config cards show:

- provider/profile/model
- priority
- max concurrency
- enabled
- today attempts/success rate
- current concurrency
- frozen status and remaining time

Status page owns read-only operational visibility:

- Private route: `/status`
- Same secondary unlock gate as Settings when `SETTINGS_ACCESS_TOKEN` is configured.
- Query key: `["generation-config-status", startDate, endDate]`.
- Date controls:
  - quick filters for today, last 7 days, last 30 days, and current month
  - custom start/end date inputs
  - invalid range guard before querying
- Aggregate cards:
  - today total attempts with text/image split
  - today text attempts
  - today image attempts
  - selected-range attempts with success/failure detail
  - running config count
  - frozen config count
- Config rows show purpose, provider kind, priority, current/max concurrency, range attempts, success rate, health/freeze
  state, and latest failure reason.
- Status page must not include a button that jumps to Settings.

## Multi-Agent Plan

Current session is inline-only, so implementation/check sub-agents cannot be dispatched here. When execution mode allows:

- Agent A owns backend schema, migration, models, scheduler service, unit tests.
- Agent B owns settings/status API schemas and settings import/export backend tests.
- Agent C owns SettingsPage config pool/status UI, i18n, frontend DTOs/tests.
- Agent D owns workflow node and image-chat integration, browser verification.
- Main session owns API contract arbitration, merge conflict resolution, final quality gate and commit.

Agents must not revert each other's work and should coordinate through task PRDs/design files.

## Risks

- Per-config concurrency requires atomic DB updates; in-memory locks are insufficient across workers.
- Stats updates need to run on all provider success/failure paths, including workflow and image-chat paths.
- Existing dirty work touches provider code and settings UI; implementation must inspect and preserve unrelated changes.
- Dropping compatibility is acceptable, but migration must still leave local development bootable.
