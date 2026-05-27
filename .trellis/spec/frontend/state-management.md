# Frontend State Management

> Actual state management choices in ProductFlow.

---

## Overview

ProductFlow uses four state categories:

1. Server state: TanStack Query in pages and `AppRoutes()`.
2. Local UI/form state: React `useState`, `useMemo`, and `useEffect` inside page components.
3. URL state: React Router params and navigation.
4. Durable local UI preferences: locale and theme mode in `PreferencesProvider`.

There is no Redux, Zustand, Jotai, custom event bus, or durable browser-local onboarding state.

---

## Server State

Server state is loaded through `web/src/lib/api.ts` and cached by TanStack Query. The `QueryClient` is created once in
`web/src/App.tsx` with `refetchOnWindowFocus: false`.

Current query key patterns:

- Session: `['session']` in `App.tsx`. `GET /api/auth/session` returns both `authenticated` and `access_required`; when
  login is disabled server-side, `authenticated` is true even without a login cookie.
- Product list: `['products']` in `ProductListPage.tsx` and `ImageChatPage.tsx`.
- Product detail/history: `['product', productId]` and `['product-history', productId]` in `ProductDetailPage.tsx`.
- Product workbench: `['product-workflow', productId]` and `['product-workflow-status', productId]` in
  `ProductDetailPage.tsx`.
- Image sessions: `['image-sessions', productId ?? 'standalone']` and `['image-session', selectedSessionId]` in
  `ImageChatPage.tsx`.
- Runtime config: `['runtime-config']` in `ProductDetailPage.tsx`, `ProductListPage.tsx`, and `ImageChatPage.tsx`.
- Full settings config: `['config']` in `SettingsPage.tsx`; successful settings saves/resets must invalidate
  `['runtime-config']` when they can affect public runtime behavior, and `['session']` because settings can toggle
  `admin_access_required`.
- Generation config status: `['generation-config-status', startDate, endDate]` in `StatusPage.tsx`; fetch
  `GET /api/settings/generation-config-status` when the date range is valid. Backend RBAC enforces `status:read`.

When writing mutations, update/invalidate every key that can show stale data.

---

## Local UI and Form State

Keep short-lived UI state local to the page that owns the interaction:

- `ProductCreatePage.tsx` stores form fields, selected files, and a local error string.
- `ProductDetailPage.tsx` stores editing mode, editable copy draft, selected canvas/workbench state, and local mutation
  error strings.
- `ImageChatPage.tsx` stores selected session/generated asset, prompt draft, image size, rename mode, target product,
  and transient success/error messages.
- `SettingsPage.tsx` stores config drafts, secret touched flags, reset progress, and save/error messages.

Local state should not duplicate server records unless the user is editing a draft. For example, `SettingsPage.tsx` creates
`drafts` from fetched config so the user can edit before saving; product details themselves remain in TanStack Query.

## URL and Navigation State

React Router owns route selection and route params:

- `useNavigate()` is used after login/logout, product creation, and page buttons.
- `useParams()` supplies `productId` for `ProductDetailPage.tsx` and product-scoped `ImageChatPage.tsx`.
- Auth redirects are centralized in `App.tsx` route elements and `LoginPage.tsx` redirects authenticated users away from
  `/login`.

Do not introduce a global store just to track current page or product ID; use the URL.

---

## Durable UI Preferences

Locale and theme are the only durable browser-local UI preferences currently supported:

- Provider: `PreferencesProvider` in `web/src/lib/preferences.tsx`, mounted once in `App.tsx` inside `BrowserRouter`.
- Locale storage key: `productflow.locale`; default locale is `zh-CN`.
- Theme storage key: `productflow.theme`; default preference is `system`.
- Supported theme preferences are `light`, `dark`, and `system`; `system` resolves from `prefers-color-scheme`.
- The provider updates `document.documentElement.lang`, root `class="dark"` when the resolved theme is dark, and root
  `data-theme` / `data-theme-preference` attributes.
- Use `useI18n()` or `usePreferences()` in components that need locale/theme values; do not create page-local duplicate
  locale/theme state.

Locale and theme are not server records. Do not store them in TanStack Query, add backend settings for them, or persist
them with auth/session state unless a future product requirement explicitly changes that boundary.

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

- `ProductDetailPage.tsx` derives source image URL, reference images, working copy, and poster variants from
  `ProductDetail`.
- `ImageChatPage.tsx` derives built-in image-size picker presets from `web/src/lib/imageSizes.ts`, selected round from
  the selected asset ID, and product source/reference images from product detail.
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
- `ProductCreatePage.tsx` displays create/upload validation errors.
- `ProductDetailPage.tsx` displays copy/poster/reference image mutation errors.
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
- Reintroducing durable browser-local onboarding, tour, help, or tutorial state without a new approved product requirement.
- Adding new durable local preferences outside `PreferencesProvider` without updating this spec and focused helper tests.
