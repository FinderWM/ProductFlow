from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from helpers import _make_demo_image_bytes_with_size
from redis.exceptions import ConnectionError as RedisConnectionError

from inspiration_one_backend.application.storage_variants import (
    STORAGE_VARIANT_LOCK_TTL_SECONDS,
    STORAGE_VARIANT_MAX_RETRIES,
    STORAGE_VARIANT_RETRY_MAX_BACKOFF_MS,
    STORAGE_VARIANT_RETRY_MIN_BACKOFF_MS,
    STORAGE_VARIANT_WORKER_TIME_LIMIT_MS,
    StorageVariantLockLost,
    execute_storage_image_variants,
    find_variant,
    select_image_variant,
)
from inspiration_one_backend.infrastructure.storage import (
    InvalidStorageObjectKey,
    LocalStorage,
    StorageObjectNotFound,
    StorageObjectTooLarge,
    StorageUnavailable,
)


class _FakeLock:
    def __init__(
        self,
        *,
        acquired: bool,
        owned_results: list[bool | Exception] | None = None,
        release_error: Exception | None = None,
    ) -> None:
        self.acquired = acquired
        self.owned_results = list(owned_results or [acquired])
        self.release_error = release_error
        self.acquire_calls: list[bool] = []
        self.owned_calls = 0
        self.release_calls = 0

    def acquire(self, blocking: bool = True) -> bool:
        self.acquire_calls.append(blocking)
        return self.acquired

    def release(self) -> None:
        self.release_calls += 1
        if self.release_error is not None:
            raise self.release_error

    def owned(self) -> bool:
        self.owned_calls += 1
        result = self.owned_results.pop(0) if len(self.owned_results) > 1 else self.owned_results[0]
        if isinstance(result, Exception):
            raise result
        return result


class _FakeRedisClient:
    def __init__(self, lock: _FakeLock) -> None:
        self._lock = lock
        self.lock_calls: list[dict[str, Any]] = []

    def lock(
        self,
        name: str,
        *,
        timeout: int,
        blocking_timeout: int,
    ) -> _FakeLock:
        self.lock_calls.append(
            {
                "name": name,
                "timeout": timeout,
                "blocking_timeout": blocking_timeout,
            }
        )
        return self._lock


def test_storage_variant_execution_returns_when_distributed_lock_is_busy(configured_env: Path) -> None:
    del configured_env
    storage = LocalStorage()
    lock = _FakeLock(acquired=False)
    redis_client = _FakeRedisClient(lock)

    executed = execute_storage_image_variants(
        "gallery/owner/images/original.png",
        storage=storage,
        redis_client=redis_client,
    )

    assert executed is False
    assert lock.acquire_calls == [False]
    assert lock.release_calls == 0
    assert redis_client.lock_calls == [
        {
            "name": redis_client.lock_calls[0]["name"],
            "timeout": STORAGE_VARIANT_LOCK_TTL_SECONDS,
            "blocking_timeout": 0,
        }
    ]
    assert redis_client.lock_calls[0]["name"].startswith("inspiration-one:storage-variants:local:")


def test_storage_variant_execution_generates_inside_lock_and_releases_it(configured_env: Path) -> None:
    del configured_env
    storage = LocalStorage()
    original_key = "gallery/owner/images/original.png"
    storage.put_bytes(
        original_key,
        _make_demo_image_bytes_with_size(1000, 800),
        content_type="image/png",
    )
    lock = _FakeLock(acquired=True)

    executed = execute_storage_image_variants(
        original_key,
        storage=storage,
        redis_client=_FakeRedisClient(lock),
    )

    assert executed is True
    assert lock.acquire_calls == [False]
    assert lock.release_calls == 1
    assert storage.stat("gallery/owner/images/.variants/original.preview.webp").content_length > 0
    assert storage.stat("gallery/owner/images/.variants/original.thumbnail.webp").content_length > 0
    assert lock.owned_calls == 2


def test_storage_variant_execution_releases_lock_when_generation_fails(configured_env: Path) -> None:
    del configured_env
    storage = LocalStorage()
    original_key = "gallery/owner/images/not-an-image.png"
    storage.put_bytes(original_key, b"not-an-image", content_type="image/png")
    lock = _FakeLock(acquired=True)

    with pytest.raises(ValueError, match="存储对象不是可解码图片"):
        execute_storage_image_variants(
            original_key,
            storage=storage,
            redis_client=_FakeRedisClient(lock),
        )

    assert lock.release_calls == 1


def test_storage_variant_execution_does_not_write_after_lock_is_lost(configured_env: Path) -> None:
    del configured_env
    storage = LocalStorage()
    original_key = "gallery/owner/images/original.png"
    storage.put_bytes(
        original_key,
        _make_demo_image_bytes_with_size(1000, 800),
        content_type="image/png",
    )
    lock = _FakeLock(acquired=True, owned_results=[False])

    with pytest.raises(StorageVariantLockLost):
        execute_storage_image_variants(
            original_key,
            storage=storage,
            redis_client=_FakeRedisClient(lock),
        )

    assert find_variant(storage, original_key, "preview") is None
    assert find_variant(storage, original_key, "thumbnail") is None
    assert lock.release_calls == 1


def test_storage_variant_execution_stops_between_writes_when_lock_is_lost(configured_env: Path) -> None:
    del configured_env
    storage = LocalStorage()
    original_key = "gallery/owner/images/original.png"
    storage.put_bytes(
        original_key,
        _make_demo_image_bytes_with_size(1000, 800),
        content_type="image/png",
    )
    lock = _FakeLock(acquired=True, owned_results=[True, False])

    with pytest.raises(StorageVariantLockLost):
        execute_storage_image_variants(
            original_key,
            storage=storage,
            redis_client=_FakeRedisClient(lock),
        )

    assert find_variant(storage, original_key, "preview") is not None
    assert find_variant(storage, original_key, "thumbnail") is None
    assert lock.release_calls == 1


def test_storage_variant_release_error_does_not_mask_generation_error(configured_env: Path) -> None:
    del configured_env
    storage = LocalStorage()
    original_key = "gallery/owner/images/not-an-image.png"
    storage.put_bytes(original_key, b"not-an-image", content_type="image/png")
    lock = _FakeLock(
        acquired=True,
        release_error=RedisConnectionError("redis unavailable"),
    )

    with pytest.raises(ValueError, match="存储对象不是可解码图片"):
        execute_storage_image_variants(
            original_key,
            storage=storage,
            redis_client=_FakeRedisClient(lock),
        )

    assert lock.release_calls == 1


def test_storage_variant_actor_has_finite_retry_and_lock_outlives_time_limit(configured_env: Path) -> None:
    del configured_env
    from inspiration_one_backend.workers import run_storage_image_variants

    assert run_storage_image_variants.options["max_retries"] == STORAGE_VARIANT_MAX_RETRIES
    assert run_storage_image_variants.options["min_backoff"] == STORAGE_VARIANT_RETRY_MIN_BACKOFF_MS
    assert run_storage_image_variants.options["max_backoff"] == STORAGE_VARIANT_RETRY_MAX_BACKOFF_MS
    assert run_storage_image_variants.options["time_limit"] == STORAGE_VARIANT_WORKER_TIME_LIMIT_MS
    assert STORAGE_VARIANT_LOCK_TTL_SECONDS * 1000 > STORAGE_VARIANT_WORKER_TIME_LIMIT_MS


@pytest.mark.parametrize(
    "error",
    [
        StorageObjectNotFound("missing"),
        InvalidStorageObjectKey("invalid"),
        StorageObjectTooLarge("large"),
        ValueError("invalid image"),
    ],
)
def test_storage_variant_actor_does_not_retry_permanent_failures(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
    error: Exception,
) -> None:
    del configured_env
    from inspiration_one_backend import workers

    def fail(_object_key: str) -> bool:
        raise error

    monkeypatch.setattr(workers, "execute_storage_image_variants", fail)

    workers.run_storage_image_variants.fn("gallery/source.png")


def test_storage_variant_actor_reraises_temporary_storage_failure(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del configured_env
    from inspiration_one_backend import workers

    def fail(_object_key: str) -> bool:
        raise StorageUnavailable("temporary")

    monkeypatch.setattr(workers, "execute_storage_image_variants", fail)

    with pytest.raises(StorageUnavailable, match="temporary"):
        workers.run_storage_image_variants.fn("gallery/source.png")


def test_enqueue_storage_image_variants_sends_object_key(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del configured_env
    from inspiration_one_backend import workers
    from inspiration_one_backend.infrastructure import queue

    sent: list[str] = []
    monkeypatch.setattr(queue, "get_broker", lambda: object())
    monkeypatch.setattr(workers.run_storage_image_variants, "send", sent.append)

    queue.enqueue_storage_image_variants("gallery/source.png")

    assert sent == ["gallery/source.png"]


def test_image_save_schedules_variants_without_synchronous_generation(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del configured_env
    from inspiration_one_backend.infrastructure import queue

    scheduled: list[str] = []
    monkeypatch.setattr(queue, "enqueue_storage_image_variants", scheduled.append)
    storage = LocalStorage()

    image_key = storage.save_inspiration_upload("insp-1", b"image", content_type="image/png")
    document_key = storage.save_document_upload("insp-1", "notes.txt", b"notes")

    assert scheduled == [image_key]
    assert document_key not in scheduled
    assert find_variant(storage, image_key, "preview") is None
    assert find_variant(storage, image_key, "thumbnail") is None


def test_variant_enqueue_failure_does_not_fail_original_save(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del configured_env
    from inspiration_one_backend.infrastructure import queue

    def fail(_object_key: str) -> None:
        raise RuntimeError("queue unavailable")

    monkeypatch.setattr(queue, "enqueue_storage_image_variants", fail)
    storage = LocalStorage()

    object_key = storage.save_inspiration_upload("insp-1", b"image", content_type="image/png")

    assert storage.read_bytes(object_key, max_bytes=16) == b"image"


def test_owned_image_copy_schedules_only_the_target_key(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del configured_env
    from inspiration_one_backend.infrastructure import queue

    scheduled: list[str] = []
    monkeypatch.setattr(queue, "enqueue_storage_image_variants", scheduled.append)
    storage = LocalStorage()
    source_key = storage.put_bytes("source/original.png", b"image", content_type="image/png").object_key

    target_key = storage.copy_to_gallery_entry_image(
        source_key,
        "owner-1",
        content_type="image/png",
    )

    assert scheduled == [target_key]
    assert storage.read_bytes(source_key, max_bytes=16) == b"image"
    assert storage.read_bytes(target_key, max_bytes=16) == b"image"


def test_variant_selector_falls_back_to_original_and_schedules_generation(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del configured_env
    from inspiration_one_backend.infrastructure import queue

    scheduled: list[str] = []

    def schedule(key: str) -> bool:
        scheduled.append(key)
        return True

    monkeypatch.setattr(queue, "try_enqueue_storage_image_variants", schedule)
    storage = LocalStorage()
    original_key = storage.put_bytes(
        "gallery/owner/images/original.png",
        _make_demo_image_bytes_with_size(800, 600),
        content_type="image/png",
    ).object_key

    selected = select_image_variant(storage, original_key, "preview")

    assert selected.object_key == original_key
    assert selected.stat.content_type == "image/png"
    assert selected.pending is True
    assert scheduled == [original_key]
    assert find_variant(storage, original_key, "preview") is None
