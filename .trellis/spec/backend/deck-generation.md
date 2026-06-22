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
