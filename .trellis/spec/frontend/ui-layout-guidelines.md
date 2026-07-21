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

## Layout-Sensitive Component Family Ownership

Use this gate before touching any layout-sensitive control:

- Text inputs, prompt inputs, autosize canvas textareas, `textarea`, `select`, searchable dropdown inputs, date/time or
  range pickers, checkbox, radio-like option toggles, switches, command buttons, icon buttons, and button-like upload/drop
  surfaces.
- Shared dialogs, drawers, popovers, resource-library surfaces, image-generation settings panels, markdown editors, and
  page-local leaf components that can render below more than one layout scheme.

Contract:

- The route/page owner decides the active component family from a real layout source of truth: `LayoutSchemeRoute`,
  `activeScheme`, `useUiLayoutScheme()`, or an explicit `appearance: "classic" | "workspace"` prop already chosen by a
  caller.
- `Classic*` controls are the final implementation only for confirmed classic branches. They must keep the classic
  light/dark theme contract and must not depend on `pf-workspace-*`, `data-workspace-appearance`, or workspace-only input
  tokens.
- `Workspace*` controls are the final implementation only for confirmed workspace branches. They must use workspace
  semantic classes/tokens and must not rely on classic controls being repainted by broad root selectors.
- Shared leaves must not pick a family by themselves. They either receive `appearance: "classic" | "workspace"` and branch
  internally, or receive already-selected layout-specific components/classes from the owner.
- Compatibility bridges, root CSS fallbacks, and `Workspace*` components that delegate to classic remain migration aids
  only. They do not satisfy this contract when the caller already knows the active layout.
- Shell names are not layout proof. `pf-workspace`, `pf-workspace-subpage`, `pf-side-shell`, a workbench directory, or an
  immersive visual shell can still render while the root scheme is classic.
- Side-rail or left-column navigation entries remain navigation even when they are clickable and visually prominent.
  Settings sections, help doc page entries, resource-library group rails, and template-management category rails must stay
  on page-level navigation classes with `aria-current="page"`, not on `ClassicActionButton`, `WorkspaceActionButton`,
  `LayoutActionSurfaceButton`, or other action-button helpers. Edit/delete icons beside a nav row remain action buttons.
- Compact viewport side rails (`<lg` / `min-width: 1024px` false) that would otherwise stack long group/category lists above
  primary content should use a left floating trigger + left drawer, matching resource-library groups and template-management
  categories. Keep primary filters on the main column when the rail holds more than navigation. Classic and workspace branches
  must still pick control families from the matrix below; drawer chrome may reuse tokenized `pf-resource-library-mobile-groups-*`
  surfaces, but inputs/actions inside remain layout-specific.

Required family matrix:

| Current render branch | Inputs/selects/toggles | Buttons/action surfaces | Shared leaf requirement |
| --- | --- | --- | --- |
| Confirmed `classic` | `ClassicTextInput`, `ClassicTextarea`, `ClassicSelectField`, `ClassicCheckbox`, `ClassicOptionToggle`, `ClassicSwitch`, `ClassicDateTimeRangeField`, or `LayoutDateTimeRangeField` with `appearance="classic"` | `ClassicActionButton`, `classicActionButtonClassName(...)`, `classicActionSurfaceClassName(...)` | Pass `appearance="classic"` or pass selected classic helpers |
| Confirmed `workspace` | `WorkspaceTextInput`, `WorkspaceTextarea`, `WorkspaceSelectField`, `WorkspaceCheckbox`, `WorkspaceOptionToggle`, `WorkspaceSwitch`, `WorkspaceDateTimeRangeField`, or `LayoutDateTimeRangeField` with `appearance="workspace"` | `WorkspaceActionButton`, `workspaceActionButtonClassName(...)`, `workspaceActionSurfaceClassName(...)` | Pass `appearance="workspace"` or pass selected workspace helpers |
| Unknown or mixed | No component family may be chosen yet | No component family may be chosen yet | Trace the caller and add an explicit layout contract |

Blocking cases:

- A known classic branch imports `WorkspaceTextInput`, `WorkspaceTextarea`, `WorkspaceSelectField`, `WorkspaceCheckbox`,
  `WorkspaceOptionToggle`, `WorkspaceSwitch`, `WorkspaceDateTimeRangeField`, or workspace action helpers as the final
  control path, instead of branching to `Classic*` or `LayoutDateTimeRangeField`.
- A known workspace branch leaves `ClassicTextInput`, `ClassicTextarea`, `ClassicSelectField`, `ClassicCheckbox`,
  `ClassicOptionToggle`, `ClassicSwitch`, or classic action helpers as the final control path.
- A shared component defaults `appearance` to `"workspace"`, `"classic"`, or a visual guess instead of making the caller
  choose.
- A page-local class rewrites shared border, background, color, placeholder, focus, disabled, error, radius, or shadow
  states that belong to the selected component family.

Validation:

- For each touched page or shared component, search for the opposite family imports and raw layout-sensitive controls before
  handing off.
- Boundary tests such as `web/src/pages/buttonLayoutBoundaries.test.ts` should fail when a migrated route regresses to an
  implicit bridge, a workspace-only helper in classic, or a missing explicit `appearance` for a shared leaf.
- Documentation-only updates use `git diff --check`; frontend implementation updates also run `pnpm --dir web lint`,
  `pnpm --dir web test:run`, and `just web-build` unless a narrower gate is explicitly justified.

## Loading Shell and Route Profile Contract

- Session bootstrap remains in the classic global theme because layout preference is unavailable before authentication.
- Session lookup and current-path page-module prefetch start independently. Static route prefetch never calls protected
  business APIs.
- Scheme-branched paths preload both candidate page modules while the scheme is unresolved, then render only the selected
  classic/workspace branch after preference resolution or explicit classic fallback.
- `web/src/routes/pageModules.ts` is the single source for route id, path matching priority, classic/workspace loader,
  skeleton profile, navigation target, and active nav id. `App.tsx` and `TopNav.tsx` consume that registry instead of
  maintaining loader/path copies.
- Route fallbacks use `PageLoadingSkeleton` profiles that approximate the destination shell (`auth`, `list`, `grid`,
  `analytics`, `side-rail`, `workbench`, or workspace landing). A generic centered spinner is not a route content fallback.
- Page chrome and immediately usable navigation stay outside query content branches. Independent page regions use their own
  `AsyncContent` state and may finish separately.
- Shared skeletons use `.pf-skeleton`, begin shimmer after approximately `150ms`, and stop animation under
  `prefers-reduced-motion: reduce`. Do not restore `.animate-shimmer` or page-local neutral shimmer colors.
- TopNav compact controls may use a spinner for their own first read, search, or explicit refresh. Cached weather remains
  represented by its weather icon while a refresh runs; a provider refresh must not mark the whole navigation busy.

Validation:

- Cover route matcher/profile selection, loader rejection/retry, boundary reset, bootstrap/layout resolving shells, and
  navigation target prefetch with focused tests.
- Audit page roots for data-loading early returns that unmount `TopNav`, toolbars, side rails, or workbench geometry.
- Search `Loader2`, `animate-pulse`, and query status fields before handoff. Remaining spinners must be action, search,
  upload, explicit refresh, or durable task-progress feedback.
- Run `node web/scripts/check-bare-colors.mjs`; new skeleton or status surfaces must use `pf-*` structural tokens.

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

## Classic Visual Signature — Buttons

Classic buttons are part of the default app shell language. They should read closer to TopNav controls, page tools, and
panel actions than to workspace pills.

### Classic Button Radius

| Style | Radius | Description |
| --- | --- | --- |
| `ClassicActionButton` / `classicActionButtonClassName(...)` | `var(--pf-radius-sm)` (8px) | Classic primary / secondary / danger action buttons |
| `classicActionSurfaceClassName(...)` | `var(--pf-radius-sm)` (8px) | Classic button-like surfaces such as upload/drop zones |

Mechanism:

- Classic buttons must resolve through a classic-only component layer. Do not reuse workspace button classes in classic
  routes just because the JSX structure is similar.
- The target entry points are `ClassicActionButton`, `classicActionButtonClassName(...)`, and
  `classicActionSurfaceClassName(...)`. Until implementation lands, treat this as the required end state.
- Classic buttons use `--pf-panel`, `--pf-panel-soft`, `--pf-border`, `--pf-line-strong`, `--pf-text`, and `dark:*`
  variants. They must not depend on `data-workspace-appearance` or workspace-only `pf-workspace-*` tokens.
- Classic primary buttons should remain clearly actionable, but keep a small-to-medium radius, restrained shadow, and tool-button
  density closer to `TopNav` than to workspace floating action pills.
- Classic secondary buttons should look like standard app controls: medium radius, 1px border, panel-based background,
  subtle hover tint, and low lift.
- Classic danger buttons keep warning color semantics while preserving the same classic radius and interaction strength.
- Icon and compact classic buttons should share the same density as classic page headers, side rails, and tool rows.
- Shared leaf components that render in both layouts must branch explicitly by active layout or receive an explicit
  `appearance` prop. A single unscoped button class is not an acceptable cross-layout solution.
- Immersive creation/workbench pages such as `/inspirations/new`, `/image-chat/workbench`, and
  `/inspirations/:inspirationId` still need an explicit scheme check. Their shell may look like workspace, but the root
  route can still be classic.
- Keep the executable source guard at `web/src/pages/buttonLayoutBoundaries.test.ts` in sync when expanding these
  classic immersive routes or their page-local leaf components. The guard must fail if those files re-import the legacy
  `ActionButton` bridge, pull in workspace button helpers directly, or omit explicit `appearance="classic"` on shared
  resource-library dialogs used from classic-only routes.

### Classic Button Interaction

- Hover should emphasize tint and border change first; any lift should be smaller than workspace and may be zero.
- Active should read as a compact press, not a floating card collapse.
- Focus-visible must remain obvious in both `light` and `dark`.
- Upload/drop zones that are visually button-like should use the classic surface helper instead of a workspace surface or
  ad-hoc page-local chrome.

## Image Chat Button Hierarchy

Use this contract for `/image-chat/workbench` and `/inspirations/:inspirationId/image-chat` in both `classic` and
`workspace` render branches.

- Keep only these flows on `primary` action buttons:
  - session creation entry points labeled `chat.newSession` / `chat.newSessionShort`
  - history or mobile draft entry points labeled `chat.newRound` / `chat.newRoundShort`
  - normal generation submit buttons labeled `chat.startGenerate` / `chat.startGenerateCount`
- Treat prompt polish, polished-prompt apply, rename/save session name, result-to-library save, attach-as-reference,
  set-main-source, enhance result reuse, regenerate-cancelled-task, and modal confirmation choices as non-primary
  actions. Use `secondary` unless the action is destructive.
- When the mobile floating CTA switches from "new round" into a sheet opener or other helper affordance, demote it from
  `primary` unless it is still the direct generation submit button.
- `chat.enhance.start` reuses the same action slot as generation submit but is not automatically a primary CTA. Keep it
  on `secondary` unless product explicitly promotes enhance submit to a top-level action in both layouts.
- Validation: search `web/src/pages/ImageChatPage.tsx` and `web/src/pages/image-chat/*.tsx` for `preset="primary"`.
  Remaining page-local `primary` usage should map only to create-session, new-round, and normal generate entry points.

## Classic Visual Signature — Inputs

Classic inputs are part of the default app shell language. They should stay aligned with `input-premium`,
`textarea-premium`, `TopNav`, and other classic panel controls instead of inheriting workspace glass/pill styling.

### Layout-Specific Component Selection Rule

- Layout ownership is determined by the route/page contract or the caller's explicit branch, not by which wrapper
  happens to render acceptably under root CSS.
- When a page or route is known to be classic in the current render branch, use `Classic*` input/button helpers
  directly. Do not treat `Workspace*` components falling back to classic as the preferred classic API.
- When a page or route is known to be workspace in the current render branch, use `Workspace*` input/button helpers
  directly. Do not keep classic controls in place just because workspace root selectors can restyle some of them.
- Shared leaf components, dialogs, drawers, and composite panels that may render in both layouts must either:
  - branch explicitly by active scheme at the owner boundary, or
  - accept an explicit `appearance: "classic" | "workspace"` prop and choose the component family internally.
- Compatibility bridges such as `Workspace*` delegating to `Classic*`, legacy `ActionButton`, or root-scope CSS
  fallbacks exist for migration/backward compatibility. They are not sufficient as the long-term layout-selection
  mechanism when the caller already knows the active layout.
- Do not infer classic/workspace ownership from shell class names such as `pf-workspace`, `pf-workspace-subpage`,
  panel styling, or directory names. Immersive pages can still render under the classic root layout.

### Input Family Boundary

- The workspace input family is valid only in a confirmed workspace render branch:
  `WorkspaceTextInput`, `WorkspaceTextarea`, `WorkspaceSelectField`, `WorkspaceCheckbox`, `WorkspaceOptionToggle`,
  `WorkspaceSwitch`, `WorkspaceDateTimeRangeField`, and workspace-only settings input class helpers.
- The classic input family is valid only in a confirmed classic render branch:
  `ClassicTextInput`, `ClassicTextarea`, `ClassicSelectField`, `ClassicCheckbox`, `ClassicOptionToggle`,
  `ClassicSwitch`, `ClassicDateTimeRangeField`, and future classic date/time or range-picker wrappers.
- `LayoutDateTimeRangeField` is the allowed shared adapter for date/time ranges. It must require an explicit
  `appearance: "classic" | "workspace"` prop from the owner and must use layout-neutral DOM class names such as
  `pf-datetime-range-*` / `pf-time-*` instead of `pf-workspace-*`.
- Date/time pickers, select triggers, searchable dropdown inputs, checkbox/radio-like toggles, prompt textareas, and
  canvas autosize textareas are all layout-sensitive input controls. Do not treat only plain `<input type="text">` as
  covered by this rule.
- A classic branch must not import a `Workspace*` input as its final implementation even when that component currently
  delegates to `Classic*`. Add a `Classic*` wrapper or a layout-aware adapter such as `LayoutDateTimeRangeField`
  instead.
- A workspace branch must not leave a `Classic*` input as its final implementation merely because root workspace CSS can
  repaint native controls.
- Shared components must not default `appearance` to `"workspace"` or infer it from wrapper CSS. The owner route/page
  must pass `appearance`, or the owner must branch on `activeScheme` and pass the selected component family down.
- Page-level sizing is allowed through component props such as `size`, `className`, `inputClassName`, `minRows`,
  `minHeight`, or wrapper width classes. Page code must not redefine the shared border, background, color, placeholder,
  focus, disabled, or error visual contract.

Required decision order:

1. Read the active layout from a real source of truth:
   - route/page contract such as `LayoutSchemeRoute`
   - page-level `activeScheme` / `useUiLayoutScheme()` branch
   - explicit `appearance` prop already chosen by the caller
2. If the current render branch is known:
   - classic -> choose `Classic*` directly
   - workspace -> choose `Workspace*` directly
3. If the same leaf needs to render in both layouts:
   - branch at the owner boundary and pass the chosen component family down, or
   - require `appearance: "classic" | "workspace"` on the leaf and branch inside it
4. If none of the above is available, stop and trace the actual caller/route contract. Do not guess from shell CSS,
   folder names, or the page looking like a workbench.

Wrong:

```tsx
// Classic route branch, but still relying on the workspace bridge because it "looks fine".
<WorkspaceTextInput value={query} onChange={(event) => setQuery(event.target.value)} />
```

Correct:

```tsx
const LayoutTextInput = activeScheme === "workspace" ? WorkspaceTextInput : ClassicTextInput;

<LayoutTextInput value={query} onChange={(event) => setQuery(event.target.value)} />
```

Wrong:

```tsx
export function SharedFilterRow() {
  return <WorkspaceSelectField options={options} value={value} onChange={setValue} />;
}
```

Correct:

```tsx
export function SharedFilterRow({
  appearance,
}: {
  appearance: "classic" | "workspace";
}) {
  const LayoutSelectField = appearance === "workspace" ? WorkspaceSelectField : ClassicSelectField;
  return <LayoutSelectField options={options} value={value} onChange={setValue} />;
}
```

### Classic Input Entry Points

| Entry | Description |
| --- | --- |
| `ClassicTextInput` / `classicTextInputClassName(...)` | Classic short text inputs |
| `ClassicTextarea` / `classicTextareaClassName(...)` | Classic long text / prompt inputs with autosize support |
| `ClassicSelectField` | Classic wrapper around `SelectField` for density and sizing |
| `ClassicCheckbox` | Classic checkbox wrapper for inline or card-like boolean fields |
| `ClassicOptionToggle` | Classic pill/card toggle for multi-select or radio-like option groups |
| `ClassicSwitch` | Classic binary switch control |

Mechanism:

- Preferred classic input entry points live in `web/src/components/classicInputs.tsx`.
- `ClassicTextInput` and `ClassicTextarea` must use `.input-premium` / `.textarea-premium` as the base visual contract.
  They may add size, prompt, autosize, or layout classes, but must not depend on workspace-only `pf-workspace-*` tokens.
- `ClassicTextarea` with `variant="prompt"` must keep a layout-specific writing-surface treatment:
  - classic `light` uses a mist-inspired pale surface with dark readable ink
  - classic `dark` keeps the existing deep slate writing surface
  - do not reuse the workspace prompt gradient directly in classic
- `ClassicSelectField` should keep search, keyboard navigation, and floating-menu behavior inside `SelectField`. The
  classic wrapper only owns sizing/density hooks and must not fork the listbox interaction model.
- `ClassicOptionToggle` and `ClassicSwitch` must reuse the existing `.pf-settings-option-toggle*` and
  `.pf-settings-switch-toggle*` classic interaction classes. Do not duplicate checked/hover/focus/disabled state strings
  page-by-page.
- `ClassicCheckbox` may share structural helpers with workspace, but its wrapper/text surfaces must stay on the classic
  light/dark theme model instead of workspace appearance tokens.
- New classic-sensitive code should prefer explicit `Classic*` imports. Shared compatibility adapters such as
  `WorkspaceTextInput` may delegate to `Classic*` internally when the active layout is not workspace, but that bridge is
  for reuse compatibility, not the preferred long-term classic API.
- Known classic pages must not import `WorkspaceTextInput`, `WorkspaceTextarea`, `WorkspaceSelectField`,
  `WorkspaceCheckbox`, `WorkspaceOptionToggle`, or `WorkspaceSwitch` as their final layout choice. If both layouts are
  possible, keep the explicit branch in the caller or pass `appearance="classic"` into the shared leaf.
- If a shared leaf component needs to render in both layouts, branch by active scheme or require an explicit appearance
  prop. Do not infer classic/workspace eligibility from shell CSS such as `pf-workspace`, `pf-workspace-subpage`, or
  directory names.
- If a classic immersive route must still preserve workspace rendering in the same file tree, use a thin layout adapter
  such as `web/src/components/layoutActionButtons.ts` that maps `appearance` to `Classic*` / `Workspace*` helpers. The
  adapter must stay a pure branch layer; it must not infer from shell CSS or revive legacy `ActionButton` as the default.

## Workspace Visual Signature — Inputs & Buttons

The workspace layout intentionally uses **larger border-radius** and **pill-shaped buttons** as a visual differentiator
from the classic layout. These conventions are enforced via CSS scope overrides in `web/src/index.css` under
`:root[data-ui-layout-scheme="workspace"]`.

### Input Radius

| Token | Value | Scope |
| --- | --- | --- |
| `--pf-radius-workspace-input` | `20px` | All inputs/textareas/selects under workspace scheme |

Mechanism:

- `.input-premium`, `.textarea-premium`, `.pf-shell-input`, and native `input`/`textarea`/`select` elements all receive
  `border-radius: var(--pf-radius-workspace-input)` when inside the workspace scheme selector.
- Classic scheme continues to use `--pf-radius-md` (14px) for `.input-premium`/`.textarea-premium`.
- **Do not hardcode** `rounded-md` / `rounded-lg` on workspace inputs. Use `.input-premium` or `.textarea-premium` class
  so the workspace override applies automatically.
- The preferred workspace input entry points live in `web/src/components/workspaceInputs.tsx`:
  - `WorkspaceTextInput`
  - `WorkspaceTextarea`
  - `WorkspaceSelectField`
  - `WorkspaceCheckbox`
  - `WorkspaceOptionToggle`
  - `WorkspaceSwitch`
- Use the shared `size` variants (`compact | default | tall`) and page-level `className` width/layout adjustments. Do not
  re-declare border/background/focus/disabled visuals in page-local class constants for workspace forms.
- `WorkspaceTextarea` owns autosize and prompt-variant behavior. Do not recreate per-page autosize hooks when a workspace
  text field only needs `autosize`, `minRows`, `maxRows`, or `variant="prompt"`.
- `WorkspaceSelectField` is a thin wrapper around `SelectField`. Keep option search, keyboard navigation, and floating
  menu behavior in `SelectField`; workspace pages should only choose size/layout hooks through the wrapper.
- Use `WorkspaceOptionToggle selectionMode="single"` for radio-like option groups such as strategy, aspect, resolution, or
  scale choices. Keep the default multi-select mode for permission/resource-group checklists.
- Shared pickers that still need classic compatibility, such as `ImageSizePicker`, should opt into workspace controls
  through an explicit prop instead of changing their default rendering for every caller.
- Shared long-text editors that may render in classic and workspace, such as `MarkdownEditor`, should expose an explicit
  workspace-only appearance prop instead of flipping every caller to workspace input chrome by default.
- Shared composite settings panels that embed multiple inputs, such as `ImageGenerationSettingsPanel` and
  `ImageToolControls`, should also use an explicit workspace appearance prop when the same component must keep classic
  callers on their existing control styling.
- Known workspace pages must not leave layout-sensitive inputs on `Classic*` components as their final implementation
  path once the page has an explicit workspace branch. Keep the branch at the page boundary or pass
  `appearance="workspace"` through the shared leaf/component tree.
- Workspace native `textarea` surfaces must use the same `--pf-radius-workspace-input` as short inputs. Do not leave
  workspace textareas on the classic `--pf-radius-md` fallback.

### Workspace Buttons

| Style | Radius | Description |
| --- | --- | --- |
| `WorkspaceActionButton` / `workspaceActionButtonClassName(...)` | `var(--pf-radius-pill)` (999px) | Workspace primary / secondary / danger actions |
| `workspaceActionSurfaceClassName(...)` | `var(--pf-radius-pill)` (999px) | Workspace button-like surface for upload/drop zones and other non-button interactions |
| Legacy `ActionButton` / `actionButtonClassName(...)` | classic default, workspace under root scope | Compatibility adapter for existing callers during migration |
| `.btn-primary-spring` | `var(--pf-radius-pill)` (999px) | Legacy spring primary button still supported during migration |
| `.btn-secondary-spring` | `var(--pf-radius-pill)` (999px) | Legacy spring secondary button still supported during migration |

Mechanism:

- Workspace buttons must resolve through a workspace-only component layer for new code.
- `ActionButton.tsx` remains as a legacy compatibility adapter. Its legacy `pf-action-button*` / `pf-action-surface*`
  classes now render classic by default and switch to workspace visuals only when the root carries
  `data-ui-layout-scheme="workspace"`.
- The target workspace entry points are `WorkspaceActionButton`, `workspaceActionButtonClassName(...)`, and
  `workspaceActionSurfaceClassName(...)`.
- Workspace helpers resolve to workspace-scoped semantic classes, for example:
  - `.pf-workspace-action-button`
  - `.pf-workspace-action-button--primary`
  - `.pf-workspace-action-button--secondary`
  - `.pf-workspace-action-button--danger`
  - size variants such as `.pf-workspace-action-button--sm`, `.pf-workspace-action-button--md`,
    `.pf-workspace-action-button--lg`, `.pf-workspace-action-button--icon-sm`,
    `.pf-workspace-action-button--icon-md`, `.pf-workspace-action-button--icon-lg`
- Non-button interactive surfaces such as `ImageDropZone` should use the workspace surface helper, which resolves to
  workspace-scoped classes such as:
  - `.pf-workspace-action-surface`
  - `.pf-workspace-action-surface--primary`
  - `.pf-workspace-action-surface--secondary`
  - `.pf-workspace-action-surface--danger`
  - optional helpers such as `.pf-workspace-action-surface-focus` and `.pf-workspace-action-surface--dashed`
- Button structure is fixed by the shared system: pill radius, 1px border, restrained 3D depth, hover lift, active press,
  focus ring, and disabled state.
- Toggle-like buttons that represent a selected option should use the workspace button system with `aria-pressed="true"`.
  The shared CSS owns the selected color variables so pages do not need page-local active button color strings.
- Button-like surfaces share the same radius, border, color variables, restrained 3D depth, hover state, and focus-within
  ring. They must keep their original semantic element, such as `ImageDropZone`'s label + hidden input structure.
- Visual customization happens through controlled CSS variables, not by rewriting the entire class string. Supported
  variables are `--pf-action-bg`, `--pf-action-bg-hover`, `--pf-action-border`, `--pf-action-border-hover`,
  `--pf-action-text`, `--pf-action-shadow`, `--pf-action-shadow-hover`, and `--pf-action-focus-ring`.
- Legacy `.btn-primary-spring` / `.btn-secondary-spring` remain valid for existing pages, but new workspace pages should
  prefer the workspace button helpers.
- Legacy `ActionButton` helpers are acceptable only while migrating old callers. New layout-sensitive code should prefer
  explicit classic/workspace helpers.
- **Do not hardcode** `rounded-lg bg-indigo-600` inline for action buttons in workspace pages. Use the shared component or
  helper so radius, depth, and state styling stay consistent.
- Shared leaf modules such as resource-library dialogs, time-range controls, and settings style registries must not choose
  workspace button helpers on their own. The caller must branch by layout or pass an explicit appearance prop.

### When to Use Each Button Class

| Scenario | Class |
| --- | --- |
| New workspace primary / secondary / danger action | Workspace button component/helper |
| New classic primary / secondary / danger action | Classic button component/helper |
| Existing caller being migrated gradually | Legacy `ActionButton` / helper, then move to explicit layout entry |
| Child component only accepts `className` or `buttonClassName` | Layout-specific helper chosen by the caller |
| Upload/drop zone or other non-button button-like interaction | Layout-specific surface helper |
| Rich selection cards with title + description + metadata | Keep a dedicated card/list selector, not a button component |
| Existing page not migrated yet | Legacy `.btn-primary-spring` / `.btn-secondary-spring` |

Card/list selectors such as template-plan choices, workflow entry cards, or clickable result rows should keep their own
card semantics and selected-state styling. Layout button components are for command buttons and compact toggle controls,
not for content-rich selection surfaces that need multi-line copy, metadata chips, or large click regions.

### Classic Scheme Isolation

Classic pages must not import or render the workspace button system by default. In particular:

- Do not make classic pages depend on `data-workspace-appearance`.
- Do not use workspace pill radius, workspace action classes, or workspace surface classes in classic routes.
- If a page file serves both layouts, branch explicitly by active layout before choosing a button helper or component.
- Do not infer workspace button eligibility from shell CSS such as `pf-workspace`, `pf-workspace-subpage`, `pf-side-shell`,
  or from the page living under a "workbench" directory. These are not proof that the current route is using workspace
  scheme.
- If a shared component must work in both layouts, require an explicit layout/appearance prop instead of silently choosing
  workspace visuals.
- Shared style registries or helper files that export button class constants must either export layout-aware helpers or be
  split by layout. A layout-agnostic file must not hardcode workspace or legacy button classes for both callers.
- Legacy `ActionButton` is the only temporary exception because its class layer now resolves by root scheme; treat it as a
  migration bridge, not the long-term API.

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
| --- | --- | --- |
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

## Repeated Card Section Alignment Contract

### Scope / Trigger

Use this contract when cards in a responsive multi-column grid contain the same ordered sections and each corresponding
section must align with its peers in the same visual row while retaining content-driven heights.

### Layout Contract

- Let the parent grid own the shared row tracks. Each card spans the section count and adopts those rows through CSS
  Subgrid; section elements must participate in the card grid in the same order.
- Keep each visual row independent. A single-column layout and an unpaired final card retain natural content height.
- Keep heights content-driven. Do not synchronize sections with fixed heights or JavaScript measurements.
- Absolutely positioned card actions do not participate in the shared tracks. Reserve their horizontal space only in the
  section they overlap.
- Responsive child layout must account for the card's actual width. A viewport breakpoint such as `lg` can still produce a
  narrow card inside a side-rail shell; flexible text uses `min-w-0`, fixed controls use `shrink-0`, and unrelated sections
  must not inherit header action padding.

```tsx
<div className="grid gap-4 lg:grid-cols-2">
  {items.map((item) => (
    <article key={item.id} className="row-span-4 grid grid-rows-subgrid">
      <header data-card-section="identity">...</header>
      <section data-card-section="capabilities">...</section>
      <section data-card-section="generation-config">...</section>
      <footer data-card-section="enabled-status">...</footer>
    </article>
  ))}
</div>
```

### Validation Matrix

- Multi-column desktop: compare every paired section's `getBoundingClientRect().top` and `.bottom`; each delta must be at
  most 1 pixel, and paired card heights must match.
- First multi-column breakpoint: verify the narrowest cards produced by the page shell, including long URLs, maximum
  capability counts, wrapping badges, help text, and fixed-width switches.
- Single-column mobile: verify one card per visual row, natural section heights, and zero document/card horizontal overflow.
- Layout/theme coverage: verify both `classic` and `workspace`, including one light and one dark state, in an isolated
  browser context.
- Regression coverage: assert the section order and Subgrid classes in a focused component test; keep lint, TypeScript,
  deterministic frontend tests, and the production build gate green.

Good: paired cards use shared Subgrid tracks, and their flexible/fixed children remain shrink-safe at the page's narrowest
multi-column width.

Base: a single-column list keeps the same four-section structure; each card sizes from its own content.

Bad: cards use independent internal grids, per-card `min-height` guesses, or runtime DOM measurements, so content changes
move later section boundaries out of alignment.

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
- [ ] Layout-sensitive input/button families are explicit: known classic branches do not land on `Workspace*`, known
  workspace branches do not land on `Classic*`, and shared leaves branch by `activeScheme` or require `appearance`.
- [ ] All visible UI chrome is localized in every supported locale.
- [ ] Root `data-*` attributes and CSS selectors match the provider behavior.
- [ ] Light/dark/appearance contrast is checked for hover, focus, active, disabled, expanded, loading, empty, error, and
  destructive states.
- [ ] New/changed components consume `pf-*` semantic classes for structural surface/border/text; any remaining bare neutral
  class is an intentional exception (translucent, non-neutral, decorative, or high-contrast) and `node web/scripts/check-bare-colors.mjs` does not exceed baseline.
- [ ] Desktop and mobile screenshots come from an independent browser window/profile or isolated context.
- [ ] `pnpm --dir web lint`, `pnpm --dir web test:run`, and `just web-build` pass or any unrelated pre-existing failure is
  documented with a narrower validation that covers the change.
