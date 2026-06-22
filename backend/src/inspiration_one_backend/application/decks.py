from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from inspiration_one_backend.application.auth import require_generation_resource_group_for_user
from inspiration_one_backend.application.contracts import DeckOutlineInput, SpeakerNotesInput
from inspiration_one_backend.application.deck_generation_core import enhance_deck_slide_material
from inspiration_one_backend.application.generation_config_runtime import (
    GenerationConfigSelection,
    claim_runtime_generation_config,
    generation_failure_is_throttled,
    generation_failure_is_timeout,
    generation_failure_reason,
    release_runtime_generation_config,
)
from inspiration_one_backend.config import get_runtime_settings
from inspiration_one_backend.domain.enums import DeckMaterialSource, DeckSlideStatus, DeckStatus
from inspiration_one_backend.domain.errors import BusinessValidationError, NotFoundError
from inspiration_one_backend.infrastructure.db.models import (
    Deck,
    DeckSlide,
    Inspiration,
    ResourceLibraryAsset,
    SourceAsset,
)
from inspiration_one_backend.infrastructure.deck.pptx_assembler import build_deck_pptx
from inspiration_one_backend.infrastructure.deck.styles import DEFAULT_DECK_STYLE_KEY, is_valid_deck_style
from inspiration_one_backend.infrastructure.image.base import infer_extension
from inspiration_one_backend.infrastructure.queue import enqueue_deck_slide_generation_task
from inspiration_one_backend.infrastructure.storage import LocalStorage
from inspiration_one_backend.infrastructure.text.factory import get_text_provider

DECK_MAX_SLIDES_HARD_LIMIT = 50
DECK_DEFAULT_MAX_SLIDES = 20

__all__ = [
    "create_deck",
    "list_decks",
    "get_deck_or_raise",
    "rename_deck",
    "delete_deck",
    "replace_deck_outline",
    "set_deck_style",
    "generate_deck",
    "generate_deck_sample",
    "regenerate_deck_slide",
    "update_deck_slide",
    "reorder_deck_slides",
    "generate_deck_slide_speaker_notes",
    "set_deck_slide_material_from_source",
    "set_deck_slide_material_from_upload",
    "set_deck_style_reference_from_upload",
    "save_deck_slide_to_resource_library",
    "enhance_deck_slide_material",
    "export_deck_pptx",
]


# --- helpers ---------------------------------------------------------------


def get_deck_or_raise(session: Session, deck_id: str) -> Deck:
    deck = session.get(Deck, deck_id)
    if deck is None:
        raise NotFoundError("演示文稿不存在")
    return deck


def get_deck_slide_or_raise(session: Session, slide_id: str) -> DeckSlide:
    slide = session.get(DeckSlide, slide_id)
    if slide is None:
        raise NotFoundError("幻灯片不存在")
    return slide


def _inspiration_material_summary(inspiration: Inspiration) -> str:
    parts: list[str] = []
    if inspiration.source_note:
        parts.append(f"补充说明：{inspiration.source_note}")
    for brief in (inspiration.creative_briefs or [])[:1]:
        payload = brief.payload if isinstance(brief.payload, dict) else {}
        if payload.get("positioning"):
            parts.append(f"定位：{payload['positioning']}")
        if payload.get("audience"):
            parts.append(f"受众：{payload['audience']}")
        angles = payload.get("selling_angles") or []
        if angles:
            parts.append("卖点：" + "、".join(str(angle) for angle in angles))
    confirmed = inspiration.confirmed_copy_set
    if confirmed is not None and isinstance(confirmed.structured_payload, dict):
        summary = confirmed.structured_payload.get("summary")
        if summary:
            parts.append(f"文案摘要：{summary}")
    return "\n".join(parts)[:4000]


def _generate_outline(*, resource_group_id: str, outline_input: DeckOutlineInput, actor_user_id: str):
    claim = claim_runtime_generation_config(
        purpose="text",
        selection=GenerationConfigSelection(resource_group_id=resource_group_id),
    )
    try:
        provider = get_text_provider(claim.generation_config_id)
        outline, _model = provider.generate_outline(outline_input)
        release_runtime_generation_config(claim, success=True, user_id=actor_user_id, generated_unit_count=1)
        return outline
    except Exception as exc:  # noqa: BLE001
        release_runtime_generation_config(
            claim,
            success=False,
            failure_reason=generation_failure_reason(exc),
            timeout=generation_failure_is_timeout(exc),
            throttled=generation_failure_is_throttled(exc),
        )
        raise


# --- deck lifecycle --------------------------------------------------------


def create_deck(
    session: Session,
    *,
    inspiration_id: str,
    resource_group_id: str | None,
    actor_user_id: str,
    actor_is_admin: bool,
    source_input: str | None = None,
    title: str | None = None,
    max_slides: int | None = None,
    style_key: str | None = None,
) -> Deck:
    inspiration = session.get(Inspiration, inspiration_id)
    if inspiration is None:
        raise NotFoundError("灵感产物不存在")
    group = require_generation_resource_group_for_user(
        session,
        user_id=actor_user_id,
        is_admin=actor_is_admin,
        resource_group_id=resource_group_id,
    )
    bounded_max = max(1, min(int(max_slides or get_runtime_settings().deck_max_slides), DECK_MAX_SLIDES_HARD_LIMIT))
    outline_input = DeckOutlineInput(
        inspiration_name=inspiration.name,
        category=inspiration.category,
        source_note=inspiration.source_note,
        material_summary=_inspiration_material_summary(inspiration),
        source_input=source_input or "",
        max_slides=bounded_max,
    )
    outline = _generate_outline(resource_group_id=group.id, outline_input=outline_input, actor_user_id=actor_user_id)
    deck = Deck(
        inspiration_id=inspiration.id,
        resource_group_id=group.id,
        title=(title or outline.title or "演示文稿").strip() or "演示文稿",
        status=DeckStatus.DRAFT,
        source_input=source_input,
        style_key=style_key if is_valid_deck_style(style_key) else None,
        outline_json={"title": outline.title},
    )
    session.add(deck)
    session.flush()
    for index, slide in enumerate(outline.slides[:bounded_max]):
        session.add(
            DeckSlide(
                deck_id=deck.id,
                order_index=index,
                title=slide.title,
                points_json=list(slide.points),
                slide_status=DeckSlideStatus.PENDING,
            )
        )
    session.commit()
    session.refresh(deck)
    return deck


def list_decks(session: Session, inspiration_id: str) -> list[Deck]:
    return list(
        session.scalars(
            select(Deck).where(Deck.inspiration_id == inspiration_id).order_by(Deck.created_at.desc())
        ).all()
    )


def rename_deck(session: Session, deck_id: str, *, title: str | None, speaker_notes_enabled: bool | None) -> Deck:
    deck = get_deck_or_raise(session, deck_id)
    if title is not None:
        normalized = title.strip()
        if not normalized:
            raise BusinessValidationError("演示文稿标题不能为空")
        deck.title = normalized
    if speaker_notes_enabled is not None:
        deck.speaker_notes_enabled = speaker_notes_enabled
    session.commit()
    session.refresh(deck)
    return deck


def delete_deck(session: Session, deck_id: str) -> None:
    deck = get_deck_or_raise(session, deck_id)
    session.delete(deck)
    session.commit()


def replace_deck_outline(session: Session, deck_id: str, *, title: str | None, slides: list[dict[str, Any]]) -> Deck:
    """替换大纲页（v1：整组替换，会重置该 deck 的已生成图）。设为 outline_confirmed。"""
    deck = get_deck_or_raise(session, deck_id)
    if not slides:
        raise BusinessValidationError("大纲至少需要一页")
    for existing in list(deck.slides):
        session.delete(existing)
    session.flush()
    for index, raw in enumerate(slides):
        slide_title = str(raw.get("title", "")).strip()
        if not slide_title:
            raise BusinessValidationError("每页标题不能为空")
        points = [str(point).strip() for point in (raw.get("points") or []) if str(point).strip()]
        session.add(
            DeckSlide(
                deck_id=deck.id,
                order_index=index,
                title=slide_title,
                points_json=points,
                slide_status=DeckSlideStatus.PENDING,
            )
        )
    if title is not None and title.strip():
        deck.title = title.strip()
    deck.status = DeckStatus.OUTLINE_CONFIRMED
    session.commit()
    session.refresh(deck)
    return deck


def set_deck_style(
    session: Session,
    deck_id: str,
    *,
    style_key: str | None,
    style_reference_asset_id: str | None = None,
) -> Deck:
    deck = get_deck_or_raise(session, deck_id)
    if style_reference_asset_id:
        deck.style_reference_asset_id = style_reference_asset_id
        deck.style_key = None
    else:
        default_style = get_runtime_settings().deck_default_style
        if not is_valid_deck_style(default_style):
            default_style = DEFAULT_DECK_STYLE_KEY
        deck.style_key = style_key if is_valid_deck_style(style_key) else default_style
        deck.style_reference_asset_id = None
    deck.status = DeckStatus.STYLE_CONFIRMED
    session.commit()
    session.refresh(deck)
    return deck


def _enqueue_slides(session: Session, slides: list[DeckSlide]) -> None:
    for slide in slides:
        slide.slide_status = DeckSlideStatus.QUEUED
        slide.last_error = None
    session.commit()
    for slide in slides:
        enqueue_deck_slide_generation_task(slide.id)


def generate_deck(session: Session, deck_id: str) -> Deck:
    deck = get_deck_or_raise(session, deck_id)
    if not deck.slides:
        raise BusinessValidationError("演示文稿没有可生成的页面")
    deck.status = DeckStatus.GENERATING
    _enqueue_slides(session, list(deck.slides))
    session.refresh(deck)
    return deck


def generate_deck_sample(session: Session, deck_id: str) -> DeckSlide:
    deck = get_deck_or_raise(session, deck_id)
    if not deck.slides:
        raise BusinessValidationError("演示文稿没有可生成的页面")
    cover = deck.slides[0]
    deck.status = DeckStatus.GENERATING
    _enqueue_slides(session, [cover])
    session.refresh(cover)
    return cover


def regenerate_deck_slide(session: Session, slide_id: str) -> DeckSlide:
    slide = get_deck_slide_or_raise(session, slide_id)
    deck = get_deck_or_raise(session, slide.deck_id)
    deck.status = DeckStatus.GENERATING
    _enqueue_slides(session, [slide])
    session.refresh(slide)
    return slide


def update_deck_slide(
    session: Session,
    slide_id: str,
    *,
    title: str | None = None,
    points: list[str] | None = None,
    speaker_notes: str | None = None,
) -> DeckSlide:
    slide = get_deck_slide_or_raise(session, slide_id)
    if title is not None:
        normalized = title.strip()
        if not normalized:
            raise BusinessValidationError("幻灯片标题不能为空")
        slide.title = normalized
    if points is not None:
        slide.points_json = [str(point).strip() for point in points if str(point).strip()]
    if speaker_notes is not None:
        slide.speaker_notes = speaker_notes
    session.commit()
    session.refresh(slide)
    return slide


def reorder_deck_slides(session: Session, deck_id: str, *, slide_ids: list[str]) -> Deck:
    deck = get_deck_or_raise(session, deck_id)
    by_id = {slide.id: slide for slide in deck.slides}
    if set(slide_ids) != set(by_id):
        raise BusinessValidationError("幻灯片顺序列表必须覆盖且仅覆盖本演示文稿的所有页")
    for index, slide_id in enumerate(slide_ids):
        by_id[slide_id].order_index = index
    session.commit()
    session.refresh(deck)
    return deck


def generate_deck_slide_speaker_notes(session: Session, slide_id: str, *, actor_user_id: str) -> DeckSlide:
    slide = get_deck_slide_or_raise(session, slide_id)
    deck = get_deck_or_raise(session, slide.deck_id)
    notes_input = SpeakerNotesInput(
        deck_title=deck.title,
        slide_title=slide.title,
        points=list(slide.points_json or []),
    )
    claim = claim_runtime_generation_config(
        purpose="text",
        selection=GenerationConfigSelection(resource_group_id=deck.resource_group_id),
    )
    try:
        provider = get_text_provider(claim.generation_config_id)
        payload, _model = provider.generate_speaker_notes(notes_input)
        release_runtime_generation_config(claim, success=True, user_id=actor_user_id, generated_unit_count=1)
    except Exception as exc:  # noqa: BLE001
        release_runtime_generation_config(
            claim,
            success=False,
            failure_reason=generation_failure_reason(exc),
            timeout=generation_failure_is_timeout(exc),
            throttled=generation_failure_is_throttled(exc),
        )
        raise
    slide.speaker_notes = payload.notes
    session.commit()
    session.refresh(slide)
    return slide


def _apply_material_from_storage(
    slide: DeckSlide,
    *,
    storage_path: str | None,
    storage_backend: str | None,
    storage_bucket: str | None,
    storage_object_key: str | None,
    mime_type: str | None,
    source: DeckMaterialSource,
) -> None:
    slide.material_storage_path = storage_path
    slide.material_storage_backend = storage_backend
    slide.material_storage_bucket = storage_bucket
    slide.material_storage_object_key = storage_object_key
    slide.material_mime_type = mime_type
    slide.material_source = source


def set_deck_slide_material_from_source(
    session: Session,
    slide_id: str,
    *,
    source_type: str,
    asset_id: str,
) -> DeckSlide:
    slide = get_deck_slide_or_raise(session, slide_id)
    if source_type == DeckMaterialSource.RESOURCE_LIBRARY.value:
        asset = session.get(ResourceLibraryAsset, asset_id)
        if asset is None:
            raise NotFoundError("资源库素材不存在")
        _apply_material_from_storage(
            slide,
            storage_path=asset.storage_path,
            storage_backend=asset.storage_backend,
            storage_bucket=asset.storage_bucket,
            storage_object_key=asset.storage_object_key,
            mime_type=asset.mime_type,
            source=DeckMaterialSource.RESOURCE_LIBRARY,
        )
    elif source_type == DeckMaterialSource.SOURCE_ASSET.value:
        asset = session.get(SourceAsset, asset_id)
        if asset is None:
            raise NotFoundError("灵感素材不存在")
        _apply_material_from_storage(
            slide,
            storage_path=asset.storage_path,
            storage_backend=asset.storage_backend,
            storage_bucket=asset.storage_bucket,
            storage_object_key=asset.storage_object_key,
            mime_type=asset.mime_type,
            source=DeckMaterialSource.SOURCE_ASSET,
        )
    else:
        raise BusinessValidationError("不支持的配图来源")
    session.commit()
    session.refresh(slide)
    return slide


def set_deck_slide_material_from_upload(
    session: Session,
    slide_id: str,
    *,
    filename: str,
    content: bytes,
    mime_type: str | None,
) -> DeckSlide:
    slide = get_deck_slide_or_raise(session, slide_id)
    deck = get_deck_or_raise(session, slide.deck_id)
    storage = LocalStorage()
    suffix = infer_extension(mime_type or "image/png")
    relative = storage.save_deck_slide_material(deck.id, slide.order_index, content, suffix=suffix)
    meta = storage.metadata_for(relative).as_model_kwargs()
    _apply_material_from_storage(
        slide,
        storage_path=meta["storage_path"],
        storage_backend=meta["storage_backend"],
        storage_bucket=meta["storage_bucket"],
        storage_object_key=meta["storage_object_key"],
        mime_type=mime_type or "image/png",
        source=DeckMaterialSource.UPLOAD,
    )
    session.commit()
    session.refresh(slide)
    return slide


def set_deck_style_reference_from_upload(
    session: Session,
    deck_id: str,
    *,
    content: bytes,
    mime_type: str | None,
) -> Deck:
    deck = get_deck_or_raise(session, deck_id)
    storage = LocalStorage()
    relative = storage.save_deck_style_reference(deck.id, content, suffix=infer_extension(mime_type or "image/png"))
    deck.style_reference_asset_id = relative
    deck.style_key = None
    deck.status = DeckStatus.STYLE_CONFIRMED
    session.commit()
    session.refresh(deck)
    return deck


def save_deck_slide_to_resource_library(
    session: Session,
    slide_id: str,
    *,
    actor_user_id: str,
    actor_is_admin: bool,
) -> None:
    from inspiration_one_backend.application.resource_library import (
        ensure_default_resource_library_group,
        save_resource_library_asset_from_source,
    )
    from inspiration_one_backend.domain.enums import ResourceLibrarySourceType

    slide = get_deck_slide_or_raise(session, slide_id)
    if not slide.image_storage_path:
        raise BusinessValidationError("幻灯片尚未生成图片，无法保存到资源库")
    default_group = ensure_default_resource_library_group(session, owner_user_id=actor_user_id)
    save_resource_library_asset_from_source(
        session,
        source_type=ResourceLibrarySourceType.DECK_SLIDE,
        source_id=slide_id,
        group_ids=[default_group.id],
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )


def export_deck_pptx(session: Session, deck_id: str) -> Deck:
    deck = get_deck_or_raise(session, deck_id)
    storage = LocalStorage()
    items: list[tuple[bytes, str | None]] = []
    for slide in deck.slides:
        if not slide.image_storage_path:
            continue
        image_bytes = storage.resolve(slide.image_storage_path).read_bytes()
        notes = slide.speaker_notes if deck.speaker_notes_enabled else None
        items.append((image_bytes, notes))
    if not items:
        raise BusinessValidationError("演示文稿还没有已生成的幻灯片可导出")
    pptx_bytes = build_deck_pptx(items)
    relative = storage.save_deck_pptx(deck.id, pptx_bytes)
    meta = storage.metadata_for(relative).as_model_kwargs()
    deck.pptx_storage_path = meta["storage_path"]
    deck.pptx_storage_backend = meta["storage_backend"]
    deck.pptx_storage_bucket = meta["storage_bucket"]
    deck.pptx_storage_object_key = meta["storage_object_key"]
    deck.pptx_generated_at = datetime.now(UTC)
    session.commit()
    session.refresh(deck)
    return deck
