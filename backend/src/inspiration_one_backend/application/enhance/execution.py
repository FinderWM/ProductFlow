from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, replace
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from inspiration_one_backend.application.generation_config_runtime import (
    GenerationConfigSelection,
    claim_runtime_generation_config,
    generation_failure_is_throttled,
    generation_failure_is_timeout,
    generation_failure_reason,
    release_runtime_generation_config,
)
from inspiration_one_backend.config import get_runtime_settings
from inspiration_one_backend.domain.enums import EnhanceStrategy
from inspiration_one_backend.domain.errors import BusinessValidationError
from inspiration_one_backend.infrastructure.db.models import GenerationConfig, GenerationConfigResourceGroup
from inspiration_one_backend.infrastructure.image.chat_service import ImageChatService
from inspiration_one_backend.infrastructure.provider_config import (
    IMAGE_PURPOSE,
    generation_config_effective_enabled,
    generation_config_resource_group_ids,
    resolve_effective_max_dimension,
)
from inspiration_one_backend.infrastructure.storage import LocalStorage

from .strategy import EnhanceContext, EnhanceResult

ENHANCE_FINAL_MAX_PIXELS = 120_000_000
ENHANCE_FINAL_MAX_EDGE = 16_384
ENHANCE_FINAL_MAX_UPLOAD_BYTES = 256 * 1024 * 1024


@dataclass(frozen=True, slots=True)
class EnhanceExecutionRequest:
    session: Session
    owner_user_id: str
    strategy: EnhanceStrategy
    params: dict[str, Any]
    generation_config_selection: GenerationConfigSelection
    source_image_bytes: bytes
    source_mime: str
    source_width: int
    source_height: int
    output_prefix: str
    strategy_runner: Callable[[EnhanceContext, dict[str, Any]], EnhanceResult]
    storage: LocalStorage
    reference_limit: int = 2
    quality_prompt: str | None = None
    progress_callback: Callable[[int, int], None] | None = None
    cancel_check: Callable[[], bool] | None = None
    post_result_check: Callable[[EnhanceResult], None] | None = None


@dataclass(frozen=True, slots=True)
class EnhanceExecutionOutcome:
    result: EnhanceResult
    normalized_params: dict[str, Any]
    required_max_dimension: int
    used_generation_config_id: str
    used_resource_group_id: str


def execute_enhance_execution(request: EnhanceExecutionRequest) -> EnhanceExecutionOutcome:
    normalized_params, required_max_dimension = validate_enhance_params(
        strategy=request.strategy,
        params=request.params,
        source_width=request.source_width,
        source_height=request.source_height,
    )
    validate_enhance_generation_config_selection(
        request.session,
        selection=request.generation_config_selection,
        required_max_dimension=required_max_dimension,
    )
    selection = replace(request.generation_config_selection, required_max_dimension=required_max_dimension)
    runtime_claim = None
    completed_call_count = 0

    def track_progress(completed: int, total: int) -> None:
        nonlocal completed_call_count
        completed_call_count = completed
        if request.progress_callback is not None:
            request.progress_callback(completed, total)

    try:
        runtime_claim = claim_runtime_generation_config(
            purpose="image",
            selection=selection,
        )
        ctx = EnhanceContext(
            session=request.session,
            storage=request.storage,
            service=ImageChatService(generation_config_id=runtime_claim.generation_config_id),
            source_image_bytes=request.source_image_bytes,
            source_mime=request.source_mime,
            source_width=request.source_width,
            source_height=request.source_height,
            output_prefix=request.output_prefix,
            reference_limit=request.reference_limit,
            quality_prompt=request.quality_prompt,
            progress_callback=track_progress,
            cancel_check=request.cancel_check,
        )
        result = request.strategy_runner(ctx, normalized_params)
        completed_call_count = max(completed_call_count, int(result.completed_call_count or 0))
        if request.post_result_check is not None:
            request.post_result_check(result)
        used_generation_config_id = runtime_claim.generation_config_id
        used_resource_group_id = runtime_claim.resource_group_id
        release_runtime_generation_config(
            runtime_claim,
            success=True,
            user_id=request.owner_user_id,
            generated_unit_count=completed_call_count or 1,
        )
        runtime_claim = None
        return EnhanceExecutionOutcome(
            result=result,
            normalized_params=normalized_params,
            required_max_dimension=required_max_dimension,
            used_generation_config_id=used_generation_config_id,
            used_resource_group_id=used_resource_group_id,
        )
    except BaseException as exc:  # noqa: BLE001
        release_runtime_generation_config(
            runtime_claim,
            success=False,
            user_id=request.owner_user_id,
            generated_unit_count=max(0, completed_call_count),
            failure_reason=generation_failure_reason(exc),
            timeout=generation_failure_is_timeout(exc),
            throttled=generation_failure_is_throttled(exc),
        )
        raise


def validate_enhance_params(
    *,
    strategy: EnhanceStrategy,
    params: dict[str, Any],
    source_width: int,
    source_height: int,
) -> tuple[dict[str, Any], int]:
    settings = get_runtime_settings()
    if strategy == EnhanceStrategy.DIRECT:
        target_width = _positive_int(params.get("target_width"), "目标宽度")
        target_height = _positive_int(params.get("target_height"), "目标高度")
        max_dim = int(settings.image_generation_max_dimension)
        if target_width > max_dim or target_height > max_dim:
            raise BusinessValidationError(f"目标尺寸不能超过生图最大单边 {max_dim}")
        return ({"target_width": target_width, "target_height": target_height}, max(target_width, target_height))

    if strategy == EnhanceStrategy.TILED:
        scale = _positive_int(params.get("scale"), "增强倍数")
        if scale not in {2, 3, 4}:
            raise BusinessValidationError("分块增强倍数只能是 2、3 或 4")
        tile_base_size = _positive_int(params.get("tile_base_size", 1024), "分块尺寸")
        overlap_pct = _non_negative_int(params.get("overlap_pct", 10), "重叠比例")
        if overlap_pct != 10:
            raise BusinessValidationError("分块重叠比例固定为 10")
        max_dim = int(settings.image_generation_max_dimension)
        if tile_base_size > max_dim:
            raise BusinessValidationError(f"单块尺寸不能超过生图最大单边 {max_dim}")
        final_width = source_width * scale
        final_height = source_height * scale
        validate_enhance_final_resource_bounds(width=final_width, height=final_height, byte_count=0)
        return (
            {"scale": scale, "tile_base_size": tile_base_size, "overlap_pct": overlap_pct},
            tile_base_size,
        )

    raise BusinessValidationError("暂不支持该增强策略")


def validate_enhance_generation_config_selection(
    session: Session,
    *,
    selection: GenerationConfigSelection,
    required_max_dimension: int | None,
) -> None:
    if required_max_dimension is None:
        return
    global_max = int(get_runtime_settings().image_generation_max_dimension)
    if selection.mode == "manual":
        _validate_manual_generation_config_selection(
            session,
            selection=selection,
            required_max_dimension=required_max_dimension,
            global_max=global_max,
        )
        return
    if not selection.resource_group_id:
        raise BusinessValidationError("请选择供应商生成分组")
    configs = list(
        session.scalars(
            select(GenerationConfig)
            .join(
                GenerationConfigResourceGroup,
                GenerationConfigResourceGroup.generation_config_id == GenerationConfig.id,
            )
            .options(
                selectinload(GenerationConfig.provider_profile),
                selectinload(GenerationConfig.resource_group_links),
            )
            .where(
                GenerationConfig.purpose == IMAGE_PURPOSE,
                GenerationConfig.archived_at.is_(None),
                GenerationConfigResourceGroup.resource_group_id == selection.resource_group_id,
            )
        ).all()
    )
    for generation_config in configs:
        if not generation_config.enabled or not generation_config_effective_enabled(generation_config):
            continue
        effective_max = resolve_effective_max_dimension(generation_config.provider_profile, global_max)
        if effective_max >= required_max_dimension:
            return
    raise BusinessValidationError("没有配置支持所需分辨率")


def validate_enhance_final_resource_bounds(*, width: int, height: int, byte_count: int) -> None:
    if width <= 0 or height <= 0:
        raise BusinessValidationError("图片尺寸无效")
    if width > ENHANCE_FINAL_MAX_EDGE or height > ENHANCE_FINAL_MAX_EDGE:
        raise BusinessValidationError(f"拼接结果单边不能超过 {ENHANCE_FINAL_MAX_EDGE}")
    if width * height > ENHANCE_FINAL_MAX_PIXELS:
        raise BusinessValidationError(f"拼接结果像素不能超过 {ENHANCE_FINAL_MAX_PIXELS}")
    if byte_count > 0 and byte_count > ENHANCE_FINAL_MAX_UPLOAD_BYTES:
        raise BusinessValidationError("拼接结果文件过大")


def _validate_manual_generation_config_selection(
    session: Session,
    *,
    selection: GenerationConfigSelection,
    required_max_dimension: int,
    global_max: int,
) -> None:
    if not selection.generation_config_id:
        raise BusinessValidationError("手动指定生成配置时必须选择配置")
    generation_config = session.scalar(
        select(GenerationConfig)
        .options(selectinload(GenerationConfig.provider_profile), selectinload(GenerationConfig.resource_group_links))
        .where(
            GenerationConfig.id == selection.generation_config_id,
            GenerationConfig.archived_at.is_(None),
        )
    )
    if generation_config is None:
        raise BusinessValidationError("生成配置不存在")
    if generation_config.purpose != IMAGE_PURPOSE:
        raise BusinessValidationError("图片增强只能使用图片生成配置")
    if selection.resource_group_id and selection.resource_group_id not in generation_config_resource_group_ids(
        generation_config
    ):
        raise BusinessValidationError("手动指定的生成配置不属于当前供应商生成分组")
    if not generation_config.enabled:
        raise BusinessValidationError("手动指定的生成配置已停用")
    if not generation_config_effective_enabled(generation_config):
        raise BusinessValidationError("手动指定的生成配置供应商不可用")
    effective_max = resolve_effective_max_dimension(generation_config.provider_profile, global_max)
    if effective_max < required_max_dimension:
        raise BusinessValidationError("手动指定的生成配置不支持所需分辨率")


def _positive_int(value: Any, label: str) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise BusinessValidationError(f"{label}必须是整数") from exc
    if parsed <= 0:
        raise BusinessValidationError(f"{label}必须大于 0")
    return parsed


def _non_negative_int(value: Any, label: str) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise BusinessValidationError(f"{label}必须是整数") from exc
    if parsed < 0:
        raise BusinessValidationError(f"{label}不能小于 0")
    return parsed
