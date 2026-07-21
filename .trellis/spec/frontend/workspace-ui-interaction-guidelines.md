# Workspace UI and Interaction Guidelines

> Executable design and interaction contracts for the accepted workspace settings, inspiration list, and status list UI.

---

## Scope / Trigger

Use this spec before changing any of these workspace surfaces:

- Settings page subpages under `/settings`, including providers, generation configs, prompts, templates, runtime, import/export, weather, reminders, and resource group controls.
- Shared controls used inside workspace settings: buttons, option toggles, switches, text inputs, textareas, selects, multi-selects, dialogs, drawers, and feedback surfaces.
- Inspiration list pages with clickable rows or mobile swipe actions.
- Status detail pages with governed, readonly rows.
- Shared workspace CSS that affects `pf-workspace-*`, `pf-settings-*`, `pf-select-field-surface`, `pf-gradient-divide`, `pf-governed-list-panel`, or `pf-metric-card`.

Primary implementation references:

- `web/src/pages/SettingsPage.tsx`
- `web/src/components/SelectField.tsx`
- `web/src/pages/InspirationListPage.tsx`
- `web/src/pages/StatusPage.tsx`
- `web/src/index.css`

## Theme and Token Contract

Workspace pages are themed by root attributes:

- `data-ui-layout-scheme="workspace"`
- `data-workspace-appearance="mist|sage|dusk"`

Workspace UI must use semantic tokens and classes from `web/src/index.css`:

- Core colors: `--pf-bg`, `--pf-panel`, `--pf-panel-soft`, `--pf-border`, `--pf-line`, `--pf-line-strong`, `--pf-text`, `--pf-muted`, `--pf-subtle`, `--pf-accent`, `--pf-accent-2`, `--pf-danger`, `--pf-shadow`.
- Settings input tokens: `--pf-settings-input-border`, `--pf-settings-input-bg`, `--pf-settings-input-bg-hover`, `--pf-settings-input-bg-focus`, `--pf-settings-input-bg-disabled`, `--pf-settings-input-color`, `--pf-settings-input-placeholder`, `--pf-settings-input-shadow`, `--pf-settings-input-shadow-focus`.
- Workspace action-button system: explicit `WorkspaceActionButton`, `workspaceActionButtonClassName(...)`, and
  `workspaceActionSurfaceClassName(...)` plus the semantic workspace action classes they resolve to.
- Legacy `ActionButton`, `actionButtonClassName(...)`, and `actionSurfaceClassName(...)` remain available for migration.
  Their legacy classes now render workspace visuals only under the workspace root scope.
- Workspace-looking shells inside classic routes are still classic callers. Shared controls must not infer workspace button
  entry points merely because the surrounding layout uses `pf-workspace`, `pf-side-shell`, or other immersive shell
  classes.

Rules:

- Do not hard-code a slate/indigo/violet final appearance inside workspace settings controls unless the element is explicitly shared with classic layout.
- Use semantic workspace classes before broad glass-panel selectors. Broad panel/card selectors must exclude `input`, `textarea`, `select`, `button`, and semantic action classes.
- Any shared setting control must be visually checked in `mist`, `sage`, and `dusk`.
- Keep the workspace ambient pointer effect centralized in `UiLayoutSchemeProvider` and `web/src/lib/workspaceMotion.ts`. Page-local pointer listeners are not allowed for workspace background effects.
- Ambient implementation must stay compositor-cheap: dedicated `.pf-workspace-ambient-glow` as first child of `.pf-workspace`/`.pf-app` (`z-index: -1` inside shell isolation), direct `transform` updates, quantized coordinates; never drive glow via root CSS variables or full-page `background` on the shell.
- Workspace top concept nav / handle / home quick-nav must not rely on `backdrop-filter` over the ambient glow; opaque (or high-opacity) fills keep hover paint cost low.

## Settings Page Shell and Modules

Settings in workspace layout use the `pf-workspace pf-settings-workspace` root and the side-shell structure:

- `pf-side-shell` for the full settings layout.
- `pf-side-rail` for the left settings navigation.
- `pf-side-content` for the active working panel.
- `pf-settings-nav-item` with `aria-current="page"` for the active left menu item.

Module rules:

- Use `PANEL_CLASS` for top-level work panels.
- Use `pf-settings-bordered-module` for bordered inner sections that need visual grouping.
- Use `pf-settings-field-card` for light field groups or repeated setting blocks.
- Page sections should read as working surfaces. Avoid nested heavy cards.
- Keep field labels above inputs. Helper text and errors stay below the relevant field/action.
- Remove accidental divider lines from the bottom of generated config lists; use intentional section separators only.

## Settings Information Architecture

A rewrite of the workspace settings page must preserve the current section map and grouped navigation:

- Provider group:
  - `providers`
  - `resourceGroups`
  - `text`
  - `image`
- Workflow group:
  - `prompts`
  - `upload`
  - `queue`
  - `globalTemplates`
- Experience group:
  - `layoutAppearance`
  - `loginPage`
  - `weather`
  - `notifications`
- Security group:
  - `security`
  - `migration`

Navigation contract:

- Desktop uses a left `pf-side-rail` with a title block, section search, grouped nav items, icons, and
  `aria-current="page"` on the active item.
- Mobile uses a grouped `SelectField` for section switching instead of showing the full side nav.
- Section search filters visible nav items only. It must not remove the active content state or write settings.
- When the browser reloads on a deeper settings sub-route, the desktop side rail may internally scroll just enough to
  bring the active `pf-settings-nav-item` back into view, preferably near the middle of the visible rail window while
  clamping at the top/bottom boundaries.
- In-page section switches must not auto-scroll the desktop side rail. The restore-on-scroll behavior is reserved for the
  browser reload recovery path, not for normal navigation clicks.
- Settings side-rail entries are navigation, not command buttons. Keep them on `pf-settings-nav-item` with
  `aria-current="page"` and page-local text/icon density; do not route them through
  `actionSurfaceClassNameForAppearance(...)`, `ClassicActionButton`, `WorkspaceActionButton`, or other action-button
  helpers.
- The active content panel starts with a breadcrumb-like label, a section title, and the section description.
- Hidden permission-gated sections are removed from navigation, not merely disabled.
- Side rail wheel behavior may pass scroll to the page when the rail cannot consume more scroll.

Content routing contract:

- `providers`, `resourceGroups`, `text`, `image`, `weather`, `notifications`, `globalTemplates`, and `migration` render
  dedicated panels.
- Runtime config sections such as `prompts`, `upload`, `queue`, `layoutAppearance`, `loginPage`, and `security` render
  generic config fields from the runtime config API, with section-specific layout adjustments where current code has them.
- Empty generic sections render a dashed empty state, not a blank panel.
- Initial settings load uses a centered spinner; initial load errors render a red inline alert before the side shell.

## Settings Buttons

Workspace settings buttons are compact by default and should resolve through the workspace action-button system:

- Primary writes or main create actions: `SETTINGS_MAIN_ACTION_CLASS` -> legacy `actionButtonClassName({ preset: "primary", size: "md" })` during migration, then prefer `workspaceActionButtonClassName(...)`.
- Secondary actions: `SETTINGS_SECONDARY_ACTION_CLASS` -> legacy `actionButtonClassName({ preset: "secondary", size: "md" })` during migration, then prefer `workspaceActionButtonClassName(...)`.
- Compact utility actions: `SETTINGS_COMPACT_ACTION_CLASS` -> legacy `actionButtonClassName({ preset: "secondary", size: "sm" })` during migration, then prefer `workspaceActionButtonClassName(...)`.
- Icon actions: `SETTINGS_ICON_ACTION_CLASS` -> legacy `actionButtonClassName({ preset: "secondary", size: "icon-sm" })` during migration, then prefer `workspaceActionButtonClassName(...)`.
- Drawer submit actions: `SETTINGS_DRAWER_SUBMIT_ACTION_CLASS` -> legacy `actionButtonClassName({ preset: "primary", size: "md", fullWidth: true })` during migration, then prefer `workspaceActionButtonClassName(...)`.
- Destructive icon actions: `SETTINGS_DANGER_ICON_ACTION_CLASS` -> legacy `actionButtonClassName({ preset: "danger", size: "icon-sm" })` during migration, then prefer `workspaceActionButtonClassName(...)`.
- Reset/destructive text actions: `SETTINGS_RESET_ACTION_CLASS` -> legacy `actionButtonClassName({ preset: "danger", size: "sm" })` during migration, then prefer `workspaceActionButtonClassName(...)`.
- When a page or child component only accepts `className`, keep using the shared constant/helper instead of recreating
  `pf-workspace-action-*`, `pf-danger-action`, or `btn-*-spring` strings inline.
- These helpers are not valid for classic-only code paths. If a child component renders under both layouts, route the
  decision through an explicit layout prop instead of importing workspace helpers unconditionally.
- Shared files such as `settings/components/styles.ts` are not automatically workspace-only just because most current
  callers live under settings. If the same exported constants can reach classic-compatible settings subpages, they must be
  split by layout or replaced with a layout-aware helper function.
- The same rule applies to layout-sensitive input helpers or textarea/select wrappers exported from shared settings files.
  If classic-compatible callers can reach them, they must branch by layout or require an explicit appearance prop.

Placement rules:

- Buttons in the same row should distribute by function: primary create/save near the related title or form footer, secondary/import/export/reset actions grouped separately.
- Avoid oversized `h-11` or `h-12` action buttons in workspace settings.
- Use icons from `lucide-react` for tool-like actions when an icon exists.
- Disabled buttons keep their size and layout, use `disabled`, reduced opacity, and `cursor-not-allowed`.
- Pending actions must disable repeated writes and show a nearby loading state or spinner when the current pattern already does so.

Interaction rules:

- Hover should be restrained: a light tint, subtle border shift, or `translateY(-1px)`.
- Active should feel tactile: `scale(0.98)` or a small downward transform.
- Focus-visible must remain stronger than hover and keyboard reachable.
- Do not add large glows, neon effects, or decorative animation to operational buttons.

Button label overflow contract:

- Compact command buttons use short labels and may keep `whitespace-nowrap`. If the label does not fit, wrap the action
  row, move secondary actions to the next line, or convert low-frequency actions to icon-only with `aria-label` and
  `title`; do not shrink text until it becomes hard to read.
- Selectable option buttons that can contain long labels must follow the provider capability button pattern:
  `flex`, a `shrink-0` icon/mark, and a text wrapper with `min-w-0 flex-1 whitespace-normal break-words leading-5`.
- Long-label option buttons use `min-height` plus vertical padding, not fixed `height`, so labels can wrap to two lines
  without clipping.
- Prefer wrapping over ellipsis for provider capabilities, interface options, resource choices, and other semantic options
  where the full label affects the user's decision.
- If a button must stay one line, constrain the text in a `min-w-0` wrapper and provide the full label through `title` or
  an accessible name. Never let the raw text overlap the icon, badge, spinner, or button border.
- Validate the longest `zh-CN` and `en-US` labels in the narrowest supported drawer/card/mobile width.

## Settings Write and Save Logic

Every action that writes persistent settings or database data must have explicit feedback in a dialog:

- Success appears in `SettingsFeedbackDialog` and auto-dismisses after `SETTINGS_SAVED_MESSAGE_AUTO_DISMISS_MS` (`1000ms`).
- Failure appears in the same feedback layer and does not auto-dismiss.
- Error dialogs use `role="alertdialog"` and include an explicit close action.
- Success dialogs may close on Escape, overlay click, or the 1 second timer.
- Failure dialogs may close on Escape, overlay click, or close button, but never by timer.

Save behavior:

- Text inputs, selects, weather settings, reminder settings, and similar editable settings should stage local state first.
- Persisting staged data requires an explicit save button.
- Filters that do not write persistent data may still update immediately.
- Create/update mutations must invalidate or update the relevant TanStack Query caches so newly created providers, groups, or configs appear without a full page refresh.
- Mutation success handlers should reset transient draft form state only after the backend confirms success.

## Settings Permissions, Drafts, and Cache Contract

Workspace settings uses permission-scoped write behavior:

- Runtime config writes are gated by `API_SETTINGS_WRITE`.
- Provider profiles, resource groups, and generation configs are gated by `API_SETTINGS_PROVIDER_WRITE`.
- Global template navigation/action availability is gated by `API_GLOBAL_TEMPLATES_MANAGE`.
- Disabled actions stay visible when useful for context, but must use disabled styling and must not mutate local or server
  state.

Draft contract:

- Runtime config fields use draft state derived from the backend config snapshot.
- Runtime save sends only changed fields.
- Secret fields keep an untouched state; unchanged secret fields must not submit empty strings.
- Discard restores drafts from the current query data.
- Restore env/default opens a confirmation dialog before resetting a field.
- Provider, resource group, and generation config edits are local drafts until Save/Create is clicked.
- Search fields and section/tab selection are local UI state and do not trigger writes.

Cache contract:

- Provider profile create/update/delete and generation config/resource group changes must update `provider-config`
  optimistically where current helper patterns exist, then invalidate affected dependent data.
- At minimum, provider settings refresh must cover `provider-config`, `generation-config-options`,
  `generation-config-status`, and section-specific dependencies such as `provider-models`, `my-generation-resource-groups`,
  `config`, and `runtime-config` when those records can be affected.
- Import commit must refresh runtime config, provider config, resource groups, generation config options/status, session,
  and canvas template caches.
- New providers must be selectable in text/image generation config dropdowns immediately after successful creation without
  requiring a page refresh.

## Settings Option Buttons, Radio Controls, and Switches

Use the control pattern that matches the data:

- Multi-select text options: `SettingsOptionToggle` and `pf-settings-option-toggle`.
- Binary enable/disable or start/stop states: `SettingsSwitchToggle` and `pf-settings-switch-toggle`.
- Provider capability choices: `pf-settings-provider-option` with `aria-pressed`.
- Provider capability choice labels must sit in a `min-w-0` text wrapper with normal whitespace and `break-words`.
  Use `min-height` plus vertical padding for these buttons instead of fixed `height`, because labels such as
  `Text Chat Completions` must wrap inside the two-column provider drawer on desktop and mobile. This is the reference
  implementation for other long-label option buttons.

Option toggle contract:

- Render a real checkbox or radio input for state and accessibility.
- Keep the visible control in `pf-settings-option-toggle-control`.
- Checked state uses the theme accent and remains readable in all three workspace appearances.
- Disabled state must block toggling, reduce contrast, and keep layout stable.

Switch contract:

- Use a sliding switch visual for binary state.
- The thumb movement must use `transform`, not layout properties.
- Checked state moves the thumb to the right and changes the track with theme tokens.
- Disabled switches do not animate on hover.
- Keep the hidden input focusable and expose `focus-visible` on the visual control.

## Settings Selects and Multi-Selects

Use `SelectField` for single-select menus and resource/provider dropdowns.

Single-select contract:

- Trigger button uses `aria-haspopup="listbox"`, `aria-expanded`, and `aria-controls`.
- Menu uses `role="listbox"`.
- Each item uses `role="option"` and `aria-selected`.
- Selected options show a check icon.
- Disabled options cannot be selected and must look disabled.
- Keyboard behavior:
  - `ArrowDown` / `ArrowUp` opens and moves the active option.
  - `Enter` / `Space` selects the active option or opens the list.
  - `Escape` closes the list.
- Searchable dropdowns must focus and select the search input when opened, so provider selection can immediately accept typing.

Floating surface rules:

- `SelectField` menus use `FloatingSurface` and `pf-select-field-surface`.
- Search inputs inside dropdown surfaces must use the same workspace input gradient tokens as normal settings inputs.
- Popovers must close on outside interaction and Escape without triggering unrelated row or form actions.

Resource multi-select contract:

- Use a trigger with `aria-haspopup="listbox"`.
- Menu uses `role="listbox"` and `aria-multiselectable="true"`.
- Items use `role="option"` and `aria-selected`.
- Disabled resource groups cannot toggle.
- The closed trigger displays a concise selected count or selected-name summary.
- Escape closes the menu.

## Settings Inputs and Textareas

Workspace settings inputs are the workspace half of the layout-specific input system. New or migrated settings controls
should use the `Workspace*` input family, or workspace-specific helpers selected by an explicit layout branch. Existing
`INPUT_CLASS`, `TEXTAREA_CLASS`, `PROMPT_TEXTAREA_CLASS`, and workspace CSS overrides are not proof that a shared settings
component is workspace-only.

Scope boundary:

- The source-of-truth family-selection rule lives in `ui-layout-guidelines.md` under "Layout-Sensitive Component Family
  Ownership". This section only defines the workspace settings visual and interaction contract.
- This section defines workspace-layout input styling only. It must not be used as the default contract for classic
  layout pages.
- If a settings component, dialog, drawer, or field helper can render under classic and workspace layouts, it must accept
  `appearance: "classic" | "workspace"` or receive the selected input component family from its owner.
- Classic callers must use `ClassicTextInput`, `ClassicTextarea`, `ClassicSelectField`, `ClassicCheckbox`,
  `ClassicOptionToggle`, `ClassicSwitch`, or a classic-specific date/time wrapper. They must not import workspace input
  helpers just because the surrounding shell uses `pf-workspace`.
- Workspace callers must use the `Workspace*` input family or workspace-specific helpers. They must not leave classic
  helpers in the final workspace branch when the control is layout-sensitive.
- Do not let shared helpers default to workspace. A missing `appearance` prop should be treated as an incomplete layout
  contract, not as permission to use workspace chrome.

Gradient contract:

- All settings subpage `input`, `textarea`, `select`, `button[aria-haspopup="listbox"]`, and `.pf-select-field-surface input` use the same 135 degree gradient system.
- The gradient starts from the top-left and follows the same direction and intensity as the global generation settings inputs.
- Theme overrides for `mist`, `sage`, and `dusk` must define visible gradient contrast. Light themes cannot have a barely visible gradient.
- `dusk` text must stay bright enough for long editing sessions; current text color is `#f5ead6` with brighter placeholders than the old low-contrast state.

Prompt textarea contract:

- Long prompt fields use `PROMPT_TEXTAREA_CLASS` plus `pf-settings-prompt-textarea`.
- Prompt fields should feel like long-form writing surfaces: darker gray/black base, visible theme gradient, stronger focus state, readable placeholder.
- Keep the gradient direction aligned with other workspace settings inputs.
- Preserve a minimum height suitable for long copy and avoid tiny text areas for prompt editing.

State contract:

- Default, hover, focus, disabled, placeholder, and error states must be theme-complete.
- Focus uses border, ring/shadow, and gradient intensity changes rather than sudden color inversion.
- Disabled inputs keep the same dimensions and use `--pf-settings-input-bg-disabled`.

## Workspace Horizontal Switch/Menu Buttons

Generation purpose tabs, resource-group filters, and page-level switches such as RBAC user/role management use the same
menu-like horizontal controls:

- Container: `pf-settings-generation-tabs`.
- Item: `pf-settings-generation-tab`.
- Active state: `aria-current="true"` or `.is-active`.
- Add `pf-workspace-horizontal-switch-tabs` when the switch sits as a page-level or section-level tab row and needs
  preserved button spacing plus a full container bottom rule.

Visual contract:

- Only the bottom border is visible. Other borders are removed.
- Radius is `0`; the control should read as a menu row, not a pill button group.
- The container bottom rule spans the switch group, including the gaps between buttons. It must not shrink to a pair of
  tightly adjacent text-width buttons.
- Buttons keep functional spacing: use a gap and a small `min-width` for short labels such as user/role management, while
  allowing mobile buttons to flex instead of overflowing.
- Hover fills upward from the bottom to about `72%`.
- Active fills from the bottom to the full height.
- Active state uses a subtle upward shadow such as `0 -8px 18px -18px ...`.
- Use `--pf-accent` and `--pf-accent-2` so `mist`, `sage`, and `dusk` inherit the correct palette.

Behavior contract:

- Switching the tab changes the visible local view, group, or filter only.
- It should not trigger a database write by itself.
- Keyboard focus must be visible and the active item must be announced by `aria-current`.
- Do not use pill segmented controls for this pattern. Pills are reserved for compact value options; this switch is a menu
  row with a persistent baseline.

## Settings Dialogs, Drawers, and Modals

Dialog surfaces used by settings include:

- `SettingsFeedbackDialog` for write success/failure.
- `ConfirmDialog` for confirmation.
- `GenerationConfigCreateDialog` for new copy/image configs.
- `GenerationResourceGroupCreateDialog` for new generation resource groups.
- Provider create/edit drawer for supplier configuration.

Dialog contract:

- Use a fixed overlay with backdrop blur and a stable z-index above page content.
- Dialog content uses `role="dialog"` or `role="alertdialog"`, `aria-modal="true"`, `aria-labelledby`, and when useful `aria-describedby`.
- Escape closes the dialog unless a pending mutation is in progress.
- Overlay click closes only when the click target is the overlay and no pending mutation is in progress.
- Submit buttons inside dialogs follow the compact settings button contract; create buttons should not be oversized.
- Success closes the create/edit dialog and clears drafts after mutation success.
- Failure stays visible on the dialog or feedback layer and must not auto-dismiss.

Drawer contract:

- Drawer submit actions are full-width only inside the drawer footer.
- Closing a drawer resets its transient form state only when the close action is intentional or after successful save.
- Drawer fields use the same input gradient and compact action rules as settings panels.

## Settings Provider Surface

Provider profile cards:

- Use card surfaces for each active provider profile, with a clickable edit body and top-right icon actions.
- The body click opens edit mode only when provider writes are allowed.
- Edit and delete actions are top-right `SETTINGS_ICON_ACTION_CLASS` / `SETTINGS_DANGER_ICON_ACTION_CLASS`
  buttons.
- Provider enablement uses a compact switch with `role="switch"` and `aria-checked`.
- Disabling a provider that is still used by active text/image configs is blocked; show helper text and keep the switch
  disabled.
- Cards show provider name, endpoint/default endpoint, provider type, capabilities, API key configured/missing badge, and
  active usage badges.

Provider create/edit drawer:

- New provider opens a drawer from the providers panel. Editing opens the same drawer with existing profile data.
- Closing the drawer clears `editingProfileId` and restores the empty provider form.
- Editing never pre-fills the API key field; a blank API key means keep the existing key.
- Provider type controls reset default capabilities according to provider type.
- Capability choices use `pf-settings-provider-option` with clear selected state in `mist`, `sage`, and `dusk`.
- Provider image max dimension uses a preset selector plus optional custom integer input. The selector must offer the
  shared common long-edge presets plus a follow-global option; custom mode keeps a dedicated input instead of forcing
  everything into one free-form field.
- Custom provider image max dimension accepts only `512-8192` integer input, surfaces inline invalid state, and explains
  that the saved value will align to the shared `16px` generation step so it stays consistent with image size/aspect
  filtering in workbench, enhance, and deck flows.
- Hydrating an existing provider profile should reopen this field in preset mode when the normalized value matches a
  common preset, otherwise in custom mode with the normalized custom value shown.
- Submit is disabled while pending or when required fields are missing.
- Save success closes the drawer, refreshes provider-dependent caches, and shows the write feedback dialog.
- Delete provider requires `ConfirmDialog`; failure stays on the confirm/error surface.

## Settings Resource Group and Generation Config Surfaces

Resource group panel:

- The panel header has title/description and a compact "new group" action.
- New group opens `GenerationResourceGroupCreateDialog`; it is not an inline card.
- Resource group cards use `SETTINGS_FIELD_CARD_CLASS`, compact spacing, and top-right delete icon buttons.
- Delete is icon-only and placed at the card's top-right corner.
- Cards show name, key, enabled/disabled badge, and text/image config counts for existing groups.
- Fields use a three-column desktop grid for key/name/sort order, followed by description, then switches/actions.
- Enabled uses `SettingsSwitchToggle`; blur images by default uses `SettingsOptionToggle`.
- Create/save is disabled until key and name are non-empty.

Generation config pool:

- Text and image generation config pages share the same pool structure.
- Text config page includes `TextConfigTestPanel` above the pool; image config page includes `ImageConfigTestPanel` above
  the pool.
- Text and image test panel drafts are browser-local test inputs. Persist edits immediately through guarded
  `localStorage` helpers, keep empty user text as a valid saved value, and fall back only for invalid image sizes.
- The pool header contains title/description, search input, "new config" primary action, and compact refresh sort action.
- Resource groups are horizontal `pf-settings-generation-tab` menu buttons. Include the unbound group tab.
- Disabled resource groups remain visible in the tab row with a disabled label suffix.
- Config search filters the active resource group's cards by name only.
- Empty filtered results show a dashed empty state.
- New config opens `GenerationConfigCreateDialog`; it is not an inline card.

Generation config cards:

- Use `SETTINGS_FIELD_CARD_CLASS` with top-right icon-only delete.
- The card header shows config name, enabled/disabled badge, frozen badge when applicable, and stats for existing configs.
- The first field row includes name, resource group multi-select, and provider interface.
- Non-mock provider configs show a searchable provider profile dropdown. Opening this dropdown must focus/select the search
  input.
- Text configs show brief/copy model fields; image configs show image-specific provider/model fields.
- The five numeric controls (`priority`, `max_concurrency`, `availability_window_minutes`, `failure_threshold`,
  `cooldown_minutes`) are a stable grid. Do not add an accidental bottom border under this row.
- Enabled uses `SettingsSwitchToggle`.
- Test, unfreeze, and save actions sit below the card fields. Test belongs with the action row, not in the upper field grid.
- Text generation test status and result previews render below the action row, directly under the tested card.
- Test result previews use two preformatted panels for brief and copy results with bounded scroll.
- Save/create is disabled when the name is blank or a non-mock provider profile is required but missing.
- Frozen configs expose a compact unfreeze action when available.

Generation config create dialog:

- The dialog uses the same `GenerationConfigCard` body as normal cards.
- Dialog content scrolls inside `max-h-[calc(100dvh-3rem)]`.
- The close button is icon-only and disabled during pending save.
- Submit buttons inside the embedded card remain compact; do not make the create button large.

## Settings Runtime, Experience, and Migration Panels

Generic runtime config fields:

- Boolean runtime fields use switch-style controls where they represent enabled/started behavior.
- Multi-select runtime fields use option toggles.
- Prompt runtime fields whose keys start with `prompt_` use `PROMPT_TEXTAREA_CLASS`.
- Runtime config forms end with compact discard and save actions aligned to the right.
- Runtime field restore opens `ConfirmDialog` before calling reset.

Queue, upload, and login page layouts:

- Queue groups runtime config rows by category with light section separators.
- Upload uses a two-column card grid where current code does so.
- Login page settings may include resource/image asset selection; asset loading and error states must remain visible.

Weather and notifications:

- Do not persist on input/change.
- Stage local state first and include a compact explicit save button.
- Save success uses the same `SettingsFeedbackDialog` success behavior.

Global templates:

- The settings page only shows a compact navigation panel and action button.
- The actual editor lives at `/settings/global-templates`.
- When `/settings/global-templates` renders under workspace layout, it uses the same settings surface contract:
  `pf-workspace pf-settings-workspace`, `pf-workspace-subpage`, `pf-workspace-subpage-frame`, and a `pf-side-shell` with
  `pf-side-rail` filters/categories plus `pf-side-content` template cards.
- The actual editor's search/category/title/description/sort inputs and `SelectField` triggers must inherit the workspace
  settings input gradient tokens in `mist`, `sage`, and `dusk`.
- Global template create/update/delete/review/copy actions are persistent writes. They use compact settings action
  classes, confirmation dialogs where destructive, and the same success/error feedback dialog behavior as other settings
  writes.
- The action is disabled when template management permission is missing.

Migration import/export:

- Export uses a primary compact action and requires an export confirmation dialog.
- Import uses a hidden file input triggered by a compact secondary action.
- Import preview renders counts and file details before commit.
- Commit import and cancel preview actions are shown beside the preview.
- Import/export errors use the persistent error feedback behavior; success uses 1 second auto-dismiss.

## Settings Sliding Logic

Two sliding interactions exist in the current workspace UI:

- Toggle switches in settings.
- Mobile swipe actions in the inspiration list.

Settings switch rules:

- Use a real checkbox plus the `pf-settings-switch-control` visual.
- Checked movement uses `transform: translateX(...)`.
- Hover/focus/checked/disabled states are token-driven.
- Do not implement switch movement with width, left, or margin changes.

## Pointer and Mouse Effects

Pointer behavior should reinforce affordance without turning operational UI into decorative animation:

- Buttons and clickable rows may move by 1px or use a small scale on active.
- Hover should increase local contrast, not add broad glow.
- Focus-visible must be clear for keyboard users.
- Workspace ambient cursor effects are centralized; do not attach page-local mouse listeners for the background.
- Prefer transform-only ambient layers over `backdrop-filter` glass on chrome that tracks the pointer (concept-nav, quick-nav).
- Hover-only image previews must be gated to fine pointer mouse input. Touch devices should not show hover previews.
- Child action buttons inside clickable rows must call `stopPropagation()` on click/pointer events.

## Inspiration List: Clickable Rows

The inspiration list uses clickable rows on desktop and clickable cards on mobile.

Desktop row contract:

- Render table rows as `<tr role="button" tabIndex={0}>` only when the whole row opens an inspiration.
- Support keyboard activation with `Enter` and `Space`.
- Use `usePressOpen`-style pointer handling:
  - pointer down starts a press state,
  - movement beyond `PRESS_CANCEL_DISTANCE_PX` (`8px`) cancels opening,
  - open is delayed briefly with `INSPIRATION_OPEN_DELAY_MS`,
  - pointer cancel/leave clears the press state.
- Hover uses a light row tint.
- Focus-visible uses an inset ring.
- Pressed state uses a stronger row tint and a left accent inset line.
- Row actions such as delete are hidden until row hover/focus, and they must not trigger row open.

Desktop list layout:

- Use `pf-table-panel` for the table container.
- Desktop table appears at `lg` and above.
- Keep stable column proportions:
  - inspiration content around `32%`,
  - key info around `25%`,
  - state around `15%`,
  - updated time around `15%`,
  - actions around `13%`.
- Loading skeletons should match row geometry and may use shimmer.
- Pagination is right-aligned on desktop.

Mobile card contract:

- Mobile/tablet uses a card grid such as `grid gap-3 md:grid-cols-2 lg:hidden`.
- Cards use `article role="button" tabIndex={0}` when the whole card opens details.
- Pressed cards may scale to about `0.985`.
- Use `content-visibility` and intrinsic size containment for heavy lists.
- Pagination may be fixed near the bottom above the mobile navigation safe area.

Mobile swipe action contract:

- Delete action width is `MOBILE_DELETE_ACTION_WIDTH_PX` (`96px`).
- Open threshold is `MOBILE_DELETE_OPEN_THRESHOLD_PX` (`42px`).
- Horizontal drag starts only when horizontal movement exceeds `PRESS_CANCEL_DISTANCE_PX` and is stronger than vertical movement.
- Swipe movement uses `transform: translateX(...)`.
- Delete action opacity follows the exposed offset.
- Delete buttons call `stopPropagation()` so they do not open the card.

Hover image preview contract:

- Preview size is `HOVER_IMAGE_PREVIEW_SIZE_PX` (`224px`).
- Preview appears only for mouse pointer input and only when the image can be displayed.
- Geometry clamps the preview inside the viewport and chooses left or right side based on available space.
- Touch and coarse pointer devices skip hover preview.

## Status Page: Readonly Rows

The status detail list is an operational status surface. Data rows are not navigation controls.

Readonly row contract:

- `ConfigStatusRow` renders a plain `div`, not a button.
- Do not add `role="button"`, `tabIndex`, `cursor-pointer`, row open handlers, or strong hover feedback to status rows.
- Rows may use neutral text hierarchy, badges, and truncation, but they should not imply clickability.
- Keep state details such as frozen reason, failure reason, concurrency, attempts, and success rate visible without requiring a click.

Status list layout:

- Use `pf-governed-list-panel` for the list container.
- Use a header/search area above the body.
- Use `pf-gradient-divide` for row separation instead of plain borders.
- The divider is a short gradient line between rows, not a full heavy rule.
- Keep the desktop row grid close to `md:grid-cols-[1.35fr_0.75fr_0.8fr_0.9fr_1fr]`.

Status metrics and filters:

- Use `pf-metric-card` for high-level metrics.
- Metric cards include the top gradient accent line from CSS.
- Status and personal usage statistics keep their top metric summaries as a horizontal responsive card row. Desktop uses
  one compact scanning row (`xl:grid-cols-6` for status, `xl:grid-cols-5` for personal usage), tablet wraps to two columns,
  and mobile stacks without changing the metric order.
- Each metric card keeps a small label, a large tabular value, an optional one-line detail, and a compact icon chip.
- Do not replace the metric row with a table, carousel, nested cards, or oversized hero cards. These metrics are operational
  scan indicators, not marketing highlights.
- Date quick buttons are clickable filters and may have active tint/border states. They sit on the same label row as
  `时间范围` and should use a smaller, lower-emphasis text size with only a compact click boundary. They must not read as
  full-size form buttons or visually overpower the label.
- Time filters use the shared `WorkspaceDateTimeRangeField` control when a page needs start/end filtering.
- `WorkspaceDateTimeRangeField` shows one label, `时间范围`, above a single merged range input surface. The two internal
  inputs support seconds with `datetime-local` and `step=1`, and they keep start/end values linked so start cannot exceed
  end and end cannot precede start. The visible surface is a single trigger; opening it shows the start and end controls
  together, starts from the start control, then moves focus to the end control after the start changes.
- Quick range actions sit on the same label row after `时间范围` and use `当日 / 最近一天 / 本周 / 本月`, computed from the
  current local time. These actions update local filter state only; they are not database writes.
- Backend endpoints that still accept day-level filters may receive date-only values derived from the second-level UI value,
  but the visible control remains second-capable for consistency across status, personal statistics, and inspiration list.
- Date inputs and refresh buttons use the compact status form classes and workspace input gradient tokens.
- Disable refresh while fetching or when the date range is invalid.
- Invalid date ranges show inline feedback near the filter controls.

## Admin Lists: Non-clickable Rows

RBAC and similar administrative lists may expose row-level data plus action buttons, but a row without a child page or
detail navigation is not a clickable row.

Non-clickable admin row contract:

- Keep the current row/table semantics: plain `<tr>` or row `div`, no `role="button"`, no `tabIndex`, no row open handler,
  and no `cursor-pointer` on the whole row.
- Preserve clear row separation. For tables, `pf-gradient-table-body` or existing row dividers are valid; do not replace
  them with the inspiration-list pressed row treatment.
- Whole-row hover may be neutral and subtle at most. It must not add a strong tint, left accent inset, raised shadow, or
  pressed state that implies navigation.
- Only explicit row controls are interactive. Resource-grant chips, reset-password buttons, enable/disable buttons, and
  other actions use compact icon or text buttons with visible focus states.
- Action controls inside the row must be sized compactly and may use hover/focus/active feedback on the control itself.
  They must not visually cover row data or depend on the whole row being clickable.
- Keep row content readable without expanding or clicking the row. Administrative fields such as username, role, status,
  grants, timestamps, and badges must be visible in the list itself.

Use this pattern for `/rbac` user lists and future admin tables that only mutate data in place. Use the inspiration list
clickable row pattern only when the whole row opens a real child surface.

## Image Chat: Current-Round Canvas Layer

The image-chat workbench is an immersive workspace surface. The main stage should display the current round image or task
state with round-owned metadata attached to the canvas.

Current-round canvas layer contract:

- Session title is shown above the stage, truncated to the available width, with the full title exposed through `title`.
  Do not show redundant labels such as “current result” in the title row.
- Resource owner/governance badges that duplicate the session list should not sit under the title. Keep blocked-resource
  notices near the affected action or result surface.
- Current-round metadata belongs to the canvas layer: resource group, actual/requested size, candidate index/count,
  model/provider, placeholder state, and waiting state render as compact canvas chips.
- The current image download action belongs to the canvas layer because it targets the visible image file.
- Send-to-gallery and save-to-resource-library actions sit after the session title. They are current-result actions, but
  they should not compete with canvas metadata or cover the image. In the desktop title row, the title group stays left
  and these action buttons are aligned right.
- Canvas chips must use translucent theme-complete surfaces and stay compact enough that they do not hide the image
  subject. Canvas metadata and canvas actions are right-aligned as one top row; actions stay at the far right and metadata
  flows to their left, wrapping before overlap.
- The image stage itself should reserve stable dimensions, center the current image, and keep the title row outside the
  canvas so long session titles cannot collide with provider-returned size text.
- Session-list titles and owner badges use truncation plus `title` for full-name hover. Operator-authored titles are not
  translated.
- History branch prompt snippets keep the preview behavior without an inline copy icon on the history strip. The prompt
  preview dialog owns the copy action at the bottom of the full prompt text. Copy feedback may be local to the dialog
  button; it is not a persistent write and does not use the settings database feedback dialog.
- Current-image preview dialogs should place prompt assistant actions, such as copy, below the prompt text so they remain
  available after reading long prompts.

## Workspace Theme Dock

The workspace appearance selector is a right-bottom dock controlled by the workspace shell.

- The dock starts open, then auto-collapses after the same navigation idle delay.
- Collapsed state sticks to the right edge and leaves only the current appearance logo/swatch visible. It remains
  interactive; do not hide it with `opacity: 0`, `pointer-events: none`, or pass-through behavior.
- Hovering or focusing the visible logo expands the three appearance options leftward. Leaving the dock schedules the same
  auto-collapse timer.
- Hidden options in collapsed state are removed from tab order; the visible current option remains focusable so keyboard
  users can reveal the dock.
- The dock uses workspace appearance tokens for border, panel, text, shadow, and swatches across `mist`, `sage`, and
  `dusk`.

## Good, Base, and Bad Cases

Good:

- A new settings save button uses `SETTINGS_MAIN_ACTION_CLASS` or `actionButtonClassName({ preset: "primary", size: "md" })`, writes through a mutation, opens `SettingsFeedbackDialog`, invalidates the affected query, and shows success for 1 second.
- A new searchable provider dropdown focuses and selects the search input on open, supports Arrow keys and Escape, and renders selected options with `aria-selected`.
- A new status row displays state details in a `div` grid with gradient dividers and no pointer affordance.
- A new RBAC user row keeps plain table-row semantics and exposes only compact action buttons for grants, password reset,
  and enable/disable operations.

Base:

- A new settings textarea uses the workspace input gradient tokens and has visible default, hover, focus, disabled, and placeholder states in all three workspace appearances.
- A new generation tab uses `pf-settings-generation-tab`, bottom-border-only styling, and `aria-current` for the active state.
- A new inspiration row action is hidden until row hover/focus and stops propagation before running its own action.

Bad:

- A settings create/save/export/import button uses `h-12`, oversized text, or a marketing-style primary button.
- A write action shows only inline text feedback and auto-dismisses errors.
- A settings select opens without focusing the search input when `searchable` is enabled.
- A status list row gets `cursor-pointer` or row hover styling even though it has no navigation behavior.
- An RBAC user row copies inspiration-list `role="button"` semantics or pressed row styling even though only the action
  buttons mutate data.
- A workspace settings input hard-codes a single light or dark background and breaks in `mist`, `sage`, or `dusk`.

## Wrong vs Correct

### Oversized settings action

Wrong:

```tsx
<button className="h-12 rounded-2xl px-6 text-sm">Save config</button>
```

Correct:

```tsx
<button type="button" className={SETTINGS_MAIN_ACTION_CLASS}>Save config</button>
```

### Immediate persistent write while typing

Wrong:

```tsx
<input value={name} onChange={(event) => mutation.mutate({ name: event.target.value })} />
```

Correct:

```tsx
<input value={draftName} onChange={(event) => setDraftName(event.target.value)} />
<button type="button" className={SETTINGS_MAIN_ACTION_CLASS} onClick={saveDraft}>
  Save
</button>
```

### Clickable status row styling

Wrong:

```tsx
<div role="button" tabIndex={0} className="cursor-pointer hover:bg-indigo-50">
  ...
</div>
```

Correct:

```tsx
<div className="grid gap-3 px-5 py-4 text-sm md:grid-cols-[1.35fr_0.75fr_0.8fr_0.9fr_1fr]">
  ...
</div>
```

## Review Checklist

Before handing off workspace UI changes:

- [ ] Buttons match the compact settings action sizes and semantic action classes.
- [ ] Button labels do not overflow: command rows wrap or become icon-only when needed, and long option labels follow the provider capability wrapping pattern.
- [ ] All persistent writes show feedback in a dialog; success auto-dismisses after 1 second and failure stays open.
- [ ] The settings section map, grouped navigation, desktop side rail, mobile section select, and active content header match the current page.
- [ ] Runtime/provider/global-template permissions gate the correct actions without hiding important context.
- [ ] Runtime drafts submit only changed fields and do not overwrite untouched secrets.
- [ ] Provider, resource group, and generation config mutations refresh the dependent query caches so new records appear without full reload.
- [ ] Provider cards, provider drawer, resource group cards, generation config cards, and create dialogs follow their page-specific contracts.
- [ ] Inputs, textareas, selects, and dropdown search inputs use the workspace 135 degree gradient in `mist`, `sage`, and `dusk`.
- [ ] Prompt textareas keep the darker long-form writing atmosphere and readable text in `dusk`.
- [ ] Horizontal generation tabs have bottom-border-only menu styling and `aria-current`.
- [ ] Selects and multi-selects expose listbox semantics, keyboard behavior, and searchable auto-focus when applicable.
- [ ] Dialogs have `aria-modal`, labels, Escape/overlay behavior, and pending-state close guards.
- [ ] Text generation test status/results render below the action row of the relevant card.
- [ ] Weather and notification settings require explicit Save; typing/selecting alone does not persist.
- [ ] Import/export uses confirm/preview/commit flow with compact actions.
- [ ] Clickable inspiration rows/cards support keyboard open, press cancellation, focus-visible, and child-action propagation guards.
- [ ] Mobile inspiration swipe actions use transform-based movement and threshold constants.
- [ ] Status rows remain readonly with no pointer affordance.
- [ ] RBAC/admin rows without child navigation remain non-clickable, keep row separation, and expose only explicit compact
      row actions as interactive controls.
- [ ] Browser verification covers at least one desktop and one mobile viewport, plus all three workspace appearances when shared workspace CSS changes.
