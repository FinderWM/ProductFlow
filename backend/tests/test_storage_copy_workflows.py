from __future__ import annotations

from pathlib import Path
from typing import Any

from inspiration_one_backend.application.gallery import backfill_gallery_entry_storage, save_generated_asset_to_gallery
from inspiration_one_backend.application.image_sessions import attach_image_session_asset_to_inspiration
from inspiration_one_backend.application.inspiration_workflow.artifacts import materialize_poster_variant_source_asset
from inspiration_one_backend.application.resource_library import (
    backfill_resource_library_asset_storage,
    copy_resource_library_asset_to_inspiration_source_asset,
    load_resource_library_asset_to_image_session,
    save_resource_library_asset_from_source,
)
from inspiration_one_backend.domain.enums import (
    ImageSessionAssetKind,
    PosterKind,
    ResourceLibraryAssetKind,
    ResourceLibrarySourceType,
    SourceAssetKind,
)
from inspiration_one_backend.infrastructure.db.models import (
    ADMIN_USER_ID,
    ImageGalleryEntry,
    ImageSession,
    ImageSessionAsset,
    ImageSessionRound,
    Inspiration,
    InspirationWorkflow,
    PosterVariant,
    ResourceLibraryAsset,
    ResourceLibraryGroup,
    SourceAsset,
)
from inspiration_one_backend.infrastructure.storage import LocalStorage


class _CopyOnlyStorage:
    def __init__(self) -> None:
        self.inner = LocalStorage()
        self.copy_calls: list[tuple[str, str, str]] = []

    def __getattr__(self, name: str) -> Any:
        return getattr(self.inner, name)

    def read_bytes(self, *args: Any, **kwargs: Any) -> bytes:
        del args, kwargs
        raise AssertionError("纯对象复制流程不应读取源对象字节")

    def _copy(self, method_name: str, source_object_key: str, *target_args: str, content_type: str) -> str:
        target_key = getattr(self.inner, method_name)(
            source_object_key,
            *target_args,
            content_type=content_type,
        )
        self.copy_calls.append((method_name, source_object_key, target_key))
        return target_key

    def copy_to_gallery_entry_image(
        self,
        source_object_key: str,
        owner_user_id: str,
        *,
        content_type: str,
    ) -> str:
        return self._copy(
            "copy_to_gallery_entry_image",
            source_object_key,
            owner_user_id,
            content_type=content_type,
        )

    def copy_to_resource_library_asset(
        self,
        source_object_key: str,
        owner_user_id: str,
        *,
        content_type: str,
    ) -> str:
        return self._copy(
            "copy_to_resource_library_asset",
            source_object_key,
            owner_user_id,
            content_type=content_type,
        )

    def copy_to_image_session_reference(
        self,
        source_object_key: str,
        session_id: str,
        *,
        content_type: str,
    ) -> str:
        return self._copy(
            "copy_to_image_session_reference",
            source_object_key,
            session_id,
            content_type=content_type,
        )

    def copy_to_reference_upload(
        self,
        source_object_key: str,
        inspiration_id: str,
        *,
        content_type: str,
    ) -> str:
        return self._copy(
            "copy_to_reference_upload",
            source_object_key,
            inspiration_id,
            content_type=content_type,
        )

    def copy_to_inspiration_upload(
        self,
        source_object_key: str,
        inspiration_id: str,
        *,
        content_type: str,
    ) -> str:
        return self._copy(
            "copy_to_inspiration_upload",
            source_object_key,
            inspiration_id,
            content_type=content_type,
        )


def _put_source(storage: _CopyOnlyStorage, object_key: str, content: bytes = b"image-bytes") -> dict[str, str | None]:
    storage.inner.put_bytes(object_key, content, content_type="image/png")
    return storage.inner.metadata_for(object_key).as_model_kwargs()


def _assert_independent_copy(storage: _CopyOnlyStorage, source_key: str, target_key: str) -> None:
    assert source_key != target_key
    assert storage.inner.read_bytes(source_key, max_bytes=1024) == b"image-bytes"
    assert storage.inner.read_bytes(target_key, max_bytes=1024) == b"image-bytes"


def test_gallery_save_copies_generated_asset_without_reading_bytes(configured_env: Path, db_session) -> None:
    del configured_env
    storage = _CopyOnlyStorage()
    image_session = ImageSession(owner_user_id=ADMIN_USER_ID, title="画廊复制")
    db_session.add(image_session)
    db_session.flush()
    source_key = f"image_sessions/{image_session.id}/generated/source.png"
    asset = ImageSessionAsset(
        owner_user_id=ADMIN_USER_ID,
        session_id=image_session.id,
        kind=ImageSessionAssetKind.GENERATED_IMAGE,
        original_filename="source.png",
        mime_type="image/png",
        **_put_source(storage, source_key),
    )
    db_session.add(asset)
    db_session.flush()
    db_session.add(
        ImageSessionRound(
            session_id=image_session.id,
            prompt="复制到画廊",
            assistant_message="ok",
            size="1024x1024",
            model_name="mock",
            provider_name="mock",
            prompt_version="v1",
            generated_asset_id=asset.id,
        )
    )
    db_session.commit()

    result = save_generated_asset_to_gallery(
        db_session,
        image_session_asset_id=asset.id,
        actor_user_id=ADMIN_USER_ID,
        actor_is_admin=True,
        storage=storage,
    )

    assert result.created is True
    assert len(storage.copy_calls) == 1
    operation, copied_source_key, target_key = storage.copy_calls[0]
    assert operation == "copy_to_gallery_entry_image"
    assert copied_source_key == source_key
    assert target_key.startswith(f"gallery/{ADMIN_USER_ID}/images/")
    assert result.entry.storage_object_key == target_key
    _assert_independent_copy(storage, source_key, target_key)


def test_resource_library_copy_flows_never_materialize_source_bytes(configured_env: Path, db_session) -> None:
    del configured_env
    storage = _CopyOnlyStorage()
    source_inspiration = Inspiration(owner_user_id=ADMIN_USER_ID, name="资源库来源")
    target_reference_inspiration = Inspiration(owner_user_id=ADMIN_USER_ID, name="参考图目标")
    target_source_inspiration = Inspiration(owner_user_id=ADMIN_USER_ID, name="主图目标")
    group = ResourceLibraryGroup(owner_user_id=ADMIN_USER_ID, name="对象复制")
    db_session.add_all([source_inspiration, target_reference_inspiration, target_source_inspiration, group])
    db_session.flush()
    source_key = f"inspirations/{source_inspiration.id}/source/original.png"
    source_asset = SourceAsset(
        inspiration_id=source_inspiration.id,
        kind=SourceAssetKind.ORIGINAL_IMAGE,
        original_filename="original.png",
        mime_type="image/png",
        **_put_source(storage, source_key),
    )
    db_session.add(source_asset)
    db_session.commit()

    saved = save_resource_library_asset_from_source(
        db_session,
        source_type=ResourceLibrarySourceType.SOURCE_ASSET,
        source_id=source_asset.id,
        group_ids=[group.id],
        actor_user_id=ADMIN_USER_ID,
        actor_is_admin=True,
        storage=storage,
    )
    library_key = saved.asset.storage_object_key
    assert library_key is not None

    image_session = ImageSession(owner_user_id=ADMIN_USER_ID, title="资源库加载")
    db_session.add(image_session)
    db_session.commit()
    load_resource_library_asset_to_image_session(
        db_session,
        asset_id=saved.asset.id,
        image_session_id=image_session.id,
        actor_user_id=ADMIN_USER_ID,
        actor_is_admin=True,
        storage=storage,
    )
    copied_reference = copy_resource_library_asset_to_inspiration_source_asset(
        db_session,
        asset_id=saved.asset.id,
        inspiration_id=target_reference_inspiration.id,
        actor_user_id=ADMIN_USER_ID,
        kind=SourceAssetKind.REFERENCE_IMAGE,
        storage=storage,
    )
    copied_source = copy_resource_library_asset_to_inspiration_source_asset(
        db_session,
        asset_id=saved.asset.id,
        inspiration_id=target_source_inspiration.id,
        actor_user_id=ADMIN_USER_ID,
        kind=SourceAssetKind.ORIGINAL_IMAGE,
        storage=storage,
    )
    db_session.commit()

    operations = [call[0] for call in storage.copy_calls]
    assert operations == [
        "copy_to_resource_library_asset",
        "copy_to_image_session_reference",
        "copy_to_reference_upload",
        "copy_to_inspiration_upload",
    ]
    _assert_independent_copy(storage, source_key, library_key)
    assert copied_reference.storage_object_key is not None
    assert copied_source.storage_object_key is not None
    _assert_independent_copy(storage, library_key, copied_reference.storage_object_key)
    _assert_independent_copy(storage, library_key, copied_source.storage_object_key)


def test_image_session_writeback_uses_owned_storage_copy(configured_env: Path, db_session) -> None:
    del configured_env
    storage = _CopyOnlyStorage()
    inspiration = Inspiration(owner_user_id=ADMIN_USER_ID, name="连续生图写回")
    image_session = ImageSession(owner_user_id=ADMIN_USER_ID, inspiration=inspiration, title="写回会话")
    db_session.add_all([inspiration, image_session])
    db_session.flush()
    source_key = f"image_sessions/{image_session.id}/generated/result.png"
    asset = ImageSessionAsset(
        owner_user_id=ADMIN_USER_ID,
        session_id=image_session.id,
        kind=ImageSessionAssetKind.GENERATED_IMAGE,
        original_filename="result.png",
        mime_type="image/png",
        **_put_source(storage, source_key),
    )
    db_session.add(asset)
    db_session.commit()

    attach_image_session_asset_to_inspiration(
        db_session,
        image_session_id=image_session.id,
        asset_id=asset.id,
        target="reference",
        inspiration_id=inspiration.id,
        actor_user_id=ADMIN_USER_ID,
        actor_is_admin=True,
        storage=storage,
    )
    attach_image_session_asset_to_inspiration(
        db_session,
        image_session_id=image_session.id,
        asset_id=asset.id,
        target="main_source",
        inspiration_id=inspiration.id,
        actor_user_id=ADMIN_USER_ID,
        actor_is_admin=True,
        storage=storage,
    )

    assert [call[0] for call in storage.copy_calls] == [
        "copy_to_reference_upload",
        "copy_to_inspiration_upload",
    ]
    for _, copied_source_key, target_key in storage.copy_calls:
        assert copied_source_key == source_key
        _assert_independent_copy(storage, source_key, target_key)


def test_poster_reference_materialization_uses_storage_copy(configured_env: Path, db_session) -> None:
    del configured_env
    storage = _CopyOnlyStorage()
    inspiration = Inspiration(owner_user_id=ADMIN_USER_ID, name="海报参考图")
    workflow = InspirationWorkflow(inspiration=inspiration, title="海报工作流")
    db_session.add_all([inspiration, workflow])
    db_session.flush()
    source_key = f"inspirations/{inspiration.id}/posters/poster.png"
    poster = PosterVariant(
        inspiration_id=inspiration.id,
        copy_set_id="copy-set",
        kind=PosterKind.MAIN_IMAGE,
        template_name="test",
        mime_type="image/png",
        width=1024,
        height=1024,
        **_put_source(storage, source_key),
    )
    db_session.add(poster)
    db_session.commit()

    source_asset = materialize_poster_variant_source_asset(
        db_session,
        workflow=workflow,
        poster_variant_id=poster.id,
        storage=storage,
    )

    assert len(storage.copy_calls) == 1
    operation, copied_source_key, target_key = storage.copy_calls[0]
    assert operation == "copy_to_reference_upload"
    assert copied_source_key == source_key
    assert source_asset.storage_object_key == target_key
    assert source_asset.source_poster_variant_id == poster.id
    _assert_independent_copy(storage, source_key, target_key)


def test_owned_storage_backfills_use_copy_without_reading_bytes(configured_env: Path, db_session) -> None:
    del configured_env
    storage = _CopyOnlyStorage()
    gallery_source_key = "legacy/gallery/source.png"
    resource_source_key = "legacy/resource/source.png"
    gallery_entry = ImageGalleryEntry(
        owner_user_id=ADMIN_USER_ID,
        original_filename="gallery.png",
        mime_type="image/png",
        **_put_source(storage, gallery_source_key),
    )
    resource_asset = ResourceLibraryAsset(
        owner_user_id=ADMIN_USER_ID,
        kind=ResourceLibraryAssetKind.IMAGE,
        original_filename="resource.png",
        mime_type="image/png",
        source_type=ResourceLibrarySourceType.SOURCE_ASSET,
        source_resource_id="legacy-source",
        **_put_source(storage, resource_source_key),
    )
    db_session.add_all([gallery_entry, resource_asset])
    db_session.commit()

    gallery_result = backfill_gallery_entry_storage(db_session, storage=storage)
    resource_result = backfill_resource_library_asset_storage(db_session, storage=storage)

    assert gallery_result.updated == 1
    assert gallery_result.skipped == 0
    assert resource_result.updated == 1
    assert resource_result.skipped == 0
    assert [call[0] for call in storage.copy_calls] == [
        "copy_to_gallery_entry_image",
        "copy_to_resource_library_asset",
    ]
    db_session.expire_all()
    saved_gallery_entry = db_session.get(ImageGalleryEntry, gallery_entry.id)
    saved_resource_asset = db_session.get(ResourceLibraryAsset, resource_asset.id)
    assert saved_gallery_entry is not None
    assert saved_gallery_entry.storage_object_key is not None
    assert saved_resource_asset is not None
    assert saved_resource_asset.storage_object_key is not None
    _assert_independent_copy(storage, gallery_source_key, saved_gallery_entry.storage_object_key)
    _assert_independent_copy(storage, resource_source_key, saved_resource_asset.storage_object_key)
