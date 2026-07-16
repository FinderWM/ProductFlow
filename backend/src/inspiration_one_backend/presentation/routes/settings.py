from __future__ import annotations

import logging
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from time import perf_counter
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from pydantic import ValidationError
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, selectinload

from inspiration_one_backend.application.auth import list_available_generation_resource_groups_for_user
from inspiration_one_backend.application.auth_sessions import revoke_all_auth_sessions
from inspiration_one_backend.application.contracts import CopyNodeConfigV2, InspirationInput, ReferenceImageInput
from inspiration_one_backend.application.image_generation_failures import classify_image_generation_failure
from inspiration_one_backend.application.image_sessions import (
    abandon_image_generation_config_test_session,
    keep_image_generation_config_test_session,
)
from inspiration_one_backend.application.image_sessions import (
    test_image_generation_config as run_image_generation_config_test,
)
from inspiration_one_backend.application.moderation import ensure_resource_usable
from inspiration_one_backend.application.time import now_utc
from inspiration_one_backend.config import (
    CONFIG_DEFINITION_BY_KEY,
    CONFIG_DEFINITIONS,
    IMAGE_GENERATION_MAX_CONCURRENT_TASKS_KEY,
    LEGACY_GENERATION_MAX_CONCURRENT_TASKS_KEY,
    LEGACY_RUNTIME_CONFIG_KEYS,
    LOGIN_PAGE_TEMPLATE_CONFIG_KEYS,
    LOGIN_PAGE_TEMPLATE_IDS,
    RUNTIME_CONFIG_KEYS,
    TEXT_GENERATION_MAX_CONCURRENT_TASKS_KEY,
    build_settings_with_overrides,
    get_runtime_settings,
    migrate_legacy_login_page_config_values,
    normalize_config_values,
    normalize_image_generation_size,
    parse_config_multi_select,
    parse_image_tool_allowed_fields,
)
from inspiration_one_backend.domain.enums import ResourceLibraryAssetKind
from inspiration_one_backend.domain.errors import BusinessValidationError
from inspiration_one_backend.domain.rbac import (
    API_IMAGE_CHAT_READ,
    API_INSPIRATIONS_READ,
    API_SETTINGS_MIGRATE,
    API_SETTINGS_PROVIDER_WRITE,
    API_SETTINGS_READ,
    API_SETTINGS_WRITE,
    API_STATUS_READ,
)
from inspiration_one_backend.domain.ui_layout import is_supported_ui_layout_scheme, resolve_ui_layout_scheme
from inspiration_one_backend.infrastructure.db.models import (
    AppSetting,
    AuthUser,
    GenerationConfig,
    GenerationConfigDailyStat,
    GenerationConfigResourceGroup,
    GenerationConfigState,
    GenerationConfigTestResult,
    GenerationResourceGroup,
    ProviderProfile,
    ResourceLibraryAsset,
    UserGenerationResourceGroupGrant,
    UserUiPreference,
)
from inspiration_one_backend.infrastructure.db.models import (
    CanvasTemplate as DbCanvasTemplate,
)
from inspiration_one_backend.infrastructure.db.models import (
    CanvasTemplateCategory as DbCanvasTemplateCategory,
)
from inspiration_one_backend.infrastructure.provider_config import (
    IMAGE_PROVIDER_KINDS,
    TEXT_PROVIDER_KINDS,
    TEXT_SUPPORTS_IMAGE_UNDERSTANDING_KEY,
    UNSET_PROVIDER_FIELD,
    ResolvedImageProviderConfig,
    ResolvedTextProviderConfig,
    add_generation_config,
    add_generation_resource_group,
    archive_generation_config,
    archive_generation_resource_group,
    archive_provider_profile,
    capability_for_provider_kind,
    create_provider_profile,
    ensure_provider_config_bootstrapped,
    generation_config_effective_enabled,
    generation_config_resource_group_ids,
    get_provider_capabilities,
    is_real_image_provider_kind,
    list_generation_configs,
    list_generation_configs_filtered,
    list_generation_resource_groups,
    list_provider_profiles,
    resolve_image_provider_config_from_draft,
    resolve_text_provider_config_from_draft,
    unfreeze_generation_config,
    update_generation_config,
    update_generation_resource_group,
    update_provider_profile,
)
from inspiration_one_backend.infrastructure.provider_models import (
    ProviderModelDiscoveryError,
    ProviderModelDiscoveryUnsupportedError,
    list_provider_models,
)
from inspiration_one_backend.infrastructure.storage import LocalStorage
from inspiration_one_backend.infrastructure.text.factory import get_text_provider_from_config
from inspiration_one_backend.infrastructure.text.prompt_context import (
    build_brief_system_instructions,
    build_brief_user_content,
    build_copy_reference_text,
    build_copy_system_instructions,
    build_copy_user_content,
)
from inspiration_one_backend.presentation.deps import (
    get_current_user,
    get_session,
    require_any_api_permission,
    require_api_permission,
)
from inspiration_one_backend.presentation.routes.settings_constants import (
    SETTINGS_EXPORT_COMPATIBILITY,
    SETTINGS_EXPORT_SCHEMA_VERSION,
)
from inspiration_one_backend.presentation.routes.settings_export import _build_settings_export_document
from inspiration_one_backend.presentation.routes.settings_import_normalizers import (
    _normalize_import_canvas_template_categories,
    _normalize_import_canvas_templates,
    _normalize_import_generation_configs,
    _normalize_import_generation_resource_groups,
    _normalize_import_profiles,
)
from inspiration_one_backend.presentation.routes.settings_serializers import (
    _serialize_dt,
    _serialize_generation_config_daily_stat,
    _serialize_generation_config_state,
    _serialize_generation_config_test_result,
    _serialize_generation_resource_group,
    _serialize_provider_profile,
    _serialize_user_ui_preferences,
)
from inspiration_one_backend.presentation.schemas.image_sessions import serialize_image_session_round
from inspiration_one_backend.presentation.schemas.settings import (
    ConfigItemResponse,
    ConfigOptionResponse,
    ConfigResponse,
    ConfigUpdateRequest,
    GenerationConfigCreateRequest,
    GenerationConfigOptionResponse,
    GenerationConfigResponse,
    GenerationConfigStatAggregateResponse,
    GenerationConfigStatusConfigResponse,
    GenerationConfigStatusSummaryResponse,
    GenerationConfigUpdateRequest,
    GenerationResourceGroupCreateRequest,
    GenerationResourceGroupResponse,
    GenerationResourceGroupUpdateRequest,
    ImageGenerationConfigTestLifecycleResponse,
    ImageGenerationConfigTestRequest,
    ImageGenerationConfigTestResponse,
    LoginPageSelectionUpdateRequest,
    LoginPageTemplateConfigUpdateRequest,
    ProviderConfigResponse,
    ProviderModelListResponse,
    ProviderModelResponse,
    ProviderProfileCreateRequest,
    ProviderProfileResponse,
    ProviderProfileUpdateRequest,
    RuntimeConfigResponse,
    SettingsExportDocument,
    SettingsImportCommitResponse,
    SettingsImportPreviewResponse,
    TextGenerationConfigJsonResponseFormatTestRequest,
    TextGenerationConfigJsonResponseFormatTestResponse,
    TextGenerationConfigTestRequest,
    TextGenerationConfigTestResponse,
    UserUiPreferencesResponse,
    UserUiPreferencesUpdateRequest,
)

router = APIRouter(
    prefix="/api/settings",
    tags=["settings"],
)
logger = logging.getLogger(__name__)
READ_SETTINGS_PERMISSION = Depends(require_api_permission(API_SETTINGS_READ))
WRITE_SETTINGS_PERMISSION = Depends(require_api_permission(API_SETTINGS_WRITE))
WRITE_PROVIDER_SETTINGS_PERMISSION = Depends(require_api_permission(API_SETTINGS_PROVIDER_WRITE))
MIGRATE_SETTINGS_PERMISSION = Depends(require_api_permission(API_SETTINGS_MIGRATE))
READ_STATUS_PERMISSION = Depends(require_api_permission(API_STATUS_READ))
READ_GENERATION_RUNTIME_PERMISSION = Depends(
    require_any_api_permission(API_INSPIRATIONS_READ, API_IMAGE_CHAT_READ, API_SETTINGS_READ)
)
AUTH_SESSION_TTL_CONFIG_KEY = "auth_session_ttl_minutes"
GLOBAL_GENERATION_CONFIG_CATEGORY_PREFIX = "全局生成配置 / "
LEGACY_GENERATION_QUEUE_CATEGORY = "生成队列"
RUNTIME_CONFIG_SECTION_IDS = {
    "prompts",
    "upload",
    "queue",
    "layoutAppearance",
    "loginPage",
    "security",
}


@dataclass(frozen=True, slots=True)
class _SettingsImportBundle:
    normalized_runtime_config: dict[str, str]
    provider_profiles: list[dict[str, Any]]
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
    rows = session.scalars(
        select(AppSetting).where(AppSetting.key.in_(RUNTIME_CONFIG_KEYS | LEGACY_RUNTIME_CONFIG_KEYS))
    ).all()
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


def _apply_runtime_config_update(
    session: Session,
    *,
    values: Mapping[str, Any] | None = None,
    reset_keys: set[str] | None = None,
) -> ConfigResponse:
    reset_keys = reset_keys or set()
    raw_values = values or {}
    try:
        normalized_values = normalize_config_values(raw_values)
        current_values = _load_database_values(session)
        next_values = {key: row.value for key, row in current_values.items() if key not in reset_keys}
        next_values.update(normalized_values)
        _validate_runtime_settings(next_values)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    auth_session_policy_changed = (
        AUTH_SESSION_TTL_CONFIG_KEY in normalized_values or AUTH_SESSION_TTL_CONFIG_KEY in reset_keys
    )
    for key in reset_keys:
        existing = session.get(AppSetting, key)
        if existing is not None:
            session.delete(existing)
    for key, value in normalized_values.items():
        _upsert_app_setting(session, key=key, value=value)
    if auth_session_policy_changed:
        revoke_all_auth_sessions(session)
    session.commit()
    return _serialize_config(session)


def _login_page_template_config_key(template_id: str) -> str:
    config_key = LOGIN_PAGE_TEMPLATE_CONFIG_KEYS.get(template_id)
    if config_key is None:
        supported = ", ".join(LOGIN_PAGE_TEMPLATE_IDS)
        raise HTTPException(status_code=400, detail=f"登录页模板必须是以下之一: {supported}")
    return config_key


def _config_definition_matches_section(definition: Any, section: str) -> bool:
    category = definition.category
    if section == "prompts":
        return category == "提示词"
    if section == "upload":
        return category in {"海报与上传", "图片工具参数"}
    if section == "queue":
        return category == LEGACY_GENERATION_QUEUE_CATEGORY or category.startswith(
            GLOBAL_GENERATION_CONFIG_CATEGORY_PREFIX
        )
    if section == "layoutAppearance":
        return category == "界面与外观"
    if section == "loginPage":
        return category == "登录页"
    if section == "security":
        return category == "安全与运维"
    return False


def _serialize_config(session: Session, *, section: str | None = None) -> ConfigResponse:
    db_values = _load_database_values(session)
    settings = get_runtime_settings()
    items: list[ConfigItemResponse] = []
    definitions = (
        [definition for definition in CONFIG_DEFINITIONS if _config_definition_matches_section(definition, section)]
        if section is not None
        else CONFIG_DEFINITIONS
    )
    for definition in definitions:
        source = "database" if definition.key in db_values else "env_default"
        raw_value = getattr(settings, definition.key)
        effective_value = (
            list(parse_config_multi_select(definition.key, raw_value))
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


def _get_or_create_user_ui_preferences(session: Session, user_id: str, *, commit: bool) -> UserUiPreference:
    preferences = session.get(UserUiPreference, user_id)
    if preferences is not None:
        return preferences

    preferences = UserUiPreference(
        user_id=user_id,
        ui_layout_scheme=resolve_ui_layout_scheme(get_runtime_settings().ui_layout_scheme),
    )
    session.add(preferences)
    if commit:
        session.commit()
        session.refresh(preferences)
    return preferences


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


def _latest_generation_config_test_results(
    session: Session,
    generation_configs: list[GenerationConfig],
) -> dict[str, GenerationConfigTestResult]:
    generation_config_ids = [generation_config.id for generation_config in generation_configs]
    if not generation_config_ids:
        return {}
    rows = session.scalars(
        select(GenerationConfigTestResult)
        .where(GenerationConfigTestResult.generation_config_id.in_(generation_config_ids))
        .order_by(
            GenerationConfigTestResult.generation_config_id,
            GenerationConfigTestResult.tested_at.desc(),
            GenerationConfigTestResult.created_at.desc(),
        )
    ).all()
    latest: dict[str, GenerationConfigTestResult] = {}
    for row in rows:
        latest.setdefault(row.generation_config_id, row)
    return latest


def _persist_generation_config_test_result(
    session: Session,
    *,
    generation_config_id: str | None,
    test_type: str,
    result_status: str,
    provider_kind: str | None = None,
    duration_ms: int | None = None,
    model_summary: dict[str, Any] | None = None,
    message: str | None = None,
    error_detail: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    if not generation_config_id:
        return
    generation_config = session.get(GenerationConfig, generation_config_id)
    if generation_config is None or generation_config.archived_at is not None:
        return
    session.add(
        GenerationConfigTestResult(
            generation_config_id=generation_config.id,
            test_type=test_type,
            status=result_status,
            tested_at=now_utc(),
            duration_ms=duration_ms,
            provider_kind=provider_kind,
            model_summary_json=model_summary or {},
            message=message,
            error_detail=error_detail,
            metadata_json=metadata or {},
        )
    )
    session.commit()


def _try_persist_generation_config_test_failure(
    session: Session,
    *,
    generation_config_id: str | None,
    test_type: str,
    provider_kind: str | None = None,
    error_detail: str,
) -> None:
    try:
        _persist_generation_config_test_result(
            session,
            generation_config_id=generation_config_id,
            test_type=test_type,
            result_status="failed",
            provider_kind=provider_kind,
            error_detail=error_detail,
        )
    except Exception:  # noqa: BLE001
        session.rollback()
        logger.exception("生成配置测试失败记录持久化失败")


def _filter_generation_config_stats_by_ids(
    stats: dict[str, GenerationConfigDailyStat],
    *,
    generation_config_ids: set[str] | None,
) -> dict[str, GenerationConfigDailyStat]:
    if generation_config_ids is None:
        return stats
    return {config_id: stat for config_id, stat in stats.items() if config_id in generation_config_ids}


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


def _filter_generation_config_stat_aggregates_by_ids(
    stats: dict[str, _GenerationConfigStatAggregate],
    *,
    generation_config_ids: set[str] | None,
) -> dict[str, _GenerationConfigStatAggregate]:
    if generation_config_ids is None:
        return stats
    return {config_id: stat for config_id, stat in stats.items() if config_id in generation_config_ids}


def _available_generation_resource_group_ids_for_user(
    session: Session,
    *,
    user: AuthUser | None,
) -> set[str] | None:
    if user is None:
        return None
    return {group.id for group in list_available_generation_resource_groups_for_user(session, user=user)}


def _visible_generation_config_resource_group_ids(
    generation_config: GenerationConfig,
    *,
    available_resource_group_ids: set[str] | None,
) -> list[str]:
    resource_group_ids = generation_config_resource_group_ids(generation_config)
    if available_resource_group_ids is None:
        return resource_group_ids
    return [group_id for group_id in resource_group_ids if group_id in available_resource_group_ids]


def _filter_generation_configs_by_available_groups(
    generation_configs: list[GenerationConfig],
    *,
    available_resource_group_ids: set[str] | None,
) -> list[GenerationConfig]:
    if available_resource_group_ids is None:
        return generation_configs
    return [
        generation_config
        for generation_config in generation_configs
        if _visible_generation_config_resource_group_ids(
            generation_config,
            available_resource_group_ids=available_resource_group_ids,
        )
    ]


def _generation_resource_group_image_max_dimensions(
    generation_configs: list[GenerationConfig],
    *,
    available_resource_group_ids: set[str] | None = None,
) -> dict[str, int | None]:
    max_dimensions: dict[str, int | None] = {}
    for generation_config in generation_configs:
        if generation_config.purpose != "image" or not generation_config_effective_enabled(generation_config):
            continue
        provider_max_dimension = get_provider_capabilities(generation_config.provider_profile).image_max_dimension
        for group_id in _visible_generation_config_resource_group_ids(
            generation_config,
            available_resource_group_ids=available_resource_group_ids,
        ):
            if group_id not in max_dimensions:
                max_dimensions[group_id] = provider_max_dimension
                continue
            current_max = max_dimensions[group_id]
            if provider_max_dimension is None:
                max_dimensions[group_id] = None
                continue
            if current_max is None:
                continue
            max_dimensions[group_id] = max(current_max, provider_max_dimension)
    return max_dimensions


def _active_generation_config_is_frozen(generation_config: GenerationConfig, *, now: datetime) -> bool:
    frozen_until = generation_config.state.frozen_until if generation_config.state is not None else None
    if frozen_until is None:
        return False
    if frozen_until.tzinfo is None:
        frozen_until = frozen_until.replace(tzinfo=now.tzinfo)
    return frozen_until > now


def _serialize_generation_config(
    generation_config: GenerationConfig,
    *,
    today_stats: dict[str, GenerationConfigDailyStat],
    latest_test_results: dict[str, GenerationConfigTestResult] | None = None,
) -> GenerationConfigResponse:
    from inspiration_one_backend.infrastructure.provider_config import get_provider_capabilities

    resource_group_ids = generation_config_resource_group_ids(generation_config)
    caps = get_provider_capabilities(generation_config.provider_profile)
    return GenerationConfigResponse(
        id=generation_config.id,
        resource_group_id=resource_group_ids[0] if resource_group_ids else None,
        resource_group_ids=resource_group_ids,
        purpose=generation_config.purpose,
        name=generation_config.name,
        provider_kind=generation_config.provider_kind,
        provider_profile_id=generation_config.provider_profile_id,
        model_settings=dict(generation_config.model_settings_json or {}),
        config=dict(generation_config.config_json or {}),
        priority=generation_config.priority,
        max_concurrency=generation_config.max_concurrency,
        enabled=generation_config.enabled,
        effective_enabled=generation_config_effective_enabled(generation_config),
        availability_window_minutes=generation_config.availability_window_minutes,
        failure_threshold=generation_config.failure_threshold,
        cooldown_minutes=generation_config.cooldown_minutes,
        archived_at=_serialize_dt(generation_config.archived_at),
        created_at=generation_config.created_at.isoformat(),
        updated_at=generation_config.updated_at.isoformat(),
        state=_serialize_generation_config_state(generation_config.state),
        today_stat=_serialize_generation_config_daily_stat(today_stats.get(generation_config.id)),
        latest_test_result=_serialize_generation_config_test_result(
            (latest_test_results or {}).get(generation_config.id)
        ),
        provider_max_dimension=caps.image_max_dimension,
    )


def _serialize_generation_config_status_config(
    generation_config: GenerationConfig,
    *,
    today_stats: dict[str, GenerationConfigDailyStat],
    range_stats: dict[str, _GenerationConfigStatAggregate],
    available_resource_group_ids: set[str] | None,
) -> GenerationConfigStatusConfigResponse:
    resource_group_ids = _visible_generation_config_resource_group_ids(
        generation_config,
        available_resource_group_ids=available_resource_group_ids,
    )
    return GenerationConfigStatusConfigResponse(
        id=generation_config.id,
        resource_group_id=resource_group_ids[0] if resource_group_ids else None,
        resource_group_ids=resource_group_ids,
        purpose=generation_config.purpose,
        name=generation_config.name,
        provider_kind=generation_config.provider_kind,
        priority=generation_config.priority,
        max_concurrency=generation_config.max_concurrency,
        enabled=generation_config.enabled,
        effective_enabled=generation_config_effective_enabled(generation_config),
        state=_serialize_generation_config_state(generation_config.state),
        today_stat=_serialize_generation_config_daily_stat(today_stats.get(generation_config.id)),
        range_stat=_serialize_generation_config_stat_aggregate(
            range_stats.get(generation_config.id, _GenerationConfigStatAggregate())
        ),
    )


def _safe_text_generation_test_error_detail(exc: ValueError) -> str:
    if isinstance(exc, ValidationError):
        details = []
        for error in exc.errors(include_input=False):
            loc = ".".join(str(part) for part in error.get("loc", ())) or "-"
            message = str(error.get("msg") or error.get("type") or "校验失败")
            details.append(f"{loc}: {message}")
        return "; ".join(details)[:500] or exc.__class__.__name__

    detail = str(exc).strip() or exc.__class__.__name__
    if "未返回 JSON 对象" in detail:
        return detail.split("：", 1)[0].split(":", 1)[0]
    return detail[:500]


def _load_text_generation_test_reference_images(
    session: Session,
    *,
    actor_user_id: str,
    reference_asset_ids: list[str],
) -> list[ReferenceImageInput]:
    ordered_ids: list[str] = []
    for asset_id in reference_asset_ids:
        normalized = str(asset_id or "").strip()
        if normalized and normalized not in ordered_ids:
            ordered_ids.append(normalized)
    if not ordered_ids:
        return []

    assets = session.scalars(
        select(ResourceLibraryAsset).where(
            ResourceLibraryAsset.id.in_(ordered_ids),
            ResourceLibraryAsset.owner_user_id == actor_user_id,
            ResourceLibraryAsset.kind == ResourceLibraryAssetKind.IMAGE,
            ResourceLibraryAsset.archived_at.is_(None),
        )
    ).all()
    asset_by_id = {asset.id: asset for asset in assets}
    storage = LocalStorage()
    references: list[ReferenceImageInput] = []
    for asset_id in ordered_ids:
        asset = asset_by_id.get(asset_id)
        if asset is None:
            raise ValueError("参考图不存在")
        try:
            ensure_resource_usable(asset)
        except BusinessValidationError as exc:
            raise ValueError(str(exc)) from exc
        references.append(
            ReferenceImageInput(
                bytes_data=storage.read_bytes(
                    storage.object_key_for(asset),
                    max_bytes=get_runtime_settings().upload_max_image_bytes,
                ),
                mime_type=asset.mime_type,
                filename=asset.original_filename,
                role="参考图",
                label=asset.original_filename,
                source_key=storage.object_key_for(asset),
            )
        )
    return references


def _sync_text_generation_config_image_understanding_support(
    session: Session,
    *,
    generation_config_id: str | None,
    enabled: bool,
) -> None:
    if not generation_config_id:
        return
    generation_config = session.get(GenerationConfig, generation_config_id)
    if generation_config is None or generation_config.archived_at is not None or generation_config.purpose != "text":
        return
    next_config = dict(generation_config.config_json or {})
    next_config[TEXT_SUPPORTS_IMAGE_UNDERSTANDING_KEY] = enabled
    update_generation_config(session, generation_config.id, config=next_config, commit=False)


def _resolve_text_generation_config_for_test(
    session: Session,
    *,
    generation_config_id: str | None,
    generation_config: GenerationConfigCreateRequest | None,
) -> ResolvedTextProviderConfig:
    if generation_config is not None:
        return resolve_text_provider_config_from_draft(
            session,
            name=generation_config.name,
            provider_kind=generation_config.provider_kind,
            provider_profile_id=generation_config.provider_profile_id,
            model_settings=generation_config.model_settings,
            config=generation_config.config,
        )
    if generation_config_id is None:
        raise ValueError("请提供文案生成配置")
    db_generation_config = session.scalar(
        select(GenerationConfig)
        .options(selectinload(GenerationConfig.provider_profile))
        .where(
            GenerationConfig.id == generation_config_id,
            GenerationConfig.purpose == "text",
            GenerationConfig.archived_at.is_(None),
        )
    )
    if db_generation_config is None:
        raise ValueError("生成配置不存在")
    return resolve_text_provider_config_from_draft(
        session,
        name=db_generation_config.name,
        provider_kind=db_generation_config.provider_kind,
        provider_profile_id=db_generation_config.provider_profile_id,
        model_settings=dict(db_generation_config.model_settings_json or {}),
        config=dict(db_generation_config.config_json or {}),
    )


def _resolve_image_generation_config_for_test(
    session: Session,
    *,
    generation_config_id: str | None,
    generation_config: GenerationConfigCreateRequest | None,
) -> ResolvedImageProviderConfig:
    if generation_config is not None:
        return resolve_image_provider_config_from_draft(
            session,
            name=generation_config.name,
            provider_kind=generation_config.provider_kind,
            provider_profile_id=generation_config.provider_profile_id,
            model_settings=generation_config.model_settings,
            config=generation_config.config,
            generation_config_id=generation_config_id,
        )
    if generation_config_id is None:
        raise ValueError("请提供图片生成配置")
    db_generation_config = session.scalar(
        select(GenerationConfig)
        .options(selectinload(GenerationConfig.provider_profile))
        .where(
            GenerationConfig.id == generation_config_id,
            GenerationConfig.purpose == "image",
            GenerationConfig.archived_at.is_(None),
        )
    )
    if db_generation_config is None:
        raise ValueError("生成配置不存在")
    return resolve_image_provider_config_from_draft(
        session,
        name=db_generation_config.name,
        provider_kind=db_generation_config.provider_kind,
        provider_profile_id=db_generation_config.provider_profile_id,
        model_settings=dict(db_generation_config.model_settings_json or {}),
        config=dict(db_generation_config.config_json or {}),
        generation_config_id=db_generation_config.id,
    )


def _serialize_generation_config_option(generation_config: GenerationConfig) -> GenerationConfigOptionResponse:
    state = generation_config.state
    resource_group_ids = generation_config_resource_group_ids(generation_config)
    provider_max_dimension = get_provider_capabilities(generation_config.provider_profile).image_max_dimension
    return GenerationConfigOptionResponse(
        id=generation_config.id,
        resource_group_id=resource_group_ids[0] if resource_group_ids else None,
        resource_group_ids=resource_group_ids,
        purpose=generation_config.purpose,
        name=generation_config.name,
        provider_kind=generation_config.provider_kind,
        enabled=generation_config.enabled,
        effective_enabled=generation_config_effective_enabled(generation_config),
        priority=generation_config.priority,
        frozen_until=_serialize_dt(state.frozen_until) if state else None,
        provider_max_dimension=provider_max_dimension,
    )


def _serialize_generation_config_status_summary(
    session: Session,
    *,
    start_date: date | None = None,
    end_date: date | None = None,
    include_configs: bool = True,
    user: AuthUser | None = None,
) -> GenerationConfigStatusSummaryResponse:
    now = now_utc()
    today = now.date()
    range_start = start_date or end_date or today
    range_end = end_date or range_start
    available_resource_group_ids = _available_generation_resource_group_ids_for_user(session, user=user)
    generation_configs = _filter_generation_configs_by_available_groups(
        list_generation_configs(session),
        available_resource_group_ids=available_resource_group_ids,
    )
    generation_config_ids = {generation_config.id for generation_config in generation_configs}
    config_purposes = {generation_config.id: generation_config.purpose for generation_config in generation_configs}
    today_stats = _filter_generation_config_stats_by_ids(
        _today_generation_config_stats(session),
        generation_config_ids=generation_config_ids,
    )
    range_stats = _filter_generation_config_stat_aggregates_by_ids(
        _generation_config_stat_aggregates(session, start_date=range_start, end_date=range_end),
        generation_config_ids=generation_config_ids,
    )
    return GenerationConfigStatusSummaryResponse(
        total_count=len(generation_configs),
        enabled_count=sum(1 for generation_config in generation_configs if generation_config.enabled),
        frozen_count=sum(
            1
            for generation_config in generation_configs
            if _active_generation_config_is_frozen(generation_config, now=now)
        ),
        running_count=sum(
            generation_config.state.current_concurrency
            for generation_config in generation_configs
            if generation_config.state is not None
        ),
        start_date=range_start.isoformat(),
        end_date=range_end.isoformat(),
        range_attempt_count=sum(stat.attempt_count for stat in range_stats.values()),
        range_success_count=sum(stat.success_count for stat in range_stats.values()),
        range_failure_count=sum(stat.failure_count for stat in range_stats.values()),
        range_text_attempt_count=sum(
            stat.attempt_count for config_id, stat in range_stats.items() if config_purposes.get(config_id) == "text"
        ),
        range_image_attempt_count=sum(
            stat.attempt_count for config_id, stat in range_stats.items() if config_purposes.get(config_id) == "image"
        ),
        today_attempt_count=sum(stat.attempt_count for stat in today_stats.values()),
        today_success_count=sum(stat.success_count for stat in today_stats.values()),
        today_failure_count=sum(stat.failure_count for stat in today_stats.values()),
        today_text_attempt_count=sum(
            stat.attempt_count for config_id, stat in today_stats.items() if config_purposes.get(config_id) == "text"
        ),
        today_image_attempt_count=sum(
            stat.attempt_count for config_id, stat in today_stats.items() if config_purposes.get(config_id) == "image"
        ),
        configs=[
            _serialize_generation_config_status_config(
                generation_config,
                today_stats=today_stats,
                range_stats=range_stats,
                available_resource_group_ids=available_resource_group_ids,
            )
            for generation_config in generation_configs
        ]
        if include_configs
        else [],
    )


def _serialize_provider_config(session: Session) -> ProviderConfigResponse:
    generation_configs = list_generation_configs(session)
    today_stats = _today_generation_config_stats(session)
    latest_test_results = _latest_generation_config_test_results(session, generation_configs)
    group_max_dimensions = _generation_resource_group_image_max_dimensions(generation_configs)
    provider_usage_by_profile = _provider_profile_usage_by_profile_id(session)
    return ProviderConfigResponse(
        profiles=[
            _serialize_provider_profile(
                profile,
                used_by_text_generation=provider_usage_by_profile.get(profile.id, _ProviderProfileUsage()).text,
                used_by_image_generation=provider_usage_by_profile.get(profile.id, _ProviderProfileUsage()).image,
            )
            for profile in list_provider_profiles(session)
        ],
        generation_resource_groups=[
            _serialize_generation_resource_group(
                group,
                image_max_dimension=group_max_dimensions.get(group.id),
            )
            for group in list_generation_resource_groups(session)
        ],
        generation_configs=[
            _serialize_generation_config(
                generation_config,
                today_stats=today_stats,
                latest_test_results=latest_test_results,
            )
            for generation_config in generation_configs
        ],
        status_summary=_serialize_generation_config_status_summary(session, include_configs=False),
    )


@dataclass(slots=True)
class _ProviderProfileUsage:
    text: bool = False
    image: bool = False


def _provider_profile_usage_by_profile_id(session: Session) -> dict[str, _ProviderProfileUsage]:
    rows = session.execute(
        select(GenerationConfig.provider_profile_id, GenerationConfig.purpose)
        .where(
            GenerationConfig.archived_at.is_(None),
            GenerationConfig.provider_profile_id.is_not(None),
        )
        .distinct()
    ).all()
    usage_by_profile_id: dict[str, _ProviderProfileUsage] = {}
    for profile_id, purpose in rows:
        if profile_id is None:
            continue
        usage = usage_by_profile_id.setdefault(profile_id, _ProviderProfileUsage())
        if purpose == "text":
            usage.text = True
        elif purpose == "image":
            usage.image = True
    return usage_by_profile_id


def _serialize_provider_profile_with_usage(session: Session, profile: ProviderProfile) -> ProviderProfileResponse:
    usage = _provider_profile_usage_by_profile_id(session).get(profile.id, _ProviderProfileUsage())
    return _serialize_provider_profile(
        profile,
        used_by_text_generation=usage.text,
        used_by_image_generation=usage.image,
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
    legacy_capacity = runtime_config.pop(LEGACY_GENERATION_MAX_CONCURRENT_TASKS_KEY, None)
    if legacy_capacity is not None:
        runtime_config.setdefault(TEXT_GENERATION_MAX_CONCURRENT_TASKS_KEY, legacy_capacity)
        runtime_config.setdefault(IMAGE_GENERATION_MAX_CONCURRENT_TASKS_KEY, legacy_capacity)
    runtime_config = migrate_legacy_login_page_config_values(runtime_config)
    unknown_keys = set(runtime_config) - RUNTIME_CONFIG_KEYS
    if unknown_keys:
        raise ValueError(f"未知配置项: {', '.join(sorted(unknown_keys))}")
    missing_keys = RUNTIME_CONFIG_KEYS - set(runtime_config)
    if missing_keys:
        raise ValueError(f"配置文件缺少配置项: {', '.join(sorted(missing_keys))}")
    normalized_values = normalize_config_values(runtime_config)
    _validate_runtime_settings(normalized_values)
    return normalized_values


def _build_settings_import_bundle(payload: Any) -> _SettingsImportBundle:
    document = _parse_settings_import_document(payload)
    normalized_runtime_config = _normalize_runtime_import_config(document)
    profiles = _normalize_import_profiles(document)
    generation_resource_groups = _normalize_import_generation_resource_groups(document)
    generation_configs = _normalize_import_generation_configs(document, profiles, generation_resource_groups)
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
        generation_resource_group_count=len(generation_resource_groups),
        generation_config_count=len(generation_configs),
        canvas_template_category_count=len(canvas_template_categories),
        canvas_template_count=len(canvas_templates),
        provider_profile_names=[profile["name"] for profile in profiles],
        includes_api_keys=any(bool(profile["api_key"]) for profile in profiles),
        provider_profiles_with_api_key_count=sum(1 for profile in profiles if profile["api_key"]),
        canvas_template_keys=[template["key"] for template in canvas_templates],
        canvas_template_category_names=[category["name"] for category in canvas_template_categories],
    )
    return _SettingsImportBundle(
        normalized_runtime_config=normalized_runtime_config,
        provider_profiles=profiles,
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
        if AUTH_SESSION_TTL_CONFIG_KEY in bundle.normalized_runtime_config:
            revoke_all_auth_sessions(session)

        session.execute(delete(GenerationConfigDailyStat))
        session.execute(delete(GenerationConfigState))
        session.execute(delete(GenerationConfigResourceGroup))
        session.execute(delete(GenerationConfig))
        session.execute(delete(UserGenerationResourceGroupGrant))
        session.execute(delete(GenerationResourceGroup))
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
                    blur_images_by_default=group["blur_images_by_default"],
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
                resource_group_ids=generation_config["resource_group_ids"],
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
def get_config_endpoint(
    section: str | None = Query(default=None),
    session: Session = Depends(get_session),
) -> ConfigResponse:
    normalized_section = str(section or "").strip() or None
    if normalized_section is not None and normalized_section not in RUNTIME_CONFIG_SECTION_IDS:
        raise HTTPException(status_code=400, detail="配置区块不支持")
    return _serialize_config(session, section=normalized_section)


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
)
def get_generation_config_status_endpoint(
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    session: Session = Depends(get_session),
    current_user: AuthUser = READ_STATUS_PERMISSION,
) -> GenerationConfigStatusSummaryResponse:
    ensure_provider_config_bootstrapped(session)
    range_start = start_date or end_date
    range_end = end_date or range_start
    if range_start is not None and range_end is not None and range_end < range_start:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="日期范围无效")
    return _serialize_generation_config_status_summary(
        session,
        start_date=range_start,
        end_date=range_end,
        user=current_user,
    )


@router.get(
    "/provider-profiles",
    response_model=list[ProviderProfileResponse],
    dependencies=[READ_SETTINGS_PERMISSION],
)
def list_provider_profiles_endpoint(
    session: Session = Depends(get_session),
) -> list[ProviderProfileResponse]:
    usage_by_profile_id = _provider_profile_usage_by_profile_id(session)
    return [
        _serialize_provider_profile(
            profile,
            used_by_text_generation=usage_by_profile_id.get(profile.id, _ProviderProfileUsage()).text,
            used_by_image_generation=usage_by_profile_id.get(profile.id, _ProviderProfileUsage()).image,
        )
        for profile in list_provider_profiles(session)
    ]


@router.get(
    "/generation-configs",
    response_model=list[GenerationConfigResponse],
    dependencies=[READ_SETTINGS_PERMISSION],
)
def list_generation_configs_endpoint(
    purpose: str | None = Query(default=None),
    resource_group_id: str | None = Query(default=None),
    unbound_only: bool = Query(default=False),
    session: Session = Depends(get_session),
) -> list[GenerationConfigResponse]:
    ensure_provider_config_bootstrapped(session)
    normalized_purpose = str(purpose or "").strip() or None
    if normalized_purpose is not None and normalized_purpose not in {"text", "image"}:
        raise HTTPException(status_code=400, detail="生成配置用途不支持")
    if resource_group_id and unbound_only:
        raise HTTPException(status_code=400, detail="不能同时查询分组和未绑定配置")
    generation_configs = list_generation_configs_filtered(
        session,
        purpose=normalized_purpose,
        resource_group_id=resource_group_id,
        unbound_only=unbound_only,
    )
    today_stats = _today_generation_config_stats(session)
    latest_test_results = _latest_generation_config_test_results(session, generation_configs)
    return [
        _serialize_generation_config(
            generation_config,
            today_stats=today_stats,
            latest_test_results=latest_test_results,
        )
        for generation_config in generation_configs
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
    "/ui-preferences",
    response_model=UserUiPreferencesResponse,
    dependencies=[READ_GENERATION_RUNTIME_PERMISSION],
)
def get_user_ui_preferences_endpoint(
    current_user: AuthUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> UserUiPreferencesResponse:
    preferences = _get_or_create_user_ui_preferences(session, current_user.id, commit=True)
    return _serialize_user_ui_preferences(preferences)


@router.patch(
    "/ui-preferences",
    response_model=UserUiPreferencesResponse,
    dependencies=[READ_GENERATION_RUNTIME_PERMISSION],
)
def update_user_ui_preferences_endpoint(
    payload: UserUiPreferencesUpdateRequest,
    current_user: AuthUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> UserUiPreferencesResponse:
    preferences = _get_or_create_user_ui_preferences(session, current_user.id, commit=False)
    if payload.ui_layout_scheme is not None:
        if not is_supported_ui_layout_scheme(payload.ui_layout_scheme):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不支持的 UI 布局方案")
        preferences.ui_layout_scheme = payload.ui_layout_scheme
    if payload.mask_sensitive_images_in_inspirations is not None:
        preferences.mask_sensitive_images_in_inspirations = payload.mask_sensitive_images_in_inspirations
    if payload.mask_sensitive_images_in_image_chat is not None:
        preferences.mask_sensitive_images_in_image_chat = payload.mask_sensitive_images_in_image_chat
    session.commit()
    session.refresh(preferences)
    return _serialize_user_ui_preferences(preferences)


@router.get(
    "/generation-resource-groups",
    response_model=list[GenerationResourceGroupResponse],
    dependencies=[READ_SETTINGS_PERMISSION],
)
def list_generation_resource_groups_endpoint(
    include_image_max_dimension: bool = Query(default=True),
    session: Session = Depends(get_session),
) -> list[GenerationResourceGroupResponse]:
    ensure_provider_config_bootstrapped(session)
    group_max_dimensions: dict[str, int | None] = {}
    if include_image_max_dimension:
        generation_configs = list_generation_configs(session)
        group_max_dimensions = _generation_resource_group_image_max_dimensions(generation_configs)
    return [
        _serialize_generation_resource_group(group, image_max_dimension=group_max_dimensions.get(group.id))
        for group in list_generation_resource_groups(session)
    ]


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
            blur_images_by_default=payload.blur_images_by_default,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _serialize_generation_resource_group(group, image_max_dimension=None)


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
            blur_images_by_default=payload.blur_images_by_default,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    generation_configs = list_generation_configs(session)
    group_max_dimensions = _generation_resource_group_image_max_dimensions(generation_configs)
    return _serialize_generation_resource_group(group, image_max_dimension=group_max_dimensions.get(group.id))


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
    generation_configs = list_generation_configs(session)
    group_max_dimensions = _generation_resource_group_image_max_dimensions(generation_configs)
    return _serialize_generation_resource_group(group, image_max_dimension=group_max_dimensions.get(group.id))


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
    available_resource_group_ids = {group.id for group in groups}
    generation_configs = _filter_generation_configs_by_available_groups(
        list_generation_configs(session),
        available_resource_group_ids=available_resource_group_ids,
    )
    group_max_dimensions = _generation_resource_group_image_max_dimensions(
        generation_configs,
        available_resource_group_ids=available_resource_group_ids,
    )
    return [
        _serialize_generation_resource_group(group, image_max_dimension=group_max_dimensions.get(group.id))
        for group in groups
    ]


@router.post(
    "/generation-configs/test-text",
    response_model=TextGenerationConfigTestResponse,
    dependencies=[WRITE_PROVIDER_SETTINGS_PERMISSION],
)
def test_text_generation_config_endpoint(
    payload: TextGenerationConfigTestRequest,
    current_user: AuthUser = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> TextGenerationConfigTestResponse:
    try:
        ensure_provider_config_bootstrapped(session)
        resolved_config = _resolve_text_generation_config_for_test(
            session,
            generation_config_id=payload.generation_config_id,
            generation_config=payload.generation_config,
        )
        reference_images = _load_text_generation_test_reference_images(
            session,
            actor_user_id=current_user.id,
            reference_asset_ids=payload.reference_asset_ids,
        )
        text_provider = get_text_provider_from_config(resolved_config)
        inspiration_input = InspirationInput(
            name=payload.inspiration.name,
            category=payload.inspiration.category,
            price=payload.inspiration.price,
            source_note=payload.inspiration.source_note,
            source_image=None,
        )
        brief_start = perf_counter()
        brief, brief_model = text_provider.generate_brief(inspiration_input)
        copy_config = CopyNodeConfigV2(
            instruction=payload.copy_request.instruction,
            purpose=payload.copy_request.purpose,
            channel=payload.copy_request.channel,
            tone=payload.copy_request.tone,
            output_mode=payload.copy_request.output_mode,
            requested_slots=payload.copy_request.requested_slots,
        )
        runtime_settings = get_runtime_settings()
        reference_text = build_copy_reference_text(reference_images)
        request_context = {
            "brief": {
                "system_instructions": build_brief_system_instructions(
                    runtime_settings.prompt_brief_system,
                    resolved_config.structured_output,
                ),
                "user_content": build_brief_user_content(inspiration_input),
            },
            "copy": {
                "system_instructions": build_copy_system_instructions(
                    runtime_settings.prompt_copy_system,
                    resolved_config.structured_output,
                ),
                "user_content": build_copy_user_content(inspiration_input, brief, copy_config, reference_images),
            },
            "reference_text": reference_text,
        }
        copy, copy_model = text_provider.generate_copy(
            inspiration_input,
            brief,
            copy_config,
            reference_images=reference_images,
        )
        duration_ms = int((perf_counter() - brief_start) * 1000)
        if reference_images:
            _sync_text_generation_config_image_understanding_support(
                session,
                generation_config_id=payload.generation_config_id,
                enabled=True,
            )
    except ValueError as exc:
        error_detail = _safe_text_generation_test_error_detail(exc)
        if payload.reference_asset_ids:
            _sync_text_generation_config_image_understanding_support(
                session,
                generation_config_id=payload.generation_config_id,
                enabled=False,
            )
        logger.info(
            "文案生成配置测试校验失败: generation_config_id=%s provider_kind=%s detail=%s",
            payload.generation_config_id or "-",
            resolved_config.provider_kind if "resolved_config" in locals() else "-",
            error_detail,
        )
        _try_persist_generation_config_test_failure(
            session,
            generation_config_id=payload.generation_config_id,
            test_type="text",
            provider_kind=resolved_config.provider_kind if "resolved_config" in locals() else None,
            error_detail=error_detail,
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("文案生成配置测试失败")
        if payload.reference_asset_ids:
            _sync_text_generation_config_image_understanding_support(
                session,
                generation_config_id=payload.generation_config_id,
                enabled=False,
            )
        _try_persist_generation_config_test_failure(
            session,
            generation_config_id=payload.generation_config_id,
            test_type="text",
            provider_kind=resolved_config.provider_kind if "resolved_config" in locals() else None,
            error_detail="文案生成配置测试失败，请稍后重试",
        )
        raise HTTPException(status_code=502, detail="文案生成配置测试失败，请稍后重试") from exc
    _persist_generation_config_test_result(
        session,
        generation_config_id=payload.generation_config_id,
        test_type="text",
        result_status="success",
        provider_kind=resolved_config.provider_kind,
        duration_ms=duration_ms,
        model_summary={"brief_model": brief_model, "copy_model": copy_model},
    )
    return TextGenerationConfigTestResponse(
        generation_config_id=payload.generation_config_id,
        provider_kind=resolved_config.provider_kind,
        brief_model=brief_model,
        copy_model=copy_model,
        brief=brief.model_dump(mode="json"),
        copy_result=copy.model_dump(mode="json"),
        request_context=request_context,
        duration_ms=duration_ms,
    )


@router.post(
    "/generation-configs/test-json-response-format",
    response_model=TextGenerationConfigJsonResponseFormatTestResponse,
    dependencies=[WRITE_PROVIDER_SETTINGS_PERMISSION],
)
def test_text_generation_config_json_response_format_endpoint(
    payload: TextGenerationConfigJsonResponseFormatTestRequest,
    session: Session = Depends(get_session),
) -> TextGenerationConfigJsonResponseFormatTestResponse:
    try:
        ensure_provider_config_bootstrapped(session)
        resolved_config = _resolve_text_generation_config_for_test(
            session,
            generation_config_id=payload.generation_config_id,
            generation_config=payload.generation_config,
        )
        if resolved_config.provider_kind not in {"openai", "openai_chat_completions"}:
            raise ValueError("文案结构化输出仅支持 OpenAI Responses 或 Chat Completions 文案接口")
        if not resolved_config.structured_output.enabled:
            raise ValueError("请先启用文案结构化输出")
        text_provider = get_text_provider_from_config(resolved_config)
        test_method = getattr(text_provider, "test_structured_output", None)
        if not callable(test_method):
            raise ValueError("当前文案接口不支持文案结构化输出测试")
        start = perf_counter()
        parsed_json, model = test_method()
        duration_ms = int((perf_counter() - start) * 1000)
    except ValueError as exc:
        error_detail = _safe_text_generation_test_error_detail(exc)
        logger.info(
            "文案结构化输出测试校验失败: generation_config_id=%s provider_kind=%s detail=%s",
            payload.generation_config_id or "-",
            resolved_config.provider_kind if "resolved_config" in locals() else "-",
            error_detail,
        )
        _try_persist_generation_config_test_failure(
            session,
            generation_config_id=payload.generation_config_id,
            test_type="json_response_format",
            provider_kind=resolved_config.provider_kind if "resolved_config" in locals() else None,
            error_detail=error_detail,
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("文案结构化输出测试失败")
        _try_persist_generation_config_test_failure(
            session,
            generation_config_id=payload.generation_config_id,
            test_type="json_response_format",
            provider_kind=resolved_config.provider_kind if "resolved_config" in locals() else None,
            error_detail="文案结构化输出测试失败，请稍后重试",
        )
        raise HTTPException(status_code=502, detail="文案结构化输出测试失败，请稍后重试") from exc
    _persist_generation_config_test_result(
        session,
        generation_config_id=payload.generation_config_id,
        test_type="json_response_format",
        result_status="success",
        provider_kind=resolved_config.provider_kind,
        duration_ms=duration_ms,
        model_summary={"model": model},
    )
    return TextGenerationConfigJsonResponseFormatTestResponse(
        generation_config_id=payload.generation_config_id,
        provider_kind=resolved_config.provider_kind,
        model=model,
        parsed_json=parsed_json,
        duration_ms=duration_ms,
    )


@router.post(
    "/generation-configs/test-image",
    response_model=ImageGenerationConfigTestResponse,
)
def test_image_generation_config_endpoint(
    payload: ImageGenerationConfigTestRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_SETTINGS_PROVIDER_WRITE)),
) -> ImageGenerationConfigTestResponse:
    try:
        ensure_provider_config_bootstrapped(session)
        resolved_config = _resolve_image_generation_config_for_test(
            session,
            generation_config_id=payload.generation_config_id,
            generation_config=payload.generation_config,
        )
        result = run_image_generation_config_test(
            session,
            prompt=payload.prompt,
            size=payload.size,
            resource_group_id=payload.resource_group_id,
            provider_config=resolved_config,
            owner_user_id=current_user.id,
            actor_is_admin=current_user.is_admin,
        )
    except ValueError as exc:
        error_detail = _safe_text_generation_test_error_detail(exc)
        logger.info(
            "图片生成配置测试校验失败: generation_config_id=%s provider_kind=%s detail=%s",
            payload.generation_config_id or "-",
            resolved_config.provider_kind if "resolved_config" in locals() else "-",
            error_detail,
        )
        _try_persist_generation_config_test_failure(
            session,
            generation_config_id=payload.generation_config_id,
            test_type="image",
            provider_kind=resolved_config.provider_kind if "resolved_config" in locals() else None,
            error_detail=error_detail,
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("图片生成配置测试失败")
        failure = classify_image_generation_failure(
            exc,
            generic_message="图片生成配置测试失败，请检查供应商配置后重试",
        )
        _try_persist_generation_config_test_failure(
            session,
            generation_config_id=payload.generation_config_id,
            test_type="image",
            provider_kind=resolved_config.provider_kind if "resolved_config" in locals() else None,
            error_detail=failure.reason,
        )
        raise HTTPException(status_code=502, detail=failure.reason) from exc
    round_item = next(item for item in result.image_session.rounds if item.id == result.round_id)
    round_response = serialize_image_session_round(round_item)
    resolved_generation_config_id = resolved_config.generation_config_id or payload.generation_config_id
    _persist_generation_config_test_result(
        session,
        generation_config_id=resolved_generation_config_id,
        test_type="image",
        result_status="success",
        provider_kind=result.provider_kind,
        duration_ms=result.duration_ms,
        model_summary={"model_name": round_response.model_name, "provider_name": round_response.provider_name},
    )
    return ImageGenerationConfigTestResponse(
        generation_config_id=resolved_generation_config_id,
        provider_kind=result.provider_kind,
        model_name=round_response.model_name,
        provider_name=round_response.provider_name,
        duration_ms=result.duration_ms,
        image_session_id=result.image_session.id,
        is_temporary=result.image_session.is_temporary_test,
        round=round_response,
        generated_asset=round_response.generated_asset,
    )


@router.post(
    "/generation-configs/test-image/{image_session_id}/keep",
    response_model=ImageGenerationConfigTestLifecycleResponse,
)
def keep_image_generation_config_test_endpoint(
    image_session_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_SETTINGS_PROVIDER_WRITE)),
) -> ImageGenerationConfigTestLifecycleResponse:
    image_session = keep_image_generation_config_test_session(
        session,
        image_session_id=image_session_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return ImageGenerationConfigTestLifecycleResponse(
        image_session_id=image_session.id,
        is_temporary=image_session.is_temporary_test,
        abandoned=False,
    )


@router.post(
    "/generation-configs/test-image/{image_session_id}/abandon",
    response_model=ImageGenerationConfigTestLifecycleResponse,
)
def abandon_image_generation_config_test_endpoint(
    image_session_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_SETTINGS_PROVIDER_WRITE)),
) -> ImageGenerationConfigTestLifecycleResponse:
    abandon_image_generation_config_test_session(
        session,
        image_session_id=image_session_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return ImageGenerationConfigTestLifecycleResponse(
        image_session_id=image_session_id,
        is_temporary=True,
        abandoned=True,
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
        create_resource_group_ids = (
            payload.resource_group_ids if "resource_group_ids" in payload.model_fields_set else None
        )
        if "resource_group_ids" in payload.model_fields_set and create_resource_group_ids is None:
            create_resource_group_ids = []
        generation_config = add_generation_config(
            session,
            resource_group_id=payload.resource_group_id,
            resource_group_ids=create_resource_group_ids,
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
            resource_group_id=payload.resource_group_id if "resource_group_id" in fields_set else UNSET_PROVIDER_FIELD,
            resource_group_ids=(
                payload.resource_group_ids if "resource_group_ids" in fields_set else UNSET_PROVIDER_FIELD
            ),
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


@router.post(
    "/generation-configs/{generation_config_id}/unfreeze",
    response_model=GenerationConfigResponse,
    dependencies=[WRITE_PROVIDER_SETTINGS_PERMISSION],
)
def unfreeze_generation_config_endpoint(
    generation_config_id: str,
    session: Session = Depends(get_session),
) -> GenerationConfigResponse:
    try:
        ensure_provider_config_bootstrapped(session)
        generation_config = unfreeze_generation_config(session, generation_config_id, commit=False)
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
    return _serialize_provider_profile_with_usage(session, profile)


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
    return _serialize_provider_profile_with_usage(session, profile)


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
    return _serialize_provider_profile_with_usage(session, profile)


@router.get("/runtime", response_model=RuntimeConfigResponse, dependencies=[READ_GENERATION_RUNTIME_PERMISSION])
def get_runtime_config_endpoint() -> RuntimeConfigResponse:
    settings = get_runtime_settings()
    return RuntimeConfigResponse(
        ui_layout_scheme=resolve_ui_layout_scheme(settings.ui_layout_scheme),
        image_generation_max_dimension=settings.image_generation_max_dimension,
        image_session_max_base_images=settings.image_session_max_base_images,
        image_tool_allowed_fields=list(parse_image_tool_allowed_fields(settings.image_tool_allowed_fields)),
        text_generation_max_concurrent_tasks=settings.text_generation_max_concurrent_tasks,
        image_generation_max_concurrent_tasks=settings.image_generation_max_concurrent_tasks,
        generation_tail_splitter_max_items=settings.generation_tail_splitter_max_items,
        workflow_node_max_retry_count=settings.workflow_node_max_retry_count,
        workflow_node_retry_delay_ms=settings.workflow_node_retry_delay_ms,
        gallery_show_generation_resource_group=settings.gallery_show_generation_resource_group,
        gallery_tag_filter_max_selection=settings.gallery_tag_filter_max_selection,
        gallery_entry_tag_max_selection=settings.gallery_entry_tag_max_selection,
        gallery_tag_required_on_save=settings.gallery_tag_required_on_save,
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

    return _apply_runtime_config_update(session, values=payload.values, reset_keys=reset_keys)


@router.patch("/login-page-selection", response_model=ConfigResponse, dependencies=[WRITE_SETTINGS_PERMISSION])
def update_login_page_selection_endpoint(
    payload: LoginPageSelectionUpdateRequest,
    session: Session = Depends(get_session),
) -> ConfigResponse:
    return _apply_runtime_config_update(session, values={"login_page_mode": payload.value})


@router.post("/login-page-selection/reset", response_model=ConfigResponse, dependencies=[WRITE_SETTINGS_PERMISSION])
def reset_login_page_selection_endpoint(
    session: Session = Depends(get_session),
) -> ConfigResponse:
    return _apply_runtime_config_update(session, reset_keys={"login_page_mode"})


@router.patch(
    "/login-page-template-config/{template_id}",
    response_model=ConfigResponse,
    dependencies=[WRITE_SETTINGS_PERMISSION],
)
def update_login_page_template_config_endpoint(
    template_id: str,
    payload: LoginPageTemplateConfigUpdateRequest,
    session: Session = Depends(get_session),
) -> ConfigResponse:
    config_key = _login_page_template_config_key(template_id)
    return _apply_runtime_config_update(session, values={config_key: payload.config})


@router.post(
    "/login-page-template-config/{template_id}/reset",
    response_model=ConfigResponse,
    dependencies=[WRITE_SETTINGS_PERMISSION],
)
def reset_login_page_template_config_endpoint(
    template_id: str,
    session: Session = Depends(get_session),
) -> ConfigResponse:
    config_key = _login_page_template_config_key(template_id)
    return _apply_runtime_config_update(session, reset_keys={config_key})
