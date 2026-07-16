from __future__ import annotations

from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from botocore.exceptions import ClientError, EndpointConnectionError
from helpers import _make_demo_image_bytes_with_size

from inspiration_one_backend.application.gallery import save_generated_asset_to_gallery
from inspiration_one_backend.application.storage_variants import generate_missing_variants
from inspiration_one_backend.config import get_settings
from inspiration_one_backend.domain.enums import ImageSessionAssetKind
from inspiration_one_backend.infrastructure.db.models import (
    ADMIN_USER_ID,
    ImageSession,
    ImageSessionAsset,
    ImageSessionRound,
)
from inspiration_one_backend.infrastructure.storage import (
    InvalidStorageObjectKey,
    LocalFilesystemStorageBackend,
    S3CompatibleStorageBackend,
    StorageObjectNotFound,
    StorageObjectTooLarge,
    StorageService,
    StorageUnavailable,
    get_storage_backend,
)


def _clear_settings_cache() -> None:
    get_settings.cache_clear()


class _FakeStreamingBody:
    def __init__(self, content: bytes) -> None:
        self._buffer = BytesIO(content)
        self.closed = False
        self.close_calls = 0

    def read(self, amount: int = -1) -> bytes:
        return self._buffer.read(amount)

    def close(self) -> None:
        self.close_calls += 1
        self.closed = True
        self._buffer.close()


class _FailingStreamingBody:
    def __init__(self) -> None:
        self.closed = False

    def read(self, amount: int = -1) -> bytes:
        del amount
        raise EndpointConnectionError(endpoint_url="http://internal.example")

    def close(self) -> None:
        self.closed = True


class _FakeS3Client:
    def __init__(self, endpoint_url: str = "http://internal.example") -> None:
        self.endpoint_url = endpoint_url.rstrip("/")
        self.objects: dict[str, dict[str, Any]] = {}
        self.put_object_calls = 0
        self.head_object_calls = 0
        self.get_object_calls = 0
        self.get_object_ranges: list[str | None] = []
        self.copy_object_calls = 0
        self.copy_object_params: list[dict[str, Any]] = []
        self.presign_calls: list[dict[str, Any]] = []
        self.opened_bodies: list[_FakeStreamingBody] = []

    def put_object(self, *, Bucket: str, Key: str, Body: Any, ContentType: str) -> dict[str, str]:
        del Bucket
        self.put_object_calls += 1
        if hasattr(Body, "read"):
            content = Body.read()
        else:
            content = bytes(Body)
        etag = f"etag-{len(self.objects) + 1}"
        self.objects[Key] = {
            "body": content,
            "content_type": ContentType,
            "etag": etag,
            "last_modified": datetime.now(tz=UTC),
        }
        return {"ETag": f'"{etag}"'}

    def head_object(self, *, Bucket: str, Key: str) -> dict[str, Any]:
        del Bucket
        self.head_object_calls += 1
        object_item = self.objects.get(Key)
        if object_item is None:
            raise self._missing_error("HeadObject")
        return {
            "ContentType": object_item["content_type"],
            "ContentLength": len(object_item["body"]),
            "ETag": f'"{object_item["etag"]}"',
            "LastModified": object_item["last_modified"],
        }

    def get_object(self, *, Bucket: str, Key: str, Range: str | None = None) -> dict[str, Any]:
        del Bucket
        self.get_object_calls += 1
        self.get_object_ranges.append(Range)
        object_item = self.objects.get(Key)
        if object_item is None:
            raise self._missing_error("GetObject")
        body = object_item["body"]
        full_length = len(body)
        if Range:
            body = self._apply_range(body, Range)
        streaming_body = _FakeStreamingBody(body)
        self.opened_bodies.append(streaming_body)
        response = {
            "Body": streaming_body,
            "ContentType": object_item["content_type"],
            "ContentLength": len(body),
            "ETag": f'"{object_item["etag"]}"',
            "LastModified": object_item["last_modified"],
        }
        if Range:
            response["ContentRange"] = f"bytes 0-{max(0, len(body) - 1)}/{full_length}"
        return response

    def copy_object(self, *, Bucket: str, Key: str, CopySource: dict[str, str], **kwargs: Any) -> dict[str, Any]:
        del Bucket
        self.copy_object_calls += 1
        self.copy_object_params.append({"Key": Key, "CopySource": CopySource, **kwargs})
        source_object = self.objects.get(CopySource["Key"])
        if source_object is None:
            raise self._missing_error("CopyObject")
        etag = f"etag-{len(self.objects) + 1}"
        self.objects[Key] = {
            "body": source_object["body"],
            "content_type": kwargs.get("ContentType") or source_object["content_type"],
            "etag": etag,
            "last_modified": datetime.now(tz=UTC),
        }
        return {"CopyObjectResult": {"ETag": f'"{etag}"'}}

    def generate_presigned_url(self, *, ClientMethod: str, Params: dict[str, Any], ExpiresIn: int) -> str:
        self.presign_calls.append(
            {
                "client_method": ClientMethod,
                "params": Params,
                "expires_in": ExpiresIn,
            }
        )
        return f"{self.endpoint_url}/{Params['Bucket']}/{Params['Key']}?expires={ExpiresIn}"

    def _missing_error(self, operation_name: str) -> ClientError:
        return ClientError(
            {
                "Error": {"Code": "NoSuchKey", "Message": "missing"},
                "ResponseMetadata": {"HTTPStatusCode": 404},
            },
            operation_name,
        )

    def _apply_range(self, content: bytes, header: str) -> bytes:
        assert header.startswith("bytes=")
        spec = header.removeprefix("bytes=")
        if spec.startswith("-"):
            suffix_length = int(spec[1:])
            return content[-suffix_length:]
        start_text, end_text = spec.split("-", 1)
        start = int(start_text)
        if end_text:
            end = int(end_text)
            return content[start : end + 1]
        return content[start:]


class _ObjectStorageSettingsWithoutRoot:
    storage_backend = "minio"
    storage_temp_root = None
    storage_signed_url_ttl_seconds = 300
    storage_public_base_url = None
    s3_public_endpoint_url = None
    s3_endpoint_url = "http://internal.example"
    s3_bucket = "inspiration-one"
    s3_access_key = "key"
    s3_secret_key = "secret"
    s3_region = "us-east-1"

    @property
    def storage_root(self) -> Path:
        raise AssertionError("对象存储模式不得读取 STORAGE_ROOT")


def _make_s3_backend(
    *,
    bucket: str = "inspiration-one",
    client: _FakeS3Client | None = None,
    presign_client: _FakeS3Client | None = None,
) -> S3CompatibleStorageBackend:
    return S3CompatibleStorageBackend(
        endpoint_url="http://internal.example",
        bucket=bucket,
        access_key="key",
        secret_key="secret",
        region="us-east-1",
        display_name="MinIO",
        client=client or _FakeS3Client(),
        presign_client=presign_client,
    )


def test_storage_backend_factory_selects_local_backend(configured_env: Path) -> None:
    backend = get_storage_backend()
    assert isinstance(backend, LocalFilesystemStorageBackend)


def test_storage_backend_factory_selects_s3_compatible_backend_for_minio(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_client = _FakeS3Client()
    monkeypatch.setenv("STORAGE_BACKEND", "minio")
    monkeypatch.setenv("S3_PUBLIC_ENDPOINT_URL", "http://localhost:19000")
    monkeypatch.setenv("S3_ENDPOINT_URL", "http://localhost:19000")
    monkeypatch.setenv("S3_BUCKET", "inspiration-one")
    monkeypatch.setenv("S3_ACCESS_KEY", "inspiration-one-local")
    monkeypatch.setenv("S3_SECRET_KEY", "secret")
    monkeypatch.setenv("S3_REGION", "us-east-1")
    monkeypatch.setattr(
        "inspiration_one_backend.infrastructure.storage.boto3.client",
        lambda *args, **kwargs: fake_client,
    )
    _clear_settings_cache()

    backend = get_storage_backend()
    assert isinstance(backend, S3CompatibleStorageBackend)
    assert backend.bucket == "inspiration-one"
    assert backend.display_name == "MinIO"

    storage = StorageService()
    metadata = storage.metadata_for("inspirations/inspiration-id/source/upload.png")
    assert metadata.storage_backend == "minio"
    assert metadata.storage_bucket == "inspiration-one"
    assert metadata.storage_object_key == "inspirations/inspiration-id/source/upload.png"
    assert not hasattr(storage, "public_urls_for")


def test_storage_service_keeps_compatibility_alias(configured_env: Path) -> None:
    storage = StorageService()
    assert storage.backend == "local"
    assert storage.backend_impl == "local"


@pytest.mark.parametrize(
    ("storage_relative", "temp_relative", "log_relative"),
    [
        ("storage", "storage", "logs"),
        ("workspace/storage", "workspace", "logs"),
        ("storage", "workspace/logs/temp", "workspace/logs"),
        ("workspace", "temp", "workspace/logs"),
    ],
)
def test_storage_workspace_paths_must_not_overlap(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    storage_relative: str,
    temp_relative: str,
    log_relative: str,
) -> None:
    del configured_env
    monkeypatch.setenv("STORAGE_ROOT", str(tmp_path / storage_relative))
    monkeypatch.setenv("STORAGE_TEMP_ROOT", str(tmp_path / temp_relative))
    monkeypatch.setenv("LOG_DIR", str(tmp_path / log_relative))
    _clear_settings_cache()

    with pytest.raises(ValueError, match="不能相同或存在父子目录关系"):
        get_settings()


def test_storage_workspace_paths_allow_adjacent_directories(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    del configured_env
    storage_root = tmp_path / "storage"
    temp_root = tmp_path / "temp"
    log_dir = tmp_path / "logs"
    monkeypatch.setenv("STORAGE_ROOT", str(storage_root))
    monkeypatch.setenv("STORAGE_TEMP_ROOT", str(temp_root))
    monkeypatch.setenv("LOG_DIR", str(log_dir))
    _clear_settings_cache()

    settings = get_settings()

    assert settings.storage_root == storage_root
    assert settings.storage_temp_root == temp_root
    assert settings.log_dir == log_dir


def test_object_storage_mode_rejects_overlapping_temp_and_log_paths(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    del configured_env
    monkeypatch.setenv("STORAGE_BACKEND", "minio")
    monkeypatch.setenv("STORAGE_ROOT", str(tmp_path / "storage"))
    monkeypatch.setenv("STORAGE_TEMP_ROOT", str(tmp_path / "runtime" / "temp"))
    monkeypatch.setenv("LOG_DIR", str(tmp_path / "runtime"))
    monkeypatch.setenv("S3_ENDPOINT_URL", "http://internal.example")
    monkeypatch.setenv("S3_BUCKET", "inspiration-one")
    monkeypatch.setenv("S3_ACCESS_KEY", "key")
    monkeypatch.setenv("S3_SECRET_KEY", "secret")
    monkeypatch.setenv("S3_REGION", "us-east-1")
    _clear_settings_cache()

    with pytest.raises(ValueError, match="不能相同或存在父子目录关系"):
        get_settings()


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


def test_image_url_serializer_uses_stable_application_url_in_object_storage_mode(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from inspiration_one_backend.presentation.image_variants import build_stored_image_urls

    monkeypatch.setenv("STORAGE_BACKEND", "minio")
    monkeypatch.setenv("S3_PUBLIC_ENDPOINT_URL", "http://new-host.example")
    monkeypatch.setenv("S3_ENDPOINT_URL", "http://old-endpoint.example")
    monkeypatch.setenv("S3_BUCKET", "inspiration-one")
    monkeypatch.setenv("S3_ACCESS_KEY", "inspiration-one-local")
    monkeypatch.setenv("S3_SECRET_KEY", "secret")
    monkeypatch.setenv("S3_REGION", "us-east-1")
    monkeypatch.setattr(
        "inspiration_one_backend.infrastructure.storage.boto3.client",
        lambda *args, **kwargs: _FakeS3Client(),
    )
    _clear_settings_cache()

    urls = build_stored_image_urls(
        SimpleNamespace(
            storage_path="inspirations/inspiration-id/source/upload.png",
            storage_object_key="inspirations/inspiration-id/source/upload.png",
            storage_url="http://old-host.example/inspiration-one/inspirations/inspiration-id/source/upload.png",
        ),
        "/api/source-assets/source-id/download",
    )

    assert urls == {
        "download_url": "/api/source-assets/source-id/download",
        "preview_url": "/api/source-assets/source-id/download?variant=preview",
        "thumbnail_url": "/api/source-assets/source-id/download?variant=thumbnail",
    }


def test_storage_service_does_not_expose_business_delete_operations(configured_env: Path) -> None:
    storage = StorageService()

    assert not hasattr(storage, "delete_enhance_artifacts")
    assert not hasattr(storage, "delete_image_to_code_artifacts")
    assert not hasattr(storage, "delete_image_with_variants")
    assert not hasattr(storage, "delete_image_session_tree")
    assert not hasattr(storage, "delete_inspiration_tree")


def test_storage_service_does_not_create_storage_root_for_object_backend(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    fake_client = _FakeS3Client()
    storage_root = tmp_path / "persistent-storage"
    monkeypatch.setenv("STORAGE_BACKEND", "minio")
    monkeypatch.setenv("STORAGE_ROOT", str(storage_root))
    monkeypatch.setenv("STORAGE_TEMP_ROOT", str(tmp_path / "temp-storage"))
    monkeypatch.setenv("S3_ENDPOINT_URL", "http://internal.example")
    monkeypatch.setenv("S3_BUCKET", "inspiration-one")
    monkeypatch.setenv("S3_ACCESS_KEY", "key")
    monkeypatch.setenv("S3_SECRET_KEY", "secret")
    monkeypatch.setenv("S3_REGION", "us-east-1")
    _clear_settings_cache()

    storage = StorageService(backend=_make_s3_backend(client=fake_client))
    saved_key = storage.save_document_upload("insp-1", "notes.txt", b"hello")

    assert saved_key.startswith("inspirations/insp-1/context/documents/")
    assert storage.root is None
    assert not storage_root.exists()
    assert fake_client.objects[saved_key]["body"] == b"hello"


def test_object_backend_factory_does_not_read_storage_root(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_client = _FakeS3Client()
    settings = _ObjectStorageSettingsWithoutRoot()
    monkeypatch.setattr(
        "inspiration_one_backend.infrastructure.storage.boto3.client",
        lambda *args, **kwargs: fake_client,
    )

    backend = get_storage_backend(settings)

    assert isinstance(backend, S3CompatibleStorageBackend)
    assert backend.bucket == "inspiration-one"


def test_object_storage_service_does_not_read_storage_root(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = _ObjectStorageSettingsWithoutRoot()
    monkeypatch.setattr("inspiration_one_backend.infrastructure.storage.get_settings", lambda: settings)

    storage = StorageService(backend=_make_s3_backend(client=_FakeS3Client()))

    assert storage.root is None


def test_storage_service_does_not_fallback_to_temp_file_when_remote_object_missing(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setenv("STORAGE_BACKEND", "minio")
    monkeypatch.setenv("STORAGE_ROOT", str(tmp_path / "persistent-storage"))
    monkeypatch.setenv("STORAGE_TEMP_ROOT", str(tmp_path / "temp-storage"))
    monkeypatch.setenv("S3_ENDPOINT_URL", "http://internal.example")
    monkeypatch.setenv("S3_BUCKET", "inspiration-one")
    monkeypatch.setenv("S3_ACCESS_KEY", "key")
    monkeypatch.setenv("S3_SECRET_KEY", "secret")
    monkeypatch.setenv("S3_REGION", "us-east-1")
    _clear_settings_cache()

    object_key = "inspirations/demo/source/missing.png"
    stale_path = tmp_path / "persistent-storage" / object_key
    stale_path.parent.mkdir(parents=True, exist_ok=True)
    stale_path.write_bytes(b"stale-cache")
    storage = StorageService(backend=_make_s3_backend(client=_FakeS3Client()))

    with pytest.raises(StorageObjectNotFound):
        storage.stat(object_key)

    assert stale_path.read_bytes() == b"stale-cache"


def test_storage_service_read_bytes_enforces_max_bytes(configured_env: Path) -> None:
    storage = StorageService()
    object_key = storage.save_document_upload("insp-1", "notes.txt", b"abcdef")

    with pytest.raises(StorageObjectTooLarge):
        storage.read_bytes(object_key, max_bytes=3)

    assert storage.read_bytes(object_key, max_bytes=6) == b"abcdef"


def test_local_backend_maps_filesystem_errors_to_storage_unavailable(tmp_path: Path) -> None:
    invalid_root = tmp_path / "root-is-a-file"
    invalid_root.write_bytes(b"not-a-directory")
    backend = LocalFilesystemStorageBackend(root=invalid_root)

    with pytest.raises(StorageUnavailable, match="本地存储访问失败"):
        backend.put_bytes("objects/demo.bin", b"content", content_type="application/octet-stream")
    with pytest.raises(StorageUnavailable, match="本地存储访问失败"):
        backend.stat("objects/demo.bin")


@pytest.mark.parametrize("operation", ["put", "stat", "open_stream", "copy", "presign"])
def test_s3_backend_maps_connection_errors_to_storage_unavailable(
    monkeypatch: pytest.MonkeyPatch,
    operation: str,
) -> None:
    client = _FakeS3Client()
    backend = _make_s3_backend(client=client, presign_client=client)
    backend.put_bytes("source/demo.bin", b"content", content_type="application/octet-stream")

    def fail(*args: Any, **kwargs: Any) -> Any:
        del args, kwargs
        raise EndpointConnectionError(endpoint_url="http://internal.example")

    method_name = {
        "put": "put_object",
        "stat": "head_object",
        "open_stream": "get_object",
        "copy": "copy_object",
        "presign": "generate_presigned_url",
    }[operation]
    monkeypatch.setattr(client, method_name, fail)

    with pytest.raises(StorageUnavailable, match="MinIO访问失败"):
        if operation == "put":
            backend.put_bytes("target.bin", b"content", content_type="application/octet-stream")
        elif operation == "stat":
            backend.stat("source/demo.bin")
        elif operation == "open_stream":
            backend.open_stream("source/demo.bin")
        elif operation == "copy":
            backend.copy_object("source/demo.bin", "target.bin")
        else:
            backend.presign_get("source/demo.bin", expires_in=60)


def test_s3_stream_close_is_idempotent() -> None:
    client = _FakeS3Client()
    backend = _make_s3_backend(client=client)
    backend.put_bytes("source/demo.bin", b"content", content_type="application/octet-stream")
    stream = backend.open_stream("source/demo.bin")

    stream.close()
    stream.close()

    assert client.opened_bodies[0].close_calls == 1


def test_s3_stream_uses_get_metadata_without_head_and_closes_after_exhaustion() -> None:
    client = _FakeS3Client()
    backend = _make_s3_backend(client=client)
    backend.put_bytes("source/demo.bin", b"0123456789", content_type="application/octet-stream")

    stream = backend.open_stream("source/demo.bin", byte_range=(2, 5))

    assert b"".join(stream.iter_chunks(chunk_size=2)) == b"2345"
    assert stream.stat.content_length == 10
    assert client.head_object_calls == 0
    assert client.get_object_ranges == ["bytes=2-5"]
    assert client.opened_bodies[0].close_calls == 1


def test_storage_service_copy_object_uses_s3_server_side_copy(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_client = _FakeS3Client()
    monkeypatch.setenv("STORAGE_BACKEND", "minio")
    monkeypatch.setenv("S3_ENDPOINT_URL", "http://internal.example")
    monkeypatch.setenv("S3_BUCKET", "inspiration-one")
    monkeypatch.setenv("S3_ACCESS_KEY", "key")
    monkeypatch.setenv("S3_SECRET_KEY", "secret")
    monkeypatch.setenv("S3_REGION", "us-east-1")
    _clear_settings_cache()

    storage = StorageService(backend=_make_s3_backend(client=fake_client))
    storage.put_bytes("gallery/source.png", b"image", content_type="image/png")

    copied = storage.copy_object("gallery/source.png", "gallery/copied.png")

    assert copied.object_key == "gallery/copied.png"
    assert fake_client.put_object_calls == 1
    assert fake_client.copy_object_calls == 1
    assert fake_client.get_object_calls == 0
    assert fake_client.objects["gallery/copied.png"]["body"] == b"image"


@pytest.mark.parametrize(
    ("method_name", "target_args", "expected_prefix"),
    [
        ("copy_to_inspiration_upload", ("insp-1",), "inspirations/insp-1/source/"),
        ("copy_to_reference_upload", ("insp-1",), "inspirations/insp-1/reference/"),
        (
            "copy_to_image_session_reference",
            ("session-1",),
            "image_sessions/session-1/reference/",
        ),
        (
            "copy_to_resource_library_asset",
            ("owner-1",),
            "resource_library/owner-1/images/",
        ),
        ("copy_to_gallery_entry_image", ("owner-1",), "gallery/owner-1/images/"),
    ],
)
def test_storage_service_owned_copy_helpers_do_not_download_or_reupload(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
    method_name: str,
    target_args: tuple[str],
    expected_prefix: str,
) -> None:
    fake_client = _FakeS3Client()
    monkeypatch.setenv("STORAGE_BACKEND", "minio")
    monkeypatch.setenv("S3_ENDPOINT_URL", "http://internal.example")
    monkeypatch.setenv("S3_BUCKET", "inspiration-one")
    monkeypatch.setenv("S3_ACCESS_KEY", "key")
    monkeypatch.setenv("S3_SECRET_KEY", "secret")
    monkeypatch.setenv("S3_REGION", "us-east-1")
    _clear_settings_cache()

    storage = StorageService(backend=_make_s3_backend(client=fake_client))
    storage.put_bytes("source/original.png", b"image", content_type="image/png")
    fake_client.put_object_calls = 0

    copied_key = getattr(storage, method_name)(
        "source/original.png",
        *target_args,
        content_type="image/png",
    )

    assert copied_key.startswith(expected_prefix)
    assert copied_key.endswith(".png")
    assert fake_client.copy_object_calls == 1
    assert fake_client.get_object_calls == 0
    assert fake_client.put_object_calls == 0
    assert fake_client.objects[copied_key]["body"] == b"image"
    assert fake_client.objects[copied_key]["content_type"] == "image/png"
    assert fake_client.copy_object_params[-1]["ContentType"] == "image/png"
    assert fake_client.copy_object_params[-1]["MetadataDirective"] == "REPLACE"


def test_trusted_image_copy_replaces_unsafe_source_suffix_and_metadata(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_client = _FakeS3Client()
    monkeypatch.setenv("STORAGE_BACKEND", "minio")
    monkeypatch.setenv("S3_ENDPOINT_URL", "http://internal.example")
    monkeypatch.setenv("S3_BUCKET", "inspiration-one")
    monkeypatch.setenv("S3_ACCESS_KEY", "key")
    monkeypatch.setenv("S3_SECRET_KEY", "secret")
    monkeypatch.setenv("S3_REGION", "us-east-1")
    _clear_settings_cache()
    storage = StorageService(backend=_make_s3_backend(client=fake_client))
    storage.put_bytes("legacy/source.html", b"image<script>", content_type="text/html")

    copied_key = storage.copy_to_reference_upload(
        "legacy/source.html",
        "insp-1",
        content_type="image/png",
    )

    assert copied_key.endswith(".png")
    assert fake_client.objects[copied_key]["body"] == b"image<script>"
    assert fake_client.objects[copied_key]["content_type"] == "image/png"


def test_storage_service_owned_copy_creates_independent_local_object(configured_env: Path) -> None:
    storage = StorageService()
    source_key = storage.put_bytes("source/original.png", b"image", content_type="image/png").object_key

    copied_key = storage.copy_to_gallery_entry_image(
        source_key,
        "owner-1",
        content_type="image/png",
    )

    assert copied_key != source_key
    assert (configured_env / source_key).read_bytes() == b"image"
    assert (configured_env / copied_key).read_bytes() == b"image"


@pytest.mark.parametrize(
    ("content_type", "expected_suffix"),
    [("image/png", ".png"), ("image/jpeg", ".jpg"), ("image/webp", ".webp")],
)
def test_image_save_derives_s3_key_suffix_and_metadata_from_trusted_mime(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
    content_type: str,
    expected_suffix: str,
) -> None:
    fake_client = _FakeS3Client()
    monkeypatch.setenv("STORAGE_BACKEND", "minio")
    monkeypatch.setenv("S3_ENDPOINT_URL", "http://internal.example")
    monkeypatch.setenv("S3_BUCKET", "inspiration-one")
    monkeypatch.setenv("S3_ACCESS_KEY", "key")
    monkeypatch.setenv("S3_SECRET_KEY", "secret")
    monkeypatch.setenv("S3_REGION", "us-east-1")
    monkeypatch.setattr(
        "inspiration_one_backend.infrastructure.queue.try_enqueue_storage_image_variants",
        lambda _key: True,
    )
    _clear_settings_cache()
    storage = StorageService(backend=_make_s3_backend(client=fake_client))

    object_key = storage.save_inspiration_upload("insp-1", b"image<script>", content_type=content_type)

    assert object_key.endswith(expected_suffix)
    assert fake_client.objects[object_key]["content_type"] == content_type
    assert fake_client.objects[object_key]["body"] == b"image<script>"


def test_gallery_business_copy_uses_s3_copy_without_download_or_reupload(
    configured_env: Path,
    db_session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_client = _FakeS3Client()
    monkeypatch.setenv("STORAGE_BACKEND", "minio")
    monkeypatch.setenv("S3_ENDPOINT_URL", "http://internal.example")
    monkeypatch.setenv("S3_BUCKET", "inspiration-one")
    monkeypatch.setenv("S3_ACCESS_KEY", "key")
    monkeypatch.setenv("S3_SECRET_KEY", "secret")
    monkeypatch.setenv("S3_REGION", "us-east-1")
    _clear_settings_cache()
    storage = StorageService(backend=_make_s3_backend(client=fake_client))

    image_session = ImageSession(owner_user_id=ADMIN_USER_ID, title="S3 画廊复制")
    db_session.add(image_session)
    db_session.flush()
    source_key = f"image_sessions/{image_session.id}/generated/source.png"
    storage.put_bytes(source_key, b"image", content_type="image/png")
    asset = ImageSessionAsset(
        owner_user_id=ADMIN_USER_ID,
        session_id=image_session.id,
        kind=ImageSessionAssetKind.GENERATED_IMAGE,
        original_filename="source.png",
        mime_type="image/png",
        **storage.metadata_for(source_key).as_model_kwargs(),
    )
    db_session.add(asset)
    db_session.flush()
    db_session.add(
        ImageSessionRound(
            session_id=image_session.id,
            prompt="服务端复制",
            assistant_message="ok",
            size="1024x1024",
            model_name="mock",
            provider_name="mock",
            prompt_version="v1",
            generated_asset_id=asset.id,
        )
    )
    db_session.commit()
    fake_client.put_object_calls = 0

    result = save_generated_asset_to_gallery(
        db_session,
        image_session_asset_id=asset.id,
        actor_user_id=ADMIN_USER_ID,
        actor_is_admin=True,
        storage=storage,
    )

    assert result.entry.storage_object_key is not None
    assert result.entry.storage_object_key.startswith(f"gallery/{ADMIN_USER_ID}/images/")
    assert fake_client.copy_object_calls == 1
    assert fake_client.get_object_calls == 0
    assert fake_client.put_object_calls == 0
    assert fake_client.objects[result.entry.storage_object_key]["body"] == b"image"
    assert not configured_env.exists()


def test_storage_variant_generation_uses_remote_bytes_without_creating_storage_root(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_client = _FakeS3Client()
    monkeypatch.setenv("STORAGE_BACKEND", "minio")
    monkeypatch.setenv("STORAGE_ROOT", str(configured_env))
    monkeypatch.setenv("S3_ENDPOINT_URL", "http://internal.example")
    monkeypatch.setenv("S3_BUCKET", "inspiration-one")
    monkeypatch.setenv("S3_ACCESS_KEY", "key")
    monkeypatch.setenv("S3_SECRET_KEY", "secret")
    monkeypatch.setenv("S3_REGION", "us-east-1")
    _clear_settings_cache()
    storage = StorageService(backend=_make_s3_backend(client=fake_client))
    original_key = "gallery/owner/images/original.png"
    storage.put_bytes(
        original_key,
        _make_demo_image_bytes_with_size(1200, 800),
        content_type="image/png",
    )
    fake_client.put_object_calls = 0

    generated = generate_missing_variants(storage, original_key)

    assert generated["preview"].endswith(".preview.webp")
    assert generated["thumbnail"].endswith(".thumbnail.webp")
    assert fake_client.get_object_calls == 1
    assert fake_client.put_object_calls == 2
    assert not configured_env.exists()


def test_storage_service_materialize_cleans_up_temp_file(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    fake_client = _FakeS3Client()
    monkeypatch.setenv("STORAGE_BACKEND", "minio")
    monkeypatch.setenv("STORAGE_TEMP_ROOT", str(tmp_path / "materialize-temp"))
    monkeypatch.setenv("S3_ENDPOINT_URL", "http://internal.example")
    monkeypatch.setenv("S3_BUCKET", "inspiration-one")
    monkeypatch.setenv("S3_ACCESS_KEY", "key")
    monkeypatch.setenv("S3_SECRET_KEY", "secret")
    monkeypatch.setenv("S3_REGION", "us-east-1")
    _clear_settings_cache()

    storage = StorageService(backend=_make_s3_backend(client=fake_client))
    storage.put_bytes("gallery/source.png", b"image", content_type="image/png")

    with storage.materialize("gallery/source.png") as materialized_path:
        assert materialized_path.exists()
        assert materialized_path.read_bytes() == b"image"
        temp_dir = materialized_path.parent

    assert not materialized_path.exists()
    assert not temp_dir.exists()


def test_storage_service_materialize_cleans_up_when_caller_raises(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    fake_client = _FakeS3Client()
    monkeypatch.setenv("STORAGE_BACKEND", "minio")
    monkeypatch.setenv("STORAGE_TEMP_ROOT", str(tmp_path / "materialize-temp"))
    monkeypatch.setenv("S3_ENDPOINT_URL", "http://internal.example")
    monkeypatch.setenv("S3_BUCKET", "inspiration-one")
    monkeypatch.setenv("S3_ACCESS_KEY", "key")
    monkeypatch.setenv("S3_SECRET_KEY", "secret")
    monkeypatch.setenv("S3_REGION", "us-east-1")
    _clear_settings_cache()
    storage = StorageService(backend=_make_s3_backend(client=fake_client))
    storage.put_bytes("gallery/source.png", b"image", content_type="image/png")

    with pytest.raises(RuntimeError, match="caller failed"):
        with storage.materialize("gallery/source.png") as materialized_path:
            temp_dir = materialized_path.parent
            raise RuntimeError("caller failed")

    assert not temp_dir.exists()


def test_storage_service_materialize_cleans_up_when_stream_fails(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    fake_client = _FakeS3Client()
    monkeypatch.setenv("STORAGE_BACKEND", "minio")
    temp_root = tmp_path / "materialize-temp"
    monkeypatch.setenv("STORAGE_TEMP_ROOT", str(temp_root))
    monkeypatch.setenv("S3_ENDPOINT_URL", "http://internal.example")
    monkeypatch.setenv("S3_BUCKET", "inspiration-one")
    monkeypatch.setenv("S3_ACCESS_KEY", "key")
    monkeypatch.setenv("S3_SECRET_KEY", "secret")
    monkeypatch.setenv("S3_REGION", "us-east-1")
    _clear_settings_cache()
    storage = StorageService(backend=_make_s3_backend(client=fake_client))
    storage.put_bytes("gallery/source.png", b"image", content_type="image/png")
    failing_body = _FailingStreamingBody()
    monkeypatch.setattr(
        fake_client,
        "get_object",
        lambda **_kwargs: {
            "Body": failing_body,
            "ContentType": "image/png",
            "ContentLength": 5,
        },
    )

    with pytest.raises(StorageUnavailable, match="对象存储读取失败"):
        with storage.materialize("gallery/source.png"):
            pytest.fail("流读取失败时不应进入 materialize 作用域")

    assert failing_body.closed is True
    assert temp_root.exists()
    assert list(temp_root.iterdir()) == []


def test_storage_service_presign_uses_public_client(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    internal_client = _FakeS3Client("http://internal.example")
    public_client = _FakeS3Client("http://public.example")
    monkeypatch.setenv("STORAGE_BACKEND", "minio")
    monkeypatch.setenv("S3_ENDPOINT_URL", "http://internal.example")
    monkeypatch.setenv("S3_PUBLIC_ENDPOINT_URL", "http://public.example")
    monkeypatch.setenv("S3_BUCKET", "inspiration-one")
    monkeypatch.setenv("S3_ACCESS_KEY", "key")
    monkeypatch.setenv("S3_SECRET_KEY", "secret")
    monkeypatch.setenv("S3_REGION", "us-east-1")
    _clear_settings_cache()

    storage = StorageService(
        backend=_make_s3_backend(client=internal_client, presign_client=public_client),
    )

    url = storage.presign_get("gallery/source.png", expires_in=120, response_filename="演示\r\n.pptx")

    assert url == "http://public.example/inspiration-one/gallery/source.png?expires=120"
    assert public_client.presign_calls[0]["params"]["ResponseContentDisposition"] == (
        'attachment; filename="download.pptx"; filename*=UTF-8\'\'%E6%BC%94%E7%A4%BA.pptx'
    )


def test_s3_presign_returns_none_without_public_endpoint() -> None:
    internal_client = _FakeS3Client("http://internal.example")
    backend = _make_s3_backend(client=internal_client)

    url = backend.presign_get(
        "gallery/source.png",
        expires_in=120,
        response_filename="demo.png",
        response_content_type="image/png",
    )

    assert url is None
    assert internal_client.presign_calls == []


@pytest.mark.parametrize(
    "object_key",
    [
        "",
        "   ",
        "/absolute.png",
        "../bad.png",
        "folder/../bad.png",
        "folder/./bad.png",
        "folder\\bad.png",
        "folder/\x00bad.png",
        "folder//bad.png",
        "folder/",
    ],
)
def test_storage_service_validates_object_keys(configured_env: Path, object_key: str) -> None:
    storage = StorageService()

    with pytest.raises(InvalidStorageObjectKey):
        storage.metadata_for(object_key)


def test_storage_service_preserves_valid_object_key_exactly(configured_env: Path) -> None:
    storage = StorageService()
    object_key = " folder/image name.png "

    assert storage.metadata_for(object_key).storage_object_key == object_key
