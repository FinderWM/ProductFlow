from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from time import perf_counter
from typing import Any, Literal, cast

from dramatiq.middleware.time_limit import TimeLimitExceeded
from sqlalchemy import desc, func, or_, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session, selectinload
from sqlalchemy.orm.exc import StaleDataError

from inspiration_one_backend.application.admission import (
    ensure_generation_capacity,
    generation_running_capacity_available,
    get_generation_queue_overview,
    get_generation_task_queue_metadata,
    get_queued_generation_positions,
)
from inspiration_one_backend.application.auth import require_generation_resource_group_for_user
from inspiration_one_backend.application.generation_config_runtime import (
    GenerationConfigSelection,
    GenerationConfigWaitError,
    claim_runtime_generation_config,
    generation_failure_is_throttled,
    generation_failure_is_timeout,
    generation_failure_reason,
    release_runtime_generation_config,
)
from inspiration_one_backend.application.image_generation_failures import (
    ImageGenerationFailureDecision,
    classify_image_generation_failure,
)
from inspiration_one_backend.application.image_session_generation_request import (
    build_branch_generation_context,
    images_api_batch_count,
    normalize_tool_options,
    provider_output_with_actual_size,
    validate_generation_request,
)
from inspiration_one_backend.application.moderation import ensure_resource_usable
from inspiration_one_backend.application.ownership import ensure_actor_can_mutate_owner, resolve_owner_user_id
from inspiration_one_backend.application.queue_submission import enqueue_or_mark_failed
from inspiration_one_backend.application.task_notifications import (
    publish_image_session_generation_attempt_failed_notification_safely,
    publish_image_session_generation_task_notification_safely,
)
from inspiration_one_backend.application.time import now_utc
from inspiration_one_backend.config import normalize_image_generation_size
from inspiration_one_backend.domain.durable_generation_tasks import (
    IMAGE_SESSION_GENERATION_TASK_CONTRACT,
    QUEUE_UNAVAILABLE_DETAIL,
)
from inspiration_one_backend.domain.enums import ImageSessionAssetKind, JobStatus, SourceAssetKind
from inspiration_one_backend.domain.errors import BusinessValidationError, NotFoundError
from inspiration_one_backend.infrastructure.db.models import (
    DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    GenerationConfig,
    ImageSession,
    ImageSessionAsset,
    ImageSessionGenerationTask,
    ImageSessionRound,
    Inspiration,
    SourceAsset,
    new_id,
)
from inspiration_one_backend.infrastructure.db.session import get_session_factory
from inspiration_one_backend.infrastructure.image.base import infer_extension
from inspiration_one_backend.infrastructure.image.chat_service import ImageChatService
from inspiration_one_backend.infrastructure.image.responses_provider import PROVIDER_TEXT_OUTPUT_MESSAGE
from inspiration_one_backend.infrastructure.provider_config import (
    IMAGE_PURPOSE,
    TEXT_PURPOSE,
    ResolvedImageProviderConfig,
    ensure_provider_config_bootstrapped,
    generation_config_resource_group_ids,
)
from inspiration_one_backend.infrastructure.queue import (
    enqueue_image_session_generation_task,
    enqueue_image_session_generation_task_later,
)
from inspiration_one_backend.infrastructure.storage import LocalStorage
from inspiration_one_backend.infrastructure.text.factory import get_text_provider

ATTACH_TARGET = Literal["reference", "main_source"]
DEFAULT_SESSION_TITLE = "未命名会话"
DEFAULT_ASSISTANT_MESSAGE = "已按本轮选择的图片上下文生成候选，你可以从任意候选继续。"
IMAGE_SESSION_GENERATION_MAX_ATTEMPTS = 3
IMAGE_SESSION_GENERATION_MAX_COUNT = 10
IMAGE_SESSION_CAPACITY_RETRY_DELAY_MS = 2000
IMAGE_SESSION_GENERATION_CONFIG_RETRY_DELAY_MS = 2000
GENERIC_IMAGE_GENERATION_FAILURE = "图片生成失败，请稍后重试"
PARTIAL_IMAGE_GENERATION_FAILURE = "已生成 {completed}/{requested} 张候选，后续生成失败，请重新发起生成补齐。"
PARTIAL_IMAGE_GENERATION_TIMEOUT = "已生成 {completed}/{requested} 张候选，但任务超时，剩余候选未完成。"
IMAGE_SESSION_CANCELLED_REASON = "已取消"

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class ImageSessionGenerationTaskCreationResult:
    task: ImageSessionGenerationTask
    image_session: ImageSession


@dataclass(frozen=True, slots=True)
class _ImageSessionGenerationTaskClaimResult:
    claimed: bool
    should_requeue: bool = False


@dataclass(frozen=True, slots=True)
class ImageSessionRoundGenerationResult:
    image_session: ImageSession
    generation_group_id: str


@dataclass(frozen=True, slots=True)
class ImagePromptPolishResult:
    prompt: str
    model_name: str
    generation_config_id: str
    resource_group_id: str


@dataclass(frozen=True, slots=True)
class ImageGenerationConfigTestResult:
    image_session: ImageSession
    round_id: str
    duration_ms: int
    provider_kind: str


@dataclass(frozen=True, slots=True)
class ImageSessionStatusSnapshot:
    image_session: ImageSession
    rounds_count: int
    latest_round_id: str | None
    latest_generation_group_id: str | None
    provider_output_by_generation_group: dict[str, dict[str, Any] | None]


@dataclass(frozen=True, slots=True)
class ImageSessionGenerationExecutionError(Exception):
    completed_candidates: int
    requested_candidates: int
    generation_group_id: str | None
    timed_out: bool = False
    safe_reason: str | None = None
    failure_decision: ImageGenerationFailureDecision | None = None


class ImageSessionGenerationCancelledError(Exception):
    """Raised inside worker execution when durable cancellation is observed."""


def _image_session_query():
    return (
        select(ImageSession)
        .options(
            selectinload(ImageSession.assets),
            selectinload(ImageSession.rounds).selectinload(ImageSessionRound.generated_asset),
            selectinload(ImageSession.rounds)
            .selectinload(ImageSessionRound.generated_asset)
            .selectinload(ImageSessionAsset.gallery_entry),
            selectinload(ImageSession.assets).selectinload(ImageSessionAsset.gallery_entry),
            selectinload(ImageSession.rounds).selectinload(ImageSessionRound.resource_group),
            selectinload(ImageSession.generation_tasks),
            selectinload(ImageSession.generation_tasks).selectinload(ImageSessionGenerationTask.resource_group),
            selectinload(ImageSession.resource_group),
            selectinload(ImageSession.owner),
            selectinload(ImageSession.deleted_by),
            selectinload(ImageSession.inspiration).selectinload(Inspiration.source_assets),
            selectinload(ImageSession.inspiration).selectinload(Inspiration.owner),
        )
        .order_by(desc(ImageSession.updated_at))
    )


def _image_session_status_query():
    return select(ImageSession).options(
        selectinload(ImageSession.generation_tasks).selectinload(ImageSessionGenerationTask.resource_group)
    )


def _get_image_session_or_raise(
    session: Session,
    image_session_id: str,
    *,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
    include_temporary_test: bool = False,
) -> ImageSession:
    stmt = _image_session_query().where(ImageSession.id == image_session_id)
    if not include_temporary_test:
        stmt = stmt.where(ImageSession.is_temporary_test.is_(False))
    if actor_user_id is not None and not actor_is_admin:
        stmt = stmt.where(ImageSession.owner_user_id == actor_user_id, ImageSession.deleted_at.is_(None))
    image_session = session.scalar(stmt)
    if image_session is None:
        raise NotFoundError("连续生图会话不存在")
    _attach_generation_task_queue_metadata(session, image_session)
    return image_session


def _attach_generation_task_queue_metadata(session: Session, image_session: ImageSession) -> None:
    overview = get_generation_queue_overview(session)
    queued_positions = get_queued_generation_positions(session)
    for task in image_session.generation_tasks:
        metadata = get_generation_task_queue_metadata(
            session,
            task,
            overview=overview,
            queued_positions=queued_positions,
        )
        task.__dict__["_queue_metadata"] = metadata


def _get_inspiration_or_raise(
    session: Session,
    inspiration_id: str,
    *,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
) -> Inspiration:
    stmt = (
        select(Inspiration)
        .options(selectinload(Inspiration.source_assets), selectinload(Inspiration.owner))
        .where(Inspiration.id == inspiration_id)
    )
    if actor_user_id is not None and not actor_is_admin:
        stmt = stmt.where(Inspiration.owner_user_id == actor_user_id, Inspiration.deleted_at.is_(None))
    inspiration = session.scalar(stmt)
    if inspiration is None:
        raise NotFoundError("灵感产物不存在")
    return inspiration


def _trim_title(prompt: str) -> str:
    compact = " ".join(prompt.strip().split())
    return compact[:32] + ("..." if len(compact) > 32 else "")


def _get_inspiration_original_assets(inspiration: Inspiration) -> list[SourceAsset]:
    return sorted(
        [asset for asset in inspiration.source_assets if asset.kind == SourceAssetKind.ORIGINAL_IMAGE],
        key=lambda item: item.created_at,
        reverse=True,
    )


def _generation_config_selection(
    resource_group_id: str | None,
    mode: str | None,
    generation_config_id: str | None,
) -> GenerationConfigSelection:
    normalized_mode = (mode or "auto").strip().lower()
    normalized_id = (generation_config_id or "").strip() or None
    if normalized_mode not in {"auto", "manual"}:
        raise BusinessValidationError("生成配置选择模式无效")
    normalized_group_id = (resource_group_id or "").strip()
    if not normalized_group_id:
        raise BusinessValidationError("请选择供应商生成分组")
    if normalized_mode != "manual":
        return GenerationConfigSelection(mode="auto", generation_config_id=None, resource_group_id=normalized_group_id)
    return GenerationConfigSelection(
        mode="manual",
        generation_config_id=normalized_id,
        resource_group_id=normalized_group_id,
    )


def _validate_manual_generation_config_selection(
    session: Session,
    selection: GenerationConfigSelection,
    *,
    purpose: str,
    purpose_error_message: str,
) -> None:
    if selection.mode != "manual":
        return
    if selection.generation_config_id is None:
        raise BusinessValidationError("手动指定生成配置时必须选择配置")
    generation_config = session.scalar(
        select(GenerationConfig).where(
            GenerationConfig.id == selection.generation_config_id,
            GenerationConfig.archived_at.is_(None),
        )
    )
    if generation_config is None:
        raise BusinessValidationError("生成配置不存在")
    if generation_config.purpose != purpose:
        raise BusinessValidationError(purpose_error_message)
    if selection.resource_group_id not in generation_config_resource_group_ids(generation_config):
        raise BusinessValidationError("手动指定的生成配置不属于当前供应商生成分组")


def _authorized_image_generation_config_selection(
    session: Session,
    *,
    image_session: ImageSession,
    resource_group_id: str | None,
    generation_config_mode: str = "auto",
    generation_config_id: str | None = None,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
) -> GenerationConfigSelection:
    selection = _generation_config_selection(resource_group_id, generation_config_mode, generation_config_id)
    group_actor_user_id = actor_user_id or image_session.owner_user_id
    group_actor_is_admin = actor_is_admin or (
        actor_user_id is None and bool(image_session.owner and image_session.owner.is_admin)
    )
    group = require_generation_resource_group_for_user(
        session,
        user_id=group_actor_user_id,
        is_admin=group_actor_is_admin,
        resource_group_id=selection.resource_group_id,
    )
    selection = GenerationConfigSelection(
        mode=selection.mode,
        generation_config_id=selection.generation_config_id,
        resource_group_id=group.id,
    )
    _validate_manual_generation_config_selection(
        session,
        selection,
        purpose=IMAGE_PURPOSE,
        purpose_error_message="生图任务只能使用图片生成配置",
    )
    return selection


def _image_generation_task_event_at(task: ImageSessionGenerationTask) -> datetime:
    return task.finished_at or task.progress_updated_at or task.started_at or task.created_at


def _event_timestamp(value: datetime) -> float:
    return value.timestamp()


def _latest_image_generation_event(image_session: ImageSession) -> tuple[str, str, JobStatus] | None:
    events: list[tuple[float, int, str, str, JobStatus]] = []
    for round_item in image_session.rounds:
        events.append((_event_timestamp(round_item.created_at), 0, "round", round_item.id, JobStatus.SUCCEEDED))
    for task in image_session.generation_tasks:
        if task.status in {JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.FAILED, JobStatus.CANCELLED}:
            events.append((_event_timestamp(_image_generation_task_event_at(task)), 1, "task", task.id, task.status))
        elif task.status == JobStatus.SUCCEEDED and not task.result_generation_group_id:
            events.append((_event_timestamp(_image_generation_task_event_at(task)), 1, "task", task.id, task.status))
    if not events:
        return None
    latest = max(events, key=lambda item: (item[0], item[1], item[3]))
    return latest[2], latest[3], latest[4]


def _require_latest_failed_image_generation_task(
    image_session: ImageSession,
    task: ImageSessionGenerationTask,
) -> None:
    if task.status != JobStatus.FAILED:
        raise BusinessValidationError("只有失败的生成任务可以重试")
    latest = _latest_image_generation_event(image_session)
    if latest != ("task", task.id, JobStatus.FAILED):
        raise BusinessValidationError("只能恢复最后一次失败的生成任务")


def polish_image_session_prompt(
    *,
    session: Session,
    prompt: str,
    resource_group_id: str | None,
    generation_config_mode: str = "auto",
    generation_config_id: str | None = None,
    user_id: str | None = None,
    user_is_admin: bool = False,
) -> ImagePromptPolishResult:
    normalized_prompt = prompt.strip()
    if not normalized_prompt:
        raise BusinessValidationError("画面描述不能为空")
    generation_config_selection = _generation_config_selection(
        resource_group_id,
        generation_config_mode,
        generation_config_id,
    )
    group = require_generation_resource_group_for_user(
        session,
        user_id=user_id,
        is_admin=user_is_admin,
        resource_group_id=generation_config_selection.resource_group_id,
    )
    generation_config_selection = GenerationConfigSelection(
        mode=generation_config_selection.mode,
        generation_config_id=generation_config_selection.generation_config_id,
        resource_group_id=group.id,
    )
    _validate_manual_generation_config_selection(
        session,
        generation_config_selection,
        purpose=TEXT_PURPOSE,
        purpose_error_message="文案润色只能使用文案生成配置",
    )
    try:
        runtime_claim = claim_runtime_generation_config(purpose="text", selection=generation_config_selection)
    except (GenerationConfigWaitError, ValueError) as exc:
        raise BusinessValidationError(str(exc)) from exc
    try:
        provider = get_text_provider(generation_config_id=runtime_claim.generation_config_id)
    except Exception as exc:
        release_runtime_generation_config(runtime_claim, success=False, record_result=False)
        raise BusinessValidationError(str(exc)) from exc
    try:
        polished_prompt, model_name = provider.polish_image_prompt(normalized_prompt)
    except Exception as exc:
        release_runtime_generation_config(
            runtime_claim,
            success=False,
            user_id=user_id,
            failure_reason=generation_failure_reason(exc),
            timeout=generation_failure_is_timeout(exc),
            throttled=generation_failure_is_throttled(exc),
        )
        raise BusinessValidationError("画面描述润色失败，请稍后重试") from exc
    release_runtime_generation_config(runtime_claim, success=True, user_id=user_id, generated_unit_count=1)
    return ImagePromptPolishResult(
        prompt=polished_prompt,
        model_name=model_name,
        generation_config_id=runtime_claim.generation_config_id,
        resource_group_id=runtime_claim.resource_group_id,
    )


def _image_task_generation_config_selection(task: ImageSessionGenerationTask) -> GenerationConfigSelection:
    return _generation_config_selection(
        task.resource_group_id,
        task.generation_config_mode,
        task.requested_generation_config_id,
    )


def list_image_sessions(
    session: Session,
    *,
    inspiration_id: str | None = None,
    resource_group_id: str | None = None,
    owner_user_id: str | None = None,
    only_deleted: bool = False,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
) -> list[ImageSession]:
    stmt = _image_session_query()
    if actor_user_id is not None and not actor_is_admin:
        stmt = stmt.where(ImageSession.owner_user_id == actor_user_id)
    if actor_is_admin and owner_user_id:
        stmt = stmt.where(ImageSession.owner_user_id == owner_user_id)
    if only_deleted and actor_is_admin:
        stmt = stmt.where(ImageSession.deleted_at.is_not(None))
    else:
        stmt = stmt.where(ImageSession.deleted_at.is_(None))
    if inspiration_id is None:
        stmt = stmt.where(ImageSession.inspiration_id.is_(None))
    else:
        stmt = stmt.where(ImageSession.inspiration_id == inspiration_id)
    stmt = stmt.where(ImageSession.is_temporary_test.is_(False))
    normalized_group_id = (resource_group_id or "").strip() or None
    if normalized_group_id is not None:
        if normalized_group_id == DEFAULT_GENERATION_RESOURCE_GROUP_ID:
            stmt = stmt.where(
                or_(ImageSession.resource_group_id == normalized_group_id, ImageSession.resource_group_id.is_(None))
            )
        else:
            stmt = stmt.where(ImageSession.resource_group_id == normalized_group_id)
    return list(session.scalars(stmt).all())


def get_image_session_detail(
    session: Session,
    image_session_id: str,
    *,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
) -> ImageSession:
    return _get_image_session_or_raise(
        session,
        image_session_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )


def get_image_session_status(
    session: Session,
    image_session_id: str,
    *,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
) -> ImageSessionStatusSnapshot:
    stmt = _image_session_status_query().where(ImageSession.id == image_session_id)
    if actor_user_id is not None and not actor_is_admin:
        stmt = stmt.where(ImageSession.owner_user_id == actor_user_id, ImageSession.deleted_at.is_(None))
    image_session = session.scalar(stmt)
    if image_session is None:
        raise NotFoundError("连续生图会话不存在")
    _attach_generation_task_queue_metadata(session, image_session)

    rounds_count = session.scalar(
        select(func.count()).select_from(ImageSessionRound).where(ImageSessionRound.session_id == image_session.id)
    )
    latest_round_row = session.execute(
        select(ImageSessionRound.id, ImageSessionRound.generation_group_id)
        .where(ImageSessionRound.session_id == image_session.id)
        .order_by(desc(ImageSessionRound.created_at), desc(ImageSessionRound.id))
        .limit(1)
    ).first()
    result_group_ids = {
        task.result_generation_group_id
        for task in image_session.generation_tasks
        if task.result_generation_group_id is not None
    }
    provider_output_by_group: dict[str, dict[str, Any] | None] = {}
    if result_group_ids:
        for generation_group_id, provider_output_json in session.execute(
            select(ImageSessionRound.generation_group_id, ImageSessionRound.provider_output_json)
            .where(
                ImageSessionRound.session_id == image_session.id,
                ImageSessionRound.generation_group_id.in_(result_group_ids),
            )
            .order_by(desc(ImageSessionRound.created_at))
        ):
            if generation_group_id and generation_group_id not in provider_output_by_group:
                provider_output_by_group[generation_group_id] = provider_output_json

    return ImageSessionStatusSnapshot(
        image_session=image_session,
        rounds_count=int(rounds_count or 0),
        latest_round_id=latest_round_row.id if latest_round_row else None,
        latest_generation_group_id=latest_round_row.generation_group_id if latest_round_row else None,
        provider_output_by_generation_group=provider_output_by_group,
    )


def create_image_session(
    session: Session,
    *,
    inspiration_id: str | None,
    resource_group_id: str | None = DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    title: str | None = None,
    owner_user_id: str | None = None,
    actor_is_admin: bool = False,
) -> ImageSession:
    resolved_owner_user_id = resolve_owner_user_id(session, owner_user_id)
    if inspiration_id:
        inspiration = _get_inspiration_or_raise(
            session,
            inspiration_id,
            actor_user_id=resolved_owner_user_id,
            actor_is_admin=actor_is_admin,
        )
        ensure_actor_can_mutate_owner(
            owner_user_id=inspiration.owner_user_id,
            actor_user_id=resolved_owner_user_id,
            actor_is_admin=actor_is_admin,
            missing_message="灵感产物不存在",
        )
        ensure_resource_usable(inspiration)
    normalized_title = (title or DEFAULT_SESSION_TITLE).strip() or DEFAULT_SESSION_TITLE
    normalized_group_id = (resource_group_id or "").strip() or DEFAULT_GENERATION_RESOURCE_GROUP_ID
    image_session = ImageSession(
        owner_user_id=resolved_owner_user_id,
        inspiration_id=inspiration_id,
        resource_group_id=normalized_group_id,
        title=normalized_title,
    )
    session.add(image_session)
    session.commit()
    session.expire_all()
    return _get_image_session_or_raise(session, image_session.id)


def test_image_generation_config(
    session: Session,
    *,
    prompt: str,
    size: str,
    resource_group_id: str,
    provider_config: ResolvedImageProviderConfig,
    owner_user_id: str,
    actor_is_admin: bool = False,
    storage: LocalStorage | None = None,
) -> ImageGenerationConfigTestResult:
    normalized_prompt = prompt.strip()
    if not normalized_prompt:
        raise BusinessValidationError("测试文案不能为空")
    normalized_size = normalize_image_generation_size(size, label="测试图片尺寸")
    resource_group = require_generation_resource_group_for_user(
        session,
        user_id=owner_user_id,
        is_admin=actor_is_admin,
        resource_group_id=resource_group_id,
    )
    storage = storage or LocalStorage()
    image_session = ImageSession(
        owner_user_id=owner_user_id,
        inspiration_id=None,
        resource_group_id=resource_group.id,
        title=_image_generation_config_test_session_title(provider_config),
        is_temporary_test=True,
    )
    session.add(image_session)
    session.flush()

    relative_path: str | None = None
    start = perf_counter()
    try:
        result = ImageChatService(provider_config=provider_config).generate(
            prompt=normalized_prompt,
            size=normalized_size,
            manual_reference_images=[],
        )
        duration_ms = int((perf_counter() - start) * 1000)
        relative_path = storage.save_image_session_generated(
            image_session.id,
            result.bytes_data,
            content_type=result.mime_type,
        )
        asset = ImageSessionAsset(
            owner_user_id=image_session.owner_user_id,
            session_id=image_session.id,
            kind=ImageSessionAssetKind.GENERATED_IMAGE,
            original_filename=f"config-test-{now_utc().strftime('%Y%m%d-%H%M%S')}{infer_extension(result.mime_type)}",
            mime_type=result.mime_type,
            **storage.metadata_for(relative_path).as_model_kwargs(),
        )
        session.add(asset)
        session.flush()
        round_item = ImageSessionRound(
            session_id=image_session.id,
            prompt=normalized_prompt,
            assistant_message="图片生成配置测试结果。",
            size=normalized_size,
            model_name=result.model_name,
            provider_name=result.provider_name,
            prompt_version=result.prompt_version,
            provider_response_id=result.provider_response_id,
            previous_response_id=None,
            image_generation_call_id=result.image_generation_call_id,
            provider_request_json=result.provider_request_json,
            provider_output_json=provider_output_with_actual_size(
                result.provider_output_json,
                requested_size=normalized_size,
                image_bytes=result.bytes_data,
            ),
            generation_group_id=new_id(),
            candidate_index=1,
            candidate_count=1,
            base_asset_ids=[],
            base_asset_id=None,
            selected_reference_asset_ids=[],
            generated_asset_id=asset.id,
            generation_config_id=provider_config.generation_config_id,
            resource_group_id=resource_group.id,
        )
        session.add(round_item)
        image_session.updated_at = now_utc()
        session.commit()
    except BaseException:
        session.rollback()
        raise
    session.expire_all()
    return ImageGenerationConfigTestResult(
        image_session=_get_image_session_or_raise(
            session,
            image_session.id,
            actor_user_id=owner_user_id,
            actor_is_admin=actor_is_admin,
            include_temporary_test=True,
        ),
        round_id=round_item.id,
        duration_ms=duration_ms,
        provider_kind=provider_config.provider_kind,
    )


def _image_generation_config_test_session_title(provider_config: ResolvedImageProviderConfig) -> str:
    subject = provider_config.generation_config_name or provider_config.model or provider_config.provider_kind
    return f"图片配置测试 - {subject}"[:255]


def _get_temporary_image_generation_config_test_session_or_raise(
    session: Session,
    *,
    image_session_id: str,
    actor_user_id: str,
    actor_is_admin: bool = False,
) -> ImageSession:
    image_session = _get_image_session_or_raise(
        session,
        image_session_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        include_temporary_test=True,
    )
    if not image_session.is_temporary_test or image_session.deleted_at is not None:
        raise NotFoundError("图片配置测试结果不存在")
    ensure_actor_can_mutate_owner(
        owner_user_id=image_session.owner_user_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        missing_message="图片配置测试结果不存在",
    )
    return image_session


def keep_image_generation_config_test_session(
    session: Session,
    *,
    image_session_id: str,
    actor_user_id: str,
    actor_is_admin: bool = False,
) -> ImageSession:
    image_session = _get_temporary_image_generation_config_test_session_or_raise(
        session,
        image_session_id=image_session_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )
    image_session.is_temporary_test = False
    image_session.updated_at = now_utc()
    session.commit()
    session.expire_all()
    return _get_image_session_or_raise(
        session,
        image_session.id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )


def abandon_image_generation_config_test_session(
    session: Session,
    *,
    image_session_id: str,
    actor_user_id: str,
    actor_is_admin: bool = False,
) -> None:
    image_session = _get_temporary_image_generation_config_test_session_or_raise(
        session,
        image_session_id=image_session_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )
    image_session.deleted_at = now_utc()
    image_session.deleted_by_user_id = actor_user_id
    image_session.updated_at = image_session.deleted_at
    session.commit()


def update_image_session(
    session: Session,
    *,
    image_session_id: str,
    title: str,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
) -> ImageSession:
    image_session = _get_image_session_or_raise(
        session,
        image_session_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )
    ensure_actor_can_mutate_owner(
        owner_user_id=image_session.owner_user_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        missing_message="连续生图会话不存在",
    )
    ensure_resource_usable(image_session)
    image_session.title = title.strip() or DEFAULT_SESSION_TITLE
    image_session.updated_at = now_utc()
    session.commit()
    session.expire_all()
    return _get_image_session_or_raise(session, image_session.id)


def delete_image_session(
    session: Session,
    *,
    image_session_id: str,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
    storage: LocalStorage | None = None,
) -> None:
    image_session = _get_image_session_or_raise(
        session,
        image_session_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )
    ensure_actor_can_mutate_owner(
        owner_user_id=image_session.owner_user_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        missing_message="连续生图会话不存在",
    )
    ensure_resource_usable(image_session)
    image_session.deleted_at = now_utc()
    image_session.deleted_by_user_id = actor_user_id
    image_session.updated_at = image_session.deleted_at
    session.commit()


def add_image_session_reference_images(
    session: Session,
    *,
    image_session_id: str,
    reference_image_uploads: list[tuple[bytes, str, str]],
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
    storage: LocalStorage | None = None,
) -> ImageSession:
    image_session = _get_image_session_or_raise(
        session,
        image_session_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )
    ensure_actor_can_mutate_owner(
        owner_user_id=image_session.owner_user_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        missing_message="连续生图会话不存在",
    )
    ensure_resource_usable(image_session)
    storage = storage or LocalStorage()
    for content, filename, mime_type in reference_image_uploads:
        relative_path = storage.save_image_session_reference(
            image_session.id,
            content,
            content_type=mime_type,
        )
        storage_metadata = storage.metadata_for(relative_path)
        session.add(
            ImageSessionAsset(
                owner_user_id=image_session.owner_user_id,
                session_id=image_session.id,
                kind=ImageSessionAssetKind.REFERENCE_UPLOAD,
                original_filename=filename,
                mime_type=mime_type or "application/octet-stream",
                **storage_metadata.as_model_kwargs(),
            )
        )
    image_session.updated_at = now_utc()
    session.commit()
    session.expire_all()
    return _get_image_session_or_raise(session, image_session.id)


def delete_image_session_reference_image(
    session: Session,
    *,
    image_session_id: str,
    asset_id: str,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
    storage: LocalStorage | None = None,
) -> ImageSession:
    image_session = _get_image_session_or_raise(
        session,
        image_session_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )
    ensure_actor_can_mutate_owner(
        owner_user_id=image_session.owner_user_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        missing_message="连续生图会话不存在",
    )
    ensure_resource_usable(image_session)
    asset = next((item for item in image_session.assets if item.id == asset_id), None)
    if asset is None:
        raise NotFoundError("会话参考图不存在")
    if asset.kind != ImageSessionAssetKind.REFERENCE_UPLOAD:
        raise BusinessValidationError("只能删除会话参考图")
    ensure_resource_usable(asset)

    session.delete(asset)
    image_session.updated_at = now_utc()
    session.commit()
    session.expire_all()
    return _get_image_session_or_raise(session, image_session.id)


def _execute_image_session_round_generation(
    session: Session,
    *,
    image_session_id: str,
    prompt: str,
    size: str,
    base_asset_ids: list[str] | None = None,
    base_asset_id: str | None = None,
    selected_reference_asset_ids: list[str] | None = None,
    generation_count: int = 1,
    tool_options: dict[str, Any] | None = None,
    generation_config_selection: GenerationConfigSelection | None = None,
    storage: LocalStorage | None = None,
    generation_task_id: str | None = None,
) -> ImageSessionRoundGenerationResult:
    """执行一轮生图，调用 AI 并保存结果到会话。"""
    image_session = _get_image_session_or_raise(session, image_session_id)
    ensure_resource_usable(image_session)
    storage = storage or LocalStorage()
    generation_task = session.get(ImageSessionGenerationTask, generation_task_id) if generation_task_id else None
    if generation_task is not None and generation_config_selection is None:
        generation_config_selection = _image_task_generation_config_selection(generation_task)
    if generation_config_selection is None:
        raise BusinessValidationError("请选择供应商生成分组")
    logger.info(
        "连续生图任务开始准备执行: task_id=%s image_session_id=%s generation_count=%s size=%s "
        "generation_config_mode=%s requested_generation_config_id=%s resource_group_id=%s "
        "base_asset_count=%s selected_reference_count=%s",
        generation_task_id,
        image_session_id,
        generation_count,
        size,
        generation_config_selection.mode,
        generation_config_selection.generation_config_id,
        generation_config_selection.resource_group_id,
        len(base_asset_ids or ([] if base_asset_id is None else [base_asset_id])),
        len(selected_reference_asset_ids or []),
    )
    normalized_tool_options = normalize_tool_options(tool_options)
    (
        normalized_size,
        normalized_base_asset_ids,
        normalized_base_asset_id,
        normalized_reference_ids,
    ) = validate_generation_request(
        image_session,
        size=size,
        base_asset_ids=base_asset_ids,
        base_asset_id=base_asset_id,
        selected_reference_asset_ids=selected_reference_asset_ids,
        generation_count=generation_count,
        current_generation_task_id=generation_task_id,
        max_generation_count=IMAGE_SESSION_GENERATION_MAX_COUNT,
    )
    (
        manual_references,
        previous_response_id,
        _validated_base_asset_ids,
        _validated_base_asset_id,
        _validated_reference_ids,
    ) = build_branch_generation_context(
        image_session,
        storage,
        base_asset_ids=normalized_base_asset_ids,
        base_asset_id=normalized_base_asset_id,
        selected_reference_asset_ids=[],
    )
    logger.info(
        "连续生图任务上下文已准备: task_id=%s image_session_id=%s normalized_size=%s "
        "base_asset_count=%s manual_reference_count=%s has_previous_response_id=%s",
        generation_task_id,
        image_session_id,
        normalized_size,
        len(normalized_base_asset_ids),
        len(manual_references),
        previous_response_id is not None,
    )

    generation_group_id = generation_task.result_generation_group_id if generation_task else None
    completed_candidates = 0
    if generation_task is not None:
        completed_candidates = max(0, min(generation_task.completed_candidates or 0, generation_count))
        if generation_group_id:
            saved_candidate_index = session.scalar(
                select(func.max(ImageSessionRound.candidate_index)).where(
                    ImageSessionRound.session_id == image_session.id,
                    ImageSessionRound.generation_group_id == generation_group_id,
                )
            )
            completed_candidates = max(completed_candidates, min(int(saved_candidate_index or 0), generation_count))
        if completed_candidates >= generation_count:
            _finish_image_generation_task(
                session,
                task=generation_task,
                status=JobStatus.SUCCEEDED,
                result_generation_group_id=generation_group_id,
                is_retryable=False,
            )
            session.expire_all()
            return ImageSessionRoundGenerationResult(
                image_session=_get_image_session_or_raise(session, image_session.id),
                generation_group_id=generation_group_id or new_id(),
            )
    generation_group_id = generation_group_id or new_id()
    should_update_default_title = not image_session.rounds and image_session.title == DEFAULT_SESSION_TITLE
    pending_provider_results = []
    session.commit()
    runtime_claim = claim_runtime_generation_config(purpose="image", selection=generation_config_selection)
    logger.info(
        "连续生图任务已获取生成配置: task_id=%s image_session_id=%s generation_config_id=%s resource_group_id=%s",
        generation_task_id,
        image_session_id,
        runtime_claim.generation_config_id,
        runtime_claim.resource_group_id,
    )
    completed_candidates_at_claim = completed_candidates
    try:
        service = ImageChatService(generation_config_id=runtime_claim.generation_config_id)
    except BaseException:
        release_runtime_generation_config(runtime_claim, success=False, record_result=False)
        raise
    logger.info(
        "连续生图任务已初始化图片供应商: task_id=%s image_session_id=%s generation_config_id=%s provider_kind=%s",
        generation_task_id,
        image_session_id,
        runtime_claim.generation_config_id,
        service.provider_kind,
    )
    provider_manual_references = _provider_manual_references_for_session_generation(
        provider_kind=service.provider_kind,
        manual_references=manual_references,
        selected_reference_ids=normalized_reference_ids,
    )
    if generation_task is not None:
        generation_task.used_generation_config_id = runtime_claim.generation_config_id
        generation_task.resource_group_id = runtime_claim.resource_group_id
        generation_task.progress_phase = "generation_config_claimed"
        generation_task.progress_updated_at = now_utc()
        generation_task.progress_metadata = {
            "generation_config_id": runtime_claim.generation_config_id,
            "resource_group_id": runtime_claim.resource_group_id,
            "candidate_count": generation_count,
            "completed_candidates": completed_candidates,
        }
        session.commit()
    runtime_claim_released = False

    def release_claim(
        *,
        success: bool,
        failure_reason: str | None = None,
        timeout: bool = False,
        throttled: bool = False,
        record_result: bool = True,
    ) -> None:
        nonlocal runtime_claim_released
        if runtime_claim_released:
            return
        runtime_claim_released = True
        release_runtime_generation_config(
            runtime_claim,
            success=success,
            user_id=image_session.owner_user_id,
            generated_unit_count=max(0, completed_candidates - completed_candidates_at_claim),
            failure_reason=failure_reason,
            timeout=timeout,
            throttled=throttled,
            record_result=record_result,
        )

    for candidate_index in range(completed_candidates + 1, generation_count + 1):
        relative_path: str | None = None
        try:
            _raise_if_image_generation_task_cancelled(session, generation_task_id)
            logger.info(
                "连续生图任务开始调用图片供应商: task_id=%s image_session_id=%s generation_config_id=%s "
                "provider_kind=%s candidate_index=%s candidate_count=%s",
                generation_task_id,
                image_session_id,
                runtime_claim.generation_config_id,
                service.provider_kind,
                candidate_index,
                generation_count,
            )
            if generation_task_id is not None:
                _update_image_generation_task_progress(
                    session,
                    task_id=generation_task_id,
                    phase="candidate_started",
                    completed_candidates=completed_candidates,
                    active_candidate_index=candidate_index,
                    provider_response_id=None,
                    provider_response_status=None,
                    progress_metadata={
                        "candidate_index": candidate_index,
                        "candidate_count": generation_count,
                    },
                    clear_provider_response=True,
                )
            _raise_if_image_generation_task_cancelled(session, generation_task_id)
            if pending_provider_results:
                result = pending_provider_results.pop(0)
            else:
                remaining_count = generation_count - candidate_index + 1
                batch_count = images_api_batch_count(
                    provider_kind=service.provider_kind,
                    remaining_count=remaining_count,
                )
                if batch_count > 1:
                    provider_results = service.generate_many(
                        prompt=prompt,
                        size=normalized_size,
                        manual_reference_images=provider_manual_references,
                        candidate_count=batch_count,
                        tool_options=normalized_tool_options,
                    )
                    result = provider_results[0]
                    pending_provider_results.extend(provider_results[1:])
                else:
                    result = service.generate(
                        prompt=prompt,
                        size=normalized_size,
                        manual_reference_images=provider_manual_references,
                        previous_response_id=previous_response_id,
                        tool_options=normalized_tool_options,
                        progress_callback=_provider_progress_callback(
                            session,
                            task_id=generation_task_id,
                            session_id=image_session_id,
                            candidate_index=candidate_index,
                            generation_count=generation_count,
                            completed_candidates=completed_candidates,
                        ),
                    )
            _raise_if_image_generation_task_cancelled(session, generation_task_id)

            relative_path = storage.save_image_session_generated(
                image_session.id,
                result.bytes_data,
                content_type=result.mime_type,
            )
            _raise_if_image_generation_task_cancelled(session, generation_task_id)
            asset = ImageSessionAsset(
                owner_user_id=image_session.owner_user_id,
                session_id=image_session.id,
                kind=ImageSessionAssetKind.GENERATED_IMAGE,
                original_filename=(
                    f"generated-{now_utc().strftime('%Y%m%d-%H%M%S')}"
                    f"-{candidate_index}{infer_extension(result.mime_type)}"
                ),
                mime_type=result.mime_type,
                **storage.metadata_for(relative_path).as_model_kwargs(),
            )
            session.add(asset)
            session.flush()

            assistant_message = (
                f"已生成第 {candidate_index}/{generation_count} 张候选，你可以从任意候选继续。"
                if generation_count > 1
                else DEFAULT_ASSISTANT_MESSAGE
            )
            round_item = ImageSessionRound(
                session_id=image_session.id,
                prompt=prompt.strip(),
                assistant_message=assistant_message,
                size=normalized_size,
                model_name=result.model_name,
                provider_name=result.provider_name,
                prompt_version=result.prompt_version,
                provider_response_id=result.provider_response_id,
                previous_response_id=None,
                image_generation_call_id=result.image_generation_call_id,
                provider_request_json=result.provider_request_json,
                provider_output_json=provider_output_with_actual_size(
                    result.provider_output_json,
                    requested_size=normalized_size,
                    image_bytes=result.bytes_data,
                ),
                generation_group_id=generation_group_id,
                candidate_index=candidate_index,
                candidate_count=generation_count,
                base_asset_ids=normalized_base_asset_ids,
                base_asset_id=normalized_base_asset_id,
                selected_reference_asset_ids=normalized_reference_ids,
                generated_asset_id=asset.id,
                generation_config_id=runtime_claim.generation_config_id,
                resource_group_id=runtime_claim.resource_group_id,
            )
            session.add(round_item)
            session.flush()
            now = now_utc()
            if should_update_default_title:
                _touch_image_session_if_present(session, image_session.id, now=now, title=_trim_title(prompt))
                should_update_default_title = False
            else:
                _touch_image_session_if_present(session, image_session.id, now=now)
            if generation_task_id is not None:
                task = session.get(ImageSessionGenerationTask, generation_task_id)
                if task is not None:
                    task.completed_candidates = candidate_index
                    task.active_candidate_index = None
                    task.progress_phase = "candidate_saved"
                    task.progress_updated_at = now_utc()
                    task.result_generation_group_id = generation_group_id
                    task.progress_metadata = {
                        "candidate_index": candidate_index,
                        "candidate_count": generation_count,
                        "generated_asset_id": asset.id,
                        "round_id": round_item.id,
                    }
                if task is not None and candidate_index == generation_count:
                    _finish_image_generation_task(
                        session,
                        task=task,
                        status=JobStatus.SUCCEEDED,
                        result_generation_group_id=generation_group_id,
                        is_retryable=False,
                    )
                else:
                    session.commit()
            else:
                session.commit()
            completed_candidates += 1
        except BaseException as exc:  # noqa: BLE001
            session.rollback()
            if isinstance(exc, ImageSessionGenerationCancelledError):
                release_claim(success=False, record_result=False)
                raise
            if isinstance(exc, (KeyboardInterrupt, SystemExit)):
                release_claim(success=False, record_result=False)
                raise
            if generation_task_id is None:
                release_claim(
                    success=False,
                    failure_reason=generation_failure_reason(exc),
                    timeout=generation_failure_is_timeout(exc),
                    throttled=generation_failure_is_throttled(exc),
                )
                raise
            failure_decision = (
                None
                if str(exc) == PROVIDER_TEXT_OUTPUT_MESSAGE
                else classify_image_generation_failure(exc, generic_message=GENERIC_IMAGE_GENERATION_FAILURE)
            )
            throttled = generation_failure_is_throttled(exc) or (
                failure_decision is not None and failure_decision.category in {"rate_limit", "quota"}
            )
            release_claim(
                success=False,
                failure_reason=generation_failure_reason(exc),
                timeout=isinstance(exc, TimeLimitExceeded) or generation_failure_is_timeout(exc),
                throttled=throttled,
            )
            raise ImageSessionGenerationExecutionError(
                completed_candidates=completed_candidates,
                requested_candidates=generation_count,
                generation_group_id=generation_group_id if completed_candidates else None,
                timed_out=isinstance(exc, TimeLimitExceeded),
                safe_reason=str(exc) if str(exc) == PROVIDER_TEXT_OUTPUT_MESSAGE else failure_decision.reason,
                failure_decision=failure_decision,
            ) from exc
    release_claim(success=True)
    session.expire_all()
    return ImageSessionRoundGenerationResult(
        image_session=_get_image_session_or_raise(session, image_session.id),
        generation_group_id=generation_group_id,
    )


def _provider_manual_references_for_session_generation(
    *,
    provider_kind: str,
    manual_references: list[str],
    selected_reference_ids: list[str],
) -> list[str]:
    del selected_reference_ids
    if provider_kind == "openai_images" and not manual_references:
        return []
    return manual_references


def generate_image_session_round(
    session: Session,
    *,
    image_session_id: str,
    prompt: str,
    size: str,
    resource_group_id: str | None,
    base_asset_ids: list[str] | None = None,
    base_asset_id: str | None = None,
    selected_reference_asset_ids: list[str] | None = None,
    generation_count: int = 1,
    tool_options: dict[str, Any] | None = None,
    storage: LocalStorage | None = None,
    generation_config_mode: str = "auto",
    generation_config_id: str | None = None,
) -> ImageSession:
    """兼容同步调用的薄封装；HTTP route 不再使用。"""
    return _execute_image_session_round_generation(
        session,
        image_session_id=image_session_id,
        prompt=prompt,
        size=size,
        base_asset_ids=base_asset_ids,
        base_asset_id=base_asset_id,
        selected_reference_asset_ids=selected_reference_asset_ids,
        generation_count=generation_count,
        tool_options=tool_options,
        storage=storage,
        generation_config_selection=_generation_config_selection(
            resource_group_id,
            generation_config_mode,
            generation_config_id,
        ),
    ).image_session


def create_image_session_generation_task(
    session: Session,
    *,
    image_session_id: str,
    prompt: str,
    size: str,
    resource_group_id: str | None,
    base_asset_ids: list[str] | None = None,
    base_asset_id: str | None = None,
    selected_reference_asset_ids: list[str] | None = None,
    generation_count: int = 1,
    tool_options: dict[str, Any] | None = None,
    generation_config_mode: str = "auto",
    generation_config_id: str | None = None,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
) -> ImageSessionGenerationTaskCreationResult:
    """校验并创建连续生图 durable 任务；不调用 provider。"""
    ensure_provider_config_bootstrapped(session)
    image_session = _get_image_session_or_raise(
        session,
        image_session_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )
    ensure_actor_can_mutate_owner(
        owner_user_id=image_session.owner_user_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        missing_message="连续生图会话不存在",
    )
    ensure_resource_usable(image_session)
    normalized_tool_options = normalize_tool_options(tool_options)
    generation_config_selection = _authorized_image_generation_config_selection(
        session,
        image_session=image_session,
        resource_group_id=resource_group_id,
        generation_config_mode=generation_config_mode,
        generation_config_id=generation_config_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )
    (
        normalized_size,
        normalized_base_asset_ids,
        normalized_base_asset_id,
        normalized_reference_ids,
    ) = validate_generation_request(
        image_session,
        size=size,
        base_asset_ids=base_asset_ids,
        base_asset_id=base_asset_id,
        selected_reference_asset_ids=selected_reference_asset_ids,
        generation_count=generation_count,
        max_generation_count=IMAGE_SESSION_GENERATION_MAX_COUNT,
    )
    ensure_generation_capacity(session, pool="image")
    task = ImageSessionGenerationTask(
        session_id=image_session.id,
        status=JobStatus.QUEUED,
        prompt=prompt.strip(),
        size=normalized_size,
        base_asset_ids=normalized_base_asset_ids,
        base_asset_id=normalized_base_asset_id,
        selected_reference_asset_ids=normalized_reference_ids,
        tool_options=normalized_tool_options,
        generation_config_mode=generation_config_selection.mode,
        requested_generation_config_id=generation_config_selection.generation_config_id,
        resource_group_id=generation_config_selection.resource_group_id,
        generation_count=generation_count,
    )
    session.add(task)
    image_session.resource_group_id = generation_config_selection.resource_group_id
    image_session.updated_at = now_utc()
    session.commit()
    session.expire_all()
    return ImageSessionGenerationTaskCreationResult(
        task=session.get(ImageSessionGenerationTask, task.id) or task,
        image_session=_get_image_session_or_raise(session, image_session.id),
    )


def _reset_latest_failed_image_session_generation_task_from_submit(
    session: Session,
    *,
    image_session_id: str,
    retry_generation_task_id: str,
    prompt: str,
    size: str,
    resource_group_id: str | None,
    base_asset_ids: list[str] | None = None,
    base_asset_id: str | None = None,
    selected_reference_asset_ids: list[str] | None = None,
    generation_count: int = 1,
    tool_options: dict[str, Any] | None = None,
    generation_config_mode: str = "auto",
    generation_config_id: str | None = None,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
) -> ImageSessionGenerationTaskCreationResult:
    ensure_provider_config_bootstrapped(session)
    image_session = _get_image_session_or_raise(
        session,
        image_session_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )
    ensure_actor_can_mutate_owner(
        owner_user_id=image_session.owner_user_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        missing_message="连续生图会话不存在",
    )
    ensure_resource_usable(image_session)
    task = session.scalar(
        select(ImageSessionGenerationTask).where(
            ImageSessionGenerationTask.id == retry_generation_task_id,
            ImageSessionGenerationTask.session_id == image_session_id,
        )
    )
    if task is None:
        raise NotFoundError("生成任务不存在")
    _require_latest_failed_image_generation_task(image_session, task)

    normalized_tool_options = normalize_tool_options(tool_options)
    generation_config_selection = _authorized_image_generation_config_selection(
        session,
        image_session=image_session,
        resource_group_id=resource_group_id,
        generation_config_mode=generation_config_mode,
        generation_config_id=generation_config_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )
    (
        normalized_size,
        normalized_base_asset_ids,
        normalized_base_asset_id,
        normalized_reference_ids,
    ) = validate_generation_request(
        image_session,
        size=size,
        base_asset_ids=base_asset_ids,
        base_asset_id=base_asset_id,
        selected_reference_asset_ids=selected_reference_asset_ids,
        generation_count=generation_count,
        current_generation_task_id=task.id,
        max_generation_count=IMAGE_SESSION_GENERATION_MAX_COUNT,
    )
    task.prompt = prompt.strip()
    task.size = normalized_size
    task.base_asset_ids = normalized_base_asset_ids
    task.base_asset_id = normalized_base_asset_id
    task.selected_reference_asset_ids = normalized_reference_ids
    task.tool_options = normalized_tool_options
    task.generation_config_mode = generation_config_selection.mode
    task.requested_generation_config_id = generation_config_selection.generation_config_id
    task.used_generation_config_id = None
    task.resource_group_id = generation_config_selection.resource_group_id
    task.generation_count = generation_count
    image_session.resource_group_id = generation_config_selection.resource_group_id
    _reset_image_generation_task_for_retry(
        session,
        task=task,
        progress_phase="manual_retry_queued",
        result_generation_group_id=task.result_generation_group_id or new_id(),
    )
    logger.info(
        "连续生图手动重试任务已重置: task_id=%s session_id=%s generation_config_mode=%s "
        "requested_generation_config_id=%s used_generation_config_id=%s resource_group_id=%s "
        "attempts=%s result_generation_group_id=%s progress_phase=%s generation_count=%s",
        task.id,
        task.session_id,
        task.generation_config_mode,
        task.requested_generation_config_id,
        task.used_generation_config_id,
        task.resource_group_id,
        task.attempts,
        task.result_generation_group_id,
        task.progress_phase,
        task.generation_count,
    )
    session.expire_all()
    return ImageSessionGenerationTaskCreationResult(
        task=session.get(ImageSessionGenerationTask, task.id) or task,
        image_session=_get_image_session_or_raise(session, image_session.id),
    )


def submit_image_session_generation_task(
    session: Session,
    *,
    image_session_id: str,
    prompt: str,
    size: str,
    resource_group_id: str | None,
    base_asset_ids: list[str] | None = None,
    base_asset_id: str | None = None,
    selected_reference_asset_ids: list[str] | None = None,
    generation_count: int = 1,
    tool_options: dict[str, Any] | None = None,
    generation_config_mode: str = "auto",
    generation_config_id: str | None = None,
    retry_generation_task_id: str | None = None,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
    enqueue: Callable[[str], None] | None = None,
) -> ImageSession:
    if retry_generation_task_id:
        result = _reset_latest_failed_image_session_generation_task_from_submit(
            session,
            image_session_id=image_session_id,
            retry_generation_task_id=retry_generation_task_id,
            prompt=prompt,
            size=size,
            base_asset_ids=base_asset_ids,
            base_asset_id=base_asset_id,
            selected_reference_asset_ids=selected_reference_asset_ids,
            generation_count=generation_count,
            tool_options=tool_options,
            resource_group_id=resource_group_id,
            generation_config_mode=generation_config_mode,
            generation_config_id=generation_config_id,
            actor_user_id=actor_user_id,
            actor_is_admin=actor_is_admin,
        )
    else:
        result = create_image_session_generation_task(
            session,
            image_session_id=image_session_id,
            prompt=prompt,
            size=size,
            base_asset_ids=base_asset_ids,
            base_asset_id=base_asset_id,
            selected_reference_asset_ids=selected_reference_asset_ids,
            generation_count=generation_count,
            tool_options=tool_options,
            resource_group_id=resource_group_id,
            generation_config_mode=generation_config_mode,
            generation_config_id=generation_config_id,
            actor_user_id=actor_user_id,
            actor_is_admin=actor_is_admin,
        )
    logger.info(
        "连续生图提交生成任务: action=%s task_id=%s image_session_id=%s retry_generation_task_id=%s "
        "generation_config_mode=%s requested_generation_config_id=%s resource_group_id=%s generation_count=%s",
        "retry" if retry_generation_task_id else "new",
        result.task.id,
        image_session_id,
        retry_generation_task_id,
        result.task.generation_config_mode,
        result.task.requested_generation_config_id,
        result.task.resource_group_id,
        result.task.generation_count,
    )
    enqueue_or_mark_failed(
        result.task.id,
        enqueue=enqueue or enqueue_image_session_generation_task,
        mark_failed=lambda task_id, reason: mark_image_session_generation_task_enqueue_failed(
            session,
            task_id=task_id,
            reason=reason,
        ),
    )
    session.expire_all()
    return get_image_session_detail(
        session,
        image_session_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )


def retry_image_session_generation_task(
    session: Session,
    *,
    image_session_id: str,
    task_id: str,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
    enqueue: Callable[[str], None] | None = None,
) -> ImageSession:
    image_session = _get_image_session_or_raise(
        session,
        image_session_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )
    ensure_actor_can_mutate_owner(
        owner_user_id=image_session.owner_user_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        missing_message="连续生图会话不存在",
    )
    ensure_resource_usable(image_session)
    task = session.scalar(
        select(ImageSessionGenerationTask).where(
            ImageSessionGenerationTask.id == task_id,
            ImageSessionGenerationTask.session_id == image_session_id,
        )
    )
    if task is None:
        raise NotFoundError("生成任务不存在")
    _require_latest_failed_image_generation_task(image_session, task)
    require_generation_resource_group_for_user(
        session,
        user_id=actor_user_id,
        is_admin=actor_is_admin,
        resource_group_id=task.resource_group_id,
    )

    _reset_image_generation_task_for_retry(
        session,
        task=task,
        progress_phase="manual_retry_queued",
    )
    image_session.resource_group_id = task.resource_group_id
    image_session.updated_at = now_utc()
    session.commit()
    enqueue_or_mark_failed(
        task.id,
        enqueue=enqueue or enqueue_image_session_generation_task,
        mark_failed=lambda queued_task_id, reason: mark_image_session_generation_task_enqueue_failed(
            session,
            task_id=queued_task_id,
            reason=reason,
        ),
    )
    session.expire_all()
    return get_image_session_detail(
        session,
        image_session_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )


def cancel_image_session_generation_task(
    session: Session,
    *,
    image_session_id: str,
    task_id: str,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
) -> ImageSession:
    image_session = _get_image_session_or_raise(
        session,
        image_session_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )
    ensure_actor_can_mutate_owner(
        owner_user_id=image_session.owner_user_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        missing_message="连续生图会话不存在",
    )
    task = session.scalar(
        select(ImageSessionGenerationTask).where(
            ImageSessionGenerationTask.id == task_id,
            ImageSessionGenerationTask.session_id == image_session_id,
        )
    )
    if task is None:
        raise NotFoundError("生成任务不存在")
    if task.status == JobStatus.CANCELLED:
        return get_image_session_detail(
            session,
            image_session_id,
            actor_user_id=actor_user_id,
            actor_is_admin=actor_is_admin,
        )
    if task.status in {JobStatus.SUCCEEDED, JobStatus.FAILED}:
        raise BusinessValidationError("已结束的生成任务不能取消")

    _finish_image_generation_task(
        session,
        task=task,
        status=JobStatus.CANCELLED,
        failure_reason=IMAGE_SESSION_CANCELLED_REASON,
        result_generation_group_id=task.result_generation_group_id,
        is_retryable=False,
    )
    session.expire_all()
    return get_image_session_detail(
        session,
        image_session_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )


def mark_image_session_generation_task_enqueue_failed(session: Session, *, task_id: str, reason: str) -> None:
    task = session.get(ImageSessionGenerationTask, task_id)
    if task is None:
        return
    now = now_utc()
    task.status = JobStatus.FAILED
    task.failure_reason = reason[:1000]
    task.finished_at = now
    task.progress_phase = "enqueue_failed"
    task.progress_updated_at = task.finished_at
    task.is_retryable = True
    _touch_image_session_if_present(session, task.session_id, now=now)
    session.commit()
    publish_image_session_generation_task_notification_safely(task)


def _touch_image_session_if_present(
    session: Session,
    image_session_id: str,
    *,
    now: datetime,
    title: str | None = None,
) -> None:
    """Update the parent session timestamp without attaching a possibly stale ImageSession ORM row."""

    values: dict[str, Any] = {"updated_at": now}
    if title is not None:
        values["title"] = title
    session.execute(
        update(ImageSession)
        .where(ImageSession.id == image_session_id)
        .values(**values)
        .execution_options(synchronize_session=False)
    )


def _reset_image_generation_task_for_retry(
    session: Session,
    *,
    task: ImageSessionGenerationTask,
    progress_phase: str,
    result_generation_group_id: str | None = None,
    progress_metadata: dict[str, Any] | None = None,
) -> None:
    now = now_utc()
    task.status = JobStatus.QUEUED
    task.failure_reason = None
    task.started_at = None
    task.finished_at = None
    task.active_candidate_index = None
    task.progress_phase = progress_phase[:64]
    task.progress_updated_at = now
    task.provider_response_id = None
    task.provider_response_status = None
    task.progress_metadata = progress_metadata
    task.is_retryable = True
    if result_generation_group_id is not None:
        task.result_generation_group_id = result_generation_group_id
    _touch_image_session_if_present(session, task.session_id, now=now)
    session.commit()


def _finish_image_generation_task(
    session: Session,
    *,
    task: ImageSessionGenerationTask,
    status: JobStatus,
    failure_reason: str | None = None,
    result_generation_group_id: str | None = None,
    is_retryable: bool,
) -> None:
    now = now_utc()
    task.status = status
    task.failure_reason = failure_reason[:1000] if failure_reason else None
    task.result_generation_group_id = result_generation_group_id
    task.is_retryable = is_retryable
    task.finished_at = now
    task.active_candidate_index = None
    task.progress_updated_at = now
    if status == JobStatus.SUCCEEDED:
        task.progress_phase = "succeeded"
    elif status == JobStatus.CANCELLED:
        task.progress_phase = "cancelled"
    else:
        task.progress_phase = "failed"
    _touch_image_session_if_present(session, task.session_id, now=now)
    session.commit()
    publish_image_session_generation_task_notification_safely(task)


def _update_image_generation_task_progress(
    session: Session,
    *,
    task_id: str,
    phase: str,
    completed_candidates: int | None = None,
    active_candidate_index: int | None = None,
    provider_response_id: str | None = None,
    provider_response_status: str | None = None,
    progress_metadata: dict[str, Any] | None = None,
    result_generation_group_id: str | None = None,
    clear_provider_response: bool = False,
    commit: bool = True,
) -> None:
    task = session.get(ImageSessionGenerationTask, task_id)
    if task is not None:
        session.refresh(task, attribute_names=["status"])
    if task is None or not IMAGE_SESSION_GENERATION_TASK_CONTRACT.is_active(task.status):
        return
    task.progress_phase = phase[:64]
    task.progress_updated_at = now_utc()
    if completed_candidates is not None:
        task.completed_candidates = completed_candidates
    task.active_candidate_index = active_candidate_index
    if clear_provider_response:
        task.provider_response_id = None
        task.provider_response_status = None
    elif provider_response_id is not None:
        task.provider_response_id = provider_response_id[:255]
        if provider_response_status is not None:
            task.provider_response_status = provider_response_status[:64]
    elif provider_response_status is not None:
        task.provider_response_status = provider_response_status[:64]
    if progress_metadata is not None:
        task.progress_metadata = progress_metadata
    if result_generation_group_id is not None:
        task.result_generation_group_id = result_generation_group_id
    if commit:
        session.commit()


def _provider_progress_callback(
    session: Session,
    *,
    task_id: str | None,
    session_id: str,
    candidate_index: int,
    generation_count: int,
    completed_candidates: int,
) -> Callable[[dict[str, Any]], None] | None:
    if task_id is None:
        return None

    def callback(progress: dict[str, Any]) -> None:
        _update_image_generation_task_progress(
            session,
            task_id=task_id,
            phase="provider_polling",
            completed_candidates=completed_candidates,
            active_candidate_index=candidate_index,
            provider_response_id=progress.get("provider_response_id"),
            provider_response_status=progress.get("provider_response_status"),
            progress_metadata={
                "candidate_index": candidate_index,
                "candidate_count": generation_count,
                "provider_response": progress.get("provider_response"),
            },
        )

    callback.inspiration_one_context = {  # type: ignore[attr-defined]
        "task_id": task_id,
        "session_id": session_id,
        "candidate_index": candidate_index,
        "candidate_count": generation_count,
    }
    return callback


def _raise_if_image_generation_task_cancelled(session: Session, task_id: str | None) -> None:
    if task_id is None:
        return
    status_value = session.scalar(
        select(ImageSessionGenerationTask.status).where(ImageSessionGenerationTask.id == task_id)
    )
    if status_value == JobStatus.CANCELLED:
        raise ImageSessionGenerationCancelledError()


def _mark_image_generation_task_running(
    session: Session,
    task: ImageSessionGenerationTask,
) -> _ImageSessionGenerationTaskClaimResult:
    if not IMAGE_SESSION_GENERATION_TASK_CONTRACT.is_queued(task.status):
        return _ImageSessionGenerationTaskClaimResult(claimed=False)
    now = now_utc()
    if not generation_running_capacity_available(session, pool="image"):
        task.progress_phase = "waiting_for_capacity"
        task.progress_updated_at = now
        session.commit()
        return _ImageSessionGenerationTaskClaimResult(claimed=False, should_requeue=True)
    result = cast(
        CursorResult[Any],
        session.execute(
            update(ImageSessionGenerationTask)
            .where(
                ImageSessionGenerationTask.id == task.id,
                ImageSessionGenerationTask.status.in_(IMAGE_SESSION_GENERATION_TASK_CONTRACT.queued_statuses),
            )
            .values(
                status=IMAGE_SESSION_GENERATION_TASK_CONTRACT.running_statuses[0],
                started_at=now,
                finished_at=None,
                failure_reason=None,
                progress_phase="running",
                progress_updated_at=now,
                active_candidate_index=None,
                provider_response_id=None,
                provider_response_status=None,
                progress_metadata=None,
                attempts=ImageSessionGenerationTask.attempts + 1,
            )
        ),
    )
    if result.rowcount != 1:
        session.rollback()
        return _ImageSessionGenerationTaskClaimResult(claimed=False)
    session.commit()
    session.refresh(task)
    return _ImageSessionGenerationTaskClaimResult(claimed=True)


def _requeue_image_generation_task_after_capacity_wait(task_id: str) -> None:
    try:
        enqueue_image_session_generation_task_later(task_id, delay_ms=IMAGE_SESSION_CAPACITY_RETRY_DELAY_MS)
    except Exception:  # noqa: BLE001
        logger.exception("连续生图等待并发容量后重新入队失败: task_id=%s", task_id)


def _requeue_image_generation_task_after_generation_config_wait(task_id: str) -> None:
    try:
        enqueue_image_session_generation_task_later(task_id, delay_ms=IMAGE_SESSION_GENERATION_CONFIG_RETRY_DELAY_MS)
    except Exception:  # noqa: BLE001
        logger.exception("连续生图等待生成配置容量后重新入队失败: task_id=%s", task_id)


def _reset_image_generation_task_for_generation_config_wait(session: Session, *, task_id: str) -> None:
    task = session.get(ImageSessionGenerationTask, task_id)
    if task is None:
        return
    session.refresh(task, attribute_names=["status"])
    if IMAGE_SESSION_GENERATION_TASK_CONTRACT.is_terminal(task.status):
        return
    now = now_utc()
    task.status = JobStatus.QUEUED
    task.started_at = None
    task.finished_at = None
    task.failure_reason = None
    task.active_candidate_index = None
    task.progress_phase = "waiting_for_generation_config"
    task.progress_updated_at = now
    task.provider_response_id = None
    task.provider_response_status = None
    task.progress_metadata = {
        "generation_config_mode": task.generation_config_mode,
        "requested_generation_config_id": task.requested_generation_config_id,
        "resource_group_id": task.resource_group_id,
    }
    task.used_generation_config_id = None
    task.attempts = max(0, int(task.attempts or 0) - 1)
    task.is_retryable = True
    _touch_image_session_if_present(session, task.session_id, now=now)
    session.commit()


def _mark_image_generation_task_failed(session: Session, *, task_id: str, reason: str) -> None:
    task = session.get(ImageSessionGenerationTask, task_id)
    if task is None:
        return
    session.refresh(task, attribute_names=["status"])
    if IMAGE_SESSION_GENERATION_TASK_CONTRACT.is_terminal(task.status):
        return
    _finish_image_generation_task(
        session,
        task=task,
        status=JobStatus.FAILED,
        failure_reason=reason,
        is_retryable=True,
    )


def _handle_image_generation_task_failure(
    session: Session,
    *,
    task_id: str,
    reason: str,
    result_generation_group_id: str | None = None,
    failure_decision: ImageGenerationFailureDecision | None = None,
) -> None:
    task = session.get(ImageSessionGenerationTask, task_id)
    if task is None:
        return
    session.refresh(task, attribute_names=["status"])
    if IMAGE_SESSION_GENERATION_TASK_CONTRACT.is_terminal(task.status):
        return
    retryable = failure_decision.retryable if failure_decision is not None else True
    if not retryable:
        _finish_image_generation_task(
            session,
            task=task,
            status=JobStatus.FAILED,
            failure_reason=reason,
            result_generation_group_id=result_generation_group_id,
            is_retryable=True,
        )
        return
    if task.attempts < IMAGE_SESSION_GENERATION_MAX_ATTEMPTS:
        failed_attempt = task.attempts
        _reset_image_generation_task_for_retry(
            session,
            task=task,
            progress_phase="auto_retry_queued",
            result_generation_group_id=result_generation_group_id,
            progress_metadata={
                "last_failure_reason": reason,
                "last_failure_category": failure_decision.category if failure_decision is not None else "unknown",
                "last_failure_retryable": True,
                "retry_hint": failure_decision.retry_hint if failure_decision is not None else "retry_later",
                "auto_retry_attempt": task.attempts,
                "max_attempts": IMAGE_SESSION_GENERATION_MAX_ATTEMPTS,
            },
        )
        publish_image_session_generation_attempt_failed_notification_safely(
            task,
            reason=reason,
            attempt=failed_attempt,
            max_attempts=IMAGE_SESSION_GENERATION_MAX_ATTEMPTS,
        )
        try:
            enqueue_image_session_generation_task(task.id)
        except Exception:  # noqa: BLE001
            logger.exception("连续生图自动重试入队失败: task_id=%s", task.id)
            task = session.get(ImageSessionGenerationTask, task_id)
            if task is not None:
                _finish_image_generation_task(
                    session,
                    task=task,
                    status=JobStatus.FAILED,
                    failure_reason=QUEUE_UNAVAILABLE_DETAIL,
                    result_generation_group_id=result_generation_group_id,
                    is_retryable=True,
                )
        return

    _finish_image_generation_task(
        session,
        task=task,
        status=JobStatus.FAILED,
        failure_reason=reason,
        result_generation_group_id=result_generation_group_id,
        is_retryable=True,
    )


def _handle_image_generation_task_failure_safely(
    session: Session,
    *,
    task_id: str,
    reason: str,
    result_generation_group_id: str | None = None,
    failure_decision: ImageGenerationFailureDecision | None = None,
) -> None:
    try:
        _handle_image_generation_task_failure(
            session,
            task_id=task_id,
            reason=reason,
            result_generation_group_id=result_generation_group_id,
            failure_decision=failure_decision,
        )
    except StaleDataError:
        session.rollback()
        _handle_image_generation_task_failure(
            session,
            task_id=task_id,
            reason=reason,
            result_generation_group_id=result_generation_group_id,
            failure_decision=failure_decision,
        )


def execute_image_session_generation_task(task_id: str) -> None:
    """Worker entry: queued -> running -> succeeded/failed; duplicate terminal messages no-op."""
    session_factory = get_session_factory()
    session = session_factory()
    try:
        task = session.get(ImageSessionGenerationTask, task_id)
        if task is None:
            logger.warning("连续生图worker收到不存在的任务: task_id=%s", task_id)
            return
        logger.info(
            "连续生图worker开始处理任务: task_id=%s status=%s progress_phase=%s attempts=%s "
            "generation_config_mode=%s requested_generation_config_id=%s used_generation_config_id=%s "
            "resource_group_id=%s",
            task.id,
            task.status,
            task.progress_phase,
            task.attempts,
            task.generation_config_mode,
            task.requested_generation_config_id,
            task.used_generation_config_id,
            task.resource_group_id,
        )
        claim = _mark_image_generation_task_running(session, task)
        if not claim.claimed:
            task = session.get(ImageSessionGenerationTask, task_id)
            logger.info(
                "连续生图worker未认领任务: task_id=%s status=%s progress_phase=%s attempts=%s should_requeue=%s",
                task_id,
                task.status if task is not None else None,
                task.progress_phase if task is not None else None,
                task.attempts if task is not None else None,
                claim.should_requeue,
            )
            if claim.should_requeue:
                _requeue_image_generation_task_after_capacity_wait(task_id)
            return
        task = session.get(ImageSessionGenerationTask, task_id)
        logger.info(
            "连续生图worker已认领任务: task_id=%s status=%s progress_phase=%s attempts=%s",
            task_id,
            task.status if task is not None else None,
            task.progress_phase if task is not None else None,
            task.attempts if task is not None else None,
        )
        try:
            _execute_image_session_round_generation(
                session,
                image_session_id=task.session_id,
                prompt=task.prompt,
                size=task.size,
                base_asset_ids=task.base_asset_ids or [],
                base_asset_id=task.base_asset_id,
                selected_reference_asset_ids=task.selected_reference_asset_ids or [],
                generation_count=task.generation_count,
                tool_options=task.tool_options,
                generation_task_id=task_id,
            )
        except GenerationConfigWaitError:
            session.rollback()
            _reset_image_generation_task_for_generation_config_wait(session, task_id=task_id)
            _requeue_image_generation_task_after_generation_config_wait(task_id)
            return
        except ImageSessionGenerationExecutionError as exc:
            session.rollback()
            reason = exc.safe_reason or GENERIC_IMAGE_GENERATION_FAILURE
            if exc.completed_candidates > 0:
                template = PARTIAL_IMAGE_GENERATION_TIMEOUT if exc.timed_out else PARTIAL_IMAGE_GENERATION_FAILURE
                reason = template.format(
                    completed=exc.completed_candidates,
                    requested=exc.requested_candidates,
                )
            failed_task = session.get(ImageSessionGenerationTask, task_id)
            logger.warning(
                "连续生图任务执行失败: task_id=%s status=%s progress_phase=%s generation_config_mode=%s "
                "requested_generation_config_id=%s used_generation_config_id=%s resource_group_id=%s "
                "attempts=%s completed_candidates=%s requested_candidates=%s timed_out=%s "
                "failure_category=%s failure_reason=%s safe_reason=%s",
                task_id,
                failed_task.status if failed_task is not None else None,
                failed_task.progress_phase if failed_task is not None else None,
                failed_task.generation_config_mode if failed_task is not None else None,
                failed_task.requested_generation_config_id if failed_task is not None else None,
                failed_task.used_generation_config_id if failed_task is not None else None,
                failed_task.resource_group_id if failed_task is not None else None,
                failed_task.attempts if failed_task is not None else None,
                exc.completed_candidates,
                exc.requested_candidates,
                exc.timed_out,
                exc.failure_decision.category if exc.failure_decision is not None else None,
                reason,
                exc.safe_reason,
            )
            if failed_task is not None:
                _handle_image_generation_task_failure_safely(
                    session,
                    task_id=failed_task.id,
                    reason=reason,
                    result_generation_group_id=exc.generation_group_id,
                    failure_decision=exc.failure_decision,
                )
            return
        except ImageSessionGenerationCancelledError:
            session.rollback()
            return
        except BaseException as exc:  # noqa: BLE001
            if isinstance(exc, (KeyboardInterrupt, SystemExit)):
                raise
            session.rollback()
            failed_task = session.get(ImageSessionGenerationTask, task_id)
            logger.exception(
                "连续生图任务执行异常: task_id=%s status=%s progress_phase=%s generation_config_mode=%s "
                "requested_generation_config_id=%s used_generation_config_id=%s resource_group_id=%s "
                "attempts=%s error_type=%s",
                task_id,
                failed_task.status if failed_task is not None else None,
                failed_task.progress_phase if failed_task is not None else None,
                failed_task.generation_config_mode if failed_task is not None else None,
                failed_task.requested_generation_config_id if failed_task is not None else None,
                failed_task.used_generation_config_id if failed_task is not None else None,
                failed_task.resource_group_id if failed_task is not None else None,
                failed_task.attempts if failed_task is not None else None,
                type(exc).__name__,
            )
            _handle_image_generation_task_failure_safely(
                session,
                task_id=task_id,
                reason=GENERIC_IMAGE_GENERATION_FAILURE,
                failure_decision=classify_image_generation_failure(
                    exc,
                    generic_message=GENERIC_IMAGE_GENERATION_FAILURE,
                ),
            )
            return
    finally:
        session.close()


def attach_image_session_asset_to_inspiration(
    session: Session,
    *,
    image_session_id: str,
    asset_id: str,
    target: ATTACH_TARGET,
    inspiration_id: str | None,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
    storage: LocalStorage | None = None,
) -> Inspiration:
    """将生图结果写回灵感产物（设为参考图或替换主图）。"""
    image_session = _get_image_session_or_raise(
        session,
        image_session_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )
    ensure_actor_can_mutate_owner(
        owner_user_id=image_session.owner_user_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        missing_message="连续生图会话不存在",
    )
    ensure_resource_usable(image_session)
    asset = next((item for item in image_session.assets if item.id == asset_id), None)
    if asset is None:
        raise NotFoundError("会话图片不存在")
    if asset.kind != ImageSessionAssetKind.GENERATED_IMAGE:
        raise BusinessValidationError("只有生成结果可以写回灵感产物")
    ensure_resource_usable(asset)

    resolved_inspiration_id = inspiration_id or image_session.inspiration_id
    if not resolved_inspiration_id:
        raise BusinessValidationError("请选择要写回的灵感产物")
    inspiration = _get_inspiration_or_raise(
        session,
        resolved_inspiration_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )
    ensure_actor_can_mutate_owner(
        owner_user_id=inspiration.owner_user_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        missing_message="灵感产物不存在",
    )
    ensure_resource_usable(inspiration)
    if inspiration.owner_user_id != image_session.owner_user_id:
        raise BusinessValidationError("只能写回同一账号下的灵感产物")

    storage = storage or LocalStorage()
    source_object_key = storage.object_key_for(asset)

    if target == "reference":
        relative_path = storage.copy_to_reference_upload(
            source_object_key,
            inspiration.id,
            content_type=asset.mime_type,
        )
        storage_metadata = storage.metadata_for(relative_path)
        session.add(
            SourceAsset(
                inspiration_id=inspiration.id,
                kind=SourceAssetKind.REFERENCE_IMAGE,
                original_filename=asset.original_filename,
                mime_type=asset.mime_type,
                **storage_metadata.as_model_kwargs(),
            )
        )
    else:
        for current_source in _get_inspiration_original_assets(inspiration):
            current_source.kind = SourceAssetKind.REFERENCE_IMAGE
        session.flush()
        relative_path = storage.copy_to_inspiration_upload(
            source_object_key,
            inspiration.id,
            content_type=asset.mime_type,
        )
        storage_metadata = storage.metadata_for(relative_path)
        session.add(
            SourceAsset(
                inspiration_id=inspiration.id,
                kind=SourceAssetKind.ORIGINAL_IMAGE,
                original_filename=asset.original_filename,
                mime_type=asset.mime_type,
                **storage_metadata.as_model_kwargs(),
            )
        )
    inspiration.updated_at = now_utc()
    session.commit()
    session.expire_all()
    return _get_inspiration_or_raise(session, inspiration.id)
