# Frontend Directory Structure

> Actual React/Vite organization for ProductFlow.

---

## Overview

The frontend is a React 19 + Vite + TypeScript app under `web/src/`. It uses React Router for pages, TanStack Query for
server state, Tailwind CSS v4 utility classes for styling, and a small central API/type layer under `web/src/lib/`.

Key files:

- `web/src/main.tsx` mounts the app with `React.StrictMode`.
- `web/src/App.tsx` creates the `QueryClient`, wraps `BrowserRouter`, and declares routes.
- `web/src/index.css` imports Tailwind and defines minimal global theme/base styles.
- `web/src/pages/` contains route-level pages.
- `web/src/components/` contains shared presentational components.
- `web/src/lib/` contains API calls, shared TypeScript DTOs, and formatting helpers.

---

## Directory Layout

```text
web/
├── package.json                     # scripts: dev, build, lint, test, test:run, preview
├── tsconfig.json
├── tsconfig.app.json                # strict TypeScript for src/
├── tsconfig.node.json               # Vite config typing
├── vite.config.ts                   # React/Tailwind plugins, API proxy, ports/hosts
└── src/
    ├── main.tsx                     # ReactDOM entrypoint
    ├── App.tsx                      # QueryClientProvider, BrowserRouter, lazy-loaded auth-gated routes
    ├── index.css                    # Tailwind import, global base CSS, pf-* shell/workspace variables
    ├── components/                  # shared presentational components (TopNav, StatusPill, ImageSizePicker,
    │                                #   ImageGenerationSettings*, SensitiveImageMask, FloatingSurface, etc.)
    ├── lib/                         # api.ts, types.ts, format.ts, i18n.ts, plus focused helpers
    │                                #   (resourceGroups, generationConfigs, imageSizes, sensitiveImages,
    │                                #   notifications, taskNotifications, preferences, theme, rbac, ...)
    └── pages/
        ├── LoginPage.tsx
        ├── InspirationListPage.tsx
        ├── InspirationCreatePage.tsx
        ├── InspirationDetailPage.tsx
        ├── inspiration-detail/              # page-local inspiration workflow constants/types/utils/components
        ├── ImageChatPage.tsx
        ├── image-chat/                      # page-local image-chat panels and pure helpers
        ├── GalleryPage.tsx
        ├── gallery/                         # page-local gallery helpers/moderation
        ├── SettingsPage.tsx
        ├── settings/                        # page-local settings import/export helper
        ├── StatusPage.tsx
        ├── UsageStatsPage.tsx
        ├── RbacPage.tsx
        ├── ResourceLibraryPage.tsx
        ├── TemplateManagementPage.tsx
        ├── HelpPage.tsx
        └── workspace/                       # workspace-scheme landing pages
```

There is no `hooks/` directory and no global state store today. Stateful logic currently lives in pages unless it is a
shared API/type/format helper.

---

## Route Organization

Routes are centralized in `web/src/App.tsx` inside `AppRoutes()` and pages are lazy-loaded with `lazy(...)`. Current
routes include:

- `/login` -> `LoginPage` (the only public page)
- `/inspirations`, `/inspirations/list`, `/inspirations/all` -> `InspirationListPage`
- `/inspirations/new` -> `InspirationCreatePage`
- `/inspirations/:inspirationId` -> `InspirationDetailPage`
- `/image-chat`, `/image-chat/workbench` -> standalone `ImageChatPage`
- `/inspirations/:inspirationId/image-chat` -> inspiration-scoped `ImageChatPage`
- `/gallery`, `/gallery/browse`, `/gallery/manage` -> `GalleryPage`
- `/status`, `/status/detail` -> `StatusPage`
- `/usage-stats`, `/usage-stats/detail` -> `UsageStatsPage`
- `/rbac` -> `RbacPage`
- `/resource-library`, `/resource-library/manage` -> `ResourceLibraryPage`
- `/settings`, `/settings/global-templates` -> `SettingsPage`
- `/workflow/templates` -> `TemplateManagementPage`
- `/help` -> `HelpPage`
- `*` -> not-found fallback

When the `workspace` layout scheme is active, several entries resolve to workspace-scheme landing variants
(`WorkspaceHomePage`, `WorkspaceImageChatPage`, `WorkspaceGalleryPage`, `WorkspaceStatusPage`) under
`web/src/pages/workspace/`.

Auth gating is also in `AppRoutes()`: it loads `api.getSessionState` with query key `['session']` and redirects
unauthenticated users to `/login`. Menu/route visibility is further gated by RBAC menu codes from the session payload.

---

## Page vs Component Placement

Use `web/src/pages/` for route-level modules that own data fetching, navigation, mutations, and complex local UI state.
Current examples:

- `InspirationListPage.tsx` owns inspiration list fetching, logout mutation, and navigation to settings/image chat/new inspiration.
- `InspirationDetailPage.tsx` owns inspiration detail/history queries, workflow status polling, copy editing state, and
  workbench actions.
- `ImageChatPage.tsx` owns session selection, auto-create behavior, config-derived image size options, and generation.
- `SettingsPage.tsx` owns config fetching, grouped drafts, secret touched state, save/reset mutations.
- `StatusPage.tsx` owns read-only generation config pool status, date-range filters, and
  per-config operational rows. Keep status as a route-level page instead of embedding it in `SettingsPage.tsx`.

Use `web/src/components/` for reusable presentational components with small props and no route ownership:

- `TopNav.tsx`
- `StatusPill.tsx`
- `ImageGenerationSettingsTabs.tsx`, `ImageGenerationSettingsPanel.tsx`, `ImageSizePicker.tsx`, and
  `ImageToolControls.tsx` for the shared image generation settings shell and controls used by both the image-session page
  and inspiration workflow inspector.

If a component is only used inside one page and tightly coupled to that page's state, keep it either in the page file or
in a page-local directory. `InspirationDetailPage.tsx` uses `web/src/pages/inspiration-detail/` for workflow canvas constants,
draft/config utilities, image mapping helpers, and page-local components; do not move those to global `components/`
until another page actually reuses them.

---

## Lib Organization

- `web/src/lib/api.ts` is the only place that should know fetch details, credentials, `VITE_API_BASE_URL`, and API paths.
- `web/src/lib/types.ts` contains DTO interfaces and string union types mirroring backend Pydantic responses and enums.
- `web/src/lib/format.ts` contains pure formatting helpers such as `formatDateTime`, `formatShortDate`, and
  `formatPrice`.
- `web/src/lib/image-downloads.ts` contains reusable image URL, filename sanitization, timestamp suffix, and extension
  helpers. Page-specific mapping from inspiration/poster records to downloadable images should stay page-local.
- `web/src/lib/` has grown beyond the original four files. It also holds cross-page concerns such as i18n (`i18n.ts`),
  durable preferences and providers (`preferences.tsx`, `theme.ts`, `sensitiveImagePreferences.ts`,
  `uiLayoutScheme*.ts(x)`, `workspaceAppearance.ts`, `workspaceMotion.ts`), session context/actions (`session.tsx`,
  `sessionActions.tsx`), RBAC helpers (`rbac.ts`), generation/resource-group helpers (`generationConfigs.ts`,
  `resourceGroups.ts`), image tooling (`imageSizes.ts`, `imageToolOptions.ts`), canvas template localization
  (`canvasTemplateLocalization.ts`), task notifications (`taskNotifications.tsx`), dynamic fields (`dynamicFields.ts`),
  markdown (`markdown.ts`), and parameter help (`parameterHelp.ts`). Most modules ship a colocated `*.test.ts`.
- New cross-page behavior belongs in a focused `web/src/lib/` module with tests, not inlined into a page.

Do not scatter raw `fetch(...)` calls or duplicate DTO interfaces inside pages.

---

## Naming Conventions

- Page and component files use `PascalCase.tsx`: `InspirationListPage.tsx`, `TopNav.tsx`.
- Exported React components use named exports: `export function InspirationListPage() { ... }`.
- Utility files use lower camel-ish names: `api.ts`, `format.ts`, `types.ts`.
- Helper functions use `camelCase`, for example `getWorkingCopy`, `getSourceImageUrl`, `draftsFromConfig`.
- API DTO fields intentionally preserve backend `snake_case` names, for example `workflow_state`, `copy_set_id`,
  and `reset_keys` in `web/src/lib/types.ts`; image size presets live in `web/src/lib/imageSizes.ts`, not runtime config.

---

## Avoid

- Adding route declarations outside `App.tsx` without a deliberate router refactor.
- Creating a global state store for server data that already lives in TanStack Query.
- Duplicating API URL construction outside `api.toApiUrl(...)`.
- Moving page-specific subcomponents into `components/` before they are reused.
- Renaming backend DTO fields to camelCase in frontend types unless the backend response changes too.
