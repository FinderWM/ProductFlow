from __future__ import annotations

import logging
import mimetypes
import shutil
import tempfile
import unicodedata
from abc import ABC, abstractmethod
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path, PurePosixPath
from typing import Any, Literal, Protocol
from urllib.parse import quote, urlsplit
from uuid import uuid4

import boto3
from botocore.client import Config
from botocore.exceptions import BotoCoreError, ClientError

from inspiration_one_backend.config import get_settings
from inspiration_one_backend.domain.image_media import image_suffix_for_mime_type, normalize_image_mime_type

ImageVariantName = Literal["original", "preview", "thumbnail"]

_DEFAULT_STREAM_CHUNK_SIZE = 1024 * 1024

logger = logging.getLogger(__name__)


class StorageError(RuntimeError):
    """Base storage abstraction error."""


class InvalidStorageObjectKey(StorageError, ValueError):
    """Raised when a caller passes an unsafe or malformed object key."""


class StorageObjectNotFound(StorageError, ValueError):
    """Raised when the active storage backend cannot find the object."""


class StorageObjectTooLarge(StorageError, ValueError):
    """Raised when a bounded read would exceed the caller's explicit limit."""


class StorageUnavailable(StorageError):
    """Raised when the storage backend is temporarily unavailable."""


@dataclass(frozen=True, slots=True)
class StorageObjectMetadata:
    storage_path: str
    storage_backend: str
    storage_bucket: str | None
    storage_object_key: str

    def as_model_kwargs(self) -> dict[str, str | None]:
        return {
            "storage_path": self.storage_path,
            "storage_backend": self.storage_backend,
            "storage_bucket": self.storage_bucket,
            "storage_object_key": self.storage_object_key,
        }


@dataclass(frozen=True, slots=True)
class StoredObjectRef:
    object_key: str
    backend: str
    bucket: str | None
    content_type: str
    content_length: int
    etag: str | None = None


@dataclass(frozen=True, slots=True)
class StoredObjectStat:
    object_key: str
    content_type: str
    content_length: int
    etag: str | None = None
    last_modified: datetime | None = None


class StorageReadStream(Protocol):
    stat: StoredObjectStat

    def iter_chunks(self, chunk_size: int = _DEFAULT_STREAM_CHUNK_SIZE) -> Iterator[bytes]:
        ...

    def close(self) -> None:
        ...


def _validated_storage_object_key(object_key: str) -> PurePosixPath:
    if not isinstance(object_key, str) or not object_key.strip():
        raise InvalidStorageObjectKey("存储路径不能为空")
    normalized = object_key
    if normalized.startswith("/") or normalized.endswith("/"):
        raise InvalidStorageObjectKey("存储路径必须是相对路径")
    if "\x00" in normalized or "\\" in normalized:
        raise InvalidStorageObjectKey("存储路径无效")
    parts = normalized.split("/")
    if any(not part or part in {".", ".."} for part in parts):
        raise InvalidStorageObjectKey("存储路径越界")
    return PurePosixPath(*parts)


def _path_from_object_key(object_key: str) -> Path:
    return Path(*_validated_storage_object_key(object_key).parts)


def _guess_media_type_by_name(filename: str) -> str:
    return mimetypes.guess_type(filename)[0] or "application/octet-stream"


def _storage_endpoint_identity(endpoint_url: str | None) -> str:
    if not endpoint_url:
        return "aws-default"
    parsed = urlsplit(endpoint_url)
    if not parsed.hostname:
        return "custom-endpoint"
    scheme = parsed.scheme.lower() or "https"
    port = f":{parsed.port}" if parsed.port is not None else ""
    return f"{scheme}://{parsed.hostname.lower()}{port}"


def _write_file(destination: Path, content: bytes) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp_path = destination.parent / f".{destination.name}.{uuid4().hex}.tmp"
    temp_path.write_bytes(content)
    temp_path.replace(destination)


def _write_stream_to_file(destination: Path, stream: StorageReadStream) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp_path = destination.parent / f".{destination.name}.{uuid4().hex}.tmp"
    try:
        with temp_path.open("wb") as handle:
            for chunk in stream.iter_chunks():
                if chunk:
                    handle.write(chunk)
    finally:
        _close_storage_stream(stream)
    temp_path.replace(destination)


def _close_storage_stream(stream: StorageReadStream) -> None:
    try:
        stream.close()
    except Exception:
        logger.exception("存储读取流关闭失败: object_key=%s", stream.stat.object_key)


def _utc_datetime_from_timestamp(timestamp: float) -> datetime:
    return datetime.fromtimestamp(timestamp, tz=UTC)


def _range_header(byte_range: tuple[int, int | None] | None) -> str | None:
    if byte_range is None:
        return None
    start, end = byte_range
    if start < 0:
        if end is not None:
            raise ValueError("后缀 Range 不能指定结束位置")
        suffix_length = -start
        if suffix_length <= 0:
            raise ValueError("Range 长度必须大于 0")
        return f"bytes=-{suffix_length}"
    if end is None:
        return f"bytes={start}-"
    if end < start:
        raise ValueError("Range 结束位置必须大于等于起始位置")
    return f"bytes={start}-{end}"


def _full_content_length_from_get_response(response: dict[str, Any]) -> int:
    content_range = response.get("ContentRange")
    if isinstance(content_range, str):
        _range_value, separator, total = content_range.rpartition("/")
        if separator and total.isdecimal():
            return int(total)
    return int(response.get("ContentLength") or 0)


def _sanitize_content_disposition_filename(filename: str) -> str:
    characters: list[str] = []
    for character in filename:
        if character in {"\r", "\n"}:
            continue
        characters.append("_" if ord(character) < 32 or ord(character) == 127 else character)
    sanitized = "".join(characters).replace("/", "_").replace("\\", "_").strip()
    return sanitized or "download"


def _attachment_content_disposition(filename: str) -> str:
    sanitized = _sanitize_content_disposition_filename(filename)
    suffix = unicodedata.normalize("NFKD", Path(sanitized).suffix).encode("ascii", "ignore").decode()
    fallback = unicodedata.normalize("NFKD", sanitized).encode("ascii", "ignore").decode().strip()
    fallback = fallback.replace('"', "_")
    fallback = "".join(character if 32 <= ord(character) < 127 else "_" for character in fallback)
    if not fallback or fallback in {".", "..", suffix}:
        fallback = f"download{suffix}"
    encoded = quote(sanitized, safe="")
    return f'attachment; filename="{fallback}"; filename*=UTF-8\'\'{encoded}'


class _LocalFileReadStream:
    def __init__(
        self,
        path: Path,
        *,
        stat: StoredObjectStat,
        byte_range: tuple[int, int | None] | None = None,
    ) -> None:
        self.stat = stat
        self._file = path.open("rb")
        self._closed = False
        self._remaining: int | None = None
        if byte_range is not None:
            start, remaining = self._resolve_range(byte_range, total_length=stat.content_length)
            self._file.seek(start)
            self._remaining = remaining

    def _resolve_range(self, byte_range: tuple[int, int | None], *, total_length: int) -> tuple[int, int]:
        start, end = byte_range
        if start < 0:
            if end is not None:
                raise ValueError("后缀 Range 不能指定结束位置")
            suffix_length = -start
            if suffix_length <= 0:
                raise ValueError("Range 长度必须大于 0")
            resolved_start = max(total_length - suffix_length, 0)
            return resolved_start, total_length - resolved_start
        if start >= total_length:
            raise ValueError("Range 起始位置越界")
        resolved_end = total_length - 1 if end is None else min(end, total_length - 1)
        if resolved_end < start:
            raise ValueError("Range 结束位置必须大于等于起始位置")
        return start, resolved_end - start + 1

    def iter_chunks(self, chunk_size: int = _DEFAULT_STREAM_CHUNK_SIZE) -> Iterator[bytes]:
        size = max(chunk_size, 1)
        try:
            while True:
                if self._remaining is not None:
                    if self._remaining <= 0:
                        return
                    current_size = min(size, self._remaining)
                else:
                    current_size = size
                chunk = self._file.read(current_size)
                if not chunk:
                    return
                if self._remaining is not None:
                    self._remaining -= len(chunk)
                yield chunk
        except OSError as exc:
            raise StorageUnavailable("本地存储读取失败") from exc
        finally:
            try:
                self.close()
            except OSError:
                logger.exception("本地存储读取流关闭失败: object_key=%s", self.stat.object_key)

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._file.close()


class _S3ObjectReadStream:
    def __init__(self, *, body: Any, stat: StoredObjectStat) -> None:
        self.stat = stat
        self._body = body
        self._closed = False

    def iter_chunks(self, chunk_size: int = _DEFAULT_STREAM_CHUNK_SIZE) -> Iterator[bytes]:
        size = max(chunk_size, 1)
        try:
            while True:
                chunk = self._body.read(size)
                if not chunk:
                    return
                yield chunk
        except (BotoCoreError, OSError) as exc:
            raise StorageUnavailable("对象存储读取失败") from exc
        finally:
            try:
                self.close()
            except Exception:
                logger.exception("对象存储读取流关闭失败: object_key=%s", self.stat.object_key)

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._body.close()


class StorageBackend(ABC):
    name: str
    bucket: str | None

    @abstractmethod
    def put_bytes(
        self,
        object_key: str,
        content: bytes,
        *,
        content_type: str,
    ) -> StoredObjectRef:
        raise NotImplementedError

    @abstractmethod
    def stat(self, object_key: str) -> StoredObjectStat:
        raise NotImplementedError

    @abstractmethod
    def open_stream(
        self,
        object_key: str,
        *,
        byte_range: tuple[int, int | None] | None = None,
    ) -> StorageReadStream:
        raise NotImplementedError

    @abstractmethod
    def copy_object(
        self,
        source_object_key: str,
        destination_object_key: str,
        *,
        content_type: str | None = None,
    ) -> StoredObjectRef:
        raise NotImplementedError

    @abstractmethod
    def presign_get(
        self,
        object_key: str,
        *,
        expires_in: int,
        response_filename: str | None = None,
        response_content_type: str | None = None,
    ) -> str | None:
        raise NotImplementedError

    @abstractmethod
    def native_path(self, object_key: str) -> Path | None:
        raise NotImplementedError


class LocalFilesystemStorageBackend(StorageBackend):
    name = "local"
    bucket = None

    def __init__(self, *, root: Path) -> None:
        self.root = root

    def put_bytes(
        self,
        object_key: str,
        content: bytes,
        *,
        content_type: str,
    ) -> StoredObjectRef:
        destination = self.root / _path_from_object_key(object_key)
        try:
            _write_file(destination, content)
        except OSError as exc:
            raise StorageUnavailable("本地存储访问失败") from exc
        return StoredObjectRef(
            object_key=object_key,
            backend=self.name,
            bucket=None,
            content_type=content_type,
            content_length=len(content),
        )

    def stat(self, object_key: str) -> StoredObjectStat:
        path = self.root / _path_from_object_key(object_key)
        try:
            file_stat = path.stat()
        except FileNotFoundError as exc:
            raise StorageObjectNotFound("存储文件不存在") from exc
        except OSError as exc:
            raise StorageUnavailable("本地存储访问失败") from exc
        return StoredObjectStat(
            object_key=object_key,
            content_type=_guess_media_type_by_name(path.name),
            content_length=file_stat.st_size,
            last_modified=_utc_datetime_from_timestamp(file_stat.st_mtime),
        )

    def open_stream(
        self,
        object_key: str,
        *,
        byte_range: tuple[int, int | None] | None = None,
    ) -> StorageReadStream:
        path = self.root / _path_from_object_key(object_key)
        stat = self.stat(object_key)
        try:
            return _LocalFileReadStream(path, stat=stat, byte_range=byte_range)
        except FileNotFoundError as exc:
            raise StorageObjectNotFound("存储文件不存在") from exc
        except OSError as exc:
            raise StorageUnavailable("本地存储访问失败") from exc

    def copy_object(
        self,
        source_object_key: str,
        destination_object_key: str,
        *,
        content_type: str | None = None,
    ) -> StoredObjectRef:
        source_path = self.root / _path_from_object_key(source_object_key)
        destination_path = self.root / _path_from_object_key(destination_object_key)
        source_stat = self.stat(source_object_key)
        try:
            destination_path.parent.mkdir(parents=True, exist_ok=True)
            temp_path = destination_path.parent / f".{destination_path.name}.{uuid4().hex}.tmp"
            with source_path.open("rb") as src_handle, temp_path.open("wb") as dst_handle:
                shutil.copyfileobj(src_handle, dst_handle)
            temp_path.replace(destination_path)
        except FileNotFoundError as exc:
            raise StorageObjectNotFound("存储文件不存在") from exc
        except OSError as exc:
            raise StorageUnavailable("本地存储访问失败") from exc
        return StoredObjectRef(
            object_key=destination_object_key,
            backend=self.name,
            bucket=None,
            content_type=content_type or source_stat.content_type,
            content_length=source_stat.content_length,
        )

    def presign_get(
        self,
        object_key: str,
        *,
        expires_in: int,
        response_filename: str | None = None,
        response_content_type: str | None = None,
    ) -> str | None:
        return None

    def native_path(self, object_key: str) -> Path | None:
        path = self.root / _path_from_object_key(object_key)
        self.stat(object_key)
        return path


class S3CompatibleStorageBackend(StorageBackend):
    name = "s3"

    def __init__(
        self,
        *,
        endpoint_url: str | None,
        bucket: str,
        access_key: str | None,
        secret_key: str | None,
        region: str,
        display_name: str = "S3 兼容存储",
        presign_endpoint_url: str | None = None,
        client: Any | None = None,
        presign_client: Any | None = None,
    ) -> None:
        self.bucket = bucket
        self.display_name = display_name
        self.endpoint_identity = _storage_endpoint_identity(endpoint_url)
        self._client = client or self._create_client(
            endpoint_url=endpoint_url,
            access_key=access_key,
            secret_key=secret_key,
            region=region,
        )
        if presign_client is not None:
            self._presign_client = presign_client
        elif presign_endpoint_url:
            if presign_endpoint_url == endpoint_url:
                self._presign_client = self._client
            else:
                self._presign_client = self._create_client(
                    endpoint_url=presign_endpoint_url,
                    access_key=access_key,
                    secret_key=secret_key,
                    region=region,
                )
        else:
            self._presign_client = None

    @staticmethod
    def _create_client(
        *,
        endpoint_url: str | None,
        access_key: str | None,
        secret_key: str | None,
        region: str,
    ) -> Any:
        return boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region,
            config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        )

    def put_bytes(
        self,
        object_key: str,
        content: bytes,
        *,
        content_type: str,
    ) -> StoredObjectRef:
        try:
            response = self._client.put_object(
                Bucket=self.bucket,
                Key=object_key,
                Body=BytesIO(content),
                ContentType=content_type,
            )
        except ClientError as exc:
            self._raise_for_client_error(exc)
        except BotoCoreError as exc:
            raise StorageUnavailable(f"{self.display_name}访问失败") from exc
        return StoredObjectRef(
            object_key=object_key,
            backend=self.name,
            bucket=self.bucket,
            content_type=content_type,
            content_length=len(content),
            etag=self._normalize_etag(response.get("ETag")),
        )

    def stat(self, object_key: str) -> StoredObjectStat:
        try:
            response = self._client.head_object(Bucket=self.bucket, Key=object_key)
        except ClientError as exc:
            self._raise_for_client_error(exc)
        except BotoCoreError as exc:
            raise StorageUnavailable(f"{self.display_name}访问失败") from exc
        return StoredObjectStat(
            object_key=object_key,
            content_type=response.get("ContentType") or "application/octet-stream",
            content_length=int(response.get("ContentLength") or 0),
            etag=self._normalize_etag(response.get("ETag")),
            last_modified=response.get("LastModified"),
        )

    def open_stream(
        self,
        object_key: str,
        *,
        byte_range: tuple[int, int | None] | None = None,
    ) -> StorageReadStream:
        params: dict[str, Any] = {
            "Bucket": self.bucket,
            "Key": object_key,
        }
        range_header = _range_header(byte_range)
        if range_header is not None:
            params["Range"] = range_header
        try:
            response = self._client.get_object(**params)
        except ClientError as exc:
            self._raise_for_client_error(exc)
        except BotoCoreError as exc:
            raise StorageUnavailable(f"{self.display_name}访问失败") from exc
        stat = StoredObjectStat(
            object_key=object_key,
            content_type=response.get("ContentType") or "application/octet-stream",
            content_length=_full_content_length_from_get_response(response),
            etag=self._normalize_etag(response.get("ETag")),
            last_modified=response.get("LastModified"),
        )
        return _S3ObjectReadStream(body=response["Body"], stat=stat)

    def copy_object(
        self,
        source_object_key: str,
        destination_object_key: str,
        *,
        content_type: str | None = None,
    ) -> StoredObjectRef:
        source_stat = self.stat(source_object_key)
        params: dict[str, Any] = {
            "Bucket": self.bucket,
            "Key": destination_object_key,
            "CopySource": {"Bucket": self.bucket, "Key": source_object_key},
        }
        if content_type:
            params["ContentType"] = content_type
            params["MetadataDirective"] = "REPLACE"
        try:
            response = self._client.copy_object(**params)
        except ClientError as exc:
            self._raise_for_client_error(exc)
        except BotoCoreError as exc:
            raise StorageUnavailable(f"{self.display_name}访问失败") from exc
        copy_result = response.get("CopyObjectResult", {})
        return StoredObjectRef(
            object_key=destination_object_key,
            backend=self.name,
            bucket=self.bucket,
            content_type=content_type or source_stat.content_type,
            content_length=source_stat.content_length,
            etag=self._normalize_etag(copy_result.get("ETag")) or source_stat.etag,
        )

    def presign_get(
        self,
        object_key: str,
        *,
        expires_in: int,
        response_filename: str | None = None,
        response_content_type: str | None = None,
    ) -> str | None:
        if self._presign_client is None:
            return None
        params: dict[str, Any] = {
            "Bucket": self.bucket,
            "Key": object_key,
        }
        if response_filename:
            params["ResponseContentDisposition"] = _attachment_content_disposition(response_filename)
        if response_content_type:
            params["ResponseContentType"] = response_content_type
        try:
            return self._presign_client.generate_presigned_url(
                ClientMethod="get_object",
                Params=params,
                ExpiresIn=expires_in,
            )
        except ClientError as exc:
            self._raise_for_client_error(exc)
        except BotoCoreError as exc:
            raise StorageUnavailable(f"{self.display_name}访问失败") from exc

    def native_path(self, object_key: str) -> Path | None:
        return None

    def _raise_for_client_error(self, exc: ClientError) -> None:
        if self._is_missing_object(exc):
            raise StorageObjectNotFound("存储文件不存在") from exc
        raise StorageUnavailable(f"{self.display_name}访问失败") from exc

    def _is_missing_object(self, exc: ClientError) -> bool:
        error = exc.response.get("Error", {})
        code = str(error.get("Code") or "").lower()
        status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        return code in {"404", "nosuchkey", "notfound", "no-such-key"} or status == 404

    def _normalize_etag(self, value: Any) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text.strip('"') or None


StorageBackendFactory = Callable[[Any, Path | None], StorageBackend]
_STORAGE_BACKEND_FACTORIES: dict[str, StorageBackendFactory] = {}


def register_storage_backend(name: str, factory: StorageBackendFactory) -> None:
    normalized = name.strip().lower()
    if not normalized:
        raise ValueError("存储后端名称不能为空")
    _STORAGE_BACKEND_FACTORIES[normalized] = factory


def _create_local_storage_backend(settings: Any, root: Path | None) -> StorageBackend:
    if root is None:
        raise RuntimeError("本地存储后端缺少 STORAGE_ROOT")
    return LocalFilesystemStorageBackend(root=root)


def _create_s3_compatible_storage_backend(settings: Any, root: Path | None) -> StorageBackend:
    del root
    display_name = "MinIO" if settings.storage_backend == "minio" else "S3 兼容存储"
    return S3CompatibleStorageBackend(
        endpoint_url=settings.s3_endpoint_url,
        bucket=settings.s3_bucket,
        access_key=settings.s3_access_key,
        secret_key=settings.s3_secret_key,
        region=settings.s3_region,
        display_name=display_name,
        presign_endpoint_url=settings.s3_public_endpoint_url or settings.storage_public_base_url,
    )


register_storage_backend("local", _create_local_storage_backend)
register_storage_backend("minio", _create_s3_compatible_storage_backend)
register_storage_backend("s3", _create_s3_compatible_storage_backend)


def get_storage_backend(settings: Any | None = None, *, root: Path | None = None) -> StorageBackend:
    settings = settings or get_settings()
    backend_name = (settings.storage_backend or "local").strip().lower()
    factory = _STORAGE_BACKEND_FACTORIES.get(backend_name)
    if factory is None:
        raise RuntimeError(f"暂不支持的存储后端: {backend_name}")
    storage_root = (root or settings.storage_root).resolve() if backend_name == "local" else None
    return factory(settings, storage_root)


class StorageService:
    """Storage facade shared across application and route layers."""

    def __init__(self, root: Path | None = None, backend: StorageBackend | None = None) -> None:
        settings = get_settings()
        self._backend = backend or get_storage_backend(settings, root=root)
        self.backend = settings.storage_backend
        self.backend_impl = self._backend.name
        self.bucket = getattr(self._backend, "bucket", None)
        self.endpoint_identity = getattr(self._backend, "endpoint_identity", None)
        self.signed_url_ttl_seconds = settings.storage_signed_url_ttl_seconds
        self._temp_root = settings.storage_temp_root.resolve() if settings.storage_temp_root else None
        if self.backend_impl == "local":
            backend_root = getattr(self._backend, "root", None)
            self.root: Path | None = (
                backend_root if isinstance(backend_root, Path) else (root or settings.storage_root).resolve()
            )
            self.root.mkdir(parents=True, exist_ok=True)
        else:
            self.root = None

    def save_inspiration_upload(
        self,
        inspiration_id: str,
        content: bytes,
        *,
        content_type: str,
    ) -> str:
        normalized_content_type = normalize_image_mime_type(content_type)
        relative = self._inspiration_upload_relative(inspiration_id, normalized_content_type)
        self._write_relative(relative, content, content_type=normalized_content_type)
        self._schedule_image_variants(relative.as_posix())
        return relative.as_posix()

    def copy_to_inspiration_upload(
        self,
        source_object_key: str,
        inspiration_id: str,
        *,
        content_type: str,
    ) -> str:
        normalized_content_type = normalize_image_mime_type(content_type)
        relative = self._inspiration_upload_relative(inspiration_id, normalized_content_type)
        return self._copy_relative(source_object_key, relative, content_type=normalized_content_type)

    def save_reference_upload(
        self,
        inspiration_id: str,
        content: bytes,
        *,
        content_type: str,
    ) -> str:
        normalized_content_type = normalize_image_mime_type(content_type)
        relative = self._reference_upload_relative(inspiration_id, normalized_content_type)
        self._write_relative(relative, content, content_type=normalized_content_type)
        self._schedule_image_variants(relative.as_posix())
        return relative.as_posix()

    def copy_to_reference_upload(
        self,
        source_object_key: str,
        inspiration_id: str,
        *,
        content_type: str,
    ) -> str:
        normalized_content_type = normalize_image_mime_type(content_type)
        relative = self._reference_upload_relative(inspiration_id, normalized_content_type)
        return self._copy_relative(source_object_key, relative, content_type=normalized_content_type)

    def save_context_image_upload(
        self,
        inspiration_id: str,
        content: bytes,
        *,
        content_type: str,
    ) -> str:
        normalized_content_type = normalize_image_mime_type(content_type)
        suffix = image_suffix_for_mime_type(normalized_content_type)
        relative = Path("inspirations") / inspiration_id / "context" / "images" / f"{uuid4()}{suffix}"
        self._write_relative(relative, content, content_type=normalized_content_type)
        self._schedule_image_variants(relative.as_posix())
        return relative.as_posix()

    def save_document_upload(
        self,
        inspiration_id: str,
        filename: str,
        content: bytes,
    ) -> str:
        suffix = Path(filename).suffix.lower() or ".txt"
        relative = Path("inspirations") / inspiration_id / "context" / "documents" / f"{uuid4()}{suffix}"
        self._write_relative(relative, content)
        return relative.as_posix()

    def save_generated_image(
        self,
        inspiration_id: str,
        poster_kind: str,
        content: bytes,
        *,
        content_type: str,
    ) -> str:
        normalized_content_type = normalize_image_mime_type(content_type)
        suffix = image_suffix_for_mime_type(normalized_content_type)
        relative = Path("inspirations") / inspiration_id / "posters" / f"{poster_kind}-{uuid4()}{suffix}"
        self._write_relative(relative, content, content_type=normalized_content_type)
        self._schedule_image_variants(relative.as_posix())
        return relative.as_posix()

    def save_image_session_reference(
        self,
        session_id: str,
        content: bytes,
        *,
        content_type: str,
    ) -> str:
        normalized_content_type = normalize_image_mime_type(content_type)
        relative = self._image_session_reference_relative(session_id, normalized_content_type)
        self._write_relative(relative, content, content_type=normalized_content_type)
        self._schedule_image_variants(relative.as_posix())
        return relative.as_posix()

    def copy_to_image_session_reference(
        self,
        source_object_key: str,
        session_id: str,
        *,
        content_type: str,
    ) -> str:
        normalized_content_type = normalize_image_mime_type(content_type)
        relative = self._image_session_reference_relative(session_id, normalized_content_type)
        return self._copy_relative(source_object_key, relative, content_type=normalized_content_type)

    def save_image_session_generated(
        self,
        session_id: str,
        content: bytes,
        *,
        content_type: str,
    ) -> str:
        normalized_content_type = normalize_image_mime_type(content_type)
        suffix = image_suffix_for_mime_type(normalized_content_type)
        relative = Path("image_sessions") / session_id / "generated" / f"{uuid4()}{suffix}"
        self._write_relative(relative, content, content_type=normalized_content_type)
        self._schedule_image_variants(relative.as_posix())
        return relative.as_posix()

    def save_resource_library_asset(
        self,
        owner_user_id: str,
        content: bytes,
        *,
        content_type: str,
    ) -> str:
        normalized_content_type = normalize_image_mime_type(content_type)
        relative = self._resource_library_asset_relative(owner_user_id, normalized_content_type)
        self._write_relative(relative, content, content_type=normalized_content_type)
        self._schedule_image_variants(relative.as_posix())
        return relative.as_posix()

    def copy_to_resource_library_asset(
        self,
        source_object_key: str,
        owner_user_id: str,
        *,
        content_type: str,
    ) -> str:
        normalized_content_type = normalize_image_mime_type(content_type)
        relative = self._resource_library_asset_relative(owner_user_id, normalized_content_type)
        return self._copy_relative(source_object_key, relative, content_type=normalized_content_type)

    def save_gallery_entry_image(
        self,
        owner_user_id: str,
        content: bytes,
        *,
        content_type: str,
    ) -> str:
        normalized_content_type = normalize_image_mime_type(content_type)
        relative = self._gallery_entry_image_relative(owner_user_id, normalized_content_type)
        self._write_relative(relative, content, content_type=normalized_content_type)
        self._schedule_image_variants(relative.as_posix())
        return relative.as_posix()

    def copy_to_gallery_entry_image(
        self,
        source_object_key: str,
        owner_user_id: str,
        *,
        content_type: str,
    ) -> str:
        normalized_content_type = normalize_image_mime_type(content_type)
        relative = self._gallery_entry_image_relative(owner_user_id, normalized_content_type)
        return self._copy_relative(source_object_key, relative, content_type=normalized_content_type)

    def save_deck_slide_image(
        self,
        deck_id: str,
        slide_index: int,
        content: bytes,
        *,
        content_type: str,
    ) -> str:
        normalized_content_type = normalize_image_mime_type(content_type)
        suffix = image_suffix_for_mime_type(normalized_content_type)
        relative = Path("decks") / deck_id / "slides" / f"slide-{slide_index}-{uuid4()}{suffix}"
        self._write_relative(relative, content, content_type=normalized_content_type)
        self._schedule_image_variants(relative.as_posix())
        return relative.as_posix()

    def save_deck_slide_material(
        self,
        deck_id: str,
        slide_index: int,
        content: bytes,
        *,
        content_type: str,
    ) -> str:
        normalized_content_type = normalize_image_mime_type(content_type)
        suffix = image_suffix_for_mime_type(normalized_content_type)
        relative = Path("decks") / deck_id / "materials" / f"slide-{slide_index}-{uuid4()}{suffix}"
        self._write_relative(relative, content, content_type=normalized_content_type)
        self._schedule_image_variants(relative.as_posix())
        return relative.as_posix()

    def save_deck_pptx(self, deck_id: str, content: bytes) -> str:
        relative = Path("decks") / deck_id / "exports" / f"{uuid4()}.pptx"
        self._write_relative(relative, content)
        return relative.as_posix()

    def save_deck_style_reference(self, deck_id: str, content: bytes, *, content_type: str) -> str:
        normalized_content_type = normalize_image_mime_type(content_type)
        suffix = image_suffix_for_mime_type(normalized_content_type)
        relative = Path("decks") / deck_id / "style" / f"{uuid4()}{suffix}"
        self._write_relative(relative, content, content_type=normalized_content_type)
        self._schedule_image_variants(relative.as_posix())
        return relative.as_posix()

    def save_enhance_tile(
        self,
        output_prefix: str,
        row: int,
        col: int,
        content: bytes,
        *,
        content_type: str,
    ) -> str:
        normalized_content_type = normalize_image_mime_type(content_type)
        suffix = image_suffix_for_mime_type(normalized_content_type)
        relative = self._validated_relative_path(output_prefix) / f"tile-{row}-{col}{suffix}"
        self._write_relative(relative, content, content_type=normalized_content_type)
        return relative.as_posix()

    def save_enhance_final(self, output_prefix: str, content: bytes, *, content_type: str) -> str:
        normalized_content_type = normalize_image_mime_type(content_type)
        suffix = image_suffix_for_mime_type(normalized_content_type)
        relative = self._validated_relative_path(output_prefix) / f"final{suffix}"
        self._write_relative(relative, content, content_type=normalized_content_type)
        self._schedule_image_variants(relative.as_posix())
        return relative.as_posix()

    def save_enhance_input_blob(self, blob_id: str, content: bytes, *, content_type: str) -> str:
        normalized_content_type = normalize_image_mime_type(content_type)
        suffix = image_suffix_for_mime_type(normalized_content_type)
        relative = Path("enhance") / "inputs" / blob_id / f"source{suffix}"
        self._write_relative(relative, content, content_type=normalized_content_type)
        return relative.as_posix()

    def save_image_to_code_file(
        self,
        job_id: str,
        relative_path: str,
        content: bytes,
        *,
        content_type: str | None = None,
        warm_variants: bool = False,
    ) -> str:
        normalized_job_id = job_id.strip().strip("/")
        if not _safe_storage_path_segment(normalized_job_id):
            raise ValueError("图片转代码任务标识无效")
        nested_relative = Path(relative_path)
        if not nested_relative.parts:
            raise ValueError("图片转代码文件路径不能为空")
        relative = self._validated_relative_path(
            (Path("image-to-code") / normalized_job_id / nested_relative).as_posix()
        )
        self._write_relative(relative, content, content_type=content_type)
        if warm_variants:
            self._schedule_image_variants(relative.as_posix())
        return relative.as_posix()

    def put_bytes(
        self,
        object_key: str,
        content: bytes,
        *,
        content_type: str | None = None,
    ) -> StoredObjectRef:
        relative = self._validated_relative_path(object_key)
        return self._backend.put_bytes(
            relative.as_posix(),
            content,
            content_type=content_type or self._guess_media_type_by_name(relative.name),
        )

    def stat(self, object_key: str) -> StoredObjectStat:
        relative = self._validated_relative_path(object_key)
        return self._backend.stat(relative.as_posix())

    def open_stream(
        self,
        object_key: str,
        *,
        byte_range: tuple[int, int | None] | None = None,
    ) -> StorageReadStream:
        relative = self._validated_relative_path(object_key)
        return self._backend.open_stream(relative.as_posix(), byte_range=byte_range)

    def read_bytes(self, object_key: str, *, max_bytes: int) -> bytes:
        if max_bytes < 0:
            raise ValueError("读取大小上限不能小于 0")
        stat = self.stat(object_key)
        if stat.content_length > max_bytes:
            raise StorageObjectTooLarge("存储文件过大")
        stream = self.open_stream(object_key)
        chunks: list[bytes] = []
        total = 0
        try:
            for chunk in stream.iter_chunks():
                total += len(chunk)
                if total > max_bytes:
                    raise StorageObjectTooLarge("存储文件过大")
                chunks.append(chunk)
        finally:
            _close_storage_stream(stream)
        return b"".join(chunks)

    @contextmanager
    def materialize(self, object_key: str) -> Iterator[Path]:
        relative = self._validated_relative_path(object_key)
        if self.backend_impl == "local":
            self.stat(relative.as_posix())
            yield self._local_root() / relative
            return
        temp_dir_root = self._ensure_temp_root()
        try:
            temp_dir = tempfile.TemporaryDirectory(
                prefix="inspiration-one-storage-",
                dir=str(temp_dir_root) if temp_dir_root is not None else None,
            )
        except OSError as exc:
            raise StorageUnavailable("临时存储工作区不可用") from exc
        try:
            destination = Path(temp_dir.name) / relative.name
            stream = self.open_stream(relative.as_posix())
            try:
                _write_stream_to_file(destination, stream)
            except OSError as exc:
                raise StorageUnavailable("临时存储工作区不可用") from exc
            yield destination
        finally:
            try:
                temp_dir.cleanup()
            except Exception:
                logger.exception(
                    "临时存储工作区清理失败: object_key=%s temp_dir=%s",
                    relative.as_posix(),
                    temp_dir.name,
                )

    def copy_object(
        self,
        source_object_key: str,
        destination_object_key: str,
        *,
        content_type: str | None = None,
    ) -> StoredObjectRef:
        source = self._validated_relative_path(source_object_key).as_posix()
        destination = self._validated_relative_path(destination_object_key).as_posix()
        return self._backend.copy_object(source, destination, content_type=content_type)

    def presign_get(
        self,
        object_key: str,
        *,
        expires_in: int | None = None,
        response_filename: str | None = None,
        response_content_type: str | None = None,
    ) -> str | None:
        relative = self._validated_relative_path(object_key)
        return self._backend.presign_get(
            relative.as_posix(),
            expires_in=self.signed_url_ttl_seconds if expires_in is None else expires_in,
            response_filename=response_filename,
            response_content_type=response_content_type,
        )

    def native_path(self, object_key: str) -> Path | None:
        relative = self._validated_relative_path(object_key)
        return self._backend.native_path(relative.as_posix())

    def metadata_for(self, object_key: str) -> StorageObjectMetadata:
        relative = self._validated_relative_path(object_key)
        normalized_key = relative.as_posix()
        return StorageObjectMetadata(
            storage_path=normalized_key,
            storage_backend=self.backend,
            storage_bucket=self.bucket,
            storage_object_key=normalized_key,
        )

    def object_key_for(self, stored_object: Any) -> str:
        object_key = getattr(stored_object, "storage_object_key", None) or getattr(stored_object, "storage_path", None)
        if not isinstance(object_key, str) or not object_key.strip():
            raise InvalidStorageObjectKey("存储对象缺少路径")
        return self._validated_relative_path(object_key).as_posix()

    def _write_relative(self, relative: Path, content: bytes, *, content_type: str | None = None) -> StoredObjectRef:
        return self._backend.put_bytes(
            relative.as_posix(),
            content,
            content_type=content_type or self._guess_media_type_by_name(relative.name),
        )

    def _copy_relative(
        self,
        source_object_key: str,
        relative: Path,
        *,
        content_type: str | None = None,
    ) -> str:
        copied = self.copy_object(source_object_key, relative.as_posix(), content_type=content_type)
        self._schedule_image_variants(copied.object_key)
        return copied.object_key

    def _inspiration_upload_relative(self, inspiration_id: str, content_type: str) -> Path:
        suffix = image_suffix_for_mime_type(content_type)
        return Path("inspirations") / inspiration_id / "source" / f"{uuid4()}{suffix}"

    def _reference_upload_relative(self, inspiration_id: str, content_type: str) -> Path:
        suffix = image_suffix_for_mime_type(content_type)
        return Path("inspirations") / inspiration_id / "reference" / f"{uuid4()}{suffix}"

    def _image_session_reference_relative(self, session_id: str, content_type: str) -> Path:
        suffix = image_suffix_for_mime_type(content_type)
        return Path("image_sessions") / session_id / "reference" / f"{uuid4()}{suffix}"

    def _resource_library_asset_relative(self, owner_user_id: str, content_type: str) -> Path:
        suffix = image_suffix_for_mime_type(content_type)
        return Path("resource_library") / owner_user_id / "images" / f"{uuid4()}{suffix}"

    def _gallery_entry_image_relative(self, owner_user_id: str, content_type: str) -> Path:
        suffix = image_suffix_for_mime_type(content_type)
        return Path("gallery") / owner_user_id / "images" / f"{uuid4()}{suffix}"

    def _local_root(self) -> Path:
        if self.root is None:
            raise RuntimeError("当前存储后端没有本地持久根目录")
        return self.root

    def _ensure_temp_root(self) -> Path | None:
        if self._temp_root is None:
            return None
        self._temp_root.mkdir(parents=True, exist_ok=True)
        return self._temp_root

    def _schedule_image_variants(self, object_key: str) -> None:
        from inspiration_one_backend.infrastructure.queue import try_enqueue_storage_image_variants

        try_enqueue_storage_image_variants(object_key)

    def _validated_relative_path(self, relative_path: str) -> Path:
        return _path_from_object_key(relative_path)

    def _normalized_suffix(self, suffix: str) -> str:
        normalized = suffix.strip().lower()
        if not normalized.startswith("."):
            normalized = f".{normalized}"
        if Path(normalized).name != normalized or normalized in {"", "."}:
            raise ValueError("文件后缀无效")
        return normalized

    def _guess_media_type_by_name(self, filename: str) -> str:
        return _guess_media_type_by_name(filename)


def _safe_storage_path_segment(value: str) -> bool:
    return bool(value) and value not in {".", ".."} and Path(value).name == value


LocalStorage = StorageService
