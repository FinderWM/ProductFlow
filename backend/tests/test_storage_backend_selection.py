from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from inspiration_one_backend.config import get_settings
from inspiration_one_backend.infrastructure.storage import (
    LocalFilesystemStorageBackend,
    S3CompatibleStorageBackend,
    StorageService,
    get_storage_backend,
)


def test_storage_backend_factory_selects_local_backend(configured_env: Path) -> None:
    backend = get_storage_backend()
    assert isinstance(backend, LocalFilesystemStorageBackend)


def test_storage_backend_factory_selects_s3_compatible_backend_for_minio(
    configured_env: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("STORAGE_BACKEND", "minio")
    monkeypatch.setenv("STORAGE_PUBLIC_BASE_URL", "http://localhost:19000")
    monkeypatch.setenv("S3_ENDPOINT_URL", "http://localhost:19000")
    monkeypatch.setenv("S3_BUCKET", "inspiration-one")
    monkeypatch.setenv("S3_ACCESS_KEY", "inspiration-one-local")
    monkeypatch.setenv("S3_SECRET_KEY", "secret")
    monkeypatch.setenv("S3_REGION", "us-east-1")
    get_settings.cache_clear()

    backend = get_storage_backend()
    assert isinstance(backend, S3CompatibleStorageBackend)
    assert backend.bucket == "inspiration-one"
    assert backend.display_name == "MinIO"

    storage = StorageService()
    metadata = storage.metadata_for("inspirations/inspiration-id/source/upload.png")
    assert metadata.storage_backend == "minio"
    assert metadata.storage_bucket == "inspiration-one"
    assert metadata.storage_object_key == "inspirations/inspiration-id/source/upload.png"
    urls = storage.public_urls_for(SimpleNamespace(**metadata.as_model_kwargs()))
    assert urls is not None
    assert (
        urls["download_url"] == "http://localhost:19000/inspiration-one/inspirations/inspiration-id/source/upload.png"
    )
    assert urls["preview_url"].startswith(
        "http://localhost:19000/inspiration-one/inspirations/inspiration-id/source/.variants/"
    )
    assert urls["thumbnail_url"].startswith(
        "http://localhost:19000/inspiration-one/inspirations/inspiration-id/source/.variants/"
    )


def test_storage_service_keeps_compatibility_alias(configured_env: Path) -> None:
    storage = StorageService()
    assert storage.backend == "local"
    assert storage.backend_impl == "local"


def test_storage_service_builds_model_metadata(configured_env: Path) -> None:
    storage = StorageService()

    metadata = storage.metadata_for("inspirations/inspiration-id/source/upload.png")

    assert metadata.as_model_kwargs() == {
        "storage_path": "inspirations/inspiration-id/source/upload.png",
        "storage_backend": "local",
        "storage_bucket": None,
        "storage_object_key": "inspirations/inspiration-id/source/upload.png",
    }


def test_storage_service_object_key_prefers_new_metadata(configured_env: Path) -> None:
    storage = StorageService()
    stored = SimpleNamespace(
        storage_path="inspirations/inspiration-id/source/legacy.png",
        storage_object_key="inspirations/inspiration-id/source/current.png",
    )

    assert storage.object_key_for(stored) == "inspirations/inspiration-id/source/current.png"


def test_storage_service_object_key_falls_back_to_legacy_path(configured_env: Path) -> None:
    storage = StorageService()
    stored = SimpleNamespace(storage_path="inspirations/inspiration-id/source/legacy.png", storage_object_key=None)

    assert storage.object_key_for(stored) == "inspirations/inspiration-id/source/legacy.png"


def test_storage_service_public_urls_use_current_host_instead_of_legacy_stored_url(
    configured_env: Path,
    monkeypatch,
) -> None:
    monkeypatch.setenv("STORAGE_BACKEND", "minio")
    monkeypatch.setenv("STORAGE_PUBLIC_BASE_URL", "http://new-host.example")
    monkeypatch.setenv("S3_ENDPOINT_URL", "http://old-endpoint.example")
    monkeypatch.setenv("S3_BUCKET", "inspiration-one")
    monkeypatch.setenv("S3_ACCESS_KEY", "inspiration-one-local")
    monkeypatch.setenv("S3_SECRET_KEY", "secret")
    monkeypatch.setenv("S3_REGION", "us-east-1")
    get_settings.cache_clear()

    storage = StorageService()
    urls = storage.public_urls_for(
        SimpleNamespace(
            storage_path="inspirations/inspiration-id/source/upload.png",
            storage_object_key="inspirations/inspiration-id/source/upload.png",
            storage_url="http://old-host.example/inspiration-one/inspirations/inspiration-id/source/upload.png",
        )
    )

    assert urls is not None
    assert (
        urls["download_url"] == "http://new-host.example/inspiration-one/inspirations/inspiration-id/source/upload.png"
    )
