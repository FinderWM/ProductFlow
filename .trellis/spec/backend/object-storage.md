# Object Storage Source-of-Truth

## Scenario: Active storage backend, scoped materialization, and controlled delivery

### 1. Scope / Trigger

- Trigger: changing stored-object reads/writes, image variants, download/preview routes, storage environment keys,
  Docker Compose mounts, or release behavior.
- Applies to `infrastructure/storage.py`, `application/storage_variants.py`, `presentation/storage_responses.py`,
  storage-backed application use cases/routes, `docker-compose*.yml`, `scripts/release.sh`, and storage tests.

### 2. Signatures

- Persistent storage facade:
  - `put_bytes(object_key, content, *, content_type) -> StoredObjectRef`
  - `stat(object_key) -> StoredObjectStat`
  - `open_stream(object_key, *, byte_range=None) -> StorageReadStream`
  - `read_bytes(object_key, *, max_bytes) -> bytes`
  - `copy_object(source_object_key, destination_object_key, *, content_type=None) -> StoredObjectRef`
  - `materialize(object_key) -> ContextManager[Path]`
  - `presign_get(object_key, *, expires_in=None, response_filename=None, response_content_type=None) -> str | None`
- Presentation delivery:
  - `stream_storage_object(...) -> Response`
  - `image_storage_object(..., variant="original|preview|thumbnail", trusted_original_media_type=...) -> Response`
  - `download_storage_object(..., allow_presign=True) -> Response`
- Validated image input:
  - `ValidatedUpload(content, original_filename, mime_type, storage_suffix)`
  - trusted mapping: `image/png -> .png`, `image/jpeg -> .jpg`, `image/webp -> .webp`
  - `domain/image_media.py` owns the bidirectional mapping and safe delivery filename helper without I/O dependencies
  - image `save_*()` helpers accept explicit trusted `content_type` and derive suffix internally; user filename never selects
    object Content-Type
  - representative signatures:
    `save_inspiration_upload(inspiration_id, *, content, content_type) -> str`,
    `save_reference_upload(inspiration_id, *, content, content_type) -> str`, and
    `copy_to_resource_library_asset(source_key, owner_id, *, content_type) -> str`; display filenames stay in application/DB
- Environment keys:
  - `STORAGE_BACKEND=local|minio|s3`
  - local only: `STORAGE_ROOT`, Compose-only `STORAGE_HOST_PATH`
  - scoped temporary workspace: optional `STORAGE_TEMP_ROOT`
  - object backend: `S3_ENDPOINT_URL`, optional `S3_PUBLIC_ENDPOINT_URL`, credentials/bucket/region,
    `STORAGE_SIGNED_URL_TTL_SECONDS`
- Compose:
  - local: `docker compose -f docker-compose.yml ...`
  - object mode: `docker compose -f docker-compose.yml -f docker-compose.object-storage.yml ...`

### 3. Contracts

- One process uses one deployment-selected active backend. Database `storage_backend` / `storage_bucket` fields remain
  identity metadata and do not dynamically switch the read backend per row.
- `local` persists objects below `STORAGE_ROOT`. MinIO/S3 is the sole persistent file source in object mode; remote
  initialization and I/O do not read, create, or write `STORAGE_ROOT`, and a same-named local file is never a fallback.
- Business/application code uses bounded bytes, streams, or server-side copies. It must not obtain a reusable persistent
  `Path`. `materialize()` is reserved for path-only libraries, is context-managed, and cleans normal/error exits.
- `STORAGE_TEMP_ROOT`, local `STORAGE_ROOT`, and `LOG_DIR` must not be equal or have an ancestor/descendant relationship
  after absolute normalized-path comparison. Object-mode Compose defaults do not replace startup validation.
- Object keys are non-empty relative POSIX keys. Absolute paths, empty segments, `.`, `..`, NUL, and backslashes are invalid;
  valid keys retain their exact spelling.
- Pure ownership copies use backend `copy_object()`. Database commit failure may leave an unreferenced object. Business
  cleanup, cancel, archive, abandon, and soft-delete flows do not physically delete objects; lifecycle policies or a
  separate controlled process own unreferenced-object cleanup.
- DTOs return stable application URLs. Images and interactive previews stay same-origin. Explicit non-image attachments
  may redirect with 307 to a short-lived signed URL after auth; missing public signing configuration falls back to
  same-origin streaming.
- Controlled delivery supports 200/206/416 single-range responses, content length/type/disposition, ETag/Last-Modified,
  `nosniff`, safe UTF-8 filenames, and deterministic stream closure. Storage-not-found keeps each route's existing 404
  detail; storage unavailability returns 503 without endpoint/credential details.
- Image content detected by Pillow is the trusted source for persistent MIME and suffix. The original user filename may be
  retained in database metadata, while object keys and Content-Disposition filenames replace unsafe/mismatched suffixes
  with the detected image suffix. Image endpoints allow only PNG/JPEG/WebP and never return inline HTML, SVG, JavaScript,
  or another executable media type from object metadata or a user filename.
- `StorageReadStream.iter_chunks()` closes on normal exhaustion and iteration error; callers close again in `finally` for
  early termination. S3 `open_stream()` reuses known stat or builds it from GET metadata and must not issue an equivalent
  duplicate HEAD after a response adapter already selected the object.
- Image variants are derived objects in the active backend. Writes schedule best-effort background generation. Reads prefer
  canonical WebP, then legacy JPG. Missing variants schedule work, return the original, and set
  `Cache-Control: no-store` plus `X-Image-Variant: pending`.
- Ready variants derive media type from controlled suffix (`.webp`/`.jpg`) when remote metadata is absent/octet-stream.
  Variant workers verify Redis lock token ownership immediately before every derived-object write; expired/lost locks stop
  without writing. Lock identity distinguishes deployment backend/bucket/key and shared-Redis object-store endpoints.
- Base Compose keeps local storage and independent log volumes. Object override removes `/app/storage` from API/worker,
  keeps `/app/logs`, and sets non-persistent `/tmp/inspiration-one-storage` as `STORAGE_TEMP_ROOT`.
- `backend/backend/storage-dev` is outside the architecture and has no audit, migration, repair, fallback, or recovery path.

### 4. Validation & Error Matrix

- Invalid object key -> `InvalidStorageObjectKey`; user-controlled key boundaries map to 400, stored download metadata maps
  to the route's non-leaking 404.
- Missing local or remote object -> `StorageObjectNotFound`; controlled route preserves its resource-specific 404 detail.
- Credentials, connection, timeout, filesystem I/O, or remote 5xx -> `StorageUnavailable`; route returns 503.
- `stat.content_length > max_bytes` or streamed bytes exceed the bound -> `StorageObjectTooLarge`.
- Unsatisfiable, malformed, or multi-part Range -> 416 with `Content-Range: bytes */<total>`.
- Variant object missing -> original 200/206 response with pending/no-store headers; original missing -> route-specific 404.
- Valid image with a mismatched/dangerous filename suffix -> accept content, persist with detected safe image suffix/MIME,
  retain original filename only as non-executable metadata, and deliver with a safe image filename suffix.
- Image delivery metadata resolves to HTML/SVG/JavaScript/unknown type -> use trusted original/variant image mapping; if no
  trusted image type exists, return the route-specific non-leaking 404 instead of inline content.
- Stored metadata/manifest has an invalid object key -> route-specific 404 after auth; invalid key must be caught inside the
  same storage boundary as response construction. Storage unavailable -> 503.
- `STORAGE_TEMP_ROOT` overlaps `STORAGE_ROOT` or `LOG_DIR` -> startup validation failure.
- Variant lock ownership is lost before write -> stop successfully/retryably according to actor policy with zero object writes.
- `STORAGE_BACKEND` outside `local|minio|s3` -> startup/release validation failure.
- Object-mode rendered Compose contains `/app/storage` mount, lacks two `/app/logs` mounts, or lacks separate log dirs ->
  release validation failure.

### 5. Good/Base/Bad Cases

- Good: API writes an image to MinIO, worker reads the same key without a shared filesystem, and the first thumbnail request
  returns the original with pending headers until the worker writes the WebP variant.
- Good: a private-bucket PPTX download redirects to a five-minute signed URL; a deployment without a public signing endpoint
  streams the same attachment through the API.
- Good: `photo.html` containing a valid PNG is stored under a generated `.png` object key, returned as `image/png`, and uses
  a `.png` Content-Disposition filename; trailing HTML bytes never receive an executable response type.
- Good: a legacy `.preview.webp` object with octet-stream metadata is returned as `image/webp`.
- Base: local self-hosting returns a `FileResponse` from the persistent local object path while preserving the same API URL.
- Bad: reintroducing `resolve()` that downloads a remote object into a reusable directory or checks local existence first.
- Bad: returning public bucket URLs for images used by authenticated fetch/Canvas flows.
- Bad: deleting an object inside a cancel/archive/database-rollback path.
- Bad: guessing an image object's Content-Type from a user filename or trusting S3 `text/html` metadata at an image route.
- Bad: continuing `put_bytes()` after the Redis lock token expired, or issuing another HEAD after selected stat is available.

### 6. Tests Required

- Storage backend tests assert remote init/put/stat/get/range/copy/materialize never create or change `STORAGE_ROOT`, local
  and S3 map failures consistently, streams close on success/error/early close, bounded reads enforce both checks, and S3
  selected-stat delivery performs no duplicate HEAD.
- Copy tests assert S3 calls `copy_object` without `get_object` or `put_object` and local creates an independent target key.
- Variant tests assert async scheduling, enqueue failure isolation, WebP/JPG lookup, distributed-lock idempotency, pending
  fallback headers, octet-stream WebP/JPG media inference, lock-expiry zero-write behavior, and later derived-object delivery.
- Response tests assert 200/206/416, filename sanitization/UTF-8 disposition, local file delivery, remote streaming closure,
  signed 307 headers, signing fallback, and executable image MIME rejection.
- Upload tests parameterize real PNG/JPEG/WebP content with `.html`, `.svg`, `.js`, wrong image suffix, no suffix, and valid
  image bytes followed by `<script>`; assert safe object suffix, object Content-Type, response Content-Type, and delivery filename.
- Route tests retain auth/RBAC/owner/moderation gates, invalid stored-key 404, StorageUnavailable 503, and resource-specific
  details before storage delivery.
- Deployment gates: both Compose configs render; object mode has no `/app/storage`, two `/app/logs` mounts, separate
  `LOG_DIR`s, and non-persistent `STORAGE_TEMP_ROOT`; local and object release dry-runs print the selected file set.
- Run backend Ruff/tests, frontend build, Compose validation, release dry-run, and real MinIO put/head/get/range/copy/
  private-download/API-worker integration before completing a storage architecture task.

### 7. Wrong vs Correct

#### Wrong: local-path read

```python
path = storage.resolve(stored.storage_object_key)
content = path.read_bytes()
return FileResponse(path)
```

#### Correct: bounded storage response

```python
content = storage.read_bytes(stored.storage_object_key, max_bytes=IMAGE_INPUT_MAX_BYTES)
return image_storage_object(
    storage,
    stored.storage_object_key,
    variant="preview",
    range_header=request.headers.get("range"),
)
```

#### Wrong: filename-derived image MIME

```python
object_key = storage.save_inspiration_upload(inspiration_id, upload.filename, upload.content)
media_type = storage.stat(object_key).content_type  # user `photo.html` becomes text/html
```

#### Correct: detected image MIME

```python
validated = await read_validated_image_upload(upload, fallback_filename="upload.png")
object_key = storage.save_inspiration_upload(
    inspiration_id,
    content=validated.content,
    content_type=validated.mime_type,
)
return image_storage_object(
    storage,
    object_key,
    trusted_original_media_type=validated.mime_type,
    filename=safe_image_delivery_filename(validated.original_filename, validated.storage_suffix),
)
```

#### Wrong: object-mode storage volume

```yaml
volumes:
  - inspiration-one-storage:/app/storage  # object-storage API/worker
```

#### Correct: isolated object-mode volumes

```yaml
volumes: !override
  - inspiration-one-logs:/app/logs
environment:
  STORAGE_TEMP_ROOT: /tmp/inspiration-one-storage
```
