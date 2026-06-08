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
- `generation_configs` is the runtime provider-selection payload. It includes `resource_group_id`, `purpose`, `name`,
  `provider_kind`, `provider_profile_id`, `model_settings`, `config`, `priority`, `max_concurrency`, `enabled`,
  `availability_window_minutes`, `failure_threshold`, and `cooldown_minutes`.
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
  fields: `id`, `purpose`, `name`, `provider_kind`, `enabled`, `priority`, `frozen_until`.
- `GET /api/settings/generation-config-status` requires `status:read` and accepts optional `start_date` / `end_date`
  query parameters in backend `YYYY-MM-DD` stat-date format. Keep `today_*` fields as today's local stat bucket, use
  `range_*` fields for the selected date range, and render per-config `range_stat` instead of recalculating stats from
  frontend history.
- Workflow and image-chat request DTOs preserve backend snake_case fields. User-facing generation submits
  `resource_group_id`; normal image-chat submits `generation_config_mode: "auto"` and `generation_config_id: null`.

#### 4. Validation & Error Matrix
- Invalid JSON file -> SettingsPage shows a local invalid-file error before calling the API.
- API 400 from preview/commit -> show `ApiError.detail`.
- User cancels export/import confirmation -> do not call the API.
- Successful import -> invalidate settings/runtime/session queries so UI reflects the imported values.
- Export payload missing `generation_resource_groups` -> local payload validation rejects the file before preview.
- Missing `resource_group_id` in generation config export rows -> backend import handles only legacy payloads; frontend
  current exports must include it.

#### 5. Good/Base/Bad Cases
- Good: export downloads exactly the typed backend payload, including `generation_resource_groups` and
  `generation_configs`, then importing that JSON previews the same counts.
- Good: export/import previews include template category/template counts and key/name summaries.
- Good: preview with `includes_api_keys=true` shows sensitive-file warning before commit.
- Good: SettingsPage config cards use group DTOs for assignment, while image-chat generation uses only account-available
  group DTOs.
- Base: import file contains `mock` generation configs and no provider API keys.
- Bad: adding `admin_access_required` back to `RuntimeConfig` or SettingsPage security controls.
- Bad: frontend reads `preview.metadata.summary` when backend returns flat preview fields.
- Bad: converting DTO fields to camelCase in `types.ts` without an explicit API mapping layer.
- Bad: reusing provider profile DTOs for generation config selectors and accidentally exposing `api_key`.
- Bad: showing concrete generation-config choices in image-chat normal generation after groups are available.

#### 6. Tests Required
- SettingsPage tests for export confirmation and generated JSON download path.
- SettingsPage tests for import preview summary, API-key warning, commit confirmation, and query invalidation.
- Helper tests proving workflow/image-chat payloads round-trip `resource_group_id`; image-chat normal generation keeps
  `generation_config_mode: "auto"` and `generation_config_id: null`.
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

---

### Scenario: Generation resource group frontend DTOs

#### 1. Scope / Trigger
- Trigger: changes to generation group settings UI, RBAC user grants, image-chat generation, workflow inspector
  generation settings, gallery/inspiration-history filters, or generated-result DTOs.
- This is a cross-layer DTO contract. Frontend types mirror backend `snake_case` fields and page code must keep group
  selection separate from concrete provider config management.

#### 2. Signatures
- Shared DTOs in `web/src/lib/types.ts`:
  - `GenerationResourceGroup`
  - `GenerationResourceGroupTag`
  - `GenerationResourceGroupCreateRequest`
  - `GenerationResourceGroupUpdateRequest`
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

#### 3. Contracts
- SettingsPage owns group CRUD and generation config group assignment. Mutations invalidate `['provider-config']`,
  `['my-generation-resource-groups']`, `['generation-config-options']`, and generation status queries when relevant.
- RBAC page uses the full group list for admin grant editing and account grant replacement. Admin users render a read-only
  group-grant panel because backend grants all enabled groups automatically.
- `web/src/lib/resourceGroups.ts` is the frontend single source for active generation group option ordering and first
  concrete default selection.
- Selection controls that show account-available generation groups must use
  `activeGenerationResourceGroupsByPriority(groups)`: include only enabled, unarchived groups, sort by descending
  `sort_order`, and keep equal-priority ordering stable with `created_at` and `name`.
- ImageChatPage reads `['my-generation-resource-groups']`, defaults to `firstActiveGenerationResourceGroupId(groups)`,
  requires one selected group before submit, and sends `resource_group_id` with `generation_config_mode: "auto"`.
- InspirationDetail workflow inspector and tail-plan generation require a selected group for generation-capable nodes.
- Gallery, image-session list, and inspiration history filters keep an all-groups option, but initial load and concrete
  selection invalidation default to `firstActiveGenerationResourceGroupId(groups)` when a concrete group exists.
- Gallery, image-session list, and inspiration history filters pass `resource_group_id` as a query parameter only when a
  concrete group is selected; the all-groups option is used only after explicit user selection and omits
  `resource_group_id`.
- Generated result cards, previews, node-run rows, and history entries should display `resource_group.name` from the DTO.
  Do not derive labels from config ids or provider names.

#### 4. Validation & Error Matrix
- `listMyGenerationResourceGroups()` returns no enabled groups -> generation controls are disabled and show the
  group-required message.
- Selected group disappears, becomes disabled, or is archived after refetch -> page resets to the first enabled group or
  clears selection.
- Generation submit without selected group -> page shows local validation and does not call the API.
- Gallery/image-session-list/inspiration-history "all groups" selected -> omit `resource_group_id`; selected group ->
  include the exact id.
- Missing required `resource_group` tag in a generated-result factory/test -> `just web-build` fails.

#### 5. Good/Base/Bad Cases
- Good: image-chat displays a compact "生成分组" selector with `default`, and generated round metadata shows the same
  group label.
- Good: inspiration history, image-session list, and gallery filter options keep "所有分组" but initially select the first
  concrete group returned by `activeGenerationResourceGroupsByPriority`.
- Good: SettingsPage can create a group, then generation config cards assign text/image configs to that group.
- Good: RBAC grant panel exposes checkbox grants for non-admin users and read-only copy for admins.
- Base: a local default setup has one enabled `default` group.
- Bad: a list filter defaults to the all-groups option when at least one concrete active group is available.
- Bad: image-chat exposes `GenerationConfigOption` or provider profile details in the normal submit UI.
- Bad: a gallery card renders group text by checking `resource_group_id === defaultId` in the component.

#### 6. Tests Required
- SettingsPage tests cover group payloads, import/export counts, and generation config `resource_group_id`.
- Image-chat helper tests include `resource_group_id` in submit signatures, task placeholders, and regenerate payloads.
- InspirationDetail workflow config tests round-trip node `resource_group_id` and keep generated config mode automatic.
- Gallery/inspiration-history tests cover filter query params and required `resource_group` result tags.
- `web/src/lib/resourceGroups.test.ts` covers active group filtering, descending `sort_order`, stable tie-breaks, first
  concrete default selection, and empty-list fallback.
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
