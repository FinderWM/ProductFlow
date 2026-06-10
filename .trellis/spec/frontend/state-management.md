# Frontend State Management

> Actual state management choices in ProductFlow.

---

## Overview

ProductFlow uses four state categories:

1. Server state: TanStack Query in pages and `AppRoutes()`.
2. Local UI/form state: React `useState`, `useMemo`, and `useEffect` inside page components.
3. URL state: React Router params and navigation.
4. Durable local UI preferences: locale/theme mode plus documented local-only visual preferences.

There is no Redux, Zustand, Jotai, custom event bus, or durable browser-local onboarding state.

---

## Server State

Server state is loaded through `web/src/lib/api.ts` and cached by TanStack Query. The `QueryClient` is created once in
`web/src/App.tsx` with `refetchOnWindowFocus: false`.

Current query key patterns:

- Session: `['session']` in `App.tsx`. `GET /api/auth/session` returns both `authenticated` and `access_required`;
  private routes require account login and no runtime setting can disable this boundary.
- Inspiration list: `['inspirations']` in `InspirationListPage.tsx` and `ImageChatPage.tsx`.
- Inspiration detail/history: `['inspiration', inspirationId]` and `['inspiration-history', inspirationId]` in `InspirationDetailPage.tsx`.
- Inspiration workbench: `['inspiration-workflow', inspirationId]` and `['inspiration-workflow-status', inspirationId]` in
  `InspirationDetailPage.tsx`.
- Image sessions: `['image-sessions', inspirationId ?? 'standalone']` and `['image-session', selectedSessionId]` in
  `ImageChatPage.tsx`.
- Runtime config: `['runtime-config']` in `InspirationDetailPage.tsx`, `InspirationListPage.tsx`, and `ImageChatPage.tsx`.
- Full settings config: `['config']` in `SettingsPage.tsx`; successful settings saves/resets must invalidate
  `['runtime-config']` when they can affect public runtime behavior.
- Settings import/export: successful import must refresh or invalidate settings/provider/runtime queries plus
  `['canvas-templates']` and `['canvas-template-categories']` because import can replace template governance data.
- Generation config status: `['generation-config-status', startDate, endDate]` in `StatusPage.tsx`; fetch
  `GET /api/settings/generation-config-status` when the date range is valid. Backend RBAC enforces `status:read`.

When writing mutations, update/invalidate every key that can show stale data.

---

## Local UI and Form State

Keep short-lived UI state local to the page that owns the interaction:

- `InspirationCreatePage.tsx` stores form fields, selected files, and a local error string.
- `InspirationDetailPage.tsx` stores editing mode, editable copy draft, selected canvas/workbench state, and local mutation
  error strings.
- `ImageChatPage.tsx` stores selected session/generated asset, prompt draft, image size, rename mode, target inspiration,
  and transient success/error messages.
- `SettingsPage.tsx` stores config drafts, secret touched flags, reset progress, and save/error messages.

Local state should not duplicate server records unless the user is editing a draft. For example, `SettingsPage.tsx` creates
`drafts` from fetched config so the user can edit before saving; inspiration details themselves remain in TanStack Query.

## URL and Navigation State

React Router owns route selection and route params:

- `useNavigate()` is used after login/logout, inspiration creation, and page buttons.
- `useParams()` supplies `inspirationId` for `InspirationDetailPage.tsx` and inspiration-scoped `ImageChatPage.tsx`.
- Auth redirects are centralized in `App.tsx` route elements and `LoginPage.tsx` redirects authenticated users away from
  `/login`.

Do not introduce a global store just to track current page or inspiration ID; use the URL.

---

## Durable UI Preferences

The durable browser-local UI preferences currently supported are locale/theme and workspace appearance. Sensitive-image
mask toggles are account server state:

- Provider: `PreferencesProvider` in `web/src/lib/preferences.tsx`, mounted once in `App.tsx` inside `BrowserRouter`.
- Locale storage key: `productflow.locale`; default locale is `zh-CN`.
- Theme storage key: `productflow.theme`; default preference is `system`.
- Supported theme preferences are `light`, `dark`, and `system`; `system` resolves from `prefers-color-scheme`.
- The provider updates `document.documentElement.lang`, root `class="dark"` when the resolved theme is dark, and root
  `data-theme` / `data-theme-preference` attributes.
- Workspace appearance storage key: `inspiration-one.workspace-appearance`; supported values are `mist`, `sage`, and
  `dusk`, defaulting to `mist`.
- Workspace appearance is a local visual preference used by the `workspace` layout to change background and reading color
  variables. It writes root `data-workspace-appearance` and stays separate from account-level `ui_layout_scheme`.
- Runtime workspace appearance changes may set the resolved light/dark theme so existing `dark:*` UI surfaces keep readable
  contrast, but they do not change routing, RBAC, API payloads, or server preferences.
- Use `useI18n()` or `usePreferences()` in components that need locale/theme values; do not create page-local duplicate
  locale/theme/workspace appearance state.
- Sensitive-image mask provider: `useSensitiveImageMaskPreference(scope)` in
  `web/src/lib/sensitiveImagePreferences.ts`, backed by TanStack Query key `['user-ui-preferences']`.
- Sensitive-image mask scopes are exactly `"inspirations"` and `"image-chat"`.
- Sensitive-image mask fields are `mask_sensitive_images_in_inspirations` and
  `mask_sensitive_images_in_image_chat` on `UserUiPreferences`.
- Sensitive-image mask default is `true`; missing account preferences should resolve to `true` until the server row is
  loaded or created.
- Sensitive-image mask state is a personal visual preference. It gates rendering only when a row's
  `resource_group.blur_images_by_default` is true; it does not change server filters, permissions, downloads, gallery
  behavior, or generated data.
- Sensitive-image mask preference controls should render only when the current list filter is all groups (`""`) or the
  selected concrete group has `blur_images_by_default=true`. Hide the control for non-sensitive concrete group filters
  without changing the saved account preference.

Sensitive-image mask toggles are not browser-local preferences. Do not store them in `localStorage`; use
`GET/PATCH /api/settings/ui-preferences` and update the TanStack Query cache.

Good:

```tsx
const { t } = useI18n();
return <button type="button">{t("nav.settings")}</button>;
```

Bad:

```tsx
const [locale] = useState(window.localStorage.getItem("productflow.locale"));
return <button type="button">{locale === "en-US" ? "Settings" : "配置"}</button>;
```

---

## Derived State

Prefer derived values over additional state:

- `InspirationDetailPage.tsx` derives source image URL, reference images, working copy, and poster variants from
  `InspirationDetail`.
- `ImageChatPage.tsx` derives built-in image-size picker presets from `web/src/lib/imageSizes.ts`, selected round from
  the selected asset ID, and inspiration source/reference images from inspiration detail.
- `SettingsPage.tsx` derives grouped config items from the fetched config response.
- `StatusPage.tsx` derives quick date ranges in local date-input format and passes the selected range to the status API;
  it renders backend-provided `today_*`, `range_*`, and per-config `range_stat` fields instead of recalculating
  generation history in the browser.

Use `useMemo` where the derivation is non-trivial or passed deeply; otherwise a local helper function is fine.

---

## API Error State

The central API wrapper throws `ApiError(status, detail)` from `web/src/lib/api.ts`. Pages convert it into local user-facing
strings:

- `LoginPage.tsx` displays invalid key errors.
- `InspirationCreatePage.tsx` displays create/upload validation errors.
- `InspirationDetailPage.tsx` displays copy/poster/reference image mutation errors.
- `ImageChatPage.tsx` displays generation/session/attach errors.
- `SettingsPage.tsx` displays config validation errors.

Keep error display local unless multiple pages need a shared notification system.

---

## Avoid

- Adding a global store for server data already cached by TanStack Query.
- Keeping a separate local copy of fetched records unless the user is editing a draft.
- Invalidating broad caches unnecessarily when a precise `setQueryData` is already used and safe.
- Hiding route state in local storage or globals instead of using React Router params.
- Storing API keys or admin keys in frontend local storage. Authentication is session-cookie based.
- Reintroducing durable browser-local onboarding, tour, help, or tutorial state without a new approved inspiration requirement.
- Adding new durable local preferences outside `PreferencesProvider` or a focused preference helper without updating this
  spec and focused helper tests.
