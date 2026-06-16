export type InspirationWorkflowState = "draft" | "copy_ready" | "poster_ready" | "failed";
export type CopyStatus = "draft" | "confirmed";
export type PosterKind = "main_image" | "promo_poster";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type SourceAssetKind =
  | "original_image"
  | "reference_image"
  | "processed_inspiration_image"
  | "context_image"
  | "context_document";
export type ImageSessionAssetKind = "reference_upload" | "generated_image";
export type ResourceLibraryAssetKind = "image" | "document" | "other";
export type ResourceLibrarySourceType = "source_asset" | "poster_variant" | "image_session_asset" | "upload";
export type GenerationConfigSelectionMode = "auto" | "manual";
export type WorkflowNodeType =
  | "inspiration_context"
  | "reference_image"
  | "copy_generation"
  | "image_generation"
  | "tail_splitter";
export type CanvasTemplateWorkflowNodeType = WorkflowNodeType;
export type InspirationInitialWorkflowEntry = "image" | "copy" | "tail" | "blank";
export type CanvasTemplateEntryMode = Exclude<InspirationInitialWorkflowEntry, "blank">;
export type WorkflowNodeStatus = "idle" | "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type WorkflowNodeRunStatusValue = WorkflowNodeStatus;
export type WorkflowRunStatus = "running" | "waiting_confirmation" | "succeeded" | "failed" | "cancelled";
export type TaskNotificationKind = "image_session_generation" | "inspiration_workflow";
export type TaskNotificationStatus = "succeeded" | "failed" | "cancelled" | "attempt_failed";
export type WorkflowRunStartMode = "from_node" | "after_node";
export type WorkflowRetryHint = "retry_later" | "revise_input" | "check_settings";
export type CanvasTemplateKind = "full_canvas" | "node_group";
export type CanvasTemplateScope = "global" | "user";
export type CanvasTemplateReviewStatus = "none" | "pending" | "approved" | "rejected";
export type CurrentWeatherCondition =
  | "clear"
  | "partly_cloudy"
  | "cloudy"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "thunderstorm";
export type WeatherSourceId = "open_meteo";
export type CanvasTemplateScenario =
  | "main_image"
  | "taobao_main_image"
  | "xiaohongshu_image"
  | "multi_angle"
  | "sku_variant"
  | "feature_infographic"
  | "size_spec"
  | "scale_reference"
  | "package_checklist"
  | "usage_steps"
  | "comparison"
  | "model_lifestyle"
  | "scene_image"
  | "detail_material"
  | "campaign_promotion"
  | "short_video_cover"
  | "white_background";

export interface ModerationFields {
  enabled?: boolean;
  disabled_at?: string | null;
  disabled_by_user_id?: string | null;
  disabled_by_username?: string | null;
  disabled_reason?: string | null;
  effective_enabled?: boolean;
  effective_disabled_resource_type?: string | null;
  effective_disabled_resource_id?: string | null;
  effective_disabled_reason?: string | null;
  deleted_at?: string | null;
  deleted_by_user_id?: string | null;
}

export type ResourceModerationType =
  | "inspiration"
  | "source_asset"
  | "poster_variant"
  | "image_session"
  | "image_session_asset"
  | "image_gallery_entry"
  | "resource_library_asset"
  | "canvas_template"
  | "canvas_template_category";

export interface ResourceModerationUpdateInput {
  enabled: boolean;
  reason?: string | null;
}

export interface ResourceModerationResponse extends ModerationFields {
  resource_type: ResourceModerationType;
  resource_id: string;
  owner_user_id: string | null;
  owner_username: string | null;
  enabled: boolean;
  effective_enabled: boolean;
}

export interface SessionState {
  authenticated: boolean;
  access_required: boolean;
  user?: SessionUser | null;
  menus?: SessionMenu[];
  api_permissions?: string[];
}

export interface SessionUser {
  id: string;
  username: string;
  display_name: string;
  role_id: string;
  is_admin: boolean;
  enabled: boolean;
  password_pending: boolean;
}

export interface SessionMenu {
  code: string;
  title: string;
  sort_order: number;
}

export interface WeatherCoordinates {
  latitude: number;
  longitude: number;
}

export interface WeatherLocation extends WeatherCoordinates {
  id?: number | null;
  name: string;
  country?: string | null;
  admin1?: string | null;
  timezone?: string | null;
}

export interface CurrentWeather {
  weather_code: number;
  condition: CurrentWeatherCondition;
  temperature_celsius: number | null;
  humidity_percent?: number | null;
  pressure_hpa?: number | null;
  is_day: boolean;
  observed_at?: string | null;
  timezone?: string | null;
}

export interface TaskNotificationEvent {
  type: "task_notification";
  event_id: string;
  task_kind: TaskNotificationKind;
  task_id: string;
  owner_user_id: string;
  status: TaskNotificationStatus;
  title: string;
  failure_reason: string | null;
  finished_at: string | null;
  resource_id: string;
  generation_config_id: string | null;
  generation_config_name: string | null;
  resource_group_id: string | null;
  resource_group_name: string | null;
  attempt: number | null;
  max_attempts: number | null;
  next_attempt: number | null;
  node_id: string | null;
  node_title: string | null;
}

export interface RbacUser {
  id: string;
  username: string;
  display_name: string;
  role_id: string;
  role_name: string;
  is_admin: boolean;
  enabled: boolean;
  password_pending: boolean;
  password_setup_token?: string | null;
  resource_groups: GenerationResourceGroupTag[];
  archived_at?: string | null;
}

export interface RbacRole {
  id: string;
  code: string;
  name: string;
  is_admin: boolean;
  user_count: number;
  archived_at?: string | null;
}

export interface RbacUserListResponse {
  items: RbacUser[];
  total: number;
  page: number;
  page_size: number;
}

export interface RbacMenuPermission {
  code: string;
  title: string;
  sort_order: number;
  enabled: boolean;
}

export interface RbacApiPermission {
  code: string;
  menu_code: string;
  title: string;
  description: string;
  sort_order: number;
  enabled: boolean;
}

export interface RbacPermissionCatalog {
  menus: RbacMenuPermission[];
  api_permissions: RbacApiPermission[];
}

export interface RbacRolePermissions {
  role_id: string;
  menu_codes: string[];
  api_permission_codes: string[];
}

export interface UserGenerationResourceGroupGrants {
  user_id: string;
  resource_group_ids: string[];
}

export interface CreateTrustedUserRequest {
  username: string;
  display_name?: string | null;
  role_id?: string | null;
}

export interface CreateRoleRequest {
  code: string;
  name: string;
}

export interface SourceAsset extends ModerationFields {
  id: string;
  kind: SourceAssetKind;
  original_filename: string;
  mime_type: string;
  source_poster_variant_id?: string | null;
  download_url: string;
  preview_url: string;
  thumbnail_url: string;
  created_at: string;
}

export interface GenerationResourceGroup {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  sort_order: number;
  enabled: boolean;
  blur_images_by_default: boolean;
  archived_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface GenerationResourceGroupTag {
  id: string;
  key: string;
  name: string;
  blur_images_by_default?: boolean;
}

export interface GenerationResourceGroupCreateRequest {
  key: string;
  name: string;
  description?: string | null;
  sort_order?: number;
  enabled?: boolean;
  blur_images_by_default?: boolean;
}

export interface GenerationResourceGroupUpdateRequest {
  key?: string | null;
  name?: string | null;
  description?: string | null;
  sort_order?: number | null;
  enabled?: boolean | null;
  blur_images_by_default?: boolean | null;
}

export interface CreativeBriefSummary {
  id: string;
  payload: {
    positioning?: string;
    audience?: string;
    selling_angles?: string[];
    taboo_phrases?: string[];
    poster_style_hint?: string;
    [key: string]: unknown;
  };
  provider_name: string;
  model_name: string;
  prompt_version: string;
  resource_group_id?: string | null;
  resource_group: GenerationResourceGroupTag;
  created_at: string;
}

export interface CopyBlock {
  id: string;
  role?: string | null;
  label?: string | null;
  text: string;
  note?: string | null;
  visual_hint?: string | null;
  priority?: number | null;
}

export interface CopySection {
  id: string;
  title?: string | null;
  body?: string | null;
  items: CopyBlock[];
  visual_hint?: string | null;
}

export type CopyContent =
  | { kind: "freeform"; text: string }
  | { kind: "blocks"; blocks: CopyBlock[] }
  | { kind: "layout_brief"; sections: CopySection[] };

export interface VisualGuidance {
  main_message?: string | null;
  hierarchy: string[];
  composition_hint?: string | null;
  text_density?: "none" | "low" | "medium" | "high" | null;
  avoid: string[];
}

export interface CopyPayloadV2 {
  version: 2;
  purpose?: string | null;
  summary: string;
  content: CopyContent;
  visual_guidance?: VisualGuidance | null;
}

export interface CopySet {
  id: string;
  creative_brief_id: string | null;
  status: CopyStatus;
  structured_payload: CopyPayloadV2;
  model_structured_payload: CopyPayloadV2 | null;
  provider_name: string;
  model_name: string;
  prompt_version: string;
  resource_group_id?: string | null;
  resource_group: GenerationResourceGroupTag;
  created_at: string;
  updated_at: string;
  edited_at: string | null;
  confirmed_at: string | null;
}

export interface PosterVariant extends ModerationFields {
  id: string;
  inspiration_id: string;
  copy_set_id: string;
  kind: PosterKind;
  template_name: string;
  mime_type: string;
  width: number;
  height: number;
  resource_group_id?: string | null;
  resource_group: GenerationResourceGroupTag;
  download_url: string;
  preview_url: string;
  thumbnail_url: string;
  created_at: string;
}

export interface InspirationSummary extends ModerationFields {
  id: string;
  owner_user_id?: string;
  owner_username?: string | null;
  resource_group_id: string;
  resource_group: GenerationResourceGroupTag;
  name: string;
  category: string | null;
  price: string | null;
  workflow_state: InspirationWorkflowState;
  latest_copy_status: CopyStatus | null;
  latest_poster_at: string | null;
  source_image_filename: string | null;
  source_image_download_url: string | null;
  source_image_preview_url: string | null;
  source_image_thumbnail_url: string | null;
  initial_workflow_entry: InspirationInitialWorkflowEntry | null;
  initial_entry_text: string | null;
  initial_entry_text_excerpt: string | null;
  latest_generated_image_download_url: string | null;
  latest_generated_image_preview_url: string | null;
  latest_generated_image_thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface InspirationListResponse {
  items: InspirationSummary[];
  total: number;
  page: number;
  page_size: number;
}

export interface InspirationDetail extends ModerationFields {
  id: string;
  owner_user_id?: string;
  owner_username?: string | null;
  resource_group_id: string;
  resource_group: GenerationResourceGroupTag;
  name: string;
  category: string | null;
  price: string | null;
  source_note: string | null;
  workflow_state: InspirationWorkflowState;
  source_assets: SourceAsset[];
  latest_brief: CreativeBriefSummary | null;
  current_confirmed_copy_set: CopySet | null;
  copy_sets: CopySet[];
  poster_variants: PosterVariant[];
  created_at: string;
  updated_at: string;
}

export interface InspirationHistory {
  copy_sets: CopySet[];
  poster_variants: PosterVariant[];
}

export interface CreateInspirationInput {
  name: string;
  resource_group_id: string;
  category?: string;
  price?: string;
  source_note?: string;
  long_text?: string;
  dynamic_fields?: Record<string, string | number | boolean | null>;
  canvas_template_key?: string;
  initial_workflow_entry?: InspirationInitialWorkflowEntry;
  entry_text?: string;
  file?: File;
  contextDocumentFile?: File;
  referenceFiles?: File[];
}

export interface TailSplitPlanItem {
  id: string;
  order: number;
  title: string;
  instruction: string;
  visual_intent: string;
  source_refs: string[];
}

export interface TailSplitPlan {
  version: 1;
  plan_id: string;
  status: "pending" | "applied";
  source_summary: string;
  items: TailSplitPlanItem[];
  created_at: string;
}

export interface TailAppliedBatch {
  batch_id: string;
  plan_id: string;
  item_ids: string[];
  node_ids: string[];
  created_at: string;
}

export interface TailSplitterOutput {
  summary: string;
  latest_plan: TailSplitPlan | null;
  applied_batches: TailAppliedBatch[];
  [key: string]: unknown;
}

export interface WorkflowNode {
  id: string;
  workflow_id: string;
  node_type: WorkflowNodeType;
  title: string;
  position_x: number;
  position_y: number;
  config_json: Record<string, unknown>;
  status: WorkflowNodeStatus;
  output_json: Record<string, unknown> | null;
  failure_reason: string | null;
  is_retryable: boolean;
  attempt_count: number;
  retry_count: number;
  non_retryable_reason: string | null;
  retry_hint: WorkflowRetryHint | null;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowEdge {
  id: string;
  workflow_id: string;
  source_node_id: string;
  target_node_id: string;
  source_handle: string | null;
  target_handle: string | null;
  created_at: string;
}

export interface WorkflowNodeRun {
  id: string;
  workflow_run_id: string;
  node_id: string;
  status: WorkflowNodeRunStatusValue;
  output_json: Record<string, unknown> | null;
  failure_reason: string | null;
  copy_set_id: string | null;
  poster_variant_id: string | null;
  image_session_asset_id: string | null;
  resource_group_id?: string | null;
  resource_group: GenerationResourceGroupTag;
  started_at: string;
  finished_at: string | null;
}

export interface WorkflowNodeRunStatus {
  id: string;
  workflow_run_id: string;
  node_id: string;
  status: WorkflowNodeRunStatusValue;
  failure_reason: string | null;
  resource_group_id?: string | null;
  resource_group: GenerationResourceGroupTag;
  started_at: string;
  finished_at: string | null;
}

export interface WorkflowRun {
  id: string;
  workflow_id: string;
  status: WorkflowRunStatus;
  started_at: string;
  finished_at: string | null;
  failure_reason: string | null;
  progress_metadata: Record<string, unknown> | null;
  is_retryable: boolean;
  is_cancelable: boolean;
  queue_active_count: number;
  queue_running_count: number;
  queue_queued_count: number;
  queue_max_concurrent_tasks: number;
  queued_ahead_count: number | null;
  queue_position: number | null;
  node_runs: WorkflowNodeRun[];
}

export interface WorkflowRunStatusSummary {
  id: string;
  workflow_id: string;
  status: WorkflowRunStatus;
  started_at: string;
  finished_at: string | null;
  failure_reason: string | null;
  progress_metadata: Record<string, unknown> | null;
  is_retryable: boolean;
  is_cancelable: boolean;
  queue_active_count: number;
  queue_running_count: number;
  queue_queued_count: number;
  queue_max_concurrent_tasks: number;
  queued_ahead_count: number | null;
  queue_position: number | null;
  node_runs: WorkflowNodeRunStatus[];
}

export interface WorkflowNodeStatusSummary {
  id: string;
  workflow_id: string;
  status: WorkflowNodeStatus;
  failure_reason: string | null;
  is_retryable: boolean;
  attempt_count: number;
  retry_count: number;
  non_retryable_reason: string | null;
  retry_hint: WorkflowRetryHint | null;
  last_run_at: string | null;
  updated_at: string;
}

export interface InspirationWorkflow {
  id: string;
  inspiration_id: string;
  title: string;
  active: boolean;
  initial_entry_mode?: InspirationInitialWorkflowEntry;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  runs: WorkflowRun[];
  created_at: string;
  updated_at: string;
}

export interface InspirationWorkflowStatus {
  id: string;
  inspiration_id: string;
  title: string;
  active: boolean;
  initial_entry_mode?: InspirationInitialWorkflowEntry;
  has_active_workflow: boolean;
  nodes: WorkflowNodeStatusSummary[];
  runs: WorkflowRunStatusSummary[];
  created_at: string;
  updated_at: string;
}

export interface CanvasTemplateScenarioMetadata {
  scenario: CanvasTemplateScenario;
  title: string;
  description: string;
  ecommerce_stage: string;
  tags: string[];
}

export interface CanvasTemplateOutputSlot {
  node_key: string;
  label: string;
  description: string;
}

export interface CanvasTemplateReferenceInputHint {
  node_key: string;
  role: string;
  label: string;
  required: boolean;
  description: string;
}

export interface CanvasTemplateSuggestedConnection {
  source_node_key: string;
  target_node_key: string;
  reason: string;
}

export interface CanvasTemplateDefaultExternalConnection {
  source: "existing_inspiration_context";
  target_node_key: string;
  label: string;
}

export interface CanvasTemplatePreviewNode {
  key: string;
  node_type: CanvasTemplateWorkflowNodeType;
  title: string;
  position_x: number;
  position_y: number;
  size: string | null;
}

export interface CanvasTemplatePreviewEdge {
  source_node_key: string;
  target_node_key: string;
}

export interface CanvasTemplateSummary {
  key: string;
  template_id?: string | null;
  version: number;
  kind: CanvasTemplateKind;
  entry_mode: CanvasTemplateEntryMode;
  sort_order: number;
  title: string;
  description: string;
  source: "builtin" | "user";
  user_template_id: string | null;
  scope?: CanvasTemplateScope | null;
  category_id?: string | null;
  category_name?: string | null;
  owner_user_id?: string | null;
  owner_username?: string | null;
  enabled?: boolean;
  effective_enabled?: boolean;
  disabled_reason?: string | null;
  review_status?: CanvasTemplateReviewStatus;
  review_note?: string | null;
  review_submitted_at?: string | null;
  reviewed_at?: string | null;
  reviewed_by_user_id?: string | null;
  reviewed_by_username?: string | null;
  scenario: CanvasTemplateScenarioMetadata;
  preview_nodes: CanvasTemplatePreviewNode[];
  preview_edges: CanvasTemplatePreviewEdge[];
  output_slots: CanvasTemplateOutputSlot[];
  reference_input_hints: CanvasTemplateReferenceInputHint[];
  suggested_connections: CanvasTemplateSuggestedConnection[];
  default_external_connections: CanvasTemplateDefaultExternalConnection[];
}

export interface CanvasTemplateListResponse {
  items: CanvasTemplateSummary[];
}

export interface CanvasTemplateCategory {
  id: string;
  scope: CanvasTemplateScope;
  owner_user_id: string | null;
  owner_username: string | null;
  name: string;
  sort_order: number;
  enabled: boolean;
  effective_enabled: boolean;
  disabled_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface CanvasTemplateCategoryListResponse {
  items: CanvasTemplateCategory[];
}

export interface CreateCanvasTemplateCategoryInput {
  name: string;
  sort_order?: number;
}

export interface UpdateCanvasTemplateCategoryInput {
  name?: string;
  sort_order?: number;
}

export interface CreateGlobalCanvasTemplateInput {
  key: string;
  title: string;
  description?: string;
  kind: CanvasTemplateKind;
  entry_mode?: CanvasTemplateEntryMode;
  sort_order?: number;
  category_id?: string | null;
  template_json?: Record<string, unknown>;
  enabled?: boolean;
}

export interface UpdateGlobalCanvasTemplateInput {
  title?: string;
  description?: string;
  kind?: CanvasTemplateKind;
  entry_mode?: CanvasTemplateEntryMode;
  sort_order?: number;
  category_id?: string | null;
  template_json?: Record<string, unknown>;
  enabled?: boolean;
  disabled_reason?: string | null;
}

export interface ApplyWorkflowTemplateGroupInput {
  template_key: string;
  position_x: number;
  position_y: number;
}

export interface ApplyTailSplitPlanItemInput {
  id: string;
  instruction: string;
}

export interface ApplyTailSplitPlanImageGenerationConfigInput {
  size?: string | null;
  resource_group_id?: string | null;
  generation_config_mode?: GenerationConfigSelectionMode;
  generation_config_id?: string | null;
  tool_options?: ImageToolOptions | null;
}

export interface ApplyTailSplitPlanReuseOptions {
  reuse_public_copy_node: boolean;
  reuse_public_reference_node: boolean;
}

export interface ApplyTailSplitPlanInput {
  plan_id: string;
  item_ids?: string[];
  items?: ApplyTailSplitPlanItemInput[];
  image_generation_config?: ApplyTailSplitPlanImageGenerationConfigInput | null;
  position_x?: number;
  position_y?: number;
  reuse_public_copy_node?: boolean;
  reuse_public_reference_node?: boolean;
}

export interface CreateUserTemplateGroupInput {
  title: string;
  description?: string;
  node_ids: string[];
  category_id?: string | null;
}

export interface CreateUserCanvasTemplateInput {
  title: string;
  description?: string;
  category_id: string;
  retain_prompt_text?: boolean;
  sort_order?: number;
}

export interface UpdateUserTemplateGroupInput {
  title?: string;
  description?: string;
  category_id?: string | null;
  sort_order?: number;
  enabled?: boolean;
  disabled_reason?: string | null;
  review_note?: string | null;
}

export interface CopyUserTemplateToGlobalInput {
  category_id: string;
  title?: string;
  description?: string;
  sort_order?: number;
}

export interface ReviewUserTemplateGroupInput {
  approved: boolean;
  disabled_reason?: string | null;
}

export interface CopySetUpdateRequest {
  structured_payload: CopyPayloadV2;
}

export interface ImageSessionAsset extends ModerationFields {
  id: string;
  owner_user_id?: string;
  kind: ImageSessionAssetKind;
  original_filename: string;
  mime_type: string;
  download_url: string;
  preview_url: string;
  thumbnail_url: string;
  gallery_saved: boolean;
  gallery_entry_id: string | null;
  created_at: string;
}

export interface ImageSessionRound {
  id: string;
  prompt: string;
  assistant_message: string;
  size: string;
  model_name: string;
  provider_name: string;
  prompt_version: string;
  provider_response_id: string | null;
  previous_response_id: string | null;
  image_generation_call_id: string | null;
  generation_config_id: string | null;
  resource_group_id?: string | null;
  resource_group: GenerationResourceGroupTag;
  generation_group_id: string | null;
  candidate_index: number;
  candidate_count: number;
  base_asset_ids: string[];
  base_asset_id: string | null;
  selected_reference_asset_ids: string[];
  actual_size: string | null;
  provider_notes: string[];
  generated_asset: ImageSessionAsset;
  created_at: string;
}

export interface ImageToolOptions {
  model?: string | null;
  quality?: "auto" | "low" | "medium" | "high" | null;
  output_format?: "png" | "jpeg" | "webp" | null;
  output_compression?: number | null;
  background?: "auto" | "opaque" | "transparent" | null;
  moderation?: "auto" | "low" | null;
  action?: "auto" | "generate" | "edit" | null;
  input_fidelity?: "low" | "high" | null;
  partial_images?: number | null;
  n?: number | null;
}

export type ImageToolOptionKey = keyof ImageToolOptions;

export interface ImageSessionGenerationTask {
  id: string;
  session_id: string;
  status: JobStatus;
  prompt: string;
  size: string;
  base_asset_ids: string[];
  base_asset_id: string | null;
  selected_reference_asset_ids: string[];
  generation_config_mode: GenerationConfigSelectionMode;
  requested_generation_config_id: string | null;
  used_generation_config_id: string | null;
  resource_group_id?: string | null;
  resource_group: GenerationResourceGroupTag;
  generation_count: number;
  completed_candidates: number;
  active_candidate_index: number | null;
  progress_phase: string | null;
  progress_updated_at: string | null;
  provider_response_id: string | null;
  provider_response_status: string | null;
  progress_metadata: Record<string, unknown> | null;
  failure_reason: string | null;
  result_generation_group_id: string | null;
  tool_options: ImageToolOptions | null;
  provider_notes: string[];
  attempts: number;
  is_retryable: boolean;
  is_cancelable: boolean;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  queue_active_count: number;
  queue_running_count: number;
  queue_queued_count: number;
  queue_max_concurrent_tasks: number;
  queued_ahead_count: number | null;
  queue_position: number | null;
}

export interface ImageSessionSummary extends ModerationFields {
  id: string;
  owner_user_id?: string;
  owner_username?: string | null;
  inspiration_id: string | null;
  title: string;
  rounds_count: number;
  latest_resource_group_id?: string | null;
  latest_resource_group?: GenerationResourceGroupTag | null;
  latest_generated_asset: ImageSessionAsset | null;
  created_at: string;
  updated_at: string;
}

export interface ImageSessionDetail extends ModerationFields {
  id: string;
  owner_user_id?: string;
  owner_username?: string | null;
  inspiration_id: string | null;
  title: string;
  assets: ImageSessionAsset[];
  rounds: ImageSessionRound[];
  generation_tasks: ImageSessionGenerationTask[];
  created_at: string;
  updated_at: string;
}

export interface ImageSessionStatus extends ModerationFields {
  id: string;
  owner_user_id?: string;
  owner_username?: string | null;
  inspiration_id: string | null;
  title: string;
  rounds_count: number;
  latest_round_id: string | null;
  latest_generation_group_id: string | null;
  has_active_generation_task: boolean;
  generation_tasks: ImageSessionGenerationTask[];
  created_at: string;
  updated_at: string;
}

export interface ImageSessionListResponse {
  items: ImageSessionSummary[];
}

export interface InspirationWritebackResponse {
  inspiration_id: string;
  message: string;
}

export interface ResourceLibraryGroup {
  id: string;
  owner_user_id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ResourceLibraryGroupListResponse {
  items: ResourceLibraryGroup[];
}

export interface ResourceLibraryAssetGroup {
  id: string;
  name: string;
  sort_order: number;
}

export interface ResourceLibraryAsset extends ModerationFields {
  id: string;
  owner_user_id: string;
  kind: ResourceLibraryAssetKind;
  original_filename: string;
  mime_type: string;
  source_type: ResourceLibrarySourceType;
  source_resource_id: string | null;
  groups: ResourceLibraryAssetGroup[];
  group_ids: string[];
  download_url: string;
  preview_url: string;
  thumbnail_url: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResourceLibraryAssetListResponse {
  items: ResourceLibraryAsset[];
}

export interface SaveResourceLibraryAssetInput {
  source_type: ResourceLibrarySourceType;
  source_id: string;
  group_ids: string[];
}

export interface ResourceLibrarySourceStatus {
  source_id: string;
  saved: boolean;
  asset: ResourceLibraryAsset | null;
  group_ids: string[];
}

export interface ResourceLibrarySourceStatusListResponse {
  items: ResourceLibrarySourceStatus[];
}

export interface GalleryEntry extends ModerationFields {
  id: string;
  owner_user_id?: string;
  owner_username?: string | null;
  image_session_asset_id: string;
  image_session_round_id: string | null;
  image_session_id: string;
  image_session_title: string;
  inspiration_id: string | null;
  inspiration_name: string | null;
  image: ImageSessionAsset;
  prompt: string | null;
  size: string | null;
  actual_size: string | null;
  model_name: string | null;
  provider_name: string | null;
  prompt_version: string | null;
  provider_response_id: string | null;
  image_generation_call_id: string | null;
  generation_group_id: string | null;
  resource_group_id?: string | null;
  resource_group: GenerationResourceGroupTag;
  candidate_index: number | null;
  candidate_count: number | null;
  base_asset_ids: string[];
  base_assets: ImageSessionAsset[];
  base_asset_id: string | null;
  selected_reference_asset_ids: string[];
  provider_notes: string[];
  view_count: number;
  created_at: string;
}

export interface GalleryEntryViewResponse {
  id: string;
  view_count: number;
  counted: boolean;
}

export interface GalleryEntryListResponse {
  items: GalleryEntry[];
  total: number;
  has_more: boolean;
  next_offset: number | null;
}

export type ConfigSource = "database" | "env_default";
export type ConfigInputType = "text" | "password" | "number" | "boolean" | "select" | "multi_select" | "textarea";

export interface ConfigOption {
  value: string;
  label: string;
}

export interface ConfigItem {
  key: string;
  label: string;
  category: string;
  input_type: ConfigInputType;
  description: string;
  value: string | number | boolean | string[] | null;
  source: ConfigSource;
  secret: boolean;
  has_value: boolean;
  options: ConfigOption[];
  minimum: number | null;
  maximum: number | null;
  updated_at: string | null;
}

export interface ConfigResponse {
  items: ConfigItem[];
}

export interface RuntimeConfig {
  ui_layout_scheme: string;
  image_generation_max_dimension: number;
  image_session_max_base_images: number;
  image_tool_allowed_fields: ImageToolOptionKey[];
  text_generation_max_concurrent_tasks: number;
  image_generation_max_concurrent_tasks: number;
  generation_tail_splitter_max_items: number;
  workflow_node_max_retry_count: number;
  workflow_node_retry_delay_ms: number;
  gallery_show_generation_resource_group: boolean;
  deletion_enabled: boolean;
}

export type LoginPageTemplateId = "command-orbit" | "fluid-mist" | "image-lab";
export type LoginPageMode = "random" | LoginPageTemplateId;

export interface LoginPageConfig {
  template_id: LoginPageTemplateId;
  template_name: string;
  content: Record<string, string>;
  assets: Record<string, string>;
}

export interface GenerationQueueOverview {
  active_count: number;
  running_count: number;
  queued_count: number;
  max_concurrent_tasks: number;
}

export interface ConfigUpdateRequest {
  values?: Record<string, string | number | boolean | string[] | null>;
  reset_keys?: string[];
}

export interface LoginPageSelectionUpdateRequest {
  value: LoginPageMode;
}

export interface LoginPageTemplateConfigUpdateRequest {
  config: Record<string, string>;
}

export interface UserUiPreferences {
  user_id: string;
  ui_layout_scheme?: string | null;
  mask_sensitive_images_in_inspirations: boolean;
  mask_sensitive_images_in_image_chat: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserUiPreferencesUpdateRequest {
  ui_layout_scheme?: string | null;
  mask_sensitive_images_in_inspirations?: boolean | null;
  mask_sensitive_images_in_image_chat?: boolean | null;
}

export type ProviderCapability =
  | "text_responses"
  | "text_chat_completions"
  | "image_responses"
  | "image_images"
  | "image_chat"
  | "image_google_gemini";
export type ProviderPurpose = "text" | "image";
export type ProviderType = "openai_compatible" | "google_gemini";

export interface ProviderProfile {
  id: string;
  name: string;
  provider_type: ProviderType;
  base_url: string | null;
  capabilities: ProviderCapability[];
  default_models: Record<string, unknown>;
  config: Record<string, unknown>;
  enabled: boolean;
  archived_at: string | null;
  has_api_key: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProviderProfileCreateRequest {
  name: string;
  provider_type?: ProviderType;
  base_url?: string | null;
  api_key?: string | null;
  capabilities: ProviderCapability[];
  default_models?: Record<string, unknown>;
  config?: Record<string, unknown>;
  enabled?: boolean;
}

export interface ProviderProfileUpdateRequest {
  name?: string | null;
  provider_type?: ProviderType | null;
  base_url?: string | null;
  api_key?: string | null;
  capabilities?: ProviderCapability[] | null;
  default_models?: Record<string, unknown> | null;
  config?: Record<string, unknown> | null;
  enabled?: boolean | null;
}

export interface ProviderBinding {
  id: string;
  purpose: ProviderPurpose;
  provider_kind: string;
  provider_profile_id: string | null;
  model_settings: Record<string, unknown>;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ProviderBindingUpdateRequest {
  provider_kind: string;
  provider_profile_id?: string | null;
  model_settings?: Record<string, unknown>;
  config?: Record<string, unknown>;
}

export interface GenerationConfigState {
  current_concurrency: number;
  frozen_until: string | null;
  failure_window_started_at: string | null;
  failure_count_in_window: number;
  last_used_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_failure_reason: string | null;
  updated_at: string | null;
}

export interface GenerationConfigDailyStat {
  stat_date: string;
  attempt_count: number;
  success_count: number;
  failure_count: number;
  timeout_count: number;
  throttled_count: number;
  generated_unit_count: number;
  total_latency_ms: number;
  freeze_count: number;
  last_success_at: string | null;
  last_failure_at: string | null;
}

export interface GenerationConfigStatAggregate {
  attempt_count: number;
  success_count: number;
  failure_count: number;
  timeout_count: number;
  throttled_count: number;
  generated_unit_count: number;
  total_latency_ms: number;
  freeze_count: number;
  last_success_at: string | null;
  last_failure_at: string | null;
}

export type GenerationConfigTestType = "text" | "json_response_format" | "image";
export type GenerationConfigTestStatus = "success" | "failed";

export interface GenerationConfigTestResult {
  id: string;
  generation_config_id: string;
  test_type: GenerationConfigTestType;
  status: GenerationConfigTestStatus;
  tested_at: string;
  duration_ms: number | null;
  provider_kind: string | null;
  model_summary: Record<string, unknown>;
  message: string | null;
  error_detail: string | null;
}

export interface GenerationConfig {
  id: string;
  resource_group_id: string | null;
  resource_group_ids: string[];
  purpose: ProviderPurpose;
  name: string;
  provider_kind: string;
  provider_profile_id: string | null;
  model_settings: Record<string, unknown>;
  config: Record<string, unknown>;
  priority: number;
  max_concurrency: number;
  enabled: boolean;
  effective_enabled: boolean;
  availability_window_minutes: number;
  failure_threshold: number;
  cooldown_minutes: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  state: GenerationConfigState | null;
  today_stat: GenerationConfigDailyStat | null;
  latest_test_result: GenerationConfigTestResult | null;
}

export interface GenerationConfigOption {
  id: string;
  resource_group_id: string | null;
  resource_group_ids: string[];
  purpose: ProviderPurpose;
  name: string;
  provider_kind: string;
  enabled: boolean;
  effective_enabled: boolean;
  priority: number;
  frozen_until: string | null;
}

export interface GenerationConfigStatusConfig {
  id: string;
  resource_group_id: string | null;
  resource_group_ids: string[];
  purpose: ProviderPurpose;
  name: string;
  provider_kind: string;
  priority: number;
  max_concurrency: number;
  enabled: boolean;
  effective_enabled: boolean;
  state: GenerationConfigState | null;
  today_stat: GenerationConfigDailyStat | null;
  range_stat: GenerationConfigStatAggregate;
}

export interface GenerationConfigStatusSummary {
  total_count: number;
  enabled_count: number;
  frozen_count: number;
  running_count: number;
  start_date: string;
  end_date: string;
  range_attempt_count: number;
  range_success_count: number;
  range_failure_count: number;
  range_text_attempt_count: number;
  range_image_attempt_count: number;
  today_attempt_count: number;
  today_success_count: number;
  today_failure_count: number;
  today_text_attempt_count: number;
  today_image_attempt_count: number;
  configs: GenerationConfigStatusConfig[];
}

export interface UserUsageStatsUser {
  id: string;
  username: string;
  display_name: string;
  is_admin: boolean;
}

export interface UserUsageStatsSummary {
  attempt_count: number;
  success_count: number;
  failure_count: number;
  timeout_count: number;
  throttled_count: number;
  generated_unit_count: number;
  total_latency_ms: number;
  text_attempt_count: number;
  image_attempt_count: number;
  last_success_at: string | null;
  last_failure_at: string | null;
}

export interface UserUsageStat {
  id: string;
  user_id: string;
  username: string;
  display_name: string;
  stat_date: string;
  purpose: ProviderPurpose;
  attempt_count: number;
  success_count: number;
  failure_count: number;
  timeout_count: number;
  throttled_count: number;
  generated_unit_count: number;
  total_latency_ms: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserUsageStatsResponse {
  start_date: string;
  end_date: string;
  selected_user_id: string | null;
  items: UserUsageStat[];
  summary: UserUsageStatsSummary;
  users: UserUsageStatsUser[];
}

export interface GenerationConfigCreateRequest {
  resource_group_id?: string | null;
  resource_group_ids?: string[] | null;
  name: string;
  purpose: ProviderPurpose;
  provider_kind: string;
  provider_profile_id?: string | null;
  model_settings?: Record<string, unknown>;
  config?: Record<string, unknown>;
  priority?: number;
  max_concurrency?: number;
  enabled?: boolean;
  availability_window_minutes?: number | null;
  failure_threshold?: number | null;
  cooldown_minutes?: number | null;
}

export interface GenerationConfigUpdateRequest {
  resource_group_id?: string | null;
  resource_group_ids?: string[] | null;
  name?: string | null;
  purpose?: ProviderPurpose | null;
  provider_kind?: string | null;
  provider_profile_id?: string | null;
  model_settings?: Record<string, unknown> | null;
  config?: Record<string, unknown> | null;
  priority?: number | null;
  max_concurrency?: number | null;
  enabled?: boolean | null;
  availability_window_minutes?: number | null;
  failure_threshold?: number | null;
  cooldown_minutes?: number | null;
}

export interface TextGenerationConfigTestInspirationRequest {
  name: string;
  category?: string | null;
  price?: string | null;
  source_note?: string | null;
}

export interface TextGenerationConfigTestCopyRequest {
  instruction?: string;
  purpose?: string | null;
  channel?: string | null;
  tone?: string | null;
  output_mode?: "freeform" | "blocks" | "layout_brief";
}

export interface TextGenerationConfigTestRequest {
  generation_config_id?: string | null;
  generation_config?: GenerationConfigCreateRequest | null;
  inspiration?: TextGenerationConfigTestInspirationRequest;
  copy_request?: TextGenerationConfigTestCopyRequest;
}

export interface TextGenerationConfigTestResponse {
  generation_config_id: string | null;
  provider_kind: string;
  brief_model: string;
  copy_model: string;
  brief: Record<string, unknown>;
  copy_result: Record<string, unknown>;
  duration_ms: number;
}

export interface TextGenerationConfigJsonResponseFormatTestRequest {
  generation_config_id?: string | null;
  generation_config?: GenerationConfigCreateRequest | null;
}

export interface TextGenerationConfigJsonResponseFormatTestResponse {
  generation_config_id: string | null;
  provider_kind: string;
  model: string;
  parsed_json: Record<string, unknown>;
  duration_ms: number;
}

export interface ImageGenerationConfigTestRequest {
  generation_config_id?: string | null;
  generation_config?: GenerationConfigCreateRequest | null;
  resource_group_id: string;
  prompt: string;
  size: string;
}

export interface ImageGenerationConfigTestResponse {
  generation_config_id: string | null;
  provider_kind: string;
  model_name: string;
  provider_name: string;
  duration_ms: number;
  image_session_id: string;
  round: ImageSessionRound;
  generated_asset: ImageSessionAsset;
}

export interface ProviderConfigResponse {
  profiles: ProviderProfile[];
  bindings: ProviderBinding[];
  generation_resource_groups: GenerationResourceGroup[];
  generation_configs: GenerationConfig[];
  status_summary: GenerationConfigStatusSummary | null;
}

export interface ProviderModel {
  id: string;
  label: string;
  owned_by: string | null;
  created: number | null;
}

export interface ProviderModelListResponse {
  models: ProviderModel[];
}

export interface SettingsExportMetadata {
  schema_version: number;
  exported_at: string;
  app: string;
  compatibility: string;
  app_version: string;
}

export interface SettingsExportProviderProfile {
  id: string;
  name: string;
  provider_type: ProviderType;
  base_url: string | null;
  api_key: string | null;
  capabilities: ProviderCapability[];
  default_models: Record<string, unknown>;
  config: Record<string, unknown>;
  enabled: boolean;
}

export interface SettingsExportProviderBinding {
  purpose: ProviderPurpose;
  provider_kind: string;
  provider_profile_name?: string | null;
  provider_profile_id?: string | null;
  model_settings: Record<string, unknown>;
  config: Record<string, unknown>;
}

export interface SettingsExportGenerationConfig {
  id?: string | null;
  resource_group_id?: string | null;
  resource_group_ids?: string[] | null;
  name: string;
  purpose: ProviderPurpose;
  provider_kind: string;
  provider_profile_id?: string | null;
  model_settings: Record<string, unknown>;
  config: Record<string, unknown>;
  priority: number;
  max_concurrency: number;
  enabled: boolean;
  availability_window_minutes?: number | null;
  failure_threshold?: number | null;
  cooldown_minutes?: number | null;
}

export interface SettingsExportGenerationResourceGroup {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  sort_order: number;
  enabled: boolean;
  blur_images_by_default: boolean;
}

export interface SettingsExportCanvasTemplateCategory {
  id: string;
  scope: CanvasTemplateScope;
  owner_user_id?: string | null;
  name: string;
  sort_order: number;
  enabled: boolean;
  disabled_reason?: string | null;
}

export interface SettingsExportCanvasTemplate {
  id: string;
  key: string;
  scope: CanvasTemplateScope;
  owner_user_id?: string | null;
  category_id?: string | null;
  title: string;
  description?: string | null;
  kind: CanvasTemplateKind;
  entry_mode: CanvasTemplateEntryMode;
  sort_order: number;
  schema_version: number;
  template_json: Record<string, unknown>;
  enabled: boolean;
  disabled_reason?: string | null;
  review_status?: CanvasTemplateReviewStatus;
  review_note?: string | null;
}

export interface SettingsExportPayload {
  metadata: SettingsExportMetadata;
  runtime_config: Record<string, string | number | boolean | string[] | null>;
  provider_profiles: SettingsExportProviderProfile[];
  provider_bindings: SettingsExportProviderBinding[];
  generation_resource_groups: SettingsExportGenerationResourceGroup[];
  generation_configs: SettingsExportGenerationConfig[];
  canvas_template_categories: SettingsExportCanvasTemplateCategory[];
  canvas_templates: SettingsExportCanvasTemplate[];
}

export interface SettingsImportPreviewResponse {
  schema_version: number;
  runtime_config_count: number;
  provider_profile_count: number;
  provider_binding_count: number;
  generation_resource_group_count: number;
  generation_config_count: number;
  canvas_template_category_count: number;
  canvas_template_count: number;
  provider_profile_names: string[];
  provider_binding_purposes: ProviderPurpose[];
  includes_api_keys: boolean;
  provider_profiles_with_api_key_count: number;
  canvas_template_keys: string[];
  canvas_template_category_names: string[];
}

export interface SettingsImportCommitResponse {
  preview: SettingsImportPreviewResponse;
  config: ConfigResponse;
  provider_config: ProviderConfigResponse;
}

export interface DuplicateWorkflowNodeGroupInput {
  node_ids: string[];
  offset_x?: number;
  offset_y?: number;
  position_x?: number;
  position_y?: number;
}
