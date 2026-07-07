from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from types import SimpleNamespace

from sqlalchemy import desc, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from inspiration_one_backend.application.image_sessions import get_image_session_detail
from inspiration_one_backend.application.inspiration_workflow import graph as inspiration_workflow_graph
from inspiration_one_backend.application.inspiration_workflow.artifacts import fill_reference_node
from inspiration_one_backend.application.moderation import ensure_resource_usable
from inspiration_one_backend.application.ownership import ensure_actor_can_mutate_owner
from inspiration_one_backend.application.time import now_utc
from inspiration_one_backend.domain.enums import (
    ImageSessionAssetKind,
    JobStatus,
    ResourceLibraryAssetKind,
    ResourceLibrarySourceType,
    SourceAssetKind,
    WorkflowNodeType,
)
from inspiration_one_backend.domain.errors import BusinessValidationError, NotFoundError
from inspiration_one_backend.infrastructure.db.models import (
    Deck,
    DeckSlide,
    EnhanceJob,
    ImageSession,
    ImageSessionAsset,
    Inspiration,
    PosterVariant,
    ResourceLibraryAsset,
    ResourceLibraryAssetGroup,
    ResourceLibraryGroup,
    SourceAsset,
)
from inspiration_one_backend.infrastructure.image.base import infer_extension
from inspiration_one_backend.infrastructure.storage import LocalStorage

DEFAULT_RESOURCE_LIBRARY_GROUP_NAME = "默认分组"
SOURCE_ASSET_IMAGE_KINDS = frozenset(
    {
        SourceAssetKind.ORIGINAL_IMAGE,
        SourceAssetKind.REFERENCE_IMAGE,
        SourceAssetKind.PROCESSED_INSPIRATION_IMAGE,
        SourceAssetKind.CONTEXT_IMAGE,
    }
)


@dataclass(frozen=True, slots=True)
class ResourceLibrarySaveResult:
    asset: ResourceLibraryAsset
    created: bool


@dataclass(frozen=True, slots=True)
class ResourceLibrarySourceStatus:
    source_id: str
    asset: ResourceLibraryAsset | None


@dataclass(frozen=True, slots=True)
class ResourceLibraryStorageBackfillResult:
    scanned: int
    updated: int
    skipped: int


@dataclass(frozen=True, slots=True)
class ResourceLibraryUploadImage:
    filename: str
    mime_type: str
    content: bytes


@dataclass(frozen=True, slots=True)
class _SourceImage:
    source_type: ResourceLibrarySourceType
    source_resource_id: str
    owner_user_id: str
    filename: str
    mime_type: str
    storage_object: object


def _read_resource_library_asset_content(asset: ResourceLibraryAsset, storage: LocalStorage) -> bytes:
    return _read_stored_object_content(asset, storage, missing_message="资源文件不存在")


def _read_stored_object_content(stored_object: object, storage: LocalStorage, *, missing_message: str) -> bytes:
    try:
        return storage.resolve(storage.object_key_for(stored_object)).read_bytes()
    except (OSError, ValueError) as exc:
        raise BusinessValidationError(missing_message) from exc


def _finish_temporary_source_image_session(source: _SourceImage, *, actor_user_id: str) -> bool:
    if source.source_type != ResourceLibrarySourceType.IMAGE_SESSION_ASSET:
        return False
    image_asset = source.storage_object
    image_session = getattr(image_asset, "session", None)
    if not isinstance(image_session, ImageSession):
        return False
    if not image_session.is_temporary_test or image_session.deleted_at is not None:
        return False
    image_session.deleted_at = now_utc()
    image_session.deleted_by_user_id = actor_user_id
    image_session.updated_at = image_session.deleted_at
    return True


def _group_query():
    return select(ResourceLibraryGroup).options(selectinload(ResourceLibraryGroup.owner))


def _asset_query():
    return (
        select(ResourceLibraryAsset)
        .options(
            selectinload(ResourceLibraryAsset.owner),
            selectinload(ResourceLibraryAsset.disabled_by),
            selectinload(ResourceLibraryAsset.group_links).selectinload(ResourceLibraryAssetGroup.group),
        )
        .order_by(desc(ResourceLibraryAsset.created_at), desc(ResourceLibraryAsset.id))
    )


def ensure_default_resource_library_group(session: Session, *, owner_user_id: str) -> ResourceLibraryGroup:
    group = session.scalar(
        _group_query()
        .where(
            ResourceLibraryGroup.owner_user_id == owner_user_id,
            ResourceLibraryGroup.archived_at.is_(None),
            ResourceLibraryGroup.name == DEFAULT_RESOURCE_LIBRARY_GROUP_NAME,
        )
        .order_by(ResourceLibraryGroup.created_at, ResourceLibraryGroup.id)
    )
    if group is not None:
        return group

    group = ResourceLibraryGroup(
        owner_user_id=owner_user_id,
        name=DEFAULT_RESOURCE_LIBRARY_GROUP_NAME,
        sort_order=0,
    )
    session.add(group)
    try:
        session.flush()
    except IntegrityError:
        session.rollback()
        group = session.scalar(
            _group_query().where(
                ResourceLibraryGroup.owner_user_id == owner_user_id,
                ResourceLibraryGroup.archived_at.is_(None),
                ResourceLibraryGroup.name == DEFAULT_RESOURCE_LIBRARY_GROUP_NAME,
            )
        )
        if group is None:
            raise
    return group


def list_resource_library_groups(
    session: Session,
    *,
    actor_user_id: str,
) -> list[ResourceLibraryGroup]:
    ensure_default_resource_library_group(session, owner_user_id=actor_user_id)
    session.commit()
    return list(
        session.scalars(
            _group_query()
            .where(
                ResourceLibraryGroup.owner_user_id == actor_user_id,
                ResourceLibraryGroup.archived_at.is_(None),
            )
            .order_by(ResourceLibraryGroup.sort_order, ResourceLibraryGroup.created_at, ResourceLibraryGroup.id)
        ).all()
    )


def create_resource_library_group(
    session: Session,
    *,
    name: str,
    sort_order: int = 0,
    actor_user_id: str,
) -> ResourceLibraryGroup:
    group = ResourceLibraryGroup(
        owner_user_id=actor_user_id,
        name=_normalize_group_name(name),
        sort_order=sort_order,
    )
    session.add(group)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise BusinessValidationError("资源分组名称已存在") from exc
    session.expire_all()
    return _get_group_or_raise(session, group.id, actor_user_id=actor_user_id)


def update_resource_library_group(
    session: Session,
    *,
    group_id: str,
    name: str | None = None,
    sort_order: int | None = None,
    actor_user_id: str,
) -> ResourceLibraryGroup:
    group = _get_group_or_raise(session, group_id, actor_user_id=actor_user_id)
    if name is not None:
        group.name = _normalize_group_name(name)
    if sort_order is not None:
        group.sort_order = sort_order
    group.updated_at = now_utc()
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise BusinessValidationError("资源分组名称已存在") from exc
    session.expire_all()
    return _get_group_or_raise(session, group_id, actor_user_id=actor_user_id)


def archive_resource_library_group(
    session: Session,
    *,
    group_id: str,
    actor_user_id: str,
) -> None:
    group = _get_group_or_raise(session, group_id, actor_user_id=actor_user_id)
    group.archived_at = now_utc()
    group.updated_at = group.archived_at
    session.flush()
    ensure_default_resource_library_group(session, owner_user_id=actor_user_id)
    session.commit()


def list_resource_library_assets(
    session: Session,
    *,
    group_id: str | None = None,
    actor_user_id: str,
) -> list[ResourceLibraryAsset]:
    ensure_default_resource_library_group(session, owner_user_id=actor_user_id)
    statement = _asset_query().where(
        ResourceLibraryAsset.owner_user_id == actor_user_id,
        ResourceLibraryAsset.kind == ResourceLibraryAssetKind.IMAGE,
        ResourceLibraryAsset.archived_at.is_(None),
    )
    normalized_group_id = (group_id or "").strip() or None
    if normalized_group_id is not None:
        _get_group_or_raise(session, normalized_group_id, actor_user_id=actor_user_id)
        statement = statement.join(
            ResourceLibraryAssetGroup,
            ResourceLibraryAssetGroup.asset_id == ResourceLibraryAsset.id,
        ).where(ResourceLibraryAssetGroup.group_id == normalized_group_id)
    return list(session.scalars(statement).unique().all())


def list_resource_library_source_statuses(
    session: Session,
    *,
    source_type: ResourceLibrarySourceType,
    source_ids: list[str],
    actor_user_id: str,
) -> list[ResourceLibrarySourceStatus]:
    normalized_source_ids = list(dict.fromkeys(item.strip() for item in source_ids if item.strip()))
    if not normalized_source_ids:
        return []
    assets = list(
        session.scalars(
            _asset_query().where(
                ResourceLibraryAsset.owner_user_id == actor_user_id,
                ResourceLibraryAsset.kind == ResourceLibraryAssetKind.IMAGE,
                ResourceLibraryAsset.source_type == source_type,
                ResourceLibraryAsset.source_resource_id.in_(normalized_source_ids),
                ResourceLibraryAsset.archived_at.is_(None),
            )
        )
        .unique()
        .all()
    )
    asset_by_source_id = {asset.source_resource_id: asset for asset in assets if asset.source_resource_id is not None}
    return [
        ResourceLibrarySourceStatus(source_id=source_id, asset=asset_by_source_id.get(source_id))
        for source_id in normalized_source_ids
    ]


def backfill_resource_library_asset_storage(
    session: Session,
    *,
    storage: LocalStorage | None = None,
    limit: int | None = None,
) -> ResourceLibraryStorageBackfillResult:
    """Copy legacy source-owned resource-library assets into resource-library-owned paths."""
    storage = storage or LocalStorage()
    statement = (
        _asset_query()
        .where(
            ResourceLibraryAsset.kind == ResourceLibraryAssetKind.IMAGE,
            ResourceLibraryAsset.source_type != ResourceLibrarySourceType.UPLOAD,
            ResourceLibraryAsset.archived_at.is_(None),
        )
        .order_by(None)
        .order_by(ResourceLibraryAsset.created_at, ResourceLibraryAsset.id)
    )
    if limit is not None:
        statement = statement.limit(max(1, int(limit)))
    scanned = 0
    updated = 0
    skipped = 0
    for asset in list(session.scalars(statement).unique().all()):
        scanned += 1
        if (asset.storage_path or "").startswith("resource_library/"):
            continue
        try:
            content = _read_resource_library_asset_content(asset, storage)
        except BusinessValidationError:
            skipped += 1
            continue
        relative_path = storage.save_resource_library_asset(asset.owner_user_id, asset.original_filename, content)
        for key, value in storage.metadata_for(relative_path).as_model_kwargs().items():
            setattr(asset, key, value)
        asset.updated_at = now_utc()
        updated += 1
    if updated:
        session.commit()
    return ResourceLibraryStorageBackfillResult(scanned=scanned, updated=updated, skipped=skipped)


def save_resource_library_asset_from_source(
    session: Session,
    *,
    source_type: ResourceLibrarySourceType,
    source_id: str,
    group_ids: list[str] | None,
    actor_user_id: str,
    actor_is_admin: bool = False,
    storage: LocalStorage | None = None,
) -> ResourceLibrarySaveResult:
    source = _load_source_image(
        session,
        source_type=source_type,
        source_id=source_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )
    if source.owner_user_id != actor_user_id:
        raise BusinessValidationError("只能保存自己的资源到个人资源库")

    normalized_group_ids = _normalize_group_ids(
        session,
        group_ids=group_ids,
        owner_user_id=actor_user_id,
        use_default_when_empty=False,
    )
    existing = _get_asset_by_source(
        session,
        owner_user_id=actor_user_id,
        source_type=source.source_type,
        source_resource_id=source.source_resource_id,
    )
    if existing is not None:
        ensure_resource_usable(existing)
        _add_asset_group_links(session, existing, normalized_group_ids)
        _finish_temporary_source_image_session(source, actor_user_id=actor_user_id)
        existing.updated_at = now_utc()
        session.commit()
        session.expire_all()
        return ResourceLibrarySaveResult(
            asset=_get_asset_or_raise(session, existing.id, actor_user_id=actor_user_id),
            created=False,
        )

    storage = storage or LocalStorage()
    source_content = _read_stored_object_content(source.storage_object, storage, missing_message="资源文件不存在")
    relative_path = storage.save_resource_library_asset(
        actor_user_id,
        source.filename,
        source_content,
    )
    storage_metadata = storage.metadata_for(relative_path)
    asset = ResourceLibraryAsset(
        owner_user_id=actor_user_id,
        kind=ResourceLibraryAssetKind.IMAGE,
        original_filename=source.filename,
        mime_type=source.mime_type or "application/octet-stream",
        source_type=source.source_type,
        source_resource_id=source.source_resource_id,
        **storage_metadata.as_model_kwargs(),
    )
    _finish_temporary_source_image_session(source, actor_user_id=actor_user_id)
    session.add(asset)
    try:
        session.flush()
        _replace_asset_group_links(session, asset, normalized_group_ids)
        asset_id = asset.id
        session.commit()
    except IntegrityError:
        session.rollback()
        existing = _get_asset_by_source(
            session,
            owner_user_id=actor_user_id,
            source_type=source.source_type,
            source_resource_id=source.source_resource_id,
        )
        if existing is None:
            raise
        ensure_resource_usable(existing)
        _add_asset_group_links(session, existing, normalized_group_ids)
        _finish_temporary_source_image_session(source, actor_user_id=actor_user_id)
        existing.updated_at = now_utc()
        session.commit()
        session.expire_all()
        return ResourceLibrarySaveResult(
            asset=_get_asset_or_raise(session, existing.id, actor_user_id=actor_user_id),
            created=False,
        )
    session.expire_all()
    return ResourceLibrarySaveResult(
        asset=_get_asset_or_raise(session, asset_id, actor_user_id=actor_user_id),
        created=True,
    )


def upload_resource_library_assets(
    session: Session,
    *,
    uploads: Sequence[ResourceLibraryUploadImage],
    group_ids: list[str] | None,
    actor_user_id: str,
    storage: LocalStorage | None = None,
) -> list[ResourceLibraryAsset]:
    if not uploads:
        raise BusinessValidationError("请选择要上传的图片")

    normalized_group_ids = _normalize_group_ids(
        session,
        group_ids=group_ids,
        owner_user_id=actor_user_id,
        use_default_when_empty=True,
    )
    storage = storage or LocalStorage()
    asset_ids: list[str] = []
    for upload in uploads:
        relative_path = storage.save_resource_library_asset(actor_user_id, upload.filename, upload.content)
        storage_metadata = storage.metadata_for(relative_path)
        asset = ResourceLibraryAsset(
            owner_user_id=actor_user_id,
            kind=ResourceLibraryAssetKind.IMAGE,
            original_filename=upload.filename,
            mime_type=upload.mime_type or "application/octet-stream",
            source_type=ResourceLibrarySourceType.UPLOAD,
            source_resource_id=None,
            **storage_metadata.as_model_kwargs(),
        )
        session.add(asset)
        session.flush()
        _replace_asset_group_links(session, asset, normalized_group_ids)
        asset_ids.append(asset.id)

    session.commit()
    session.expire_all()
    return [_get_asset_or_raise(session, asset_id, actor_user_id=actor_user_id) for asset_id in asset_ids]


def update_resource_library_asset_groups(
    session: Session,
    *,
    asset_id: str,
    group_ids: list[str],
    actor_user_id: str,
) -> ResourceLibraryAsset:
    asset = _get_asset_or_raise(session, asset_id, actor_user_id=actor_user_id)
    ensure_resource_usable(asset)
    normalized_group_ids = _normalize_group_ids(
        session,
        group_ids=group_ids,
        owner_user_id=actor_user_id,
        use_default_when_empty=False,
    )
    _replace_asset_group_links(session, asset, normalized_group_ids)
    asset.updated_at = now_utc()
    session.commit()
    session.expire_all()
    return _get_asset_or_raise(session, asset_id, actor_user_id=actor_user_id)


def archive_resource_library_asset(
    session: Session,
    *,
    asset_id: str,
    actor_user_id: str,
) -> None:
    asset = _get_asset_or_raise(session, asset_id, actor_user_id=actor_user_id)
    asset.archived_at = now_utc()
    asset.updated_at = asset.archived_at
    session.commit()


def copy_resource_library_asset_to_inspiration_source_asset(
    session: Session,
    *,
    asset_id: str,
    inspiration_id: str,
    actor_user_id: str,
    kind: SourceAssetKind,
    storage: LocalStorage | None = None,
    asset: ResourceLibraryAsset | None = None,
) -> SourceAsset:
    asset = asset or _get_asset_or_raise(session, asset_id, actor_user_id=actor_user_id)
    ensure_resource_usable(asset)
    if asset.kind != ResourceLibraryAssetKind.IMAGE:
        raise BusinessValidationError("只能加载图片资源")

    storage = storage or LocalStorage()
    content = _read_resource_library_asset_content(asset, storage)
    relative_path = (
        storage.save_inspiration_upload(inspiration_id, asset.original_filename, content)
        if kind == SourceAssetKind.ORIGINAL_IMAGE
        else storage.save_reference_upload(inspiration_id, asset.original_filename, content)
    )
    storage_metadata = storage.metadata_for(relative_path)
    source_asset = SourceAsset(
        inspiration_id=inspiration_id,
        kind=kind,
        original_filename=asset.original_filename,
        mime_type=asset.mime_type,
        **storage_metadata.as_model_kwargs(),
    )
    session.add(source_asset)
    session.flush()
    return source_asset


def load_resource_library_asset_to_workflow_node(
    session: Session,
    *,
    asset_id: str,
    node_id: str,
    actor_user_id: str,
    actor_is_admin: bool = False,
    storage: LocalStorage | None = None,
):
    asset = _get_asset_or_raise(session, asset_id, actor_user_id=actor_user_id)
    ensure_resource_usable(asset)
    node = inspiration_workflow_graph.get_node_or_raise(session, node_id)
    if node.node_type != WorkflowNodeType.REFERENCE_IMAGE:
        raise BusinessValidationError("只有参考图节点可以填充图片")
    workflow = inspiration_workflow_graph.get_workflow_or_raise(session, node.workflow_id)
    ensure_actor_can_mutate_owner(
        owner_user_id=workflow.inspiration.owner_user_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        missing_message="工作流节点不存在",
    )
    ensure_resource_usable(workflow.inspiration)
    source_asset = copy_resource_library_asset_to_inspiration_source_asset(
        session,
        asset_id=asset_id,
        inspiration_id=workflow.inspiration_id,
        actor_user_id=actor_user_id,
        kind=SourceAssetKind.REFERENCE_IMAGE,
        storage=storage,
        asset=asset,
    )
    fill_reference_node(node, source_asset)
    workflow.updated_at = now_utc()
    workflow.inspiration.updated_at = now_utc()
    session.commit()
    session.expire_all()
    return inspiration_workflow_graph.get_workflow_or_raise(session, workflow.id)


def load_resource_library_asset_to_image_session(
    session: Session,
    *,
    asset_id: str,
    image_session_id: str,
    actor_user_id: str,
    actor_is_admin: bool = False,
    storage: LocalStorage | None = None,
) -> ImageSession:
    asset = _get_asset_or_raise(session, asset_id, actor_user_id=actor_user_id)
    ensure_resource_usable(asset)
    image_session = get_image_session_detail(
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
    if image_session.owner_user_id != asset.owner_user_id:
        raise BusinessValidationError("只能加载自己的资源")

    storage = storage or LocalStorage()
    content = _read_resource_library_asset_content(asset, storage)
    relative_path = storage.save_image_session_reference(image_session.id, asset.original_filename, content)
    storage_metadata = storage.metadata_for(relative_path)
    session.add(
        ImageSessionAsset(
            owner_user_id=image_session.owner_user_id,
            session_id=image_session.id,
            kind=ImageSessionAssetKind.REFERENCE_UPLOAD,
            original_filename=asset.original_filename,
            mime_type=asset.mime_type,
            **storage_metadata.as_model_kwargs(),
        )
    )
    image_session.updated_at = now_utc()
    session.commit()
    session.expire_all()
    return get_image_session_detail(
        session,
        image_session.id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )


def _load_source_image(
    session: Session,
    *,
    source_type: ResourceLibrarySourceType,
    source_id: str,
    actor_user_id: str,
    actor_is_admin: bool,
) -> _SourceImage:
    if source_type == ResourceLibrarySourceType.SOURCE_ASSET:
        source_asset = session.scalar(
            select(SourceAsset)
            .options(
                selectinload(SourceAsset.inspiration).selectinload(Inspiration.owner),
                selectinload(SourceAsset.disabled_by),
            )
            .where(SourceAsset.id == source_id)
        )
        if source_asset is None:
            raise NotFoundError("源图不存在")
        ensure_actor_can_mutate_owner(
            owner_user_id=source_asset.inspiration.owner_user_id,
            actor_user_id=actor_user_id,
            actor_is_admin=actor_is_admin,
            missing_message="源图不存在",
        )
        if source_asset.kind not in SOURCE_ASSET_IMAGE_KINDS:
            raise BusinessValidationError("只能保存图片素材")
        ensure_resource_usable(source_asset)
        return _SourceImage(
            source_type=source_type,
            source_resource_id=source_asset.id,
            owner_user_id=source_asset.inspiration.owner_user_id,
            filename=source_asset.original_filename,
            mime_type=source_asset.mime_type,
            storage_object=source_asset,
        )

    if source_type == ResourceLibrarySourceType.POSTER_VARIANT:
        poster = session.scalar(
            select(PosterVariant)
            .options(
                selectinload(PosterVariant.inspiration).selectinload(Inspiration.owner),
                selectinload(PosterVariant.disabled_by),
            )
            .where(PosterVariant.id == source_id)
        )
        if poster is None:
            raise NotFoundError("海报不存在")
        ensure_actor_can_mutate_owner(
            owner_user_id=poster.inspiration.owner_user_id,
            actor_user_id=actor_user_id,
            actor_is_admin=actor_is_admin,
            missing_message="海报不存在",
        )
        ensure_resource_usable(poster)
        return _SourceImage(
            source_type=source_type,
            source_resource_id=poster.id,
            owner_user_id=poster.inspiration.owner_user_id,
            filename=f"{poster.kind.value}-{poster.id}{infer_extension(poster.mime_type)}",
            mime_type=poster.mime_type,
            storage_object=poster,
        )

    if source_type == ResourceLibrarySourceType.IMAGE_SESSION_ASSET:
        asset = session.scalar(
            select(ImageSessionAsset)
            .options(
                selectinload(ImageSessionAsset.owner),
                selectinload(ImageSessionAsset.disabled_by),
                selectinload(ImageSessionAsset.session).selectinload(ImageSession.inspiration),
            )
            .where(ImageSessionAsset.id == source_id)
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
            raise BusinessValidationError("只有生成结果可以保存到资源库")
        ensure_resource_usable(asset)
        if asset.session.is_temporary_test and asset.session.deleted_at is not None:
            raise NotFoundError("图片配置测试结果不存在")
        return _SourceImage(
            source_type=source_type,
            source_resource_id=asset.id,
            owner_user_id=asset.owner_user_id,
            filename=asset.original_filename,
            mime_type=asset.mime_type,
            storage_object=asset,
        )

    if source_type == ResourceLibrarySourceType.DECK_SLIDE:
        slide = session.get(DeckSlide, source_id)
        if slide is None or not slide.image_storage_path:
            raise NotFoundError("幻灯片不存在")
        deck = session.get(Deck, slide.deck_id)
        inspiration = session.get(Inspiration, deck.inspiration_id) if deck is not None else None
        owner_user_id = inspiration.owner_user_id if inspiration is not None else actor_user_id
        ensure_actor_can_mutate_owner(
            owner_user_id=owner_user_id,
            actor_user_id=actor_user_id,
            actor_is_admin=actor_is_admin,
            missing_message="幻灯片不存在",
        )
        storage_object = SimpleNamespace(
            storage_path=slide.image_storage_path,
            storage_object_key=slide.image_storage_object_key,
            storage_backend=slide.image_storage_backend,
            storage_bucket=slide.image_storage_bucket,
        )
        return _SourceImage(
            source_type=source_type,
            source_resource_id=slide.id,
            owner_user_id=owner_user_id,
            filename=f"deck-slide-{slide.order_index + 1}.png",
            mime_type=slide.image_mime_type or "image/png",
            storage_object=storage_object,
        )

    if source_type == ResourceLibrarySourceType.ENHANCE_JOB_RESULT:
        job = session.get(EnhanceJob, source_id)
        if job is None:
            raise NotFoundError("图片增强任务不存在")
        ensure_actor_can_mutate_owner(
            owner_user_id=job.owner_user_id,
            actor_user_id=actor_user_id,
            actor_is_admin=actor_is_admin,
            missing_message="图片增强任务不存在",
        )
        if job.status != JobStatus.SUCCEEDED:
            raise BusinessValidationError("图片增强任务尚未完成")
        manifest = job.result_manifest_json or {}
        final_ref = manifest.get("final_image_ref")
        if not isinstance(final_ref, str) or not final_ref:
            raise BusinessValidationError("拼接结果尚未上传")
        storage_object = SimpleNamespace(**LocalStorage().metadata_for(final_ref).as_model_kwargs())
        return _SourceImage(
            source_type=source_type,
            source_resource_id=job.id,
            owner_user_id=job.owner_user_id,
            filename=f"enhance-{job.id}{infer_extension(str(manifest.get('final_mime_type') or job.source_mime_type))}",
            mime_type=str(manifest.get("final_mime_type") or job.source_mime_type or "image/png"),
            storage_object=storage_object,
        )

    raise BusinessValidationError("暂不支持该资源来源")


def _get_group_or_raise(
    session: Session,
    group_id: str,
    *,
    actor_user_id: str,
) -> ResourceLibraryGroup:
    group = session.scalar(
        _group_query().where(
            ResourceLibraryGroup.id == group_id,
            ResourceLibraryGroup.owner_user_id == actor_user_id,
            ResourceLibraryGroup.archived_at.is_(None),
        )
    )
    if group is None:
        raise NotFoundError("资源分组不存在")
    return group


def _get_asset_or_raise(
    session: Session,
    asset_id: str,
    *,
    actor_user_id: str,
) -> ResourceLibraryAsset:
    asset = session.scalar(
        _asset_query().where(
            ResourceLibraryAsset.id == asset_id,
            ResourceLibraryAsset.owner_user_id == actor_user_id,
            ResourceLibraryAsset.archived_at.is_(None),
        )
    )
    if asset is None:
        raise NotFoundError("资源不存在")
    return asset


def _get_asset_by_source(
    session: Session,
    *,
    owner_user_id: str,
    source_type: ResourceLibrarySourceType,
    source_resource_id: str,
) -> ResourceLibraryAsset | None:
    return session.scalar(
        _asset_query().where(
            ResourceLibraryAsset.owner_user_id == owner_user_id,
            ResourceLibraryAsset.source_type == source_type,
            ResourceLibraryAsset.source_resource_id == source_resource_id,
            ResourceLibraryAsset.archived_at.is_(None),
        )
    )


def _normalize_group_name(name: str) -> str:
    normalized = name.strip()
    if not normalized:
        raise BusinessValidationError("资源分组名称不能为空")
    if len(normalized) > 120:
        raise BusinessValidationError("资源分组名称不能超过 120 个字符")
    return normalized


def _normalize_group_ids(
    session: Session,
    *,
    group_ids: list[str] | None,
    owner_user_id: str,
    use_default_when_empty: bool,
) -> list[str]:
    normalized = list(dict.fromkeys(item.strip() for item in group_ids or [] if item.strip()))
    if not normalized and use_default_when_empty:
        normalized = [ensure_default_resource_library_group(session, owner_user_id=owner_user_id).id]
    if not normalized:
        raise BusinessValidationError("请选择至少一个资源分组")
    groups = list(
        session.scalars(
            select(ResourceLibraryGroup).where(
                ResourceLibraryGroup.owner_user_id == owner_user_id,
                ResourceLibraryGroup.archived_at.is_(None),
                ResourceLibraryGroup.id.in_(normalized),
            )
        ).all()
    )
    found_ids = {group.id for group in groups}
    if found_ids != set(normalized):
        raise NotFoundError("资源分组不存在")
    return normalized


def _replace_asset_group_links(
    session: Session,
    asset: ResourceLibraryAsset,
    group_ids: list[str],
) -> None:
    current_by_group_id = {link.group_id: link for link in asset.group_links}
    next_group_ids = set(group_ids)
    for link in list(asset.group_links):
        if link.group_id not in next_group_ids:
            session.delete(link)
            asset.group_links.remove(link)
    for group_id in group_ids:
        if group_id not in current_by_group_id:
            link = ResourceLibraryAssetGroup(asset_id=asset.id, group_id=group_id)
            asset.group_links.append(link)
            session.add(link)


def _add_asset_group_links(
    session: Session,
    asset: ResourceLibraryAsset,
    group_ids: list[str],
) -> None:
    current_group_ids = {link.group_id for link in asset.group_links}
    for group_id in group_ids:
        if group_id in current_group_ids:
            continue
        link = ResourceLibraryAssetGroup(asset_id=asset.id, group_id=group_id)
        asset.group_links.append(link)
        session.add(link)
