# Inspiration One Architecture

[中文](ARCHITECTURE.md) | English

Current architecture health, completed cleanup, and remaining risks are tracked in `docs/ARCHITECTURE_HEALTH_REVIEW.en.md`; this document stays focused on system structure.

## 1. System Overview

Inspiration One consists of the frontend, backend API, background worker, PostgreSQL, Redis, and one active storage backend:

```text
React/Vite web
  -> FastAPI backend
    -> PostgreSQL metadata
    -> Redis/Dramatiq queue
    -> local filesystem or MinIO/S3 object storage
    -> text provider / image provider
  -> Dramatiq worker
    -> same database, queue, storage and providers
```

The default self-hosted path is driven by the root `docker-compose.yml`. `docker compose up -d --build` builds and starts the FastAPI backend, Dramatiq worker, and nginx-served Web static site. API/worker containers read `DATABASE_URL` / `REDIS_URL` from `.env` and connect to the shared `libowpg` and `libowredis` middleware maintained under `/Users/yunlong/project/self/env`. Local storage mode mounts persistent `/app/storage`, backed by `inspiration-one-storage` when `STORAGE_HOST_PATH` is not set. MinIO/S3 mode adds `docker-compose.object-storage.yml`, removes API/worker business-storage mounts, and sets non-persistent `STORAGE_TEMP_ROOT=/tmp/inspiration-one-storage`. Logs use the independent `inspiration-one-logs` volume with separate API and worker directories. The backend container runs Alembic migrations before starting `uvicorn`.

The production update entrypoint is `just release`. `scripts/release.sh` reads `STORAGE_BACKEND` from `.env`, selects either the base Compose file or the base plus object-storage override, and verifies that object mode has no `/app/storage` mount. It then stops legacy user-level systemd services, rebuilds the stack, and performs HTTP health checks. `just release-dry-run` validates the same file set and prints the exact commands without stopping services, building, or starting containers. Normal updates do not delete Docker volumes.

Local hot-reload development is still driven by the root `justfile`: after `libowpg`, `libowredis`, and `libowminio` are running, run the API, worker, and frontend with `just backend-run`, `just backend-worker`, and `just web-dev`. Development object mode uses `STORAGE_BACKEND=minio`, while the wrapper loads `S3_*` values from `/Users/yunlong/project/self/env/minio.env`. MinIO is the sole persistent file source; temporary materialization uses the operating-system temp directory by default. Do not start local development processes by shell-sourcing production `.env`.

## 2. Backend Layering

Backend code lives under `backend/src/inspiration_one_backend/` and is organized by layer:

- `presentation/`: FastAPI app, routes, auth dependencies, Pydantic schemas, and upload validation.
- `application/`: use-case logic for inspirations, copy, posters, gallery, image sessions, and inspiration workflows. Inspiration workflow logic is split into graph / mutations / query / execution / context / artifacts / dependencies modules, with `inspiration_workflows.py` kept as the compatibility facade.
- `domain/`: stable enums such as task status, asset type, and workflow node type.
- `infrastructure/`: SQLAlchemy models/session, queue, storage, text/image providers, and poster renderer.
- `workers.py`: Dramatiq actor entrypoint.
- `config.py`: environment configuration, runtime configuration definitions, and database override reading.

The route layer only handles input adaptation, authentication, error mapping, and serialization. Provider calls, job state changes, and workflow progression stay inside application/infrastructure boundaries.

## 3. Frontend Structure

Frontend code lives under `web/src/`:

- `pages/`: login, inspiration list, inspiration creation, inspiration detail, gallery, help, settings, and image-session pages (current routes include `/image-chat`, `/inspirations/:inspirationId/image-chat`, `/gallery`, `/help`, and `/settings`).
- `components/`: shared UI such as the top navigation, status tags, and image drag-and-drop upload area.
- `lib/api.ts`: centralized REST API request wrapper.
- `lib/types.ts`: frontend DTO types that must stay aligned with backend schemas.

The frontend uses TanStack Query for server state. The inspiration detail page and iterative image page use lightweight status polling while work is active:

- Iterative image generation polls `['image-session-status', selectedSessionId]`, merges task state only, then refreshes the full session after completion.
- Inspiration workflows poll `['inspiration-workflow-status', inspirationId]`, merge node/run state only, then refresh full workflow and inspiration artifact queries after completion.

Do not reintroduce active polling for complete `ImageSessionDetailResponse` or complete `InspirationWorkflowResponse`; those payloads include image history, node configuration, artifact references, and run records, and high-frequency refresh increases frontend render cost and backend serialization work.

The inspiration detail page is currently the Inspiration One workbench: the canvas handles nodes, edges, zoom, pan, node dragging, box selection, and multi-select. On desktop, the right sidebar handles Details, Runs, Library, and Templates. On mobile, a bottom toolbar carries the workflow run entrypoint plus Single node, Templates, Details, Runs, and Library entrypoints, and a bottom sheet renders those panel contents. The mobile canvas has local `browse` / `edit` / `select` interaction modes: `browse` handles one-finger pan, node tap selection, and two-finger pinch zoom; `edit` allows touch/pen node dragging and edge creation; `select` toggles multi-select by tapping nodes. Canvas zoom ratio and desktop sidebar width are browser-local preferences, while mobile mode and sheet openness are page-local UI state. Workflow nodes, edges, run state, and artifacts remain database-backed.

## 4. Main Data Model Lines

Traditional inspiration creative chain:

```text
Inspiration
  -> SourceAsset(original/reference/processed)
  -> CreativeBrief
  -> CopySet(draft/confirmed)
  -> PosterVariant(main_image/promo_poster)
```

Iterative image-generation chain:

```text
ImageSession
  -> ImageSessionAsset(reference_upload/generated_image)
  -> ImageSessionRound(one generated candidate per row)
  -> ImageSessionGenerationTask(durable async generation task)
  -> optional Inspiration attachment
  -> optional ImageGalleryEntry
```

Inspiration DAG workflow chain:

```text
InspirationWorkflow
  -> WorkflowNode(inspiration_context/reference_image/copy_generation/image_generation)
  -> WorkflowEdge
  -> WorkflowRun
  -> WorkflowNodeRun
```

Canvas template chain:

```text
CanvasTemplate(builtin full_canvas)
  -> inspiration creation or workflow template insertion

UserCanvasTemplate(node_group)
  -> reusable selected workflow nodes and internal edges
```

PostgreSQL is the source of truth for metadata and run state. Redis/Dramatiq is only responsible for dispatching background execution messages.

Workflow node semantics for users:

- `inspiration_context`: inspiration information entrypoint for one inspiration workflow.
- `reference_image`: a single current reference image slot; manual upload or upstream image generation replaces the current image, while old assets remain in inspiration history/assets.
- `copy_generation`: copy generation and editable structured copy. Later image generation reads structured copy context directly.
- `image_generation`: image-generation trigger/configuration node; image artifacts are written into downstream reference image nodes instead of being displayed on the image-generation node itself.

Canvas template boundaries:

- Built-in `full_canvas` scenario templates can initialize a complete workflow during inspiration creation and can also be
  inserted into an existing inspiration workbench.
- When a built-in scenario template is inserted into an existing workbench, the template `inspiration_context` node is mapped
  to the active workflow's existing inspiration node instead of creating a second inspiration node.
- User node-group templates are saved from selected nodes and persist only reusable configuration plus internal edges between selected nodes; they do not store inspiration details, generated images, or copy outputs.

## 5. Async Jobs and Recovery

There are currently two background execution entrypoints:

1. `WorkflowRun`: used for inspiration DAG workflow execution.
2. `ImageSessionGenerationTask`: used for iterative image generation.

Shared principles:

- Database records are persisted first; Redis messages are only recoverable dispatch attempts.
- Database constraints prevent duplicate active workflow runs for the same inspiration.
- If enqueue fails, the newly created run/task is marked failed to avoid stuck active state.
- API startup recovers queued unfinished tasks/workflows.
- Worker startup can reset stale running state and re-dispatch work.
- Workflow runs and iterative image-generation tasks serialize `is_retryable` / `is_cancelable`, and the frontend uses those flags to show retry and cancel actions.
- Image-generation failures are classified into user-readable categories covering provider quota/rate limit, content policy, network interruption, request timeout, provider service errors, and unsupported parameters.
- Iterative image generation no longer treats a user-configurable hard total timeout as inspiration semantics. Running tasks persist `progress_updated_at`, completed candidate count, current candidate, and provider response state; stale-running recovery uses the latest progress heartbeat for idle detection and only falls back to `started_at` for older rows.
- The iterative image worker's Dramatiq `time_limit` remains only as an internal failsafe, not as a user-tunable generation deadline.
- Dramatiq actors should no-op on duplicate messages for terminal/currently-running records.
- Worker deployment is one Dramatiq process per container with multiple consumer threads. Scale out by adding worker container replicas.
- Business generation concurrency is split between `text_generation_max_concurrent_tasks` and `image_generation_max_concurrent_tasks`. Text workflow nodes consume only the text pool; image workflow nodes and iterative image-generation tasks consume the image pool.
- Both capacity pools serialize worker claims with PostgreSQL advisory transaction locks, so multi-thread and multi-container consumers do not over-claim.
- `/api/generation-queue` returns the global durable queue overview; iterative image status responses include the current task's queue position.

Related entrypoints:

- `inspiration_one_backend.infrastructure.queue.recover_unfinished_workflow_runs`
- `inspiration_one_backend.infrastructure.queue.recover_unfinished_image_session_generation_tasks`
- `inspiration_one_backend.workers`

## 6. Provider Architecture

Inspiration One separates model capabilities by modality.

Text providers live under `infrastructure/text/` with a unified interface:

- `generate_brief(inspiration_input)`
- `generate_copy(inspiration_input, brief, config, reference_images=None)`

Current implementations:

- `mock`
- `openai` (Responses API compatible)

Image providers live under `infrastructure/image/` and serve poster generation and image sessions. Current implementations:

- `mock`
- `openai_responses` (Responses API `image_generation` tool, supporting `input_image`; iterative image generation prefers background response + retrieve polling and writes provider status into task progress)
- `openai_images` (Images API `images.generate` / `images.edit` compatible interface; it does not use Responses `previous_response_id`, and Inspiration One explicitly sends the selected base image plus references for iterative image sessions)
- `google_gemini_image` (Google Gemini native `generateContent` image API through the official `google-genai` SDK; Inspiration One explicitly sends the selected base image plus references for iterative image sessions)

Provider selection is controlled by `provider_profiles`, `provider_bindings`, and corresponding factories. Legacy
`TEXT_*` / `IMAGE_*` environment values are only first-migration input; runtime resolvers read interface kind,
connection data, and models from provider profiles and purpose bindings. Routes do not directly depend on concrete SDKs.

## 7. Poster Generation

Posters have two modes:

- `template`: render with local Pillow templates, suitable for development/testing without image model keys.
- `generated`: package confirmed copy, inspiration images, and reference images as image-provider input and generate the result with a remote model.

Both modes target two artifact types:

- `main_image`: 1:1 ecommerce main image.
- `promo_poster`: 3:4 promotional poster.

## 8. Configuration Layers

Configuration is split into two categories:

1. Env-only infrastructure configuration: `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `ADMIN_ACCESS_KEY`, and similar values. These must be available before the application can access the database, or they are deployment-level access secrets, so runtime DB overrides are not supported.
2. Runtime business configuration: provider, model, image size, upload limits, task retry, text/image generation concurrency limits, poster mode, prompt templates, login-gate switch, business deletion switch, and similar values. They can be provided as defaults by `.env` / `.env.dev`, or written to `app_settings` through `/api/settings` after login with the required RBAC settings permission.

Secret configuration values are not echoed back in API responses.

The login-gate setting `admin_access_required` is retained as runtime configuration. Current access control is account login plus RBAC permissions. Settings reads, settings writes, status reads, resource governance, and RBAC management are bound to their matching backend API permissions.

The business deletion switch `deletion_enabled` is disabled by default. When disabled, the backend rejects whole-inspiration deletion and whole iterative image-session deletion at the route boundary, so demo sites do not lose evidence after problematic content is deleted. Workflow node/edge editing and reference-image deletion are not affected. `DELETE /api/auth/session` and restoring database overrides from the settings page are not part of business deletion protection.

Prompt template overrides cover inspiration understanding, copy generation, workbench image generation, and iterative image generation. Infrastructure configuration and secret reading stay behind backend boundaries; the frontend only displays configuration items, sources, and save state.

## 9. File Storage and Downloads

Files are managed by `StorageService` in `infrastructure/storage.py`; `LocalStorage` remains as a compatibility alias. Each process uses one backend selected by `STORAGE_BACKEND`. Local mode persists objects under `STORAGE_ROOT`. MinIO/S3 mode treats object storage as the sole persistent file source: it does not create, read, or write a reusable server-side business cache and never falls back to a same-named local file. `STORAGE_ROOT` and `STORAGE_HOST_PATH` belong only to local mode.

Normal business reads use bounded byte access or closeable streams. `materialize()` creates a scoped file under `STORAGE_TEMP_ROOT` or the operating-system temp directory only for path-only libraries and cleans it on exit. Pure ownership copies use backend `copy_object()` without API/worker memory transfer. Business cleanup updates database state and relationships without physically deleting objects; lifecycle policies or a separate controlled process own unreferenced-object cleanup.

Image resource tables store object identity fields (`storage_backend`, `storage_bucket`, and `storage_object_key`) rather than full access URLs. Legacy `storage_path` remains a key fallback. API DTOs always return stable application URLs. Images, Enhance tiles, Deck slide images, and image-to-code previews are same-origin backend proxies. Explicit non-image attachments may use short-lived signed URLs from `S3_PUBLIC_ENDPOINT_URL` after authorization; when no public endpoint is configured, delivery falls back to same-origin streaming. Controlled responses support single-range requests, consistent security headers, and deterministic remote-stream closure.

Preview and thumbnail variants are derived objects in the active backend and are generated by idempotent background tasks. A missing variant schedules work and returns the original image with `Cache-Control: no-store` and `X-Image-Variant: pending`. Reads support canonical WebP and legacy JPG keys.

The legacy `backend/backend/storage-dev` directory is outside this architecture. It has no audit, migration, repair, or missing-object recovery path.

User-downloadable files are read through controlled routes, for example:

- `/api/posters/{poster_id}/download`
- `/api/source-assets/{asset_id}/download`
- `/api/image-session-assets/{asset_id}/download`

Do not bypass the storage service by directly concatenating user-controlled paths.

## 10. Security Boundaries

The current security model is "seed admin account plus multi-user RBAC":

- The initial admin username is `libow`; the admin role always has every menu and API permission.
- `ADMIN_ACCESS_KEY` is read only from environment variables and does not enter database configuration. Account login and RBAC permissions decide visible pages and callable APIs.
- Regular users are added to the trusted-user list by an admin before setting a password. Non-admin role menus and API permissions are admin-configurable.
- Session cookies are signed with `SESSION_SECRET`.
- CORS is controlled by `BACKEND_CORS_ORIGINS`.
- Uploaded files have MIME, size, pixel, and count limits.
- Provider API keys are stored in env or database configuration, and APIs do not echo secrets.

Currently not provided: multi-user isolation, object-level permissions, audit logs, or production WAF configuration.
