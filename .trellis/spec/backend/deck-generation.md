# Backend Deck (PPT) Generation Guidelines

> Executable contracts for the「PPT/演示文稿生成」vertical. Decks live under an inspiration and reuse the
> image/text generation pipeline. Files: `application/decks.py`, `application/deck_generation_core.py`,
> `infrastructure/deck/{styles,pptx_assembler}.py`, `presentation/routes/decks.py`,
> `presentation/schemas/decks.py`, `infrastructure/db/models.py` (`Deck`/`DeckSlide`).

## Scenario: Deck generation pipeline

### 1. Scope / Trigger
- Trigger: changing deck creation/outline/style/generation/export, deck DB schema, deck RBAC, deck runtime
  config, or the image-capacity accounting that deck slides participate in.
- Cross-layer + DB + infra: `decks`/`deck_slides` tables, Dramatiq actor, generation resource-group +
  capacity pool, provider claim/release, storage, RBAC, runtime config, and the inspiration-detail tab.

### 2. Signatures
- DB tables (no DB FK constraints; `enum_value_column`/`new_id`/`TimestampMixin` per database-guidelines):
  - `decks`: `id, inspiration_id, resource_group_id (NOT NULL, default group), title, status (DeckStatus),
    source_input, outline_json, style_key, style_reference_asset_id, speaker_notes_enabled, last_error,
    pptx_storage_{path,backend,bucket,object_key}, pptx_generated_at, created_at, updated_at`. Index
    `ix_decks_inspiration_id`. Relationship `slides` ordered by `order_index`, cascade all,delete-orphan.
  - `deck_slides`: `id, deck_id, order_index, title, points_json, speaker_notes, slide_status
    (DeckSlideStatus), attempts, last_error, image_storage_{path,backend,bucket,object_key},
    image_mime_type, image_width, image_height, material_source (DeckMaterialSource|null),
    material_storage_{path,backend,bucket,object_key}, material_mime_type`. Index `ix_deck_slides_deck_id`.
  - Enums: `DeckStatus = draft|outline_confirmed|style_confirmed|generating|completed|failed`;
    `DeckSlideStatus = pending|queued|running|completed|failed`;
    `DeckMaterialSource = resource_library|upload|source_asset|enhanced`.
  - Migration `alembic/versions/20260619_0063_add_decks.py` (enum cols as `sa.String(length=max-member-len)`).
- Worker / core:
  - actor `workers.run_deck_slide_generation_task(slide_id)` (`max_retries=0`) →
    `deck_generation_core.execute_deck_slide_generation_task(slide_id)`.
  - `deck_generation_core.enhance_deck_slide_material(session, *, slide_id, prompt)` (R8, synchronous).
  - `queue.enqueue_deck_slide_generation_task(slide_id)` / `_later(slide_id, delay_ms)` /
    `recover_unfinished_deck_slides(reset_stale_running=...)` (wired into worker startup recovery).
  - `infrastructure/deck/styles.py::{list_deck_styles, is_valid_deck_style, build_slide_image_prompt,
    DEFAULT_DECK_STYLE_KEY}`; `pptx_assembler.build_deck_pptx(list[(image_bytes, notes|None)]) -> bytes`.
  - `storage.save_deck_slide_image/save_deck_slide_material/save_deck_pptx`.
- Text provider: `TextProvider.generate_outline(DeckOutlineInput)->(DeckOutlinePayload,model)` and
  `generate_speaker_notes(SpeakerNotesInput)->(SpeakerNotesPayload,model)` (abstract → implemented in mock +
  both OpenAI providers; schemas `DECK_OUTLINE_SCHEMA`/`SPEAKER_NOTES_SCHEMA`).
- API (prefix `/api`, all gated by `require_api_permission`):
  - `POST /inspirations/{id}/decks` [deck:generate], `GET /inspirations/{id}/decks` [deck:read],
    `GET /decks/{id}` [deck:read], `PATCH /decks/{id}` [deck:write], `DELETE /decks/{id}` [deck:write],
    `PUT /decks/{id}/outline` [deck:write], `POST /decks/{id}/style` [deck:write],
    `POST /decks/{id}/sample` [deck:generate], `POST /decks/{id}/generate` [deck:generate],
    `POST /decks/{id}/export` [deck:write], `GET /decks/{id}/pptx` [deck:read],
    `PUT /deck-slides/{id}` [deck:write], `POST /deck-slides/{id}/regenerate` [deck:generate],
    `PUT /deck-slides/{id}/material` [deck:write], `POST /deck-slides/{id}/material/upload` [deck:write],
    `POST /deck-slides/{id}/material/enhance` [deck:generate],
    `POST /deck-slides/{id}/speaker-notes` [deck:generate],
    `GET /deck-slides/{id}/image` [deck:read], `GET /deck-slides/{id}/material` [deck:read],
    `GET /deck-styles` [deck:read].

### 3. Contracts
- RBAC: `API_DECK_READ/WRITE/GENERATE` defined in `domain/rbac.py` under `MENU_INSPIRATIONS`. Every deck
  route MUST carry a `require_api_permission` dependency (enforced by `test_route_rbac_contract.py`).
- Generation resource group (database-guidelines contract): deck creation MUST authorize the group via
  `require_generation_resource_group_for_user(...)` and persist `Deck.resource_group_id`. All deck image/text
  generation claims config with `claim_runtime_generation_config(purpose=..., selection=
  GenerationConfigSelection(resource_group_id=deck.resource_group_id))`. Never bypass group authorization with
  a raw `generation_config_id`.
- Capacity pool: RUNNING `deck_slides` MUST be counted in `admission._running_image_generation_task_count`
  so decks respect the global image concurrency cap shared with image-sessions and workflow image nodes.
- Single-slide lifecycle (per `DeckSlide`, NO separate task table): pending → (capacity gate) atomic
  QUEUED→RUNNING → completed/failed. `_mark_slide_running` checks `generation_running_capacity_available
  (session, pool="image")` BEFORE the atomic UPDATE; on no capacity it requeues via `_later` without
  incrementing attempts. The provider claim MUST be released on BOTH success and failure paths.
- Slide image generation reuses `ImageChatService(generation_config_id=...).generate(prompt, size, history=[],
  manual_reference_images=[...])` — NOT `generate_poster_image`. Size = `get_runtime_settings().deck_slide_size`.
  Prompt built by `build_slide_image_prompt(...)` which constrains text amount (精炼标题+≤4 要点) to mitigate
  AI mis-rendering of Chinese text.
- R8 material enhance: `enhance_deck_slide_material` runs image-to-image with the slide's current material as
  the base reference + prompt, saves the result as the new material with `material_source=enhanced`; the
  enhanced image then participates in subsequent slide generation.
- Deck status recompute (after each slide terminal): all completed → completed; any pending/queued/running →
  generating; otherwise (≥1 failed, none active) → failed.
- pptx export: assemble 16:9 full-bleed image per slide; write `speaker_notes` to the notes slide when
  `deck.speaker_notes_enabled`. Store via `save_deck_pptx`, set `pptx_*` + `pptx_generated_at`. Re-export
  rebuilds. `GET /decks/{id}/pptx` serves it with the presentationml media type.
- Runtime config (Settings default + CONFIG_DEFINITIONS, auto in RUNTIME_CONFIG_KEYS, category
  「PPT/演示文稿生成」): `deck_max_slides (1..50, default 20)`, `deck_default_style (select)`,
  `deck_slide_size (select, default 2048x1152)`.
- Slide image/material served by dedicated routes (`/deck-slides/{id}/image|material`) because slides store
  `image_storage_*`/`material_storage_*` (prefixed), not the generic `storage_*` that `build_stored_image_urls`
  reads. Response `image_url`/`material_url` are null until present.
- Save-to-library: a deck slide goes to the personal resource library via `ResourceLibrarySourceType.DECK_SLIDE`
  (Open-Closed extension of `_load_source_image`, reusing the slide's stored image through a storage shim that
  exposes `storage_path`/`storage_object_key`). The slide is NOT put into the global image gallery, which stays
  scoped to image-session assets per `database-guidelines`. `POST /deck-slides/{id}/resource-library`
  [deck:write] resolves/creates the actor's default group and saves; missing slide image → 400.

### 4. Validation & Error Matrix
- Missing deck/slide → `NotFoundError` (404). Missing inspiration on create → 404.
- Missing/disabled/unauthorized resource group on create → `BusinessValidationError`/auth error (400/403).
- Outline edit with empty slides or empty slide title → 400.
- Export with no generated slide image → 400 `演示文稿还没有已生成的幻灯片可导出`.
- `GET /decks/{id}/pptx` before export → 404 `演示文稿尚未导出`.
- Enhance when slide has no material → 400 `当前幻灯片没有可增强的配图`.
- No image-config capacity at slide run time → slide stays QUEUED and is re-enqueued (NOT a failure).
- `max_slides` clamped to `[1, min(deck_max_slides, 50)]`.

### 5. Good/Base/Bad Cases
- Good: create deck with only inspiration material (no source_input) → outline → pick built-in style →
  generate → all slides completed with images → export → downloadable .pptx with notes.
- Base: local/mock providers render a real PNG at `deck_slide_size`; mock outline derives slides from
  source_input/material signals and respects `max_slides`.
- Bad: counting deck concurrency only by image-session tasks (deck slides overshoot the global image cap).
- Bad: claiming with a raw `generation_config_id` and skipping resource-group authorization.
- Bad: failing to release the provider claim on the slide-generation failure path (leaks concurrency).

### 6. Tests Required
- `tests/test_deck_generation.py`: `execute_deck_slide_generation_task` reaches COMPLETED with
  `image_storage_path` + dims and deck → completed; `enhance_deck_slide_material` sets `material_source=enhanced`.
- `tests/test_decks_api.py`: create→(mock outline→slides)→generate (monkeypatch `enqueue_deck_slide_generation_task`
  to run inline)→GET detail all completed with `image_url`→image downloadable→export→`pptx_url`→download (PK
  header); outline edit sets `outline_confirmed`; rename.
- `test_route_rbac_contract.py` must stay green (every deck route gated).

### 7. Wrong vs Correct
Wrong:
```python
# deck slide concurrency invisible to the global image pool
return _running_workflow_node_count(...) + image_session_running
```
Correct:
```python
running_deck_slides = session.scalar(
    select(func.count()).select_from(DeckSlide).where(DeckSlide.slide_status == DeckSlideStatus.RUNNING)
)
return _running_workflow_node_count(...) + image_session_running + int(running_deck_slides or 0)
```

Wrong:
```python
claim = claim_runtime_generation_config(purpose="image")  # no resource group → bypasses group auth
```
Correct:
```python
claim = claim_runtime_generation_config(
    purpose="image",
    selection=GenerationConfigSelection(resource_group_id=deck.resource_group_id),
)
```

## Project gotcha (current working tree)

> **Warning**: `tests/test_auth_settings_runtime_config.py` currently fails to COLLECT because it imports
> `ProviderBinding`, which an in-progress provider-config refactor removed from `infrastructure/db/models.py`.
> Until that refactor lands, run the backend suite with
> `uv run --directory backend pytest -q --ignore=tests/test_auth_settings_runtime_config.py`. This is unrelated
> to deck generation.

## Scenario: DAG deck node and frontend PPTX export

### 1. Scope / Trigger
- Trigger: any change to `deck_generation` workflow nodes, node-scoped deck APIs, deck/workflow cross-link fields,
  deck source manifests, poster->source-asset materialization, legacy deck mutation guards, or the contract split
  between browser export and legacy backend `.pptx` files.
- Cross-layer + DB + API: `workflow_nodes`, `decks`, `deck_slides`, workflow edge validation, deck serializers,
  deck source preview/generation endpoints, and frontend export behavior.

### 2. Signatures
- Workflow node type:
  - `WorkflowNodeType.DECK_GENERATION = "deck_generation"`.
- DB columns and migration:
  - `decks.workflow_node_id: str | null` with index `ix_decks_workflow_node_id` and **no FK**
  - `decks.source_manifest_json: JSON | null`
  - `deck_slides.source_manifest_json: JSON | null`
  - migration: `backend/alembic/versions/20260625_0065_add_deck_workflow_source_tracking.py`
- Node-scoped APIs:
  - `GET /api/inspirations/{id}/workflow/nodes/{node_id}/deck/sources`
  - `POST /api/inspirations/{id}/workflow/nodes/{node_id}/deck/refresh-sources`
  - `PATCH /api/inspirations/{id}/workflow/nodes/{node_id}/deck`
  - `POST /api/inspirations/{id}/workflow/nodes/{node_id}/deck/outline`
  - `POST /api/inspirations/{id}/workflow/nodes/{node_id}/deck/style`
  - `POST /api/inspirations/{id}/workflow/nodes/{node_id}/deck/sample`
  - `POST /api/inspirations/{id}/workflow/nodes/{node_id}/deck/generate`
  - `PUT /api/inspirations/{id}/workflow/nodes/{node_id}/deck/slide-order`
  - `PUT /api/inspirations/{id}/workflow/nodes/{node_id}/deck/slides/{slide_id}`
  - `POST /api/inspirations/{id}/workflow/nodes/{node_id}/deck/slides/{slide_id}/regenerate`
  - `POST /api/inspirations/{id}/workflow/nodes/{node_id}/deck/slides/{slide_id}/speaker-notes`
  - `PUT /api/inspirations/{id}/workflow/nodes/{node_id}/deck/slides/{slide_id}/material`
- Source-manifest builder module:
  - `application/inspiration_workflow/deck_sources.py`
  - read-only helper: `lookup_source_asset_for_poster_variant(...)`
  - write helper: `materialize_poster_variant_source_asset(...)`
- Response fields added to deck serializers:
  - `workflow_node_id`
  - `workflow_node_exists`
  - `workflow_node_title | null`
  - `generated_slide_count`
  - `source_manifest_json | null`
- Source manifest identity contract:
  - `available_sources[].source_item_id`
  - `unavailable_sources[].source_item_id`
  - `slide_bindings[*].source_item_id`
  - slide-level `source_manifest_json`

### 3. Contracts
- `deck_generation` is a valid DAG node type but **never** a runnable workflow execution node. Full run, run-from-node,
  run-after-node, retry, scheduler-ready selection, capacity accounting, and `_execute_node` must all exclude or reject it.
- `deck_generation` is target-only in the graph. Backend edge creation must reject it as `source_node_id`; frontend
  connection validation must mirror that guard for UX.
- Deck history remains soft-linked. `decks.workflow_node_id` is a nullable string with no FK so deleting the source
  workflow node must not cascade-delete deck history.
- A DAG deck is "active" only when `deck.workflow_node_id != null` and the referenced workflow node still exists. Generic
  mutating deck endpoints must reject active DAG decks with a paint-the-fence message such as `请在画布演示节点中编辑`.
  Read-only deck detail, slide image download, and legacy `GET /decks/{id}/pptx` stay allowed.
- `GET .../deck/sources` is pure read:
  - no `SourceAsset` creation
  - no `SourceAsset.source_poster_variant_id` backfill
  - no `WorkflowNode.config_json` / `output_json` mutation
  - no `Deck` / `DeckSlide` mutation
  - no ORM flush caused by poster/source lookup side effects
- Poster materialization is write-only. `materialize_poster_variant_source_asset(...)` may backfill or create
  `SourceAsset(kind=REFERENCE_IMAGE, source_poster_variant_id=poster.id)` only inside refresh/generate/bind write paths,
  and must not mutate reference/image workflow nodes as a side effect.
- `source_item_id` is item-scoped, not node-scoped. One `image_generation` node with multiple posters must expose multiple
  distinct bindable source items; all outline refs, `slide_bindings`, and slide source manifests must use `source_item_id`.
- `source_fingerprint` must include sorted `source_item_id` plus backing copy/source-asset/poster/tail identifiers. A node-id-only
  hash is insufficient because one node can expose many independently bindable items.
- Node-scoped slide material binding uses `source_item_id`. Backend resolves the current source item from the current
  manifest, materializes poster assets if needed, calls existing source-asset binding logic, persists
  `deck_slides.source_manifest_json`, and mirrors the binding into `WorkflowNode.config_json.slide_bindings`.
- DAG deck resource-group handling stays deck-scoped rather than workflow-run-scoped. `deck_generation` must not be added
  to generic workflow resource-group required-node allowlists; node-scoped deck actions validate or resolve the deck's
  `resource_group_id` through existing deck generation permissions.
- Browser export is the primary path for current decks. Frontend builds PPTX from generated slide images with `pptxgenjs`;
  backend export persists only legacy `.pptx` files for old flows and old downloads.
- Legacy `POST /decks/{id}/export` remains a compatibility path for non-DAG decks. Active DAG decks must be blocked from
  writing `pptx_storage_*`, while previously persisted legacy files remain downloadable from `GET /decks/{id}/pptx`.

### 4. Validation & Error Matrix
- Running or scheduling `deck_generation` through normal workflow execution -> non-retryable validation failure.
- Creating an edge with `deck_generation` as source -> `BusinessValidationError` from the workflow edge mutation.
- Generic deck mutation against an active DAG deck -> reject with the node-editor message; do not partially mutate deck rows.
- Binding a stale/unknown/non-current `source_item_id` -> `BusinessValidationError`; do not fall back to node-level binding.
- `GET .../deck/sources` on a poster-only source with no paired `SourceAsset` -> preview may show poster-backed item, but
  must not materialize storage or backfill relationships.
- Deck history with `workflow_node_id != null` and missing source node -> `workflow_node_exists=false`, keep history visible,
  and disable canvas locate actions.
- Legacy deck with `workflow_node_id == null` -> must not be mislabeled as deleted-source DAG history.

### 5. Good/Base/Bad Cases
- Good: a deck node previews multiple generated posters from one image node as separate `source_item_id` values, and two
  slides bind different posters from that same upstream node.
- Good: `GET .../deck/sources` returns a manifest preview for poster-backed sources without creating any `SourceAsset`.
- Good: a deleted deck workflow node leaves the deck history readable, exportable from generated slide images, and marked
  with `workflow_node_exists=false`.
- Base: a legacy non-DAG deck can still use backend-exported `.pptx` downloads if a historical file already exists.
- Bad: using `source_asset_for_poster_variant(...)` inside the read-only source preview path, causing hidden writes/flushes.
- Bad: allowing old `PUT /deck-slides/{id}/material` to mutate an active DAG deck outside node context.
- Bad: treating `workflow_node_id=null` legacy decks as "来源节点已删除".

### 6. Tests Required
- Backend manifest tests must cover item-scoped `source_item_id`, fingerprint changes, unavailable reasons, and
  read-only poster lookup with no writes.
- Backend route tests must cover node-scoped deck actions, node-scoped slide binding by `source_item_id`, and generic
  endpoint guard behavior for active DAG decks.
- Backend workflow tests must prove `deck_generation` is excluded from full-run, run-after, retry, scheduler-ready, and
  `_execute_node` execution paths.
- Backend serializer tests must cover `workflow_node_id`, `workflow_node_exists`, `generated_slide_count`, and
  `source_manifest_json` for DAG and legacy decks.
- Frontend tests must cover browser PPTX helper behavior, DAG deck card/history export gating, and node-scoped binding
  instead of legacy generic material APIs.

### 7. Wrong vs Correct
Wrong:
```python
manifest = build_manifest(...)
asset = source_asset_for_poster_variant(session, workflow=workflow, poster_variant_id=poster_id)
```

This makes a supposedly read-only source preview path create or backfill `SourceAsset` records.

Correct:
```python
manifest = build_manifest(...)
asset = lookup_source_asset_for_poster_variant(session, workflow=workflow, poster_variant_id=poster_id)
```

Use the read-only lookup for previews, and reserve materialization for explicit write paths.

Wrong:
```python
set_deck_slide_material_from_source(session, slide=slide, source_type="source_asset", source_id=payload.node_id)
```

This loses item identity and cannot distinguish multiple posters from one image node.

Correct:
```python
source_item = require_manifest_source_item(manifest, payload.source_item_id)
asset = materialize_source_item_asset(session, workflow=workflow, source_item=source_item)
set_deck_slide_material_from_source(session, slide=slide, source_type="source_asset", source_id=asset.id)
```

Resolve the current manifest item first, then bind the concrete asset produced by that item.
