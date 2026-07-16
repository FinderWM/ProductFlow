from __future__ import annotations

from io import BytesIO
from pathlib import Path
from typing import Any

import pytest
from helpers import _make_demo_image_bytes_with_size
from PIL import Image, features

from inspiration_one_backend.application.storage_variants import (
    STORAGE_VARIANT_SOURCE_MAX_BYTES,
    find_variant,
    generate_missing_variants,
    select_image_variant,
    variant_object_key,
    variant_object_key_candidates,
)
from inspiration_one_backend.infrastructure.storage import LocalStorage


class _TrackingStorage:
    def __init__(self) -> None:
        self.inner = LocalStorage()
        self.read_calls: list[tuple[str, int]] = []
        self.put_calls: list[str] = []

    def __getattr__(self, name: str) -> Any:
        return getattr(self.inner, name)

    def read_bytes(self, object_key: str, *, max_bytes: int) -> bytes:
        self.read_calls.append((object_key, max_bytes))
        return self.inner.read_bytes(object_key, max_bytes=max_bytes)

    def put_bytes(self, object_key: str, content: bytes, *, content_type: str | None = None):
        self.put_calls.append(object_key)
        return self.inner.put_bytes(object_key, content, content_type=content_type)


def _stored_image_size(storage: LocalStorage, object_key: str) -> tuple[int, int]:
    content = storage.read_bytes(object_key, max_bytes=10 * 1024 * 1024)
    with Image.open(BytesIO(content)) as image:
        assert image.format == "WEBP"
        return image.size


def test_find_variant_prefers_canonical_webp_then_legacy_jpg(configured_env: Path) -> None:
    del configured_env
    storage = LocalStorage()
    original_key = "gallery/owner/images/original.png"
    storage.put_bytes(original_key, b"original", content_type="image/png")
    canonical_key, legacy_key = variant_object_key_candidates(storage, original_key, "preview")
    storage.put_bytes(legacy_key, b"legacy", content_type="image/jpeg")

    legacy = find_variant(storage, original_key, "preview")

    assert legacy is not None
    assert legacy.object_key == legacy_key
    assert legacy.is_legacy is True

    storage.put_bytes(canonical_key, b"canonical", content_type="image/webp")
    canonical = find_variant(storage, original_key, "preview")

    assert canonical is not None
    assert canonical.object_key == canonical_key
    assert canonical.is_legacy is False


def test_generate_missing_variants_reads_and_decodes_original_once(configured_env: Path) -> None:
    del configured_env
    assert features.check("webp") is True
    storage = _TrackingStorage()
    original_key = "gallery/owner/images/original.png"
    storage.inner.put_bytes(
        original_key,
        _make_demo_image_bytes_with_size(2000, 1000),
        content_type="image/png",
    )

    generated = generate_missing_variants(storage, original_key)

    assert storage.read_calls == [(original_key, STORAGE_VARIANT_SOURCE_MAX_BYTES)]
    assert storage.put_calls == [generated["preview"], generated["thumbnail"]]
    assert generated["preview"].endswith(".preview.webp")
    assert generated["thumbnail"].endswith(".thumbnail.webp")
    assert _stored_image_size(storage.inner, generated["preview"]) == (1600, 800)
    assert _stored_image_size(storage.inner, generated["thumbnail"]) == (320, 160)


def test_generate_missing_variants_keeps_legacy_variant_and_only_writes_missing_one(configured_env: Path) -> None:
    del configured_env
    storage = _TrackingStorage()
    original_key = "gallery/owner/images/original.png"
    storage.inner.put_bytes(
        original_key,
        _make_demo_image_bytes_with_size(800, 600),
        content_type="image/png",
    )
    _, legacy_preview_key = variant_object_key_candidates(storage.inner, original_key, "preview")
    storage.inner.put_bytes(legacy_preview_key, b"legacy", content_type="image/jpeg")

    generated = generate_missing_variants(storage, original_key)

    assert generated["preview"] == legacy_preview_key
    assert storage.read_calls == [(original_key, STORAGE_VARIANT_SOURCE_MAX_BYTES)]
    assert storage.put_calls == [generated["thumbnail"]]
    assert generated["thumbnail"].endswith(".thumbnail.webp")


def test_generate_missing_variants_does_not_read_original_when_both_variants_exist(configured_env: Path) -> None:
    del configured_env
    storage = _TrackingStorage()
    original_key = "gallery/owner/images/original.png"
    storage.inner.put_bytes(original_key, b"not-needed", content_type="image/png")
    preview_key = variant_object_key(storage.inner, original_key, "preview")
    thumbnail_key = variant_object_key(storage.inner, original_key, "thumbnail")
    storage.inner.put_bytes(preview_key, b"preview", content_type="image/webp")
    storage.inner.put_bytes(thumbnail_key, b"thumbnail", content_type="image/webp")

    generated = generate_missing_variants(storage, original_key)

    assert generated == {"preview": preview_key, "thumbnail": thumbnail_key}
    assert storage.read_calls == []
    assert storage.put_calls == []


def test_generate_missing_variants_rejects_undecodable_source(configured_env: Path) -> None:
    del configured_env
    storage = _TrackingStorage()
    original_key = "gallery/owner/images/not-an-image.png"
    storage.inner.put_bytes(original_key, b"not-an-image", content_type="image/png")

    with pytest.raises(ValueError, match="存储对象不是可解码图片"):
        generate_missing_variants(storage, original_key)

    assert storage.read_calls == [(original_key, STORAGE_VARIANT_SOURCE_MAX_BYTES)]
    assert storage.put_calls == []


def test_select_image_variant_returns_original_and_schedules_when_variant_is_pending(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del configured_env
    from inspiration_one_backend.infrastructure import queue

    storage = LocalStorage()
    original_key = "gallery/owner/images/original.png"
    storage.put_bytes(original_key, b"original", content_type="image/png")
    scheduled: list[str] = []

    def schedule(key: str) -> bool:
        scheduled.append(key)
        return True

    monkeypatch.setattr(queue, "try_enqueue_storage_image_variants", schedule)

    selected = select_image_variant(storage, original_key, "preview")

    assert selected.object_key == original_key
    assert selected.pending is True
    assert scheduled == [original_key]


def test_select_image_variant_returns_legacy_variant_without_scheduling(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del configured_env
    from inspiration_one_backend.infrastructure import queue

    storage = LocalStorage()
    original_key = "gallery/owner/images/original.png"
    storage.put_bytes(original_key, b"original", content_type="image/png")
    _, legacy_key = variant_object_key_candidates(storage, original_key, "thumbnail")
    storage.put_bytes(legacy_key, b"legacy", content_type="image/jpeg")
    monkeypatch.setattr(
        queue,
        "try_enqueue_storage_image_variants",
        lambda _key: pytest.fail("已有变体时不应补投任务"),
    )

    selected = select_image_variant(storage, original_key, "thumbnail")

    assert selected.object_key == legacy_key
    assert selected.stat.content_type == "image/jpeg"
    assert selected.pending is False


def test_select_image_variant_keeps_original_fallback_when_enqueue_fails(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    del configured_env
    from inspiration_one_backend.infrastructure import queue

    storage = LocalStorage()
    original_key = "gallery/owner/images/original.png"
    storage.put_bytes(original_key, b"original", content_type="image/png")
    monkeypatch.setattr(queue, "try_enqueue_storage_image_variants", lambda _key: False)

    selected = select_image_variant(storage, original_key, "thumbnail")

    assert selected.object_key == original_key
    assert selected.pending is True
