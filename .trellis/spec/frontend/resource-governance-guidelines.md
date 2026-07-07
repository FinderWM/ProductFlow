# Resource Governance Frontend Guidelines

> Frontend contracts for resource library, gallery governance, admin readonly views, and moderation UI.

---

## Scope / Trigger

Use this spec before changing any of these surfaces:

- Resource library pages, modals, source save/load actions, and delete/group controls.
- Gallery browsing, gallery management routes, save-to-gallery state, and admin remove/restore controls.
- Gallery tag filters, save-to-gallery tag selection, and gallery tag management controls.
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
- Gallery entries and resource-library assets own their saved image paths. Source ids are lineage/idempotency metadata, not
  runtime read dependencies.
- Gallery tags are global gallery-only tags. They must not reuse generation resource groups or generation group grants.

## API And Type Surfaces

Keep these frontend mirrors aligned with backend schemas:

- `GalleryTag`, `GalleryEntry`, `GalleryEntryListResponse`, and generated asset gallery state in `web/src/lib/types.ts`.
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
- Gallery tag create/update/delete/entry-assignment mutations must invalidate `["gallery-tags"]` and `["gallery"]`, and
  prune selected disabled/deleted tag ids from local filter state after active tags refetch.
- Resource-library save/delete/group changes must invalidate resource-library asset/group/source-status queries.
- Upstream resource disable/restore can change downstream effective availability for source assets, poster variants,
  image sessions, and image-session assets. Gallery/resource-library rows saved from those sources remain governed by their
  own rows, so invalidate those queries only when their own rows, tags, groups, or displayed lineage metadata changed.

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
- Classic gallery feed chrome must follow the active `light` / `dark` theme. Do not hard-code the feed section, header,
  filter bar, loading state, or empty state as a dark-only presentation zone when the page is rendering through the
  classic layout.
- Image cards whose only action is opening an image preview must use `MediaPreviewTrigger`, not
  `LayoutActionSurfaceButton`, raw `<button>` wrappers, or action-surface class helpers. The preview trigger may keep
  click and keyboard activation, but the visible surface stays a media card/image instead of workspace button chrome.
- Keep action surfaces for real controls: upload/drop zones, selection cards, history/session/job selection, navigation,
  and admin governance actions.
- Remove/restore buttons must stop event propagation so they do not open or change the selected preview unintentionally.
- Disabled entries should show a clear admin-removed label and preserve enough metadata to identify what is being governed.
- Workspace home gallery previews must not request disabled entries; only gallery management surfaces may opt in with
  `include_disabled=true` and the proper permission.

Wrong:

```tsx
<LayoutActionSurfaceButton onClick={() => setPreviewAsset(asset)}>
  <img src={api.toApiUrl(asset.thumbnail_url)} alt={asset.original_filename} />
</LayoutActionSurfaceButton>
```

Correct:

```tsx
<MediaPreviewTrigger onPreview={() => setPreviewAsset(asset)}>
  <img src={api.toApiUrl(asset.thumbnail_url)} alt={asset.original_filename} />
</MediaPreviewTrigger>
```

## Gallery Tag UI

### 1. Scope / Trigger

- Trigger: changing `GalleryPage`, save-to-gallery actions in `ImageChatPage` or `SettingsPage`, gallery tag API helpers,
  or RBAC gating for tag management.

### 2. Signatures

- Query keys:
  - `["gallery-tags", "active"]` -> `api.listGalleryTags()`.
  - `["gallery-tags", "manage"]` -> `api.listGalleryTags({ include_disabled: true })`, enabled only for admin managers.
  - `["gallery", canViewDisabledGallery, selectedTagIds]` includes selected tag ids.
- API helpers:
  - `api.listGalleryEntries({ tag_ids })`.
  - `api.saveGalleryEntry(assetId, { tag_ids })`.
  - `api.listGalleryTags(...)`, `createGalleryTag(...)`, `updateGalleryTag(...)`, `deleteGalleryTag(...)`.
  - `api.replaceGalleryEntryTags(entryId, tagIds)`.
- Runtime config fields:
  - `RuntimeConfig.gallery_tag_filter_max_selection`.
  - `RuntimeConfig.gallery_entry_tag_max_selection`.
  - `RuntimeConfig.gallery_tag_required_on_save`.
- RBAC helper constant: `API_GALLERY_TAGS_MANAGE = "gallery:tags_manage"`.

### 3. Contracts

- The "manage tags" button renders only when `session.user.is_admin` and the session has `gallery:tags_manage`.
- The gallery filter row shows active tags in one line; overflow goes into the "More" dialog. Selected tags remain selected
  when opening the dialog and when they are hidden behind overflow.
- The "More" dialog has two sections: selected and unselected. Moving a tag appends it to the target section tail. Closing
  and reopening rebuilds unselected order from the API tag order.
- Filter selection count is capped by `gallery_tag_filter_max_selection`.
- Save-to-gallery tag selection count is capped by `gallery_entry_tag_max_selection`.
- Admin-manager entry tag editing is intentionally unlimited; the picker should pass no max selection for
  `replaceGalleryEntryTags`.
- Save-to-gallery actions must open a tag picker first. Empty selection is valid unless `gallery_tag_required_on_save=true`.
- Cards and preview metadata render only `entry.tags` from the API; disabled/deleted tags must not be reconstructed from
  cached tag lists. Gallery cards keep tags to a single ellipsized line; full tag lists belong in the image preview dialog.
- Entry tag editing is an admin-manager-only preview action and calls `replaceGalleryEntryTags`.

### 4. Validation & Error Matrix

- No active tags -> filter row shows a no-tags state, and save dialog can still submit an empty list when tags are not
  required.
- Required-on-save plus empty selection -> picker shows local required error and does not call the API.
- Filter max selection reached -> picker/filter shows max-selection error and does not append another tag.
- Save-to-gallery max selection reached -> picker shows the image-binding max-selection error and does not append another
  tag.
- Entry tag edit with many active tags -> allowed for admin managers and submitted to `replaceGalleryEntryTags`.
- Tag delete/disable while selected -> active tag refetch removes the stale id from `selectedTagIds`.
- API error during management or entry edit -> error is shown inside the modal near the action.

### 5. Good/Base/Bad Cases

- Good: a user selects tag A on the page, opens More, sees A in the selected section, adds B, and the gallery query includes
  both tag ids.
- Good: an admin deletes tag A; active tags refetch, A disappears from filters/cards, and gallery data refreshes.
- Base: image-chat and settings image-test save dialogs both use the shared picker and submit `{tag_ids: []}` when optional.
- Bad: showing the manage button for a non-admin role that only has the permission bit.
- Bad: sorting tags in React differently from the backend response order.

### 6. Tests Required

- Frontend build/type-check after DTO/API helper changes.
- Unit or component tests for picker selected/unselected movement when extracted helper logic exists.
- Backend route tests remain authoritative for admin hard gates, disabled/deleted hiding, any-hit filtering, and match-count
  sorting.

### 7. Wrong vs Correct

Wrong:

```tsx
const canManageTags = hasSessionApiPermission(session, API_GALLERY_TAGS_MANAGE);
```

Correct:

```tsx
const canManageTags = hasSessionAdminApiPermission(session, API_GALLERY_TAGS_MANAGE);
```

Wrong:

```tsx
api.saveGalleryEntry(asset.id);
```

Correct:

```tsx
api.saveGalleryEntry(asset.id, { tag_ids: selectedTagIds });
```

## Resource Library UI

- Resource-library assets belong to the authenticated user. UI source save/load actions must keep owner checks visible and
  must not offer loading another user's resource into the current user's workflow/session.
- Resource-library saves from source should present reuse semantics. Do not imply that saving from a generated image creates
  a new generated asset.
- Resource-library saves from source create a resource-library-owned image path while keeping `source_type` /
  `source_resource_id` for source-status display and idempotency.
- Loading a resource-library asset into a workflow/session may create a new reference upload under the current backend
  behavior; do not describe that path as the same as source save.
- Group changes should use the typed API helper and refresh the asset list/source status surfaces that show membership.
- Asset thumbnails in `ResourceLibraryPage` and `ResourceLibraryModal` follow the media preview contract above. The
  thumbnail is image content with a preview affordance; select, download, upload, and group editing remain separate
  controls.

### Resource Library Card Group Chip Editor

**Problem**: Rendering every available group as a vertical checkbox list inside each library card made card height scale
with group total. At 10+ groups the grid broke and cards grew unevenly.

**Solution**: Card group area is now height-constant and decoupled from group total. Selected groups render as compact
chips; editing happens in a popover listbox. Component: `web/src/components/ResourceGroupChipEditor.tsx`.

**Contracts**:

- Chip display uses `VISIBLE_CHIP_LIMIT = 3`. Groups beyond the limit collapse into a single `+N more` chip whose count
  is `selectedGroups.length - visibleGroups.length`. Clicking `+N more` expands all chips and opens the popover.
- Selected chips render in `groups` original order (not draft order) so badges do not jump as the user toggles groups.
- Empty selection renders an `ungrouped` placeholder chip; it is display-only and must not be submitted as a group id.
- The `+N more` chip is a `<button>` (actionable, focusable), regular chips are `<span>` (read-only).
- Editing opens a `FloatingSurface` popover (`preferredPlacement="bottom-end"`, `matchTriggerWidth={false}`,
  `minWidth={220}`) with a multi-select listbox. Toggling an option calls `onChange(nextIds)` — the component is
  controlled; it never owns the selection.
- Draft state, dirty check, empty-selection `groupRequired` validation, and `updateResourceLibraryAssetGroups` mutation
  stay in the page. The editor only reports selection changes.
- Closing the popover does not reset `showAll`, so already-expanded badges stay visible without flicker.
- App mode (`pf-app`) and workspace subpage mode (`workspaceSubpage`) share the same card JSX; only the outer shell
  differs. Both must be tested when changing chip/popover styling.

**Component boundary — do not reuse the settings form selector here**:

- `GenerationResourceGroupMultiSelect` is an `h-11` full-width button built for settings forms. Card slots are narrow;
  reuse caused layout drift. The chip editor is a deliberately separate compact variant built on `FloatingSurface`.
  When a third compact multi-select surface is needed, extract shared listbox internals rather than re-importing either
  component wholesale.

**Accessibility contract**:

- Trigger button: `aria-haspopup="listbox"`, `aria-expanded`, `aria-controls` pointing at the listbox id.
- Listbox container: `role="listbox"`, `aria-multiselectable="true"`, `aria-label`.
- Each option: `role="option"`, `aria-selected`.
- Esc close, outside-click close, and focus return to trigger are handled centrally by `FloatingSurface`; do not
  duplicate window-level Esc listeners inside the editor (the existing inner Esc handler is retained only for parity
  with `GenerationResourceGroupMultiSelect` and calls the same `setOpen(false)`).

**Example**:

```tsx
<ResourceGroupChipEditor
  groups={groups}
  selectedIds={draftGroupIds}
  disabled={isAdminReadonly}
  editLabel={t("resourceLibrary.editAssetGroups")}
  ungroupedLabel={t("resourceLibrary.ungrouped")}
  moreLabel={(count) => t("resourceLibrary.moreGroups", { count })}
  listboxAriaLabel={t("resourceLibrary.selectGroups")}
  noGroupsLabel={t("resourceLibrary.noGroups")}
  onChange={(nextIds) => setAssetGroupDrafts((prev) => ({ ...prev, [asset.id]: nextIds }))}
/>
```

**Wrong vs Correct**:

Wrong — let card height grow with group count:

```tsx
{groups.map((g) => (
  <label className="flex items-center gap-2">
    <input type="checkbox" /> {g.name}
  </label>
))}
```

Correct — height-constant chips plus popover editor:

```tsx
<ResourceGroupChipEditor groups={groups} selectedIds={draft} ... />
```

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

Wrong:

```tsx
const previewUrl = api.toApiUrl(`/api/image-session-assets/${entry.image_session_asset_id}/download`);
```

Correct:

```tsx
const previewUrl = api.toApiUrl(entry.image.preview_url);
```
