from __future__ import annotations

import mimetypes
import shutil
from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote
from uuid import uuid4

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError
from PIL import Image, ImageOps, UnidentifiedImageError, features

from inspiration_one_backend.config import get_settings

ImageVariantName = Literal["original", "preview", "thumbnail"]

_VARIANT_MAX_EDGE: dict[ImageVariantName, int] = {
    "original": 0,
    "preview": 1600,
    "thumbnail": 320,
}
_VARIANT_SUFFIXES = (".webp", ".jpg")


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


def _write_file(destination: Path, content: bytes) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(content)


def _delete_cached_path(cache_path: Path, *, glob_pattern: str | None = None) -> None:
    if glob_pattern is not None:
        if not cache_path.exists():
            return
        for cached_file in cache_path.glob(glob_pattern):
            cached_file.unlink(missing_ok=True)
        return
    if cache_path.is_dir():
        shutil.rmtree(cache_path)
        return
    cache_path.unlink(missing_ok=True)


class StorageBackend(ABC):
    """对象存储后端接口。

    后端只负责持久化、读取到本地缓存和删除对象；业务路径组织、路径校验、缩略图派生由 StorageService 统一处理。
    """

    name: str

    @abstractmethod
    def write(self, relative: Path, cache_path: Path, content: bytes, content_type: str) -> None:
        raise NotImplementedError

    @abstractmethod
    def resolve(self, relative: Path, cache_path: Path) -> Path:
        raise NotImplementedError

    @abstractmethod
    def delete(self, relative: Path, cache_path: Path) -> None:
        raise NotImplementedError

    @abstractmethod
    def delete_prefix(self, prefix: str, cache_path: Path, *, glob_pattern: str | None = None) -> None:
        raise NotImplementedError


class LocalFilesystemStorageBackend(StorageBackend):
    name = "local"

    def write(self, relative: Path, cache_path: Path, content: bytes, content_type: str) -> None:
        _write_file(cache_path, content)

    def resolve(self, relative: Path, cache_path: Path) -> Path:
        return cache_path

    def delete(self, relative: Path, cache_path: Path) -> None:
        _delete_cached_path(cache_path)

    def delete_prefix(self, prefix: str, cache_path: Path, *, glob_pattern: str | None = None) -> None:
        _delete_cached_path(cache_path, glob_pattern=glob_pattern)


class S3CompatibleStorageBackend(StorageBackend):
    """S3 兼容对象存储后端，当前用于 MinIO，本地 cache 只作为读取/派生缩略图缓存。"""

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
        client: Any | None = None,
    ) -> None:
        self.bucket = bucket
        self.display_name = display_name
        self._client = client or boto3.client(
            "s3",
            endpoint_url=endpoint_url,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region,
            config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        )

    def write(self, relative: Path, cache_path: Path, content: bytes, content_type: str) -> None:
        self._client.put_object(
            Bucket=self.bucket,
            Key=relative.as_posix(),
            Body=BytesIO(content),
            ContentType=content_type,
        )
        _write_file(cache_path, content)

    def resolve(self, relative: Path, cache_path: Path) -> Path:
        if cache_path.exists():
            return cache_path
        try:
            response = self._client.get_object(Bucket=self.bucket, Key=relative.as_posix())
        except ClientError as exc:
            if self._is_missing_object(exc):
                raise ValueError("存储文件不存在") from exc
            raise RuntimeError(f"{self.display_name}访问失败") from exc
        _write_file(cache_path, response["Body"].read())
        return cache_path

    def delete(self, relative: Path, cache_path: Path) -> None:
        try:
            self._client.delete_object(Bucket=self.bucket, Key=relative.as_posix())
        except ClientError:
            pass
        _delete_cached_path(cache_path)

    def delete_prefix(self, prefix: str, cache_path: Path, *, glob_pattern: str | None = None) -> None:
        paginator = self._client.get_paginator("list_objects_v2")
        keys: list[dict[str, str]] = []
        for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
            for item in page.get("Contents", []):
                key = item.get("Key")
                if isinstance(key, str):
                    keys.append({"Key": key})
        for start in range(0, len(keys), 1000):
            self._client.delete_objects(
                Bucket=self.bucket,
                Delete={"Objects": keys[start : start + 1000], "Quiet": True},
            )
        _delete_cached_path(cache_path, glob_pattern=glob_pattern)

    def _is_missing_object(self, exc: ClientError) -> bool:
        error = exc.response.get("Error", {})
        code = str(error.get("Code") or "").lower()
        status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        return code in {"404", "nosuchkey", "notfound", "no-such-key"} or status == 404


StorageBackendFactory = Callable[[Any, Path], StorageBackend]
_STORAGE_BACKEND_FACTORIES: dict[str, StorageBackendFactory] = {}


def register_storage_backend(name: str, factory: StorageBackendFactory) -> None:
    normalized = name.strip().lower()
    if not normalized:
        raise ValueError("存储后端名称不能为空")
    _STORAGE_BACKEND_FACTORIES[normalized] = factory


def _create_local_storage_backend(settings: Any, cache_root: Path) -> StorageBackend:
    return LocalFilesystemStorageBackend()


def _create_s3_compatible_storage_backend(settings: Any, cache_root: Path) -> StorageBackend:
    display_name = "MinIO" if settings.storage_backend == "minio" else "S3 兼容存储"
    return S3CompatibleStorageBackend(
        endpoint_url=settings.s3_endpoint_url,
        bucket=settings.s3_bucket,
        access_key=settings.s3_access_key,
        secret_key=settings.s3_secret_key,
        region=settings.s3_region,
        display_name=display_name,
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
    cache_root = (root or settings.storage_root).resolve()
    return factory(settings, cache_root)


class StorageService:
    """图片存储门面。

    业务层只依赖相对对象 key。实际后端由 STORAGE_BACKEND 选择：local 使用本地文件系统；
    minio/s3 使用 S3 兼容对象存储，并把对象缓存到 STORAGE_ROOT 供缩略图与 provider 输入复用。
    """

    def __init__(self, root: Path | None = None, backend: StorageBackend | None = None) -> None:
        settings = get_settings()
        self.root = (root or settings.storage_root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self._backend = backend or get_storage_backend(settings, root=self.root)
        self.backend = settings.storage_backend
        self.backend_impl = self._backend.name
        self.bucket = getattr(self._backend, "bucket", None)
        self.public_base_url = settings.storage_public_base_url or settings.s3_endpoint_url

    def save_inspiration_upload(
        self,
        inspiration_id: str,
        filename: str,
        content: bytes,
    ) -> str:
        suffix = Path(filename).suffix.lower() or ".bin"
        relative = Path("inspirations") / inspiration_id / "source" / f"{uuid4()}{suffix}"
        self._write_relative(relative, content)
        self._warm_image_variants(relative.as_posix())
        return relative.as_posix()

    def save_reference_upload(
        self,
        inspiration_id: str,
        filename: str,
        content: bytes,
    ) -> str:
        suffix = Path(filename).suffix.lower() or ".bin"
        relative = Path("inspirations") / inspiration_id / "reference" / f"{uuid4()}{suffix}"
        self._write_relative(relative, content)
        self._warm_image_variants(relative.as_posix())
        return relative.as_posix()

    def save_context_image_upload(
        self,
        inspiration_id: str,
        filename: str,
        content: bytes,
    ) -> str:
        suffix = Path(filename).suffix.lower() or ".bin"
        relative = Path("inspirations") / inspiration_id / "context" / "images" / f"{uuid4()}{suffix}"
        self._write_relative(relative, content)
        self._warm_image_variants(relative.as_posix())
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
        suffix: str = ".png",
    ) -> str:
        relative = Path("inspirations") / inspiration_id / "posters" / f"{poster_kind}-{uuid4()}{suffix}"
        self._write_relative(relative, content)
        self._warm_image_variants(relative.as_posix())
        return relative.as_posix()

    def save_image_session_reference(
        self,
        session_id: str,
        filename: str,
        content: bytes,
    ) -> str:
        suffix = Path(filename).suffix.lower() or ".bin"
        relative = Path("image_sessions") / session_id / "reference" / f"{uuid4()}{suffix}"
        self._write_relative(relative, content)
        self._warm_image_variants(relative.as_posix())
        return relative.as_posix()

    def save_image_session_generated(
        self,
        session_id: str,
        content: bytes,
        suffix: str = ".png",
    ) -> str:
        relative = Path("image_sessions") / session_id / "generated" / f"{uuid4()}{suffix}"
        self._write_relative(relative, content)
        self._warm_image_variants(relative.as_posix())
        return relative.as_posix()

    def resolve(self, relative_path: str) -> Path:
        """相对路径转可读的本地路径，防路径穿越攻击。"""

        relative = self._validated_relative_path(relative_path)
        return self._backend.resolve(relative, self._cache_path(relative))

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
            raise ValueError("存储对象缺少路径")
        return self._validated_relative_path(object_key).as_posix()

    def public_url_for_key(self, object_key: str) -> str | None:
        if self.backend not in {"minio", "s3"} or not self.bucket or not self.public_base_url:
            return None
        relative = self._validated_relative_path(object_key)
        bucket = quote(self.bucket.strip("/"), safe="")
        encoded_key = "/".join(quote(part, safe="") for part in relative.parts)
        return f"{self.public_base_url.rstrip('/')}/{bucket}/{encoded_key}"

    def public_urls_for(self, stored_object: Any) -> dict[str, str] | None:
        object_key = self.object_key_for(stored_object)
        download_url = self.public_url_for_key(object_key)
        preview_url = self.public_url_for_key(self._variant_relative_path(Path(object_key), "preview").as_posix())
        thumbnail_url = self.public_url_for_key(self._variant_relative_path(Path(object_key), "thumbnail").as_posix())
        if not download_url or not preview_url or not thumbnail_url:
            return None
        return {
            "download_url": download_url,
            "preview_url": preview_url,
            "thumbnail_url": thumbnail_url,
        }

    def resolve_for_variant(
        self,
        relative_path: str,
        variant: ImageVariantName,
        *,
        fallback_media_type: str = "application/octet-stream",
    ) -> tuple[Path, str]:
        """解析资源路径，若 variant 不是 original 则按需生成缩略图。"""

        relative = self._validated_relative_path(relative_path)
        original = self.resolve(relative.as_posix())
        if not original.exists():
            raise ValueError("存储文件不存在")
        if variant == "original":
            return original, self._guess_media_type(original, fallback=fallback_media_type)

        variant_relative = self._variant_relative_path(relative, variant)
        variant_path = self._cache_path(variant_relative)
        if not variant_path.exists():
            try:
                self._generate_variant(original, variant_path, variant)
                self._write_relative(
                    variant_relative,
                    variant_path.read_bytes(),
                    content_type=self._guess_media_type(variant_path, fallback=fallback_media_type),
                )
            except (OSError, UnidentifiedImageError, ValueError):
                return original, self._guess_media_type(original, fallback=fallback_media_type)

        return variant_path, self._guess_media_type(variant_path, fallback=fallback_media_type)

    def delete_image_with_variants(self, relative_path: str) -> None:
        relative = self._validated_relative_path(relative_path)
        self._delete_relative(relative)
        self._delete_variant_files(relative)
        self._remove_empty_variant_dir(self._cache_path(relative))

    def delete_image_session_tree(self, session_id: str) -> None:
        self._delete_tree(Path("image_sessions") / session_id)

    def delete_inspiration_tree(self, inspiration_id: str) -> None:
        self._delete_tree(Path("inspirations") / inspiration_id)

    def _write_relative(self, relative: Path, content: bytes, *, content_type: str | None = None) -> None:
        self._backend.write(
            relative,
            self._cache_path(relative),
            content,
            content_type or self._guess_media_type_by_name(relative.name),
        )

    def _delete_relative(self, relative: Path) -> None:
        self._backend.delete(relative, self._cache_path(relative))
        self._prune_empty_parents(self._cache_path(relative).parent)

    def _delete_variant_files(self, relative: Path) -> None:
        variant_dir = self._cache_path(relative).parent / ".variants"
        prefix = (relative.parent / ".variants" / f"{relative.stem}.").as_posix()
        self._backend.delete_prefix(prefix, variant_dir, glob_pattern=f"{relative.stem}.*")
        self._remove_empty_variant_dir(self._cache_path(relative))

    def _delete_tree(self, prefix: Path) -> None:
        cache_root = self._cache_path(prefix)
        self._backend.delete_prefix(prefix.as_posix().rstrip("/") + "/", cache_root)

    def _cache_path(self, relative: Path) -> Path:
        return self.root / relative

    def _warm_image_variants(self, relative_path: str) -> None:
        for variant in ("preview", "thumbnail"):
            try:
                self.resolve_for_variant(relative_path, variant)
            except ValueError:
                return

    def _validated_relative_path(self, relative_path: str) -> Path:
        path = Path(relative_path)
        if path.is_absolute():
            raise ValueError("存储路径必须是相对路径")
        resolved = (self.root / path).resolve()
        try:
            resolved.relative_to(self.root)
        except ValueError as exc:
            raise ValueError("存储路径越界") from exc
        return resolved.relative_to(self.root)

    def _variant_relative_path(self, relative: Path, variant: ImageVariantName) -> Path:
        output_suffix = self._variant_output_suffix()
        return relative.parent / ".variants" / f"{relative.stem}.{variant}{output_suffix}"

    def _remove_empty_variant_dir(self, original_path: Path) -> None:
        variant_dir = original_path.parent / ".variants"
        try:
            variant_dir.rmdir()
        except OSError:
            return

    def _prune_empty_parents(self, path: Path) -> None:
        current = path
        while current != self.root and current != current.parent:
            try:
                current.rmdir()
            except OSError:
                break
            current = current.parent

    def _variant_output_suffix(self) -> str:
        if features.check("webp"):
            return ".webp"
        return ".jpg"

    def _generate_variant(
        self,
        original_path: Path,
        variant_path: Path,
        variant: ImageVariantName,
    ) -> None:
        max_edge = _VARIANT_MAX_EDGE[variant]
        if max_edge <= 0:
            raise ValueError("原图不需要派生缩略图")

        with Image.open(original_path) as opened:
            image = ImageOps.exif_transpose(opened)
            rendered = image.copy()

        if rendered.width <= 0 or rendered.height <= 0:
            raise ValueError("无效图片尺寸")

        rendered.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
        self._save_variant_image(rendered, variant_path)

    def _save_variant_image(self, image: Image.Image, destination: Path) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        temp_path = destination.parent / f".{destination.name}.{uuid4().hex}.tmp"

        if destination.suffix == ".webp":
            image.save(temp_path, format="WEBP", quality=84, method=6)
        else:
            prepared = image.convert("RGB") if image.mode not in {"RGB", "L"} else image
            prepared.save(temp_path, format="JPEG", quality=86, optimize=True, progressive=True)

        temp_path.replace(destination)

    def _guess_media_type(self, path: Path, *, fallback: str) -> str:
        return mimetypes.guess_type(path.name)[0] or fallback

    def _guess_media_type_by_name(self, filename: str) -> str:
        return mimetypes.guess_type(filename)[0] or "application/octet-stream"


LocalStorage = StorageService
