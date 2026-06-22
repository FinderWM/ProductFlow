from __future__ import annotations

import logging
from base64 import b64encode
from datetime import UTC, datetime

from sqlalchemy import update
from sqlalchemy.orm import Session

from inspiration_one_backend.application.admission import generation_running_capacity_available
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
from inspiration_one_backend.domain.enums import DeckMaterialSource, DeckSlideStatus, DeckStatus
from inspiration_one_backend.domain.errors import BusinessValidationError, NotFoundError
from inspiration_one_backend.infrastructure.db.models import Deck, DeckSlide, Inspiration
from inspiration_one_backend.infrastructure.db.session import get_session_factory
from inspiration_one_backend.infrastructure.deck.styles import build_slide_image_prompt
from inspiration_one_backend.infrastructure.image.base import image_dimensions_from_bytes, infer_extension
from inspiration_one_backend.infrastructure.image.chat_service import GeneratedChatImage, ImageChatService
from inspiration_one_backend.infrastructure.storage import LocalStorage

logger = logging.getLogger(__name__)

DECK_SLIDE_SIZE = "2048x1152"
DECK_MATERIAL_ENHANCE_SIZE = "1024x1024"
DECK_SLIDE_MAX_ATTEMPTS = 3
DECK_CAPACITY_RETRY_DELAY_MS = 2000

_ACTIVE_SLIDE_STATUSES = (DeckSlideStatus.PENDING, DeckSlideStatus.QUEUED, DeckSlideStatus.RUNNING)
_CLAIMABLE_SLIDE_STATUSES = (DeckSlideStatus.PENDING, DeckSlideStatus.QUEUED)


def _now() -> datetime:
    return datetime.now(UTC)


def _storage_data_url(storage: LocalStorage, *, path: str | None, mime_type: str | None) -> str | None:
    if not path:
        return None
    try:
        raw = storage.resolve(path).read_bytes()
    except OSError:
        logger.warning("[Deck｜生成｜配图] 读取配图失败 path=%s", path)
        return None
    return f"data:{mime_type or 'image/png'};base64,{b64encode(raw).decode('utf-8')}"


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
    statuses = [slide.slide_status for slide in deck.slides]
    if all(status == DeckSlideStatus.COMPLETED for status in statuses):
        deck.status = DeckStatus.COMPLETED
    elif any(status in _ACTIVE_SLIDE_STATUSES for status in statuses):
        deck.status = DeckStatus.GENERATING
    else:
        deck.status = DeckStatus.FAILED
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
            claim = claim_runtime_generation_config(
                purpose="image",
                selection=GenerationConfigSelection(resource_group_id=deck.resource_group_id),
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
                size=get_runtime_settings().deck_slide_size or DECK_SLIDE_SIZE,
                history=[],
                manual_reference_images=references,
            )
            relative_path = storage.save_deck_slide_image(
                deck.id, slide.order_index, result.bytes_data, suffix=infer_extension(result.mime_type)
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


def enhance_deck_slide_material(session: Session, *, slide_id: str, prompt: str | None = None) -> DeckSlide:
    """R8：对当前低清配图做图生图增强，结果设为该页配图（material_source=enhanced），供后续整页生图使用。"""
    slide = session.get(DeckSlide, slide_id)
    if slide is None:
        raise NotFoundError("幻灯片不存在")
    deck = session.get(Deck, slide.deck_id)
    if deck is None:
        raise NotFoundError("演示文稿不存在")
    storage = LocalStorage()
    base = _storage_data_url(storage, path=slide.material_storage_path, mime_type=slide.material_mime_type)
    if base is None:
        raise BusinessValidationError("当前幻灯片没有可增强的配图")

    owner_user_id = _deck_owner_user_id(session, deck)
    claim = claim_runtime_generation_config(
        purpose="image",
        selection=GenerationConfigSelection(resource_group_id=deck.resource_group_id),
    )
    try:
        service = ImageChatService(generation_config_id=claim.generation_config_id)
        result = service.generate(
            prompt=(prompt or "").strip() or "在保持主体与构图不变的前提下，提升清晰度、细节与画质。",
            size=DECK_MATERIAL_ENHANCE_SIZE,
            history=[],
            manual_reference_images=[base],
        )
        relative_path = storage.save_deck_slide_material(
            deck.id, slide.order_index, result.bytes_data, suffix=infer_extension(result.mime_type)
        )
        meta = storage.metadata_for(relative_path).as_model_kwargs()
        slide.material_storage_path = meta["storage_path"]
        slide.material_storage_backend = meta["storage_backend"]
        slide.material_storage_bucket = meta["storage_bucket"]
        slide.material_storage_object_key = meta["storage_object_key"]
        slide.material_mime_type = result.mime_type
        slide.material_source = DeckMaterialSource.ENHANCED
        session.commit()
        release_runtime_generation_config(claim, success=True, user_id=owner_user_id, generated_unit_count=1)
        session.refresh(slide)
        return slide
    except Exception as exc:  # noqa: BLE001
        session.rollback()
        release_runtime_generation_config(
            claim,
            success=False,
            failure_reason=generation_failure_reason(exc),
            timeout=generation_failure_is_timeout(exc),
            throttled=generation_failure_is_throttled(exc),
        )
        raise
