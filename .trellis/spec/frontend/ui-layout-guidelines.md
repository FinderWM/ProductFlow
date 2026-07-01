# UI Layout and Theme Extension Guidelines

> Executable contracts for extending ProductFlow's UI layout schemes and workspace appearance themes.

---

## Scope / Trigger

Use this spec before changing any of these surfaces:

- UI layout schemes such as `classic` and `workspace`.
- Theme systems that affect an existing layout scheme.
- Top-level routes, navigation targets, shell classes, or workspace landing pages.
- Root CSS variables or `data-*` attributes that change app-wide visual behavior.

Current contracts:

- Layout schemes are `classic` and `workspace` in `web/src/lib/uiLayoutScheme.ts` and
  `backend/src/inspiration_one_backend/domain/ui_layout.py`.
- `classic` uses the global theme preference `light | dark | system` from `web/src/lib/theme.ts`.
- `workspace` uses local visual appearances `mist | sage | dusk` from `web/src/lib/workspaceAppearance.ts`.
- `workspace` writes both `data-ui-layout-scheme="workspace"` and `data-workspace-appearance="<appearance>"` on the root
  element. The selected workspace appearance resolves the global `light` / `dark` theme so existing `dark:*` utilities stay
  readable.

## Existing Layout Responsibilities

### Classic

`classic` is the default layout and fallback for unknown values. It owns the standard app shell:

- Public auth pages and app loading fallbacks also use the classic global theme model because
  `UiLayoutSchemeProvider` is disabled until authentication succeeds.
- Route rendering defaults to the classic page unless a route explicitly passes a workspace variant through
  `LayoutSchemeRoute` in `web/src/App.tsx`.
- Standard pages use `pf-app`, `pf-page`, `pf-page-wide`, `pf-page-header`, `pf-panel`, `pf-panel-soft`,
  `pf-table-panel`, `pf-side-shell`, `pf-side-rail`, `pf-side-content`, and `pf-side-toc`.
- Styling should continue to use Tailwind utilities with paired `dark:*` variants plus the shared `pf-*` shell primitives.
- Do not make classic pages depend on `data-workspace-appearance` or workspace-only `pf-workspace-*` tokens.

Adding a third classic theme is not a small enum append. `ResolvedTheme` currently resolves only to `light | dark`, Tailwind
variant behavior depends on the root `dark` class, and component classes are written around that binary model. A new
non-light/dark classic theme must define the root state model, CSS selector strategy, utility-class interaction, fallback
behavior, and tests before implementation.

Classic theme verification must cover:

- `light`, `dark`, and `system` preference states. `system` is not a separate palette; verify it by emulating both
  `prefers-color-scheme: light` and `prefers-color-scheme: dark` while the root keeps `data-theme-preference="system"`.
- Public login/password setup page, initial app loading screen, authenticated standard pages, route redirects, and the
  wildcard fallback redirect.
- Classic `TopNav`: curtain handle, desktop nav, desktop More menu, right-side preference controls, account menu, mobile
  bottom nav, mobile More panel, locale/layout/theme controls, and logout.
- Standard page surfaces: page headers, side rails, panels, tables, filters, forms, dialogs, drawers, image previews,
  upload/drop zones, pagination, notifications, and destructive or permission-gated actions.
- Shared floating surfaces: confirmation dialogs, markdown editor overlays, save-to-resource-library dialog, media preview
  modals, notification layer, weather surface, profile/account menu, and route-specific drawers.
- UI states: hover, focus-visible, active/current, disabled, loading, empty, error, success, destructive, readonly, and
  permission-denied.
- Desktop and mobile viewport fit, including bottom navigation, mobile More panel, horizontal overflow, and safe-area bottom
  spacing.

Current classic page surfaces include:

- Public/auth surfaces: `/login`, password setup mode, initial session loading, unauthenticated redirects, and wildcard
  fallback redirect.
- Standard authenticated pages: `/inspirations`, `/inspirations/list`, `/inspirations/all`, `/workflow/templates`,
  `/resource-library`, `/resource-library/manage`, `/gallery`, `/gallery/browse`, `/gallery/manage`, `/status`,
  `/status/detail`, `/usage-stats`, `/usage-stats/detail`, `/settings`, `/settings/global-templates`, `/rbac`, and
  `/help`.
- Special creation/tool surfaces: `/inspirations/new`, `/inspirations/:inspirationId`,
  `/inspirations/:inspirationId/image-chat`, and `/image-chat` / `/image-chat/workbench`.
- Classic includes both standard `pf-app` pages and immersive workbench pages that use `pf-workspace` shells. Do not assume
  classic verification is limited to `pf-app`.
- Classic-compatible surfaces that may also render under `workspace` still need classic `light` / `dark` / `system`
  verification; compatibility does not replace classic coverage.

### Workspace

`workspace` is a full alternate product shell, not only a palette:

- Top-level workspace landing pages may be wired through `LayoutSchemeRoute` in `web/src/App.tsx` or through page-level
  `activeScheme` branches. Review both dispatch paths.
- First-level business navigation still targets real pages such as `/inspirations/list`, `/image-chat/workbench`,
  `/gallery/manage`, `/status/detail`, and `/usage-stats/detail`. Home section anchors belong only to the workspace home
  quick navigation.
- Workspace pages and subpages should use semantic `pf-workspace-*` and `pf-shell-*` classes backed by
  `web/src/index.css`, not hard-coded slate/indigo/violet surfaces.
- Workspace background motion is centralized in `UiLayoutSchemeProvider` and `web/src/lib/workspaceMotion.ts`; page-local
  pointer listeners are not allowed for workspace ambient effects.
- `login`, initial loading, and unauthenticated redirects remain outside the authenticated workspace shell unless a product
  requirement explicitly designs scheme-specific public pages.
- Do not assume `App.tsx` `LayoutSchemeRoute` is the only workspace dispatch mechanism. Some routes branch internally with
  `activeScheme`, so route audits must inspect both `App.tsx` and page-level layout branches.
- Workspace subpage controls must keep semantic control classes above broad glass-panel selectors. Primary, secondary,
  compact, icon, and destructive buttons should use semantic classes such as `pf-workspace-action-primary`,
  `pf-workspace-action-secondary`, and `pf-danger-action` so default, hover, focus-visible, active, and disabled states
  resolve through `--pf-*` tokens in `mist`, `sage`, and `dusk`. Broad selectors that flatten panels or cards must exclude
  `input`, `textarea`, `select`, `button`, and these semantic action classes; otherwise rounded buttons and inputs are
  painted as passive panels and lose their state styling.

Current workspace page surfaces include:

- Native workspace landing pages: `/inspirations`, `/resource-library`, `/image-chat`, `/gallery`, `/status`, and
  `/usage-stats`.
- Workspace subpages: `/inspirations/list`, `/inspirations/all`, `/resource-library/manage`, `/gallery/manage`,
  `/gallery/browse`, `/status/detail`, `/usage-stats/detail`, and `/settings`.
- Workspace-compatible classic pages: `/workflow/templates`, `/settings/global-templates`, `/rbac`, and `/help`.
- Special immersive tools: `/inspirations/:inspirationId`, `/image-chat/workbench`,
  `/inspirations/:inspirationId/image-chat`, and `/inspirations/new`.

## Workspace Visual Signature — Inputs & Buttons

The workspace layout intentionally uses **larger border-radius** and **pill-shaped buttons** as a visual differentiator
from the classic layout. These conventions are enforced via CSS scope overrides in `web/src/index.css` under
`:root[data-ui-layout-scheme="workspace"]`.

### Input Radius

| Token | Value | Scope |
|---|---|---|
| `--pf-radius-workspace-input` | `20px` | All inputs/textareas/selects under workspace scheme |

Mechanism:
- `.input-premium`, `.textarea-premium`, `.pf-shell-input`, and native `input`/`textarea`/`select` elements all receive
  `border-radius: var(--pf-radius-workspace-input)` when inside the workspace scheme selector.
- Classic scheme continues to use `--pf-radius-md` (14px) for `.input-premium`/`.textarea-premium`.
- **Do not hardcode** `rounded-md` / `rounded-lg` on workspace inputs. Use `.input-premium` or `.textarea-premium` class
  so the workspace override applies automatically.

### Button Radius

| Style | Radius | Description |
|---|---|---|
| `.btn-primary-spring` | `var(--pf-radius-pill)` (999px) | Primary action buttons become pill-shaped in workspace |
| `.btn-secondary-spring` | `var(--pf-radius-pill)` (999px) | Secondary buttons also become pill-shaped |
| `.btn-workspace-primary` | `var(--pf-radius-pill)` (999px) | Dedicated class: pill + indigo-600 bg + semibold |

Mechanism:
- Workspace scope overrides on `.btn-primary-spring` and `.btn-secondary-spring` add
  `border-radius: var(--pf-radius-pill)` so all spring buttons become pills.
- The standalone `.btn-workspace-primary` class provides a complete pill button style (indigo-600, white text, semibold,
  h-10, gradient in dark mode) for use in workspace-only components.
- **Do not hardcode** `rounded-lg bg-indigo-600` inline for action buttons in workspace pages. Use `.btn-primary-spring`
  or `.btn-workspace-primary` so radius and color both resolve through the token system.

### When to Use Each Button Class

| Scenario | Class |
|---|---|
| Standard primary action in any layout | `.btn-primary-spring` |
| Standard secondary action in any layout | `.btn-secondary-spring` |
| Workspace-only primary action (no classic fallback needed) | `.btn-workspace-primary` |

### Classic Scheme Isolation

These overrides are scoped exclusively to `[data-ui-layout-scheme="workspace"]`. Classic scheme buttons retain their
existing `border-radius` from `.btn-primary-spring` / `.btn-secondary-spring` base definitions (no pill shape).

---

## Adding A Workspace Appearance Theme

### Signatures

Update all appearance surfaces together:

- `web/src/lib/workspaceAppearance.ts`
  - `WORKSPACE_APPEARANCES`
  - `WorkspaceAppearance`
  - `WORKSPACE_APPEARANCE_METADATA`
  - `resolvedTheme`
  - `swatch`
- `web/src/lib/i18n.ts`
  - `workspaceAppearance.<id>.label`
  - `workspaceAppearance.<id>.description`
  - every supported locale currently present in the file.
- `web/src/index.css`
  - add a root selector:
    `:root[data-ui-layout-scheme="workspace"][data-workspace-appearance="<id>"]`.
- Tests near:
  - `web/src/lib/workspaceAppearance.test.ts`
  - `web/src/components/TopNav.test.ts` when the theme dock or compact action panel behavior changes.

### Required CSS Token Set

Every workspace appearance must define the same token set as the existing appearances:

- `--pf-top-chrome-safe-height`
- `--pf-bg`
- `--pf-bg-soft`
- `--pf-panel`
- `--pf-panel-soft`
- `--pf-border`
- `--pf-border-soft`
- `--pf-text`
- `--pf-muted`
- `--pf-subtle`
- `--pf-accent`
- `--pf-accent-2`
- `--pf-danger`
- `--pf-deep`
- `--pf-line`
- `--pf-line-strong`
- `--pf-workspace-glow`
- `--pf-shadow`

If the appearance is a dark reading theme, set `resolvedTheme: "dark"` so the existing `dark:*` utilities match the
workspace chrome. If it is a light reading theme, set `resolvedTheme: "light"`. Do not let a dark appearance render without
the root `dark` class, or mixed Tailwind utilities will produce inconsistent contrast.

### Required UI Coverage

New workspace appearances must be visually checked against these areas:

- Root, `body`, `#root`, ambient gradient, and `body::before` texture.
- `TopNav` workspace shell: brand area, first-level nav, More menu, notification surface, weather menu, profile menu,
  locale control, layout control, appearance/theme dock, compact action panel, and action ball.
- Workspace home: landing frames, section anchors, quick-nav bookmark drawers, latest lists, gallery strip, handoff chips,
  resource library summary, status/usage cards, empty/loading/error states.
- Workspace subpages: `pf-workspace-subpage`, frame shell, headers, cards, tables, filters, forms, pagination, destructive
  or moderation actions, preview panes, and dialog/drawer surfaces.
- Image-generation workbench pages: rails, session list, stage, drawer, composer, reference image panels, disabled actions,
  active session state, loading tasks, and error banners.
- Gallery/media surfaces: image cards, preview modal, moderation labels/actions, sensitive-image masks, and download links.
- Existing modal, drawer, and popover surfaces: `TopNav` weather, notification, profile, More menu, theme dock, compact
  action panel, gallery preview, resource-library preview/delete dialogs, save-to-resource-library dialog, inspiration
  image preview, tail split plan dialog, image-chat mobile session/history/action drawers, and inspiration-detail mobile
  bottom toolbar/sheets.
- Special immersive tool states: ReactFlow canvas, minimap, workflow status strip, inspector controls, workflow run controls,
  image-chat mobile bottom toolbar, session drawer, history drawer, generation settings sheet, and reference-image panels.

### State Coverage

For each changed workspace appearance, check all interactive states that can be themed:

- `hover`
- `focus-visible`
- `active`
- `disabled`
- `aria-current="page"`
- `aria-pressed="true" / "false"`
- `aria-expanded="true"`
- collapsed/open drawer or menu states
- loading, empty, error, destructive, and success feedback
- reduced-motion mode for animated workspace surfaces
- keyboard open/close, Escape behavior, focus return after popover/dialog close, focus trap where a modal owns interaction,
  screen-reader-only loading labels, and reduced-motion behavior for ambient animation and smooth scrolling

### Viewport Coverage

Workspace appearance verification must cover:

- Desktop at or above the full navigation width.
- Desktop near the compact breakpoint where nav items move into More.
- Mobile width where the action ball / compact panel and bottom-safe spacing are active.
- At least one light appearance and one dark appearance when a change touches shared workspace classes.
- At least one immersive tool page on mobile and one workspace-compatible classic page on mobile.
- Horizontal overflow and safe-area bottom spacing on mobile.

Use an independent Chrome profile/window or a DevTools isolated context for screenshots and viewport emulation. Do not reuse
the user's main browser window.

When validating page coverage in a browser, navigate through React Router links or full URL loads. Do not treat
`history.pushState(...)` plus a quick DOM sample as sufficient proof for lazy-loaded routes, authenticated redirects, or
route-level `Suspense` fallbacks.

Record the evidence with the URL, viewport, layout scheme, theme or appearance, root `data-*` attributes, page shell/main
class, and at least one visible DOM or interaction proof for the route. A screenshot without those state fields is not enough
for layout/theme verification.

## Component Color Contract (dusk Leak Prevention)

### Trigger

Any component-layer styling that paints a surface, border, or text color in `web/src/pages/` or `web/src/components/`.

### Why This Contract Exists

The theme axis (`light` / `dark`, via the root `dark` class) and the workspace appearance axis
(`data-workspace-appearance="mist|sage|dusk"`) are **independent**. A bare Tailwind neutral class such as
`border-slate-300` only understands the default value and its `dark:` variant. It does **not** know about the appearance
axis. `index.css` carries a `:root[data-ui-layout-scheme="workspace"][data-workspace-appearance="dusk"]` override block that
re-maps a fixed allow-list of bare neutral classes (for example `.border-slate-200`, `.bg-white`, `.text-slate-900`) onto
dusk tokens. Any bare neutral class **not** in that allow-list "leaks": under the dusk appearance it renders its light value,
producing a bright edge or panel on the warm-brown surface. This is the only color defect a user can actually see; it is not
caught by `tsc`, `pnpm build`, or unit tests.

### Convention: consume `pf-*` semantic classes, not bare neutral utilities

Semantic classes are defined in `web/src/index.css` after `.pf-table-panel` and resolve through `--pf-*` tokens in every
appearance:

| Semantic class | Token | light value (equals bare class) |
|---|---|---|
| `pf-surface` | `--pf-panel` | `bg-white` |
| `pf-surface-soft` | `--pf-panel-soft` | `bg-slate-50` / `bg-zinc-50` |
| `pf-ink` | `--pf-text` | `text-slate-900` / `text-slate-950` |
| `pf-ink-muted` | `--pf-muted` | `text-slate-500` |
| `pf-hairline` | `--pf-border-soft` | `border-slate-200` / `border-zinc-200` |
| `pf-hairline-strong` | `--pf-border` | `border-slate-300` |

**Key property**: in `light` these tokens are pixel-equal to the listed bare class, so a bare→`pf-*` swap is visually neutral
in `light` and `dark` while it makes `dusk` (and `mist` / `sage`) resolve correctly. When you swap a bare class that has a
paired `dark:` variant (for example `border-slate-300 dark:border-slate-700`), **keep the `dark:` variant**: it still wins on
the theme axis so dark chrome is unchanged, and the `pf-*` base only repaints under the appearance axis.

### Migration Recipe (incremental, per-file verified)

- Map: `text-slate-950/900/800` → `pf-ink`; `text-slate-700/600/500/400` → `pf-ink-muted`; solid `bg-white` → `pf-surface`;
  `bg-slate-50` / `bg-zinc-50` → `pf-surface-soft`; `border-slate-200` / `border-zinc-200` → `pf-hairline`;
  `border-slate-300` → `pf-hairline-strong`. Delete the paired `dark:` variant **only** for surface/ink classes that the
  `pf-*` token already covers; keep `dark:` border variants when their value differs from `--pf-border`'s dark value.
- **Leave alone** (not clean leaks; converting hurts more than it helps): translucent variants (`bg-white/80`, `/55` scrims —
  going solid loses the frosted effect), non-neutral semantic colors (`emerald`/`indigo`/`violet`/`rose`/`amber`), decorative
  hairline separators / drag handles, `bg-slate-950` intentional dark code blocks, status dots like `bg-zinc-400`, skeleton
  fills `bg-slate-200`, and high-contrast active states like `bg-slate-900 text-white`.
- A bare neutral class lives in a shared class-constant `.ts` file too (for example `web/src/pages/settings/components/styles.ts`).
  Scan `.ts`, not only `.tsx`, or the constant leaks across every page that reuses it.
- After each file: `just web-build` + `node web/scripts/check-bare-colors.mjs --update`. Once a page reaches zero leaks, the
  matching dusk override selector in `index.css` may be removed.

### Ratchet Guard

`web/scripts/check-bare-colors.mjs` counts bare neutral classes per file against `web/scripts/bare-colors-baseline.json`.
Run `node web/scripts/check-bare-colors.mjs` to verify (fails if any file exceeds its baseline) and
`node web/scripts/check-bare-colors.mjs --update` to re-tighten the baseline after a migration. The guard is branch-agnostic:
it blocks net-new bare colors and records reductions. It is not yet wired into `package.json` / CI.

### How To Detect A True Leak

A true leak is a bare neutral class that is **not** in the dusk override allow-list, after stripping `dark:` / `hover:` /
`focus:` variants. Extract the allow-list from the `data-workspace-appearance="dusk"` block in `index.css` and diff against
the classes a component actually uses; do not rely on memory of which classes are covered.

## Adding A New UI Layout Scheme

### Signatures

Adding a new layout scheme changes a cross-layer contract. Update all of these together:

- Backend:
  - `backend/src/inspiration_one_backend/domain/ui_layout.py`
  - runtime config definition for `ui_layout_scheme` in `backend/src/inspiration_one_backend/config.py`
  - settings/user preference validation and serialization paths
  - backend tests that assert supported schemes, config options, and `PATCH /api/settings/ui-preferences`.
- Frontend:
  - `web/src/lib/uiLayoutScheme.ts`
  - `web/src/lib/uiLayoutSchemePreference.tsx`
  - `web/src/lib/types.ts` when DTO typing narrows or documents allowed values
  - `web/src/lib/i18n.ts` layout label/description keys for every supported locale
  - `web/src/App.tsx` route dispatch
  - `web/src/components/TopNav.tsx` shell selection, menu targets, icon mapping, overflow behavior, and preferences UI
  - page-level shell branches that currently check `activeScheme === "workspace"`
  - `web/src/index.css` root data selectors and semantic shell classes
  - focused frontend tests for helper resolution, route/nav behavior, and page-specific helpers.

Do not rely on the current binary fallback:

```tsx
const shellScheme = activeScheme === "workspace" ? "workspace" : "classic";
```

A new scheme silently falls into classic anywhere this pattern remains. Replace binary checks with explicit mapping or an
exhaustive switch for every route, nav shell, shell class, page variant, and preference control that supports the new scheme.

### Required Page Contract

Before implementation, write the route map for the new scheme. For every authenticated first-level route, declare one of:

- native page variant for the new scheme,
- shared classic page with an explicit compatibility decision,
- shared workspace page with an explicit compatibility decision,
- unsupported route with the redirect or fallback behavior.

At minimum review these routes:

- `/login`
- `/inspirations`
- `/inspirations/list`
- `/inspirations/all`
- `/inspirations/new`
- `/workflow/templates`
- `/image-chat`
- `/image-chat/workbench`
- `/inspirations/:inspirationId`
- `/inspirations/:inspirationId/image-chat`
- `/resource-library`
- `/resource-library/manage`
- `/gallery`
- `/gallery/browse`
- `/gallery/manage`
- `/status`
- `/status/detail`
- `/usage-stats`
- `/usage-stats/detail`
- `/settings`
- `/settings/global-templates`
- `/rbac`
- `/help`
- `*` fallback redirect

Also review non-route rendered states:

- initial session loading screen,
- route-level `Suspense` fallback,
- unauthenticated redirect to `/login`,
- authenticated default redirect when menu/RBAC access is missing.

Permission-gated routes such as `/rbac`, `/inspirations/new`, and `/settings/global-templates` need two browser checks:
one context with the required menu/API permission that proves the page shell renders, and one context without the grant that
proves the redirect or fallback is intentional.

Special workbench pages such as `ImageChatPage` and `InspirationDetailPage` use dedicated immersive shells. They must not be
assumed to work just because the list/detail pages render.

### Required Menu Contract

For the new scheme, define all navigation targets and visibility rules:

- Top-level nav items in `TopNav` must keep `menuCode`, `requiredPermission`, `hasAccess`, `priority`, icon, and active
  matching aligned with backend route gates.
- If scheme-specific targets differ, extend the target model beyond the current `workspaceTo` shape. Do not overload
  `workspaceTo` for a third scheme.
- Brand link behavior must be explicit. Workspace currently returns to `/inspirations` without a hash; other schemes need
  the same kind of documented rule.
- Desktop full nav, compact desktop nav, More menu, mobile bottom nav, mobile More panel, theme/layout controls, account
  menu, notification shell, weather shell, and logout must all be checked.
- Home in-page anchors must stay separate from first-level page navigation. If the new scheme has home anchors, give them a
  dedicated quick-nav surface and tests.

### Required Data / Configuration Contract

New schemes must keep default, runtime, and user preference behavior aligned:

- Unknown or missing scheme resolves to `classic` unless a new fallback policy is explicitly designed.
- Global runtime default comes from `ui_layout_scheme`.
- Per-user preference is saved through `GET/PATCH /api/settings/ui-preferences`.
- `UiLayoutSchemeProvider` owns the active scheme and writes `data-ui-layout-scheme` on the root.
- Scheme-specific visual preferences must be separate from account/API payloads unless product requirements say otherwise.
  Workspace appearance is local browser state; it must not be confused with the server-saved `ui_layout_scheme`.
- Settings UI must show the new scheme label/description and must not expose unsupported schemes.
- Settings must visibly distinguish the global runtime default `ui_layout_scheme` from the current user's active/default
  preference. A page must not label runtime configuration as the user's current layout. Verify the setting with
  `/api/settings/runtime`, `/api/settings/ui-preferences`, and `document.documentElement.dataset.uiLayoutScheme` in the
  same browser context.
- If a dedicated layout preference component exists, verify it is actually mounted on the settings surface that users see.
  Component-level tests for an unmounted control do not prove settings-page behavior.

### Required Style Contract

Every new layout scheme needs a semantic shell vocabulary before broad page adoption:

- Root selector tied to `data-ui-layout-scheme="<scheme>"`.
- Page shell class.
- Subpage frame class.
- Top navigation shell class.
- Compact/mobile control classes.
- Surface/card/table/form/dialog/menu/drawer classes.
- Action button, icon button, status badge, alert, and destructive-action classes.
- Explicit light/dark or appearance-token behavior for every class that uses fixed colors.

Avoid copying workspace CSS selectors and changing only color values. A new scheme should either reuse the existing semantic
shell intentionally or introduce its own named semantic classes with a bounded page list.

### Required Tests

Add or update focused tests for:

- frontend scheme resolver and metadata,
- `UiLayoutSchemeProvider` loading, saving, root attribute, and save-error rollback,
- backend supported scheme resolver and settings options,
- user UI preference API accepts the new scheme and rejects unknown values,
- route dispatch in `App.tsx`,
- `TopNav` scheme-specific targets, overflow behavior, mobile More panel, and preference controls,
- at least one mounted interaction test or browser verification covering Settings plus `TopNav`: desktop layout switch,
  mobile action ball layout switch, settings layout/appearance section, root `data-ui-layout-scheme`, and runtime-default
  versus user-preference display,
- home quick-nav anchor generation and permission filtering when the scheme has home anchors,
- page-local helpers for any new shell-specific URL generation or state derivation,
- mechanical i18n coverage for every locale in `LOCALES`; adding a scheme, appearance, button, status, or aria label must
  fail tests or review if any locale table is missing the key. CSS-generated text such as `content:` and language-specific
  pseudo-elements counts as visible UI text and must be covered by the same locale review.

Validation commands for broad layout work:

```bash
pnpm --dir web lint
pnpm --dir web test:run
just web-build
uv run --directory backend pytest tests/test_ui_layout_scheme.py tests/test_auth_settings_runtime_config.py
```

Add more focused backend or frontend tests when route gates, DTOs, or page behavior changes.

## Validation & Error Matrix

- Unknown layout scheme from backend or local state -> frontend resolves to `classic`; backend resolves to the configured
  default or rejects invalid write payloads according to the owning API.
- Unknown workspace appearance in local storage -> resolves to `mist`.
- Missing workspace appearance CSS token -> theme is incomplete; do not ship.
- New layout scheme accepted by frontend but rejected by backend -> settings save/user preference flow is broken.
- New layout scheme accepted by backend but missing frontend route/nav branch -> user may silently get classic; treat as a
  failed implementation.
- New visible UI text without every locale key -> failed implementation.
- Workspace dark appearance without `resolvedTheme: "dark"` -> failed contrast implementation.
- Theme or layout visual change without independent-browser screenshot review -> incomplete verification.
- Bare neutral class (for example `border-slate-300`) outside the dusk override allow-list -> dusk leak: bright edge/panel on
  warm chrome; use the matching `pf-*` semantic class instead.
- `node web/scripts/check-bare-colors.mjs` reports a file above its baseline -> net-new bare color; convert to `pf-*` before
  merge.

## Good / Base / Bad Cases

- Good: a new workspace appearance adds metadata, i18n keys, the full token set, updated appearance tests, and desktop/mobile
  screenshots for workspace home, image chat, gallery, settings, and help.
- Good: a new layout scheme adds a route map, explicit nav targets, root CSS selectors, settings/user-preference support,
  backend/frontend resolver tests, and a documented fallback for pages not yet native to the scheme.
- Base: a page intentionally reuses the classic implementation under a new scheme, but the decision is explicit in the route
  map and still passes nav, theme, viewport, and i18n checks.
- Bad: adding a value to `UI_LAYOUT_SCHEMES` while `TopNav`, `App`, and page shells still use binary
  `activeScheme === "workspace"` checks.
- Bad: adding a workspace appearance only to `WORKSPACE_APPEARANCE_METADATA` without root CSS tokens.
- Bad: mapping first-level nav to `/inspirations#...` while the scheme expects real business pages.
- Bad: hard-coding new labels in page JSX or CSS `content` when the text belongs in i18n.
- Bad: a component paints a structural surface/border/text with a bare neutral class outside the dusk allow-list (for example
  `border-slate-300`), so the element leaks bright under the dusk appearance.
- Good: a structural border uses `pf-hairline-strong` and keeps its paired `dark:border-slate-700`, so `light`/`dark` are
  unchanged and `dusk` resolves to the warm token.

## Review Checklist

Before reporting layout/theme work complete:

- [ ] The scheme/theme source of truth is updated in both code and tests.
- [ ] Backend settings/runtime/user-preference contracts are synchronized when layout schemes change.
- [ ] `TopNav` targets, active states, overflow, compact/mobile controls, brand link, and account/logout surfaces are checked.
- [ ] Every affected page has an explicit shell decision and no silent classic fallback.
- [ ] All visible UI chrome is localized in every supported locale.
- [ ] Root `data-*` attributes and CSS selectors match the provider behavior.
- [ ] Light/dark/appearance contrast is checked for hover, focus, active, disabled, expanded, loading, empty, error, and
  destructive states.
- [ ] New/changed components consume `pf-*` semantic classes for structural surface/border/text; any remaining bare neutral
  class is an intentional exception (translucent, non-neutral, decorative, or high-contrast) and `node web/scripts/check-bare-colors.mjs` does not exceed baseline.
- [ ] Desktop and mobile screenshots come from an independent browser window/profile or isolated context.
- [ ] `pnpm --dir web lint`, `pnpm --dir web test:run`, and `just web-build` pass or any unrelated pre-existing failure is
  documented with a narrower validation that covers the change.
