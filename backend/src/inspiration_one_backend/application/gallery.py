from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import timedelta
from math import gcd
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
    new_id,
    utcnow,
)
from inspiration_one_backend.infrastructure.storage import (
    InvalidStorageObjectKey,
    LocalStorage,
    StorageObjectNotFound,
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


@dataclass(frozen=True, slots=True)
class GalleryStorageBackfillResult:
    scanned: int
    updated: int
    skipped: int


_NATURAL_SORT_TOKEN_RE = re.compile(r"(\d+)")
GALLERY_TAG_NAME_MAX_LENGTH = 120
GALLERY_TAG_DESCRIPTION_MAX_LENGTH = 500
GALLERY_TAG_DELETE_LINK_BATCH_SIZE = 500
GALLERY_SOURCE_TYPE_IMAGE_SESSION_ASSET = "image_session_asset"


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
        selectinload(ImageGalleryEntry.owner),
        selectinload(ImageGalleryEntry.asset)
        .selectinload(ImageSessionAsset.session)
        .selectinload(ImageSession.inspiration),
        selectinload(ImageGalleryEntry.asset).selectinload(ImageSessionAsset.owner),
        selectinload(ImageGalleryEntry.round),
        selectinload(ImageGalleryEntry.resource_group),
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
        statement = statement.where(ImageGalleryEntry.resource_group_id == normalized_group_id)
    if include_disabled:
        return statement
    return statement.where(ImageGalleryEntry.enabled.is_(True))


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
            or_(
                ImageGalleryEntry.image_session_asset_id == image_session_asset_id,
                and_(
                    ImageGalleryEntry.source_type == GALLERY_SOURCE_TYPE_IMAGE_SESSION_ASSET,
                    ImageGalleryEntry.source_resource_id == image_session_asset_id,
                ),
            )
        )
    )


def _copy_stored_image_to_gallery(
    stored_object: object,
    storage: LocalStorage,
    *,
    owner_user_id: str,
    mime_type: str | None,
    missing_message: str,
) -> str:
    if not mime_type:
        raise BusinessValidationError(missing_message)
    try:
        return storage.copy_to_gallery_entry_image(
            storage.object_key_for(stored_object),
            owner_user_id,
            content_type=mime_type,
        )
    except (InvalidStorageObjectKey, StorageObjectNotFound, ValueError) as exc:
        raise BusinessValidationError(missing_message) from exc


def _image_size_from_provider_output(provider_output_json: dict[str, Any] | None) -> str | None:
    if not isinstance(provider_output_json, dict):
        return None
    metadata = provider_output_json.get("_inspiration_one")
    if not isinstance(metadata, dict):
        return None
    actual_size = metadata.get("actual_image_size")
    if isinstance(actual_size, str) and actual_size:
        return actual_size
    return None


def _provider_notes_from_output(provider_output_json: dict[str, Any] | None) -> list[str]:
    if not isinstance(provider_output_json, dict):
        return []
    metadata = provider_output_json.get("_inspiration_one")
    if not isinstance(metadata, dict):
        return []
    notes = metadata.get("notes")
    if not isinstance(notes, list):
        return []
    return [str(item) for item in notes if item]


def _aspect_ratio_from_size(size: str | None) -> str | None:
    if not size:
        return None
    match = re.match(r"^\s*(\d+)x(\d+)\s*$", size)
    if not match:
        return None
    width = int(match.group(1))
    height = int(match.group(2))
    if width <= 0 or height <= 0:
        return None
    divisor = gcd(width, height)
    return f"{width // divisor}:{height // divisor}"


def _asset_reference_snapshot(asset: ImageSessionAsset, *, role: str, source_kind: str) -> dict[str, Any]:
    return {
        "storage_path": asset.storage_path,
        "storage_backend": asset.storage_backend,
        "storage_bucket": asset.storage_bucket,
        "storage_object_key": asset.storage_object_key,
        "original_filename": asset.original_filename,
        "mime_type": asset.mime_type,
        "role": role,
        "source_kind": source_kind,
        "source_id": asset.id,
    }


def _reference_image_snapshots(image_session: ImageSession, round_item: ImageSessionRound) -> list[dict[str, Any]]:
    assets_by_id = {asset.id: asset for asset in image_session.assets}
    snapshots: list[dict[str, Any]] = []
    seen: set[str] = set()
    selected_reference_ids = set(round_item.selected_reference_asset_ids or [])

    def append(asset_id: str | None, *, role: str) -> None:
        if not asset_id or asset_id in seen:
            return
        asset = assets_by_id.get(asset_id)
        if asset is None:
            return
        seen.add(asset_id)
        snapshots.append(
            _asset_reference_snapshot(
                asset,
                role=role,
                source_kind=GALLERY_SOURCE_TYPE_IMAGE_SESSION_ASSET,
            )
        )

    if round_item.base_asset_id not in selected_reference_ids:
        append(round_item.base_asset_id, role="base_asset")
    for asset_id in round_item.base_asset_ids or []:
        if asset_id in selected_reference_ids:
            continue
        append(asset_id, role="base_asset")
    for asset_id in round_item.selected_reference_asset_ids or []:
        append(asset_id, role="selected_reference")
    return snapshots


def _finish_temporary_test_session(image_session: ImageSession, *, actor_user_id: str | None) -> bool:
    if not image_session.is_temporary_test or image_session.deleted_at is not None:
        return False
    image_session.deleted_at = utcnow()
    image_session.deleted_by_user_id = actor_user_id
    image_session.updated_at = image_session.deleted_at
    return True


def backfill_gallery_entry_storage(
    session: Session,
    *,
    storage: LocalStorage | None = None,
    limit: int | None = None,
) -> GalleryStorageBackfillResult:
    """Copy legacy gallery entries into gallery-owned storage paths.

    This is intentionally an application-level backfill because Alembic cannot read or write object storage safely.
    """
    storage = storage or LocalStorage()
    statement = _gallery_entry_query().order_by(None).order_by(ImageGalleryEntry.created_at, ImageGalleryEntry.id)
    if limit is not None:
        statement = statement.limit(max(1, int(limit)))
    entries = list(session.scalars(statement).all())
    scanned = 0
    updated = 0
    skipped = 0
    for entry in entries:
        scanned += 1
        changed = _backfill_gallery_entry_snapshot_fields(entry)
        if (entry.storage_path or "").startswith("gallery/"):
            if changed:
                updated += 1
            continue
        try:
            relative_path = _copy_stored_image_to_gallery(
                entry,
                storage,
                owner_user_id=entry.owner_user_id,
                mime_type=entry.mime_type,
                missing_message="画廊图片文件不存在",
            )
        except BusinessValidationError:
            if entry.asset is None:
                skipped += 1
                continue
            try:
                relative_path = _copy_stored_image_to_gallery(
                    entry.asset,
                    storage,
                    owner_user_id=entry.owner_user_id,
                    mime_type=entry.mime_type or entry.asset.mime_type,
                    missing_message="画廊图片文件不存在",
                )
            except BusinessValidationError:
                skipped += 1
                continue
        for key, value in storage.metadata_for(relative_path).as_model_kwargs().items():
            setattr(entry, key, value)
        changed = True
        if changed:
            updated += 1
    if updated:
        session.commit()
    return GalleryStorageBackfillResult(scanned=scanned, updated=updated, skipped=skipped)


def _backfill_gallery_entry_snapshot_fields(entry: ImageGalleryEntry) -> bool:
    changed = False
    asset = entry.asset
    round_item = entry.round
    if asset is not None:
        for field_name in ("original_filename", "mime_type"):
            if not getattr(entry, field_name, None):
                setattr(entry, field_name, getattr(asset, field_name))
                changed = True
    if round_item is not None:
        field_pairs = (
            ("prompt", "prompt"),
            ("size", "size"),
            ("model_name", "model_name"),
            ("provider_name", "provider_name"),
            ("prompt_version", "prompt_version"),
            ("provider_response_id", "provider_response_id"),
            ("image_generation_call_id", "image_generation_call_id"),
            ("generation_config_id", "generation_config_id"),
            ("generation_group_id", "generation_group_id"),
            ("candidate_index", "candidate_index"),
            ("candidate_count", "candidate_count"),
        )
        for entry_field, round_field in field_pairs:
            if getattr(entry, entry_field, None) is None and getattr(round_item, round_field, None) is not None:
                setattr(entry, entry_field, getattr(round_item, round_field))
                changed = True
        actual_size = _image_size_from_provider_output(round_item.provider_output_json)
        if entry.actual_size is None and actual_size is not None:
            entry.actual_size = actual_size
            changed = True
        if entry.aspect_ratio is None:
            aspect_ratio = _aspect_ratio_from_size(entry.actual_size or entry.size or round_item.size)
            if aspect_ratio is not None:
                entry.aspect_ratio = aspect_ratio
                changed = True
        if entry.provider_notes_json is None:
            entry.provider_notes_json = _provider_notes_from_output(round_item.provider_output_json)
            changed = True
        image_session = asset.session if asset is not None else round_item.session
        if entry.reference_images_json is None and image_session is not None:
            entry.reference_images_json = _reference_image_snapshots(image_session, round_item)
            changed = True
    if entry.source_type is None and entry.image_session_asset_id is not None:
        entry.source_type = GALLERY_SOURCE_TYPE_IMAGE_SESSION_ASSET
        entry.source_resource_id = entry.image_session_asset_id
        changed = True
    return changed


def save_generated_asset_to_gallery(
    session: Session,
    *,
    image_session_asset_id: str,
    tag_ids: Iterable[str] | None = None,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
    storage: LocalStorage | None = None,
) -> GallerySaveResult:
    asset = session.scalar(
        select(ImageSessionAsset)
        .options(
            selectinload(ImageSessionAsset.owner),
            selectinload(ImageSessionAsset.session).selectinload(ImageSession.inspiration),
            selectinload(ImageSessionAsset.session).selectinload(ImageSession.assets),
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
        if _finish_temporary_test_session(asset.session, actor_user_id=actor_user_id):
            session.commit()
            session.expire_all()
            existing = _get_gallery_entry_by_asset_id(session, image_session_asset_id) or existing
        return GallerySaveResult(entry=existing, created=False)
    if asset.session.is_temporary_test and asset.session.deleted_at is not None:
        raise NotFoundError("图片配置测试结果不存在")

    normalized_tag_ids = _normalize_active_gallery_tag_ids(
        session,
        tag_ids,
        require_non_empty=bool(get_runtime_settings().gallery_tag_required_on_save),
        max_selection=int(get_runtime_settings().gallery_entry_tag_max_selection),
    )

    round_item = session.scalar(select(ImageSessionRound).where(ImageSessionRound.generated_asset_id == asset.id))
    if round_item is None:
        raise NotFoundError("生成记录不存在")
    image_session = asset.session
    storage = storage or LocalStorage()
    relative_path = _copy_stored_image_to_gallery(
        asset,
        storage,
        owner_user_id=asset.owner_user_id,
        mime_type=asset.mime_type,
        missing_message="会话图片文件不存在",
    )
    storage_metadata = storage.metadata_for(relative_path)
    actual_size = _image_size_from_provider_output(round_item.provider_output_json)
    snapshot_size = actual_size or round_item.size

    entry = ImageGalleryEntry(
        owner_user_id=asset.owner_user_id,
        image_session_asset_id=asset.id,
        image_session_round_id=round_item.id,
        original_filename=asset.original_filename,
        mime_type=asset.mime_type,
        prompt=round_item.prompt,
        size=round_item.size,
        actual_size=actual_size,
        aspect_ratio=_aspect_ratio_from_size(snapshot_size),
        model_name=round_item.model_name,
        provider_name=round_item.provider_name,
        prompt_version=round_item.prompt_version,
        provider_response_id=round_item.provider_response_id,
        image_generation_call_id=round_item.image_generation_call_id,
        generation_config_id=round_item.generation_config_id,
        generation_group_id=round_item.generation_group_id,
        candidate_index=round_item.candidate_index,
        candidate_count=round_item.candidate_count,
        provider_notes_json=_provider_notes_from_output(round_item.provider_output_json),
        reference_images_json=_reference_image_snapshots(image_session, round_item),
        source_type=GALLERY_SOURCE_TYPE_IMAGE_SESSION_ASSET,
        source_resource_id=asset.id,
        resource_group_id=round_item.resource_group_id or DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        **storage_metadata.as_model_kwargs(),
    )
    _finish_temporary_test_session(image_session, actor_user_id=actor_user_id)
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
            if _finish_temporary_test_session(asset.session, actor_user_id=actor_user_id):
                session.commit()
                session.expire_all()
                existing = _get_gallery_entry_by_asset_id(session, image_session_asset_id) or existing
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
