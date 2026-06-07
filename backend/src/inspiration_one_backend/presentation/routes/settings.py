from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from time import perf_counter
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from pydantic import ValidationError
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, selectinload

from inspiration_one_backend import __version__
from inspiration_one_backend.application.auth import list_available_generation_resource_groups_for_user
from inspiration_one_backend.application.canvas_templates import CanvasTemplate as CanvasTemplatePayload
from inspiration_one_backend.application.contracts import CopyNodeConfigV2, InspirationInput
from inspiration_one_backend.application.time import now_utc
from inspiration_one_backend.config import (
    CONFIG_DEFINITION_BY_KEY,
    CONFIG_DEFINITIONS,
    RUNTIME_CONFIG_KEYS,
    build_settings_with_overrides,
    get_runtime_settings,
    normalize_config_values,
    normalize_image_generation_size,
    parse_image_tool_allowed_fields,
)
from inspiration_one_backend.domain.rbac import (
    API_IMAGE_CHAT_READ,
    API_INSPIRATIONS_READ,
    API_SETTINGS_MIGRATE,
    API_SETTINGS_PROVIDER_WRITE,
    API_SETTINGS_READ,
    API_SETTINGS_WRITE,
    API_STATUS_READ,
)
from inspiration_one_backend.infrastructure.db.models import (
    DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    DEFAULT_GENERATION_RESOURCE_GROUP_KEY,
    AppSetting,
    AuthUser,
    GenerationConfig,
    GenerationConfigDailyStat,
    GenerationConfigState,
    GenerationResourceGroup,
    ProviderBinding,
    ProviderProfile,
    UserGenerationResourceGroupGrant,
)
from inspiration_one_backend.infrastructure.db.models import (
    CanvasTemplate as DbCanvasTemplate,
)
from inspiration_one_backend.infrastructure.db.models import (
    CanvasTemplateCategory as DbCanvasTemplateCategory,
)
from inspiration_one_backend.infrastructure.provider_config import (
    IMAGE_PROVIDER_KINDS,
    PROVIDER_PURPOSES,
    PROVIDER_TYPES,
    TEXT_PROVIDER_KINDS,
    UNSET_PROVIDER_FIELD,
    add_generation_config,
    add_generation_resource_group,
    archive_generation_config,
    archive_generation_resource_group,
    archive_provider_profile,
    capability_for_provider_kind,
    create_provider_profile,
    ensure_provider_config_bootstrapped,
    generation_config_status_summary,
    is_real_image_provider_kind,
    list_generation_configs,
    list_generation_resource_groups,
    list_provider_bindings,
    list_provider_profiles,
    normalize_provider_binding_model_settings,
    normalize_provider_binding_runtime_config,
    resolve_text_provider_config_from_draft,
    update_generation_config,
    update_generation_resource_group,
    update_provider_binding,
    update_provider_profile,
    validate_provider_capabilities,
    validate_provider_profile_contract,
)
from inspiration_one_backend.infrastructure.provider_models import (
    ProviderModelDiscoveryError,
    ProviderModelDiscoveryUnsupportedError,
    list_provider_models,
)
from inspiration_one_backend.infrastructure.text.mock_provider import MockTextProvider
from inspiration_one_backend.infrastructure.text.openai_provider import OpenAITextProvider
from inspiration_one_backend.presentation.deps import (
    get_current_user,
    get_session,
    require_any_api_permission,
    require_api_permission,
)
from inspiration_one_backend.presentation.schemas.settings import (
    ConfigItemResponse,
    ConfigOptionResponse,
    ConfigResponse,
    ConfigUpdateRequest,
    GenerationConfigCreateRequest,
    GenerationConfigDailyStatResponse,
    GenerationConfigOptionResponse,
    GenerationConfigResponse,
    GenerationConfigStatAggregateResponse,
    GenerationConfigStateResponse,
    GenerationConfigStatusConfigResponse,
    GenerationConfigStatusSummaryResponse,
    GenerationConfigUpdateRequest,
    GenerationResourceGroupCreateRequest,
    GenerationResourceGroupResponse,
    GenerationResourceGroupUpdateRequest,
    ProviderBindingResponse,
    ProviderBindingUpdateRequest,
    ProviderConfigResponse,
    ProviderModelListResponse,
    ProviderModelResponse,
    ProviderProfileCreateRequest,
    ProviderProfileResponse,
    ProviderProfileUpdateRequest,
    RuntimeConfigResponse,
    SettingsCanvasTemplateCategoryExport,
    SettingsCanvasTemplateExport,
    SettingsExportDocument,
    SettingsExportMetadataResponse,
    SettingsGenerationConfigExport,
    SettingsGenerationResourceGroupExport,
    SettingsImportCommitResponse,
    SettingsImportPreviewResponse,
    SettingsProviderBindingExport,
    SettingsProviderProfileExport,
    TextGenerationConfigTestRequest,
    TextGenerationConfigTestResponse,
)

router = APIRouter(
    prefix="/api/settings",
    tags=["settings"],
)
logger = logging.getLogger(__name__)
SETTINGS_EXPORT_SCHEMA_VERSION = 1
SETTINGS_EXPORT_COMPATIBILITY = "inspiration-one-settings-v1"
READ_SETTINGS_PERMISSION = Depends(require_api_permission(API_SETTINGS_READ))
WRITE_SETTINGS_PERMISSION = Depends(require_api_permission(API_SETTINGS_WRITE))
WRITE_PROVIDER_SETTINGS_PERMISSION = Depends(require_api_permission(API_SETTINGS_PROVIDER_WRITE))
MIGRATE_SETTINGS_PERMISSION = Depends(require_api_permission(API_SETTINGS_MIGRATE))
READ_STATUS_PERMISSION = Depends(require_api_permission(API_STATUS_READ))
READ_GENERATION_RUNTIME_PERMISSION = Depends(
    require_any_api_permission(API_INSPIRATIONS_READ, API_IMAGE_CHAT_READ, API_SETTINGS_READ)
)


@dataclass(frozen=True, slots=True)
class _SettingsImportBundle:
    normalized_runtime_config: dict[str, str]
    provider_profiles: list[dict[str, Any]]
    provider_bindings: list[dict[str, Any]]
    generation_resource_groups: list[dict[str, Any]]
    generation_configs: list[dict[str, Any]]
    canvas_template_categories: list[dict[str, Any]]
    canvas_templates: list[dict[str, Any]]
    preview: SettingsImportPreviewResponse


@dataclass(slots=True)
class _GenerationConfigStatAggregate:
    attempt_count: int = 0
    success_count: int = 0
    failure_count: int = 0
    timeout_count: int = 0
    throttled_count: int = 0
    generated_unit_count: int = 0
    total_latency_ms: int = 0
    freeze_count: int = 0
    last_success_at: datetime | None = None
    last_failure_at: datetime | None = None


def _load_database_values(session: Session) -> dict[str, AppSetting]:
    rows = session.scalars(select(AppSetting).where(AppSetting.key.in_(RUNTIME_CONFIG_KEYS))).all()
    return {row.key: row for row in rows}


def _upsert_app_setting(session: Session, *, key: str, value: str) -> None:
    existing = session.get(AppSetting, key)
    if existing is None:
        session.add(AppSetting(key=key, value=value))
    else:
        existing.value = value


def _public_value(value: Any, *, secret: bool) -> str | int | bool | None:
    if secret:
        return ""
    if isinstance(value, Path):
        return str(value)
    return value


def _validate_runtime_settings(overrides: dict[str, str]) -> None:
    settings = build_settings_with_overrides(overrides)
    normalize_image_generation_size(settings.image_main_image_size, label="主图尺寸")
    normalize_image_generation_size(settings.image_promo_poster_size, label="促销海报尺寸")
    if not settings.allowed_image_mime_types:
        raise ValueError("允许图片 MIME 不能为空")


def _serialize_config(session: Session) -> ConfigResponse:
    db_values = _load_database_values(session)
    settings = get_runtime_settings()
    items: list[ConfigItemResponse] = []
    for definition in CONFIG_DEFINITIONS:
        source = "database" if definition.key in db_values else "env_default"
        raw_value = getattr(settings, definition.key)
        effective_value = (
            list(parse_image_tool_allowed_fields(raw_value))
            if definition.input_type == "multi_select"
            else _public_value(raw_value, secret=definition.secret)
        )
        db_value = db_values.get(definition.key)
        has_value = bool(db_value.value if db_value is not None else raw_value)
        items.append(
            ConfigItemResponse(
                key=definition.key,
                label=definition.label,
                category=definition.category,
                input_type=definition.input_type,
                description=definition.description,
                value=effective_value,
                source=source,
                secret=definition.secret,
                has_value=has_value,
                options=[ConfigOptionResponse(value=option.value, label=option.label) for option in definition.options],
                minimum=definition.minimum,
                maximum=definition.maximum,
                updated_at=db_value.updated_at.isoformat() if db_value is not None else None,
            )
        )
    return ConfigResponse(items=items)


def _serialize_provider_profile(profile) -> ProviderProfileResponse:
    return ProviderProfileResponse(
        id=profile.id,
        name=profile.name,
        provider_type=profile.provider_type,
        base_url=profile.base_url,
        capabilities=list(profile.capabilities_json or []),
        default_models=dict(profile.default_models_json or {}),
        config=dict(profile.config_json or {}),
        enabled=profile.enabled,
        archived_at=profile.archived_at.isoformat() if profile.archived_at is not None else None,
        has_api_key=bool(profile.api_key),
        created_at=profile.created_at.isoformat(),
        updated_at=profile.updated_at.isoformat(),
    )


def _serialize_provider_binding(binding) -> ProviderBindingResponse:
    return ProviderBindingResponse(
        id=binding.id,
        purpose=binding.purpose,
        provider_kind=binding.provider_kind,
        provider_profile_id=binding.provider_profile_id,
        model_settings=dict(binding.model_settings_json or {}),
        config=dict(binding.config_json or {}),
        created_at=binding.created_at.isoformat(),
        updated_at=binding.updated_at.isoformat(),
    )


def _serialize_generation_resource_group(group: GenerationResourceGroup) -> GenerationResourceGroupResponse:
    return GenerationResourceGroupResponse(
        id=group.id,
        key=group.key,
        name=group.name,
        description=group.description,
        sort_order=group.sort_order,
        enabled=group.enabled,
        archived_at=_serialize_dt(group.archived_at),
        created_at=group.created_at.isoformat(),
        updated_at=group.updated_at.isoformat(),
    )


def _serialize_dt(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _serialize_generation_config_state(state) -> GenerationConfigStateResponse | None:
    if state is None:
        return None
    return GenerationConfigStateResponse(
        current_concurrency=state.current_concurrency,
        frozen_until=_serialize_dt(state.frozen_until),
        failure_window_started_at=_serialize_dt(state.failure_window_started_at),
        failure_count_in_window=state.failure_count_in_window,
        last_used_at=_serialize_dt(state.last_used_at),
        last_success_at=_serialize_dt(state.last_success_at),
        last_failure_at=_serialize_dt(state.last_failure_at),
        last_failure_reason=state.last_failure_reason,
        updated_at=_serialize_dt(state.updated_at),
    )


def _serialize_generation_config_daily_stat(
    stat: GenerationConfigDailyStat | None,
) -> GenerationConfigDailyStatResponse | None:
    if stat is None:
        return None
    return GenerationConfigDailyStatResponse(
        stat_date=stat.stat_date.isoformat(),
        attempt_count=stat.attempt_count,
        success_count=stat.success_count,
        failure_count=stat.failure_count,
        timeout_count=stat.timeout_count,
        throttled_count=stat.throttled_count,
        generated_unit_count=stat.generated_unit_count,
        total_latency_ms=stat.total_latency_ms,
        freeze_count=stat.freeze_count,
        last_success_at=_serialize_dt(stat.last_success_at),
        last_failure_at=_serialize_dt(stat.last_failure_at),
    )


def _serialize_generation_config_stat_aggregate(
    stat: _GenerationConfigStatAggregate,
) -> GenerationConfigStatAggregateResponse:
    return GenerationConfigStatAggregateResponse(
        attempt_count=stat.attempt_count,
        success_count=stat.success_count,
        failure_count=stat.failure_count,
        timeout_count=stat.timeout_count,
        throttled_count=stat.throttled_count,
        generated_unit_count=stat.generated_unit_count,
        total_latency_ms=stat.total_latency_ms,
        freeze_count=stat.freeze_count,
        last_success_at=_serialize_dt(stat.last_success_at),
        last_failure_at=_serialize_dt(stat.last_failure_at),
    )


def _today_generation_config_stats(session: Session) -> dict[str, GenerationConfigDailyStat]:
    today = datetime.now().astimezone().date()
    rows = session.scalars(select(GenerationConfigDailyStat).where(GenerationConfigDailyStat.stat_date == today)).all()
    return {row.generation_config_id: row for row in rows}


def _generation_config_stat_aggregates(
    session: Session,
    *,
    start_date: date,
    end_date: date,
) -> dict[str, _GenerationConfigStatAggregate]:
    rows = session.scalars(
        select(GenerationConfigDailyStat).where(
            GenerationConfigDailyStat.stat_date >= start_date,
            GenerationConfigDailyStat.stat_date <= end_date,
        )
    ).all()
    stats: dict[str, _GenerationConfigStatAggregate] = {}
    for row in rows:
        aggregate = stats.setdefault(row.generation_config_id, _GenerationConfigStatAggregate())
        aggregate.attempt_count += row.attempt_count
        aggregate.success_count += row.success_count
        aggregate.failure_count += row.failure_count
        aggregate.timeout_count += row.timeout_count
        aggregate.throttled_count += row.throttled_count
        aggregate.generated_unit_count += row.generated_unit_count
        aggregate.total_latency_ms += row.total_latency_ms
        aggregate.freeze_count += row.freeze_count
        if row.last_success_at is not None and (
            aggregate.last_success_at is None or row.last_success_at > aggregate.last_success_at
        ):
            aggregate.last_success_at = row.last_success_at
        if row.last_failure_at is not None and (
            aggregate.last_failure_at is None or row.last_failure_at > aggregate.last_failure_at
        ):
            aggregate.last_failure_at = row.last_failure_at
    return stats


def _serialize_generation_config(
    generation_config: GenerationConfig,
    *,
    today_stats: dict[str, GenerationConfigDailyStat],
) -> GenerationConfigResponse:
    return GenerationConfigResponse(
        id=generation_config.id,
        resource_group_id=generation_config.resource_group_id,
        purpose=generation_config.purpose,
        name=generation_config.name,
        provider_kind=generation_config.provider_kind,
        provider_profile_id=generation_config.provider_profile_id,
        model_settings=dict(generation_config.model_settings_json or {}),
        config=dict(generation_config.config_json or {}),
        priority=generation_config.priority,
        max_concurrency=generation_config.max_concurrency,
        enabled=generation_config.enabled,
        availability_window_minutes=generation_config.availability_window_minutes,
        failure_threshold=generation_config.failure_threshold,
        cooldown_minutes=generation_config.cooldown_minutes,
        archived_at=_serialize_dt(generation_config.archived_at),
        created_at=generation_config.created_at.isoformat(),
        updated_at=generation_config.updated_at.isoformat(),
        state=_serialize_generation_config_state(generation_config.state),
        today_stat=_serialize_generation_config_daily_stat(today_stats.get(generation_config.id)),
    )


def _serialize_generation_config_status_config(
    generation_config: GenerationConfig,
    *,
    today_stats: dict[str, GenerationConfigDailyStat],
    range_stats: dict[str, _GenerationConfigStatAggregate],
) -> GenerationConfigStatusConfigResponse:
    return GenerationConfigStatusConfigResponse(
        id=generation_config.id,
        resource_group_id=generation_config.resource_group_id,
        purpose=generation_config.purpose,
        name=generation_config.name,
        provider_kind=generation_config.provider_kind,
        priority=generation_config.priority,
        max_concurrency=generation_config.max_concurrency,
        enabled=generation_config.enabled,
        state=_serialize_generation_config_state(generation_config.state),
        today_stat=_serialize_generation_config_daily_stat(today_stats.get(generation_config.id)),
        range_stat=_serialize_generation_config_stat_aggregate(
            range_stats.get(generation_config.id, _GenerationConfigStatAggregate())
        ),
    )


def _serialize_generation_config_option(generation_config: GenerationConfig) -> GenerationConfigOptionResponse:
    state = generation_config.state
    return GenerationConfigOptionResponse(
        id=generation_config.id,
        resource_group_id=generation_config.resource_group_id,
        purpose=generation_config.purpose,
        name=generation_config.name,
        provider_kind=generation_config.provider_kind,
        enabled=generation_config.enabled,
        priority=generation_config.priority,
        frozen_until=_serialize_dt(state.frozen_until) if state else None,
    )


def _serialize_generation_config_status_summary(
    session: Session,
    *,
    start_date: date | None = None,
    end_date: date | None = None,
    include_configs: bool = True,
) -> GenerationConfigStatusSummaryResponse:
    today = datetime.now().astimezone().date()
    range_start = start_date or end_date or today
    range_end = end_date or range_start
    summary = generation_config_status_summary(session, start_date=range_start, end_date=range_end)
    generation_configs = list_generation_configs(session) if include_configs else []
    today_stats = _today_generation_config_stats(session) if include_configs else {}
    range_stats = (
        _generation_config_stat_aggregates(session, start_date=range_start, end_date=range_end)
        if include_configs
        else {}
    )
    return GenerationConfigStatusSummaryResponse(
        total_count=summary.total_count,
        enabled_count=summary.enabled_count,
        frozen_count=summary.frozen_count,
        running_count=summary.running_count,
        start_date=summary.start_date.isoformat(),
        end_date=summary.end_date.isoformat(),
        range_attempt_count=summary.range_attempt_count,
        range_success_count=summary.range_success_count,
        range_failure_count=summary.range_failure_count,
        range_text_attempt_count=summary.range_text_attempt_count,
        range_image_attempt_count=summary.range_image_attempt_count,
        today_attempt_count=summary.today_attempt_count,
        today_success_count=summary.today_success_count,
        today_failure_count=summary.today_failure_count,
        today_text_attempt_count=summary.today_text_attempt_count,
        today_image_attempt_count=summary.today_image_attempt_count,
        configs=[
            _serialize_generation_config_status_config(
                generation_config,
                today_stats=today_stats,
                range_stats=range_stats,
            )
            for generation_config in generation_configs
        ],
    )


def _serialize_provider_config(session: Session) -> ProviderConfigResponse:
    generation_configs = list_generation_configs(session)
    today_stats = _today_generation_config_stats(session)
    return ProviderConfigResponse(
        profiles=[_serialize_provider_profile(profile) for profile in list_provider_profiles(session)],
        bindings=[_serialize_provider_binding(binding) for binding in list_provider_bindings(session)],
        generation_resource_groups=[
            _serialize_generation_resource_group(group) for group in list_generation_resource_groups(session)
        ],
        generation_configs=[
            _serialize_generation_config(generation_config, today_stats=today_stats)
            for generation_config in generation_configs
        ],
        status_summary=_serialize_generation_config_status_summary(session, include_configs=False),
    )


def _provider_model_response(model) -> ProviderModelResponse:
    return ProviderModelResponse(
        id=model.id,
        label=model.label,
        owned_by=model.owned_by,
        created=model.created,
    )


def _load_profile_for_model_discovery(session: Session, profile_id: str, provider_kind: str) -> ProviderProfile:
    if provider_kind == "mock":
        raise ValueError("Mock 供应商不支持模型列表拉取")
    allowed_kinds = TEXT_PROVIDER_KINDS | IMAGE_PROVIDER_KINDS
    if provider_kind not in allowed_kinds:
        raise ValueError("供应商接口类型不支持")
    profile = session.get(ProviderProfile, profile_id)
    if profile is None or profile.archived_at is not None:
        raise ValueError("供应商不存在")
    if not profile.enabled:
        raise ValueError("供应商已停用")
    capability = capability_for_provider_kind(provider_kind)
    if capability not in set(profile.capabilities_json or []):
        raise ValueError("供应商档案不支持当前接口能力")
    if not profile.api_key:
        raise ValueError("供应商档案缺少 API Key，无法拉取模型列表")
    return profile


def _export_config_value(value: Any, *, input_type: str) -> str | int | bool | list[str] | None:
    if isinstance(value, Path):
        return str(value)
    if input_type == "multi_select":
        return list(parse_image_tool_allowed_fields(value))
    return value


def _serialize_canvas_template_category_export(
    category: DbCanvasTemplateCategory,
) -> SettingsCanvasTemplateCategoryExport:
    return SettingsCanvasTemplateCategoryExport(
        id=category.id,
        scope=category.scope,
        owner_user_id=category.owner_user_id,
        name=category.name,
        sort_order=category.sort_order,
        enabled=category.enabled,
        disabled_reason=category.disabled_reason,
    )


def _serialize_canvas_template_export(template: DbCanvasTemplate) -> SettingsCanvasTemplateExport:
    return SettingsCanvasTemplateExport(
        id=template.id,
        key=template.key,
        scope=template.scope,
        owner_user_id=template.owner_user_id,
        category_id=template.category_id,
        title=template.title,
        description=template.description,
        kind=template.kind,
        entry_mode=template.entry_mode,
        sort_order=template.sort_order,
        schema_version=template.schema_version,
        template_json=dict(template.template_json or {}),
        enabled=template.enabled,
        disabled_reason=template.disabled_reason,
        review_status=template.review_status,
        review_note=template.review_note,
    )


def _settings_generation_resource_group_export(group: GenerationResourceGroup) -> SettingsGenerationResourceGroupExport:
    return SettingsGenerationResourceGroupExport(
        id=group.id,
        key=group.key,
        name=group.name,
        description=group.description,
        sort_order=group.sort_order,
        enabled=group.enabled,
    )


def _build_settings_export_document(session: Session) -> SettingsExportDocument:
    ensure_provider_config_bootstrapped(session)
    settings = get_runtime_settings()
    runtime_config = {
        definition.key: _export_config_value(getattr(settings, definition.key), input_type=definition.input_type)
        for definition in CONFIG_DEFINITIONS
    }
    profiles = session.scalars(
        select(ProviderProfile)
        .where(ProviderProfile.archived_at.is_(None))
        .order_by(ProviderProfile.created_at, ProviderProfile.name)
    ).all()
    bindings = session.scalars(select(ProviderBinding).order_by(ProviderBinding.purpose)).all()
    generation_resource_groups = list_generation_resource_groups(session)
    generation_configs = list_generation_configs(session)
    template_categories = session.scalars(
        select(DbCanvasTemplateCategory)
        .where(DbCanvasTemplateCategory.archived_at.is_(None))
        .order_by(DbCanvasTemplateCategory.scope, DbCanvasTemplateCategory.sort_order, DbCanvasTemplateCategory.name)
    ).all()
    templates = session.scalars(
        select(DbCanvasTemplate)
        .where(DbCanvasTemplate.archived_at.is_(None))
        .order_by(
            DbCanvasTemplate.scope,
            DbCanvasTemplate.entry_mode,
            DbCanvasTemplate.sort_order,
            DbCanvasTemplate.title,
            DbCanvasTemplate.created_at,
        )
    ).all()
    return SettingsExportDocument(
        metadata=SettingsExportMetadataResponse(
            schema_version=SETTINGS_EXPORT_SCHEMA_VERSION,
            exported_at=now_utc(),
            app="Inspiration One",
            app_version=__version__,
            compatibility=SETTINGS_EXPORT_COMPATIBILITY,
        ),
        runtime_config=runtime_config,
        provider_profiles=[
            SettingsProviderProfileExport(
                id=profile.id,
                name=profile.name,
                provider_type=profile.provider_type,
                base_url=profile.base_url,
                api_key=profile.api_key,
                capabilities=list(profile.capabilities_json or []),
                default_models=dict(profile.default_models_json or {}),
                config=dict(profile.config_json or {}),
                enabled=profile.enabled,
            )
            for profile in profiles
        ],
        provider_bindings=[
            SettingsProviderBindingExport(
                purpose=binding.purpose,
                provider_kind=binding.provider_kind,
                provider_profile_id=binding.provider_profile_id,
                model_settings=dict(binding.model_settings_json or {}),
                config=dict(binding.config_json or {}),
            )
            for binding in bindings
        ],
        generation_resource_groups=[
            _settings_generation_resource_group_export(group) for group in generation_resource_groups
        ],
        generation_configs=[
            SettingsGenerationConfigExport(
                id=generation_config.id,
                resource_group_id=generation_config.resource_group_id,
                name=generation_config.name,
                purpose=generation_config.purpose,
                provider_kind=generation_config.provider_kind,
                provider_profile_id=generation_config.provider_profile_id,
                model_settings=dict(generation_config.model_settings_json or {}),
                config=dict(generation_config.config_json or {}),
                priority=generation_config.priority,
                max_concurrency=generation_config.max_concurrency,
                enabled=generation_config.enabled,
                availability_window_minutes=generation_config.availability_window_minutes,
                failure_threshold=generation_config.failure_threshold,
                cooldown_minutes=generation_config.cooldown_minutes,
            )
            for generation_config in generation_configs
        ],
        canvas_template_categories=[
            _serialize_canvas_template_category_export(category) for category in template_categories
        ],
        canvas_templates=[_serialize_canvas_template_export(template) for template in templates],
    )


def _parse_settings_import_document(payload: Any) -> SettingsExportDocument:
    try:
        document = SettingsExportDocument.model_validate(payload)
    except ValidationError as exc:
        raise ValueError("配置文件格式不正确") from exc
    if document.metadata.schema_version != SETTINGS_EXPORT_SCHEMA_VERSION:
        raise ValueError("配置文件版本不支持")
    if document.metadata.compatibility != SETTINGS_EXPORT_COMPATIBILITY:
        raise ValueError("配置文件兼容标识不支持")
    return document


def _normalize_runtime_import_config(document: SettingsExportDocument) -> dict[str, str]:
    runtime_config = {key: value for key, value in document.runtime_config.items() if key != "admin_access_required"}
    unknown_keys = set(runtime_config) - RUNTIME_CONFIG_KEYS
    if unknown_keys:
        raise ValueError(f"未知配置项: {', '.join(sorted(unknown_keys))}")
    missing_keys = RUNTIME_CONFIG_KEYS - set(runtime_config)
    if missing_keys:
        raise ValueError(f"配置文件缺少配置项: {', '.join(sorted(missing_keys))}")
    normalized_values = normalize_config_values(runtime_config)
    _validate_runtime_settings(normalized_values)
    return normalized_values


def _dedupe_ordered(values: list[str]) -> list[str]:
    result: list[str] = []
    for value in values:
        if value not in result:
            result.append(value)
    return result


def _normalize_optional_text(value: str | None) -> str | None:
    normalized = "" if value is None else str(value).strip()
    return normalized or None


def _normalize_import_generation_resource_groups(document: SettingsExportDocument) -> list[dict[str, Any]]:
    groups: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    seen_keys: set[str] = set()
    source_groups = document.generation_resource_groups or [
        SettingsGenerationResourceGroupExport(
            id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            key=DEFAULT_GENERATION_RESOURCE_GROUP_KEY,
            name="default",
            description="default 供应商生成能力分组",
            sort_order=0,
            enabled=True,
        )
    ]
    for group in source_groups:
        group_id = group.id.strip()
        key = group.key.strip().lower()
        name = group.name.strip()
        if not group_id:
            raise ValueError("生成分组 id 不能为空")
        if not key:
            raise ValueError("生成分组 key 不能为空")
        if not name:
            raise ValueError("生成分组名称不能为空")
        if group_id in seen_ids or key in seen_keys:
            raise ValueError("生成分组不能重复")
        seen_ids.add(group_id)
        seen_keys.add(key)
        groups.append(
            {
                "id": group_id,
                "key": key,
                "name": name,
                "description": _normalize_optional_text(group.description),
                "sort_order": group.sort_order,
                "enabled": group.enabled,
            }
        )
    if DEFAULT_GENERATION_RESOURCE_GROUP_ID not in seen_ids and DEFAULT_GENERATION_RESOURCE_GROUP_KEY not in seen_keys:
        groups.insert(
            0,
            {
                "id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
                "key": DEFAULT_GENERATION_RESOURCE_GROUP_KEY,
                "name": "default",
                "description": "default 供应商生成能力分组",
                "sort_order": 0,
                "enabled": True,
            },
        )
    return groups


def _normalize_import_profiles(document: SettingsExportDocument) -> list[dict[str, Any]]:
    seen_profile_ids: set[str] = set()
    profiles: list[dict[str, Any]] = []
    for profile in document.provider_profiles:
        if profile.id in seen_profile_ids:
            raise ValueError("供应商档案不能重复")
        seen_profile_ids.add(profile.id)
        if profile.provider_type not in PROVIDER_TYPES:
            raise ValueError("供应商类型不支持")
        capabilities = _dedupe_ordered([str(capability).strip() for capability in profile.capabilities])
        validate_provider_capabilities(capabilities)
        name = profile.name.strip()
        if not name:
            raise ValueError("供应商名称不能为空")
        base_url = _normalize_optional_text(profile.base_url)
        validate_provider_profile_contract(
            provider_type=profile.provider_type,
            capabilities=capabilities,
            base_url=base_url,
        )
        profiles.append(
            {
                "id": profile.id,
                "name": name,
                "provider_type": profile.provider_type,
                "base_url": base_url,
                "api_key": _normalize_optional_text(profile.api_key),
                "capabilities_json": capabilities,
                "default_models_json": dict(profile.default_models),
                "config_json": dict(profile.config),
                "enabled": profile.enabled,
            }
        )
    return profiles


def _normalize_import_bindings(
    document: SettingsExportDocument,
    profiles: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    profiles_by_id = {profile["id"]: profile for profile in profiles}
    seen_purposes: set[str] = set()
    bindings: list[dict[str, Any]] = []
    for binding in document.provider_bindings:
        if binding.purpose in seen_purposes:
            raise ValueError("供应商用途绑定不能重复")
        seen_purposes.add(binding.purpose)
        if binding.purpose not in PROVIDER_PURPOSES:
            raise ValueError("用途必须是 text 或 image")
        allowed_kinds = TEXT_PROVIDER_KINDS if binding.purpose == "text" else IMAGE_PROVIDER_KINDS
        if binding.provider_kind not in allowed_kinds:
            raise ValueError("供应商接口类型不支持当前用途")
        normalized_config = normalize_provider_binding_runtime_config(
            purpose=binding.purpose,
            provider_kind=binding.provider_kind,
            model_settings=binding.model_settings,
            config=binding.config,
        )
        normalized_model_settings = normalize_provider_binding_model_settings(
            purpose=binding.purpose,
            model_settings=binding.model_settings,
        )
        provider_profile_id = binding.provider_profile_id
        if binding.provider_kind == "mock":
            provider_profile_id = None
        else:
            if not provider_profile_id:
                raise ValueError("真实供应商必须选择供应商档案")
            profile = profiles_by_id.get(provider_profile_id)
            if profile is None:
                raise ValueError("供应商不存在")
            if not profile["enabled"]:
                raise ValueError("供应商已停用")
            capability = capability_for_provider_kind(binding.provider_kind)
            if capability not in set(profile["capabilities_json"]):
                raise ValueError("供应商档案不支持当前接口能力")
        bindings.append(
            {
                "purpose": binding.purpose,
                "provider_kind": binding.provider_kind,
                "provider_profile_id": provider_profile_id,
                "model_settings_json": normalized_model_settings,
                "config_json": normalized_config,
            }
        )
    missing_purposes = PROVIDER_PURPOSES - seen_purposes
    if missing_purposes:
        raise ValueError(f"配置文件缺少供应商绑定: {', '.join(sorted(missing_purposes))}")
    return bindings


def _normalize_import_generation_configs(
    document: SettingsExportDocument,
    profiles: list[dict[str, Any]],
    bindings: list[dict[str, Any]],
    generation_resource_groups: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    resource_group_ids = {group["id"] for group in generation_resource_groups}
    fallback_resource_group_id = generation_resource_groups[0]["id"]
    if not document.generation_configs:
        return [
            {
                "id": None,
                "resource_group_id": fallback_resource_group_id,
                "name": "默认文案配置" if binding["purpose"] == "text" else "默认图片配置",
                "purpose": binding["purpose"],
                "provider_kind": binding["provider_kind"],
                "provider_profile_id": binding["provider_profile_id"],
                "model_settings": dict(binding["model_settings_json"]),
                "config": dict(binding["config_json"]),
                "priority": 100,
                "max_concurrency": 1,
                "enabled": True,
                "availability_window_minutes": None,
                "failure_threshold": None,
                "cooldown_minutes": None,
            }
            for binding in bindings
        ]

    profiles_by_id = {profile["id"]: profile for profile in profiles}
    seen_ids: set[str] = set()
    generation_configs: list[dict[str, Any]] = []
    for item in document.generation_configs:
        config_id = item.id.strip() if item.id else None
        if config_id is not None:
            if config_id in seen_ids:
                raise ValueError("生成配置不能重复")
            seen_ids.add(config_id)
        if item.purpose not in PROVIDER_PURPOSES:
            raise ValueError("用途必须是 text 或 image")
        allowed_kinds = TEXT_PROVIDER_KINDS if item.purpose == "text" else IMAGE_PROVIDER_KINDS
        if item.provider_kind not in allowed_kinds:
            raise ValueError("供应商接口类型不支持当前用途")
        normalized_config = normalize_provider_binding_runtime_config(
            purpose=item.purpose,
            provider_kind=item.provider_kind,
            model_settings=item.model_settings,
            config=item.config,
        )
        normalized_model_settings = normalize_provider_binding_model_settings(
            purpose=item.purpose,
            model_settings=item.model_settings,
        )
        provider_profile_id = item.provider_profile_id
        resource_group_id = item.resource_group_id or fallback_resource_group_id
        if resource_group_id not in resource_group_ids:
            raise ValueError("生成配置引用的分组不存在")
        if item.provider_kind == "mock":
            provider_profile_id = None
        else:
            if not provider_profile_id:
                raise ValueError("真实供应商必须选择供应商档案")
            profile = profiles_by_id.get(provider_profile_id)
            if profile is None:
                raise ValueError("供应商不存在")
            if not profile["enabled"]:
                raise ValueError("供应商已停用")
            capability = capability_for_provider_kind(item.provider_kind)
            if capability not in set(profile["capabilities_json"]):
                raise ValueError("供应商档案不支持当前接口能力")
        generation_configs.append(
            {
                "id": config_id,
                "resource_group_id": resource_group_id,
                "name": item.name.strip(),
                "purpose": item.purpose,
                "provider_kind": item.provider_kind,
                "provider_profile_id": provider_profile_id,
                "model_settings": normalized_model_settings,
                "config": normalized_config,
                "priority": item.priority,
                "max_concurrency": item.max_concurrency,
                "enabled": item.enabled,
                "availability_window_minutes": item.availability_window_minutes,
                "failure_threshold": item.failure_threshold,
                "cooldown_minutes": item.cooldown_minutes,
            }
        )
    if not any(item["purpose"] == "text" for item in generation_configs):
        raise ValueError("配置文件缺少文案生成配置")
    if not any(item["purpose"] == "image" for item in generation_configs):
        raise ValueError("配置文件缺少图片生成配置")
    return generation_configs


def _normalize_import_canvas_template_categories(document: SettingsExportDocument) -> list[dict[str, Any]]:
    seen_ids: set[str] = set()
    seen_global_names: set[str] = set()
    seen_user_names: set[tuple[str, str]] = set()
    categories: list[dict[str, Any]] = []
    for item in document.canvas_template_categories:
        category_id = item.id.strip()
        if category_id in seen_ids:
            raise ValueError("画布模板分类不能重复")
        seen_ids.add(category_id)
        if item.scope not in {"global", "user"}:
            raise ValueError("画布模板分类范围不支持")
        owner_user_id = _normalize_optional_text(item.owner_user_id)
        if item.scope == "global":
            owner_user_id = None
            normalized_name_key = item.name.strip()
            if normalized_name_key in seen_global_names:
                raise ValueError("全局画布模板分类名称不能重复")
            seen_global_names.add(normalized_name_key)
        elif owner_user_id is None:
            raise ValueError("用户画布模板分类缺少 owner_user_id")
        else:
            user_name_key = (owner_user_id, item.name.strip())
            if user_name_key in seen_user_names:
                raise ValueError("用户画布模板分类名称不能重复")
            seen_user_names.add(user_name_key)
        name = item.name.strip()
        if not name:
            raise ValueError("画布模板分类名称不能为空")
        categories.append(
            {
                "id": category_id,
                "scope": item.scope,
                "owner_user_id": owner_user_id,
                "name": name,
                "sort_order": item.sort_order,
                "enabled": item.enabled,
                "disabled_reason": _normalize_optional_text(item.disabled_reason),
            }
        )
    return categories


def _normalize_import_canvas_templates(
    document: SettingsExportDocument,
    categories: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    category_ids = {category["id"] for category in categories}
    seen_ids: set[str] = set()
    seen_keys: set[str] = set()
    templates: list[dict[str, Any]] = []
    for item in document.canvas_templates:
        template_id = item.id.strip()
        if template_id in seen_ids:
            raise ValueError("画布模板不能重复")
        seen_ids.add(template_id)
        key = item.key.strip()
        if key in seen_keys:
            raise ValueError("画布模板 key 不能重复")
        seen_keys.add(key)
        if item.scope not in {"global", "user"}:
            raise ValueError("画布模板范围不支持")
        owner_user_id = _normalize_optional_text(item.owner_user_id)
        if item.scope == "global":
            owner_user_id = None
        elif owner_user_id is None:
            raise ValueError("用户画布模板缺少 owner_user_id")
        category_id = _normalize_optional_text(item.category_id)
        if category_id is not None and category_id not in category_ids:
            raise ValueError("画布模板分类不存在")
        if item.kind not in {"full_canvas", "node_group"}:
            raise ValueError("画布模板类型不支持")
        if item.entry_mode not in {"image", "copy", "tail"}:
            raise ValueError("画布模板入口类型不支持")
        title = item.title.strip()
        if not title:
            raise ValueError("画布模板名称不能为空")
        payload = dict(item.template_json)
        try:
            CanvasTemplatePayload.model_validate(
                {
                    **payload,
                    "key": key,
                    "template_id": template_id,
                    "version": item.schema_version,
                    "kind": item.kind,
                    "entry_mode": item.entry_mode,
                    "sort_order": item.sort_order,
                    "title": title,
                    "description": item.description or "",
                    "source": "user" if item.scope == "user" else "builtin",
                    "user_template_id": template_id if item.scope == "user" else None,
                    "scope": item.scope,
                    "owner_user_id": owner_user_id,
                    "category_id": category_id,
                    "enabled": item.enabled,
                    "effective_enabled": item.enabled,
                    "disabled_reason": item.disabled_reason,
                    "review_status": item.review_status,
                    "review_note": item.review_note,
                }
            )
        except ValueError as exc:
            raise ValueError(f"画布模板 {title} 格式不正确") from exc
        templates.append(
            {
                "id": template_id,
                "key": key,
                "scope": item.scope,
                "owner_user_id": owner_user_id,
                "category_id": category_id,
                "title": title,
                "description": _normalize_optional_text(item.description),
                "kind": item.kind,
                "entry_mode": item.entry_mode,
                "sort_order": item.sort_order,
                "schema_version": item.schema_version,
                "template_json": payload,
                "enabled": item.enabled,
                "disabled_reason": _normalize_optional_text(item.disabled_reason),
                "review_status": (
                    item.review_status if item.review_status in {"none", "pending", "approved", "rejected"} else "none"
                ),
                "review_note": _normalize_optional_text(item.review_note),
            }
        )
    return templates


def _build_settings_import_bundle(payload: Any) -> _SettingsImportBundle:
    document = _parse_settings_import_document(payload)
    normalized_runtime_config = _normalize_runtime_import_config(document)
    profiles = _normalize_import_profiles(document)
    bindings = _normalize_import_bindings(document, profiles)
    generation_resource_groups = _normalize_import_generation_resource_groups(document)
    generation_configs = _normalize_import_generation_configs(document, profiles, bindings, generation_resource_groups)
    canvas_template_categories = _normalize_import_canvas_template_categories(document)
    canvas_templates = _normalize_import_canvas_templates(document, canvas_template_categories)
    if any(
        generation_config["purpose"] == "image" and is_real_image_provider_kind(generation_config["provider_kind"])
        for generation_config in generation_configs
    ):
        normalized_runtime_config["poster_generation_mode"] = "generated"
    preview = SettingsImportPreviewResponse(
        schema_version=document.metadata.schema_version,
        runtime_config_count=len(normalized_runtime_config),
        provider_profile_count=len(profiles),
        provider_binding_count=len(bindings),
        generation_resource_group_count=len(generation_resource_groups),
        generation_config_count=len(generation_configs),
        canvas_template_category_count=len(canvas_template_categories),
        canvas_template_count=len(canvas_templates),
        provider_profile_names=[profile["name"] for profile in profiles],
        provider_binding_purposes=sorted({generation_config["purpose"] for generation_config in generation_configs}),
        includes_api_keys=any(bool(profile["api_key"]) for profile in profiles),
        provider_profiles_with_api_key_count=sum(1 for profile in profiles if profile["api_key"]),
        canvas_template_keys=[template["key"] for template in canvas_templates],
        canvas_template_category_names=[category["name"] for category in canvas_template_categories],
    )
    return _SettingsImportBundle(
        normalized_runtime_config=normalized_runtime_config,
        provider_profiles=profiles,
        provider_bindings=bindings,
        generation_resource_groups=generation_resource_groups,
        generation_configs=generation_configs,
        canvas_template_categories=canvas_template_categories,
        canvas_templates=canvas_templates,
        preview=preview,
    )


def _upsert_canvas_template_category(session: Session, category: dict[str, Any]) -> None:
    row = session.get(DbCanvasTemplateCategory, category["id"])
    if row is None:
        row = DbCanvasTemplateCategory(id=category["id"], scope=category["scope"])
        session.add(row)
    row.scope = category["scope"]
    row.owner_user_id = category["owner_user_id"]
    row.name = category["name"]
    row.sort_order = category["sort_order"]
    row.enabled = category["enabled"]
    if category["enabled"]:
        row.disabled_at = None
        row.disabled_by_user_id = None
        row.disabled_reason = None
    else:
        row.disabled_at = row.disabled_at or now_utc()
        row.disabled_by_user_id = None
        row.disabled_reason = category["disabled_reason"]
    row.archived_at = None


def _upsert_canvas_template(session: Session, template: dict[str, Any]) -> None:
    row = session.get(DbCanvasTemplate, template["id"])
    if row is None:
        row = DbCanvasTemplate(id=template["id"], key=template["key"], scope=template["scope"])
        session.add(row)
    row.key = template["key"]
    row.scope = template["scope"]
    row.owner_user_id = template["owner_user_id"]
    row.category_id = template["category_id"]
    row.title = template["title"]
    row.description = template["description"]
    row.kind = template["kind"]
    row.entry_mode = template["entry_mode"]
    row.sort_order = template["sort_order"]
    row.schema_version = template["schema_version"]
    row.template_json = template["template_json"]
    row.enabled = template["enabled"]
    if template["enabled"]:
        row.disabled_at = None
        row.disabled_by_user_id = None
        row.disabled_reason = None
        row.review_status = template["review_status"]
    else:
        row.disabled_at = row.disabled_at or now_utc()
        row.disabled_by_user_id = None
        row.disabled_reason = template["disabled_reason"]
        row.review_status = template["review_status"]
    row.review_note = template["review_note"]
    row.archived_at = None


def _validate_settings_import_canvas_template_references(session: Session, bundle: _SettingsImportBundle) -> None:
    owner_user_ids = {
        owner_user_id
        for item in (*bundle.canvas_template_categories, *bundle.canvas_templates)
        if (owner_user_id := item["owner_user_id"]) is not None
    }
    if owner_user_ids:
        existing_owner_user_ids = set(
            session.scalars(
                select(AuthUser.id).where(
                    AuthUser.id.in_(owner_user_ids),
                    AuthUser.archived_at.is_(None),
                )
            )
        )
        if owner_user_ids - existing_owner_user_ids:
            raise ValueError("导入文件引用的用户不存在")

    categories_by_id = {category["id"]: category for category in bundle.canvas_template_categories}
    for template in bundle.canvas_templates:
        category_id = template["category_id"]
        if category_id is None:
            continue
        category = categories_by_id[category_id]
        if category["scope"] != template["scope"]:
            raise ValueError("画布模板分类范围不匹配")
        if template["scope"] == "user" and category["owner_user_id"] != template["owner_user_id"]:
            raise ValueError("画布模板分类不存在")


def _apply_settings_import_bundle(session: Session, bundle: _SettingsImportBundle) -> None:
    with session.begin():
        _validate_settings_import_canvas_template_references(session, bundle)
        for key, value in bundle.normalized_runtime_config.items():
            existing = session.get(AppSetting, key)
            if existing is None:
                session.add(AppSetting(key=key, value=value))
            else:
                existing.value = value

        session.execute(delete(GenerationConfigDailyStat))
        session.execute(delete(GenerationConfigState))
        session.execute(delete(GenerationConfig))
        session.execute(delete(UserGenerationResourceGroupGrant))
        session.execute(delete(GenerationResourceGroup))
        session.execute(delete(ProviderBinding))
        session.execute(delete(ProviderProfile))
        session.flush()

        for group in bundle.generation_resource_groups:
            session.add(
                GenerationResourceGroup(
                    id=group["id"],
                    key=group["key"],
                    name=group["name"],
                    description=group["description"],
                    sort_order=group["sort_order"],
                    enabled=group["enabled"],
                )
            )
        session.flush()

        for profile in bundle.provider_profiles:
            session.add(
                ProviderProfile(
                    id=profile["id"],
                    name=profile["name"],
                    provider_type=profile["provider_type"],
                    base_url=profile["base_url"],
                    api_key=profile["api_key"],
                    capabilities_json=profile["capabilities_json"],
                    default_models_json=profile["default_models_json"],
                    config_json=profile["config_json"],
                    enabled=profile["enabled"],
                )
            )
        session.flush()
        for generation_config in bundle.generation_configs:
            add_generation_config(
                session,
                generation_config_id=generation_config["id"],
                resource_group_id=generation_config["resource_group_id"],
                name=generation_config["name"],
                purpose=generation_config["purpose"],
                provider_kind=generation_config["provider_kind"],
                provider_profile_id=generation_config["provider_profile_id"],
                model_settings=generation_config["model_settings"],
                config=generation_config["config"],
                priority=generation_config["priority"],
                max_concurrency=generation_config["max_concurrency"],
                enabled=generation_config["enabled"],
                availability_window_minutes=generation_config["availability_window_minutes"],
                failure_threshold=generation_config["failure_threshold"],
                cooldown_minutes=generation_config["cooldown_minutes"],
                commit=False,
            )

        for category in bundle.canvas_template_categories:
            _upsert_canvas_template_category(session, category)
        session.flush()
        for template in bundle.canvas_templates:
            _upsert_canvas_template(session, template)
    session.expire_all()


@router.get("", response_model=ConfigResponse, dependencies=[READ_SETTINGS_PERMISSION])
def get_config_endpoint(session: Session = Depends(get_session)) -> ConfigResponse:
    return _serialize_config(session)


@router.get(
    "/provider-config",
    response_model=ProviderConfigResponse,
    dependencies=[READ_SETTINGS_PERMISSION],
)
def get_provider_config_endpoint(session: Session = Depends(get_session)) -> ProviderConfigResponse:
    ensure_provider_config_bootstrapped(session)
    return _serialize_provider_config(session)


@router.get(
    "/generation-config-status",
    response_model=GenerationConfigStatusSummaryResponse,
    dependencies=[READ_STATUS_PERMISSION],
)
def get_generation_config_status_endpoint(
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    session: Session = Depends(get_session),
) -> GenerationConfigStatusSummaryResponse:
    ensure_provider_config_bootstrapped(session)
    range_start = start_date or end_date
    range_end = end_date or range_start
    if range_start is not None and range_end is not None and range_end < range_start:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="日期范围无效")
    return _serialize_generation_config_status_summary(session, start_date=range_start, end_date=range_end)


@router.get(
    "/generation-configs",
    response_model=list[GenerationConfigResponse],
    dependencies=[READ_SETTINGS_PERMISSION],
)
def list_generation_configs_endpoint(session: Session = Depends(get_session)) -> list[GenerationConfigResponse]:
    ensure_provider_config_bootstrapped(session)
    today_stats = _today_generation_config_stats(session)
    return [
        _serialize_generation_config(generation_config, today_stats=today_stats)
        for generation_config in list_generation_configs(session)
    ]


@router.get(
    "/generation-config-options",
    response_model=list[GenerationConfigOptionResponse],
    dependencies=[READ_GENERATION_RUNTIME_PERMISSION],
)
def list_generation_config_options_endpoint(
    session: Session = Depends(get_session),
) -> list[GenerationConfigOptionResponse]:
    ensure_provider_config_bootstrapped(session)
    return [
        _serialize_generation_config_option(generation_config) for generation_config in list_generation_configs(session)
    ]


@router.get(
    "/generation-resource-groups",
    response_model=list[GenerationResourceGroupResponse],
    dependencies=[READ_SETTINGS_PERMISSION],
)
def list_generation_resource_groups_endpoint(
    session: Session = Depends(get_session),
) -> list[GenerationResourceGroupResponse]:
    ensure_provider_config_bootstrapped(session)
    return [_serialize_generation_resource_group(group) for group in list_generation_resource_groups(session)]


@router.post(
    "/generation-resource-groups",
    response_model=GenerationResourceGroupResponse,
    dependencies=[WRITE_PROVIDER_SETTINGS_PERMISSION],
)
def create_generation_resource_group_endpoint(
    payload: GenerationResourceGroupCreateRequest,
    session: Session = Depends(get_session),
) -> GenerationResourceGroupResponse:
    try:
        ensure_provider_config_bootstrapped(session)
        group = add_generation_resource_group(
            session,
            key=payload.key,
            name=payload.name,
            description=payload.description,
            sort_order=payload.sort_order,
            enabled=payload.enabled,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _serialize_generation_resource_group(group)


@router.patch(
    "/generation-resource-groups/{resource_group_id}",
    response_model=GenerationResourceGroupResponse,
    dependencies=[WRITE_PROVIDER_SETTINGS_PERMISSION],
)
def update_generation_resource_group_endpoint(
    resource_group_id: str,
    payload: GenerationResourceGroupUpdateRequest,
    session: Session = Depends(get_session),
) -> GenerationResourceGroupResponse:
    try:
        ensure_provider_config_bootstrapped(session)
        fields_set = payload.model_fields_set
        group = update_generation_resource_group(
            session,
            resource_group_id,
            key=payload.key,
            name=payload.name,
            description=payload.description if "description" in fields_set else UNSET_PROVIDER_FIELD,
            sort_order=payload.sort_order,
            enabled=payload.enabled,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _serialize_generation_resource_group(group)


@router.delete(
    "/generation-resource-groups/{resource_group_id}",
    response_model=GenerationResourceGroupResponse,
    dependencies=[WRITE_PROVIDER_SETTINGS_PERMISSION],
)
def archive_generation_resource_group_endpoint(
    resource_group_id: str,
    session: Session = Depends(get_session),
) -> GenerationResourceGroupResponse:
    try:
        ensure_provider_config_bootstrapped(session)
        group = archive_generation_resource_group(session, resource_group_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _serialize_generation_resource_group(group)


@router.get(
    "/my-generation-resource-groups",
    response_model=list[GenerationResourceGroupResponse],
    dependencies=[READ_GENERATION_RUNTIME_PERMISSION],
)
def list_my_generation_resource_groups_endpoint(
    current_user: AuthUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> list[GenerationResourceGroupResponse]:
    groups = list_available_generation_resource_groups_for_user(session, user=current_user)
    return [_serialize_generation_resource_group(group) for group in groups]


@router.post(
    "/generation-configs/test-text",
    response_model=TextGenerationConfigTestResponse,
    dependencies=[WRITE_PROVIDER_SETTINGS_PERMISSION],
)
def test_text_generation_config_endpoint(
    payload: TextGenerationConfigTestRequest,
    session: Session = Depends(get_session),
) -> TextGenerationConfigTestResponse:
    try:
        ensure_provider_config_bootstrapped(session)
        if payload.generation_config is not None:
            draft = payload.generation_config
            resolved_config = resolve_text_provider_config_from_draft(
                session,
                name=draft.name,
                provider_kind=draft.provider_kind,
                provider_profile_id=draft.provider_profile_id,
                model_settings=draft.model_settings,
                config=draft.config,
            )
        elif payload.generation_config_id is not None:
            generation_config = session.scalar(
                select(GenerationConfig)
                .options(selectinload(GenerationConfig.provider_profile))
                .where(
                    GenerationConfig.id == payload.generation_config_id,
                    GenerationConfig.purpose == "text",
                    GenerationConfig.archived_at.is_(None),
                )
            )
            if generation_config is None:
                raise ValueError("生成配置不存在")
            resolved_config = resolve_text_provider_config_from_draft(
                session,
                name=generation_config.name,
                provider_kind=generation_config.provider_kind,
                provider_profile_id=generation_config.provider_profile_id,
                model_settings=dict(generation_config.model_settings_json or {}),
                config=dict(generation_config.config_json or {}),
            )
        else:
            raise ValueError("请提供文案生成配置")
        if resolved_config.provider_kind == "mock":
            text_provider = MockTextProvider()
        elif resolved_config.provider_kind == "openai":
            text_provider = OpenAITextProvider(resolved_config)
        else:
            raise ValueError(f"暂不支持的文案 provider: {resolved_config.provider_kind}")
        inspiration_input = InspirationInput(
            name=payload.inspiration.name,
            category=payload.inspiration.category,
            price=payload.inspiration.price,
            source_note=payload.inspiration.source_note,
            image_path="",
        )
        brief_start = perf_counter()
        brief, brief_model = text_provider.generate_brief(inspiration_input)
        copy_config = CopyNodeConfigV2(
            instruction=payload.copy_request.instruction,
            purpose=payload.copy_request.purpose,
            channel=payload.copy_request.channel,
            tone=payload.copy_request.tone,
            output_mode=payload.copy_request.output_mode,
        )
        copy, copy_model = text_provider.generate_copy(inspiration_input, brief, copy_config)
        duration_ms = int((perf_counter() - brief_start) * 1000)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("文案生成配置测试失败")
        raise HTTPException(status_code=502, detail="文案生成配置测试失败，请稍后重试") from exc
    return TextGenerationConfigTestResponse(
        generation_config_id=payload.generation_config_id,
        provider_kind=resolved_config.provider_kind,
        brief_model=brief_model,
        copy_model=copy_model,
        brief=brief.model_dump(mode="json"),
        copy_result=copy.model_dump(mode="json"),
        duration_ms=duration_ms,
    )


@router.post(
    "/generation-configs",
    response_model=GenerationConfigResponse,
    dependencies=[WRITE_PROVIDER_SETTINGS_PERMISSION],
)
def create_generation_config_endpoint(
    payload: GenerationConfigCreateRequest,
    session: Session = Depends(get_session),
) -> GenerationConfigResponse:
    try:
        ensure_provider_config_bootstrapped(session)
        generation_config = add_generation_config(
            session,
            resource_group_id=payload.resource_group_id,
            name=payload.name,
            purpose=payload.purpose,
            provider_kind=payload.provider_kind,
            provider_profile_id=payload.provider_profile_id,
            model_settings=payload.model_settings,
            config=payload.config,
            priority=payload.priority,
            max_concurrency=payload.max_concurrency,
            enabled=payload.enabled,
            availability_window_minutes=payload.availability_window_minutes,
            failure_threshold=payload.failure_threshold,
            cooldown_minutes=payload.cooldown_minutes,
            commit=False,
        )
        if generation_config.purpose == "image" and is_real_image_provider_kind(generation_config.provider_kind):
            _upsert_app_setting(session, key="poster_generation_mode", value="generated")
        session.commit()
        session.refresh(generation_config)
    except ValueError as exc:
        session.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    today_stats = _today_generation_config_stats(session)
    return _serialize_generation_config(generation_config, today_stats=today_stats)


@router.patch(
    "/generation-configs/{generation_config_id}",
    response_model=GenerationConfigResponse,
    dependencies=[WRITE_PROVIDER_SETTINGS_PERMISSION],
)
def update_generation_config_endpoint(
    generation_config_id: str,
    payload: GenerationConfigUpdateRequest,
    session: Session = Depends(get_session),
) -> GenerationConfigResponse:
    try:
        ensure_provider_config_bootstrapped(session)
        fields_set = payload.model_fields_set
        generation_config = update_generation_config(
            session,
            generation_config_id,
            resource_group_id=payload.resource_group_id if "resource_group_id" in fields_set else None,
            name=payload.name,
            purpose=payload.purpose,
            provider_kind=payload.provider_kind,
            provider_profile_id=(
                payload.provider_profile_id if "provider_profile_id" in fields_set else UNSET_PROVIDER_FIELD
            ),
            model_settings=payload.model_settings,
            config=payload.config,
            priority=payload.priority,
            max_concurrency=payload.max_concurrency,
            enabled=payload.enabled,
            availability_window_minutes=payload.availability_window_minutes,
            failure_threshold=payload.failure_threshold,
            cooldown_minutes=payload.cooldown_minutes,
            commit=False,
        )
        if generation_config.purpose == "image" and is_real_image_provider_kind(generation_config.provider_kind):
            _upsert_app_setting(session, key="poster_generation_mode", value="generated")
        session.commit()
        session.refresh(generation_config)
    except ValueError as exc:
        session.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    today_stats = _today_generation_config_stats(session)
    return _serialize_generation_config(generation_config, today_stats=today_stats)


@router.delete(
    "/generation-configs/{generation_config_id}",
    response_model=GenerationConfigResponse,
    dependencies=[WRITE_PROVIDER_SETTINGS_PERMISSION],
)
def archive_generation_config_endpoint(
    generation_config_id: str,
    session: Session = Depends(get_session),
) -> GenerationConfigResponse:
    try:
        ensure_provider_config_bootstrapped(session)
        generation_config = archive_generation_config(session, generation_config_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    today_stats = _today_generation_config_stats(session)
    return _serialize_generation_config(generation_config, today_stats=today_stats)


@router.get(
    "/provider-profiles/{profile_id}/models",
    response_model=ProviderModelListResponse,
    dependencies=[READ_SETTINGS_PERMISSION],
)
def list_provider_models_endpoint(
    profile_id: str,
    provider_kind: str,
    session: Session = Depends(get_session),
) -> ProviderModelListResponse:
    try:
        ensure_provider_config_bootstrapped(session)
        profile = _load_profile_for_model_discovery(session, profile_id, provider_kind)
        models = list_provider_models(profile, provider_kind)
    except ProviderModelDiscoveryUnsupportedError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ProviderModelDiscoveryError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return ProviderModelListResponse(models=[_provider_model_response(model) for model in models])


@router.get(
    "/export",
    response_model=SettingsExportDocument,
    dependencies=[READ_SETTINGS_PERMISSION],
)
def export_settings_endpoint(session: Session = Depends(get_session)) -> SettingsExportDocument:
    return _build_settings_export_document(session)


@router.post(
    "/import/preview",
    response_model=SettingsImportPreviewResponse,
    dependencies=[MIGRATE_SETTINGS_PERMISSION],
)
def preview_settings_import_endpoint(payload: Any = Body(...)) -> SettingsImportPreviewResponse:
    try:
        bundle = _build_settings_import_bundle(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return bundle.preview


@router.post(
    "/import",
    response_model=SettingsImportCommitResponse,
    dependencies=[MIGRATE_SETTINGS_PERMISSION],
)
def import_settings_endpoint(
    payload: Any = Body(...),
    session: Session = Depends(get_session),
) -> SettingsImportCommitResponse:
    try:
        bundle = _build_settings_import_bundle(payload)
        _apply_settings_import_bundle(session, bundle)
    except ValueError as exc:
        session.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return SettingsImportCommitResponse(
        preview=bundle.preview,
        config=_serialize_config(session),
        provider_config=_serialize_provider_config(session),
    )


@router.post(
    "/provider-profiles",
    response_model=ProviderProfileResponse,
    dependencies=[WRITE_PROVIDER_SETTINGS_PERMISSION],
)
def create_provider_profile_endpoint(
    payload: ProviderProfileCreateRequest,
    session: Session = Depends(get_session),
) -> ProviderProfileResponse:
    try:
        ensure_provider_config_bootstrapped(session)
        profile = create_provider_profile(
            session,
            name=payload.name,
            provider_type=payload.provider_type,
            base_url=payload.base_url,
            api_key=payload.api_key,
            capabilities=payload.capabilities,
            default_models=payload.default_models,
            config=payload.config,
            enabled=payload.enabled,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _serialize_provider_profile(profile)


@router.patch(
    "/provider-profiles/{profile_id}",
    response_model=ProviderProfileResponse,
    dependencies=[WRITE_PROVIDER_SETTINGS_PERMISSION],
)
def update_provider_profile_endpoint(
    profile_id: str,
    payload: ProviderProfileUpdateRequest,
    session: Session = Depends(get_session),
) -> ProviderProfileResponse:
    try:
        ensure_provider_config_bootstrapped(session)
        fields_set = payload.model_fields_set
        profile = update_provider_profile(
            session,
            profile_id,
            name=payload.name,
            provider_type=payload.provider_type,
            base_url=payload.base_url if "base_url" in fields_set else UNSET_PROVIDER_FIELD,
            api_key=payload.api_key if "api_key" in fields_set else UNSET_PROVIDER_FIELD,
            capabilities=payload.capabilities,
            default_models=payload.default_models,
            config=payload.config,
            enabled=payload.enabled,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _serialize_provider_profile(profile)


@router.delete(
    "/provider-profiles/{profile_id}",
    response_model=ProviderProfileResponse,
    dependencies=[WRITE_PROVIDER_SETTINGS_PERMISSION],
)
def archive_provider_profile_endpoint(
    profile_id: str,
    session: Session = Depends(get_session),
) -> ProviderProfileResponse:
    try:
        ensure_provider_config_bootstrapped(session)
        profile = archive_provider_profile(session, profile_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _serialize_provider_profile(profile)


@router.patch(
    "/provider-bindings/{purpose}",
    response_model=ProviderBindingResponse,
    dependencies=[WRITE_PROVIDER_SETTINGS_PERMISSION],
)
def update_provider_binding_endpoint(
    purpose: str,
    payload: ProviderBindingUpdateRequest,
    session: Session = Depends(get_session),
) -> ProviderBindingResponse:
    try:
        ensure_provider_config_bootstrapped(session)
        binding = update_provider_binding(
            session,
            purpose=purpose,
            provider_kind=payload.provider_kind,
            provider_profile_id=payload.provider_profile_id,
            model_settings=payload.model_settings,
            config=payload.config,
            commit=False,
        )
        if binding.purpose == "image" and is_real_image_provider_kind(binding.provider_kind):
            _upsert_app_setting(session, key="poster_generation_mode", value="generated")
        session.commit()
        session.refresh(binding)
    except (RuntimeError, ValueError) as exc:
        session.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _serialize_provider_binding(binding)


@router.get("/runtime", response_model=RuntimeConfigResponse, dependencies=[READ_GENERATION_RUNTIME_PERMISSION])
def get_runtime_config_endpoint() -> RuntimeConfigResponse:
    settings = get_runtime_settings()
    return RuntimeConfigResponse(
        image_generation_max_dimension=settings.image_generation_max_dimension,
        image_tool_allowed_fields=list(parse_image_tool_allowed_fields(settings.image_tool_allowed_fields)),
        generation_tail_splitter_max_items=settings.generation_tail_splitter_max_items,
        workflow_node_max_retry_count=settings.workflow_node_max_retry_count,
        workflow_node_retry_delay_ms=settings.workflow_node_retry_delay_ms,
        deletion_enabled=settings.deletion_enabled,
    )


@router.patch("", response_model=ConfigResponse, dependencies=[WRITE_SETTINGS_PERMISSION])
def update_config_endpoint(
    payload: ConfigUpdateRequest,
    session: Session = Depends(get_session),
) -> ConfigResponse:
    unknown_keys = (set(payload.values) | set(payload.reset_keys)) - set(CONFIG_DEFINITION_BY_KEY)
    if unknown_keys:
        raise HTTPException(status_code=400, detail=f"未知配置项: {', '.join(sorted(unknown_keys))}")

    reset_keys = set(payload.reset_keys)
    if reset_keys & set(payload.values):
        raise HTTPException(status_code=400, detail="同一个配置项不能同时更新和恢复默认")

    try:
        normalized_values = normalize_config_values(payload.values)
        current_values = _load_database_values(session)
        next_values = {key: row.value for key, row in current_values.items() if key not in reset_keys}
        next_values.update(normalized_values)
        _validate_runtime_settings(next_values)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    for key in reset_keys:
        existing = session.get(AppSetting, key)
        if existing is not None:
            session.delete(existing)
    for key, value in normalized_values.items():
        _upsert_app_setting(session, key=key, value=value)
    session.commit()
    return _serialize_config(session)
