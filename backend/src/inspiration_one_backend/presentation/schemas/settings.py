from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from inspiration_one_backend.presentation.schemas.image_sessions import (
    ImageSessionAssetResponse,
    ImageSessionRoundResponse,
)
from inspiration_one_backend.presentation.schemas.validators import validate_image_generation_size

ConfigSource = Literal["database", "env_default"]
ConfigInputType = Literal["text", "password", "number", "boolean", "select", "multi_select", "textarea"]


class ConfigOptionResponse(BaseModel):
    value: str
    label: str


class ConfigItemResponse(BaseModel):
    key: str
    label: str
    category: str
    input_type: ConfigInputType
    description: str = ""
    value: str | int | bool | list[str] | None
    source: ConfigSource
    secret: bool = False
    has_value: bool = False
    options: list[ConfigOptionResponse] = Field(default_factory=list)
    minimum: int | None = None
    maximum: int | None = None
    updated_at: str | None = None


class ConfigResponse(BaseModel):
    items: list[ConfigItemResponse]


class RuntimeConfigResponse(BaseModel):
    ui_layout_scheme: str = "classic"
    image_generation_max_dimension: int
    image_session_max_base_images: int
    image_tool_allowed_fields: list[str]
    text_generation_max_concurrent_tasks: int
    image_generation_max_concurrent_tasks: int
    generation_tail_splitter_max_items: int
    workflow_node_max_retry_count: int
    workflow_node_retry_delay_ms: int
    gallery_show_generation_resource_group: bool
    gallery_tag_filter_max_selection: int
    gallery_entry_tag_max_selection: int
    gallery_tag_required_on_save: bool
    deletion_enabled: bool


class ConfigUpdateRequest(BaseModel):
    values: dict[str, Any] = Field(default_factory=dict)
    reset_keys: list[str] = Field(default_factory=list)


class LoginPageSelectionUpdateRequest(BaseModel):
    value: str


class LoginPageTemplateConfigUpdateRequest(BaseModel):
    config: dict[str, Any] = Field(default_factory=dict)


class UserUiPreferencesResponse(BaseModel):
    user_id: str
    ui_layout_scheme: str = "classic"
    mask_sensitive_images_in_inspirations: bool = True
    mask_sensitive_images_in_image_chat: bool = True
    created_at: str
    updated_at: str


class UserUiPreferencesUpdateRequest(BaseModel):
    ui_layout_scheme: str | None = None
    mask_sensitive_images_in_inspirations: bool | None = None
    mask_sensitive_images_in_image_chat: bool | None = None


class ProviderProfileResponse(BaseModel):
    id: str
    name: str
    provider_type: str
    base_url: str | None = None
    capabilities: list[str]
    default_models: dict[str, Any] = Field(default_factory=dict)
    config: dict[str, Any] = Field(default_factory=dict)
    enabled: bool
    archived_at: str | None = None
    has_api_key: bool
    created_at: str
    updated_at: str


class GenerationResourceGroupResponse(BaseModel):
    id: str
    key: str
    name: str
    description: str | None = None
    sort_order: int
    enabled: bool
    blur_images_by_default: bool = False
    archived_at: str | None = None
    created_at: str
    updated_at: str


class GenerationResourceGroupCreateRequest(BaseModel):
    key: str = Field(min_length=2, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    sort_order: int = 100
    enabled: bool = True
    blur_images_by_default: bool = False


class GenerationResourceGroupUpdateRequest(BaseModel):
    key: str | None = Field(default=None, min_length=2, max_length=80)
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    sort_order: int | None = None
    enabled: bool | None = None
    blur_images_by_default: bool | None = None


class GenerationConfigStateResponse(BaseModel):
    current_concurrency: int
    frozen_until: str | None = None
    failure_window_started_at: str | None = None
    failure_count_in_window: int
    last_used_at: str | None = None
    last_success_at: str | None = None
    last_failure_at: str | None = None
    last_failure_reason: str | None = None
    updated_at: str | None = None


class GenerationConfigDailyStatResponse(BaseModel):
    stat_date: str
    attempt_count: int
    success_count: int
    failure_count: int
    timeout_count: int
    throttled_count: int
    generated_unit_count: int
    total_latency_ms: int
    freeze_count: int
    last_success_at: str | None = None
    last_failure_at: str | None = None


class GenerationConfigStatAggregateResponse(BaseModel):
    attempt_count: int
    success_count: int
    failure_count: int
    timeout_count: int
    throttled_count: int
    generated_unit_count: int
    total_latency_ms: int
    freeze_count: int
    last_success_at: str | None = None
    last_failure_at: str | None = None


class GenerationConfigTestResultResponse(BaseModel):
    id: str
    generation_config_id: str
    test_type: str
    status: str
    tested_at: str
    duration_ms: int | None = None
    provider_kind: str | None = None
    model_summary: dict[str, Any] = Field(default_factory=dict)
    message: str | None = None
    error_detail: str | None = None


class GenerationConfigResponse(BaseModel):
    id: str
    resource_group_id: str | None = None
    resource_group_ids: list[str] = Field(default_factory=list)
    purpose: str
    name: str
    provider_kind: str
    provider_profile_id: str | None = None
    model_settings: dict[str, Any] = Field(default_factory=dict)
    config: dict[str, Any] = Field(default_factory=dict)
    priority: int
    max_concurrency: int
    enabled: bool
    effective_enabled: bool
    availability_window_minutes: int
    failure_threshold: int
    cooldown_minutes: int
    archived_at: str | None = None
    created_at: str
    updated_at: str
    state: GenerationConfigStateResponse | None = None
    today_stat: GenerationConfigDailyStatResponse | None = None
    latest_test_result: GenerationConfigTestResultResponse | None = None


class GenerationConfigOptionResponse(BaseModel):
    id: str
    resource_group_id: str | None = None
    resource_group_ids: list[str] = Field(default_factory=list)
    purpose: str
    name: str
    provider_kind: str
    enabled: bool
    effective_enabled: bool
    priority: int
    frozen_until: str | None = None


class GenerationConfigStatusConfigResponse(BaseModel):
    id: str
    resource_group_id: str | None = None
    resource_group_ids: list[str] = Field(default_factory=list)
    purpose: str
    name: str
    provider_kind: str
    priority: int
    max_concurrency: int
    enabled: bool
    effective_enabled: bool
    state: GenerationConfigStateResponse | None = None
    today_stat: GenerationConfigDailyStatResponse | None = None
    range_stat: GenerationConfigStatAggregateResponse


class GenerationConfigStatusSummaryResponse(BaseModel):
    total_count: int
    enabled_count: int
    frozen_count: int
    running_count: int
    start_date: str
    end_date: str
    range_attempt_count: int
    range_success_count: int
    range_failure_count: int
    range_text_attempt_count: int
    range_image_attempt_count: int
    today_attempt_count: int
    today_success_count: int
    today_failure_count: int
    today_text_attempt_count: int
    today_image_attempt_count: int
    configs: list[GenerationConfigStatusConfigResponse] = Field(default_factory=list)


class ProviderConfigResponse(BaseModel):
    profiles: list[ProviderProfileResponse]
    generation_resource_groups: list[GenerationResourceGroupResponse] = Field(default_factory=list)
    generation_configs: list[GenerationConfigResponse] = Field(default_factory=list)
    status_summary: GenerationConfigStatusSummaryResponse | None = None


class ProviderModelResponse(BaseModel):
    id: str
    label: str
    owned_by: str | None = None
    created: int | None = None


class ProviderModelListResponse(BaseModel):
    models: list[ProviderModelResponse]


class ProviderProfileCreateRequest(BaseModel):
    name: str = Field(min_length=1)
    provider_type: str = "openai_compatible"
    base_url: str | None = None
    api_key: str | None = None
    capabilities: list[str] = Field(min_length=1)
    default_models: dict[str, Any] = Field(default_factory=dict)
    config: dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True


class ProviderProfileUpdateRequest(BaseModel):
    name: str | None = None
    provider_type: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    capabilities: list[str] | None = None
    default_models: dict[str, Any] | None = None
    config: dict[str, Any] | None = None
    enabled: bool | None = None


class GenerationConfigCreateRequest(BaseModel):
    resource_group_id: str | None = Field(default=None, max_length=36)
    resource_group_ids: list[str] | None = None
    name: str = Field(min_length=1)
    purpose: str = Field(min_length=1, max_length=40)
    provider_kind: str = Field(min_length=1, max_length=40)
    provider_profile_id: str | None = None
    model_settings: dict[str, Any] = Field(default_factory=dict)
    config: dict[str, Any] = Field(default_factory=dict)
    priority: int = 100
    max_concurrency: int = Field(default=1, ge=1)
    enabled: bool = True
    availability_window_minutes: int | None = Field(default=None, ge=1)
    failure_threshold: int | None = Field(default=None, ge=1)
    cooldown_minutes: int | None = Field(default=None, ge=1)


class GenerationConfigUpdateRequest(BaseModel):
    resource_group_id: str | None = Field(default=None, max_length=36)
    resource_group_ids: list[str] | None = None
    name: str | None = None
    purpose: str | None = None
    provider_kind: str | None = None
    provider_profile_id: str | None = None
    model_settings: dict[str, Any] | None = None
    config: dict[str, Any] | None = None
    priority: int | None = None
    max_concurrency: int | None = Field(default=None, ge=1)
    enabled: bool | None = None
    availability_window_minutes: int | None = Field(default=None, ge=1)
    failure_threshold: int | None = Field(default=None, ge=1)
    cooldown_minutes: int | None = Field(default=None, ge=1)


class TextGenerationConfigTestInspirationRequest(BaseModel):
    name: str = Field(default="测试灵感产物", min_length=1, max_length=255)
    category: str | None = Field(default="电商灵感产物", max_length=120)
    price: str | None = Field(default=None, max_length=40)
    source_note: str | None = Field(default="用于验证当前文案生成配置的测试输入。", max_length=1000)


class TextGenerationConfigTestCopyRequest(BaseModel):
    instruction: str = Field(default="输出适合主图的短文案。", max_length=1000)
    purpose: str | None = Field(default="main_image", max_length=80)
    channel: str | None = Field(default="电商", max_length=80)
    tone: str | None = Field(default="清晰直接", max_length=80)
    output_mode: str = "blocks"


class TextGenerationConfigTestRequest(BaseModel):
    generation_config_id: str | None = Field(default=None, max_length=36)
    generation_config: GenerationConfigCreateRequest | None = None
    inspiration: TextGenerationConfigTestInspirationRequest = Field(
        default_factory=TextGenerationConfigTestInspirationRequest
    )
    copy_request: TextGenerationConfigTestCopyRequest = Field(default_factory=TextGenerationConfigTestCopyRequest)


class TextGenerationConfigTestResponse(BaseModel):
    generation_config_id: str | None = None
    provider_kind: str
    brief_model: str
    copy_model: str
    brief: dict[str, Any]
    copy_result: dict[str, Any]
    duration_ms: int


class TextGenerationConfigJsonResponseFormatTestRequest(BaseModel):
    generation_config_id: str | None = Field(default=None, max_length=36)
    generation_config: GenerationConfigCreateRequest | None = None


class TextGenerationConfigJsonResponseFormatTestResponse(BaseModel):
    generation_config_id: str | None = None
    provider_kind: str
    model: str
    parsed_json: dict[str, Any]
    duration_ms: int


class ImageGenerationConfigTestRequest(BaseModel):
    generation_config_id: str | None = Field(default=None, max_length=36)
    generation_config: GenerationConfigCreateRequest | None = None
    resource_group_id: str = Field(min_length=1, max_length=36)
    prompt: str = Field(default="生成一张适合验证图片配置的产品展示图。", min_length=1, max_length=4000)
    size: str = Field(default="1024x1024")

    @field_validator("size")
    @classmethod
    def validate_size(cls, size: str) -> str:
        return validate_image_generation_size(size)


class ImageGenerationConfigTestResponse(BaseModel):
    generation_config_id: str | None = None
    provider_kind: str
    model_name: str
    provider_name: str
    duration_ms: int
    image_session_id: str
    round: ImageSessionRoundResponse
    generated_asset: ImageSessionAssetResponse


class SettingsExportMetadataResponse(BaseModel):
    schema_version: int
    exported_at: datetime
    app: str
    app_version: str
    compatibility: str


class SettingsProviderProfileExport(BaseModel):
    id: str = Field(min_length=1, max_length=36)
    name: str = Field(min_length=1, max_length=120)
    provider_type: str = Field(min_length=1, max_length=40)
    base_url: str | None = None
    api_key: str | None = None
    capabilities: list[str] = Field(default_factory=list)
    default_models: dict[str, Any] = Field(default_factory=dict)
    config: dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True


class SettingsGenerationResourceGroupExport(BaseModel):
    id: str = Field(min_length=1, max_length=36)
    key: str = Field(min_length=2, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    sort_order: int = 100
    enabled: bool = True
    blur_images_by_default: bool = False


class SettingsGenerationConfigExport(BaseModel):
    id: str | None = Field(default=None, max_length=36)
    resource_group_id: str | None = Field(default=None, max_length=36)
    resource_group_ids: list[str] | None = None
    name: str = Field(min_length=1, max_length=120)
    purpose: str = Field(min_length=1, max_length=40)
    provider_kind: str = Field(min_length=1, max_length=40)
    provider_profile_id: str | None = Field(default=None, max_length=36)
    model_settings: dict[str, Any] = Field(default_factory=dict)
    config: dict[str, Any] = Field(default_factory=dict)
    priority: int = 100
    max_concurrency: int = Field(default=1, ge=1)
    enabled: bool = True
    availability_window_minutes: int | None = Field(default=None, ge=1)
    failure_threshold: int | None = Field(default=None, ge=1)
    cooldown_minutes: int | None = Field(default=None, ge=1)


class SettingsCanvasTemplateCategoryExport(BaseModel):
    id: str = Field(min_length=1, max_length=36)
    scope: str = Field(min_length=1, max_length=20)
    owner_user_id: str | None = Field(default=None, max_length=36)
    name: str = Field(min_length=1, max_length=120)
    sort_order: int = 100
    enabled: bool = True
    disabled_reason: str | None = Field(default=None, max_length=1000)


class SettingsCanvasTemplateExport(BaseModel):
    id: str = Field(min_length=1, max_length=36)
    key: str = Field(min_length=1, max_length=120)
    scope: str = Field(min_length=1, max_length=20)
    owner_user_id: str | None = Field(default=None, max_length=36)
    category_id: str | None = Field(default=None, max_length=36)
    title: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None)
    kind: str = Field(min_length=1, max_length=40)
    entry_mode: str = Field(min_length=1, max_length=20)
    sort_order: int = 100
    schema_version: int = 1
    template_json: dict[str, Any] = Field(default_factory=dict)
    enabled: bool = True
    disabled_reason: str | None = Field(default=None, max_length=1000)
    review_status: str = "none"
    review_note: str | None = Field(default=None, max_length=1000)


class SettingsExportDocument(BaseModel):
    metadata: SettingsExportMetadataResponse
    runtime_config: dict[str, Any]
    provider_profiles: list[SettingsProviderProfileExport] = Field(default_factory=list)
    generation_resource_groups: list[SettingsGenerationResourceGroupExport] = Field(default_factory=list)
    generation_configs: list[SettingsGenerationConfigExport] = Field(default_factory=list)
    canvas_template_categories: list[SettingsCanvasTemplateCategoryExport] = Field(default_factory=list)
    canvas_templates: list[SettingsCanvasTemplateExport] = Field(default_factory=list)


class SettingsImportPreviewResponse(BaseModel):
    schema_version: int
    runtime_config_count: int
    provider_profile_count: int
    generation_resource_group_count: int = 0
    generation_config_count: int = 0
    canvas_template_category_count: int = 0
    canvas_template_count: int = 0
    provider_profile_names: list[str]
    includes_api_keys: bool
    provider_profiles_with_api_key_count: int
    canvas_template_keys: list[str] = Field(default_factory=list)
    canvas_template_category_names: list[str] = Field(default_factory=list)


class SettingsImportCommitResponse(BaseModel):
    preview: SettingsImportPreviewResponse
    config: ConfigResponse
    provider_config: ProviderConfigResponse
