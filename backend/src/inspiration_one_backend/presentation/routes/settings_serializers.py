"""设置路由的纯序列化器：ORM 模型 → 响应 schema。

从 routes/settings.py 抽出，无 DB 会话依赖、无对 settings.py 内部 helper 的反向依赖，
便于复用与单测。settings.py import 回这些函数，端点调用点零改。
"""

from __future__ import annotations

from datetime import datetime

from inspiration_one_backend.domain.ui_layout import resolve_ui_layout_scheme
from inspiration_one_backend.infrastructure.db.models import (
    GenerationConfigDailyStat,
    GenerationConfigTestResult,
    GenerationResourceGroup,
    UserUiPreference,
)
from inspiration_one_backend.presentation.schemas.settings import (
    GenerationConfigDailyStatResponse,
    GenerationConfigStateResponse,
    GenerationConfigTestResultResponse,
    GenerationResourceGroupResponse,
    ProviderProfileResponse,
    UserUiPreferencesResponse,
)


def _serialize_dt(value: datetime | None) -> str | None:
    return value.isoformat() if value is not None else None


def _serialize_api_key_preview(api_key: str | None) -> str | None:
    if not api_key:
        return None
    prefix = api_key[:5]
    suffix = api_key[-5:] if len(api_key) > 10 else ""
    return f"{prefix}*****{suffix}"


def _serialize_provider_profile(
    profile,
    *,
    used_by_text_generation: bool = False,
    used_by_image_generation: bool = False,
) -> ProviderProfileResponse:
    return ProviderProfileResponse(
        id=profile.id,
        name=profile.name,
        provider_type=profile.provider_type,
        base_url=profile.base_url,
        api_key_preview=_serialize_api_key_preview(profile.api_key),
        used_by_text_generation=used_by_text_generation,
        used_by_image_generation=used_by_image_generation,
        capabilities=list(profile.capabilities_json or []),
        default_models=dict(profile.default_models_json or {}),
        config=dict(profile.config_json or {}),
        enabled=profile.enabled,
        archived_at=profile.archived_at.isoformat() if profile.archived_at is not None else None,
        has_api_key=bool(profile.api_key),
        created_at=profile.created_at.isoformat(),
        updated_at=profile.updated_at.isoformat(),
    )


def _serialize_generation_resource_group(
    group: GenerationResourceGroup,
    *,
    image_max_dimension: int | None = None,
) -> GenerationResourceGroupResponse:
    return GenerationResourceGroupResponse(
        id=group.id,
        key=group.key,
        name=group.name,
        description=group.description,
        sort_order=group.sort_order,
        enabled=group.enabled,
        image_max_dimension=image_max_dimension,
        blur_images_by_default=group.blur_images_by_default,
        archived_at=_serialize_dt(group.archived_at),
        created_at=group.created_at.isoformat(),
        updated_at=group.updated_at.isoformat(),
    )


def _serialize_user_ui_preferences(preferences: UserUiPreference) -> UserUiPreferencesResponse:
    return UserUiPreferencesResponse(
        user_id=preferences.user_id,
        ui_layout_scheme=resolve_ui_layout_scheme(preferences.ui_layout_scheme),
        mask_sensitive_images_in_inspirations=preferences.mask_sensitive_images_in_inspirations,
        mask_sensitive_images_in_image_chat=preferences.mask_sensitive_images_in_image_chat,
        created_at=preferences.created_at.isoformat(),
        updated_at=preferences.updated_at.isoformat(),
    )


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


def _serialize_generation_config_test_result(
    test_result: GenerationConfigTestResult | None,
) -> GenerationConfigTestResultResponse | None:
    if test_result is None:
        return None
    return GenerationConfigTestResultResponse(
        id=test_result.id,
        generation_config_id=test_result.generation_config_id,
        test_type=test_result.test_type,
        status=test_result.status,
        tested_at=test_result.tested_at.isoformat(),
        duration_ms=test_result.duration_ms,
        provider_kind=test_result.provider_kind,
        model_summary=dict(test_result.model_summary_json or {}),
        message=test_result.message,
        error_detail=test_result.error_detail,
    )
