# Backend Inspiration Workflow DAG Guidelines

> Executable contracts for the ProductFlow-native inspiration workbench DAG.

## Scenario: Canvas template v1 contract

### 1. Scope / Trigger

- Trigger: any change to canvas template models, built-in ecommerce templates, template catalog endpoints, template
  application, user-saved node-group templates, or frontend palette DTOs.
- Canvas templates describe reusable ecommerce production plans. Applying a template must create normal visible
  workflow nodes and edges that can be edited, connected, and executed through the existing inspiration workflow DAG.
- Templates may express downstream iteration by adding later nodes such as `image_generation -> reference_image`; they
  must keep the graph acyclic.

### 2. Signatures

- Backend module: `inspiration_one_backend.application.canvas_templates`.
- Template models:
  - `CanvasTemplate`
  - `CanvasTemplateNodeSpec`
  - `CanvasTemplateEdgeSpec`
  - `CanvasTemplateScenarioMetadata`
  - `CanvasTemplateOutputSlot`
  - `CanvasTemplateReferenceInputHint`
  - `CanvasTemplateSuggestedConnection`
  - `CanvasTemplateDefaultExternalConnection`
  - `CanvasTemplateScenario`
  - `TemplateKind = Literal["full_canvas", "node_group"]`
- Catalog helpers:
  - `list_builtin_canvas_templates() -> list[CanvasTemplate]`
  - `get_builtin_canvas_template(template_key: str) -> CanvasTemplate`
  - `validate_canvas_template(template: CanvasTemplate) -> None`
- Supported node types for templates are explicitly allowlisted:
  `inspiration_context`, `reference_image`, `copy_generation`, `image_generation`.
- Built-in template keys:
  - `ecommerce-main-image-v1`
  - `ecommerce-taobao-main-image-v1`
  - `ecommerce-xiaohongshu-image-v1`
  - `ecommerce-multi-angle-image-v1`
  - `ecommerce-sku-variant-image-v1`
  - `ecommerce-feature-infographic-v1`
  - `ecommerce-size-spec-image-v1`
  - `ecommerce-scale-reference-image-v1`
  - `ecommerce-package-checklist-image-v1`
  - `ecommerce-usage-steps-image-v1`
  - `ecommerce-comparison-image-v1`
  - `ecommerce-model-lifestyle-image-v1`
  - `ecommerce-scene-image-v1`
  - `ecommerce-detail-material-image-v1`
  - `ecommerce-campaign-promotion-image-v1`
  - `ecommerce-short-video-cover-v1`
  - `ecommerce-white-background-image-v1`

### 3. Contracts

- `CanvasTemplate.version` must be `1`.
- `CanvasTemplate.kind` must be `full_canvas` for built-in ecommerce scenario templates. `node_group` remains valid for
  user-saved reusable groups.
- `CanvasTemplate.nodes` is required and every node `key` must be unique within the template.
- Node specs are logical template nodes. Application code that materializes them must translate each node spec into a
  real `workflow_nodes` row and each edge spec into a real `workflow_edges` row.
- Node specs may include `config_json` with default instructions, prompt hints, image size, or tool options. Keep these as
  editable workflow-node config, not separate local UI state.
- Only `image_generation` node specs may declare `size`.
- `output_slots` document which `reference_image` nodes receive generated material and how the UI should label those
  outputs.
- `reference_inputs` document which `reference_image` nodes are expected to receive user/inspiration/style images before
  running downstream nodes.
- `suggested_connections` may describe optional UI connection advice, but every suggestion must point to existing template
  node keys and must not connect a node to itself.
- Built-in `full_canvas` templates may contain one `inspiration_context` node. When such a template is appended inside an
  existing inspiration workbench, application code must reuse the active workflow's existing inspiration-context singleton instead
  of creating a second inspiration node.
- Built-in `node_group` templates may declare `default_external_connections` from `existing_inspiration_context` to template
  copy/image node keys. Applying the template must materialize those declarations as normal visible `workflow_edges`.
  They are not hidden suggestions or frontend-only hints.
- User-saved node-group templates are persisted in `user_canvas_templates`, not in the built-in template constant list.
  Their stable catalog key is `user:{id}`, `kind` is `node_group`, `schema_version` is `1`, and `template_json.version`
  must also be `1`.
- User-saved templates are converted back into the same `CanvasTemplate` contract with `source == "user"` and
  `user_template_id` populated. The existing catalog endpoint returns built-in and non-archived user templates together.
- Saving a user template from workflow nodes must capture only reusable intent: node type, title, relative position,
  normalized editable `config_json`, and edges whose source and target are both selected nodes. It must not read or persist
  `output_json`, workflow run rows, node run rows, artifact ids, file URLs/paths, inspiration ids, workflow ids, or database
  node ids.
- User templates must reject empty selections, duplicate node ids, missing active workflows, nodes outside the current
  active workflow, and selections containing `inspiration_context`. Known artifact-specific config fields such as
  `source_asset_ids`, `source_poster_variant_id`, `copy_set_id`, `poster_variant_id`,
  `generated_poster_variant_ids`, `filled_source_asset_ids`, and image-session asset ids must be stripped while preserving
  reusable fields such as `role`, `label`, `instruction`, `size`, and normalized `tool_options`. Unknown config keys ending
  in `_id`, `_ids`, `_url`, or `_path` must be rejected so new artifact references do not silently enter templates.
- Applying a user template must go through the same template application path as built-in templates and must create
  ordinary persisted workflow nodes and edges. Archived user templates must not appear in the catalog and must not be
  applicable by key.
- Built-in templates must cover real ecommerce image-production scenarios: marketplace/main image, Taobao main image,
  Xiaohongshu/content cover, multi-angle gallery, SKU/variant, feature infographic, size/spec, scale reference,
  package/checklist, usage steps, comparison, model/lifestyle, scene, detail/material, campaign/promotion,
  short-video cover, and white-background output.
- Templates must not introduce new workflow node types by enum drift. When a new `WorkflowNodeType` is added elsewhere,
  it becomes template-supported only after `SUPPORTED_CANVAS_TEMPLATE_NODE_TYPES` and template tests are updated on
  purpose.

### 4. Validation & Error Matrix

- Template version is not `1` -> `BusinessValidationError("画布模板版本必须是 v1")`.
- Unsupported template kind -> `BusinessValidationError("画布模板类型不支持")`.
- Empty node list -> `BusinessValidationError("画布模板至少需要一个节点")`.
- Duplicate node key -> `BusinessValidationError("画布模板节点 key 不能重复")`.
- Unsupported node type -> `BusinessValidationError("画布模板包含不支持的节点类型")`.
- Non-image node declares `size` -> `BusinessValidationError("只有生图节点可以声明尺寸")`.
- Edge connects a node to itself -> `BusinessValidationError("画布模板连线不能连接到自身")`.
- Edge references a missing source or target node -> `BusinessValidationError("画布模板连线引用了不存在的节点")`.
- Template graph contains a cycle -> `BusinessValidationError` from the workflow DAG topological validator.
- Output slot references a missing node or a non-`reference_image` node ->
  `BusinessValidationError("画布模板输出槽必须引用参考图节点")`.
- Reference input hint references a missing node or a non-`reference_image` node ->
  `BusinessValidationError("画布模板参考输入必须引用参考图节点")`.
- Suggested connection connects a node to itself -> `BusinessValidationError("画布模板连接建议不能连接到自身")`.
- Suggested connection references a missing node -> `BusinessValidationError("画布模板连接建议引用了不存在的节点")`.
- Default external connection on a non-`node_group` template ->
  `BusinessValidationError("只有节点组模板可以声明默认外部连接")`.
- Default external connection references a missing template node ->
  `BusinessValidationError("画布模板默认外部连接引用了不存在的节点")`.
- Default external connection targets a node that is not `copy_generation` or `image_generation` ->
  `BusinessValidationError("画布模板默认外部连接只能接入文案或生图节点")`.
- Unknown built-in template key -> `ValueError("画布模板不存在")`.
- User template save with no selected nodes -> `BusinessValidationError("请选择要保存的节点")`.
- User template save with duplicate node ids -> `BusinessValidationError("保存模板的节点不能重复")`.
- User template save before an active workflow exists -> `BusinessValidationError("需要先创建或打开画布后才能保存模板")`.
- User template save with nodes outside the current active workflow ->
  `BusinessValidationError("保存模板包含不属于当前画布的节点")`.
- User template save containing `inspiration_context` -> `BusinessValidationError("节点组模板不能包含灵感产物资料节点")`.
- User template save with unknown artifact-shaped config keys ->
  `BusinessValidationError("模板配置包含不可复用的产物数据")`.
- Archived or missing user template key -> `BusinessValidationError("画布模板不存在")`.

### 5. Good/Base/Bad Cases

- Good: main-image template creates inspiration context, copy generation, image generation, generated reference output, and a
  downstream iteration image/output pair. The iteration path remains a downstream DAG branch.
- Good: campaign template contains campaign prompt defaults, poster image size, and an explicit generated output slot.
- Good: built-in scenario template appends reusable ecommerce production nodes by materializing normal workflow nodes,
  reusing the active workflow inspiration-context node for the template's `inspiration` key, and remapping all other template keys
  to database node IDs before creating edges.
- Good: saving a selected copy/image/reference chain stores relative node positions and internal selected edges, appears in
  the template catalog with `source == "user"`, and applying `user:{id}` creates normal workflow rows with empty outputs.
- Good: saving a reference node that has been filled with an image strips `source_asset_ids` and
  `source_poster_variant_id` while preserving `role` and `label`.
- Base: a template can include suggested connections for optional palette guidance without requiring those suggestions to
  be materialized as edges. Default external connections are a separate executable contract and are materialized.
- Base: a template can include multiple output slots when one generation node is expected to fill multiple downstream
  `reference_image` nodes.
- Bad: a template stores a hidden chain in frontend state and creates only one placeholder node in the database.
- Bad: a template uses a new enum value before the explicit template allowlist and tests are updated.
- Bad: a user template stores output JSON, run results, source asset ids, poster ids, image-session ids, inspiration ids, or
  workflow ids and reuses those artifacts when applied to another inspiration.

### 6. Tests Required

- Unit test every built-in template with `validate_canvas_template` and assert all built-ins have unique keys.
- Unit test required ecommerce scenario coverage: marketplace/main image, Taobao main image, Xiaohongshu/content cover,
  multi-angle gallery, SKU/variant, feature infographic, size/spec, scale reference, package/checklist, usage steps,
  comparison, model/lifestyle, scene, detail/material, campaign/promotion, short-video cover, and white-background.
- Unit test downstream iteration remains acyclic and includes only downstream template edges.
- Unit test validation rejects missing edge references, self-edges, cycles, duplicate node keys, unsupported node types,
  invalid template kind, invalid output slot references, invalid suggested connections, and invalid default external
  connections.
- Unit test direct Pydantic model construction still runs contract validation so bypassing catalog helpers cannot create an
  invalid template instance.
- Regression test `SUPPORTED_CANVAS_TEMPLATE_NODE_TYPES` as an explicit allowlist so future `WorkflowNodeType` additions do
  not silently become template-supported.
- When a template application API is added, integration tests must assert that applying a template persists real
  `workflow_nodes` and `workflow_edges`, preserves DAG validation, and keeps prompt/size defaults editable through normal
  node update endpoints.
- User-template tests must cover create/list/rename/archive/apply, application of `user:{id}` as real workflow rows, hiding
  archived templates from the catalog, stripping known artifact config fields, rejecting unknown artifact-shaped config
  keys, and ignoring existing `output_json` / run outputs.

### 7. Wrong vs Correct

#### Wrong

```python
template = {
    "key": "main-image",
    "steps": ["copy", "image", "iterate"],
}
```

This loses the node and edge contract, so later code cannot materialize the plan as a real workflow DAG.

#### Correct

```python
CanvasTemplate(
    key="ecommerce-main-image-v1",
    version=1,
    kind="full_canvas",
    nodes=[
        CanvasTemplateNodeSpec(key="copy", node_type=WorkflowNodeType.COPY_GENERATION, title="灵感产物卖点文案"),
        CanvasTemplateNodeSpec(key="image", node_type=WorkflowNodeType.IMAGE_GENERATION, title="生成主图"),
        CanvasTemplateNodeSpec(key="output", node_type=WorkflowNodeType.REFERENCE_IMAGE, title="主图结果"),
    ],
    edges=[
        CanvasTemplateEdgeSpec(source_node_key="copy", target_node_key="image"),
        CanvasTemplateEdgeSpec(source_node_key="image", target_node_key="output"),
    ],
)
```

Keep the template as node and edge specs so application code can persist visible, editable, runnable workflow objects.

## Scenario: Inspiration creation canvas template selection

### 1. Scope / Trigger

- Trigger: changes to `POST /api/inspirations`, inspiration creation use cases, or creation-time canvas template application.
- Inspiration creation may initialize a complete ecommerce output plan, but only by materializing a usable database-backed
  `full_canvas` template into normal persisted workflow rows.
- Creation-time template selection must not implement user-saved template storage, result actions, or material lineage.
  Those are separate inspiration-workbench capabilities.

### 2. Signatures

- API: `POST /api/inspirations` multipart form.
- Existing required fields remain:
  - `name: str`
  - `image: UploadFile`
- Existing optional fields remain:
  - `reference_images: list[UploadFile] | None`
  - `category: str | None`
  - `price: str | None`
  - `source_note: str | None`
- Creation-time template field:
  - `canvas_template_key: str | None`
- Application entrypoint:
  - `create_inspiration(..., canvas_template_key: str | None = None, ...) -> Inspiration`
- Application helper:
  - `resolve_inspiration_creation_canvas_template(session, canvas_template_key: str | None, *, initial_workflow_entry, actor_user_id) -> CanvasTemplate | None`
  - `materialize_inspiration_workflow_from_template(session, *, inspiration_id: str, template: CanvasTemplate, initial_entry_mode: str = "image", entry_text: str | None = None) -> InspirationWorkflow`

### 3. Contracts

- Missing, blank, and approved default aliases such as `default`, `basic`, `blank`, or `minimal` preserve the existing lazy
  default workflow behavior. Do not eagerly create a default workflow during inspiration creation for those values.
- Any other key must resolve through the database-backed canvas template catalog with `require_usable=True`. Do not accept
  frontend-only template payloads, browser-local template definitions, disabled templates, or disabled template
  categories for inspiration creation.
- Only `CanvasTemplate.kind == "full_canvas"` is valid at inspiration creation time.
- Built-in/global ecommerce templates are complete `full_canvas` templates. Inspiration creation may materialize any usable
  catalog full-canvas template visible to the actor.
- `create_inspiration` owns the SQLAlchemy transaction. Template materialization helpers may `flush` rows to resolve ids, but
  must not `commit` independently.
- Materialized `WorkflowNode` rows copy template `node_type`, `title`, `position_x`, `position_y`, and `config_json`.
- Materialized `WorkflowEdge` rows remap template node keys to persisted node ids and copy `source_handle` /
  `target_handle`.
- For template-created `copy` and `tail` entries, normalized `entry_text` must be written to the materialized
  `inspiration_context` node config as `entry_type`, `long_text`, and `source_note`. This keeps list summaries and downstream
  context reads aligned with non-template creation.
- The materialized workflow must be active and must use normal workflow tables. Do not store a hidden selected-template
  state that later frontend code interprets locally.
- If the inspiration creation page renders a large preview for a built-in `full_canvas` plan, that preview is a mirror of the
  backend template. Node titles, relative order, edges, and coordinates for shared template keys must be updated with the
  backend template and covered by regression tests.
- Later calls to `get_or_create_inspiration_workflow` must return the active workflow created at inspiration creation and must not
  overwrite it with the lazy default graph.

### 4. Validation & Error Matrix

- `canvas_template_key` missing/blank/default alias -> create inspiration, no eager workflow row.
- Unknown non-default key -> `BusinessValidationError("画布模板不存在")` or equivalent template-missing `400`.
- Disabled/unavailable template key -> `BusinessValidationError("画布模板不存在")` for catalog-hidden rows or
  `BusinessValidationError("资源已被管理员屏蔽，暂不可使用")` when resolved but not usable.
- Built-in key whose template kind is not `full_canvas` -> `BusinessValidationError` with a message explaining inspiration
  creation supports only complete canvas templates.
- Inspiration id missing during materialization -> `NotFoundError("灵感产物不存在")`.
- Inspiration already has an active workflow before materialization -> `BusinessValidationError("灵感产物已有活动画布")`.

### 5. Good/Base/Bad Cases

- Good: creating a inspiration with `ecommerce-main-image-v1` creates one active `InspirationWorkflow`, persists all template nodes
  and edges, and the detail workflow endpoint returns that workflow unchanged.
- Good: creating a copy-entry inspiration from a full-canvas template persists the submitted `entry_text` on the
  `inspiration_context` node so `/api/inspirations` can return the same six-character excerpt as non-template copy entries.
- Good: creating a inspiration with no `canvas_template_key` creates only the inspiration/assets; opening the workflow later
  lazily creates the current default graph.
- Base: frontend can label the key as a merchant-facing output plan such as `灵感产物主图方案`; the submitted value remains the
  backend-recognized `canvas_template_key`.
- Bad: accepting a user-saved `node_group` template in inspiration creation and pretending it is a full-canvas starter.
- Bad: creating a default workflow eagerly for blank/default key and changing current lazy behavior without an explicit
  inspiration decision.
- Bad: persisting only `canvas_template_key` on the inspiration and letting the frontend draw non-persisted template nodes.

### 6. Tests Required

- API test default inspiration creation without `canvas_template_key` succeeds and does not eagerly create a workflow.
- API test explicit default alias preserves the same lazy behavior.
- API test valid `full_canvas` key creates an active workflow immediately.
- API test persisted node and edge counts, node types, titles, positions, and config match the selected template.
- Regression test layout-sensitive built-in templates, including the main-image output and downstream iteration node
  coordinates that the creation page preview mirrors.
- API regression for template-backed copy/tail entry creation asserting the `inspiration_context` config stores `entry_type`,
  `long_text`, and `source_note`, and the list summary returns the expected excerpt.
- API test unknown key returns `400` with template-missing detail.
- API test a broad built-in scenario key such as `ecommerce-sku-variant-image-v1` creates an active workflow immediately.
- Regression test fetching the workflow after template-backed creation returns the existing active workflow id.

### 7. Wrong vs Correct

#### Wrong

```python
inspiration = create_inspiration(...)
inspiration.canvas_template_key = payload.canvas_template_key
session.commit()
```

This stores a hidden selector but does not create editable, runnable workflow rows.

#### Correct

```python
template = resolve_inspiration_creation_canvas_template(canvas_template_key)
inspiration = Inspiration(...)
session.add(inspiration)
session.flush()
if template is not None:
    materialize_inspiration_workflow_from_template(session, inspiration_id=inspiration.id, template=template)
session.commit()
```

Creation-time template application must persist the visible workflow graph in the same inspiration creation transaction.

## Scenario: Inspiration list summary generated image and key-info contract

### 1. Scope / Trigger

- Trigger: changes to `/api/inspirations`, `InspirationSummaryResponse`, inspiration list query loading, workflow run artifact
  persistence, or frontend list thumbnail/key-info behavior.
- The list must show two different concepts: the latest generated output image and the original starting information.

### 2. Signatures

- API: `GET /api/inspirations`.
- Backend serializer: `serialize_inspiration_summary(inspiration: Inspiration) -> InspirationSummaryResponse`.
- Summary response fields:
  - `initial_workflow_entry: "image" | "copy" | "tail" | "blank" | null`
  - `initial_entry_text: str | null`
  - `initial_entry_text_excerpt: str | null`
  - `latest_generated_image_download_url: str | null`
  - `latest_generated_image_preview_url: str | null`
  - `latest_generated_image_thumbnail_url: str | null`
  - Existing `source_image_*` fields remain unchanged.
- Query helper: inspiration list eager loading may load workflow ids, node config/position, edge endpoints, run timestamps,
  and node-run `poster_variant_id`, but must not load workflow node or node-run `output_json` for list summaries.

### 3. Contracts

- The main list thumbnail is the latest generated result's first image. It must not fall back to the source image when no
  generated result exists.
- Latest generated result selection uses `WorkflowNodeRun.poster_variant_id` from successful image-generation node runs,
  not the newest `PosterVariant.created_at`.
- Pick the newest workflow run containing successful generated images by `finished_at or started_at`, then `started_at`,
  then id descending.
- Within that run, choose the first successful image node by workflow topological order. If the graph cannot be ordered,
  fall back to `(position_x, position_y, created_at, id)`.
- `initial_entry_text` is the full trimmed text. `initial_entry_text_excerpt` is the first six Unicode characters derived
  from the same text. Prefer the `inspiration_context` node's normalized `long_text` / `source_note`; fall back to the entry
  node config (`copy.source_note` or `tail.source_text`) for legacy records.
- For image-entry rows, key-info display uses the existing `source_image_*` fields. For copy/tail rows, it uses
  `initial_entry_text` and falls back to `initial_entry_text_excerpt`. Blank rows use a stable empty state.

### 4. Validation & Error Matrix

- No active workflow -> `initial_workflow_entry`, `initial_entry_text`, and `initial_entry_text_excerpt` are `null`;
  generated image fields are `null`.
- Active workflow has source image but no generated node-run poster -> generated image fields are `null`.
- Latest run has successful node runs without image-generation nodes -> skip that run for generated image selection.
- Text entry has only legacy node config -> summary still returns the six-character excerpt.
- Text entry has normalized inspiration-context text -> summary returns both the full trimmed text and the six-character excerpt.
- Invalid/cyclic graph during list serialization -> use position fallback rather than failing the list response.

### 5. Good/Base/Bad Cases

- Good: tail/image generation creates several posters in one node; the node run stores the first poster id, and the list
  thumbnail uses that id.
- Good: a later run has two successful image nodes; the thumbnail uses the first node by graph order even when a later
  node's poster was created last.
- Base: image-entry inspirations with only an original source image render an empty main thumbnail and source image in
  key-info.
- Bad: choosing `max(inspiration.poster_variants, key=created_at)` for the main thumbnail.
- Bad: reusing `source_image_thumbnail_url` as the first-column fallback.
- Bad: loading workflow `output_json` in the list query only to compute summary fields.

### 6. Tests Required

- API/list regression asserting `latest_generated_image_*` comes from the latest run's first successful image node.
- Regression asserting a later-created poster from the same run does not become the list thumbnail.
- API/list regression for template-created copy/tail entry text persistence and six-character excerpt.
- API/list regression for `initial_entry_text` full-text output.
- Frontend helper tests asserting main thumbnail reads only `latest_generated_image_*`.
- Frontend helper tests asserting image key-info uses `source_image_*`, text key-info prefers full text with excerpt
  fallback, and blank rows are empty.

### 7. Wrong vs Correct

#### Wrong

```python
latest_poster = max(inspiration.poster_variants, key=lambda item: item.created_at, default=None)
summary.latest_generated_image_thumbnail_url = poster_url(latest_poster)
```

This breaks batch generation because the last-created poster is not necessarily the first image in the latest generated
result.

#### Correct

```python
node_run = first_successful_image_node_run(latest_run_with_generated_images, workflow_node_order)
poster = poster_by_id.get(node_run.poster_variant_id)
summary.latest_generated_image_thumbnail_url = poster_url(poster)
```

Use the per-node-run first-artifact pointer and workflow node order to preserve result semantics.

## Scenario: Inspiration workflow template application

### 1. Scope / Trigger

- Trigger: changes to canvas-internal template insertion APIs, built-in scenario templates, or inspiration workflow
  mutation code that materializes template nodes.
- The workbench may append built-in `full_canvas` scenario templates to an existing active inspiration workflow by creating
  normal persisted workflow rows and reusing the active workflow's existing inspiration-context node.
- This scenario does not cover inspiration-creation template selection, user-saved template authoring,
  drag-to-canvas authoring, or hidden suggested external connections.

### 2. Signatures

- Catalog API: `GET /api/workflow/canvas-templates -> CanvasTemplateListResponse`.
- Catalog summary preview fields:
  - `preview_nodes: list[{key, node_type, title, position_x, position_y}]`
  - `preview_edges: list[{source_node_key, target_node_key}]`
  - `default_external_connections: list[{source, target_node_key, label}]`
- Apply API: `POST /api/inspirations/{inspiration_id}/workflow/template-groups -> InspirationWorkflowResponse`.
- Request schema:
  - `template_key: str`
  - `position_x: int`
  - `position_y: int`
- Application entrypoint:
  - `apply_node_group_template_to_workflow(session, inspiration_id, template_key, position_x, position_y) -> InspirationWorkflow`
- Shared materialization helper:
  - `materialize_canvas_template_graph(..., existing_nodes_by_template_key=None, external_source_nodes_by_template_source=None)`

### 3. Contracts

- The apply API resolves `template_key` through the backend template catalog, including built-in scenario templates and
  non-archived user templates.
- Catalog summary responses must expose lightweight real graph preview data from `CanvasTemplate.nodes` and
  `CanvasTemplate.edges`. Include node key, type, title, and relative coordinates plus edge source/target keys; do not
  include large prompt seeds, instruction strings, or `config_json` in summary preview data.
- Built-in `full_canvas` scenario templates and user-saved `node_group` templates are both valid for canvas-internal
  insertion.
- Applying a template appends to the inspiration's active workflow and preserves all existing nodes and edges.
- If a template contains `inspiration_context`, the apply path must map that template key to the active workflow's existing
  inspiration-context node and skip creating a duplicate inspiration node.
- Template node specs are materialized into real `workflow_nodes` rows by copying `node_type`, `title`, `config_json`, and
  relative layout.
- The smallest insertable template `position_x` / `position_y` becomes the anchor that lands at request `position_x` /
  `position_y`; other inserted template nodes keep their relative offsets.
- Template edge specs are materialized as real `workflow_edges` rows after remapping template keys to either newly created
  nodes or explicitly reused existing nodes such as the inspiration-context singleton.
- `suggested_connections` are returned by the catalog for UI guidance and must not be silently materialized as external
  workflow edges.
- `default_external_connections` are returned by the catalog as lightweight metadata and are materialized by the apply API
  as real visible `workflow_edges` when a node-group template declares them.
- Built-in scenario templates contain a `inspiration_context` node in the template graph. The active workflow already owns
  the inspiration-context singleton, so insertion reuses it and still materializes the template's inspiration-to-copy/image edges.

### 4. Validation & Error Matrix

- Unknown `template_key` -> `400`, `{"detail": "画布模板不存在"}`.
- Missing inspiration -> `404`, `{"detail": "灵感产物不存在"}`.
- Existing inspiration without an active workflow -> `400`; the apply API must not create a workflow implicitly.
- Active workflow without exactly one `inspiration_context` node -> `400`; the apply API must not create a partially usable
  scenario template.
- Template self-edge, missing edge reference, or cycle -> `400` business validation error.
- Any generated edge that would make the full active workflow cyclic -> rollback and return a `400` DAG validation error.

### 5. Good/Base/Bad Cases

- Good: applying `ecommerce-sku-variant-image-v1` to the default workflow increases node and edge counts, keeps all
  previous node/edge IDs, does not create a second inspiration-context node, and adds visible edges from the existing inspiration
  context to the template copy/image nodes.
- Good: applying a template at `position_x=480`, `position_y=360` places the template's minimum coordinate there while
  preserving relative spacing.
- Base: the UI may render reference input hints and connection suggestions from the catalog.
- Bad: frontend creates local-only template nodes without calling the apply API.
- Bad: creating a second `inspiration_context` node when applying a built-in scenario template inside an existing canvas.
- Bad: materializing suggested external connections as hidden edges.

### 6. Tests Required

- API test catalog response includes built-in templates with `kind`, scenario metadata, output slots, reference input
  hints, suggested connections, lightweight default external connections, and real `preview_nodes` / `preview_edges`
  matching the built-in template definitions. Catalog summaries must not expose config/prompt payloads.
- API test successful template apply preserves existing nodes and edges.
- API test persisted node count, edge count, node types, titles, config, and shifted positions match the backend template.
- API test created edges are the template edges remapped to newly created nodes plus the existing inspiration-context node,
  and no self-edge is created.
- API test built-in full-canvas insertion reuses the existing inspiration-context node.
- API test missing inspiration-context node returns `400` and does not create a partial template.
- API test unknown key returns `400` with template-missing detail.

### 7. Wrong vs Correct

#### Wrong

```python
workflow.nodes.extend(local_template_nodes)
```

This leaves the template in local memory and loses the persisted DAG contract.

#### Correct

```python
workflow = apply_node_group_template_to_workflow(
    session,
    inspiration_id=inspiration_id,
    template_key="ecommerce-sku-variant-image-v1",
    position_x=480,
    position_y=360,
)
```

The application use case resolves the built-in template, materializes visible workflow rows, validates the full DAG, and
returns the normal `InspirationWorkflow`.

## Scenario: Inspiration workflow DAG persistence and execution

### 1. Scope / Trigger

- Trigger: any change to inspiration workbench DAG persistence, node execution, run history, or artifact write-back.
- This is a cross-layer and database-backed feature: SQLAlchemy models, Alembic migrations, Pydantic schemas, API routes,
  frontend DTOs, and workflow tests must stay in sync.

### 2. Signatures

- Tables:
  - `inspiration_workflows(inspiration_id, title, active)` with one active workflow per inspiration.
  - `workflow_nodes(workflow_id, node_type, title, position_x, position_y, config_json, status, output_json, failure_reason)`.
  - `workflow_edges(workflow_id, source_node_id, target_node_id, source_handle, target_handle)`.
  - `workflow_runs(workflow_id, status, started_at, finished_at, failure_reason)`.
  - `workflow_node_runs(workflow_run_id, node_id, status, output_json, copy_set_id, poster_variant_id, image_session_asset_id)`.
  - `source_assets(inspiration_id, kind, original_filename, mime_type, storage_provider, object_key, ...)` stores workflow
    image and text-document resources. `SourceAssetKind` includes `original_image`, `reference_image`,
    `processed_inspiration_image`, `context_image`, and `context_document`.
- APIs:
  - `GET /api/inspirations/{inspiration_id}/workflow`
  - `GET /api/inspirations/{inspiration_id}/workflow/status`
  - `POST /api/inspirations/{inspiration_id}/workflow/nodes`
  - `PATCH /api/workflow-nodes/{node_id}`
  - `PATCH /api/workflow-nodes/{node_id}/copy`
  - `POST /api/workflow-nodes/{node_id}/image`
  - `POST /api/workflow-nodes/{node_id}/image-source`
  - `POST /api/workflow-nodes/{node_id}/document` with multipart field `document`
  - `POST /api/inspirations/{inspiration_id}/workflow/edges`
  - `DELETE /api/workflow-edges/{edge_id}`
  - `POST /api/inspirations/{inspiration_id}/workflow/run`
- Provider contracts:
  - `TextProvider.generate_copy(inspiration, brief, config, reference_images=None)` receives `CopyNodeConfigV2` plus connected
    `ReferenceImageInput` values with `path`, `mime_type`, `filename`, `role`, and `label`.

### 3. Contracts

- Supported inspiration node types are exactly mirrored in frontend types:
  `inspiration_context`, `reference_image`, `copy_generation`, `image_generation`, and `tail_splitter`.
- Legacy PostgreSQL databases may already have older string node values. Forward migrations must safely migrate old
  image-slot rows to `reference_image`; fresh databases should create only the supported simplified node values.
- Node status values are `idle`, `queued`, `running`, `succeeded`, `failed`; run status values are
  `running`, `waiting_confirmation`, `succeeded`, `failed`, `cancelled`. New workflow enum values use non-native string
  storage and code/frontend validation updates; they must not require a PostgreSQL enum expansion migration.
- Active workflow status polling must use `GET /api/inspirations/{inspiration_id}/workflow/status`, not repeated full workflow
  detail loads. The status endpoint returns workflow identity/timestamps, node status fields, latest run status fields,
  and node-run status fields only; it must not serialize edges, node `config_json`, node `output_json`, or node-run
  artifact fields. The status query should load only the ORM columns needed for those status DTOs and avoid eager-loading
  inspiration artifacts or full DAG relationships.
- `reference_image` nodes are user-visible `参考图` slots. They can be manually uploaded into through
  `POST /api/workflow-nodes/{node_id}/image`, filled from an existing inspiration image through
  `POST /api/workflow-nodes/{node_id}/image-source`, or filled by upstream `image_generation` nodes.
- Each `reference_image` node is a single current-image slot. Manual upload and upstream `image_generation` fill must
  replace that node's current `config_json.source_asset_ids`, `output_json.source_asset_ids`, `output_json.image_asset_ids`,
  and `output_json.images` with the new single asset. Do not delete the old `source_assets` row; it remains inspiration history
  and can still be downloaded from artifact views.
- `POST /api/workflow-nodes/{node_id}/image-source` accepts exactly one of `source_asset_id` or `poster_variant_id`.
  SourceAsset-backed requests directly bind the existing same-inspiration `reference_image` SourceAsset without creating a
  duplicate upload. If that SourceAsset has `source_poster_variant_id`, preserve that poster-source metadata in the filled
  reference node output. PosterVariant-backed requests first look for a same-inspiration `reference_image` SourceAsset whose
  `source_poster_variant_id` matches the poster, then fall back to workflow output pairings from
  `generated_poster_variant_ids` / `filled_source_asset_ids`; if none exists, copy/materialize the poster file into a new
  `reference_image` SourceAsset named `poster-{poster_variant_id}.*` with `source_poster_variant_id` set, then bind it.
  The filename convention is legacy compatibility only; current de-duplication should use explicit
  `source_poster_variant_id` so a user-uploaded reference image with the same filename is not hidden or rebound as a poster
  copy.
- `reference_image` nodes store image material as first-class `source_assets` rows and expose `source_asset_ids` /
  `image_asset_ids` in workflow output JSON for downstream image nodes.
- `copy_generation` nodes must collect connected upstream `reference_image` slots and pass their asset paths plus
  role/label metadata to the text provider. Text-only providers should include concise reference metadata in the prompt;
  multimodal-capable providers may also attach image payloads/paths.
- A generated `copy_generation` output is editable through `PATCH /api/workflow-nodes/{node_id}/copy`. The endpoint
  updates the underlying `CopySet.structured_payload`, then rewrites the node output so downstream image nodes read the
  edited v2 copy through the existing `copy_set_id`. Structured-payload edits must not re-derive or overwrite
  removed fixed-field copy columns.
- Manually edited copy node outputs should be treated as the selected copy for downstream runs. Re-running a downstream
  image node must not silently replace that edited `CopySet` with a fresh generated copy before image generation.
- New copy-generation runs must produce `CopyPayloadV2` as the only path. Providers, templates, editors, and tests must
  treat `structured_payload` as the copy contract.
- Copy-node output JSON must include `structured_payload` and must not emit fixed copy fields for workflow runs. Upstream
  image context must use `structured_payload.summary/content/visual_guidance`.
- `image_generation` nodes collect incoming edge context, including upstream copy text and reference-image outputs. They
  are trigger/config nodes, not image-bearing artifact slots; generated images must be viewed/downloaded from linked
  downstream `reference_image` nodes or normal inspiration artifact history, not from the `image_generation` node card.
- `deck_generation` nodes are canvas-anchored deck editors, not normal execution nodes. They may consume upstream
  `inspiration_context`, `copy_generation`, `reference_image`, `image_generation`, and `tail_splitter` outputs as deck
  source material, but they are excluded from normal workflow run planning, queueing, retry, and scheduler dispatch.
- Edges into `deck_generation` express source-pool membership only. They do not imply automatic downstream execution.
  Backend edge validation must reject `deck_generation` as an edge source so the node stays target-only in the DAG.
- `deck_generation` nodes are excluded from canvas-template save/apply contracts and from reusable-node artifact copying.
  Full-canvas templates, node-group templates, and duplicate/template-copy sanitizers must not persist live deck ids,
  slide bindings, deck source fingerprints, or deck history references.
- Deleting a `deck_generation` node must not delete its deck history. Deck linkage is soft via `decks.workflow_node_id`,
  and serializer-time existence checks determine whether the source node still exists.
- Workflow image generation mode is derived from the stored `poster_generation_mode` plus the current image-purpose
  provider binding. Real image bindings (`openai_responses`, `openai_images`, or `google_gemini_image`) execute through
  the image provider even when the legacy runtime value remains `template`. `mock` image bindings keep the no-external
  local development path, and `PosterRenderer` remains available for template/mock fallback.
- Generated-mode provider prompts expose visual-subject policy through the runtime-configurable
  `prompt_poster_image_reference_policy` placeholder, not hidden provider code. The default policy treats the first/source
  image as the primary visual subject when present, while upstream copy is auxiliary selling-point/layout context. This is
  important when inspiration text is weak such as a default name `灵感产物` and copy generation may otherwise invent an unrelated
  role, IP, brand, or ad theme.
- Image prompt mode is determined by explicit copy linkage, not by whether a workflow-local `CopySet` exists for
  persistence.
  If `image_generation.config_json.copy_set_id` or an upstream `copy_generation.output_json.copy_set_id` points to a
  same-inspiration `CopySet`, provider input must set `PosterGenerationInput.copy_prompt_mode = "copy"` and use the poster/copy
  image template. If no explicit copy link exists, create the workflow-local draft `CopySet` as needed for
  `PosterVariant.copy_set_id`, but set `copy_prompt_mode = "image_edit"` so provider prompts use the no-copy image-edit
  template and do not require fixed copy-field semantics.
- A connected upstream `inspiration_context` node contributes normalized context fields to `copy_generation`,
  `image_generation`, and `tail_splitter`: `name`, `owner_id`, `entry_type`, `long_text`, `image_source_asset_id`,
  `document_source_asset_id`, `document_filename`, `document_mime_type`, `document_text`, and `dynamic_fields`, plus
  legacy `category`, `price`, `source_note`, `source_asset_id`, and `source_asset_ids`.
- For image-generation context only, "upstream" includes direct edges and transitive ancestors such as
  `inspiration_context -> copy_generation -> image_generation`; this preserves inspiration context for older or manually rewired
  canvases that no longer have a direct `inspiration_context -> image_generation` edge. Use `image_source_asset_id` first,
  then legacy `source_asset_id`, then the inspiration's current original source asset so direct selected image-node runs can
  use saved context without re-running inspiration context. Deduplicate with other reference assets before provider/render
  input construction. A totally disconnected image-generation node remains free-form and must not implicitly inherit
  inspiration context.
- Image-generation count is driven by graph structure: an `image_generation` node connected to N downstream
  `reference_image` slots generates N images and fills those slots. If no downstream reference slot is connected, the node
  must fail with a clear user-facing message asking the user to connect at least one image/reference node before running.
- InspirationDetail's single-node add action should create a downstream `reference_image` slot and a visible
  `image_generation -> reference_image` edge when adding a new `image_generation` trigger node. This is a UI creation
  convenience; execution still reads only persisted graph edges and must not invent hidden output slots.
- Count downstream `reference_image` slots by unique target node id, not by raw edge count. Duplicate edges from the same
  `image_generation` node to the same `reference_image` slot must not multiply generated images or overwrite the slot
  multiple times in one run.
- When N > 1, provider/render calls for the N target images should be initiated concurrently. Persist the returned
  `PosterVariant` and downstream `SourceAsset` rows in the owning SQLAlchemy session after provider calls return; do not
  share one SQLAlchemy `Session` across provider threads.
- Resolve runtime settings and construct provider/renderer dependencies before starting provider/render worker threads, so
  those threads do not open SQLAlchemy sessions just to read config while images are being generated.
- `image_generation` node config may override provider size with `size`; application contracts must normalize it to the
  generation safety bounds before it reaches providers, including a 512px minimum per side and the runtime maximum
  dimension. The normalized value is carried as `PosterGenerationInput.image_size`, and providers should prefer it over
  global runtime defaults.
- `image_generation` node config may override image-generation tool parameters with `tool_options`; application contracts
  must carry this as `PosterGenerationInput.tool_options`, and generated-mode providers should pass it into their image
  client/tool builder after normalizing blank/null values.
- Generated images should still be persisted as first-class `poster_variants` for history and as `source_assets` on the
  downstream `reference_image` slots. Keep only workflow-boundary summaries and internal generated-poster IDs in
  `image_generation.output_json`; do not expose `poster_variant_ids` there as the preview/download contract.
- `inspiration_context` execution is non-AI. Running the node returns normalized context JSON and must not call text or image
  providers. `source_note` is a legacy alias for `long_text` when `long_text` is missing, while `category`, `price`,
  `source_asset_id`, and `source_asset_ids` remain API/output compatibility fields.
- `long_text` and legacy `source_note` are stored as raw text and may contain Markdown and Mermaid fenced blocks. Creation
  entry text, creation `long_text` / `source_note`, and inspiration-context node config `long_text` / `source_note` share the
  `INSPIRATION_CONTEXT_MARKDOWN_TEXT_MAX_LENGTH = 50_000` application limit.
- `entry_type` values are `image`, `copy`, `tail`, and `blank`. Resolution order is saved node config, workflow
  `initial_entry_mode`, previous node output, then `image`. Template `entry_mode` remains the existing
  `image/copy/tail` template vocabulary; blank canvases use `blank` only on workflow/context state.
- `dynamic_fields` is a one-level JSON object whose keys are non-blank strings and values are scalar JSON values:
  string, finite number, boolean, or `null`. Nested objects and arrays must be rejected during config normalization.
- `context_image` assets represent the single image resource attached to a inspiration context node. Uploading an image to a
  `inspiration_context` node through `POST /api/workflow-nodes/{node_id}/image` replaces `config_json.image_source_asset_id`
  and clears legacy `source_asset_id` / `source_asset_ids` from config. Original inspiration images remain the fallback when
  no context image exists.
- `context_document` assets represent the single text document attached to a inspiration context node. Document upload stores
  the asset id plus `document_filename`, `document_mime_type`, and UTF-8 `document_text` on config/output. First-pass
  uploads accept only `.txt`, `.md`, `.csv`, and `.json` with MIME `text/plain`, `text/markdown`, `text/csv`, or
  `application/json`, capped at 1 MB.
- Downstream context collection must append `long_text`, `document_text`, dynamic-field key/value text, and context image
  labels into `context_sources`. `context_image` assets may become `ReferenceImageInput(role="context")` for copy
  providers; `context_document` assets contribute text only and must not be treated as images.
- Inspiration context resolution must prefer the latest saved `inspiration_context.config_json` over stale `output_json` from an
  older run. Direct selected-node runs should not require re-running the inspiration-context node just to see saved edits.
- Copy/image node outputs may expose compact `context_summary` and `context_sources` for UI/tests. These summaries should
  name source nodes and concise upstream text/reference metadata, not full rendered provider prompts or provider payloads.

### 4. Validation & Error Matrix

- Missing inspiration/workflow/node/edge -> `ValueError("...不存在")`, mapped to HTTP `404`.
- Existing-image fill without exactly one `source_asset_id` / `poster_variant_id` -> `400`.
- Existing-image fill on a non-`reference_image` node -> `400`.
- Image upload on a node that is neither `reference_image` nor `inspiration_context` -> `400` with
  `只有参考图或上下文节点可以上传图片`.
- Document upload on a non-`inspiration_context` node -> `400` with `只有上下文节点可以上传文档`.
- Existing-image fill with a source asset or poster outside the workflow inspiration -> `404`.
- Poster fill when the backing file is missing or storage resolution fails -> `400` with `海报文件不存在`.
- Inspiration context `entry_type` outside `image/copy/tail/blank` -> `400` with `上下文入口类型不支持`.
- Inspiration context `dynamic_fields` is not a JSON object -> `400` with `动态信息必须是 JSON 对象`.
- Inspiration context dynamic-field key is blank -> `400` with `动态信息 key 不能为空`.
- Inspiration context dynamic-field value is an array, object, non-finite number, or other non-scalar value -> `400` with
  `动态信息只支持字符串、数字、布尔值或 null`.
- Document upload extension outside `.txt/.md/.csv/.json` -> `415` with `不支持的文档扩展名`.
- Document upload MIME outside `text/plain`, `text/markdown`, `text/csv`, and `application/json` -> `415` with
  `不支持的文档类型: <mime>`.
- Document upload over 1 MB -> `413` with `文档超过大小限制`.
- Empty document upload -> `400` with `文档内容不能为空`.
- Non-UTF-8 document upload -> `400` with `文档必须使用 UTF-8 编码`.
- Edge source/target outside the inspiration workflow -> `400` with a user-readable validation detail.
- Self-edge -> `400`.
- Cyclic graph -> `400` and no edge persisted.
- Image generation without a connected inspiration context/source image -> blank/free image generation remains valid when the
  node has at least one downstream `reference_image` target; only explicitly connected missing/broken image references
  should fail.
- Copy generation without a connected inspiration context -> run against the user's node instruction/upstream context as
  free-form copy using a neutral placeholder subject; do not silently fall back to `workflow.inspiration` fields or the
  inspiration source image.
- Image generation without usable explicit copy link -> create a workflow-local draft `CopySet` from inspiration context and
  image instruction for artifact linking, then generate the image with `copy_prompt_mode = "image_edit"`. Do not fail only
  because a copy node is absent, and do not route this no-copy path through the poster/copy prompt template.
- Image generation without downstream `reference_image` targets -> fail the node/run with a concise message such as
  `请先把生图节点连接到至少一个图片/参考图节点，再运行图片生成`; do not silently place output on the
  `image_generation` node.
- Any workflow execution path that receives a `deck_generation` node for normal node execution -> fail fast as a
  non-retryable validation error.

### 5. Good/Base/Bad Cases

- Good: run default DAG `inspiration_context -> copy_generation -> image_generation -> reference_image`; it produces one draft
  `CopySet`, one generated `PosterVariant` history row, fills the downstream reference slot with a `SourceAsset`, and writes
  run history.
- Good: connect completed copy/image/reference nodes into a `deck_generation` node; normal workflow runs still ignore the
  deck node while node-scoped deck APIs can read those upstream results as source material.
- Good: deleting a deck node leaves deck history readable because `decks.workflow_node_id` is a soft link, not a FK.
- Good: upload a context image and a UTF-8 markdown document to `inspiration_context`, patch `owner_id`, `entry_type`,
  `long_text`, and scalar `dynamic_fields`, then directly run a downstream image node. The downstream
  `context_summary.inspiration_context` reflects the saved config, `context_sources` include long text, document text, and
  dynamic fields, and image reference count includes the context image.
- Good: delete all downstream reference nodes, then run the image node; it fails before provider generation and tells the
  user to connect at least one image/reference node.
- Good: connect an uploaded style `reference_image` into a `copy_generation` node; the generated copy reflects the
  reference label/role and the provider receives explicit `ReferenceImageInput` metadata.
- Good: edit a copy node's structured payload; the persisted `CopySet.structured_payload` and node output update together,
  old four-field columns are not re-derived, and the downstream image node keeps referencing the same edited
  `copy_set_id`.
- Good: connect one uploaded `reference_image` into `image_generation`, then connect the image node to two downstream
  `reference_image` slots; one run creates two generated images and fills both slots.
- Base: if duplicate edges accidentally connect one image node to the same downstream `reference_image` slot, one run still
  generates one image for that unique slot, not one image per duplicate edge.
- Base: choosing an existing SourceAsset for a different reference slot reuses the same `source_asset_id` and does not add
  another `source_assets` row.
- Base: choosing a inspiration poster not backed by a workflow-filled SourceAsset materializes one new reference SourceAsset and
  updates only the selected reference node's current slot. Reusing the same poster again should reuse that materialized
  SourceAsset via the SourceAsset's `source_poster_variant_id`, even after the original reference node has been filled with
  another image.
- Base: run from a selected node; the executor runs the selected node and only missing/invalid required dependencies.
  Previously succeeded upstream nodes with valid first-class artifacts are read as context, not re-run.
- Base: selected image-node runs may leave upstream `inspiration_context` node status as `idle`; that node is reusable static
  context, so provider input must read its latest saved config/source image directly instead of depending on a current
  `WorkflowNodeRun` or fresh `output_json`.
- Base: selected-node execution planning is a DB-free domain rule fed by an application/query-layer reusable-edge
  decision. The domain rule decides which missing upstream node types are required; the query layer decides whether an
  existing `CopySet`, `PosterVariant`, or `SourceAsset` actually belongs to the workflow inspiration.
- Base: image-node reusable artifact detection must accept both `poster_variant_ids` and
  `generated_poster_variant_ids` in node `output_json`, then validate those IDs against first-class `PosterVariant` rows
  for the same inspiration before skipping an upstream image node.
- Bad: add an edge from an image node back to a copy node; the cycle validator rejects it before commit.

### 6. Tests Required

- Enum storage test includes workflow node/run enums, asserts database values equal enum `.value` strings, and asserts no
  native enum/check/FK business constraints are present in model/head metadata.
- API regression creates a inspiration with only name + image, loads the workflow, updates `inspiration_context` node config with
  `source_note`/category/price, runs the DAG, and asserts the effective node context reaches `CopySet`, generated image
  input, node output, and run history.
- Unit regression covers `normalize_inspiration_context_config(...)`: `source_note` fills `long_text`, `entry_type` accepts
  only `image/copy/tail/blank`, `long_text` / `source_note` enforce the 50,000-character Markdown text limit, and
  `dynamic_fields` accepts only one-level scalar values.
- API regression covers inspiration creation with Markdown long text above the old 4,000-character limit and rejection above
  the 50,000-character limit.
- API regression uploads context documents through `POST /api/workflow-nodes/{node_id}/document`, asserting config/output
  document fields, `context_document` SourceAsset persistence, UTF-8 failure, and unsupported extension failure.
- API regression uploads a context image through `POST /api/workflow-nodes/{node_id}/image` and asserts the asset kind is
  `context_image`, `image_source_asset_id` replaces legacy image config keys, and downstream copy/image context can consume
  it without treating documents as images.
- API regression rejects creating a second `inspiration_context` node and verifies opening an active workflow normalizes duplicate
  inspiration-context nodes down to one.
- API regression deletes downstream reference nodes and runs an image node directly, asserting a failed run/node with the
  clear connect-a-target message and no silent image output on the image node.
- API regression for node-first canvas creates/uses a `reference_image` node, uploads an image, connects it to
  `image_generation`, connects image generation to multiple downstream `reference_image` slots, runs the workflow, and
  asserts generated poster IDs, filled source asset IDs, size, and slot output are persisted.
- API regression for multi-target image generation asserts multiple downstream reference slots are filled and provider
  generation calls are initiated concurrently while database writes remain in the owning session.
- API/provider regression for generated-mode workflow image nodes asserts `output_json.provider_results` contains only
  compact provider summary fields such as `provider_name`, `model_name`, `provider_response_id`,
  `provider_response_status`, `actual_size`, and provider compatibility notes. Do not persist raw provider request bodies,
  full provider output JSON, prompts, API keys, or base URLs in workflow node output.
- API/provider regression asserts a real image-purpose binding overrides stale `poster_generation_mode=template`, uses the
  injected image provider dependency seam, bypasses `PosterRenderer`, and persists a `workflow:<provider>:...`
  `PosterVariant.template_name`.
- API regression uploads twice to the same `reference_image` node and asserts the node exposes only the second asset while
  both old and new `source_assets` remain on the inspiration. Another regression fills an already populated reference node from
  an upstream `image_generation` node and asserts the same single-slot replacement behavior.
- API regression binds a reference node from an existing `source_asset_id` and asserts no duplicate SourceAsset is created;
  another regression binds from a `poster_variant_id` and asserts the poster materializes or maps to a reference SourceAsset.
- API/provider regression connects a `reference_image` node into `copy_generation` and asserts the reference label/role
  reaches generated copy/provider input.
- API regression edits a generated copy node through `PATCH /api/workflow-nodes/{node_id}/copy` and asserts both the
  persisted `CopySet` and node output summary fields are updated.
- API regression for selected-node runs creates successful upstream outputs, runs a downstream node, and asserts upstream
  node runs/artifacts are not duplicated when reusable outputs exist, including image-node outputs that expose
  `generated_poster_variant_ids`.
- API regression for selected reference-slot runs connects an already successful image node to a new empty
  `reference_image` slot and asserts only the necessary image node plus target slot run; copy generation must not re-run.
- Unit regression for workflow domain rules covers selected-node planning / missing-upstream decisions without creating a
  SQLAlchemy session.
- API regression edits a previously run `inspiration_context` node, then directly runs a downstream node and asserts the
  downstream output context summary uses the latest saved config rather than stale context output.
- API regression asserts upstream copy text and reference-image label/role metadata appear in deterministic context sources
  for image generation.
- API/provider regression asserts the default `inspiration_context -> image_generation` edge contributes the inspiration source
  image to image-generation context, so `context_summary.reference_image_count` does not report `0` when the inspiration image
  is connected through the inspiration-context node, and that copy-linked runs expose `copy_prompt_mode = "copy"`.
- API/provider regression deletes the direct `inspiration_context -> image_generation` edge while retaining
  `inspiration_context -> copy_generation -> image_generation`, then directly runs the image node and asserts the provider
  still receives inspiration fields plus the inspiration source image. A separate regression must keep the disconnected blank
  image-generation path free-form.
- API/provider regression removes the copy node or otherwise runs an image node with no explicit copy link and asserts the
  provider receives `PosterGenerationInput.copy_prompt_mode = "image_edit"` while generated artifacts still have a
  `copy_set_id` for persistence.
- Alembic head upgrade must pass on SQLite after adding workflow tables.

### 7. Wrong vs Correct

#### Wrong

```python
node.output_json = {"document_source_asset_id": asset.id}
```

This loses the text extraction needed by downstream nodes and makes direct selected-node runs depend on a separate
document read path.

#### Correct

```python
node.config_json = normalize_inspiration_context_config(
    {
        **node.config_json,
        "document_source_asset_id": asset.id,
        "document_filename": filename,
        "document_mime_type": content_type,
        "document_text": document_text,
    }
)
node.output_json = inspiration_context_output(workflow.inspiration, node, workflow=workflow)
```

Store the document resource id and the decoded UTF-8 text at the node boundary so downstream context collection is
deterministic.

#### Wrong

```python
node.output_json = {"copy": copy_payload.model_dump()}
```

This hides the artifact in opaque JSON only; later history cannot reliably reuse it.

#### Correct

```python
session.add(copy_set)
session.flush()
node.output_json = {"copy_set_id": copy_set.id, "summary": copy_set.structured_payload["summary"]}
```

Persist the first-class artifact, then keep only workflow-boundary references and summaries in JSON.

#### Wrong

```python
posters = [poster for poster in workflow.inspiration.poster_variants if poster.id in poster_ids]
```

During one DAG run, relationship collections can be stale after an upstream node has just created new artifacts.

#### Correct

```python
posters = session.scalars(select(PosterVariant).where(PosterVariant.id.in_(poster_ids))).all()
```

For downstream nodes, query first-class artifacts by ID so same-run outputs are visible.

#### Wrong

```python
execution_nodes = ancestors(start_node) | {start_node}
```

This makes every selected-node run regenerate upstream copy/images even when the user only wants to refresh one downstream
node, wasting provider calls and replacing previously accepted artifacts.

#### Correct

```python
execution_nodes = missing_required_dependencies(start_node) | {start_node}
```

For selected-node runs, treat successful upstream nodes with valid `CopySet`, `PosterVariant`, or `SourceAsset` records as
read-only context. Re-run an upstream dependency only when the target cannot be satisfied from existing first-class
artifacts, such as a newly connected empty `reference_image` slot that needs its upstream image node to fill it.

## Scenario: AI provider scalar payload normalization

### 1. Scope / Trigger

- Trigger: any change to AI text provider payload parsing for creative briefs, generated copy, or workflow copy-node
  execution.
- This is a cross-layer contract because provider JSON is parsed into application contracts, persisted into
  `creative_briefs` / `copy_sets`, emitted through workflow node `output_json`, and consumed by frontend typed DTOs.

### 2. Signatures

- Application contracts:
  - `CreativeBriefPayload(positioning: str, audience: str, selling_angles: list[str], taboo_phrases: list[str], poster_style_hint: str)`.
  - `CopyPayloadV2(version: 2, purpose: str | None, summary: str, content: CopyContent, visual_guidance: VisualGuidance | None)`.
  - `PosterGenerationInput(..., structured_copy_context: str | None = None)`.
- Text provider methods:
  - `TextProvider.generate_brief(inspiration: InspirationInput) -> tuple[CreativeBriefPayload, str]`.
  - `TextProvider.generate_copy(inspiration: InspirationInput, brief: CreativeBriefPayload, config: CopyNodeConfigV2, reference_images: list[ReferenceImageInput] | None = None) -> tuple[CopyPayloadV2, str]`.
- Persistence/API boundary:
  - `CreativeBrief.payload` and workflow `latest_brief.payload` must expose scalar brief fields as strings.
  - `CopySet.structured_payload` and `CopySet.model_structured_payload` persist the v2 payload.

### 3. Contracts

- AI providers may occasionally return a pure text array for a scalar short-text field. The application contract boundary
  may normalize only these scalar fields by joining items with `、`:
  - `CreativeBriefPayload.positioning`
  - `CreativeBriefPayload.audience`
  - `CreativeBriefPayload.poster_style_hint`
- Fields whose contract is already a list must remain lists and must not be flattened into one scalar:
  - `CreativeBriefPayload.selling_angles`
  - `CreativeBriefPayload.taboo_phrases`
- V2 content supports `freeform`, `blocks`, and `layout_brief`. Optional fields such as block `label`, `role`,
  `visual_hint`, and visual guidance must remain optional so the model is not forced to invent fields that the task does not
  need.
- `copy_node_output(...)` exposes `structured_payload` and `summary` for copy content. It must not expose
  fixed copy-field output keys.
- Image-generation prompt context should set `PosterGenerationInput.structured_copy_context` from
  `copy_payload_context_text(normalize_copy_payload(copy_set.structured_payload))`.

### 4. Validation & Error Matrix

- Scalar field is a normal string -> accepted unchanged.
- Scalar field is a non-empty list of non-empty strings -> normalized to a single string joined by `、`.
- Scalar field is an empty list -> Pydantic `ValidationError`; do not silently store an empty string.
- Scalar field list contains an empty/blank string -> Pydantic `ValidationError`.
- Scalar field list contains an object, number, boolean, or `null` -> Pydantic `ValidationError`; do not coerce with
  `str(...)`.
- `CopyPayloadV2.content.kind` is not `freeform`, `blocks`, or `layout_brief` -> Pydantic `ValidationError`.
- `CopyPayloadV2.summary` is blank -> Pydantic `ValidationError`.
- V2 block/freeform/section text is empty where required -> Pydantic `ValidationError`.
- Other list-contract fields are not lists or violate min/max length -> Pydantic `ValidationError`.

### 5. Good/Base/Bad Cases

- Good: provider returns `{"audience": ["摄影入门用户", "图文内容创作者"]}`; persisted and API-visible payload uses
  `"摄影入门用户、图文内容创作者"`.
- Good: provider returns `{"version":2,"summary":"卖点速览","content":{"kind":"blocks","blocks":[...]}}`; `CopySet.structured_payload` stores the blocks, and downstream image context reads the structured payload text.
- Good: provider returns `content.kind="layout_brief"` for information hierarchy; downstream image context receives the
  section text and visual hints instead of fixed copy fields.
- Base: provider returns scalar strings for all scalar fields; values pass through unchanged.
- Bad: provider returns `{"audience": []}` or `{"audience": [{"name": "摄影入门用户"}]}`; validation fails instead of
  inventing a display string.
- Bad: adding a new copy node template that only stores `instruction/tone/channel` without `version: 2` and
  `output_mode`; templates must seed the v2 config so old shape cannot keep accumulating.

### 6. Tests Required

- Contract regression directly validates `CreativeBriefPayload` with scalar text arrays and malformed arrays; assert good
  arrays are joined with `、` and bad arrays raise `ValidationError`.
- Contract regression validates `CopyPayloadV2` with `freeform`, `blocks`, and `layout_brief`.
- Copy-generation workflow regression monkeypatches the text provider to return scalar arrays and asserts the persisted
  `CreativeBrief.payload` fields are normalized strings while `CopySet` persists structured payloads.
- Copy-generation workflow regression asserts copy-node `output_json.structured_payload.version == 2` and does not expose
  fixed copy-field output keys.
- Canvas-template regression asserts every built-in `copy_generation` node config includes v2 `version`, `purpose`, and
  `output_mode`.
- Inspiration workflow DAG regression runs `POST /api/inspirations/{inspiration_id}/workflow/run` with provider scalar arrays and
  asserts copy-node `output_json` and inspiration `latest_brief.payload` expose normalized strings.

### 7. Wrong vs Correct

#### Wrong

```python
payload = response_json
if isinstance(payload["audience"], list):
    payload["audience"] = str(payload["audience"])
```

This leaks Python/JSON list formatting into persisted copy and hides malformed provider output.

#### Correct

```python
CreativeBriefPayload.model_validate(response_json)
```

Keep normalization and malformed-shape rejection inside the application contract validators so all provider entrypoints
and workflow runs share the same behavior.

## Scenario: OpenAI-compatible text response extraction

### 1. Scope / Trigger

- Trigger: any change to `OpenAITextProvider` response parsing for `generate_brief` or `generate_copy`.
- Some OpenAI-compatible `/v1/responses` endpoints return a server-sent-event text body even for non-streaming SDK calls.
  In that case the SDK result may be a plain `str`, not a `Response` object.

### 2. Signatures

- `OpenAITextProvider._read_output_json(response: object) -> dict`.
- Supported response text sources:
  - `response.output_text` for normal OpenAI SDK `Response` objects.
  - Plain string JSON returned by compatible clients.
  - SSE `data:` records whose event/type is `response.output_text.delta`.
  - `response.model_dump(...).output[].content[].text` as a defensive SDK-object fallback.

### 3. Contracts

- The extraction step returns text only; JSON parsing and `CreativeBriefPayload` / `CopyPayloadV2` validation remain the
  next contract boundary.
- SSE extraction must concatenate only `response.output_text.delta` string chunks in order.
- Empty extracted text must continue to fail as `ValueError("文案 provider 未返回 JSON 对象：<empty>")`.
- Do not log full prompts, raw SSE payloads, provider responses, or API keys while diagnosing this path.

### 4. Validation & Error Matrix

- SDK `Response.output_text` contains JSON -> parse that JSON.
- Compatible endpoint returns plain JSON string -> parse that JSON string.
- Compatible endpoint returns SSE text with output deltas -> concatenate deltas, then parse JSON.
- SSE text has no output-text deltas and is not JSON -> raise `ValueError` with a short snippet.
- Extracted text is non-empty but malformed JSON -> try the existing embedded-object extraction before raising.

### 5. Good/Base/Bad Cases

- Good: `event: response.output_text.delta` chunks combine into `{"version":2,...}` and copy generation succeeds.
- Base: official SDK object exposes `output_text`; no SSE parsing is needed.
- Bad: reading only `getattr(response, "output_text", "")`, because a plain `str` response becomes `<empty>`.
- Bad: parsing every SSE `data:` payload as content; lifecycle events such as `response.completed` are not text deltas.

### 6. Tests Required

- Provider regression with an SSE string containing multiple `response.output_text.delta` chunks, asserting
  `_read_output_json(...)` returns the combined JSON object.
- Keep provider payload tests covering prompt settings, scalar normalization, and workflow copy output shape green.

### 7. Wrong vs Correct

#### Wrong

```python
text = getattr(response, "output_text", "").strip()
```

This treats compatible SSE string responses as empty output.

#### Correct

```python
text = _response_output_text(response)
payload = json.loads(text)
```

Centralize text extraction before JSON parsing so every text provider method supports the same response shapes.

## Scenario: Async workflow runs and deletion safety

### 1. Scope / Trigger

- Trigger: any change to workflow run kickoff/execution, active-run locking, workflow node deletion, or inspiration deletion
  while workflow/job state may still be active.
- This is a cross-layer and database-backed contract because it spans API responses, background execution, run/node status
  persistence, database uniqueness, frontend polling, and storage cleanup.

### 2. Signatures

- APIs:
  - `POST /api/inspirations/{inspiration_id}/workflow/run` returns `InspirationWorkflowResponse` after creating or reusing an active
    `workflow_runs` row; it must not wait for provider execution to finish.
  - `POST /api/inspirations/{inspiration_id}/workflow/runs/{run_id}/cancel` returns `InspirationWorkflowResponse` after durably
    marking an active run `cancelled`.
  - `POST /api/inspirations/{inspiration_id}/workflow/runs/{run_id}/retry` returns `202 Accepted` after creating/enqueueing a new
    run from a failed run.
  - `POST /api/inspirations/{inspiration_id}/workflow/failed-nodes/retry` returns `202 Accepted` after creating/enqueueing one new
    run for every currently failed, non-cancelled, retryable node on the canvas.
  - `DELETE /api/workflow-nodes/{node_id}` returns `InspirationWorkflowResponse` after deleting the node and connected edges.
  - `DELETE /api/inspirations/{inspiration_id}` returns `204 No Content` after deleting the inspiration and related persisted data.
- Application entrypoints:
  - `start_inspiration_workflow_run(session, inspiration_id, start_node_id=None) -> WorkflowRunKickoff`.
  - `submit_failed_workflow_nodes_run(session, inspiration_id) -> InspirationWorkflow`.
  - `execute_inspiration_workflow_run(run_id) -> None`.
  - `delete_workflow_node(session, node_id) -> InspirationWorkflow`.
  - `delete_inspiration(session, inspiration_id) -> str`.
- Runtime config key `workflow_node_max_retry_count` controls how many direct retries a failed workflow node may receive;
  default is 10, the valid range is 0..100, and node `is_retryable`/`non_retryable_reason` must use the effective runtime
  value.
- Runtime config key `workflow_node_retry_delay_ms` controls the cooldown after a node failure before direct node retry is
  allowed; default is 2000, the valid range is 0..3600000, and it belongs to `全局生成配置 / 工作流生成` with
  `workflow_node_max_retry_count`.
- Database:
  - `workflow_node_runs` must enforce at most one active row per `node_id` where `status IN ('queued', 'running')`,
    using a partial unique index such as `uq_workflow_node_runs_one_active_per_node`.
  - `workflow_runs` may contain multiple `status = 'running'` rows for the same `workflow_id` when their active
    node-run sets are disjoint.

### 3. Contracts

- Run kickoff is a durable two-step contract:
  1. create/reuse a persisted `running` run plus `queued` node runs and immediately return the refreshed workflow;
  2. enqueue that `workflow_run_id` through Dramatiq/Redis with `enqueue_workflow_run(...)`;
  3. the `run_inspiration_workflow_run` actor executes the selected nodes in a background execution boundary that opens its
     own database session.
- `workflow_runs` is the authoritative state for workflow execution. Redis/Dramatiq messages are recoverable delivery
  attempts; do not use in-process executors or Web-process memory as the source of truth.
- Manual cancel is a durable run-level transition to `cancelled` with `failure_reason = "已取消"`. Queued node runs are
  released back to idle node state; a running node run is marked failed with the same cancel reason because node statuses
  intentionally keep the existing five-value contract.
- Failed workflow runs are retryable through a new run. Retry must not create a duplicate run while any active run already
  owns a queued/running node run in the retry plan.
- Failed workflow nodes are retryable independently from historical run-level retry. Batch failed-node retry must collect
  the current canvas nodes with `status = failed` and `failure_reason != "已取消"`, reject the whole request if any selected
  failed node is not retryable, and create one run with `progress_metadata.run_mode = "failed_nodes"`,
  `manual_retry = true`, and sorted `retry_node_ids`.
- A retryable failed node must remain temporarily non-retryable until the latest real failed node run (`failure_reason !=
  "上游节点失败"`) has aged past `workflow_node_retry_delay_ms`. The serialized node should expose a temporary reason like
  `节点失败后需等待 1234ms 后重试`.
- Run responses and lightweight status responses expose `is_retryable`, `is_cancelable`, `queue_active_count`,
  `queue_running_count`, `queue_queued_count`, `queue_max_concurrent_tasks`, `queued_ahead_count`, and `queue_position`.
  Queue position for workflow runs is derived from queued node-run state, not Redis delivery metadata.
- API startup must call workflow run recovery for active runs with no node currently running, so a run committed before a
  Redis send or process restart is sent again.
- Worker startup may reset stale `workflow_node_runs.status = 'running'` rows back to `queued` before re-enqueueing their
  parent run. Do not reset recent running nodes on API startup because another worker may still be executing them.
- Duplicate kickoff for the same active node set must return the existing active workflow/run state or be caught by the
  node-run database uniqueness guard and converted back into `created=False`; it must not silently create duplicate
  provider calls for the same node.
- Kickoff for a selected node set that is disjoint from every active run's queued/running node runs may create a separate
  `running` workflow run for the same workflow. A full-workflow kickoff overlaps every node and therefore still reuses an
  existing active run when any node is active.
- Duplicate Redis messages must be idempotent:
  - terminal workflow runs (`succeeded` / `failed` / `cancelled`) are no-ops;
  - runs that already have a non-stale `running` node run are no-ops;
  - claiming a queued node run must be an atomic conditional update on both `WorkflowNodeRun.id` and
    `WorkflowNodeRun.node_id` so two workers cannot execute the same provider call or claim a stale message for another
    node.
- Background execution must persist every decisive transition: node run `queued -> running -> succeeded/failed`, node
  status, workflow run `succeeded/failed`, output JSON, artifact IDs, `failure_reason`, and `finished_at`.
- Any exception inside or around the background execution boundary must mark the run `failed`; do not leave a stale
  `running` row that causes indefinite frontend polling.
- If all global generation running slots are occupied when a workflow worker tries to claim the next queued node run, the
  worker must leave that node run `queued`, avoid provider calls, and schedule delayed delivery retry. Starting the run
  itself should still succeed and show queued metadata instead of returning a submit-time busy error.
- Generated-mode workflow image provider calls must be bounded by
  `workflow_image_generation_provider_timeout_seconds`; timeout or provider failure must fail the run/node with a stable
  safe user-facing reason and must not persist provider keys, base URLs, raw prompts, request bodies, or tracebacks in
  `failure_reason`.
- The `run_inspiration_workflow_run` Dramatiq actor must keep `max_retries=0` and an internal worker failsafe `time_limit`;
  the application execution boundary remains responsible for durable failure state.
- Node deletion must remove connected incoming/outgoing edges and existing `workflow_node_runs` for that node before
  returning the refreshed workflow.
- Inspiration deletion must refuse active workflow runs, then rely on ORM/database cascade for related rows and
  perform best-effort storage tree cleanup after the database delete commits.

### 4. Validation & Error Matrix

- Missing inspiration/workflow/node -> `404`.
- Starting a run whose planned node set overlaps an active run's queued/running node runs -> return existing active
  workflow state; do not create duplicate active node runs.
- Starting a selected-node run whose planned node set is disjoint from active node runs -> create/enqueue a separate
  `running` workflow run for the same workflow.
- Cancelling an active run -> persist `status = 'cancelled'`, set `finished_at`, release queued nodes from queued/running
  UI state, and make duplicate worker delivery a no-op.
- Cancelling a terminal succeeded/failed run -> `400`, `已结束的工作流运行不能取消`.
- Retrying a failed run while no active run exists -> create/enqueue a new run and keep the failed run retryable in
  history.
- Retrying while another active run owns any retry-plan node -> `400`, `相关节点运行中，不能重试`.
- Retrying all failed nodes when there are no failed non-cancelled nodes -> `400`, `画布没有可重新运行的失败节点`.
- Retrying all failed nodes when any failed node exceeded `workflow_node_max_retry_count` or the latest failure is
  non-retryable -> `400`, `存在不可重试的失败节点，请调整节点设置或全局重试次数后重试`.
- A node that reaches the runtime retry limit must serialize `is_retryable = false` and a reason like
  `节点失败重试次数已达上限（10）`.
- A retryable failed node inside the runtime retry-delay window must serialize `is_retryable = false` and a retry-delay
  reason; after the window expires, serialization and run submission should treat it as retryable again unless another
  non-retryable condition applies.
- Concurrent duplicate active node-run insert hits the partial unique index -> rollback, reload existing overlapping
  active run, return it.
- Global running capacity full during worker claim -> keep the workflow run `running`, keep the next node run `queued`, do
  not call providers, and enqueue delayed retry of the same `workflow_node_run_id`.
- Redis enqueue failure after the run has been created -> mark the run `failed`, release active node-run uniqueness slots,
  and return `503` with `任务队列暂不可用，请稍后重试`.
- Workflow image provider timeout -> mark the active run and image node run `failed`, set `finished_at`, use
  `图片生成超时，请稍后重试`, and release global generation queue capacity.
- Workflow image provider failures with recognized safe categories should not collapse into one generic message. Use
  concise user-facing reasons for rate limit/quota, content-policy refusal, connection interruption, provider request
  timeout, unsupported parameters, and provider 5xx/service failure; inspect wrapped exception causes/contexts when the
  outer provider layer uses a generic request-failure message.
- Workflow image provider failure with safe details such as unsupported dimensions -> mark failed with a concise prefixed
  reason such as `图片生成失败：image2 不支持 64x64，最小尺寸为 512x512`.
- Workflow image provider failure with raw provider details -> mark failed with a generic safe reason such as
  `图片生成失败，请稍后重试`; never expose secrets, base URLs, prompt payloads, request bodies, file paths, or tracebacks
  through `failure_reason`.
- Workflow image provider success may persist a compact `output_json.provider_results` summary for UI logs, but this is
  not a live progress channel. Real-time provider progress requires durable workflow node-run progress fields; do not fake
  ImageChat-style `provider_response_status` polling from stale terminal output.
- Duplicate Redis message for terminal run -> no-op and do not call providers.
- Duplicate Redis message while another worker owns a non-stale running node -> no-op and do not call providers.
- Delete a node while its workflow has an active run, or while the node is `queued` / `running` -> `400` with
  `运行中，稍后删除`.
- Delete a inspiration while any related job is `queued` / `running` -> `400` with `灵感产物任务运行中，稍后删除`.
- Delete a inspiration while any related workflow run is `running` -> `400` with `灵感产物工作流运行中，稍后删除`.
- Missing storage files during inspiration deletion -> ignore for storage cleanup; the database deletion remains authoritative.

### 5. Good/Base/Bad Cases

- Good: `POST /workflow/run` returns quickly with `runs[0].status == "running"` and queued node statuses; polling later
  observes success/failure written by `execute_inspiration_workflow_run`.
- Good: two duplicate run requests for the same selected node result in one active run and one provider execution path.
- Good: two selected-node run requests for graph-disjoint nodes can create two active workflow runs, while the database
  still prevents the same node from being queued/running twice.
- Good: deleting a workflow node removes that node plus connected edges, and a refreshed workflow response contains no
  broken edge references.
- Base: deleting a inspiration with completed workflow history cascades workflow rows and then best-effort removes
  `storage/inspirations/{inspiration_id}`.
- Bad: leaving run execution inside the request handler blocks the frontend and hides intermediate committed status.
- Bad: checking active runs only in application code without a database uniqueness guard allows races in concurrent or
  multi-process deployments.

### 6. Tests Required

- API regression for run kickoff asserts the initial response is `running` / `queued`, then waits/polls until the
  background execution writes terminal status and artifacts.
- Duplicate active-node regression asserts a second kickoff for the same planned node set returns/reuses the same active
  run and that direct duplicate node-run insertion violates the unique active-node guard.
- Disjoint active-node regression asserts two selected-node kickoffs with no shared required nodes create distinct running
  workflow runs.
- Failure-path regression should force execution failure and assert stale `running` runs are marked `failed`.
- Workflow image-generation regressions should cover provider timeout cleanup, safe provider-failure reason sanitization,
  and the `run_inspiration_workflow_run` actor failsafe `time_limit`.
- Durable delivery regressions should assert kickoff sends a Dramatiq workflow message, enqueue failure returns `503` and
  leaves no stranded active run, startup recovery requeues queued workflow runs, stale running node runs are reset only on
  worker recovery, and duplicate messages no-op for terminal/currently-running runs.
- Node deletion regression asserts connected edges and node runs are removed and active-run deletion is rejected.
- Inspiration deletion regression asserts completed inspirations are deleted, direct detail fetch returns `404`, and active
  workflow runs block deletion with the expected concise error.
- Alembic upgrade must replace the workflow-level active-run unique index with the active node-run unique index and first
  close historical duplicate queued/running node-run rows if present. Downgrade must close duplicate running workflow runs
  before restoring the workflow-level unique index.

### 7. Wrong vs Correct

#### Wrong

```python
workflow = run_inspiration_workflow(session, inspiration_id=inspiration_id)
return serialize_inspiration_workflow(workflow)
```

This keeps provider execution inside the HTTP request; the frontend sees a long pending mutation and cannot observe
intermediate node status until the request finishes.

#### Correct

```python
kickoff = start_inspiration_workflow_run(session, inspiration_id=inspiration_id)
if kickoff.created:
    enqueue_workflow_run(kickoff.run_id)
return serialize_inspiration_workflow(kickoff.workflow)
```

Persist the run state first, return quickly, and let the frontend poll the persisted workflow state.

#### Wrong

```python
if _active_workflow_run(workflow):
    return workflow
session.add(WorkflowRun(workflow_id=workflow.id, status=WorkflowRunStatus.RUNNING))
session.commit()
```

The workflow-level check blocks disjoint node runs and can still race with another request before commit.

#### Correct

```python
Index(
    "uq_workflow_node_runs_one_active_per_node",
    "node_id",
    unique=True,
    postgresql_where=text("status IN ('queued', 'running')"),
    sqlite_where=text("status IN ('queued', 'running')"),
)
```

Plan the node IDs first, reuse only overlapping active runs for normal control flow, enforce the same-node active invariant
in the database, and handle `IntegrityError` by reloading the existing overlapping active run.

## Scenario: Workflow node-group duplicate

### 1. Scope / Trigger
- Trigger: changes to canvas copy/paste, node-group duplicate routes, reusable node config sanitization, or undo restore of
  deleted workflow nodes.
- Node-group duplication creates ordinary workflow rows for repeated workbench modules without reusing generated artifacts
  or run state.

### 2. Signatures
- API: `POST /api/inspirations/{inspiration_id}/workflow/node-groups/duplicate -> InspirationWorkflowResponse`.
- Request fields:
  - `node_ids: list[str]`
  - `position_x: int | None`
  - `position_y: int | None`
  - `offset_x: int`
  - `offset_y: int`
- Application use case returns the refreshed active `InspirationWorkflow`.

### 3. Contracts
- Duplicate operates only on nodes in the inspiration's active workflow.
- `inspiration_context` nodes are never duplicated. If the selected group contains only inspiration context nodes, the request is
  invalid.
- Duplicated nodes keep node type, title, relative position, and normalized editable `config_json`.
- Duplicated nodes start with idle/default run state and empty outputs. Do not copy `output_json`, failure reason,
  `last_run_at`, workflow-node-run rows, workflow-run rows, `CopySet`, `PosterVariant`, `SourceAsset`, image-session
  assets, or gallery artifacts.
- Internal edges are recreated only when both source and target are duplicated. External edges to unselected nodes are not
  recreated.
- Reusable config sanitization must match user-template boundaries: strip known artifact fields and reject unknown
  artifact-shaped config keys ending in `_id`, `_ids`, `_url`, or `_path`.
- The insertion position may be anchored to a requested point or use a deterministic offset from the selected group.

### 4. Validation & Error Matrix
- Empty `node_ids` -> `400` with a concise selection-required message.
- Duplicate node ids in request -> `400` with duplicate selection message.
- Unknown inspiration or no active workflow -> existing inspiration/workflow not-found behavior.
- Node outside active workflow -> `400` with current-canvas ownership message.
- Selected group contains no duplicable node after excluding `inspiration_context` -> `400`.
- Sanitization finds artifact-shaped config -> `400` with reusable-config validation message.

### 5. Good/Base/Bad Cases
- Good: duplicate a copy -> image -> reference chain and get three new nodes plus two internal edges.
- Good: duplicate a filled reference node and preserve reusable `role` / `label` while dropping asset ids and output JSON.
- Base: duplicate a group selected with the inspiration context plus copy/image nodes; only copy/image nodes are recreated.
- Bad: duplicate a node with `output_json.copy_set_id` or `source_asset_ids` and make the new node appear already
  generated.
- Bad: recreate edges from the copied group back to original unselected nodes, which changes the user's graph topology.

### 6. Tests Required
- API regression for duplicating selected nodes with internal edges.
- Regression that `inspiration_context` is skipped and a inspiration-context-only selection is rejected.
- Regression that output JSON, run state, run rows, and artifact-shaped config are not copied.
- Regression that duplicated nodes are selected/usable through normal frontend workflow payloads.

### 7. Wrong vs Correct

Wrong:

```python
new_node = WorkflowNode(**old_node.__dict__)
```

This copies database identity, output/run fields, and artifact references.

Correct:

```python
new_node = WorkflowNode(
    workflow_id=workflow.id,
    node_type=old_node.node_type,
    title=old_node.title,
    config_json=_extract_reusable_config(old_node),
)
```

Create a fresh workflow node from reusable intent only, then recreate selected internal edges.

---

## Scenario: Tail splitter confirmation without auto-run

### 1. Scope / Trigger
- Trigger: changes to `tail_splitter` node execution, split-plan output shape, split-plan apply endpoint, or workflow
  run orchestration when a run crosses a tail node.
- This scenario captures graph-expansion and waiting-confirmation behavior so tail runs do not drift back into hidden
  auto-apply or auto-run logic.

### 2. Signatures
- Workflow node type includes `tail_splitter`.
- Workflow run status includes `waiting_confirmation`.
- Run API: `POST /api/inspirations/{inspiration_id}/workflow/run`.
  - `start_node_id?: str`
  - `start_mode?: "from_node" | "after_node"`, default `"from_node"`.
- Apply API: `POST /api/workflow-nodes/{node_id}/tail-split-plan/apply`.
  - `plan_id: str`
  - `item_ids?: list[str]` for legacy clients.
  - `items?: list[{id: str, instruction?: str | null}]`; when present, this takes precedence over `item_ids`.
  - `image_generation_config?: {size?: str | null, generation_config_mode?: "auto" | "manual",
    generation_config_id?: str | null, tool_options?: dict | null}`; when present, every created `image_generation` node
    receives the same normalized base generation config.
  - `reuse_public_copy_node?: bool`, default `false`.
  - `reuse_public_reference_node?: bool`, default `false`.
- Runtime config key `generation_tail_splitter_max_items` controls the maximum allowed tail `max_items`; the default is
  36 and validation errors must report the effective configured limit.
- Tail `max_items` is an upper bound only. Provider prompts and mock providers must choose a reasonable item count from the
  actual source text, upstream context, and reference images, and must not force the model to output exactly `max_items`.
- Tail node `output_json` contains:
  - `latest_plan` with `plan_id`, `status`, `items`, and metadata.
  - `applied_batches` with only the latest confirmed batch, `batch_id`, source `plan_id`, and created node metadata.
- Running `WorkflowRun.progress_metadata` may contain `pending_tail_confirmations`, each with `tail_node_id`, `plan_id`,
  and `node_run_id`.

### 3. Contracts
- Tail execution is plan-generation only: running a tail node persists/refreshes a pending `latest_plan` and does not
  create workflow nodes or edges by itself.
- A run that has no queued/running node runs but has pending tail confirmations must stay `waiting_confirmation`, not
  `succeeded`.
- `waiting_confirmation` is user-active for overlap protection, cancellation, deletion blocking, and workflow status
  polling. It is not durable-generation active for capacity accounting or queue recovery.
- `start_mode="after_node"` plans only the downstream closure of `start_node_id` and excludes the start node itself.
- Tail split-plan apply accepts only a tail node with a pending `latest_plan` that matches request `plan_id`; at least one
  plan item must be selected. If `items` is supplied, every selected item instruction must be non-blank after trimming.
- Saving or executing a tail node must validate `config_json.max_items` against
  `get_runtime_settings().generation_tail_splitter_max_items`; do not encode a static upper bound in
  `TailSplitterConfig` or frontend inputs.
- Tail provider payloads may pass `max_items`, but prompt wording must say it is a maximum. Do not instruct the model to
  fill all slots when the content only supports fewer independent image directions.
- Tail config parsing must tolerate legacy nullable fields by normalizing `source_text` / `description` to `""`,
  `max_items` to the default, and blank/null `generation_config_mode` to `"auto"`. Truly invalid values must surface
  field-specific Chinese messages such as `最大拆分数必须是整数` or `生成配置模式必须是 auto 或 manual`, not the generic
  `尾巴节点配置无效，请调整节点设置后重试`.
- Applying a tail plan creates ordinary persisted workflow nodes and edges in one transaction:
  - one public `copy_generation` node and one public `reference_image` node for shared constraints/visual input;
  - one `image_generation` node plus one output `reference_image` node per selected plan item;
  - edges `tail_splitter -> image_generation`, public copy/reference to each `image_generation`, and each
    `image_generation -> output reference_image`.
- Tail apply image config must be normalized through the same image size/tool-option rules used by normal image-generation
  nodes. Invalid or disabled provider-specific `tool_options` fields must be filtered instead of persisted on created
  nodes.
- Do not create `tail_splitter -> public copy` or `tail_splitter -> public reference` edges. Public copy/reference nodes are
  independent helper inputs for generated image nodes.
- Created nodes must carry `generated_by` metadata with at least `tail_node_id`, `plan_id`, `batch_id`, and role/item
  fields so later cleanup can target only generated branches.
- Successful apply first removes the previous generated branch for the same tail, marks `latest_plan.status = "applied"`,
  replaces `applied_batches` with the latest batch, creates the selected nodes/edges as idle editable graph structure, and
  removes the matching pending confirmation. It must not create queued node runs for generated nodes and must not enqueue
  the waiting run only because a split plan was confirmed.
- If `reuse_public_copy_node` or `reuse_public_reference_node` is true, apply may preserve the previous generated public
  copy/reference node for the same tail and connect it to the newly created `image_generation` nodes. Preserved public
  nodes keep their existing config, status, and output artifacts; all old per-item image/output nodes and old edges are
  still removed. The new `applied_batches[0].node_ids` must include reused public node ids so a later apply can clean them
  unless they are selected for reuse again.
- After apply, the original waiting run resolves from the remaining durable state: if other node runs are already
  queued/running it stays or returns `running`; if other pending tail confirmations remain it stays
  `waiting_confirmation`; otherwise it becomes `succeeded` with `finished_at` set. Generated nodes remain `idle` until a
  later explicit run.
- A later manual `POST /api/inspirations/{inspiration_id}/workflow/run` with `start_node_id=<tail_node_id>` and
  `start_mode="after_node"` may execute the generated branch. Scheduler dispatch must claim all independent ready
  generated branches in the same ready wave, subject only to the existing global capacity gate.
- If a run includes a tail node, its old generated branch must be excluded from that run plan until the new plan is
  confirmed. This prevents stale downstream image nodes from running before confirmation.
- Multiple tail nodes may each append a pending confirmation. Confirming one plan must not remove unrelated pending tail
  confirmations.
- Independent branches should keep executing while another branch is waiting for tail confirmation; waiting tail state is
  not upstream failure propagation.
- Tail cleanup during confirmation must never delete manual nodes/edges that lack matching tail batch metadata.
- RBAC boundary: workflow run requires `inspirations:generate`; tail split-plan apply requires `inspirations:write`.

### 4. Validation & Error Matrix
- Apply called on non-tail node -> `400` with a user-readable tail-node type validation message.
- Apply with missing/stale/non-pending plan -> `400` with pending-plan validation message.
- Apply with no selected valid item -> `400` with split-item selection validation message.
- Apply with `items` containing blank `instruction` -> `400` with split-item instruction validation message.
- Waiting run cancellation -> run and queued/running node runs become cancelled, pending tail metadata is no longer active
  user work.
- Queue recovery sees a `waiting_confirmation` run -> do not enqueue it; explicit plan confirmation resolves the pending
  state but does not auto-enqueue generated work.
- Authenticated user without `inspirations:generate` calling workflow run -> `403`, `{"detail": "没有接口权限"}`.
- Authenticated user without `inspirations:write` calling tail apply -> `403`, `{"detail": "没有接口权限"}`.

### 5. Good/Base/Bad Cases
- Good: full or selected run reaches a tail, writes `pending_tail_confirmations`, and waits until the user confirms a plan.
- Good: user edits selected item instructions in the confirmation payload; generated `image_generation.config_json`
  persists the edited instructions.
- Good: confirming a rerun tail plan deletes the old generated branch, preserves manual nodes, completes the confirmation
  run when no other active work remains, and leaves the latest generated branch idle/editable.
- Good: confirming a rerun tail plan with public-node reuse keeps the previous public copy/reference node outputs while
  rebuilding only the selected image/output branches.
- Good: after confirmation, manually running the tail with `start_mode="after_node"` dispatches independent generated
  image branches in one scheduler wave.
- Base: tail plan can consume upstream copy/reference/image context but still keeps split output as explicit user-visible
  confirmation data.
- Bad: full-run tail execution auto-applies all plan items and reaches `succeeded` without confirmation.
- Bad: split-plan apply immediately creates queued/running node runs for generated image branches.
- Bad: generated public copy/reference nodes receive a direct tail edge and become part of the tail's ordered dependency
  chain.
- Bad: queue recovery treats `waiting_confirmation` as a durable running task and re-enqueues it without user confirmation.

### 6. Tests Required
- Tail execution regression for pending `latest_plan` persistence and schema.
- Apply regression for editable item instructions, selected-item filtering, node/edge creation, and batch metadata
  persistence.
- Apply regression rejecting second apply of the same pending plan.
- Regression proving generated public copy/reference nodes have no tail inbound edge.
- Regression proving tail rerun confirmation deletes the old generated branch while preserving manual nodes.
- Regression proving tail rerun confirmation can preserve previous generated public copy/reference nodes and their
  outputs when reuse flags are true.
- Run regression for `start_mode="after_node"` excluding the start node.
- Run regression for `waiting_confirmation` being user-active but not durable-generation active.
- Run regression for confirming a pending plan completing the waiting run without generated queued/running node runs.
- Run regression for manual `start_mode="after_node"` after tail confirmation dispatching independent generated branches
  in one scheduler wave.
- RBAC regression proving workflow run vs tail apply permission split.

### 7. Wrong vs Correct

#### Wrong

```python
if node.node_type == WorkflowNodeType.TAIL_SPLITTER:
    created = apply_tail_split_plan(node.id, plan_id=node.output_json["latest_plan"]["plan_id"], item_ids=None)
```

This silently mutates the graph during a normal tail run and skips user confirmation and selected-item control.

#### Correct

```python
if node.node_type == WorkflowNodeType.TAIL_SPLITTER:
    plan = execute_tail_splitter(...)
    persist_pending_plan(node, plan)
    append_pending_tail_confirmation(run, tail_node_id=node.id, plan_id=plan.plan_id, node_run_id=node_run.id)
    run.status = WorkflowRunStatus.WAITING_CONFIRMATION
    return
```

Tail run persists a pending plan first; graph expansion happens only through explicit confirmation, and generated branch
execution happens only through a later explicit run such as `start_mode="after_node"`.

---

## Scenario: Inspiration context singleton and direct image generation

### 1. Scope / Trigger
- Trigger: inspiration workflow DAG changes that affect inspiration-context nodes, image-node run prerequisites, or default graph
  shape.

### 2. Signatures
- `POST /api/inspirations/{inspiration_id}/workflow/nodes` rejects `node_type = inspiration_context` when the active workflow already
  has one.
- `POST /api/inspirations/{inspiration_id}/workflow/run` with `start_node_id` pointing at an `image_generation` node requires at
  least one connected downstream `reference_image` target.
- Image-node output with downstream targets contains `generated_poster_variant_ids`, `copy_set_id`, `target_count`,
  `filled_source_asset_ids`, and `filled_reference_node_ids`; it does not expose `poster_variant_ids` as a node-level
  image carrier.

### 3. Contracts
- Each active workflow has exactly one `inspiration_context` node. Runtime opening may normalize older duplicate rows by keeping
  the earliest context node and deleting duplicate context nodes plus their connected edges/node-run rows.
- Default workflows include one inspiration context, one copy node, one image node, and one downstream reference slot. The
  default edge set is `inspiration_context -> copy_generation`, `inspiration_context -> image_generation`,
  `copy_generation -> image_generation`, and `image_generation -> reference_image`.
- Image nodes prefer connected/manual/confirmed copy when present. If absent, the backend creates a draft `CopySet` with
  `provider_name = workflow_context` from inspiration context and the image instruction so `PosterVariant.copy_set_id` remains a
  first-class artifact link.
- Downstream reference slots are required outputs. One image is generated per unique slot and each slot is filled with a
  `SourceAsset`; when absent, no provider call is made and the image node fails with the connect-a-target message.

### 4. Validation & Error Matrix
- Duplicate inspiration-context creation -> `400` with `灵感产物资料节点已存在`.
- Missing/unconnected inspiration source image -> image nodes may still run as blank/free generation when they have a
  downstream reference target and prompt/context; do not fail solely because no inspiration image is connected.
- Missing copy node or missing upstream copy -> create a workflow-context draft `CopySet` if a downstream target exists;
  do not reuse `inspiration.confirmed_copy_set` unless a copy node/config explicitly links it into the image node context.
- Missing downstream reference slot -> fail before generation with the connect-a-target message.
- Duplicate downstream edges to the same reference slot -> one generated image for that unique slot.

### 5. Good/Base/Bad Cases
- Good: selected image-node run after editing inspiration context and image instruction uses the latest saved draft and fills a
  connected downstream reference slot.
- Base: optional copy/reference nodes can be connected and will enrich input/fill slots when present.
- Bad: rendering generated image preview/download on the `image_generation` node itself instead of on filled
  `reference_image` slots.

### 6. Tests Required
- API regression for duplicate inspiration-context rejection.
- API regression for direct image-node run with copy/reference nodes removed.
- Inspiration list regression for source-image thumbnail URL because direct image output is discoverable from list/detail UI.

### 7. Wrong vs Correct
#### Wrong

```python
if copy_set is None:
    raise ValueError("图片生成节点缺少可用文案")
if not downstream_reference_nodes:
    raise ValueError("请先把生图节点连接到至少一个图片/参考图节点，再运行图片生成")
```

#### Correct

```python
if copy_set is None:
    copy_set = _create_context_copy_set(session, inspiration=inspiration, inspiration_context=context, node=node)
targets = downstream_reference_nodes
```
