from __future__ import annotations

import hashlib
import logging
from collections.abc import Callable
from dataclasses import dataclass
from io import BytesIO
from pathlib import PurePosixPath
from typing import Any, Literal, Protocol

from PIL import Image, ImageOps, UnidentifiedImageError, features
from redis.exceptions import LockError, RedisError

from inspiration_one_backend.infrastructure.storage import (
    LocalStorage,
    StorageObjectNotFound,
    StoredObjectStat,
)

StorageImageVariantName = Literal["preview", "thumbnail"]
RequestedStorageImageVariantName = Literal["original", "preview", "thumbnail"]

STORAGE_VARIANT_SOURCE_MAX_BYTES = 256 * 1024 * 1024
STORAGE_VARIANT_CONTENT_TYPE = "image/webp"
STORAGE_VARIANT_WORKER_TIME_LIMIT_MS = 10 * 60 * 1000
STORAGE_VARIANT_LOCK_TTL_SECONDS = 11 * 60
STORAGE_VARIANT_MAX_RETRIES = 2
STORAGE_VARIANT_RETRY_MIN_BACKOFF_MS = 5_000
STORAGE_VARIANT_RETRY_MAX_BACKOFF_MS = 60_000
STORAGE_VARIANT_MAX_EDGE: dict[StorageImageVariantName, int] = {
    "preview": 1600,
    "thumbnail": 320,
}
_STORAGE_VARIANT_NAMES: tuple[StorageImageVariantName, ...] = ("preview", "thumbnail")

logger = logging.getLogger(__name__)


class StorageVariantLock(Protocol):
    def acquire(self, blocking: bool = True) -> bool:
        ...

    def release(self) -> None:
        ...

    def owned(self) -> bool:
        ...


class StorageVariantRedisClient(Protocol):
    def lock(
        self,
        name: str,
        *,
        timeout: int,
        blocking_timeout: int,
    ) -> StorageVariantLock:
        ...


@dataclass(frozen=True, slots=True)
class StoredImageVariant:
    name: StorageImageVariantName
    object_key: str
    stat: StoredObjectStat
    is_legacy: bool


@dataclass(frozen=True, slots=True)
class SelectedStorageImage:
    requested_variant: RequestedStorageImageVariantName
    object_key: str
    stat: StoredObjectStat
    pending: bool


class StorageVariantLockLost(RuntimeError):
    """Raised when a worker no longer owns the fencing lock before a variant write."""


def _normalized_object_key(storage: LocalStorage, object_key: str) -> str:
    return storage.metadata_for(object_key).storage_object_key


def storage_variant_lock_name(storage: LocalStorage, object_key: str) -> str:
    normalized = _normalized_object_key(storage, object_key)
    identity = (
        f"{storage.backend_impl}\0{storage.bucket or ''}\0{storage.endpoint_identity or ''}\0{normalized}"
    ).encode()
    digest = hashlib.sha256(identity).hexdigest()
    return f"inspiration-one:storage-variants:{storage.backend_impl}:{digest}"


def _default_redis_client() -> Any:
    from inspiration_one_backend.infrastructure.queue import get_broker

    return get_broker().client


def _variant_object_key(
    normalized_object_key: str,
    variant: StorageImageVariantName,
    *,
    suffix: str,
) -> str:
    relative = PurePosixPath(normalized_object_key)
    return (relative.parent / ".variants" / f"{relative.stem}.{variant}{suffix}").as_posix()


def variant_object_key(
    storage: LocalStorage,
    object_key: str,
    variant: StorageImageVariantName,
) -> str:
    normalized = _normalized_object_key(storage, object_key)
    return _variant_object_key(normalized, variant, suffix=".webp")


def variant_object_key_candidates(
    storage: LocalStorage,
    object_key: str,
    variant: StorageImageVariantName,
) -> tuple[str, str]:
    normalized = _normalized_object_key(storage, object_key)
    return (
        _variant_object_key(normalized, variant, suffix=".webp"),
        _variant_object_key(normalized, variant, suffix=".jpg"),
    )


def find_variant(
    storage: LocalStorage,
    object_key: str,
    variant: StorageImageVariantName,
) -> StoredImageVariant | None:
    for candidate_key, is_legacy in zip(
        variant_object_key_candidates(storage, object_key, variant),
        (False, True),
        strict=True,
    ):
        try:
            stat = storage.stat(candidate_key)
        except StorageObjectNotFound:
            continue
        return StoredImageVariant(
            name=variant,
            object_key=candidate_key,
            stat=stat,
            is_legacy=is_legacy,
        )
    return None


def find_variants(
    storage: LocalStorage,
    object_key: str,
) -> dict[StorageImageVariantName, StoredImageVariant]:
    return {
        variant: found
        for variant in _STORAGE_VARIANT_NAMES
        if (found := find_variant(storage, object_key, variant)) is not None
    }


def select_image_variant(
    storage: LocalStorage,
    object_key: str,
    variant: RequestedStorageImageVariantName,
) -> SelectedStorageImage:
    normalized = _normalized_object_key(storage, object_key)
    if variant == "original":
        return SelectedStorageImage(
            requested_variant=variant,
            object_key=normalized,
            stat=storage.stat(normalized),
            pending=False,
        )

    found = find_variant(storage, normalized, variant)
    if found is not None:
        return SelectedStorageImage(
            requested_variant=variant,
            object_key=found.object_key,
            stat=found.stat,
            pending=False,
        )

    from inspiration_one_backend.infrastructure.queue import try_enqueue_storage_image_variants

    try_enqueue_storage_image_variants(normalized)
    return SelectedStorageImage(
        requested_variant=variant,
        object_key=normalized,
        stat=storage.stat(normalized),
        pending=True,
    )


def generate_missing_variants(
    storage: LocalStorage,
    object_key: str,
    *,
    max_source_bytes: int = STORAGE_VARIANT_SOURCE_MAX_BYTES,
    write_allowed: Callable[[], bool] | None = None,
) -> dict[StorageImageVariantName, str]:
    normalized = _normalized_object_key(storage, object_key)
    existing = find_variants(storage, normalized)
    missing = [variant for variant in _STORAGE_VARIANT_NAMES if variant not in existing]
    if not missing:
        return {variant: existing[variant].object_key for variant in _STORAGE_VARIANT_NAMES}
    if not features.check("webp"):
        raise RuntimeError("当前 Pillow 不支持 WebP 图片变体")

    source_bytes = storage.read_bytes(normalized, max_bytes=max_source_bytes)
    try:
        with Image.open(BytesIO(source_bytes)) as opened:
            transposed = ImageOps.exif_transpose(opened)
            source_image = transposed.copy()
    except (OSError, UnidentifiedImageError) as exc:
        raise ValueError("存储对象不是可解码图片") from exc

    try:
        if source_image.width <= 0 or source_image.height <= 0:
            raise ValueError("存储对象图片尺寸无效")
        generated: dict[StorageImageVariantName, str] = {
            variant: found.object_key for variant, found in existing.items()
        }
        for variant in missing:
            rendered = source_image.copy()
            try:
                max_edge = STORAGE_VARIANT_MAX_EDGE[variant]
                rendered.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
                with BytesIO() as output:
                    rendered.save(output, format="WEBP", quality=84, method=6)
                    rendered_bytes = output.getvalue()
                target_key = _variant_object_key(normalized, variant, suffix=".webp")
                if write_allowed is not None and not write_allowed():
                    raise StorageVariantLockLost("图片变体分布式锁已失效")
                storage.put_bytes(target_key, rendered_bytes, content_type=STORAGE_VARIANT_CONTENT_TYPE)
                generated[variant] = target_key
            finally:
                rendered.close()
        return generated
    finally:
        source_image.close()


def execute_storage_image_variants(
    object_key: str,
    *,
    storage: LocalStorage | None = None,
    redis_client: StorageVariantRedisClient | None = None,
) -> bool:
    storage = storage or LocalStorage()
    normalized = _normalized_object_key(storage, object_key)
    client = redis_client or _default_redis_client()
    lock = client.lock(
        storage_variant_lock_name(storage, normalized),
        timeout=STORAGE_VARIANT_LOCK_TTL_SECONDS,
        blocking_timeout=0,
    )
    if not lock.acquire(blocking=False):
        return False
    try:
        generate_missing_variants(storage, normalized, write_allowed=lock.owned)
        return True
    finally:
        try:
            lock.release()
        except (LockError, RedisError) as exc:
            logger.warning(
                "图片变体分布式锁释放失败，跳过释放: object_key=%s error_type=%s",
                normalized,
                type(exc).__name__,
            )
