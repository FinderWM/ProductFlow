from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import and_, desc, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from inspiration_one_backend.application.moderation import ensure_resource_usable
from inspiration_one_backend.application.ownership import ensure_actor_can_mutate_owner
from inspiration_one_backend.config import get_runtime_settings
from inspiration_one_backend.domain.enums import ImageSessionAssetKind
from inspiration_one_backend.domain.errors import BusinessValidationError, NotFoundError
from inspiration_one_backend.infrastructure.db.models import (
    DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    ImageGalleryEntry,
    ImageGalleryEntryViewEvent,
    ImageSession,
    ImageSessionAsset,
    ImageSessionRound,
    Inspiration,
    utcnow,
)


@dataclass(frozen=True, slots=True)
class GallerySaveResult:
    entry: ImageGalleryEntry
    created: bool


@dataclass(frozen=True, slots=True)
class GalleryViewResult:
    entry_id: str
    view_count: int
    counted: bool


@dataclass(frozen=True, slots=True)
class GalleryEntryListResult:
    items: list[ImageGalleryEntry]
    view_counts: dict[str, int]
    total: int
    has_more: bool
    next_offset: int | None


def _gallery_entry_query():
    return (
        select(ImageGalleryEntry)
        .options(
            selectinload(ImageGalleryEntry.disabled_by),
            selectinload(ImageGalleryEntry.asset)
            .selectinload(ImageSessionAsset.session)
            .selectinload(ImageSession.inspiration),
            selectinload(ImageGalleryEntry.asset)
            .selectinload(ImageSessionAsset.session)
            .selectinload(ImageSession.disabled_by),
            selectinload(ImageGalleryEntry.asset)
            .selectinload(ImageSessionAsset.session)
            .selectinload(ImageSession.inspiration)
            .selectinload(Inspiration.disabled_by),
            selectinload(ImageGalleryEntry.owner),
            selectinload(ImageGalleryEntry.asset).selectinload(ImageSessionAsset.owner),
            selectinload(ImageGalleryEntry.asset).selectinload(ImageSessionAsset.disabled_by),
            selectinload(ImageGalleryEntry.round),
            selectinload(ImageGalleryEntry.resource_group),
            selectinload(ImageGalleryEntry.round).selectinload(ImageSessionRound.resource_group),
        )
        .order_by(desc(ImageGalleryEntry.created_at))
    )


def _apply_gallery_entry_list_filters(
    statement,
    *,
    resource_group_id: str | None,
    include_disabled: bool,
):
    normalized_group_id = (resource_group_id or "").strip() or None
    if normalized_group_id is not None:
        statement = statement.outerjoin(
            ImageSessionRound,
            ImageGalleryEntry.image_session_round_id == ImageSessionRound.id,
        ).where(
            or_(
                ImageGalleryEntry.resource_group_id == normalized_group_id,
                and_(
                    ImageGalleryEntry.resource_group_id.is_(None),
                    ImageSessionRound.resource_group_id == normalized_group_id,
                ),
            )
        )
    if include_disabled:
        return statement
    return (
        statement.join(
            ImageSessionAsset,
            ImageGalleryEntry.image_session_asset_id == ImageSessionAsset.id,
        )
        .join(
            ImageSession,
            ImageSessionAsset.session_id == ImageSession.id,
        )
        .outerjoin(
            Inspiration,
            ImageSession.inspiration_id == Inspiration.id,
        )
        .where(
            ImageGalleryEntry.enabled.is_(True),
            ImageSessionAsset.enabled.is_(True),
            ImageSession.enabled.is_(True),
            or_(ImageSession.inspiration_id.is_(None), Inspiration.enabled.is_(True)),
        )
    )


def _view_counts_for_entries(session: Session, entry_ids: list[str]) -> dict[str, int]:
    if not entry_ids:
        return {}
    rows = session.execute(
        select(
            ImageGalleryEntryViewEvent.gallery_entry_id,
            func.count(ImageGalleryEntryViewEvent.id),
        )
        .where(ImageGalleryEntryViewEvent.gallery_entry_id.in_(entry_ids))
        .group_by(ImageGalleryEntryViewEvent.gallery_entry_id)
    ).all()
    counts = {entry_id: 0 for entry_id in entry_ids}
    for entry_id, count in rows:
        counts[entry_id] = int(count)
    return counts


def list_gallery_entries(
    session: Session,
    *,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
    include_disabled: bool = False,
    resource_group_id: str | None = None,
    limit: int | None = None,
    offset: int = 0,
) -> GalleryEntryListResult:
    statement = _apply_gallery_entry_list_filters(
        _gallery_entry_query(),
        resource_group_id=resource_group_id,
        include_disabled=include_disabled,
    )
    count_statement = _apply_gallery_entry_list_filters(
        select(func.count(ImageGalleryEntry.id)),
        resource_group_id=resource_group_id,
        include_disabled=include_disabled,
    )
    total = int(session.scalar(count_statement) or 0)

    start = max(offset, 0)
    if limit is None:
        page = list(session.scalars(statement.offset(start)).all())
        return GalleryEntryListResult(
            items=page,
            view_counts=_view_counts_for_entries(session, [entry.id for entry in page]),
            total=total,
            has_more=False,
            next_offset=None,
        )

    end = start + limit
    page = list(session.scalars(statement.offset(start).limit(limit)).all())
    return GalleryEntryListResult(
        items=page,
        view_counts=_view_counts_for_entries(session, [entry.id for entry in page]),
        total=total,
        has_more=total > end,
        next_offset=end if total > end else None,
    )


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


def record_gallery_entry_view(
    session: Session,
    *,
    gallery_entry_id: str,
    viewer_key: str,
) -> GalleryViewResult:
    """记录画廊条目点击：同一访问者在去重窗口内重复点击只计一次。"""
    entry = session.scalar(select(ImageGalleryEntry).where(ImageGalleryEntry.id == gallery_entry_id))
    if entry is None:
        raise NotFoundError("画廊条目不存在")
    ensure_resource_usable(entry)

    window_minutes = int(get_runtime_settings().gallery_view_dedup_window_minutes)
    window_start = utcnow() - timedelta(minutes=window_minutes)
    recent = session.scalar(
        select(ImageGalleryEntryViewEvent.id)
        .where(
            ImageGalleryEntryViewEvent.gallery_entry_id == gallery_entry_id,
            ImageGalleryEntryViewEvent.viewer_key == viewer_key,
            ImageGalleryEntryViewEvent.viewed_at >= window_start,
        )
        .limit(1)
    )
    counted = recent is None
    if counted:
        session.add(
            ImageGalleryEntryViewEvent(
                gallery_entry_id=gallery_entry_id,
                viewer_key=viewer_key,
            )
        )
        session.commit()

    view_count = session.scalar(
        select(func.count(ImageGalleryEntryViewEvent.id)).where(
            ImageGalleryEntryViewEvent.gallery_entry_id == gallery_entry_id
        )
    )
    return GalleryViewResult(entry_id=gallery_entry_id, view_count=int(view_count or 0), counted=counted)
