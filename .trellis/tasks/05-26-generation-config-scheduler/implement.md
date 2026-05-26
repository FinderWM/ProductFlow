# 生成配置池调度与状态重构 - Implementation Plan

## Phase 0: Baseline

- Read backend/frontend specs listed in `implement.jsonl`.
- Inspect current provider config, settings schemas, image-session task, workflow execution, and SettingsPage.
- Run `git status --short` before edits and preserve unrelated dirty work.

## Phase 1: Backend Core

- Replace single-purpose provider binding model with generation config pool tables.
- Add Alembic migration that removes/migrates old binding data into the new latest structure.
- Add state and daily stats models.
- Add resolver/scheduler service:
  - list candidates
  - score automatic candidates
  - claim/release per-config concurrency
  - update daily stats
  - handle freeze/thaw rules
- Add settings APIs for generation config CRUD/reorder/status.
- Add backend tests for model constraints, migration, scheduler scoring, manual config behavior, capacity, freeze, and stats.

## Phase 2: Frontend Settings and Status

- Update frontend DTOs and API client.
- Replace text/image single binding UI with config pool UI.
- Add priority, max concurrency, freeze-policy controls.
- Add manual refresh sorting control.
- Add status tab with per-config and aggregate operational state.
- Add i18n keys for zh-CN/en-US/ja-JP if the existing file maintains all locales.
- Add focused helper tests where possible.

## Phase 3: Runtime Integration

- Persist generation config mode/id on workflow text and image nodes.
- Persist generation config mode/id on image-session generation tasks.
- Route text provider calls and image provider calls through scheduler.
- Add image-chat prompt polish using text configs with user confirmation before writing prompt text.
- Update settings import/export to the new generation configs structure.
- Remove old provider binding API/UI assumptions.

## Phase 4: Verification

- `just backend-migrate`
- `just backend-test`
- `uv run --directory backend ruff check .`
- `pnpm --dir web lint`
- `pnpm --dir web test:run`
- `just web-build`
- Browser/manual checks:
  - create multiple text/image configs
  - reorder by priority
  - run workflow with auto config
  - run workflow with manual config
  - run image-chat with auto/manual image config
  - use prompt polish and confirm insertion
  - inspect status tab stats/freeze state
  - export/import settings

## Current Progress

- Completed backend status API slice:
  - `GET /api/settings/generation-config-status` accepts `start_date` / `end_date`.
  - Response includes today fields, selected-range totals, text/image attempt splits, and per-config `range_stat`.
  - Backend regression coverage asserts range aggregation and invalid range handling.
- Completed frontend status page slice:
  - `/status` is a first-level private route and top/mobile navigation item next to Settings.
  - Status page uses `["generation-config-status", startDate, endDate]` and the settings secondary unlock flow.
  - Quick filters cover today, last 7 days, last 30 days, and current month; custom date inputs are supported.
  - Today total calls are split into text and image metrics.
  - The previous SettingsPage embedded status section was removed.
  - The status page no longer includes a jump button back to configuration.
- Documentation follow-up:
  - Trellis PRD/design/implementation files record the completed status-page behavior.
  - Frontend specs record the `/status` route and status query-key contract.
  - Help docs and user guide describe generation config pools and the first-level Status page.

## Rollback Points

- Migration is destructive for old binding structure. Before executing against non-local data, require an explicit backup.
- Keep commits focused by child task when possible.
- If scheduler integration gets too large, land backend schema/API first behind unused code, then connect runtime paths in the integration child task.

## Agent Scheduling Plan

Desired multi-agent split when allowed by execution mode:

- Backend model/scheduler agent owns Phase 1.
- Frontend settings/status agent owns Phase 2.
- Integration agent owns Phase 3 workflow/image-chat/import-export.
- Check agent owns Phase 4 independent verification and bug report.

Current Codex session is inline-only by developer instruction, so the main session will execute directly until that constraint changes.
