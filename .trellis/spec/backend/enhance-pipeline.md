# Enhance Pipeline

> Backend contracts for reusable image enhancement jobs and strategy execution.

## Scenario: Enhance Job Backend Pipeline

### 1. Scope / Trigger

- Trigger: adding or changing image enhancement job behavior, strategy execution, artifact storage, queue recovery,
  resource-library save paths, or API response manifest fields.
- Applies to `application/enhance/`, `presentation/routes/enhance.py`, `presentation/schemas/enhance.py`,
  `infrastructure/storage.py`, `infrastructure/queue.py`, `application/admission.py`, `application/resource_library.py`,
  `domain/enums.py`, `domain/rbac.py`, DB models, and Alembic migrations.

### 2. Signatures

- DB tables:
  - `enhance_jobs`: owner, source kind/ref, source dimensions/mime, `strategy`, `params_json`, `status`,
    progress fields, `result_manifest_json`, generation config selection, timestamps.
  - `enhance_job_inputs`: internal-only source snapshots with standard storage metadata and `created_at`.
- Strategy API:
  - `run_direct_strategy(ctx: EnhanceContext, params: DirectParams) -> EnhanceResult`
  - `run_tiled_strategy(ctx: EnhanceContext, params: TiledParams, *, backend_stitch: bool = False) -> EnhanceResult`
- REST API:
  - `POST /api/enhance-jobs`
  - `GET /api/enhance-jobs`
  - `GET /api/enhance-jobs/{job_id}`
  - `POST /api/enhance-jobs/{job_id}/cancel`
  - `GET /api/enhance-jobs/{job_id}/tiles/{row}/{col}`
  - `GET /api/enhance-jobs/{job_id}/final`
  - `POST /api/enhance-jobs/{job_id}/final`
  - `POST /api/enhance-jobs/{job_id}/save-to-library`
- Storage API:
  - `save_enhance_tile(output_prefix, row, col, content, suffix)`
  - `save_enhance_final(output_prefix, content, suffix)`
  - `save_enhance_input_blob(blob_id, content, suffix)`

### 3. Contracts

- `image_generation_max_dimension` limits only a single provider call:
  - Direct target width/height must be within this limit.
  - Tiled provider tile width/height must be within this limit.
  - Tiled final dimensions may exceed this limit and are protected by independent final pixel/edge/upload-byte bounds.
- A queued/running EnhanceJob owns one image generation config claim for the whole job. Tile generation is serial.
- Usage release counts generated provider units:
  - Direct: `generated_unit_count=1`.
  - Tiled: `generated_unit_count=rows * cols`.
  - Failed/cancelled jobs release with the completed provider call count.
- Tiled async jobs finish provider work with `status=succeeded`, `final_image_ref=None`, and
  `result_manifest_json.final_status="pending_upload"` until `POST /final` stores the frontend-stitched image.
- Direct jobs and backend-stitched tiled executions set `final_image_ref` and `final_status="ready"`.
- Serializers must return same-origin protected `download_url` for tiles and `final_download_url` for final images; do not
  return public object storage URLs for compositor inputs.
- Strategy functions may call providers and storage, but must not claim/release generation configs or mutate ORM job state.
- `ctx.quality_prompt` must be preserved in provider prompts where the strategy supports prompt customization. Direct uses
  `ctx.quality_prompt or DEFAULT_ENHANCE_PROMPT`; Tiled appends the custom instruction to the tile prompt.
- Actor cancellation is checked before each provider call and again after strategy return but before marking success, using
  a refreshed DB row. Cancelled jobs settle durable state without publishing result references and must not be released as
  successful work. Already-written objects remain unreferenced for storage lifecycle cleanup.
- `EnhanceJobInput` is internal-only. Do not add a user temporary upload API for C1.

### 4. Validation & Error Matrix

- Direct target dimension exceeds `image_generation_max_dimension` -> `BusinessValidationError`.
- Tiled `scale` outside `{2, 3, 4}` -> `BusinessValidationError`.
- Tiled `tile_base_size` exceeds `image_generation_max_dimension` -> `BusinessValidationError`.
- Tiled final exceeds independent max edge/pixel/upload-byte bounds -> `BusinessValidationError` or HTTP `413` at upload
  boundary.
- `POST /final` for non-tiled or unfinished jobs -> `BusinessValidationError`.
- `POST /final` dimensions differ from `source_w * scale x source_h * scale` -> `BusinessValidationError`.
- Save-to-library before final is ready -> `BusinessValidationError("拼接结果尚未上传")`.
- Cancel succeeded/failed/cancelled jobs -> `BusinessValidationError`; do not delete completed final artifacts.
- Storage deletion with `inputs`, `node`, path traversal, `.`, or `..` -> `ValueError`.

### 5. Good/Base/Bad Cases

- Good: a 200x200 source with tiled `scale=4`, `tile_base_size=512`, and `image_generation_max_dimension=512` produces an
  800x800 final target, four provider calls, `final_status="pending_upload"`, then accepts an 800x800 final upload.
- Good: a cancelled job whose strategy already wrote final or tile files is observed after strategy return, settles as
  cancelled without a result manifest, and leaves unreferenced objects to the configured lifecycle policy.
- Base: Direct generation returns a ready final immediately and can be saved to the resource library without `POST /final`.
- Bad: rejecting a tiled final only because it is larger than `image_generation_max_dimension`.
- Bad: treating `status=succeeded` as sufficient for tiled resource-library save when `final_image_ref` is still empty.
- Bad: returning MinIO/S3 public URLs to frontend canvas code.
- Bad: deleting arbitrary storage prefixes from user/API payloads.

### 6. Tests Required

- Strategy tests:
  - Direct default/custom prompt passthrough.
  - Tiled scale `2/3/4`, 8K-size grid derivation, progress callback, and custom `quality_prompt` inclusion.
- Job tests:
  - Direct lifecycle and resource-library save.
  - Tiled final above provider max dimension, pending/ready final status, final upload idempotency, and save-to-library.
  - Capacity requeue.
  - Cross-session cancellation before tile calls and after strategy return, without object delete calls.
  - Input cleanup removes expired unreferenced database snapshots, keeps referenced rows, and leaves stored objects for
    lifecycle cleanup.
- API tests:
  - Same-origin tile/final URLs.
  - Tiled final upload over provider max dimension.
  - Upload request size rejection before service logic.
- Migration tests:
  - Model/migration contract.
  - Upgrade head and downgrade through the enhance migration on SQLite.
- Shared tests:
  - RBAC route contract.
  - Admission running/queued counts and queue positions.
  - Storage delete-prefix hardening.

### 7. Wrong vs Correct

Wrong:

```python
if final_width > settings.image_generation_max_dimension:
    raise BusinessValidationError("目标尺寸过大")
```

Correct:

```python
if tile_base_size > settings.image_generation_max_dimension:
    raise BusinessValidationError("单块尺寸不能超过生图最大单边")
_validate_final_resource_bounds(width=final_width, height=final_height, byte_count=0)
```

Wrong:

```python
result = _run_strategy(job, ctx)
_mark_enhance_job_succeeded(session, job_id=job.id, result=result)
```

Correct:

```python
result = _run_strategy(job, ctx)
if _job_cancelled(session, job.id):
    raise EnhanceCancelledError("图片增强已取消")
_mark_enhance_job_succeeded(session, job_id=job.id, result=result)
```
