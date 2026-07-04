# Image-to-Code Page

> Frontend contracts for the image-to-code menu, workspace page controls, preview iframe, and typed API usage.

## Scenario: Image-to-Code Workspace Page

### 1. Scope / Trigger

- Trigger: adding or changing the `/image-to-code` route, top-nav entry, workspace form controls, image-to-code query
  behavior, artifact download UI, or preview/Figma summary rendering.
- Applies to `web/src/pages/ImageToCodePage.tsx`, `web/src/App.tsx`, `web/src/components/TopNav.tsx`,
  `web/src/lib/api.ts`, `web/src/lib/types.ts`, `web/src/lib/rbac.ts`, and the locale dictionaries.

### 2. Signatures

- Route/menu:
  - top-level route: `/image-to-code`
  - menu code: `image_to_code`
  - nav i18n key: `nav.imageToCode`
- Typed API helpers:
  - `api.listImageToCodeJobs({ limit?, offset?, status? })`
  - `api.createImageToCodeJob(input)`
  - `api.getImageToCodeJob(jobId)`
  - `api.cancelImageToCodeJob(jobId)`
  - `api.retryImageToCodeJob(jobId)`
- Query keys:
  - `["image-to-code-jobs", statusOrNull, offset]`
  - `["image-to-code-job", jobId]`
- DTOs:
  - `CreateImageToCodeJobInput`
  - `ImageToCodeJob`
  - `ImageToCodeJobListResponse`
  - `ImageToCodeResultManifest`
  - `ImageToCodeArtifact`

### 3. Contracts

- Page input contract:
  - Source selection is single-image-only and comes from `ResourceLibraryModal`.
  - The page submits `source_kind="resource_library_asset"` and never exposes upload/manual URL entry in C1.
  - Delivery/page/fidelity options must stay aligned with backend string unions:
    - delivery: `static_site | figma_export | both`
    - page type: `landing | marketing | editorial`
    - fidelity: `balanced | visual_first | structure_first`
- Layout control contract:
  - Workspace/workbench rendering must use shared controls from `workspaceInputs.tsx` plus the workspace button system.
  - Classic rendering of the same page must use the classic button system or the legacy layout-aware `ActionButton`
    compatibility layer; do not let one hardcoded workspace button class serve both layouts.
  - Do not reintroduce page-local button/input chrome for this page; keep selection toggles on `WorkspaceOptionToggle`
    and binary flags on `WorkspaceSwitch` in workspace mode.
- Query/mutation contract:
  - Job list polling continues only while any visible row is `queued` or `running`.
  - Selected-job polling continues only while the selected detail is active.
  - Create/cancel/retry success handlers update `["image-to-code-job", job.id]`, invalidate `["image-to-code-jobs"]`,
    and keep the selected job id in URL search params.
- Preview/artifact contract:
  - In-product preview uses backend same-origin URLs from `result_manifest.preview.site_preview_url` inside a read-only
    iframe.
  - Artifact links must use backend-provided `download_url`; frontend must not reconstruct storage paths.
  - Preview image, HTML preview, and Figma summary panels remain read-only inspection surfaces. Results do not offer
    “save to resource library”.
- Figma capability contract:
  - UI may show local-export summary and downloads only.
  - Do not render remote-sync buttons, remote-write status chips, or configuration switches for Figma direct write.

### 4. Validation & Error Matrix

- Submit without a selected source image -> local error `imageToCode.error.selectSource`, no API call
- Resource-library modal returns a non-image asset -> selection remains blocked by resource modal disabled contract
- List/detail query failure -> page shows `imageToCode.error.loadFailed` or detail fallback state, not a blank screen
- Cancel mutation failure -> `imageToCode.error.cancelFailed`
- Retry mutation failure -> `imageToCode.error.retryFailed`
- Preview unavailable for unfinished/no-site jobs -> render `imageToCode.previewUnavailable`, not a broken iframe
- Empty job list -> render `imageToCode.emptyJobs`

### 5. Good/Base/Bad Cases

- Good: a workspace user picks one library image, submits a `both` job, sees the task selected in the URL, then opens the
  same-origin HTML preview and downloads both site and Figma artifacts.
- Good: a succeeded `figma_export` or `both` job shows node count, warning count, and frame size before download.
- Base: a `static_site` job still shows preview image, HTML preview, and artifact list while the Figma summary card stays
  hidden.
- Bad: allowing the page to submit with no source and relying on the backend to explain the mistake.
- Bad: hardcoding `/api/image-to-code-jobs/...` download URLs in JSX instead of consuming the typed DTO field.
- Bad: adding a “sync to Figma” toggle before backend planning for remote write exists.

### 6. Tests Required

- Frontend API helper tests:
  - list query parameter serialization
  - create/cancel/retry endpoint and request-body wiring
- Type/build verification:
  - `ImageToCode*` DTOs stay mirrored with backend schemas
  - route registration and nav translation keys compile in all locales
- Backend API tests remain authoritative for preview headers, artifact availability, and RBAC hard gates.

### 7. Wrong vs Correct

Wrong:

```tsx
<button className="rounded-lg bg-indigo-600 px-4 py-2 text-white">开始生成</button>
```

Correct:

```tsx
<ActionButton preset="primary" size="md" onClick={submitJob}>
  {t("imageToCode.submit")}
</ActionButton>
```

Wrong:

```tsx
const previewUrl = `/api/image-to-code-jobs/${selectedJob.id}/preview`;
```

Correct:

```tsx
const previewUrl = selectedJob?.result_manifest?.preview?.preview_available
  ? api.toApiUrl(selectedJob.result_manifest.preview.site_preview_url)
  : null;
```
