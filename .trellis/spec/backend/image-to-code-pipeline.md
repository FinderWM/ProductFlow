# Image-to-Code Pipeline

> Backend contracts for image-to-code jobs, preview delivery, and local Figma export artifacts.

## Scenario: Image-to-Code Job Backend Pipeline

### 1. Scope / Trigger

- Trigger: adding or changing image-to-code job behavior, preview HTML delivery, Figma local export artifacts, queue
  recovery, storage layout, RBAC/menu wiring, or result manifest fields.
- Applies to `application/image_to_code/`, `presentation/routes/image_to_code.py`,
  `presentation/schemas/image_to_code.py`, `infrastructure/storage.py`, `infrastructure/queue.py`, `workers.py`,
  `domain/rbac.py`, `domain/enums.py`, DB models, and the `image_to_code_jobs` Alembic migration.

### 2. Signatures

- DB table: `image_to_code_jobs`
  - owner/source snapshot: `owner_user_id`, `source_kind`, `source_ref`, `source_width`, `source_height`,
    `source_mime_type`
  - job config: `delivery_mode`, `job_params_json`
  - durable status: `status`, `progress_phase`, `progress_completed`, `progress_total`, `progress_updated_at`,
    `started_at`, `finished_at`, `attempts`, `last_error`, `result_manifest_json`
  - indexes:
    - `ix_image_to_code_jobs_owner_status_created`
    - `ix_image_to_code_jobs_source`
- REST API:
  - `POST /api/image-to-code-jobs`
  - `GET /api/image-to-code-jobs`
  - `GET /api/image-to-code-jobs/{job_id}`
  - `POST /api/image-to-code-jobs/{job_id}/cancel`
  - `POST /api/image-to-code-jobs/{job_id}/retry`
  - `GET /api/image-to-code-jobs/{job_id}/preview`
  - `GET /api/image-to-code-jobs/{job_id}/preview/assets/{asset_path}`
  - `GET /api/image-to-code-jobs/{job_id}/assets/{asset_path}` (relative-path compatibility alias for HTML preview)
  - `GET /api/image-to-code-jobs/{job_id}/artifacts/{artifact_id}/download`
- Job/runtime API:
  - `submit_image_to_code_job(...)`
  - `list_image_to_code_jobs(...)`
  - `count_image_to_code_jobs(...)`
  - `get_image_to_code_job(...)`
  - `cancel_image_to_code_job(...)`
  - `retry_image_to_code_job(...)`
  - `execute_image_to_code_job(job_id: str) -> None`
  - `recover_unfinished_image_to_code_jobs(...) -> int`
- Queue/worker API:
  - `enqueue_image_to_code_job(job_id: str) -> None`
  - `enqueue_image_to_code_job_later(job_id: str, *, delay_ms: int) -> None`
  - `run_image_to_code_job(job_id: str) -> None`
- Storage API:
  - `save_image_to_code_file(job_id, relative_path, content, *, content_type=None, warm_variants=False) -> str`

### 3. Contracts

- Source contract:
  - C1 accepts only `source_kind="resource_library_asset"`.
  - The source asset must exist, belong to the current user unless admin, remain usable under moderation/effective-enable
    checks, and have `kind="image"`.
- Delivery contract:
  - Results never write back into the resource library automatically.
  - Static-site delivery always owns an internal preview HTML and asset tree under `image-to-code/{job_id}/site/`.
  - `delivery_mode="figma_export"` and `delivery_mode="both"` additionally emit local Figma artifacts and summary fields.
- Preview contract:
  - Stored manifest keeps internal keys such as `preview_index_storage_key`, `preview_asset_storage_keys`, and per-artifact
    `storage_key`.
  - API serializers must strip those storage keys from public payloads and replace them with same-origin
    `download_url`, `site_preview_url`, and `preview_available`.
  - HTML preview assets may be requested as either `assets/site.css` or bare relative paths such as `site.css`; the asset
    route must normalize both because the in-product iframe resolves relative URLs against
    `/api/image-to-code-jobs/{job_id}/assets/...`.
- Artifact/storage contract:
  - Storage layout is isolated under `image-to-code/{job_id}/source/`, `preview/`, `site/`, `figma/`, and `reports/`.
  - `site_index_html` reuses the persisted `site/index.html` storage object instead of writing a duplicate artifact file.
  - Failed or cancelled jobs clear `result_manifest_json`. Objects already written under `image-to-code/{job_id}` remain
    unreferenced for storage lifecycle cleanup; business flows do not physically delete them.
- Figma reservation contract:
  - First release supports only local export artifacts such as `figma-layer-spec.json`, `figma-import.zip`, and
    `README.md`.
  - Remote write remains reserved-only and must stay disabled in generated payloads:
    - `figma_layer_spec.remote_write.enabled = false`
    - importer `import.json.remote_write_enabled = false`
  - Do not add API params, UI switches, or provider settings for remote Figma write in this feature.
- Progress/recovery contract:
  - `progress_total=3` for static-site-only jobs and `progress_total=4` when Figma export is included.
  - Startup/worker recovery may requeue queued jobs and stale running jobs; stale detection uses the latest of
    `progress_updated_at`, `updated_at`, and `started_at`.

### 4. Validation & Error Matrix

- Unsupported `source_kind` -> `BusinessValidationError("当前仅支持从资源库图片创建图片转代码任务")`
- Missing/archived source asset -> `NotFoundError("资源库图片不存在")`
- Source asset owned by another user without admin override -> same not-found contract, do not leak existence
- Disabled/effectively-disabled source asset -> moderation/resource-usable business error
- Non-image resource-library asset -> `BusinessValidationError("当前仅支持图片资源")`
- Invalid `page_type` or `fidelity_mode` in request payload -> request validation `422`
- Cancel on `succeeded` / `failed` / `cancelled` job -> `BusinessValidationError("任务已结束，不能取消")`
- Retry on queued/running job -> `BusinessValidationError("任务运行中，不能重跑")`
- Preview requested before preview artifacts exist -> `404`, `"网页预览不存在"`
- Preview asset/artifact storage key missing or invalid -> `404`, `"网页预览资源不存在"` or `"交付文件不存在"`
- Invalid storage deletion prefix or path traversal in helper inputs -> `ValueError`

### 5. Good/Base/Bad Cases

- Good: a user selects one personal resource-library image, creates a `both` job, receives a succeeded manifest with
  preview HTML, site zip, preview image, Figma import zip, and Figma summary fields.
- Good: preview HTML references `assets/site.css`, and the product iframe can resolve that through the compatibility alias
  route without leaking raw storage URLs.
- Base: a `static_site` job completes with `progress_total=3`, preview HTML, delivery report, and no `figma_export`
  summary object.
- Bad: auto-saving generated site bundles or preview images back into the resource library.
- Bad: exposing internal `storage_key` / `preview_asset_storage_keys` fields to the frontend.
- Bad: returning `remote_write_enabled=true` anywhere in C1 artifacts or API payloads.

### 6. Tests Required

- API tests:
  - create/list/detail/cancel/retry lifecycle
  - preview HTML headers and same-origin asset download
  - pagination and status filtering
  - invalid request values such as unsupported `page_type`
- Job tests:
  - success lifecycle with preview/site/Figma artifacts
  - cancel + retry contract
  - stale running recovery and requeue behavior
  - cancellation/failure clears durable manifest references without calling object delete APIs
- Migration tests:
  - model/migration contract for `image_to_code_jobs`
  - enum columns remain string-backed with no DB enum/check constraint
- RBAC tests:
  - default menu/API grants include `image_to_code`
  - route access still respects `image_to_code:read` and `image_to_code:generate`

### 7. Wrong vs Correct

Wrong:

```python
return {
    "preview": {
        "site_preview_url": storage.public_url_for_key(index_key),
    },
    "artifacts": artifact_entries,
}
```

Correct:

```python
preview["site_preview_url"] = f"/api/image-to-code-jobs/{job.id}/preview"
artifact["download_url"] = f"/api/image-to-code-jobs/{job.id}/artifacts/{artifact['id']}/download"
artifact.pop("storage_key", None)
```

Wrong:

```python
@router.get("/{job_id}/preview/assets/{asset_path:path}")
def preview_asset(...):
    return FileResponse(storage.resolve(asset_path))
```

Correct:

```python
storage_key = _preview_asset_storage_key(job.result_manifest_json, asset_path)
path = _resolve_storage_key(storage_key, detail="网页预览资源不存在")
return FileResponse(path, media_type=media_type, headers={"X-Content-Type-Options": "nosniff"})
```
