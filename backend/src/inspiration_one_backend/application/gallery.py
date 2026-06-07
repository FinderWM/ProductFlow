from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import desc, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from inspiration_one_backend.application.moderation import ensure_resource_usable, moderation_state_for_resource
from inspiration_one_backend.application.ownership import ensure_actor_can_mutate_owner
from inspiration_one_backend.domain.enums import ImageSessionAssetKind
from inspiration_one_backend.domain.errors import BusinessValidationError, NotFoundError
from inspiration_one_backend.infrastructure.db.models import (
    DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    ImageGalleryEntry,
    ImageSession,
    ImageSessionAsset,
    ImageSessionRound,
)


@dataclass(frozen=True, slots=True)
class GallerySaveResult:
    entry: ImageGalleryEntry
    created: bool


def _gallery_entry_query():
    return (
        select(ImageGalleryEntry)
        .options(
            selectinload(ImageGalleryEntry.asset)
            .selectinload(ImageSessionAsset.session)
            .selectinload(ImageSession.inspiration),
            selectinload(ImageGalleryEntry.owner),
            selectinload(ImageGalleryEntry.asset).selectinload(ImageSessionAsset.owner),
            selectinload(ImageGalleryEntry.round),
            selectinload(ImageGalleryEntry.resource_group),
            selectinload(ImageGalleryEntry.round).selectinload(ImageSessionRound.resource_group),
        )
        .order_by(desc(ImageGalleryEntry.created_at))
    )


def list_gallery_entries(
    session: Session,
    *,
    resource_group_id: str | None = None,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
) -> list[ImageGalleryEntry]:
    statement = _gallery_entry_query()
    normalized_group_id = (resource_group_id or "").strip() or None
    if normalized_group_id is not None:
        if normalized_group_id == DEFAULT_GENERATION_RESOURCE_GROUP_ID:
            statement = statement.where(
                or_(
                    ImageGalleryEntry.resource_group_id == normalized_group_id,
                    ImageGalleryEntry.resource_group_id.is_(None),
                )
            )
        else:
            statement = statement.where(ImageGalleryEntry.resource_group_id == normalized_group_id)
    entries = list(session.scalars(statement).all())
    if actor_is_admin or actor_user_id is None:
        return entries
    return [
        entry
        for entry in entries
        if entry.owner_user_id == actor_user_id or moderation_state_for_resource(entry).effective_enabled
    ]


def _get_gallery_entry_by_asset_id(session: Session, image_session_asset_id: str) -> ImageGalleryEntry | None:
    return session.scalar(
        _gallery_entry_query().where(ImageGalleryEntry.image_session_asset_id == image_session_asset_id)
    )


def save_generated_asset_to_gallery(
    session: Session,
    *,
    image_session_asset_id: str,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
) -> GallerySaveResult:
    asset = session.scalar(
        select(ImageSessionAsset)
        .options(
            selectinload(ImageSessionAsset.owner),
            selectinload(ImageSessionAsset.session).selectinload(ImageSession.inspiration),
        )
        .where(ImageSessionAsset.id == image_session_asset_id)
    )
    if asset is None:
        raise NotFoundError("会话图片不存在")
    ensure_actor_can_mutate_owner(
        owner_user_id=asset.owner_user_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        missing_message="会话图片不存在",
    )
    if asset.kind != ImageSessionAssetKind.GENERATED_IMAGE:
        raise BusinessValidationError("只有生成结果可以保存到画廊")
    ensure_resource_usable(asset)

    existing = _get_gallery_entry_by_asset_id(session, image_session_asset_id)
    if existing is not None:
        ensure_resource_usable(existing)
        return GallerySaveResult(entry=existing, created=False)

    round_item = session.scalar(select(ImageSessionRound).where(ImageSessionRound.generated_asset_id == asset.id))
    if round_item is None:
        raise NotFoundError("生成记录不存在")

    entry = ImageGalleryEntry(
        owner_user_id=asset.owner_user_id,
        image_session_asset_id=asset.id,
        image_session_round_id=round_item.id,
        resource_group_id=round_item.resource_group_id or DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    )
    session.add(entry)
    try:
        session.flush()
        entry_id = entry.id
        session.commit()
    except IntegrityError:
        session.rollback()
        existing = _get_gallery_entry_by_asset_id(session, image_session_asset_id)
        if existing is not None:
            return GallerySaveResult(entry=existing, created=False)
        raise
    session.expire_all()
    return GallerySaveResult(
        entry=session.scalar(_gallery_entry_query().where(ImageGalleryEntry.id == entry_id)) or entry,
        created=True,
    )
