from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

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
    image_generation_max_dimension: int
    image_tool_allowed_fields: list[str]
    admin_access_required: bool
    deletion_enabled: bool


class ConfigUpdateRequest(BaseModel):
    values: dict[str, Any] = Field(default_factory=dict)
    reset_keys: list[str] = Field(default_factory=list)


class SettingsLockStateResponse(BaseModel):
    unlocked: bool
    configured: bool


class SettingsUnlockRequest(BaseModel):
    token: str = Field(min_length=1)


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


class ProviderBindingResponse(BaseModel):
    id: str
    purpose: str
    provider_kind: str
    provider_profile_id: str | None = None
    model_settings: dict[str, Any] = Field(default_factory=dict)
    config: dict[str, Any] = Field(default_factory=dict)
    created_at: str
    updated_at: str


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


class GenerationConfigResponse(BaseModel):
    id: str
    purpose: str
    name: str
    provider_kind: str
    provider_profile_id: str | None = None
    model_settings: dict[str, Any] = Field(default_factory=dict)
    config: dict[str, Any] = Field(default_factory=dict)
    priority: int
    max_concurrency: int
    enabled: bool
    availability_window_minutes: int
    failure_threshold: int
    cooldown_minutes: int
    archived_at: str | None = None
    created_at: str
    updated_at: str
    state: GenerationConfigStateResponse | None = None
    today_stat: GenerationConfigDailyStatResponse | None = None


class GenerationConfigOptionResponse(BaseModel):
    id: str
    purpose: str
    name: str
    provider_kind: str
    enabled: bool
    priority: int
    frozen_until: str | None = None


class GenerationConfigStatusSummaryResponse(BaseModel):
    total_count: int
    enabled_count: int
    frozen_count: int
    running_count: int
    today_attempt_count: int
    today_success_count: int
    today_failure_count: int


class ProviderConfigResponse(BaseModel):
    profiles: list[ProviderProfileResponse]
    bindings: list[ProviderBindingResponse]
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


class ProviderBindingUpdateRequest(BaseModel):
    provider_kind: str
    provider_profile_id: str | None = None
    model_settings: dict[str, Any] = Field(default_factory=dict)
    config: dict[str, Any] = Field(default_factory=dict)


class GenerationConfigCreateRequest(BaseModel):
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


class SettingsProviderBindingExport(BaseModel):
    purpose: str = Field(min_length=1, max_length=40)
    provider_kind: str = Field(min_length=1, max_length=40)
    provider_profile_id: str | None = Field(default=None, max_length=36)
    model_settings: dict[str, Any] = Field(default_factory=dict)
    config: dict[str, Any] = Field(default_factory=dict)


class SettingsGenerationConfigExport(BaseModel):
    id: str | None = Field(default=None, max_length=36)
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


class SettingsExportDocument(BaseModel):
    metadata: SettingsExportMetadataResponse
    runtime_config: dict[str, Any]
    provider_profiles: list[SettingsProviderProfileExport] = Field(default_factory=list)
    provider_bindings: list[SettingsProviderBindingExport] = Field(default_factory=list)
    generation_configs: list[SettingsGenerationConfigExport] = Field(default_factory=list)


class SettingsImportPreviewResponse(BaseModel):
    schema_version: int
    runtime_config_count: int
    provider_profile_count: int
    provider_binding_count: int
    generation_config_count: int = 0
    provider_profile_names: list[str]
    provider_binding_purposes: list[str]
    includes_api_keys: bool
    provider_profiles_with_api_key_count: int


class SettingsImportCommitResponse(BaseModel):
    preview: SettingsImportPreviewResponse
    config: ConfigResponse
    provider_config: ProviderConfigResponse
