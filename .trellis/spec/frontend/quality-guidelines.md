# Frontend Quality Guidelines

> Frontend quality standards reflected by current ProductFlow code and tooling.

---

## Tooling

Frontend tooling is defined in `web/package.json`, `web/tsconfig*.json`, `web/vite.config.ts`, and the root `justfile`:

- React 19, React DOM 19.
- Vite 7 with `@vitejs/plugin-react`.
- Tailwind CSS v4 through `@tailwindcss/vite`.
- TanStack Query 5 for server state.
- React Router DOM 7 for routing.
- TypeScript strict mode.

Common commands:

```bash
just web-install
just web-dev
just web-build
pnpm --dir web lint
pnpm --dir web test:run
```

`just web-build` runs `pnpm --dir web build`, which type-checks app and Vite/Vitest config before building. Frontend
changes should also run the executable quality gate added under `web/package.json`:

- `pnpm --dir web lint` runs ESLint flat config from `web/eslint.config.js` over the Vite/React/TypeScript workspace.
  The baseline intentionally keeps formatting churn low: React hooks rules are enabled, while exhaustive dependency
  cleanup is not part of the first gate.
- `pnpm --dir web test:run` runs deterministic Vitest unit tests from `web/vitest.config.ts`.
- `pnpm --dir web test` is reserved for local Vitest watch mode.

Prefer pure helper tests for page-local logic before large UI refactors. For InspirationDetail workbench changes, add or
extend tests under `web/src/pages/inspiration-detail/*.test.ts` when touching gallery, download, workflow status, or other
importable helper behavior. Do not split `InspirationDetailPage.tsx` solely to satisfy tests; extract only small pure helpers
when that keeps runtime behavior unchanged.

## Scenario: Frontend executable quality gate

### 1. Scope / Trigger

- Trigger: any frontend code change under `web/src/`, frontend config change under `web/`, or InspirationDetail helper
  extraction intended to support refactoring.
- Goal: keep the gate small and deterministic before larger InspirationDetail UI splitting.

### 2. Signatures

- `pnpm --dir web lint`
- `pnpm --dir web test:run`
- `pnpm --dir web test` for local watch mode only.
- `just web-build` remains the build/type-check gate and delegates to `pnpm --dir web build`.

### 3. Contracts

- ESLint config lives at `web/eslint.config.js`.
- Vitest config lives at `web/vitest.config.ts`.
- Unit tests use `*.test.ts` under `web/src/`; keep them close to the pure helper they cover.
- `web/tsconfig.node.json` includes frontend tool config files that should be type-checked by `web build`.

### 4. Validation & Error Matrix

- Lint error -> fix code or narrow the rule in `web/eslint.config.js`; do not add inline suppressions unless the
  exception is intentional and documented near the code.
- Test failure -> fix the helper or update the assertion when the intended behavior changed.
- Type/build failure -> fix TypeScript/runtime import boundaries before reporting frontend work complete.
- Large pre-existing React hook dependency cleanup -> do not mix into unrelated work; keep the initial gate low-noise and
  schedule stricter rules separately.

### 5. Good/Base/Bad Cases

- Good: add or update a InspirationDetail gallery/download/status helper and cover it with a colocated `*.test.ts`.
- Base: run `pnpm --dir web lint`, `pnpm --dir web test:run`, and `just web-build` before handing off frontend changes.
- Bad: split `InspirationDetailPage.tsx` UI only to make tests importable.
- Bad: enable broad formatting or hook-dependency rules that require whole-frontend rewrites in an unrelated task.

### 6. Tests Required

- New pure helper -> add Vitest unit coverage for normal and edge cases.
- InspirationDetail helper changes -> prefer colocated tests under `web/src/pages/inspiration-detail/`.
- Locale/theme helper changes -> update or add tests near `web/src/lib/preferences.test.ts`.
- Locale-aware pure helper changes -> test both `zh-CN` and `en-US`, including fallback behavior for legacy system labels
  when old records store default Chinese titles.
- DTO/API behavior changes still require `just web-build`; frontend unit tests do not replace backend contract tests.
- UI/CSS browser verification -> reuse one existing browser page when the user explicitly authorizes navigation, viewport,
  or visual inspection changes. Otherwise use one dedicated browser profile/context for the whole run; do not repeatedly
  create contexts or trigger extra logins.

### 7. Wrong vs Correct

#### Wrong: Watch Mode

```bash
pnpm --dir web test
```

Using watch mode as the handoff gate can hang automation.

#### Correct: Deterministic Test Run

```bash
pnpm --dir web test:run
```

Use the deterministic run mode for CI-style verification and keep `test` for local watch mode.

#### Wrong: Repeated Browser Contexts

```text
Create a new isolated context for every route or viewport and repeat the login flow.
```

This wastes time, multiplies authentication state, and makes visual results harder to compare.

#### Correct: One Authorized Verification Page

```text
Reuse one explicitly authorized page for the whole review and restore its viewport/state afterward. Use a dedicated context
only when the existing session cannot safely cover the requested flow.
```

Keep screenshots, viewport changes, and console inspection in that single verification surface.

---

## Required Patterns

### Centralize API access

Use `web/src/lib/api.ts` for all backend calls. It handles:

- `VITE_API_BASE_URL` trimming.
- `credentials: "include"` for session-cookie auth.
- JSON vs `FormData` headers.
- API error parsing into `ApiError`.
- Typed request/response methods.

Do not add raw `fetch(...)` calls in pages/components.

### Keep server state in TanStack Query

Use `useQuery`, `useMutation`, and `useQueryClient` as shown in current pages. Mutations should update or invalidate the
query keys affected by the change. Do not introduce global stores for server records.

### Keep routes auth-gated

Add new private routes in `web/src/App.tsx` with the same authenticated/redirect pattern used by existing routes. Login is
the only public page.

### Preserve build-time type safety

Any API contract change should update `web/src/lib/types.ts`, page usage, and backend schemas/tests together. Run
`just web-build` before finishing frontend work. When frontend code changes, also run `pnpm --dir web lint` and
`pnpm --dir web test:run`.

### Keep UI feedback explicit

Current pages show loading, error, disabled, and success states close to the action:

- Stable bootstrap and route skeletons in `App.tsx` and `web/src/components/loading/`.
- Region-level skeleton, paused, error, empty, and cached-refresh states through `AsyncContent`.
- Mutation errors in `InspirationCreatePage.tsx`, `InspirationDetailPage.tsx`, `ImageChatPage.tsx`, and `SettingsPage.tsx`.
- Disabled buttons while mutations are pending.

Follow this style for new actions.

## Scenario: Frontend asynchronous read regions

### 1. Scope / Trigger

- Trigger: adding or changing a TanStack Query-backed page, provider, route chunk, modal, drawer, or content-sized read.
- Goal: keep shells stable, prevent disabled or failed queries from becoming false empty states, and keep cached content
  visible during refreshes.

### 2. Signatures

- State adapter: `asyncViewStateFromQuery(...)` in `web/src/lib/asyncViewState.ts`.
- Multi-query adapter: `combineAsyncViewStates(...)` with explicit participating critical queries.
- Render boundary: `AsyncContent` from `web/src/components/loading/AsyncContent.tsx`.
- Route boundary: `RouteLoadingBoundary` plus route metadata/loaders from `web/src/routes/pageModules.ts`.
- Refresh intent: `"silent-poll" | "user-refresh" | "parameter-change" | "background"`.

### 3. Contracts

- Every read region preserves four facts: participation (`active | inactive`), content (`none | empty | ready`), fetch
  (`idle | fetching | paused`), and error (`none | initial | refresh`).
- A disabled query or unmet dependency is `inactive`; `undefined`, disabled, paused, or failed data is not a successful
  empty result.
- `AsyncContent` owns the loading/error/paused/empty/ready precedence and accessible busy semantics. The page owns query
  keys, `queryFn`, `enabled`, business `isEmpty`, retry callbacks, text, and skeleton geometry.
- Cached `empty` or `ready` content remains mounted while fetching. `silent-poll` does not set `aria-busy`, announce a
  status, or display recurring refresh chrome; an explicit user refresh may display non-blocking progress.
- Initial errors retain their error container while retrying. Refresh errors keep current content visible and expose a
  local retry action.
- Initial read errors use assertive alert semantics. Cached refresh errors and pauses use `role="status"` with
  `aria-live="off"`, including page-level feedback rendered outside `AsyncContent`.
- Content reads use `Skeleton` or stable geometry. Mutation pending, upload, search, generation, cancellation, and durable
  task progress may keep compact spinners next to the action or task state.
- Query-driven context values created with `useMemo` must list the derived `AsyncViewState`, manual refresh pending/error,
  and cached data dependencies. A stale memo can leave TopNav or provider consumers on an obsolete refresh/error state.

### 4. Validation & Error Matrix

- `active + none + fetching` -> region skeleton with one loading status.
- `active + none + paused` -> recoverable paused state, not an infinite skeleton.
- `active + none + initial error` -> local error and retry; retrying keeps the error context.
- `inactive` -> caller-declared stable placeholder or `null`; never a business empty state.
- `empty/ready + fetching` -> keep current content; feedback follows the declared refresh intent.
- `empty/ready + refresh error` -> keep current content and show non-blocking recovery.
- Route chunk rejection -> route chunk error with reload recovery; ordinary render error -> resettable render boundary.

### 5. Good/Base/Bad Cases

- Good: an Image Chat session list waits in `inactive` while its group/admin dependencies resolve, then independently
  enters loading, error, empty, or ready.
- Good: manual weather refresh keeps cached weather visible, exposes a nearby pending state, and clears the refresh error
  after a later success.
- Base: a parameterized list uses `placeholderData` only when the old rows remain meaningful for the new parameter.
- Bad: rendering `query.data ?? []` and showing an empty state while `enabled=false` or the first request failed.
- Bad: replacing cached content with a skeleton whenever `isFetching=true`.
- Bad: changing a task execution spinner into a skeleton that no longer communicates queued/running progress.

### 6. Tests Required

- Table-driven tests for disabled, initial idle, paused, retrying, partial multi-query success/failure, cached refresh, and
  `empty + fetching` states.
- Component tests for one loading status, `aria-busy`, inactive/empty separation, retry actions, and quiet silent polling.
- Provider tests for cached refresh failure/success and memoized context updates.
- Route tests for matcher conflicts, shared loader promises, failed-loader recovery, Suspense fallback, and boundary reset.
- Broad changes run `pnpm --dir web test:run`, `pnpm --dir web lint`, `just web-build`,
  `node web/scripts/check-bare-colors.mjs`, and `git diff --check`.

### 7. Wrong vs Correct

Wrong:

```tsx
const items = query.data?.items ?? [];
return query.isLoading ? <Spinner /> : items.length ? <List items={items} /> : <Empty />;
```

Correct:

```tsx
const state = asyncViewStateFromQuery({
  active: dependenciesResolved,
  data: query.data,
  dataUpdatedAt: query.dataUpdatedAt,
  isSuccess: query.isSuccess,
  isError: query.isError,
  fetchStatus: query.fetchStatus,
  isEmpty: (data) => data.items.length === 0,
});

return <AsyncContent state={state} refreshIntent="parameter-change" {...regionSlots} />;
```

### Keep settings/admin workspaces theme-complete and locale-complete

Settings, admin, and operational workspaces must be designed and reviewed as light/dark paired surfaces, not as a
single-theme mock copied into both modes.

- Light mode should remain a first-class surface: neutral page background, white or near-white panels, readable slate/zinc
  text, and visible but restrained borders.
- Dark mode may use deep navy/slate surfaces and violet/indigo accents, but every explicit light background, border,
  placeholder, muted text, hover state, and alert state needs a matching `dark:*` variant.
- The workspace shell brand (`logo + Inspiration One`) is system chrome. Do not place it inside the auto-hiding menu
  budget; when changing workspace nav layout, reserve the measured brand width before deciding which menu items move into
  More, and verify desktop resize widths near the `980px` breakpoint.
- Workspace top navigation remains business-page navigation even on the workspace home page. Do not map top menu items to
  `/inspirations#...`, and do not send them to workspace overview routes that only extract home sections. Use the existing
  real page routes such as `/inspirations/list`, `/image-chat/workbench`, `/gallery/manage`, and `/status/detail`. Home
  section anchors belong to the workspace home quick navigation only. The workspace brand link must point to `/inspirations`
  without a hash so it clears any current anchor and returns to the home top.
- Every new visible UI label, placeholder, button, section heading, status message, and aria label must use
  `web/src/lib/i18n.ts` keys for both `zh-CN` and `en-US`.
- Provider names, model IDs, API keys, URLs, filenames, backend `ApiError.detail`, and operator-authored content stay as
  source data and should not be translated.
- Configuration pages should keep app-style density: fixed or sticky navigation, one active working panel, explicit field
  labels, and save/error feedback near the changed section.

### Parameterized list pages with heavy row previews

List/admin pages that render expensive per-row previews (SVG mini-maps, graph thumbnails, large form cards) must keep
typing and filtering interactive:

- Isolate each row/card with `memo` (or an equivalent boundary). Draft/form state for one row must not re-render other
  rows' previews. Prefer passing `draft={drafts[key]}` (possibly `undefined`) and computing the fallback draft inside
  the memoized card.
- Stabilize list derivation with `useMemo` on query `data` references + locale/filters. Do not rebuild sorted/localized
  arrays on unrelated page state (drawer open, soft feedback).
- Debounce search strings that enter React Query keys (about 250–300ms). Keep the input controlled by the immediate
  value; only the query path uses the debounced value. Keep `placeholderData` / `keepPreviousData` and
  `AsyncContent refreshIntent="parameter-change"` so filter changes do not flash a full-region skeleton.
- When a page combines a primary list query with a secondary enrichment query (for example global templates + user
  copy-sources), put only the primary query in `combineAsyncViewStates.critical`. Merge secondary rows when ready.
  Secondary failures must not turn an already-ready primary list into `initial-error`; show non-blocking soft feedback
  outside `AsyncContent.refreshFeedback` if the critical state has no refresh error (otherwise the slot is suppressed).
- `isEmpty` for combined lists must not treat "secondary still unresolved + primary temporarily empty" as a final empty
  state when the product still expects secondary rows.
- Optional offscreen cost reduction: card shells may use `content-visibility: auto` with a realistic
  `contain-intrinsic-size` (see inspiration list cards). Full window virtualization is optional and out of scope unless
  product requires it.
- Prefer memoized preview leaves that accept already-localized data (`localized` / skip re-localize) when the parent
  already ran localization.

Reference implementation: `web/src/pages/TemplateManagementPage.tsx` and `TemplateGraphPreview` in
`web/src/pages/inspiration-detail/TemplateGroupsPanel.tsx`.

### Workspace home navigation contract

Wrong:

```tsx
<Link to="/inspirations#chat">{t("nav.imageChat")}</Link>
```

Correct:

```tsx
<Link to="/image-chat/workbench">{t("nav.imageChat")}</Link>
<Link to="/inspirations#chat">{t("workspaceHome.quickNav")}</Link>
```

TopNav owns first-level page movement; the workspace home quick nav owns in-page anchor movement. The quick nav should use
independent left-edge bookmark drawers for each anchor, stacked vertically, with each collapsed bookmark showing only its
icon in a clear click target and keeping the label off-canvas until hover/focus. Do not group all anchors into one
hover-open menu panel. Keep pure helper coverage for quick-nav anchor path generation and permission-filtered anchor
visibility.

### Keep desktop-only layout state bounded

When adding resizable panels to a desktop-only layout:

- Keep min/max sizing and viewport-fit calculations in pure helper functions when the math is non-trivial.
- Re-clamp stored panel sizes on desktop viewport resize so hidden overflow does not push primary content below its
  minimum useful size.
- Gate desktop-only clamping with the same breakpoint that controls the desktop layout. Do not shrink hidden panel state
  while the page is in a mobile stacked layout, or the user may return to desktop with unexpectedly collapsed panels.
- Close mobile-only modal surfaces such as Vaul `Drawer` / bottom sheets when entering the desktop breakpoint. Do not rely
  on `lg:hidden` alone while leaving `open=true`; a hidden modal can still lock body input or intercept wheel events over
  the visible desktop panel.
- Cover clamp helpers with deterministic Vitest tests instead of relying only on manual drag checks.

---

## Accessibility and UX Checklist

Review new UI for:

- Non-submit buttons have `type="button"`.
- Inputs have labels or are wrapped by labels.
- Loading states use both disabled controls and visible feedback when an action can take time.
- Error text is visible near the action that failed.
- Image URLs from the backend are converted with `api.toApiUrl(...)` before being used in `src` or links.
- Destructive actions such as delete are explicit buttons and update cache/selection state after success.
- Visible UI chrome uses `useI18n()` or locale-aware helpers instead of hard-coded page-local strings.
- Light surfaces, borders, and muted text have dark-mode variants, and inspiration/image previews remain inspectable.

---

## Build and Environment

Development and preview ports are configured through `web/vite.config.ts`:

- Dev default port: `29283`.
- Preview default port: `29281`.
- Dev API proxy target default: `http://127.0.0.1:29282`.
- Allowed hosts default to `draw.devbin.de` unless `WEB_ALLOWED_HOSTS` is provided.

Use `just web-dev` so `.env.dev` and proxy behavior match backend dev commands.

---

## Forbidden Patterns

- Raw `fetch(...)` outside `web/src/lib/api.ts`.
- Untyped API responses or `any` payloads.
- New pages not registered in `App.tsx` or not protected by session auth when private.
- New server state held only in local component state when it should be cached/invalidation-aware.
- Committing `web/dist/`, `web/node_modules/`, `*.tsbuildinfo`, or local env files.
- Adding lint/test commands to docs without actually configuring them in `web/package.json`.
- Adding page-local locale/theme persistence outside `PreferencesProvider`.
- Translating inspiration/operator/model-authored content instead of only ProductFlow UI chrome and system labels.

---

## Review Checklist

Before accepting frontend changes, check:

- Does `just web-build` pass?
- Does `pnpm --dir web lint` pass?
- Does `pnpm --dir web test:run` pass?
- Are API methods and DTO types centralized in `web/src/lib/`?
- Are query keys and invalidations complete for every mutation?
- Are backend enum/DTO changes mirrored in `web/src/lib/types.ts`?
- Are loading/error/disabled states present for async actions?
- Does the UI match the existing Tailwind/zinc visual language?
- Does visible UI chrome render correctly in both `zh-CN` and `en-US`?
- Does the changed UI remain readable in `light`, `dark`, and `system` theme modes?
