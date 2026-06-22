from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import timedelta
from typing import Any

from sqlalchemy import and_, desc, func, insert, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, contains_eager, selectinload
from sqlalchemy.orm.attributes import set_committed_value

from inspiration_one_backend.application.moderation import ensure_resource_usable
from inspiration_one_backend.application.ownership import ensure_actor_can_mutate_owner
from inspiration_one_backend.config import get_runtime_settings
from inspiration_one_backend.domain.enums import ImageSessionAssetKind
from inspiration_one_backend.domain.errors import BusinessValidationError, NotFoundError
from inspiration_one_backend.infrastructure.db.models import (
    DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    GalleryTag,
    ImageGalleryEntry,
    ImageGalleryEntryTag,
    ImageGalleryEntryViewEvent,
    ImageSession,
    ImageSessionAsset,
    ImageSessionRound,
    Inspiration,
    new_id,
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


_NATURAL_SORT_TOKEN_RE = re.compile(r"(\d+)")
GALLERY_TAG_NAME_MAX_LENGTH = 120
GALLERY_TAG_DESCRIPTION_MAX_LENGTH = 500
GALLERY_TAG_DELETE_LINK_BATCH_SIZE = 500


def _natural_name_key(value: str) -> tuple[int | str, ...]:
    return tuple(
        int(part) if part.isdigit() else part.casefold()
        for part in _NATURAL_SORT_TOKEN_RE.split(value)
        if part
    )


def _gallery_tag_sort_key(tag: GalleryTag) -> tuple[int, tuple[int | str, ...], str]:
    return (-int(tag.priority or 0), _natural_name_key(tag.name), tag.id)


def _gallery_entry_tag_link_sort_key(link: ImageGalleryEntryTag) -> tuple[int, tuple[int | str, ...], str]:
    tag = link.tag
    if tag is None:
        return (0, (), link.tag_id)
    return _gallery_tag_sort_key(tag)


def _dedupe_ids(values: Iterable[str] | None) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values or []:
        normalized = str(value or "").strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
    return result


def _normalize_tag_name(value: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise BusinessValidationError("标签名称不能为空")
    if len(normalized) > GALLERY_TAG_NAME_MAX_LENGTH:
        raise BusinessValidationError(f"标签名称不能超过 {GALLERY_TAG_NAME_MAX_LENGTH} 个字符")
    return normalized


def _normalize_optional_tag_description(value: Any) -> str | None:
    normalized = "" if value is None else str(value).strip()
    if len(normalized) > GALLERY_TAG_DESCRIPTION_MAX_LENGTH:
        raise BusinessValidationError(f"标签说明不能超过 {GALLERY_TAG_DESCRIPTION_MAX_LENGTH} 个字符")
    return normalized or None


def _gallery_tag_by_id(session: Session, tag_id: str) -> GalleryTag | None:
    normalized_tag_id = str(tag_id or "").strip()
    if not normalized_tag_id:
        return None
    return session.scalar(
        select(GalleryTag).where(GalleryTag.id == normalized_tag_id, GalleryTag.deleted_at.is_(None))
    )


def _get_gallery_tag_or_raise(session: Session, tag_id: str) -> GalleryTag:
    tag = _gallery_tag_by_id(session, tag_id)
    if tag is None:
        raise NotFoundError("画廊标签不存在")
    return tag


def _active_gallery_tags_by_ids(session: Session, tag_ids: Iterable[str]) -> dict[str, GalleryTag]:
    normalized_ids = _dedupe_ids(tag_ids)
    if not normalized_ids:
        return {}
    tags = list(
        session.scalars(
            select(GalleryTag).where(
                GalleryTag.id.in_(normalized_ids),
                GalleryTag.enabled.is_(True),
                GalleryTag.deleted_at.is_(None),
            )
        ).all()
    )
    return {tag.id: tag for tag in tags}


def _normalize_active_gallery_tag_ids(
    session: Session,
    tag_ids: Iterable[str] | None,
    *,
    require_non_empty: bool,
    max_selection: int | None = None,
) -> list[str]:
    normalized_ids = _dedupe_ids(tag_ids)
    if max_selection is not None and len(normalized_ids) > max_selection:
        raise BusinessValidationError(f"最多选择 {int(max_selection)} 个画廊标签")
    if require_non_empty and not normalized_ids:
        raise BusinessValidationError("请选择画廊标签")
    tags_by_id = _active_gallery_tags_by_ids(session, normalized_ids)
    missing_ids = [tag_id for tag_id in normalized_ids if tag_id not in tags_by_id]
    if missing_ids:
        raise BusinessValidationError("画廊标签不存在或已禁用")
    return normalized_ids


def list_gallery_tags(session: Session, *, include_disabled: bool = False) -> list[GalleryTag]:
    statement = select(GalleryTag).where(GalleryTag.deleted_at.is_(None))
    if not include_disabled:
        statement = statement.where(GalleryTag.enabled.is_(True))
    tags = list(session.scalars(statement).all())
    return sorted(tags, key=_gallery_tag_sort_key)


def create_gallery_tag(
    session: Session,
    *,
    name: str,
    description: str | None = None,
    priority: int = 100,
    enabled: bool = True,
) -> GalleryTag:
    tag = GalleryTag(
        name=_normalize_tag_name(name),
        description=_normalize_optional_tag_description(description),
        priority=int(priority),
        enabled=bool(enabled),
    )
    session.add(tag)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise BusinessValidationError("标签名称已存在") from exc
    session.refresh(tag)
    return tag


def update_gallery_tag(session: Session, *, tag_id: str, values: dict[str, Any]) -> GalleryTag:
    tag = _get_gallery_tag_or_raise(session, tag_id)
    if "name" in values:
        tag.name = _normalize_tag_name(values["name"])
    if "description" in values:
        tag.description = _normalize_optional_tag_description(values["description"])
    if "priority" in values and values["priority"] is not None:
        tag.priority = int(values["priority"])
    if "enabled" in values and values["enabled"] is not None:
        tag.enabled = bool(values["enabled"])
    tag.updated_at = utcnow()
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise BusinessValidationError("标签名称已存在") from exc
    session.refresh(tag)
    return tag


def delete_gallery_tag(session: Session, *, tag_id: str) -> GalleryTag:
    tag = _get_gallery_tag_or_raise(session, tag_id)
    deleted_at = utcnow()
    tag.deleted_at = deleted_at
    tag.updated_at = deleted_at
    _soft_delete_gallery_tag_links_in_batches(session, tag_id=tag.id, deleted_at=deleted_at)
    session.commit()
    session.refresh(tag)
    return tag


def _soft_delete_gallery_tag_links_in_batches(
    session: Session,
    *,
    tag_id: str,
    deleted_at,
    batch_size: int = GALLERY_TAG_DELETE_LINK_BATCH_SIZE,
) -> None:
    normalized_batch_size = max(1, int(batch_size))
    while True:
        link_ids = list(
            session.scalars(
                select(ImageGalleryEntryTag.id)
                .where(ImageGalleryEntryTag.tag_id == tag_id, ImageGalleryEntryTag.deleted_at.is_(None))
                .order_by(ImageGalleryEntryTag.id)
                .limit(normalized_batch_size)
            ).all()
        )
        if not link_ids:
            return
        session.execute(
            update(ImageGalleryEntryTag)
            .where(ImageGalleryEntryTag.id.in_(link_ids), ImageGalleryEntryTag.tag_id == tag_id)
            .values(deleted_at=deleted_at, updated_at=deleted_at)
            .execution_options(synchronize_session=False)
        )


def _bulk_insert_gallery_entry_tags(session: Session, *, gallery_entry_id: str, tag_ids: Iterable[str]) -> None:
    normalized_ids = _dedupe_ids(tag_ids)
    if not normalized_ids:
        return
    now = utcnow()
    session.execute(
        insert(ImageGalleryEntryTag),
        [
            {
                "id": new_id(),
                "gallery_entry_id": gallery_entry_id,
                "tag_id": tag_id,
                "created_at": now,
                "updated_at": now,
            }
            for tag_id in normalized_ids
        ],
    )


def replace_gallery_entry_tags(
    session: Session,
    *,
    gallery_entry_id: str,
    tag_ids: Iterable[str] | None,
) -> ImageGalleryEntry:
    entry = session.scalar(_gallery_entry_query().where(ImageGalleryEntry.id == str(gallery_entry_id or "").strip()))
    if entry is None:
        raise NotFoundError("画廊条目不存在")
    normalized_ids = _normalize_active_gallery_tag_ids(session, tag_ids, require_non_empty=False)
    active_tag_ids = set(
        session.scalars(
            select(ImageGalleryEntryTag.tag_id).where(
                ImageGalleryEntryTag.gallery_entry_id == entry.id,
                ImageGalleryEntryTag.deleted_at.is_(None),
            )
        ).all()
    )
    desired_ids = set(normalized_ids)
    now = utcnow()
    removed_ids = active_tag_ids - desired_ids
    if removed_ids:
        session.execute(
            update(ImageGalleryEntryTag)
            .where(
                ImageGalleryEntryTag.gallery_entry_id == entry.id,
                ImageGalleryEntryTag.tag_id.in_(removed_ids),
                ImageGalleryEntryTag.deleted_at.is_(None),
            )
            .values(deleted_at=now, updated_at=now)
            .execution_options(synchronize_session=False)
        )
    added_ids = [tag_id for tag_id in normalized_ids if tag_id not in active_tag_ids]
    _bulk_insert_gallery_entry_tags(session, gallery_entry_id=entry.id, tag_ids=added_ids)
    session.commit()
    session.expire_all()
    return session.scalar(_gallery_entry_query(include_tags=True).where(ImageGalleryEntry.id == entry.id)) or entry


def _gallery_entry_query(*, include_tags: bool = False):
    options = [
        selectinload(ImageGalleryEntry.disabled_by),
        selectinload(ImageGalleryEntry.asset)
        .selectinload(ImageSessionAsset.session)
        .selectinload(ImageSession.inspiration),
        selectinload(ImageGalleryEntry.asset)
        .selectinload(ImageSessionAsset.session)
        .selectinload(ImageSession.assets)
        .selectinload(ImageSessionAsset.gallery_entry),
        selectinload(ImageGalleryEntry.asset)
        .selectinload(ImageSessionAsset.session)
        .selectinload(ImageSession.assets)
        .selectinload(ImageSessionAsset.disabled_by),
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
    ]
    if include_tags:
        options.append(selectinload(ImageGalleryEntry.tag_links).selectinload(ImageGalleryEntryTag.tag))
    return (
        select(ImageGalleryEntry)
        .options(*options)
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


def _load_gallery_tag_links_for_entries(session: Session, entries: list[ImageGalleryEntry]) -> None:
    entry_ids = [entry.id for entry in entries]
    if not entry_ids:
        return
    links = list(
        session.scalars(
            select(ImageGalleryEntryTag)
            .join(GalleryTag, ImageGalleryEntryTag.tag_id == GalleryTag.id)
            .options(contains_eager(ImageGalleryEntryTag.tag))
            .where(
                ImageGalleryEntryTag.gallery_entry_id.in_(entry_ids),
                ImageGalleryEntryTag.deleted_at.is_(None),
                GalleryTag.deleted_at.is_(None),
                GalleryTag.enabled.is_(True),
            )
        ).all()
    )
    links_by_entry_id: dict[str, list[ImageGalleryEntryTag]] = {entry_id: [] for entry_id in entry_ids}
    for link in links:
        links_by_entry_id.setdefault(link.gallery_entry_id, []).append(link)
    for entry in entries:
        entry_links = links_by_entry_id.get(entry.id, [])
        entry_links.sort(key=_gallery_entry_tag_link_sort_key)
        set_committed_value(entry, "tag_links", entry_links)


def list_gallery_entries(
    session: Session,
    *,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
    include_disabled: bool = False,
    resource_group_id: str | None = None,
    tag_ids: Iterable[str] | None = None,
    limit: int | None = None,
    offset: int = 0,
) -> GalleryEntryListResult:
    raw_tag_ids = _dedupe_ids(tag_ids)
    max_filter_selection = int(get_runtime_settings().gallery_tag_filter_max_selection)
    if len(raw_tag_ids) > max_filter_selection:
        raise BusinessValidationError(f"最多选择 {max_filter_selection} 个画廊标签")
    active_tags_by_id = _active_gallery_tags_by_ids(session, raw_tag_ids)
    active_tag_ids = [tag_id for tag_id in raw_tag_ids if tag_id in active_tags_by_id]
    if raw_tag_ids and not active_tag_ids:
        return GalleryEntryListResult(items=[], view_counts={}, total=0, has_more=False, next_offset=None)

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
    if raw_tag_ids:
        match_counts = (
            select(
                ImageGalleryEntryTag.gallery_entry_id.label("gallery_entry_id"),
                func.count(func.distinct(ImageGalleryEntryTag.tag_id)).label("tag_match_count"),
            )
            .where(
                ImageGalleryEntryTag.deleted_at.is_(None),
                ImageGalleryEntryTag.tag_id.in_(active_tag_ids),
            )
            .group_by(ImageGalleryEntryTag.gallery_entry_id)
            .subquery()
        )
        statement = (
            statement.join(match_counts, ImageGalleryEntry.id == match_counts.c.gallery_entry_id)
            .order_by(None)
            .order_by(desc(match_counts.c.tag_match_count), desc(ImageGalleryEntry.created_at))
        )
        count_statement = count_statement.join(match_counts, ImageGalleryEntry.id == match_counts.c.gallery_entry_id)
    total = int(session.scalar(count_statement) or 0)

    start = max(offset, 0)
    if limit is None:
        page = list(session.scalars(statement.offset(start)).all())
        _load_gallery_tag_links_for_entries(session, page)
        return GalleryEntryListResult(
            items=page,
            view_counts=_view_counts_for_entries(session, [entry.id for entry in page]),
            total=total,
            has_more=False,
            next_offset=None,
        )

    end = start + limit
    page = list(session.scalars(statement.offset(start).limit(limit)).all())
    _load_gallery_tag_links_for_entries(session, page)
    return GalleryEntryListResult(
        items=page,
        view_counts=_view_counts_for_entries(session, [entry.id for entry in page]),
        total=total,
        has_more=total > end,
        next_offset=end if total > end else None,
    )


def _get_gallery_entry_by_asset_id(session: Session, image_session_asset_id: str) -> ImageGalleryEntry | None:
    return session.scalar(
        _gallery_entry_query(include_tags=True).where(
            ImageGalleryEntry.image_session_asset_id == image_session_asset_id
        )
    )


def save_generated_asset_to_gallery(
    session: Session,
    *,
    image_session_asset_id: str,
    tag_ids: Iterable[str] | None = None,
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

    normalized_tag_ids = _normalize_active_gallery_tag_ids(
        session,
        tag_ids,
        require_non_empty=bool(get_runtime_settings().gallery_tag_required_on_save),
        max_selection=int(get_runtime_settings().gallery_entry_tag_max_selection),
    )

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
        _bulk_insert_gallery_entry_tags(session, gallery_entry_id=entry.id, tag_ids=normalized_tag_ids)
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
        entry=session.scalar(_gallery_entry_query(include_tags=True).where(ImageGalleryEntry.id == entry_id)) or entry,
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
