from __future__ import annotations

import logging
from base64 import b64encode
from datetime import UTC, datetime

from sqlalchemy import update
from sqlalchemy.orm import Session

from inspiration_one_backend.application.admission import generation_running_capacity_available
from inspiration_one_backend.application.deck_generation_config import (
    resolve_deck_generation_config_selection_for_execution,
    resolve_deck_slide_size_for_execution,
)
from inspiration_one_backend.application.deck_status import derived_deck_status
from inspiration_one_backend.application.enhance.execution import (
    EnhanceExecutionRequest,
    execute_enhance_execution,
)
from inspiration_one_backend.application.enhance.jobs import (
    _result_manifest as enhance_result_manifest,
)
from inspiration_one_backend.application.enhance.jobs import (
    create_enhance_input_blob,
)
from inspiration_one_backend.application.enhance.strategy import DirectParams, run_direct_strategy
from inspiration_one_backend.application.generation_config_runtime import (
    GenerationConfigSelection,
    GenerationConfigWaitError,
    claim_runtime_generation_config,
    generation_failure_is_throttled,
    generation_failure_is_timeout,
    generation_failure_reason,
    release_runtime_generation_config,
)
from inspiration_one_backend.config import get_runtime_settings
from inspiration_one_backend.domain.enums import (
    DeckMaterialSource,
    DeckSlideStatus,
    EnhanceSourceKind,
    EnhanceStrategy,
    JobStatus,
)
from inspiration_one_backend.domain.errors import BusinessValidationError, NotFoundError
from inspiration_one_backend.infrastructure.db.models import Deck, DeckSlide, EnhanceJob, Inspiration, new_id
from inspiration_one_backend.infrastructure.db.session import get_session_factory
from inspiration_one_backend.infrastructure.deck.styles import build_slide_image_prompt
from inspiration_one_backend.infrastructure.image.base import image_dimensions_from_bytes
from inspiration_one_backend.infrastructure.image.chat_service import GeneratedChatImage, ImageChatService
from inspiration_one_backend.infrastructure.storage import LocalStorage, StorageObjectNotFound, StorageObjectTooLarge

logger = logging.getLogger(__name__)

DECK_MATERIAL_ENHANCE_SIZE = "1024x1024"
DECK_SLIDE_MAX_ATTEMPTS = 3
DECK_CAPACITY_RETRY_DELAY_MS = 2000

_CLAIMABLE_SLIDE_STATUSES = (DeckSlideStatus.PENDING, DeckSlideStatus.QUEUED)


def _now() -> datetime:
    return datetime.now(UTC)


def _storage_data_url(storage: LocalStorage, *, path: str | None, mime_type: str | None) -> str | None:
    if not path:
        return None
    try:
        raw = storage.read_bytes(path, max_bytes=get_runtime_settings().upload_max_image_bytes)
    except (StorageObjectNotFound, StorageObjectTooLarge):
        logger.warning("[Deck｜生成｜配图] 读取配图失败 path=%s", path)
        return None
    return f"data:{mime_type or 'image/png'};base64,{b64encode(raw).decode('utf-8')}"


def _storage_image_bytes(storage: LocalStorage, *, path: str | None) -> bytes | None:
    if not path:
        return None
    try:
        return storage.read_bytes(path, max_bytes=get_runtime_settings().upload_max_image_bytes)
    except (StorageObjectNotFound, StorageObjectTooLarge):
        logger.warning("[Deck｜生成｜配图] 读取配图失败 path=%s", path)
        return None


def _deck_material_enhance_size() -> tuple[int, int]:
    raw_width, raw_height = DECK_MATERIAL_ENHANCE_SIZE.lower().split("x", maxsplit=1)
    return int(raw_width), int(raw_height)


def _deck_owner_user_id(session: Session, deck: Deck) -> str | None:
    inspiration = session.get(Inspiration, deck.inspiration_id)
    return inspiration.owner_user_id if inspiration is not None else None


def _apply_image_metadata(
    slide: DeckSlide,
    storage: LocalStorage,
    relative_path: str,
    result: GeneratedChatImage,
) -> None:
    meta = storage.metadata_for(relative_path).as_model_kwargs()
    slide.image_storage_path = meta["storage_path"]
    slide.image_storage_backend = meta["storage_backend"]
    slide.image_storage_bucket = meta["storage_bucket"]
    slide.image_storage_object_key = meta["storage_object_key"]
    slide.image_mime_type = result.mime_type
    dimensions = image_dimensions_from_bytes(result.bytes_data)
    if dimensions is not None:
        slide.image_width, slide.image_height = dimensions


def _mark_slide_running(session: Session, slide: DeckSlide) -> bool:
    """容量足够时把 PENDING/QUEUED 原子翻转为 RUNNING（attempts+1）。容量不足返回 False 由调用方重排队。"""
    if slide.slide_status not in _CLAIMABLE_SLIDE_STATUSES:
        return False
    if not generation_running_capacity_available(session, pool="image"):
        session.commit()
        return False
    result = session.execute(
        update(DeckSlide)
        .where(DeckSlide.id == slide.id, DeckSlide.slide_status.in_(_CLAIMABLE_SLIDE_STATUSES))
        .values(slide_status=DeckSlideStatus.RUNNING, last_error=None, attempts=DeckSlide.attempts + 1)
    )
    if result.rowcount != 1:
        session.rollback()
        return False
    session.commit()
    session.refresh(slide)
    return True


def _reset_slide_to_queued(session: Session, slide_id: str) -> None:
    slide = session.get(DeckSlide, slide_id)
    if slide is not None and slide.slide_status == DeckSlideStatus.RUNNING:
        slide.slide_status = DeckSlideStatus.QUEUED
        session.commit()


def _mark_slide_failed(session: Session, slide_id: str, exc: BaseException) -> None:
    slide = session.get(DeckSlide, slide_id)
    if slide is None:
        return
    slide.last_error = generation_failure_reason(exc)
    if slide.attempts < DECK_SLIDE_MAX_ATTEMPTS:
        slide.slide_status = DeckSlideStatus.QUEUED
        session.commit()
        _requeue_slide_after_capacity_wait(slide_id)
    else:
        slide.slide_status = DeckSlideStatus.FAILED
        session.commit()


def _recompute_deck_status(session: Session, deck_id: str) -> None:
    deck = session.get(Deck, deck_id)
    if deck is None or not deck.slides:
        return
    deck.status = derived_deck_status(deck)
    session.commit()


def _requeue_slide_after_capacity_wait(slide_id: str) -> None:
    from inspiration_one_backend.infrastructure.queue import enqueue_deck_slide_generation_task_later

    try:
        enqueue_deck_slide_generation_task_later(slide_id, delay_ms=DECK_CAPACITY_RETRY_DELAY_MS)
    except Exception:  # noqa: BLE001
        logger.exception("[Deck｜生成｜容量等待] 重新入队失败 slide_id=%s", slide_id)


def execute_deck_slide_generation_task(slide_id: str) -> None:
    """Worker 入口：单页 整页生图。queued -> running -> completed/failed；终态消息幂等。"""
    session = get_session_factory()()
    try:
        slide = session.get(DeckSlide, slide_id)
        if slide is None:
            return
        deck = session.get(Deck, slide.deck_id)
        if deck is None:
            return
        if slide.slide_status == DeckSlideStatus.COMPLETED:
            return
        if not _mark_slide_running(session, slide):
            fresh = session.get(DeckSlide, slide_id)
            if fresh is not None and fresh.slide_status in _CLAIMABLE_SLIDE_STATUSES:
                _requeue_slide_after_capacity_wait(slide_id)
            return

        owner_user_id = _deck_owner_user_id(session, deck)
        storage = LocalStorage()
        claim = None
        try:
            image_selection = resolve_deck_generation_config_selection_for_execution(
                session,
                deck=deck,
                purpose="image",
            )
            claim = claim_runtime_generation_config(
                purpose="image",
                selection=image_selection,
            )
            service = ImageChatService(generation_config_id=claim.generation_config_id)
            material_url = _storage_data_url(
                storage, path=slide.material_storage_path, mime_type=slide.material_mime_type
            )
            style_ref_url = (
                _storage_data_url(storage, path=deck.style_reference_asset_id, mime_type="image/png")
                if deck.style_reference_asset_id
                else None
            )
            references = [url for url in (material_url, style_ref_url) if url]
            prompt = build_slide_image_prompt(
                deck_title=deck.title,
                slide_title=slide.title,
                points=list(slide.points_json or []),
                style_key=deck.style_key,
                material_reference=bool(material_url),
                style_reference=bool(style_ref_url),
            )
            result = service.generate(
                prompt=prompt,
                size=resolve_deck_slide_size_for_execution(session, deck=deck),
                manual_reference_images=references,
            )
            relative_path = storage.save_deck_slide_image(
                deck.id,
                slide.order_index,
                result.bytes_data,
                content_type=result.mime_type,
            )
            _apply_image_metadata(slide, storage, relative_path, result)
            slide.slide_status = DeckSlideStatus.COMPLETED
            slide.last_error = None
            session.commit()
            release_runtime_generation_config(claim, success=True, user_id=owner_user_id, generated_unit_count=1)
            claim = None
        except GenerationConfigWaitError:
            session.rollback()
            _reset_slide_to_queued(session, slide_id)
            _requeue_slide_after_capacity_wait(slide_id)
            return
        except Exception as exc:  # noqa: BLE001
            session.rollback()
            if claim is not None:
                release_runtime_generation_config(
                    claim,
                    success=False,
                    failure_reason=generation_failure_reason(exc),
                    timeout=generation_failure_is_timeout(exc),
                    throttled=generation_failure_is_throttled(exc),
                )
            _mark_slide_failed(session, slide_id, exc)
        finally:
            _recompute_deck_status(session, deck.id)
    finally:
        session.close()


def enhance_deck_slide_material(
    session: Session,
    *,
    slide_id: str,
    prompt: str | None = None,
    generation_config_selection: GenerationConfigSelection | None = None,
) -> DeckSlide:
    """R8：对当前低清配图做图生图增强，结果设为该页配图（material_source=enhanced），供后续整页生图使用。"""
    slide = session.get(DeckSlide, slide_id)
    if slide is None:
        raise NotFoundError("幻灯片不存在")
    deck = session.get(Deck, slide.deck_id)
    if deck is None:
        raise NotFoundError("演示文稿不存在")
    storage = LocalStorage()
    source_bytes = _storage_image_bytes(storage, path=slide.material_storage_path)
    if source_bytes is None:
        raise BusinessValidationError("当前幻灯片没有可增强的配图")

    owner_user_id = _deck_owner_user_id(session, deck)
    if owner_user_id is None:
        raise BusinessValidationError("演示文稿缺少所属用户，无法增强配图")
    source_mime_type = slide.material_mime_type or "image/png"
    source_dimensions = image_dimensions_from_bytes(source_bytes)
    if source_dimensions is None:
        raise BusinessValidationError("当前幻灯片配图不是可增强的图片")
    target_width, target_height = _deck_material_enhance_size()
    selection = generation_config_selection or resolve_deck_generation_config_selection_for_execution(
        session,
        deck=deck,
        purpose="image",
    )
    # Shared enhance execution claims runtime generation config through an independent session.
    # Commit the current deck transaction first so SQLite and other multi-session runtimes do not hold a write lock.
    session.commit()
    outcome = execute_enhance_execution(
        EnhanceExecutionRequest(
            session=session,
            owner_user_id=owner_user_id,
            strategy=EnhanceStrategy.DIRECT,
            params={"target_width": target_width, "target_height": target_height},
            generation_config_selection=selection,
            source_image_bytes=source_bytes,
            source_mime=source_mime_type,
            source_width=source_dimensions[0],
            source_height=source_dimensions[1],
            output_prefix=f"decks/{deck.id}/materials/{new_id()}",
            strategy_runner=_run_deck_material_enhance_strategy,
            storage=storage,
            reference_limit=1,
            quality_prompt=(prompt or "").strip() or None,
        )
    )
    result = outcome.result
    if result.final_image_ref is None:
        raise BusinessValidationError("图片增强结果不存在")
    final_mime_type = storage.stat(result.final_image_ref).content_type
    if not final_mime_type.startswith("image/"):
        final_mime_type = source_mime_type
    input_blob = create_enhance_input_blob(
        session,
        content=source_bytes,
        mime_type=source_mime_type,
        owner_user_id=owner_user_id,
        storage=storage,
    )
    job = EnhanceJob(
        id=new_id(),
        owner_user_id=owner_user_id,
        source_kind=EnhanceSourceKind.ENHANCE_INPUT_BLOB,
        source_ref=input_blob.id,
        source_width=input_blob.width,
        source_height=input_blob.height,
        source_mime_type=input_blob.mime_type,
        strategy=EnhanceStrategy.DIRECT,
        params_json=dict(outcome.normalized_params),
        status=JobStatus.SUCCEEDED,
        progress_completed=result.completed_call_count or 1,
        progress_total=result.completed_call_count or 1,
        progress_updated_at=_now(),
        generation_config_mode=selection.mode,
        requested_generation_config_id=selection.generation_config_id,
        used_generation_config_id=outcome.used_generation_config_id,
        resource_group_id=outcome.used_resource_group_id,
        started_at=_now(),
        finished_at=_now(),
    )
    manifest = enhance_result_manifest(job, result)
    manifest["final_mime_type"] = final_mime_type
    job.result_manifest_json = manifest
    session.add(job)

    meta = storage.metadata_for(result.final_image_ref).as_model_kwargs()
    slide.material_storage_path = meta["storage_path"]
    slide.material_storage_backend = meta["storage_backend"]
    slide.material_storage_bucket = meta["storage_bucket"]
    slide.material_storage_object_key = meta["storage_object_key"]
    slide.material_mime_type = final_mime_type
    slide.material_source = DeckMaterialSource.ENHANCED
    slide.material_enhance_job_id = job.id
    session.commit()
    session.refresh(slide)
    return slide


def _run_deck_material_enhance_strategy(ctx, params):
    return run_direct_strategy(
        ctx,
        DirectParams(
            target_width=int(params["target_width"]),
            target_height=int(params["target_height"]),
        ),
    )
