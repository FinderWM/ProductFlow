# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Commands

All commands use the root `justfile`:

| Command | Purpose |
|---|---|
| `just backend-install` | Install Python deps via `uv sync` |
| `just backend-run` | FastAPI dev server (port 29282) |
| `just backend-worker` | Dramatiq workers for async jobs |
| `just backend-migrate` | Apply Alembic migrations |
| `just backend-test` | Run pytest |
| `just web-install` | Install frontend deps via `pnpm` |
| `just web-dev` | Vite dev server (port 29283) |
| `just web-build` | Type-check + build frontend |

Backend test targeting: `uv run --directory backend pytest tests/path/to/test_file.py::test_name`

Lint/format backend: `uv run --directory backend ruff check src` / `uv run --directory backend ruff format src`

Frontend tests: `pnpm --dir web test:run`

## Architecture

### Backend (Python 3.12 / FastAPI / SQLAlchemy / Dramatiq)

Four-layer DDD:
- **`presentation/`** — FastAPI app factory (`api.py`), route modules, Pydantic schemas, session middleware
- **`application/`** — Use cases: auth, canvas templates, gallery, generation configs, image sessions, inspiration workflows, queue submission, moderation, RBAC
- **`domain/`** — Enums, errors, RBAC model, workflow rules, durable generation task definitions
- **`infrastructure/`** — DB (SQLAlchemy models + `get_db_session`), image/text providers, poster rendering, queue (Dramatiq actors), storage (local/MinIO/S3 via boto3), OpenAI client wrappers

Key patterns:
- `config.py` — settings from env (`get_settings()`) + DB overrides (`get_runtime_settings()`). Business config keys are defined as `ConfigDefinition` tuples and can be mutated at runtime via `/settings` API, stored in `app_settings` table.
- `provider_config.py` — provider capabilities and generation config scheduling:
  - `ProviderProfile.config_json.capabilities.image_max_dimension` (int | null) — provider-level resolution limit
  - `get_provider_capabilities()` / `resolve_effective_max_dimension()` — capability resolution helpers
  - `enforce_generation_config_resolution()` — defensive validation for manual mode
  - `claim_generation_config(..., required_max_dimension)` — filters candidates by resolution capability
  - Effective max dimension: `min(provider_max ?? global, global)`
- `main.py` — thin entry point; `create_app()` in `presentation/api.py` wires middleware, routes, and lifespan hooks.
- `workers.py` — Dramatiq broker entry point; actors are defined under `application/` and `infrastructure/queue.py`.
- DB sessions via FastAPI dependency `get_db_session()` (gives `Session`, autocommit=False).
- Tests at `backend/tests/`, pytest with `pythonpath = ["src"]`.

### Frontend (React 19 / Vite / Tailwind CSS 4 / @xyflow/react)

- **Pages** (`web/src/pages/`) — route-level components, lazy-loaded in `App.tsx`
- **Components** (`web/src/components/`) — shared UI: TopNav, ConfirmDialog, ImageDropZone, ImageGenerationSettingsPanel, StatusPill, etc.
- **Lib** (`web/src/lib/`) — API client (`api.ts`), types, RBAC helpers, i18n, preferences, session context, image tool options, canvas template localization
  - `resourceGroupMaxDimension(configs, resourceGroupId, globalMax)` — frontend aggregation of provider max dimensions within a resource group
  - `GenerationConfig.provider_max_dimension` (number | null) — provider's maximum resolution capability
- State: `@tanstack/react-query` for server state; `SessionStateProvider` context for auth/permissions
- Routing: `react-router-dom` v7 with menu-based access control via `hasSessionMenu` / `hasSessionApiPermission`
- Styling: Tailwind CSS 4 with dark mode (`dark:` variants on `<html>`)
- Tests: Vitest

### Infrastructure Dependencies

PostgreSQL + Redis + MinIO (local dev via containers `libowpg`, `libowredis`, `libowminio`). Dramatiq uses Redis as broker. File storage supports local/MinIO/S3 via `STORAGE_BACKEND` env var.

### Async Processing

Dramatiq actors handle: workflow runs, image generation, poster rendering, copy generation. Actors recover unfinished tasks on startup (see lifespan in `api.py`). Generation concurrency is capped by `generation_max_concurrent_tasks`.

### Config System

`Settings` (env-only): database_url, redis_url, session_secret, admin_access_key, storage backend settings.

Runtime config (DB-overridable via `/settings`): prompt templates, image tool parameters, upload limits, generation queue thresholds, feature flags like `deletion_enabled`.
- `image_generation_max_dimension` — global maximum resolution limit (default 3840). Provider-level limits in `ProviderProfile.config_json.capabilities.image_max_dimension` can further restrict this on a per-provider basis.

### Resolution Capability System

**Backend**: Provider profiles store `image_max_dimension` (int | null) in `config_json.capabilities`. When `null`, the provider has no resolution limit (only global ceiling applies). When claiming a generation config, the system filters by `required_max_dimension` parameter. Effective limit: `min(provider_max, global)` if provider_max is set, otherwise `global`. Manual mode uses defensive validation at execution time to prevent bypassing claim filtering.

**Frontend**: `ImageChatPage` dynamically calculates `effectiveMaxDimension`:
- **Manual mode**: uses selected config's `provider_max_dimension` (null = no limit, use global)
- **Auto mode**: aggregates max across all enabled configs in the resource group via `resourceGroupMaxDimension()` (null configs treated as no limit)
- Final limit: `min(computed_max, global_max)`

Settings UI (`ProvidersSection`) allows admins to edit `image_max_dimension` per provider. **Leave empty to indicate no provider-specific limit** (only global ceiling applies).

## Code Style

**Python**: Ruff with 120-char lines, rules `E F I UP B`. Prefer typed functions, `snake_case` for modules/functions.

**TypeScript/React**: `PascalCase` filenames for components/pages, `camelCase` for hooks/helpers/API functions. Keep provider-specific code behind infrastructure factories.

**Schema/migration changes**: include an Alembic revision and a regression test where practical. Run `just backend-migrate` in dev before `just backend-test`.

## Testing

Add workflow-level coverage when changing inspiration, copy, poster, settings, or image-session behavior. Run `just backend-test` before backend commits and `just web-build` before frontend commits.

## Commit Convention

Use Conventional Commit prefixes with concise Chinese summaries, e.g. `feat: 增加设置页模型配置`. One focused commit per topic; migrations/config changes must be called out in the PR description.
