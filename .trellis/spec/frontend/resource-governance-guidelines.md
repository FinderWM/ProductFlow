# Resource Governance Frontend Guidelines

> Frontend contracts for resource library, gallery governance, admin readonly views, and moderation UI.

---

## Scope / Trigger

Use this spec before changing any of these surfaces:

- Resource library pages, modals, source save/load actions, and archive/group controls.
- Gallery browsing, gallery management routes, save-to-gallery state, and admin remove/restore controls.
- Frontend handling for `resources:moderate`, moderation DTOs, and disabled/effective-disabled resource fields.
- Admin cross-user views for inspirations, image sessions, generated images, gallery entries, or resource-library derived assets.

This spec complements:

- `./type-safety.md` for DTO mirroring and API client typing.
- `./state-management.md` for TanStack Query cache keys and mutation invalidation.
- `./component-guidelines.md` for page/component layout and accessibility contracts.
- `../backend/database-guidelines.md` for the backend moderation/save semantics.

## Core Contracts

- Admin cross-user reads are governance-only. When a resource owner differs from the current user and the current user is an
  admin, frontend write actions must be hidden, disabled, or blocked with a readonly reason.
- Governance actions use `resources:moderate`; ordinary save/edit/delete/upload/writeback actions still use the normal
  owner mutation boundary and must not be reused for cross-user writes.
- Frontend controls must treat `effective_enabled=false` as unavailable for continued use even when the resource row itself
  has `enabled=true`.
- Disabled gallery entries are hidden by default. Gallery management surfaces may request `include_disabled=true` only when
  the current session has `resources:moderate`.
- Resource library is an authenticated-default personal capability. Do not add resource-library RBAC menu/API permission
  requirements just to make the frontend navigation work.
- Save-to-gallery state comes from the generated asset DTO (`gallery_saved`, `gallery_entry_id`), not from scanning gallery
  pagination.

## API And Type Surfaces

Keep these frontend mirrors aligned with backend schemas:

- `GalleryEntry`, `GalleryEntryListResponse`, and generated asset gallery state in `web/src/lib/types.ts`.
- Resource library asset/group/source status DTOs in `web/src/lib/types.ts`.
- `ResourceModerationType`, moderation response/update DTOs, and moderation API helpers in `web/src/lib/types.ts` and
  `web/src/lib/api.ts`.
- RBAC helper constants such as `API_RESOURCES_MODERATE` in `web/src/lib/rbac.ts`.

Do not call `fetch` directly from pages for gallery, resource-library, or moderation APIs. Add or reuse typed methods on
the central API client.

## Query And Mutation Invalidation

Resource governance mutations can affect more than the page that issued them:

- Gallery remove/restore must invalidate gallery queries and keep preview state from showing stale moderation fields.
- Save-to-gallery must update the relevant image-session cache for the generated asset and invalidate gallery queries.
- Resource-library save/archive/group changes must invalidate resource-library asset/group/source-status queries.
- Upstream resource disable/restore can change downstream effective availability. Invalidate or refresh the visible detail,
  gallery, image-session, and resource-library queries that can display derived availability.

Prefer precise `setQueryData` when the changed object is already in cache and the patch is simple. Use invalidation when
effective availability can cascade through parent resources.

## Admin Readonly UI

For admin cross-user views:

- Keep governance buttons visible only when the session has `resources:moderate`.
- Keep ordinary owner actions unavailable: save to gallery, save to resource library, edit, delete, upload, generate/append,
  write back, or bind resources.
- Tooltips, disabled titles, and local mutation errors should state the readonly reason instead of implying a missing feature
  or transient failure.
- Do not rely only on button visibility for security. The backend owner guard remains the source of truth.

## Gallery Governance UI

- The public/browse gallery remains image-led. Admin governance controls are compact per-entry or preview actions, not bulk
  table tooling.
- Remove/restore buttons must stop event propagation so they do not open or change the selected preview unintentionally.
- Disabled entries should show a clear admin-removed label and preserve enough metadata to identify what is being governed.
- Workspace home gallery previews must not request disabled entries; only gallery management surfaces may opt in with
  `include_disabled=true` and the proper permission.

## Resource Library UI

- Resource-library assets belong to the authenticated user. UI source save/load actions must keep owner checks visible and
  must not offer loading another user's resource into the current user's workflow/session.
- Resource-library saves from source should present reuse semantics. Do not imply that saving from a generated image creates
  a new generated asset.
- Loading a resource-library asset into a workflow/session may create a new reference upload under the current backend
  behavior; do not describe that path as the same as source save.
- Group changes should use the typed API helper and refresh the asset list/source status surfaces that show membership.

## Tests Required

- Frontend build/type-check after DTO or API helper changes.
- Focused helper/page tests when changing readonly gating, `resources:moderate` checks, route query parsing, or cache update
  helpers.
- Backend route/feature tests remain the source of truth for ownership guards and effective-disabled propagation when a
  frontend change depends on those contracts.

## Wrong vs Correct

Wrong:

```tsx
const canSave = session.user?.is_admin || asset.owner_user_id === session.user?.id;
```

Correct:

```tsx
const isAdminReadonly = session.user?.is_admin && asset.owner_user_id !== session.user.id;
const canSave = !isAdminReadonly && asset.owner_user_id === session.user?.id && asset.effective_enabled;
```

Wrong:

```tsx
const saved = galleryEntries.some((entry) => entry.image_session_asset_id === asset.id);
```

Correct:

```tsx
const saved = asset.gallery_saved;
```
