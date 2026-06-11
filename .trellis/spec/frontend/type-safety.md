# Frontend Type Safety

> TypeScript and API typing conventions used by ProductFlow.

---

## Overview

The frontend uses strict TypeScript. `web/tsconfig.app.json` sets `strict: true`, `allowJs: false`,
`isolatedModules: true`, `moduleResolution: "Bundler"`, and `jsx: "react-jsx"`. The build command in `web/package.json`
runs TypeScript checks before Vite build:

```bash
pnpm --dir web build
# tsc --noEmit -p tsconfig.app.json && tsc --noEmit -p tsconfig.node.json && vite build
```

Runtime API typing is centralized in:

- `web/src/lib/types.ts`
- `web/src/lib/api.ts`

---

## API DTO Types

`web/src/lib/types.ts` mirrors backend Pydantic response/request shapes. It intentionally preserves backend field names,
including `snake_case`:

- `InspirationSummary.workflow_state`
- `CopySet.creative_brief_id`
- `ImageSessionGenerationTask.failure_reason`
- `ImageSessionRound.provider_response_id`
- `SessionState.access_required`
- `ConfigUpdateRequest.reset_keys`

Do not silently convert these to camelCase in frontend types unless the API layer also performs explicit mapping.

String union types mirror backend enums:

```ts
export type InspirationWorkflowState = "draft" | "copy_ready" | "poster_ready" | "failed";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
```

If backend enum values in `backend/src/productflow_backend/domain/enums.py` change, update these unions and all UI maps
such as `StatusPill.tsx::CONFIG`.

Workflow run DTOs mirror backend run action metadata. When the backend adds `is_retryable`, `is_cancelable`, or queue
fields (`queue_active_count`, `queue_running_count`, `queue_queued_count`, `queue_max_concurrent_tasks`,
`queued_ahead_count`, `queue_position`), update both `WorkflowRun` and `WorkflowRunStatusSummary` because full detail and
lightweight status polling merge through the same cache.

---

## API Client Typing

`web/src/lib/api.ts` exposes typed methods on the `api` object. The internal `request<T>(...)` returns a `Promise<T>` and
throws typed `ApiError` on non-2xx responses.

Examples:

```ts
getProduct(inspirationId: string): Promise<InspirationDetail> {
  return request(`/api/inspirations/${inspirationId}`);
}

updateConfig(payload: ConfigUpdateRequest): Promise<ConfigResponse> {
  return request("/api/settings", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}
```

Form uploads build `FormData` in API methods such as `createProduct(...)`, `addReferenceImages(...)`, and
`addImageSessionReferenceImages(...)`. The fetch wrapper omits `Content-Type` for `FormData` so the browser can set the
multipart boundary.

### Scenario: Image-session generated asset gallery state

#### 1. Scope / Trigger

- Trigger: changing image chat "send to gallery" behavior, `/api/gallery` save responses, or image-session detail DTOs
  consumed by `ImageChatPage`.
- Goal: keep gallery-save state a response contract on the generated asset instead of deriving it from gallery pagination.

#### 2. Signatures

- Backend response: `ImageSessionAssetResponse.gallery_saved: bool = False`.
- Backend response: `ImageSessionAssetResponse.gallery_entry_id: str | None = None`.
- Frontend mirror: `ImageSessionAsset.gallery_saved: boolean` and `gallery_entry_id: string | null`.
- Gallery save API: `api.saveGalleryEntry(imageSessionAssetId): Promise<GalleryEntry>` posts
  `{ image_session_asset_id }` to `POST /api/gallery`.

#### 3. Contracts

- Gallery entries reference the original `image_session_asset_id`; saving to gallery must not create a second
  `ImageSessionAsset` or copy image files.
- Image-session detail and generated round responses must mark generated assets already present in gallery with
  `gallery_saved=true` and the matching `gallery_entry_id`.
- `GalleryEntry.image` must also serialize the same generated asset with `gallery_saved=true` and `gallery_entry_id`
  equal to the entry id.
- Image chat controls use `selectedRound.generated_asset.gallery_saved` as the source of truth for disabling
  send-to-gallery actions in desktop and mobile layouts.

#### 4. Validation & Error Matrix

- Generated asset not saved to gallery -> `gallery_saved=false`, `gallery_entry_id=null`, action remains available if
  permissions and moderation allow it.
- Generated asset already saved -> button is disabled and displays an already-in-gallery label.
- Repeated `POST /api/gallery` for the same asset -> returns existing entry with HTTP 200 and does not create another
  `ImageGalleryEntry` or `ImageSessionAsset`.
- Missing/non-generated/sessionless asset -> backend validation remains the source of truth through `ApiError.detail`.

#### 5. Good/Base/Bad Cases

- Good: after a gallery save succeeds, update the `["image-session", sessionId]` cache for the saved asset and invalidate
  gallery queries.
- Base: a freshly generated unsaved asset has `gallery_saved=false` until it is posted to `/api/gallery`.
- Bad: listing `/api/gallery` in the image chat page just to infer whether the selected asset has been saved.
- Bad: copying a generated image into a new image-session asset or local file when creating a gallery entry.

#### 6. Tests Required

- Backend gallery test asserts first generated asset response has `gallery_saved=false`.
- Backend gallery save test asserts the returned gallery image uses the same asset id, has `gallery_saved=true`, and
  `ImageSessionAsset` count is unchanged.
- Backend session-detail test path asserts the saved generated asset later returns `gallery_saved=true` and the saved
  `gallery_entry_id`.
- Frontend build and tests must pass after any DTO field change.

#### 7. Wrong vs Correct

#### Wrong

```tsx
const saved = galleryEntries.some((entry) => entry.image_session_asset_id === selectedRound.generated_asset.id);
```

#### Correct

```tsx
const saved = selectedRound.generated_asset.gallery_saved;
```

### Scenario: Create-inspiration API input typing

#### 1. Scope / Trigger

- Trigger: changes to the inspiration creation form, `api.createProduct(...)`, or backend `POST /api/inspirations` multipart
  fields.
- Inspiration creation is a cross-layer form-upload contract. Keep the shape centralized in `web/src/lib/types.ts` and have
  `web/src/lib/api.ts` translate it into `FormData`.

#### 2. Signatures

- Shared frontend DTO: `CreateInspirationInput`.
- API method: `api.createProduct(input: CreateInspirationInput): Promise<InspirationDetail>`.
- Multipart fields currently mirrored from the backend:
  - `name: string`
  - `file?: File` -> form field `image`
  - `referenceFiles?: File[]` -> repeated form field `reference_images`
  - `category?: string`
  - `price?: string`
  - `source_note?: string`
  - `canvas_template_key?: string`
  - `initial_workflow_entry?: "image" | "copy" | "tail" | "blank"`
  - `entry_text?: string`

#### 3. Contracts

- Keep backend field names in the DTO for optional form values such as `source_note` and `canvas_template_key`.
- Keep `initial_workflow_entry` and `entry_text` in backend snake_case. Do not rename them to
  `initialWorkflowEntry` or `entryText` in the shared DTO.
- `image` entry requires a main image before submit. `copy` and `tail` entries require `entry_text`. `blank` requires
  neither image nor `entry_text`.
- `canvas_template_key` is the backend-recognized key. UI labels should be merchant-facing output plans, but the submitted
  value remains the key.
- Blank/default inspiration-creation plans may submit an empty string or omit `canvas_template_key`; this is independent from
  `initial_workflow_entry="blank"`.
- When `initial_workflow_entry="blank"` and a backend template is selected, the backend may initialize from any non-blank
  template but must persist the workflow source as blank. The frontend must not infer later template-save eligibility from
  selected template type.
- Inspiration creation large previews for backend-recognized built-in plans must mirror the backend `full_canvas` template
  layout for the same key. When changing preview node titles, edges, or coordinates, update the backend template and
  backend regression tests in the same change.
- The page component must not duplicate the full mutation object type inline when a shared DTO exists.
- The API method owns `FormData` construction. Page components should call `api.createProduct(...)` with typed values, not
  construct raw multipart bodies themselves.

#### 4. Validation & Error Matrix

- Missing `file` for `image` entry is handled by the page before calling the API.
- Missing `entry_text` for `copy` or `tail` entry is handled by the page before calling the API.
- Invalid/unknown `canvas_template_key`, unknown `initial_workflow_entry`, or mismatched template entry is backend
  validation and surfaces through `ApiError.detail`.
- Upload MIME/size errors are backend upload-validation errors and surface through the same `ApiError.detail` path.

#### 5. Good/Base/Bad Cases

- Good: `InspirationCreatePage` stores a selected plan key in component state, displays merchant-facing labels, and passes
  `canvas_template_key` plus `initial_workflow_entry` into `api.createProduct`.
- Good: `copy` entry submits `{ initial_workflow_entry: "copy", entry_text }` without `file`.
- Good: `blank` entry can submit no `file` and no `entry_text`, and may still pass a non-empty `canvas_template_key`.
- Base: a no-template/basic option can use `""` while still sharing the typed DTO.
- Bad: `InspirationCreatePage` creates `FormData` directly and bypasses the typed API helper.
- Bad: frontend renames `canvas_template_key` to `canvasTemplateKey` without an explicit mapping layer.
- Bad: treating `canvas_template_key="blank"` as equivalent to `initial_workflow_entry="blank"`.

#### 6. Tests Required

- `pnpm --dir web build` must pass after any create-inspiration DTO change.
- Add focused frontend tests for pure helper logic if plan selection or payload routing becomes non-trivial.
- Backend API tests remain the source of truth for multipart validation, template-key error status, and persisted template
  coordinates mirrored by the creation page preview.

#### 7. Wrong vs Correct

Wrong:

```ts
return api.createProduct({
  name,
  file,
  canvasTemplateKey,
});
```

Correct:

```ts
return api.createProduct({
  name,
  file,
  canvas_template_key: selectedPlanKey,
});
```

### Scenario: Inspiration list summary display DTO

#### 1. Scope / Trigger

- Trigger: changes to `InspirationSummary`, `/api/inspirations` response fields, `InspirationListPage`, or inspiration-list display
  helpers.
- The list displays both generated-result imagery and starting input info, so the DTO must keep those fields separate.

#### 2. Signatures

- Shared frontend DTO: `InspirationSummary`.
- API method: `api.listProducts(...): Promise<InspirationListResponse>`.
- Summary fields used by the list:
  - `initial_workflow_entry: InspirationInitialWorkflowEntry | null`
  - `initial_entry_text: string | null`
  - `initial_entry_text_excerpt: string | null`
  - `latest_generated_image_download_url: string | null`
  - `latest_generated_image_preview_url: string | null`
  - `latest_generated_image_thumbnail_url: string | null`
  - Existing `source_image_*` fields remain the start-image fields.

#### 3. Contracts

- `InspirationThumbnail` / main row thumbnail must read only `latest_generated_image_thumbnail_url ??
  latest_generated_image_preview_url`.
- Main row thumbnail must not fall back to `source_image_thumbnail_url`; no generated result means an image placeholder.
- Inspiration key-info for `initial_workflow_entry="image"` reads `source_image_thumbnail_url ?? source_image_preview_url`.
- Inspiration key-info for `copy` / `tail` reads `initial_entry_text` and falls back to `initial_entry_text_excerpt` for older responses.
- Inspiration key-info text is allowed to exceed six characters; the UI truncates with ellipsis based on available width.
- Inspiration key-info for `blank`, missing text, or missing image returns a stable empty state.
- Keep backend `snake_case` names in `InspirationSummary`; do not introduce camelCase aliases in page code.

#### 4. Validation & Error Matrix

- New backend summary field missing from `types.ts` -> `just web-build` should fail or page code must not consume it.
- Inspiration has source image but no generated result -> main thumbnail helper returns `null`.
- Copy/tail entry has blank full text and blank excerpt -> key-info helper returns empty.
- Image entry has no source image URL -> key-info helper returns empty.

#### 5. Good/Base/Bad Cases

- Good: `inspirationMainThumbnailUrl(inspiration)` returns the generated thumbnail and `inspirationKeyInfo(inspiration)` returns a source
  image for image-entry rows.
- Good: a copy-entry row with `initial_entry_text="免安装收纳架适配厨房场景"` renders the full text in the key-info column/card
  and truncates visually with an ellipsis when the column is narrow.
- Base: legacy rows with no `initial_workflow_entry` but a source image may show the source image as key-info while keeping
  the main thumbnail empty.
- Bad: `InspirationThumbnail` uses `source_image_thumbnail_url ?? source_image_preview_url` as its image source.
- Bad: page components infer copy/tail text by slicing arbitrary inspiration names or source filenames.

#### 6. Tests Required

- Pure helper tests for main thumbnail generated-only behavior.
- Pure helper tests for image, copy/tail, and blank key-info behavior.
- `pnpm --dir web lint`, `pnpm --dir web test:run`, and `just web-build` after DTO/UI changes.

#### 7. Wrong vs Correct

Wrong:

```ts
const thumbUrl = inspiration.source_image_thumbnail_url ?? inspiration.source_image_preview_url;
```

Correct:

```ts
const thumbUrl = inspiration.latest_generated_image_thumbnail_url ?? inspiration.latest_generated_image_preview_url;
```

---

## Local Types

### Scenario: Settings migration API typing

#### 1. Scope / Trigger
- Trigger: changes to settings export/import API methods, SettingsPage import/export UI, or backend
  `SettingsExportDocument` / `SettingsImportPreviewResponse` / `SettingsImportCommitResponse` schemas.
- Settings migration is a cross-layer DTO contract. Keep TypeScript types aligned with backend Pydantic schemas and keep
  backend `snake_case` field names.

#### 2. Signatures
- API methods:
  - `api.exportSettings(): Promise<SettingsExportDocument>`
  - `api.previewSettingsImport(payload: SettingsExportDocument): Promise<SettingsImportPreview>`
  - `api.importSettings(payload: SettingsExportDocument): Promise<SettingsImportCommitResponse>`
- Frontend DTOs live in `web/src/lib/types.ts` and mirror backend field names:
  - `SettingsExportDocument`
  - `SettingsExportMetadata`
  - `SettingsProviderProfileExport`
  - `SettingsProviderBindingExport`
  - `SettingsExportGenerationResourceGroup`
  - `SettingsGenerationConfigExport`
  - `SettingsCanvasTemplateCategoryExport`
  - `SettingsCanvasTemplateExport`
  - `SettingsImportPreview`
  - `SettingsImportCommitResponse`
  - `GenerationConfig`, `GenerationConfigOption`, `GenerationConfigStatus`

#### 3. Contracts
- `runtime_config` is a map of config key to JSON scalar/list values from the backend export.
- `runtime_config` must not include legacy `admin_access_required`; account login is always required by the backend.
- `provider_profiles` may include `api_key`; SettingsPage must treat exported files as sensitive and show confirmation
  copy before download.
- `generation_resource_groups` is the provider/generation grouping payload. It includes `id`, `key`, `name`,
  `description`, `sort_order`, `enabled`, `archived_at`, `created_at`, and `updated_at`.
- `generation_configs` is the runtime provider-selection payload. It includes `resource_group_ids`, compatibility
  `resource_group_id`, `purpose`, `name`, `provider_kind`, `provider_profile_id`, `model_settings`, `config`, `priority`,
  `max_concurrency`, `enabled`, `availability_window_minutes`, `failure_threshold`, and `cooldown_minutes`.
- `provider_bindings` is compatibility data only. New UI and workflow/image-chat selectors should read
  `generation_configs` or `generation-config-options`.
- `canvas_template_categories` and `canvas_templates` mirror backend export rows and preserve backend `snake_case` fields,
  including `scope`, `owner_user_id`, `enabled`, `disabled_reason`, `review_status`, `review_note`, and timestamps.
- Import preview response fields are flat DTO fields such as `runtime_config_count`,
  `provider_profile_count`, `provider_binding_count`, `generation_resource_group_count`, `generation_config_count`,
  `canvas_template_category_count`, `canvas_template_count`, `includes_api_keys`, and
  `provider_profiles_with_api_key_count`; do not invent a nested `metadata.summary` layer unless the backend schema
  changes in the same commit.
- Import commit returns refreshed settings/provider config data or enough data for SettingsPage to invalidate and refetch
  `['config']`, `['provider-config']`, `['runtime-config']`, `['canvas-templates']`, and
  `['canvas-template-categories']`.
- `GET /api/settings/generation-config-options` requires backend RBAC and intentionally returns only non-secret selection
  fields: `id`, `resource_group_id`, `resource_group_ids`, `purpose`, `name`, `provider_kind`, `enabled`, `priority`,
  `frozen_until`.
- `GET /api/settings/generation-config-status` requires `status:read` and accepts optional `start_date` / `end_date`
  query parameters in backend `YYYY-MM-DD` stat-date format. Keep `today_*` fields as today's local stat bucket, use
  `range_*` fields for the selected date range, and render per-config `range_stat` instead of recalculating stats from
  frontend history.
- Workflow and image-chat request DTOs preserve backend snake_case fields. User-facing generation submits
  `resource_group_id`; ImageChat prompt polish/image generation and workflow generation-capable node config may submit either
  `generation_config_mode: "auto", generation_config_id: null` or
  `generation_config_mode: "manual", generation_config_id: <id>`.
- SettingsPage generation config drafts use `resource_group_ids: string[]` as the source of truth. Payload helpers include
  both `resource_group_ids` and compatibility `resource_group_id: resource_group_ids[0] ?? null`.
- Frontend helpers may fall back from missing/empty `resource_group_ids` to legacy `resource_group_id` only when reading
  backend or imported legacy rows. New exports and save payloads must include `resource_group_ids`.

#### 4. Validation & Error Matrix
- Invalid JSON file -> SettingsPage shows a local invalid-file error before calling the API.
- API 400 from preview/commit -> show `ApiError.detail`.
- User cancels export/import confirmation -> do not call the API.
- Successful import -> invalidate settings/runtime/session queries so UI reflects the imported values.
- Export payload missing `generation_resource_groups` -> local payload validation rejects the file before preview.
- Missing both `resource_group_ids` and legacy `resource_group_id` in generation config export rows -> backend import treats
  the config as legacy/unbound according to backend rules; frontend current exports must include `resource_group_ids`.
- `resource_group_ids: []` in generation config rows -> render as unbound in SettingsPage and preserve an empty list when
  saving.

#### 5. Good/Base/Bad Cases
- Good: export downloads exactly the typed backend payload, including `generation_resource_groups` and
  `generation_configs`, then importing that JSON previews the same counts.
- Good: export/import previews include template category/template counts and key/name summaries.
- Good: preview with `includes_api_keys=true` shows sensitive-file warning before commit.
- Good: SettingsPage config cards use group DTOs for assignment, while ImageChat and workflow generation selectors use
  account-available group DTOs plus non-secret `GenerationConfigOption` rows filtered by selected group and purpose.
- Good: a SettingsPage generation config card can check both `default` and `campaign`; save payload contains
  `resource_group_ids: ["default-id", "campaign-id"]` plus compatibility `resource_group_id: "default-id"`.
- Good: reading a legacy config with only `resource_group_id: "default-id"` derives `resource_group_ids: ["default-id"]`
  for the draft.
- Base: import file contains `mock` generation configs and no provider API keys.
- Bad: adding `admin_access_required` back to `RuntimeConfig` or SettingsPage security controls.
- Bad: frontend reads `preview.metadata.summary` when backend returns flat preview fields.
- Bad: converting DTO fields to camelCase in `types.ts` without an explicit API mapping layer.
- Bad: reusing provider profile DTOs for generation config selectors and accidentally exposing `api_key`.
- Bad: showing ImageChat/workflow prompt-polish, copy, or tail configs without `purpose="text"` or image-generation configs
  without `purpose="image"`.
- Bad: allowing an ImageChat/workflow manual `generation_config_id` to remain selected after the user switches to a
  resource group that does not include that config's `resource_group_ids`.
- Bad: using only `resource_group_id` in SettingsPage filters or save payloads after multi-group config bindings are
  supported.

#### 6. Tests Required
- SettingsPage tests for export confirmation and generated JSON download path.
- SettingsPage tests for import preview summary, API-key warning, commit confirmation, and query invalidation.
- Helper tests proving workflow/image-chat payloads round-trip `resource_group_id`; auto generation keeps
  `generation_config_mode: "auto"` and `generation_config_id: null`, while manual generation submits the selected config
  id for ImageChat and workflow nodes.
- SettingsPage helper tests prove `resource_group_ids` payload construction, multi-group tab filtering/counting, unbound
  empty-list handling, and legacy `resource_group_id` fallback.
- `pnpm --dir web build` after any settings migration DTO change.

#### 7. Wrong vs Correct

Wrong:

```ts
const keyCount = preview.metadata.summary.providerProfilesWithApiKeyCount;
```

Correct:

```ts
const keyCount = preview.provider_profiles_with_api_key_count;
```

Keep frontend reads aligned with the backend response shape.

Wrong:

```ts
generationConfigId: selectedConfigId
```

Correct:

```ts
generation_config_id: selectedConfigId
```

Wrong:

```ts
resource_group_id: draft.resource_group_id
```

Correct:

```ts
resource_group_id: draft.resource_group_ids[0] ?? null,
resource_group_ids: draft.resource_group_ids,
```

---

### Scenario: Generation resource group frontend DTOs

#### 1. Scope / Trigger
- Trigger: changes to generation group settings UI, RBAC user grants, image-chat generation, workflow inspector
  generation settings, gallery/inspiration-history filters, generated-result DTOs, or sensitive-image list masking.
- This is a cross-layer DTO contract. Frontend types mirror backend `snake_case` fields and page code must keep group
  selection separate from concrete provider config management.

#### 2. Signatures
- Shared DTOs in `web/src/lib/types.ts`:
  - `GenerationResourceGroup` includes `blur_images_by_default: boolean`.
  - `GenerationResourceGroupTag` includes `blur_images_by_default: boolean`.
  - `GenerationResourceGroupCreateRequest` may include `blur_images_by_default?: boolean`.
  - `GenerationResourceGroupUpdateRequest` may include `blur_images_by_default?: boolean | null`.
  - `GenerationConfig`, `GenerationConfigOption`, `GenerationConfigStatus`, and `SettingsGenerationConfigExport` include
    `resource_group_ids: string[]` plus compatibility `resource_group_id?: string | null`.
  - `UserGenerationResourceGroupGrants`
- API methods in `web/src/lib/api.ts`:
  - `listGenerationResourceGroups()`
  - `listMyGenerationResourceGroups()`
  - `createGenerationResourceGroup(payload)`
  - `updateGenerationResourceGroup(id, payload)`
  - `archiveGenerationResourceGroup(id)`
  - `getUserGenerationResourceGroupGrants(userId)`
  - `updateUserGenerationResourceGroupGrants(userId, { resource_group_ids })`
- Generated result DTOs carry `resource_group_id?: string | null` plus required
  `resource_group: GenerationResourceGroupTag`.
- Settings export/import DTOs that carry `generation_resource_groups` preserve `blur_images_by_default`.

#### 3. Contracts
- SettingsPage owns group CRUD and generation config group assignment. Generation config assignment is multi-select:
  settings filters and counts use `resource_group_ids.includes(group.id)`, while the unbound tab uses
  `resource_group_ids.length === 0`. Mutations invalidate `['provider-config']`,
  `['my-generation-resource-groups']`, `['generation-config-options']`, and generation status queries when relevant.
- RBAC page uses the full group list for admin grant editing and account grant replacement. Admin users render a read-only
  group-grant panel because backend grants all enabled groups automatically.
- Backend group-list APIs own option ordering: descending `sort_order`, then ascending `created_at`, then ascending
  `name`. Frontend selectors must not re-sort generation groups.
- `web/src/lib/resourceGroups.ts` is the frontend single source for active generation group filtering and first concrete
  default selection.
- Selection controls that show account-available generation groups must use
  `activeGenerationResourceGroupsInApiOrder(groups)`: include only enabled, unarchived groups and preserve API order.
- ImageChatPage reads `['my-generation-resource-groups']` and `['generation-config-options']`, defaults to
  `firstActiveGenerationResourceGroupId(groups)`, requires one selected group before submit, and filters manual
  prompt-polish/image-generation config options by selected group plus `purpose`.
- InspirationDetail workflow inspector and tail-plan generation require a selected group for generation-capable nodes, and
  filter manual config options by selected group plus node purpose: `text` for copy/tail and `image` for image nodes.
- Gallery, image-session list, and inspiration history filters keep an all-groups option, but initial load and concrete
  selection invalidation default to `firstActiveGenerationResourceGroupId(groups)` when a concrete group exists.
- Gallery, image-session list, and inspiration history filters pass `resource_group_id` as a query parameter only when a
  concrete group is selected; the all-groups option is used only after explicit user selection and omits
  `resource_group_id`.
- Generated result cards, previews, node-run rows, and history entries should display `resource_group.name` from the DTO.
  Do not derive labels from config ids or provider names.
- Runtime resources such as inspirations, image sessions, workflow node runs, rounds, and gallery entries stay single-group
  DTOs with one `resource_group_id`; only generation provider configs use `resource_group_ids`.
- Sensitive-image masking uses `shouldMaskSensitiveImage(personalMaskEnabled, row.resource_group)`: return true only when
  the personal list preference is enabled and that row's `resource_group.blur_images_by_default` is true.
- Personal sensitive-image preferences are account-level server DTOs in `UserUiPreferences`, loaded through
  `api.getUserUiPreferences()` and patched through `api.updateUserUiPreferences(...)`. Do not create page-local DTO copies
  or localStorage-specific aliases for these fields.
- Sensitive-image masking currently applies only to inspiration list thumbnails/previews, image-chat session/history
  thumbnails, and the image-chat center current-result image. Gallery UI is outside this behavior unless a later
  requirement explicitly adds it.
- `SensitiveImageMask` renders an icon-only overlay. Use `intensity="soft"` for list/history thumbnails and
  `intensity="strong"` for the image-chat center current-result image.
- Page code must evaluate masking per row from the row DTO. Do not mask all visible images just because the selected list
  filter points at a sensitive group.

#### 4. Validation & Error Matrix
- `listMyGenerationResourceGroups()` returns no enabled groups -> generation controls are disabled and show the
  group-required message.
- Selected group disappears, becomes disabled, or is archived after refetch -> page resets to the first enabled group or
  clears selection.
- SettingsPage generation config draft with no checked groups -> save an empty `resource_group_ids` list and show the config
  only in the unbound settings tab.
- Generation submit without selected group -> page shows local validation and does not call the API.
- Gallery/image-session-list/inspiration-history "all groups" selected -> omit `resource_group_id`; selected group ->
  include the exact id.
- Missing required `resource_group` tag in a generated-result factory/test -> `just web-build` fails.
- Missing `blur_images_by_default` in `GenerationResourceGroupTag` factories -> TypeScript tests/build fail.
- `personalMaskEnabled=false` -> do not mask, even when `resource_group.blur_images_by_default=true`.
- `personalMaskEnabled=true` with missing/null/false `resource_group.blur_images_by_default` -> do not mask.

#### 5. Good/Base/Bad Cases
- Good: image-chat displays a compact "生成分组" selector with `default`, and generated round metadata shows the same
  group label.
- Good: inspiration history, image-session list, and gallery filter options keep "所有分组" but initially select the first
  concrete group returned by `activeGenerationResourceGroupsInApiOrder`.
- Good: SettingsPage can create a group, then generation config cards assign text/image configs to that group.
- Good: SettingsPage can assign a text/image generation config to multiple groups with checkboxes; each selected group tab
  shows and counts that config.
- Good: SettingsPage can enable `blur_images_by_default` for a group, and inspiration/image-chat lists mask only rows
  whose own `resource_group.blur_images_by_default` is true while the page preference is enabled.
- Good: image-chat center current-result masking uses the same selected round `resource_group` predicate as history
  thumbnails, but renders with the stronger mask intensity.
- Good: RBAC grant panel exposes checkbox grants for non-admin users and read-only copy for admins.
- Base: a local default setup has one enabled `default` group.
- Bad: a list filter defaults to the all-groups option when at least one concrete active group is available.
- Bad: image-chat exposes `GenerationConfigOption` or provider profile details in the normal submit UI.
- Bad: a gallery card renders group text by checking `resource_group_id === defaultId` in the component.
- Bad: treating `GenerationConfig.resource_group_id` as the source of truth for SettingsPage group tabs after
  `resource_group_ids` exists.
- Bad: using the selected filter group to decide masking for every visible list item.
- Bad: applying sensitive-image masking to gallery cards without a new gallery-specific requirement and tests.
- Bad: showing a text label such as "已遮罩" inside the mask overlay.
- Bad: using the thumbnail-strength mask on the image-chat center current-result image.

#### 6. Tests Required
- SettingsPage tests cover group payloads, import/export counts, generation config `resource_group_ids`, and legacy
  `resource_group_id` fallback.
- Image-chat helper tests include `resource_group_id` in submit signatures, task placeholders, and regenerate payloads.
- InspirationDetail workflow config tests round-trip node `resource_group_id` plus `generation_config_mode/id` for
  copy/tail/image nodes.
- Gallery/inspiration-history tests cover filter query params and required `resource_group` result tags.
- `web/src/lib/resourceGroups.test.ts` covers active group filtering, API-order preservation, first concrete default
  selection, and empty-list fallback. Backend tests cover descending `sort_order` and tie-break order.
- `web/src/lib/sensitiveImages.test.ts` covers per-row masking and local preference key/default parsing.
- Run `pnpm --dir web lint`, `pnpm --dir web test:run`, and `just web-build`.

#### 7. Wrong vs Correct

Wrong:

```ts
api.generateImageSessionRound(sessionId, {
  generation_config_mode: "manual",
  generation_config_id: selectedConfigId,
});
```

Correct:

```ts
api.generateImageSessionRound(sessionId, {
  resource_group_id: selectedResourceGroupId,
  generation_config_mode: "auto",
  generation_config_id: null,
});
```

Wrong:

```tsx
<span>{entry.provider_name ?? "默认分组"}</span>
```

Correct:

```tsx
<span>{entry.resource_group.name}</span>
```

Wrong:

```tsx
const masked = selectedResourceGroup?.blur_images_by_default && maskSensitiveImages;
```

Correct:

```tsx
const masked = shouldMaskSensitiveImage(maskSensitiveImages, entry.resource_group);
```

---

Use local `type` aliases for page-only structures:

- `EditableCopy` in `InspirationDetailPage.tsx`.
- `DraftValue` in `SettingsPage.tsx`.

Use `interface` for component props and DTO object shapes:

- `TopNavProps` in `TopNav.tsx`.
- `ConfigFieldProps` in `SettingsPage.tsx`.
- API DTOs in `web/src/lib/types.ts`.

Static option arrays can use `as const`, as in `ImageChatPage.tsx::DEFAULT_SIZE_OPTIONS`.

---

## Runtime Validation Reality

The frontend currently relies on backend validation for API payloads and on TypeScript for compile-time checks. There is no
Zod/Yup/io-ts runtime validation layer in `web/src/`.

Existing frontend-side validation is lightweight and UI-oriented:

- Required form fields and file accept attributes in `InspirationCreatePage.tsx`.
- Config input types/min/max from backend-provided `ConfigItem` metadata in `SettingsPage.tsx`.
- Allowed image size options derived from `/api/settings` in `ImageChatPage.tsx`.

Do not add a validation library unless a feature truly needs client-side runtime parsing beyond backend errors.

---

## Handling Unknown Data

Use `unknown`, not `any`, for flexible payloads. `CreativeBriefSummary.payload` in `web/src/lib/types.ts` allows known
optional fields and `[key: string]: unknown` for provider-specific additions.

When narrowing errors, follow current patterns:

```ts
if (mutationError instanceof ApiError) {
  setError(mutationError.detail);
  return;
}
setError(mutationError instanceof Error ? mutationError.message : "创建灵感产物失败");
```

---

## Avoid

- `any` in API types, component props, or mutation payloads.
- Duplicating DTO interfaces inside pages instead of importing from `web/src/lib/types.ts`.
- Renaming API fields to camelCase only on the frontend.
- Type assertions that hide missing null checks; prefer `enabled: Boolean(id)` for queries and explicit null rendering.
- Adding new backend response fields without updating `web/src/lib/types.ts` and the relevant UI.
