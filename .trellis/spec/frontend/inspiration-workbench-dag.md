# Frontend Inspiration Workbench DAG Guidelines

> Frontend contracts for the inspiration detail node workbench.

## Scenario: Inspiration detail DAG workbench UI

### 1. Scope / Trigger

- Trigger: any InspirationDetail page change that renders, edits, runs, or consumes inspiration workflow DAG data.
- This feature spans API DTOs, TanStack Query cache keys, local selected-node state, and artifact previews.

### 2. Signatures

- API methods live only in `web/src/lib/api.ts`:
  - `getInspirationWorkflow(inspirationId)`
  - `createWorkflowNode(inspirationId, input)`
  - `updateWorkflowNode(nodeId, input)`
  - `updateWorkflowNodeCopy(nodeId, input)`
  - `uploadWorkflowNodeImage(nodeId, input)`
  - `uploadWorkflowNodeDocument(nodeId, { file })`
  - `bindWorkflowNodeImage(nodeId, { source_asset_id? , poster_variant_id? })`
  - `createWorkflowEdge(inspirationId, input)`
  - `deleteWorkflowEdge(edgeId)`
  - `runInspirationWorkflow(inspirationId, input?)`
- DTOs live only in `web/src/lib/types.ts`: `InspirationWorkflow`, `WorkflowNode`, `WorkflowEdge`, `WorkflowRun`,
  `WorkflowNodeRun`.
- `SourceAssetKind` includes `original_image`, `reference_image`, `processed_inspiration_image`, `context_image`, and
  `context_document`.
- `NodeConfigDraft` for `inspiration_context` includes `ownerId`, `entryType`, `longText`, `imageSourceAssetId`,
  `documentSourceAssetId`, `documentFilename`, `documentMimeType`, `documentText`, and `dynamicFields`.
- Query key: `['inspiration-workflow', inspirationId]`.

### 3. Contracts

- Frontend keeps backend `snake_case` fields (`node_type`, `config_json`, `output_json`, `start_node_id`).
- Supported user-facing node types are `inspiration_context`, `reference_image`, `copy_generation`, `image_generation`, and
  `tail_splitter`, plus the non-runnable editor node `deck_generation`.
- Inspiration detail/workbench is canvas-first: inspiration context, reference slots, copy, and image generation are graph nodes,
  not permanent fixed columns.
- InspirationDetail workbench uses ReactFlow / `@xyflow/react` as the frontend graph renderer and pointer interaction layer.
  The backend `InspirationWorkflow` payload remains the authority for persisted nodes and edges.
- The main workbench grid background should be rendered with ReactFlow `Background` so the visual canvas grid follows the
  ReactFlow viewport. Avoid page-level CSS grid overlays for the main workflow canvas.
- Viewport controls should use ReactFlow `Controls` / `ControlButton` instead of a page-level custom button group. Keep
  ReactFlow-native zoom in, zoom out, and fit-view behavior where possible; reserve ProductFlow-owned control buttons for
  business-specific actions such as reset-to-100% display and fitting the selected node group. Localize built-in control
  and minimap aria labels through ReactFlow `ariaLabelConfig`.
- Large InspirationDetail canvases should use ReactFlow `MiniMap` for desktop overview. Mobile should either hide the minimap
  or expose it through an explicit mode/entry so it does not cover browse/edit/select touch flows.
- The InspirationDetail `MiniMap` should remain a locating aid for the currently executing workflow node: keep non-running
  nodes visually neutral instead of coloring by node type, add the running-node emphasis through `nodeClassName` / SVG
  styling, and route minimap node clicks through the same selection plus ReactFlow fit-view path used by the main canvas.
  Do not replace ReactFlow `MiniMap` with a custom overview only to style active nodes.
- ReactFlow's internal node/edge store owns live drag coordinates during active pointer movement. InspirationDetail and
  WorkflowCanvas may resync nodes/edges from backend workflow data, selection state, and optimistic drop positions through
  ReactFlow instance methods, but they must not rebuild the full node array in React state on every drag-frame position
  event.
- Canvas interaction is pointer-first: nodes move through ReactFlow drag handling and persist via
  `updateWorkflowNode(...)` on drag stop. ReactFlow node positions map directly to workflow `position_x` /
  `position_y`.
- Active node drag must visually follow the pointer, not merely the eventual persisted coordinate. Do not round active
  drag coordinates before rendering; round only the final persisted `position_x` / `position_y` values on release.
- The main workflow canvas is unbounded in both viewport panning and node coordinates. Do not apply frontend-only minimum
  `position_x` / `position_y` clamps; negative workflow coordinates are valid when the user pans or drags there. New
  nodes and templates should still be inserted at the current viewport center so they remain visible at creation time.
- Empty canvas/background areas may be dragged to pan the ReactFlow viewport. Guard node actions, edge handles/buttons,
  zoom controls, uploads, and panel resize handles so those controls do not start background panning.
- Mobile canvas interaction uses an explicit `CanvasInteractionMode`:
  `browse`, `edit`, and `select`. Mobile defaults to `browse`; desktop passes `edit` so existing mouse drag and Shift
  selection behavior stay available. In `browse`, one-finger empty-canvas drag pans the viewport and tapping a node selects
  it without starting a node drag. In `edit`, touch/pen users may drag nodes and create connections. In `select`, tapping
  nodes toggles multi-select without keyboard modifiers, one-finger blank-canvas drag still pans the viewport, and tapping
  blank canvas exits the temporary selection mode. Mobile select mode should not enable ReactFlow's selection rectangle;
  small touch screens use tap-toggle selection instead of lasso selection.
- Touch and pen canvas edits must be gated by the active mobile interaction mode. Mouse pointers keep the desktop behavior.
  ReactFlow may start visual mouse node drag immediately so the node follows the pointer without a dead zone. Keep a small
  non-zero screen-pixel guard for mouse click suppression and persisted position commits so click jitter does not persist
  accidental node movement. Touch/pen can keep a larger non-zero visual and commit threshold so tap/select sequences stay
  stable.
- Mobile pinch zoom uses ReactFlow viewport zoom, clamps through the shared workflow zoom bounds, and should preserve the
  gesture center. Pinch has higher gesture priority than pan, selection box, node drag, and connection drag.
- InspirationDetail supports canvas node multi-select through local UI state. Keep `selectedNodeId` as the primary node that
  drives the Details sidebar, draft saving, reference-image fill target, and node-level run/delete/cancel/upload actions.
  Keep `selectedNodeIds` as the selected node group for group actions such as saving a node-group template, group drag,
  and group delete. Normal
  node click replaces the group with that node; Ctrl/Cmd/Shift click toggles a node in the group and makes newly added
  nodes primary; Shift-drag on empty canvas draws a transient selection rectangle and replaces the group with intersecting
  nodes. Clicking a secondary selected node without modifiers makes it the primary Details node while preserving the
  selected group. Plain empty-canvas drag must continue to pan the viewport.
- Multi-select visuals must distinguish primary and secondary selected nodes without relying on color alone. The primary
  node keeps the strong selected ring used by the Details sidebar. Secondary selected nodes use a quieter ring and a small
  check marker. The selection rectangle is a temporary translucent overlay; do not render a persistent group bounding box,
  multi-node inspector, or batch-operation panel under the multi-select contract. When more than one node is selected, a
  top-center canvas-control status such as `已选 N` should appear with a prominent red clear-selection button so the
  temporary state is obvious and not hidden by bottom scroll controls.
- Canvas keyboard selection behavior should prefer ReactFlow key props/hooks for local selection and viewport activation:
  `selectionKeyCode`, `multiSelectionKeyCode`, `panActivationKeyCode`, `zoomActivationKeyCode`, and `useKeyPress` are
  appropriate for lasso, multi-select modifiers, Space pan activation, Ctrl/Meta zoom activation, and Escape
  clear-selection. Escape must clear both the primary selected node and the selected node group, not only collapse
  multi-select back to the primary node. Backend-backed operations such as delete, duplicate, paste, undo, and redo remain
  InspirationDetail-owned shortcuts because they require confirmation, mutation calls, cache updates, or history restoration;
  keep ReactFlow `deleteKeyCode` disabled unless those contracts are routed through ProductFlow handlers.
- InspirationDetail node/group secondary actions must use one ProductFlow action model rendered through ReactFlow
  `NodeToolbar` on the selected node. The toolbar is the direct action surface on both desktop and mobile. Do not add a
  selected-card More button, mobile node action sheet, long-press action path, or ProductFlow desktop right-click context
  menu for node actions. Single selected reusable nodes expose run, duplicate, fit selected, and delete. A single
  `inspiration_context` node exposes only fit selected. A selected group exposes duplicate, fit selected, save selected as
  template, and delete through one toolbar anchored to the primary selected node; secondary selected nodes do not render
  duplicate toolbars. A group that includes `inspiration_context` exposes only duplicate and fit selected.
  Toolbar buttons must be icon buttons with `aria-label` and `title`, use `nodrag nopan nowheel`, and stay outside the
  node-card layout so they do not resize the node card. Actions such as run, duplicate, fit selected, save selected as
  template, and delete must call existing InspirationDetail
  handlers/mutations: run flushes the selected draft through `handleRunWorkflow`, duplicate uses the backend duplicate
  mutation, fit selected uses WorkflowCanvas/ReactFlow fit-view helpers, template save opens the existing save-template
  form/state, and delete opens ProductFlow confirmation before backend mutation. A single `inspiration_context` target should
  expose only fit-selected; a group that includes `inspiration_context` may duplicate reusable non-inspiration nodes, but should
  not expose node-group template save or group delete. Keep ReactFlow `deleteKeyCode` disabled and do not locally
  materialize duplicate or delete results.
- Multi-select hit testing should be based on canvas coordinates so zoom and pan do not change selection semantics. Use
  ReactFlow selection events for the main workbench and keep pure helpers for selection reconciliation. Selection state
  must reconcile when workflow data changes: deleted nodes are removed, the primary node remains included in
  `selectedNodeIds`, and a missing primary falls back to another selected node or the first workflow node.
- Treat multi-select as a temporary grouping state, not the default canvas mode. Ordinary non-group actions should collapse
  the group back to a single primary node, including blank-canvas click, adding a node, deleting a node or edge, creating
  an edge, uploading/filling a reference image, or applying a node-group template. Future save-as-template and deliberate
  group drag/delete flows consume the full `selectedNodeIds` group instead of clearing it before the operation.
- If the browser emits a click after completing a Shift-drag lasso selection, that click must not be treated as a
  blank-canvas clear action. Skip only that immediate synthetic/paired click; later blank-canvas clicks should still exit
  multi-select.
- Pointer release must not flash the node back to its stale server position. Keep the final drag coordinates in an
  optimistic position layer and update the `['inspiration-workflow', inspirationId]` cache before/while the PATCH is in flight;
  clear the optimistic entry after the server response becomes the authority, or restore the previous cache on error.
- Pointer releases below the ProductFlow click/commit guard must restore ReactFlow internal node positions to their drag
  start positions and skip persisted position mutations.
- If the same node is dropped again before an earlier position mutation resolves, protect the latest optimistic position
  from stale mutation success/error handlers; serialize or version position mutations so older responses cannot overwrite
  the newest drop and cause a one-frame old-position flash.
- Dragging any node in a multi-selected group should move every selected node by the same canvas delta, keep internal
  spacing, let ReactFlow update connected edges while dragging, allow the group to move through the unbounded canvas
  coordinate space, and persist each moved node through the normal `updateWorkflowNode(...)` position mutation. Position
  mutation success must not overwrite other pending group positions with stale full-workflow responses.
- Edges are created by dragging a ReactFlow output handle to a target handle/node. The visible temporary connection line is
  rendered by ReactFlow.
- Rendered workflow edges should preserve horizontal entry/exit direction at node handles through cubic Bezier control
  points instead of drawing explicit intermediate orthogonal line segments. Avoid visible elbow breaks and long straight
  vertical segments in the final SVG path; dense fan-in/fan-out graphs should separate sibling edges with deterministic
  lane offsets while preserving backend edge identity and handle semantics.
- Edge curves should prefer the source/target vertical relationship: a source above its target bends downward through the
  cubic control points, and a source below its target mirrors that bias upward. Keep the horizontal tails short enough that
  the Bezier curve carries most of the visible route.
- Connection-drag handle highlighting should use ReactFlow native connection state, such as `useConnection` or
  ReactFlow-provided handle connection classes. Do not reimplement connection drag, draw a custom temporary connection
  path, or bypass ProductFlow's existing `onConnect` / `isValidConnection` / backend edge mutation path.
- Edge deletion is a canvas action and should use ReactFlow `EdgeToolbar` or an equivalent ReactFlow edge child for the
  delete affordance. It must call `deleteWorkflowEdge(edgeId)` before refreshing `['inspiration-workflow', inspirationId]`; do
  not leave stale local-only edge state.
- Node deletion is a persisted canvas action and must call `deleteWorkflowNode(nodeId)` before refreshing
  `['inspiration-workflow', inspirationId]`; deleting a node must not be represented by local-only filtering because connected
  edges and run history cleanup are backend responsibilities.
- Workflow execution is asynchronous from the frontend perspective: `runInspirationWorkflow(inspirationId, input?)` returns the
  persisted kickoff state, then the page polls `['inspiration-workflow', inspirationId]` while any run is `running` /
  `waiting_confirmation` or any node is `queued` / `running`. Run history must use backend `is_retryable` for retry
  actions. Cancellation belongs in the selected node detail actions when the selected node is part of a cancelable active
  run; cancel buttons call the workflow cancel API and must not be local-only state.
- InspirationDetail run history should display both workflow-run and node-run status details. Each run card should surface
  queue/running text, `is_cancelable`, `is_retryable`, `failure_reason`, and a node-run list with node title, node type,
  node-run status, started/finished timestamps, and node-run failure reason. Image-generation prompt review may be exposed
  as an explicit button on the corresponding node-run row; do not render raw `output_json`, artifact ids, or prompt text
  inline in the normal log.
- InspirationDetail run history may display workflow image-provider summaries from `nodeRun.output_json.provider_results`
  when present. Keep this as a compact summary only: provider/model, provider response status/id, actual size, and
  provider compatibility notes are acceptable; raw provider request/output JSON, prompts, API keys, base URLs, and artifact
  ids must stay hidden. Do not imply live provider progress unless the workflow API exposes durable node-run progress
  fields.
- Running any workflow node must first flush the currently selected dirty inspector draft, even when the clicked run action
  belongs to a different node. Otherwise a user can edit the inspiration context node and immediately run an image node from
  the canvas before autosave persists the newest inspiration fields.
- Do not use workflow active state as a global node-run lock. Split interaction busy state so the full-workflow run button
  and structural mutations can be disabled during active runs, while individual node run buttons are disabled only when
  that node is already `queued` / `running` or a run submission is currently pending. Node dragging remains available
  unless a layout/position mutation is already pending.
- When an active run transitions to inactive, refresh artifact-bearing queries: `['inspiration', inspirationId]`,
  `['inspiration-history', inspirationId]`, and `['inspirations']`.
- Inspiration creation keeps the same inspiration-context text/document contracts as the workbench: inspiration name and the selected
  entry's required input remain the only required fields, while optional context document upload is a single-slot control
  that hides the upload/drop zone after a document is selected and restores it only after removal.
- Inspiration list deletion must use `api.deleteProduct(inspirationId)`, ask for explicit confirmation, and refresh `['inspirations']`
  after success. Show `ApiError.detail` when active workflow runs block deletion.
- `inspiration_context` inspector edits generalized context fields: name, owner id, entry type, long text, one context image,
  one text document, and dynamic key/value pairs. Keep legacy category and price fields visible while writing the new
  backend `snake_case` config keys.
- The inspiration-context long text editor must preserve raw Markdown source text, use the shared Markdown editor with
  edit/preview/large-dialog modes, support Mermaid fenced block preview, and enforce the shared 50,000-character
  inspiration-context Markdown limit in both creation and inspector entry points. The large-dialog mode must render through a
  page-level portal so InspirationDetail sidebar, canvas, and node containers cannot clip or size-constrain the editor.
- Inspiration context `entryType` uses `InspirationInitialWorkflowEntry = "image" | "copy" | "tail" | "blank"`. The `copy` value
  means the existing copywriting/text entry mode (`文案入口`), and should be localized as an entry label rather than a
  duplicate/copy action.
- `draftFromNode(...)` must prefer `config_json` over `output_json` for saved inspiration-context edits. `source_note` remains
  a legacy fallback for `longText`; `nodeConfigFromDraft(...)` writes both `long_text` and `source_note` during the
  compatibility period.
- Inspiration context dynamic-field rows serialize to backend `dynamic_fields` as one-level scalar JSON. Parse the strings
  `true`, `false`, and `null` to booleans/null, parse finite numeric strings to numbers, preserve other values as strings,
  and omit rows whose key is blank.
- Inspiration context document upload uses `api.uploadWorkflowNodeDocument(nodeId, { file })` with multipart field `document`.
  The upload response is the authoritative workflow payload; update `['inspiration-workflow', inspirationId]` from it and refresh
  inspiration/artifact queries because the route creates a `context_document` SourceAsset.
- Inspiration context document UI is a single-slot control in both InspirationDetail inspector and InspirationCreatePage. In
  InspirationDetail, when `document_source_asset_id`, `document_filename`, or `document_text` is present, do not render a
  clickable/drop-enabled upload zone. The user must remove the current document first; removal clears
  `document_source_asset_id`, `document_filename`, `document_mime_type`, and `document_text` in the draft so
  `nodeConfigFromDraft(...)` writes them as `null`. In InspirationCreatePage, when `contextDocumentFile` is present, hide the
  upload/drop zone, show the selected filename, and only restore uploading after local removal. This removes the node
  binding or local selection only and does not delete historical `context_document` SourceAsset records.
- Inspiration context document text should be previewable through the shared Markdown editor/preview surface in read-only
  mode so uploaded Markdown can render GFM and Mermaid blocks while still exposing the original source text. TXT/CSV/JSON
  documents remain read-only raw text plus the same Markdown preview unless a future requirement adds MIME-specific
  viewers. Document preview must be user-toggleable and collapsed by default in both InspirationDetail inspector and
  InspirationCreatePage so long uploaded documents do not occupy the whole page until requested. In narrow sidebars or
  creation forms, the selected-document status card must stack file metadata above the action row; do not place the file
  name/hint and two action buttons in one flex row because the buttons can squeeze Chinese helper text into one-character
  columns. The read-only source view for uploaded documents must render as a non-input viewer such as `pre`, not a
  `textarea` or editable input with only a `readOnly` attribute. Memoize read-only source and rendered preview surfaces so
  unrelated creation-form edits, especially long-text typing, do not re-render uploaded document Markdown/Mermaid content
  when the document text has not changed. InspirationCreatePage must submit the original uploaded `File`, not a regenerated
  file built from preview text.
- Inspiration context image upload reuses `api.uploadWorkflowNodeImage(...)` for `inspiration_context` nodes. The current preview
  should prefer `image_source_asset_id` / `context_image` and fall back to the inspiration original image for legacy workflows.
- `reference_image` nodes use `uploadWorkflowNodeImage(...)` for manual uploads and can also be filled by upstream
  `image_generation` nodes.
- A `reference_image` node is a single current-image slot. When manual upload or upstream `image_generation` fills a slot,
  the UI should treat the returned single `source_asset_ids[0]` / `image_asset_ids[0]` as the node's current image and rely
  on inspiration source-asset/history artifact surfaces for older replaced assets. Do not hide multi-image output only in the
  frontend; the backend contract must replace the node output.
- `image_generation` is a trigger/config node, not an image-bearing artifact node. It must not render generated-image
  previews or download links on the image-generation card itself.
- `deck_generation` is a deck-editor node, not a workflow-run node. The normal node toolbar must not expose ordinary
  run/run-after actions for it; selecting the node opens the deck editor surface in the right inspector instead.
- `deck_generation` can accept incoming edges from completed upstream material nodes but cannot be a connection source.
  Frontend connection validation must block `deck_generation -> *` edges before mutation submission.
- Deck-node summary cards should show source counts, outline/deck page counts, generated slide counts, stale-source or
  invalid-source warnings, and browser-export availability. They should not show backend `pptx_url` as the primary export
  path for current DAG decks.
- Deck editing lives in the node inspector, not the legacy deck tab. The editor uses node-scoped APIs for deck metadata,
  outline generation, batch generation, slide edits, slide re-generation, speaker notes, source refresh, and slide
  material binding by `source_item_id`.
- The DAG deck editor must not call legacy generic mutating deck endpoints such as `PUT /deck-slides/{id}/material`,
  `POST /decks/{id}/generate`, or backend export for active DAG decks. Generic endpoints remain only for legacy/non-DAG
  history flows.
- The deck editor may let users input title, supplemental description, and per-slide points locally, but those values must
  be sent through node-scoped deck/outline APIs so they enter backend outline context instead of living as frontend-only
  draft state.
- Browser PPTX export is shared between DAG decks and legacy decks. Frontend fetches each generated slide image with
  authenticated API requests, converts to data URLs, builds a 16:9 PPTX with `pptxgenjs`, includes speaker notes when
  enabled, and exports only slides that have generated images.
- Deck history / legacy `DeckPanel` must detect `workflow_node_id`, `workflow_node_exists`, and `generated_slide_count`.
  Active DAG decks should show summary/export/locate actions only and steer editing back to the canvas node; legacy decks
  keep their old mutation controls.
- `image_generation` output count is represented by downstream graph slots: one generated image per connected downstream
  `reference_image` node. With no downstream slots, backend execution fails with a concise "connect at least one
  image/reference node" message; the frontend should make that requirement visible in the inspector.
- Any node with an image asset/output should render a compact preview directly on the node card.
- Any user-visible inspiration/workbench image preview should provide an explicit `下载` action. Do not rely on browser
  right-click as the only way to retrieve inspiration images.
- Type-specific inspector forms are required for inspiration context, reference image, copy generation, and image generation;
  avoid generic JSON editors for normal user flows.
- Generation-capable inspector forms must expose generation config scheduling next to the selected generation group:
  `copy_generation` and `tail_splitter` filter manual options to `purpose="text"`, while `image_generation` filters to
  `purpose="image"`. Auto mode persists `generation_config_mode: "auto"` and `generation_config_id: null`; manual mode
  persists the selected config id.
- `draftFromNode(...)` and `nodeConfigFromDraft(...)` must round-trip `resource_group_id`, `generation_config_mode`, and
  `generation_config_id` for workflow `copy_generation`, `tail_splitter`, and `image_generation` nodes. Switching a node
  to a resource group that does not contain the selected manual config resets that config selection to auto before save or
  run.
- Running a workflow node with `generation_config_mode="manual"` and no `generation_config_id` is a local validation error:
  show the inspector generation-config-required message and do not submit the run mutation.
- The tail-split plan dialog must expose image generation config scheduling for generated downstream image nodes. It filters
  options to `purpose="image"` for the selected group and sends `image_generation_config.generation_config_mode/id` with
  the apply request.
- Workbench inspector parameter help must use the shared `ParameterHelpButton` / `ParameterHelpLabel` components and the
  global `web/src/lib/parameterHelp.ts` registry. Add help for non-obvious node parameters such as inspiration context long
  text/document/dynamic fields, reference role, copy instruction/generation config/tone/channel/visual guidance, tail
  source/description/max items, image description/generation config, and provider tool options. Do not add help to obvious
  fields such as node name, inspiration name, labels, raw body text, image aspect/resolution/width/height, or upload buttons.
  InspirationDetail should pass `uiType="inspirationDetail"` so registry-level `helpKey + uiType` styles can adjust the dialog
  without changing inspector layout code.
- A selected `copy_generation` node with a generated `copy_set_id` must edit `CopyPayloadV2` as the primary copy model:
  `summary`, `content.kind`, block/section text, labels, notes, and visual hints. The inspector must not show a derived
  fixed-field copy panel or maintain removed copy fields as draft state. Saving calls
  `updateWorkflowNodeCopy(...)` with `structured_payload`, refreshes workflow/inspiration artifacts, and does not expose the
  raw `copy_set_id`.
- Node output details should stay productized and minimal. Do not render raw `output_json` keys, artifact IDs, prompt /
  instruction text, generated-summary prose, or technical fact-chip piles in the normal inspector; keep failure reasons
  visible and expose successful artifacts through their productized surfaces (node thumbnails, editable copy fields, and
  the Images tab).
- InspirationDetail uses one right sidebar for Details, Runs, Images, and Templates. The small rail selects the active tab; clicking a
  workflow node must select it and switch the sidebar to Details. Workflow completion must refresh artifacts silently and
  must not auto-switch the active tab.
- The right sidebar rail must have bounded height and vertical scrolling (`overflow-y-auto` with overscroll containment)
  so every tab, including Images/Gallery, remains reachable in short desktop viewports.
- The Images tab may aggregate `PosterVariant` and `SourceAsset` records, but it must de-duplicate generated images that
  appear as both a persisted poster and a filled reference source asset from the same `image_generation` output.
- In the Images tab, thumbnail primary click opens a large in-app preview/lightbox using preview/full URLs; it must not
  navigate to, download, or expose the compressed thumbnail as the primary action. Explicit `下载` controls still use
  original/download URLs.
- When the selected node is `reference_image`, Images tab cards expose a concise fill action. SourceAsset-backed cards
  call `bindWorkflowNodeImage(..., { source_asset_id })` so no duplicate upload is created. PosterVariant-backed cards
  should pass the already paired filled SourceAsset id when workflow output exposes one, otherwise call
  `bindWorkflowNodeImage(..., { poster_variant_id })` so the backend can materialize a reference SourceAsset.
- Images tab de-duplication should read every durable poster-to-SourceAsset mapping available: generated image-node
  `generated_poster_variant_ids` / `filled_source_asset_ids`, filled reference-node `source_poster_variant_id`, and
  SourceAsset `source_poster_variant_id`. Do not rely only on currently filled reference nodes; old materialized poster
  SourceAssets remain implementation artifacts and must stay hidden when their source PosterVariant is already shown. The
  backend materialized poster filename convention `poster-{poster_variant_id}.*` is only a legacy fallback when an older
  API payload lacks the explicit SourceAsset field; do not apply it when `source_poster_variant_id` is present and null, or
  user-uploaded reference images with the same filename would be over-filtered.
- Image preview/download helpers must filter out `context_document` assets. `context_image` is image-preview eligible;
  `context_document` appears only as context metadata in the inspiration-context inspector and text context.
- Image download links should use `download_url` when available and fall back to preview URLs only when needed. Always pass
  backend URLs through `api.toApiUrl(...)`, use short visible copy such as `下载`, stop propagation inside node cards, and
  sanitize generated filenames so inspiration names cannot introduce path separators or control characters.
- User-visible copy should be short utility labels such as `灵感产物`, `参考图`, `文案`, `生图`, `运行`, `连接`, `删除`.
- An idle `inspiration_context` node is usable static context and should not be labeled as `未运行`; display it as available
  context while leaving real generative/action nodes to use the generic idle label.
- Mutations that create artifacts must refresh `['inspiration', inspirationId]`, `['inspiration-history', inspirationId]`, and
  `['inspirations']` when outputs can affect copy, posters, or list status.
- InspirationDetail node cards use a shared `NODE_WIDTH` contract across `constants.ts`, `WorkflowCanvas`, and
  `WorkflowNodeCard`; keep these widths synchronized. The current balanced canvas baseline is `NODE_WIDTH = 272`,
  auto-layout `gapX = 420`, and vertical item spacing around `132`, which leaves enough curve room without making nodes
  feel undersized against empty edge space.

### Templates Sidebar Tab

- Built-in canvas templates are loaded through `api.listCanvasTemplates()` from `GET /api/workflow/canvas-templates`;
  InspirationDetail should display built-in scenario templates and non-archived user templates for workbench insertion.
- Template catalog filters use the central API client:
  `api.listCanvasTemplates({ search?, category_id?, scope? })` and
  `api.listCanvasTemplateCategories({ search?, scope? })`. Query keys must include every active filter value, for example
  `["canvas-templates", search, categoryId, scope]` and `["canvas-template-categories", scope]`.
- InspirationDetail must present templates inside the inspector sidebar as a `templates` tab with the same rail
  behavior as Details, Runs, and Images. Do not open a canvas floating palette for templates.
- The collapsed sidebar rail must include a Templates tab entry; clicking it expands the sidebar and switches to the
  Templates tab.
- Template cards should make a real mini-map the primary visual: render a taller node-editor-like preview with a subtle
  dotted/grid background, compact node rectangles, visible edge paths, and only short labels/chips below it. Avoid
  explanatory paragraphs, long suggested-connection copy, or dense fact lists in the sidebar.
- The mini-map node cards should echo `WorkflowNodeCard` visual language: white or white/95 surfaces, slate/zinc borders,
  rounded card corners, type-matched lucide icons, short title plus `NODE_LABELS`, compact status pills, and left/right
  handle dots. Do not regress to color-strip-plus-lines nodes.
- Template card previews must be rendered from catalog summary `preview_nodes` and `preview_edges`, which are derived from
  backend `CanvasTemplate.nodes` and `CanvasTemplate.edges`. Use the provided relative coordinates to fit the graph into
  the sidebar card as a real mini-map. Do not hard-code a generic template structure in the frontend, and show a short
  empty state when preview data is absent.
- Template card mini-maps must remain readable for built-in scenario templates: node rectangles must not overlap, edge
  paths should render behind nodes with enough visible space between columns, and the preview can increase height or use
  a normalized column layout while still deriving nodes/edges from the backend summary.
- Template cards should display backend `default_external_connections` as short chips such as `自动接灵感产物`. These chips
  describe edges that the apply API will persist; they are not long-form instructions.
- Template summaries include `source: "builtin" | "user"` and nullable `user_template_id`. InspirationDetail must show a
  concise source marker, expose rename/delete actions only for `source === "user"` templates, and leave built-in templates
  immutable.
- When more than one canvas node is selected, the top-center multi-select control may open a save-template form. The form
  requires a template name, accepts an optional description, calls
  `api.createUserTemplateGroup(inspirationId, { title, description, node_ids: selectedNodeIds })`, invalidates
  `["canvas-templates"]` on success, and switches the sidebar to Templates so the saved template is visible.
- Deleting a user template calls `api.archiveUserTemplateGroup(user_template_id)` after user confirmation and invalidates
  `["canvas-templates"]`; UI text may say delete, but the backend operation is archival.
- Renaming a user template calls `api.updateUserTemplateGroup(user_template_id, { title })` and invalidates
  `["canvas-templates"]`. The first UI contract only edits the title; description editing can stay out of the card flow.
- Applying a built-in scenario template calls `api.applyWorkflowTemplateGroup(inspirationId, { template_key, position_x,
  position_y })` and receives the normal `InspirationWorkflow` response. Built-in full-canvas templates reuse the active
  workflow's existing inspiration node instead of creating a second inspiration node.
- Applying a user node-group template uses the same API with `template_key === "user:{id}"`; the frontend must not special
  case materialization locally.
- Use the current viewport-center node position for the insertion point unless a more explicit user-selected canvas
  coordinate is part of a future task.
- On apply success, update `['inspiration-workflow', inspirationId]`, refresh the workflow query, and select a created primary
  node by comparing pre/post node IDs. Prefer `copy_generation`, then `image_generation`, then the first created node so
  the user can immediately edit, connect, drag, or run it.
- Display `reference_input_hints`, `output_slots`, and `suggested_connections` as guidance only. Suggested connections
  must not become hidden external edges; every real edge in the canvas should come from the backend workflow payload.
- When a user or legacy node-group template declares default external connections, adding it should result in visible backend-returned
  workflow edges, for example from the existing inspiration context node to newly created copy/image nodes. The frontend must
  render those edges from the normal workflow payload rather than from local template metadata.

#### Scenario: Template Catalog Filters

##### 1. Scope / Trigger

- Trigger: editing InspirationDetail templates tab, InspirationCreate template selection, `api.listCanvasTemplates(...)`,
  `api.listCanvasTemplateCategories(...)`, or frontend DTOs for canvas template categories.
- Goal: keep template search/category/source/entry filtering aligned with the backend catalog API and React Query cache
  keys.

##### 2. Signatures

- API method:
  `api.listCanvasTemplates(input?: { search?: string; category_id?: string; scope?: CanvasTemplateScope; initial_workflow_entry?: InspirationInitialWorkflowEntry })`.
- API method:
  `api.listCanvasTemplatesForManagement(input?: { search?: string; category_id?: string; scope?: CanvasTemplateScope; initial_workflow_entry?: InspirationInitialWorkflowEntry })`.
- API method: `api.listCanvasTemplateCategories(input?: { search?: string; scope?: CanvasTemplateScope })`.
- API method: `api.createUserCanvasTemplate(inspirationId, { title, description?, category_id, retain_prompt_text?, sort_order? })`.
- API method: `api.copyUserTemplateToGlobal(templateId, { category_id, title?, description?, sort_order? })`.
- Type: `InspirationInitialWorkflowEntry = "image" | "copy" | "tail" | "blank"`.
- Type: `CanvasTemplateEntryMode = "image" | "copy" | "tail"`.
- Type: `CanvasTemplateScope = "global" | "user"`.
- Type: `CanvasTemplateSummary` includes `entry_mode`, `sort_order`, `scope`, `category_id`, `category_name`,
  `owner_user_id`, `owner_username`, `enabled`, `effective_enabled`, `disabled_reason`, `review_status`, `review_note`,
  `review_submitted_at`, `reviewed_at`, and reviewer display fields.
- Type: `CanvasTemplateCategory` mirrors backend fields `id`, `scope`, `owner_user_id`, `owner_username`, `name`,
  `sort_order`, `enabled`, `effective_enabled`, `disabled_reason`, `created_at`, and `updated_at`.

##### 3. Contracts

- Keep backend query parameter names as `search`, `category_id`, `scope`, and `initial_workflow_entry`; do not camel-case
  them in `api.ts`.
- Empty filter values are omitted from `URLSearchParams`.
- Operational `api.listCanvasTemplates(...)` is for inspiration creation and workbench insertion. It returns only effectively
  enabled templates/categories; do not use it for admin governance screens that need disabled rows.
- Management `api.listCanvasTemplatesForManagement(...)` is for template management screens. Admins can see all global and
  user templates; ordinary users can see their own disabled personal templates with status/reason/review fields.
- `scope="global"` returns global templates/categories; `scope="user"` returns user-owned templates/categories visible to
  the current actor in the selected query mode; omitted scope returns both visible scopes.
- InspirationCreate must include `initial_workflow_entry` in both the React Query key and `api.listCanvasTemplates(...)`.
  `image/copy/tail` entries show matching `entry_mode`; `blank` may show all non-blank entry templates grouped by entry.
- InspirationCreate keeps the blank canvas option local and always available, even when server-side template filters return no
  full-canvas templates.
- InspirationDetail owns the server query state and passes filter state, category data, and filtered templates into
  `TemplateGroupsPanel`; the panel remains API-free.
- InspirationDetail may keep its existing stage chips as a local secondary filter over the server-filtered results.
- InspirationDetail can save the active workflow as a personal full-canvas template only through
  `api.createUserCanvasTemplate(...)`. The form must require a personal category, expose `retain_prompt_text`, and disable
  blank-entry workflows based on `workflow.initial_entry_mode`.
- Personal template management filters user templates by entry/category/search and can edit title, description, category,
  sort, status visibility, disabled reason, review note, and archival according to role. Global template management can
  edit global templates and use user templates as copy sources.
- In global template management, a global category filter must not hide user templates that are only available as copy
  sources; apply the category filter to global templates while keeping user templates visible for copying.
- Disabled personal templates can be edited by their owner only with a modification note; after submit the row is marked
  pending review and remains hidden from operational catalog results until an admin approves it.
- Admin review actions must be explicit: approve enables the template, keep-disabled stores/updates disabled reason and
  keeps it unavailable.
- Template chips may display `scope` and `category_name`; operator-authored template/category names are source data and
  must not be translated.

##### 4. Validation & Error Matrix

- Template list loading -> show the existing template loading state near the list.
- Template list error -> show `detail.template.loadFailed`; do not clear user-entered filter state.
- Category list loading -> disable the category select while preserving current search and scope controls.
- Category list error -> show `templateFilter.categoriesLoadFailed` and keep template search/scope usable.
- Scope change -> clear `category_id` because category ids are scoped.
- Empty server result -> show the existing empty template state; InspirationCreate still shows blank canvas.
- Entry change on InspirationCreate -> reset incompatible selected template and refetch templates with the new
  `initial_workflow_entry`.
- Disabled or pending-review template in InspirationCreate/workbench operational catalog -> hidden and not selectable.
- Blank-entry workflow in InspirationDetail save-template flow -> disable submit and show the backend-aligned blank-entry
  reason.
- Missing personal category when saving a full-canvas template -> disable submit or show the category-required error near
  the dialog action.
- Copying a user template to global without a global category -> disable submit; backend remains authoritative.
- Owner submits disabled-template edits without review note -> show `ApiError.detail` near the form.
- Admin keeps a template disabled without a reason -> show `ApiError.detail` and preserve the row state.

##### 5. Good/Base/Bad Cases

- Good: InspirationDetail query key includes `search`, `categoryId`, and `scope`, so changing any filter refetches and caches
  the correct catalog response.
- Good: InspirationCreate query key includes `initialWorkflowEntry`; switching from `image` to `tail` refetches the catalog
  instead of reusing image-entry templates.
- Good: InspirationCreate submits the selected backend `canvas_template_key` unchanged and omits filters from inspiration creation
  payload.
- Good: blank InspirationCreate entry shows the local blank canvas option plus any database templates returned for
  `initial_workflow_entry=blank`, grouped by entry.
- Good: global template management lists global templates for editing and user templates for copy-to-global, without
  enabling user-template save/delete controls in the global page.
- Base: blank search, blank category, and scope `all` call `/api/workflow/canvas-templates` without a query string.
- Bad: filtering only client-side after fetching all templates when backend `search`, `category_id`, and `scope` are
  already available.
- Bad: passing translated category names back to the API instead of the stable `category_id`.
- Bad: using a global category id as a request `category_id` while also expecting user templates to be visible for
  copy-to-global.
- Bad: allowing blank-entry workflows to open a save-full-canvas-template submit path because the current graph happens to
  contain image/copy/tail nodes.

##### 6. Tests Required

- Run `pnpm --dir web exec tsc --noEmit -p tsconfig.app.json` after DTO/API method changes.
- Run `pnpm --dir web lint`, `pnpm --dir web test:run`, and `just web-build` for InspirationCreate or InspirationDetail UI changes.
- Add/update helper tests when changing reference-image role/label fallback or template localization fixture fields such
  as `entry_mode` and `sort_order`.
- Backend API tests remain authoritative for catalog permission, owner visibility, and invalid category/scope behavior.

##### 7. Wrong vs Correct

Wrong:

```tsx
useQuery({
  queryKey: ["canvas-templates"],
  queryFn: () => api.listCanvasTemplates(),
});
```

Correct:

```tsx
useQuery({
  queryKey: ["canvas-templates", search, categoryId, scope, initialWorkflowEntry],
  queryFn: () =>
    api.listCanvasTemplates({
      search: search || undefined,
      category_id: categoryId || undefined,
      scope: scope === "all" ? undefined : scope,
      initial_workflow_entry: initialWorkflowEntry,
    }),
});
```
- Do not duplicate the backend template catalog in InspirationDetail. The page may use merchant-facing labels from the API,
  but the submitted `template_key` must be the backend-recognized key.

### Keyboard Shortcuts and Undo/Redo

#### 1. Scope / Trigger
- Trigger: InspirationDetail changes to keyboard handling, selected node groups, copy/paste, delete shortcuts, or undo/redo.
- Shortcuts are local workbench interactions on top of persisted workflow mutations.

#### 2. Signatures
- Copy: `Ctrl/Cmd+C` stores the current selected node ids in page memory.
- Paste: `Ctrl/Cmd+V` calls `api.duplicateWorkflowNodeGroup(inspirationId, ...)`.
- Duplicate: `Ctrl/Cmd+D` copies and immediately duplicates the current selected group.
- Delete: `Delete` / `Backspace` requests confirmation, then deletes the selected node/group through persisted APIs.
- Undo: `Ctrl/Cmd+Z` applies the latest frontend inverse action.
- Redo: `Shift+Ctrl/Cmd+Z` or `Ctrl/Cmd+Y` reapplies the latest undone inverse action.
- Backend duplicate endpoint: `POST /api/inspirations/{inspiration_id}/workflow/node-groups/duplicate`.

#### 3. Contracts
- Shortcut handling must ignore events from `input`, `textarea`, `select`, `button`, `a`, labels, role buttons,
  contenteditable elements, and node/action controls where text editing or normal browser commands should win.
- Shortcuts operate on the current `selectedNodeIds`; no selection means no destructive action.
- Delete shortcut always opens confirmation. Undo/redo opens confirmation only when the step will delete nodes or edges.
  Movement, restoration, copy, and paste execute without confirmation.
- Copy/paste and duplicate must use backend duplication. The frontend must not locally materialize workflow rows.
- After paste/duplicate, update `['inspiration-workflow', inspirationId]` with the backend response and select the created nodes.
- Undo/redo history is an in-memory inverse-action stack scoped to the current inspiration page. Clear it on inspiration changes
  and when workflow data is externally refreshed in a way that makes local history unsafe.
- Undoing node deletion restores structure, editable config, and internal edges only. It must not restore output JSON, run
  state, workflow run rows, generated copy, generated images, or artifact ids/URLs/paths.

#### 4. Validation & Error Matrix
- Shortcut from editable target -> do nothing and do not prevent the user's text operation.
- Delete with no selected nodes -> do nothing.
- Paste with empty clipboard -> do nothing or show a concise local notice; do not call the backend.
- Backend duplicate error -> show `ApiError.detail` in the existing InspirationDetail error surface.
- Destructive undo/redo canceled by user -> keep history unchanged.
- Undo/redo mutation failure -> show `ApiError.detail` and keep the page consistent with the latest query data.

#### 5. Good/Base/Bad Cases
- Good: select a copy/image/reference chain, press `Ctrl/Cmd+D`, and see a new selected chain with internal edges.
- Good: delete selected nodes with confirmation, then undo and get fresh idle/configured nodes without old outputs.
- Base: pressing `Ctrl/Cmd+C` inside an inspector text field uses normal text copy and does not replace the canvas
  clipboard.
- Bad: storing copied workflow nodes in localStorage or sharing them across inspirations/tabs for the MVP.
- Bad: undoing deletion by writing old `output_json` back into a node, which makes stale generated artifacts look valid.

#### 6. Tests Required
- Pure helper tests for shortcut target filtering and shortcut key classification.
- Pure helper tests for undo/redo inverse-action stack behavior and artifact-field sanitization.
- InspirationDetail or focused tests that delete and destructive undo/redo request confirmation.
- Frontend build must pass because shortcut routes touch DTOs, API helpers, and InspirationDetail.

#### 7. Wrong vs Correct

Wrong:

```tsx
document.addEventListener("keydown", (event) => {
  if (event.metaKey && event.key === "c") setClipboard(selectedNodeIds);
});
```

This steals normal copy behavior from inspector fields.

Correct:

```tsx
if (!isWorkflowShortcutBlockedTarget(event.target)) {
  handleWorkflowShortcut(event);
}
```

Filter editable/action targets before interpreting canvas shortcuts.

### 4. Validation & Error Matrix

- API `ApiError.detail` is shown near the workflow action.
- Missing workflow while loading -> loading state, not an empty destructive reset.
- Active workflow polling stops when no run is `running` and no node is `queued` / `running`; `cancelled` runs are
  terminal and should not keep polling alive.
- Deleting a node during an active workflow run -> show backend `运行中，稍后删除`; do not locally remove it.
- Deleting a inspiration during active workflow runs -> show backend detail; do not locally remove it until the API succeeds.
- Unsupported node config fields stay in `config_json` and are not force-cast to narrower frontend-only types.
- Image URLs from workflow-created source assets and poster artifacts still go through `api.toApiUrl(...)`.
- Inspiration-context document upload failure -> show backend `ApiError.detail` near the inspector/workflow action and keep the
  current draft visible.
- Inspiration-context image/document upload buttons are disabled while the selected node upload/save action is pending.
- Blank inspiration-context dynamic-field keys -> omit those rows from `dynamic_fields` before saving.
- Inspiration-context entry type from stale output or unknown config -> fall back to the current workflow initial entry or
  `image`; do not submit an unsupported select value.
- `context_document` in `inspiration.source_assets` -> omit from image preview/download collections.
- Direct image runs without downstream reference slots should show the backend error near the workflow action/node; do not
  invent a fallback preview on the image-generation node.
- Image-size inputs smaller than the provider-safe lower bound must be calibrated in the picker before submission, matching
  the backend 512px minimum per side. The user-facing custom-size hint should show the calibrated final output.
- When async workflow polling observes a failed run with `failure_reason`, InspirationDetail should surface that reason in the
  global workflow error area as well as node/run detail surfaces.

### 5. Good/Base/Bad Cases

- Good: selecting a node updates the inspector without navigating away from the inspiration detail page.
- Good: editing a inspiration-context node round-trips name, owner id, `entry_type`, long text, context image id, document
  fields, and dynamic scalar fields through `draftFromNode(...)` and `nodeConfigFromDraft(...)`.
- Good: uploading a markdown document on the inspiration-context inspector updates the selected node from the returned
  workflow, shows the uploaded filename/status, and preserves the existing image preview.
- Good: a inspiration-context node with `image_source_asset_id` displays that context image; a legacy node without it falls
  back to the inspiration original image.
- Good: an image-generation node with no downstream reference slot fails clearly and shows no generated image
  preview/download on the image node.
- Good: an image-generation node connected to two downstream reference slots visibly fills both slot nodes after run.
- Base: adding a copy/image/reference branch creates a node, then connects it with an edge through API helpers.
- Base: after a copy node run succeeds, editing the generated copy updates the inspector draft from inspiration `copy_sets`
  plus node output, without showing raw output summaries or artifact IDs in the normal inspector.
- Base: uploading an image in a `reference_image` inspector refreshes the workflow query and keeps the node output visible
  after a page reload.
- Base: after dragging a node and releasing the pointer, the rendered node stays at the dropped position while the
  position mutation is pending; it must not briefly render the old `position_x` / `position_y`.
- Base: dragging an empty canvas/background area pans the ReactFlow viewport, while dragging a node still persists node
  coordinates and clicking edge/delete/run/upload/zoom controls does not move the viewport.
- Base: on desktop, Shift-dragging an empty canvas area uses the ReactFlow selection rectangle and replaces the selected
  node group, while a normal empty-canvas drag still pans.
- Base: on mobile, select mode uses tap-toggle multi-select, keeps empty-canvas drag as viewport pan, and does not show a
  selection rectangle.
- Base: multi-selecting nodes does not turn Details into a batch editor; `selectedNodeId` remains the primary node and
  `selectedNodeIds` remains the group for future template saving or batch actions.
- Base: clicking a secondary selected node opens that node in Details while keeping the group selected; clicking blank
  canvas or performing ordinary node/edge/image mutations exits multi-select back to one primary node.
- Base: dragging a secondary selected node makes it primary for Details but keeps the group selected and moves the whole
  selected group.
- Base: deleting from the multi-select control confirms once, calls backend node deletion for selected nodes, and exits to
  a single remaining primary node after success.
- Base: while a workflow run is active, users can still drag nodes to reorganize the canvas and may run another
  non-queued/non-running node; the backend rejects overlapping planned nodes and the UI still blocks unsafe structural
  changes.
- Base: deleting a node removes it and its connected edges after the backend response, and a page refresh does not restore
  the node.
- Base: deleting a inspiration from the inspiration list removes it after API success and a direct detail load returns not found.
- Base: visible inspiration images, filled reference-slot images, and image-history thumbnails each expose a concise `下载`
  action that does not select/drag the node or open the preview modal as a side effect. Image-generation nodes do not expose
  generated-image downloads directly.
- Base: with a reference-image node selected, filling from a SourceAsset updates the workflow cache to the chosen
  `source_asset_id`; filling from a PosterVariant either reuses its paired SourceAsset id or relies on the backend
  materialization endpoint.
- Bad: keeping workflow nodes in local-only state; refresh would lose the DAG and break run history.
- Bad: treating `workflowActive` as `runBusy` for every node run button; that hides the backend's ability to run disjoint
  nodes and makes the UI look globally locked while only one node is active.

### 6. Tests Required

- `just web-build` must pass after any DTO or page change.
- `pnpm --dir web test:run` should cover `workflowConfig.ts` inspiration-context round-trip, including dynamic scalar parsing
  and blank-key omission.
- InspirationDetail/image-download helper tests should assert `context_image` can be previewed and `context_document` is
  filtered out of image-only surfaces.
- Backend API tests should cover workflow payload shapes; the frontend relies on these typed shapes at build time.
- User-template frontend changes must pass `just web-build` because `CanvasTemplateSummary`, API helpers, InspirationDetail,
  and `TemplateGroupsPanel` all share DTO fields.
- If a separate frontend test runner is added later, cover selected-node inspector, run-all mutation, edge drag/delete, and
  cache invalidation.
- If a separate frontend test runner is added later, cover workflow active-run polling, active-to-inactive artifact query
  refresh, node deletion, and inspiration list deletion error/success states.
- Drag-position regressions should cover the render priority: active drag position, then optimistic dropped position, then
  server workflow position.
- Multi-select regressions should cover desktop rectangle normalization/intersection, node hit testing with
  measured/fallback bounds, modifier-toggle behavior, lasso replacement behavior, mobile tap-toggle behavior, and
  selection reconciliation after workflow node changes.
- Multi-select regressions should also cover secondary-node focus and clearing the group for ordinary non-group actions.
- User-template regressions should cover saving from `selectedNodeIds`, invalidating `["canvas-templates"]`, showing
  user-only rename/delete actions, confirming archival, and applying user templates through the same template-group API as
  built-ins.
- Download-link regressions should cover URL construction through `api.toApiUrl(...)`, filename sanitization, and event
  propagation isolation inside node cards.
- Images-tab regressions should cover preview/lightbox primary click, explicit download action, gallery de-duplication, and
  reference-node fill cache refresh for both `source_asset_id` and `poster_variant_id` inputs.

### 7. Wrong vs Correct

#### Wrong

```ts
const [nodes, setNodes] = useState(defaultNodes);
```

Local-only nodes do not satisfy the persisted ProductFlow workflow contract.

#### Correct

```ts
const workflowQuery = useQuery({
  queryKey: ["inspiration-workflow", inspirationId],
  queryFn: () => api.getInspirationWorkflow(inspirationId),
});
```

Load the persisted workflow and keep only transient selection/edit drafts in local state.

#### Wrong

```ts
dynamic_fields: Object.fromEntries(draft.dynamicFields.map((field) => [field.key, field.value]));
```

This sends blank keys and converts booleans/null/numbers into strings, so backend normalization rejects or weakens the
context contract.

#### Correct

```ts
dynamic_fields: dynamicFieldsToConfig(draft.dynamicFields);
```

Centralize inspiration-context serialization so blank keys are dropped and scalar strings are converted before the PATCH.

#### Wrong

```tsx
Object.entries(node.output_json).map(([key, value]) => <div>{key}: {String(value)}</div>);
```

This leaks internal artifact IDs and prompt-like implementation detail into the inspiration UI.

#### Correct

```tsx
const facts = [`图片 ${posterCount}`, `参考图 ${filledCount}`, size].filter(Boolean);
```

Render concise, user-facing facts and keep raw workflow JSON as an API/debug boundary, not normal UI copy.

#### Wrong

```tsx
setNodeDrag(null);
updateWorkflowNode(node.id, { position_x: x, position_y: y });
```

If the render path falls back to the still-stale query data after `setNodeDrag(null)`, the node flashes back to the old
position until the mutation/refetch completes.

#### Correct

```tsx
setOptimisticNodePositions((positions) => ({ ...positions, [node.id]: { x, y } }));
queryClient.setQueryData(["inspiration-workflow", inspirationId], moveNodeInCache(node.id, x, y));
updateWorkflowNode(node.id, { position_x: x, position_y: y });
```

Keep a short-lived optimistic coordinate and cache update during the mutation, then replace it with the server-returned
workflow on success or restore the previous cache on error.

#### Wrong

```tsx
const busy = runWorkflowMutation.isPending || updateNodePositionMutation.isPending;
if (busy) return;
```

This makes a long async workflow run feel like a frozen canvas even though persisted run/node status is available through
polling.

#### Correct

```tsx
const workflowActive = hasActiveWorkflow(workflow);
const runSubmissionPending =
  runWorkflowMutation.isPending || retryWorkflowRunMutation.isPending || retryFailedWorkflowNodesMutation.isPending;
const selectedNodeRunAction = getWorkflowNodeRunActionState(selectedNode, {
  runSubmissionPending,
  pendingStartNodeId,
});
const dragBusy = updateNodePositionMutation.isPending;
const structureBusy = layoutMutationBusy || workflowActive;
```

Use persisted workflow activity to control polling and unsafe structural mutations. Use node status plus submission
pending state for individual node run actions, while keeping layout dragging independent from provider execution.

## Scenario: Inspiration canvas gallery modal

### 1. Scope / Trigger
- Trigger: editing `InspirationDetailPage`, `pages/inspiration-detail/ImagesPanel.tsx`, image preview/download helpers,
  reference-node fill actions, or personal resource-library save actions exposed from the canvas gallery.
- This scope is the current inspiration's derived gallery only. It is not the global `/gallery` page and must not inherit
  global gallery filters or management behavior.

### 2. Signatures
- Entry state: `InspirationDetailPage` uses `galleryOpen` and opens `ImagesPanel` directly from the canvas Images/Gallery
  sidebar action.
- Component: `ImagesPanel({ open, onClose, inspiration, posters, referenceAssets, ... })`.
- Data sources: current `InspirationDetail.poster_variants` plus current inspiration `SourceAsset` records that are image
  references.
- Fill actions: `api.bindWorkflowNodeImage(nodeId, { source_asset_id })` or
  `api.bindWorkflowNodeImage(nodeId, { poster_variant_id })`.

### 3. Contracts
- The canvas gallery opens as a page-level modal, not as an inline right-toolbar grid and not through a second nested
  "open gallery" button.
- The modal is scoped to the current inspiration. It must not render a supplier/provider/generated resource-group filter.
- A generated resource-group badge on an image card is display metadata only; it must not become a filtering control in
  the canvas modal.
- Personal resource library remains separate: save-to-library actions may appear on individual image cards, while
  resource-library selection opens from image-bearing slots such as `reference_image` upload areas.
- The global `/gallery` page may keep its own gallery-specific list/filter behavior; do not reuse `GalleryPage` inside the
  canvas modal.

### 4. Validation & Error Matrix
- Clicking the canvas Images/Gallery entry -> `galleryOpen=true` and a modal with the current inspiration images appears.
- No selected `reference_image` node -> preview/download still work, fill action is disabled with the existing select-node
  hint.
- Current inspiration has no images -> modal shows the image empty state, not a global gallery list.
- Adding `api.listGalleryEntries(...)`, `resource_group_id`, or generation-group select state to `ImagesPanel` -> wrong
  boundary; the modal is no longer scoped to current inspiration data.

### 5. Good/Base/Bad Cases
- Good: `ImagesPanel` receives already-derived `posters` and `referenceAssets` from `InspirationDetailPage`.
- Good: each card can preview, download, fill the selected reference node, and save that one image to resource library.
- Base: generated image cards may show their source generation group as passive metadata.
- Bad: adding supplier/provider group dropdowns, "all groups" filters, or global gallery API queries to the canvas modal.
- Bad: placing the resource-library picker under the canvas gallery button instead of under image upload/selection slots.

### 6. Tests Required
- Frontend build must type-check `ImagesPanel` props whenever the modal contract changes.
- Images-tab regressions should cover direct modal open/close, absence of resource-group/provider filters, preview action,
  reference fill for both source assets and poster variants, and per-card save-to-resource-library action.
- Manual browser verification should check the canvas toolbar entry opens one modal immediately and never shows a second
  "打开图库" step.

### 7. Wrong vs Correct

#### Wrong

```tsx
<GalleryPage mode="modal" />
```

This imports global gallery list/filter semantics into the inspiration canvas.

#### Correct

```tsx
<ImagesPanel open={galleryOpen} posters={posters} referenceAssets={referenceAssets} />
```

Keep the modal fed by the current inspiration detail payload.

#### Wrong

```tsx
api.listGalleryEntries({ resource_group_id: selectedResourceGroupId })
```

#### Correct

```tsx
const artifactCount = posters.length + referenceAssets.length;
```

Canvas gallery content is derived locally from the current inspiration.

## Scenario: Tail splitter confirmation UX

### 1. Scope / Trigger
- Trigger: InspirationDetail changes that introduce `tail_splitter` nodes, tail split-plan preview/apply flows, workflow run
  modes, or waiting-confirmation status displays.

### 2. Signatures
- `WorkflowNode.node_type` includes `tail_splitter`.
- `WorkflowRun.status` includes `waiting_confirmation`.
- `WorkflowRunStartMode = "from_node" | "after_node"`.
- API contracts:
  - `api.runInspirationWorkflow(inspirationId, { start_node_id?, start_mode? })`
  - `api.retryFailedWorkflowNodes(inspirationId)`
  - `api.applyTailSplitPlan(nodeId, { plan_id, item_ids?, items?, image_generation_config?, position_x?, position_y?,
    reuse_public_copy_node?, reuse_public_reference_node? })`
  - `items` entries are `{ id: string; instruction?: string | null }` and take precedence over `item_ids`.
  - `image_generation_config` entries are one shared image-generation config for all image trigger nodes created by the
    confirmed tail plan.
- Tail node data:
  - `config_json` carries editable split input fields (for example source text/description/max items).
  - `output_json.latest_plan` carries pending/applied split-plan payload.
- Tail max item input must read `/api/settings/runtime.generation_tail_splitter_max_items`; do not hardcode the old 12
  item UI limit.
- Tail max item copy must describe the value as the upper bound AI may output, not a required count. The user-facing label
  can say `最多拆分数` / max split items, and helper text should clarify the actual count depends on content.

### 3. Contracts
- InspirationDetail must expose tail nodes as first-class ordinary nodes in add-node, node labels, iconography, and inspector.
- Node toolbars should expose two run actions for single nodes: `运行此节点` and
  `从此节点开始运行后面的节点`. The downstream action submits `start_mode="after_node"` and does not rerun
  the selected node itself.
- Running a tail node should produce a pending split plan and a `waiting_confirmation` run that is visible and cancelable
  before graph expansion.
- The split-plan dialog shows plan items with remove-selection controls and editable instruction text. Confirm submits
  selected `{id, instruction}` entries; cancel keeps the graph unchanged.
- The split-plan dialog also exposes one shared image-generation configuration section: generation config auto/manual
  selector, size controls, and allowed image tool options. Confirm submits that same config for every generated
  `image_generation` node; legacy clients may omit it.
- When the current tail node already has previous generated public copy/reference nodes, the split-plan dialog must expose
  checkbox controls for reusing each public node. Checked reuse options are submitted as
  `reuse_public_copy_node` / `reuse_public_reference_node`, and the UI should default them on so previously valuable
  shared outputs are not discarded accidentally. If no previous public node exists for a role, omit that option from the
  dialog.
- The Inspector `max_items` number control may show the runtime global limit as helper text, but backend validation remains
  authoritative because users can type values beyond the HTML `max` attribute.
- RunsPanel shows a `重跑失败节点` action only when the current workflow has failed nodes. The action is disabled if any
  failed node is not retryable, uses backend `node.is_retryable` as the source of truth, and calls
  `api.retryFailedWorkflowNodes(inspirationId)` after flushing the current selected-node draft.
- InspirationDetail must not duplicate retry-delay math in the browser. Backend `node.is_retryable` and
  `node.non_retryable_reason` are authoritative for both retry-count limits and `workflow_node_retry_delay_ms` cooldown.
- Waiting confirmation must display a distinct status label and queue text so the user can tell the system is waiting for
  their confirmation rather than provider capacity.
- Tail apply mutation invalidates/refreshes `["inspiration-workflow", inspirationId]` and selects a sensible post-apply focus
  (applied tail node or newly generated branch anchor) without losing page context.
- Manual tail apply path must not auto-apply all items when the dialog has explicit item removals or edited instructions.
- After confirmation, generated branch nodes are ordinary idle/editable nodes. The waiting run should leave active polling
  once the backend returns a terminal run with no pending confirmation; generated downstream execution is started later by
  an explicit `start_mode="after_node"` run.
- Workflow run and tail apply permission failures surface backend `ApiError.detail` clearly (for example `没有接口权限`)
  near the action that failed.

### 4. Validation & Error Matrix
- Tail apply called with stale/non-pending plan -> show backend detail and keep dialog open for user correction/refresh.
- Tail apply called with zero selected items -> prevent submit locally or show backend validation detail.
- Tail apply called with a blank edited instruction -> show backend detail and keep the user's draft visible.
- Run status `waiting_confirmation` -> show waiting-confirmation styling, active polling, and cancel affordance when the
  backend marks the run cancelable.
- User lacks `inspirations:write` -> tail apply returns `403`; InspirationDetail shows permission error without clearing current
  tail plan view.
- User lacks `inspirations:generate` -> run action returns `403`; InspirationDetail shows permission error on run controls.

### 5. Good/Base/Bad Cases
- Good: user runs tail, edits one plan-item instruction, deselects another item, confirms, and only selected image branches
  are created with edited instructions while remaining idle for review/editing.
- Good: user reruns a tail node, keeps the previous shared copy/reference checkboxes selected, confirms the new plan, and
  sees those public nodes still connected to the new image branches.
- Good: user chooses `从此节点开始运行后面的节点` on a tail node's previous generated branch anchor to avoid
  re-running the tail itself.
- Good: a run card clearly shows `waiting_confirmation`, not a generic queued/running capacity message.
- Base: user cancels dialog and the workflow graph remains unchanged.
- Bad: opening tail plan dialog immediately creates nodes before confirmation.
- Bad: confirming a tail plan immediately changes generated nodes to `queued` / `running`.
- Bad: the downstream run action submits only `start_node_id` and reruns the selected node.
- Bad: treating `waiting_confirmation` as terminal and stopping status polling while the run is still cancelable.

### 6. Tests Required
- `defaultConfigForType("tail_splitter")` and node label/icon/display contract tests.
- InspirationDetail helper tests for `运行此节点` and downstream-run toolbar actions.
- InspirationDetail tests for pending-plan dialog open/cancel/confirm, edited-instruction payload, and selected-item payload.
- InspirationDetail or API-backed regression proving tail public-node reuse sends the reuse flags and preserves previous
  public-node outputs.
- InspirationDetail or API-backed regression proving tail confirmation leaves generated nodes idle until manual downstream run.
- Workflow status helper tests proving `waiting_confirmation` is active and has distinct queue text.
- API contract test for `applyTailSplitPlan` request shape.
- Build gate: `pnpm --dir web lint`, `pnpm --dir web test:run`, and `just web-build`.

### 7. Wrong vs Correct

#### Wrong

```tsx
runInspirationWorkflow(inspirationId, { start_node_id: nodeId });
onTailRunSuccess(() => applyTailSplitPlan(nodeId, { plan_id, item_ids: allItemIds }));
```

This reruns the selected node for downstream-run flows and removes user confirmation, instruction editing, and item
filtering.

#### Correct

```tsx
runInspirationWorkflow(inspirationId, { start_node_id: nodeId, start_mode: "after_node" });
applyTailSplitPlan(nodeId, {
  plan_id: plan.plan_id,
  items: selectedItems.map((item) => ({ id: item.id, instruction: drafts[item.id] })),
});
```

The downstream run action uses an explicit start mode. Tail apply sends the user's confirmed item/instruction choices and
does not start generated nodes automatically.

## Scenario: Autosaved direct image workbench

### 1. Scope / Trigger
- Trigger: InspirationDetail workbench changes for image-node execution, autosave, panel sizing, or canvas zoom.

### 2. Signatures
- `api.listProducts({ page, page_size })` drives paginated inspiration lists and returns thumbnail URLs.
- `api.runInspirationWorkflow(inspirationId, { start_node_id })` may target an image node whose only required upstream is inspiration
  context.
- Local UI persistence keys: `inspiration-one.workflow.zoom` and `inspiration-one.workflow.inspectorWidth`.

### 3. Contracts
- The add-node toolbar must not expose `inspiration_context`; one inspiration context exists per active workflow.
- Node draft edits debounce-save through `updateWorkflowNode(...)`; run-all and run-selected must flush the selected draft
  before calling `runInspirationWorkflow(...)`.
- Image-node inspector copy should only show the downstream reference-slot requirement when no slot is connected; do not
  show internal graph counts such as upstream-node totals. Node cards should show status and any failure reason, not
  generated-summary prose, raw coordinates, or image previews for `image_generation` nodes.
- ReactFlow viewport zoom transforms visual coordinates, while drag persistence must keep backend positions in unscaled
  workflow coordinates.
- Mouse wheel and pinch events inside the canvas viewport should zoom the ReactFlow canvas within shared zoom bounds and
  persist the value under `inspiration-one.workflow.zoom`. Controls/forms/buttons should not trigger unexpected zoom.
- The shared minimum zoom must be low enough for mobile all-nodes overview. Do not set a floor such as 50% that prevents
  ReactFlow `fitView` from fitting the current workflow into a narrow mobile viewport.
- Canvas zoom controls must be a floating overlay anchored inside the ReactFlow canvas viewport through ReactFlow `Panel`
  or an equivalent ReactFlow child component. Zoom display should read ReactFlow viewport state through native hooks such
  as `useViewport`, and durable zoom persistence should be tied to ReactFlow viewport change end events.
- Canvas view-fitting controls should use ReactFlow instance viewport helpers such as `fitView` with node id filters for
  all-nodes and selected-node focus. Do not calculate viewport transforms manually for these standard view operations.
- Run history and downloadable images live in the right sidebar, not in a persistent bottom panel, so the canvas keeps its
  vertical working space.

### 4. Validation & Error Matrix
- Autosave error -> show local `ApiError.detail`, keep user draft visible, and allow explicit retry/save.
- Run clicked while selected draft is dirty -> save first; if save fails, do not run stale config.
- Zoomed canvas drag -> persisted `position_x` / `position_y` are unscaled workflow coordinates.

### 5. Good/Base/Bad Cases
- Good: edit image instruction, immediately click run, and backend receives the new instruction.
- Base: resize the right sidebar, refresh, and see the same local width.
- Base: pan or zoom the canvas and the zoom controls stay visually anchored over the canvas viewport.
- Bad: showing generated image preview/download on an `image_generation` node instead of on linked reference slots.
- Bad: placing zoom controls in the top toolbar or scrollable canvas flow so they move with workflow content.

### 6. Tests Required
- `just web-build` for DTO/type compatibility.
- Backend API tests for direct image-node run and singleton inspiration context, because frontend relies on those contracts.

### 7. Wrong vs Correct
#### Wrong

```tsx
onClick={() => runWorkflowMutation.mutate(selectedNode.id)}
```

#### Correct

```tsx
onClick={() => void handleRunWorkflow(selectedNode.id)} // flushes selected draft first
```
