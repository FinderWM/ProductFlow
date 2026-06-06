# Codebase Governance Guide

Use this guide when reviewing modules, adding protected routes, changing extension points, or splitting large UI/backend files.

## Module Boundaries

Backend layers:

- `presentation`: FastAPI routes, dependency gates, HTTP status mapping, and schema serialization only.
- `application`: business use cases, workflow orchestration, transactions, ownership checks, and state transitions.
- `domain`: enums, RBAC constants, business errors, pure rules, and stable string contracts.
- `infrastructure`: database/session models, storage, queues, providers, renderers, and external-service adapters.
- `tests`: behavior coverage for the feature boundary, with pure helper tests when extraction reduces risk.

Frontend layers:

- `App.tsx`: route registration, route-level auth/RBAC redirects, and app providers.
- `pages`: route owners for data loading, mutations, navigation, URL params, and local draft state.
- `components`: reusable presentational UI with simple props and no route-level server-state ownership.
- `lib/api.ts`: the only backend API client surface.
- `lib/types.ts`: frontend DTO mirror for backend response/request shapes.
- `index.css`: global app primitives and tokens only; repeated page-specific styling should stay near the page until reused.

Do not bypass the nearest layer just because it is shorter. Routes should not construct provider clients, components should not call raw backend URLs, and infrastructure should not depend on FastAPI request objects.

## RBAC Gates

Classify every backend route before merging:

- Public auth boundary: `/api/auth/session`, `/api/auth/login`, `/api/auth/password`, and `DELETE /api/auth/session`.
- Private business API: requires `require_api_permission(...)` or `require_any_api_permission(...)`.
- Admin governance API: requires both `require_admin` and the API permission that represents the action.

Frontend gates must match backend gates:

- Route access in `App.tsx` must check the same API permission required by the backend.
- Admin-only routes or controls must also check `session.user.is_admin`.
- Navigation visibility must not be weaker than route/API access.
- Page-level action buttons must be hidden or disabled according to the API they call.
- Reusable composite checks belong in `web/src/lib/rbac.ts`; route and navigation declarations should call helpers instead of duplicating boolean logic.

Known contract:

- `/api/rbac/*` is admin governance. Frontend `/rbac` access requires `is_admin && rbac:manage`; the `rbac` menu is navigation metadata and must not be the only gate.
- Settings page access requires `settings` menu plus `settings:read`.
- Global template management uses `templates:manage_global`, even when reached through settings-owned navigation.

When adding an API permission, update all of these together:

- `backend/src/productflow_backend/domain/rbac.py`
- route dependency
- frontend route/nav/action gate
- frontend helper tests when the condition is composite
- RBAC catalog or authorization tests when behavior changes

Backend route gates are enforced by `backend/tests/test_route_rbac_contract.py`:

- Every public route must be listed in the test allowlist by method and path.
- Every private `/api` route must expose `require_api_permission(...)` or `require_any_api_permission(...)` through the
  FastAPI dependency tree.
- Admin governance routes must expose both `require_admin` and their action permission in the test prefix matrix.
- When adding a protected route, run
  `uv run --directory backend pytest tests/test_route_rbac_contract.py tests/test_auth_rbac.py`.

## Extension Points

Use existing extension seams before creating new abstractions:

- Text/image providers extend through infrastructure factories and runtime generation config.
- Workflow generation extends through `WorkflowExecutionDependencies`.
- Provider-specific request/response details stay in infrastructure or provider adapters.
- Route-facing business failures should use typed business errors and explicit HTTP mapping.
- Frontend API additions go through `web/src/lib/api.ts` and `web/src/lib/types.ts`.
- Cross-page UI reuse graduates to `components/` only after at least two real consumers need the same component.

Add a design pattern only when it protects a real extension point. A small local helper is better than a generic registry with one implementation.

## UI and CSS Governance

Operational pages should remain dense, readable, and theme-complete:

- Use the existing zinc/slate surface language with restrained borders and hover states.
- Pair explicit light-mode backgrounds, borders, shadows, muted text, placeholders, and alerts with `dark:*` variants.
- Keep user-visible UI chrome in `web/src/lib/i18n.ts`; operator content, product names, prompts, filenames, provider messages, and backend `ApiError.detail` stay as source data.
- Prefer lucide icons for tool buttons and familiar controls.
- Do not add large decorative hero layouts, nested cards, gradient orbs, or marketing-style feature copy to app workspaces.
- Fixed toolbars, boards, counters, grids, and icon buttons need stable dimensions so labels, hover states, and loading icons do not shift layout.

Large route pages should be split by behavior, not by arbitrary line count:

- Keep query/mutation ownership, URL params, selection reconciliation, and submit handlers in the route page until a dedicated controller/hook refactor is planned.
- Extract presentational regions into page-local folders when they receive already-derived props and callback props.
- Extract pure helpers for sizing, status classes, labels, and permission checks when they can be covered by deterministic tests.
- Avoid moving page-specific UI to global `components/` before it has real reuse.

## Risk Review Format

Record broad reviews with this structure:

```text
Severity: P0/P1/P2/P3
File: path:line
Module: backend presentation/application/domain/infrastructure, frontend route/page/component/lib/css
Finding: concrete behavior or maintenance risk
Impact: user-facing, security, reliability, maintainability, or extension risk
Fix shape: smallest safe change
Validation: command or focused test
Status: fixed, deferred, or follow-up task
```

Severity guide:

- P0: confirmed data loss, auth bypass, production outage, or irreversible destructive behavior.
- P1: likely security/permission mismatch, reliability failure, or high-impact user workflow break.
- P2: maintainability, extension, UI consistency, or testability risk with clear future cost.
- P3: local cleanup that should wait for nearby feature work.

## Validation Gates

Choose the smallest gate that covers the change:

- Backend route/RBAC/auth changes: focused pytest for the affected API plus existing auth/RBAC tests.
- Backend provider/workflow/storage changes: focused workflow/provider tests, then broader backend tests when contracts move across layers.
- Frontend route/nav/helper changes: `pnpm --dir web test:run`, `pnpm --dir web lint`, and `just web-build`.
- Frontend API/DTO changes: `just web-build` plus backend contract tests when response shape changes.
- UI/CSS-only changes: lint/build plus browser or screenshot review when layout risk is visible.
- Documentation-only changes: `git diff --check`.

If a gate fails from pre-existing issues, record the command, the first unrelated failure, and the narrower validation that still covers the touched files.

## Forbidden Patterns

- Private backend route without an explicit auth/RBAC dependency.
- Frontend route or navigation item that is weaker than the backend API permission.
- Raw `fetch(...)` outside `web/src/lib/api.ts`.
- New DTO copies inside pages/components when `web/src/lib/types.ts` should own the shape.
- Provider selection logic in routes or React components.
- Large formatting rewrites mixed with behavioral fixes.
- Broad page rewrites without a staged extraction plan and focused helper tests.
- UI text, placeholders, aria labels, or status messages hard-coded outside i18n.
