from __future__ import annotations

import asyncio
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, RedirectResponse, Response, StreamingResponse
from fastapi.testclient import TestClient

import inspiration_one_backend.presentation.storage_responses as storage_responses
from inspiration_one_backend.application.storage_variants import SelectedStorageImage
from inspiration_one_backend.infrastructure.storage import LocalStorage, StorageObjectNotFound, StoredObjectStat
from inspiration_one_backend.presentation.storage_responses import (
    download_storage_object,
    image_storage_object,
    stream_storage_object,
)


class _FakeReadStream:
    def __init__(
        self,
        content: bytes,
        *,
        stat: StoredObjectStat,
        fail_after_first_chunk: bool = False,
        fail_close: bool = False,
    ) -> None:
        self.stat = stat
        self._content = content
        self._fail_after_first_chunk = fail_after_first_chunk
        self._fail_close = fail_close
        self.closed = False

    def iter_chunks(self, chunk_size: int = 1024 * 1024) -> Iterator[bytes]:
        del chunk_size
        split_at = max(1, len(self._content) // 2)
        first = self._content[:split_at]
        if first:
            yield first
        if self._fail_after_first_chunk:
            raise RuntimeError("stream failed")
        remaining = self._content[split_at:]
        if remaining:
            yield remaining

    def close(self) -> None:
        self.closed = True
        if self._fail_close:
            raise RuntimeError("close failed")


class _RemoteStorage:
    def __init__(
        self,
        content: bytes = b"0123456789",
        *,
        object_key: str = "objects/demo.bin",
        content_type: str = "application/octet-stream",
        presigned_url: str | None = None,
        presign_error: Exception | None = None,
        fail_stream: bool = False,
        fail_stream_close: bool = False,
    ) -> None:
        self.content = content
        self.object_key = object_key
        self.stat_value = StoredObjectStat(
            object_key=object_key,
            content_type=content_type,
            content_length=len(content),
            etag="object-etag",
            last_modified=datetime(2026, 7, 14, 8, 30, tzinfo=UTC),
        )
        self.presigned_url = presigned_url
        self.presign_error = presign_error
        self.fail_stream = fail_stream
        self.fail_stream_close = fail_stream_close
        self.open_calls: list[tuple[str, tuple[int, int | None] | None]] = []
        self.presign_calls: list[dict[str, Any]] = []
        self.streams: list[_FakeReadStream] = []
        self.native_path_calls = 0

    def stat(self, object_key: str) -> StoredObjectStat:
        assert object_key == self.object_key
        return self.stat_value

    def open_stream(
        self,
        object_key: str,
        *,
        byte_range: tuple[int, int | None] | None = None,
    ) -> _FakeReadStream:
        assert object_key == self.object_key
        self.open_calls.append((object_key, byte_range))
        content = self.content
        if byte_range is not None:
            start, end = byte_range
            content = content[start:] if end is None else content[start : end + 1]
        stream = _FakeReadStream(
            content,
            stat=self.stat_value,
            fail_after_first_chunk=self.fail_stream,
            fail_close=self.fail_stream_close,
        )
        self.streams.append(stream)
        return stream

    def native_path(self, object_key: str) -> None:
        assert object_key == self.object_key
        self.native_path_calls += 1
        return None

    def presign_get(
        self,
        object_key: str,
        *,
        response_filename: str,
        response_content_type: str,
    ) -> str | None:
        assert object_key == self.object_key
        self.presign_calls.append(
            {
                "object_key": object_key,
                "response_filename": response_filename,
                "response_content_type": response_content_type,
            }
        )
        if self.presign_error is not None:
            raise self.presign_error
        return self.presigned_url


def _make_client(response_factory: Callable[[Request], Response]) -> TestClient:
    app = FastAPI()

    @app.get("/")
    def endpoint(request: Request) -> Response:
        return response_factory(request)

    return TestClient(app)


async def _consume_streaming_response(response: StreamingResponse) -> bytes:
    chunks: list[bytes] = []
    async for chunk in response.body_iterator:
        chunks.append(chunk if isinstance(chunk, bytes) else chunk.encode())
    return b"".join(chunks)


def test_stream_storage_object_returns_metadata_and_closes_stream() -> None:
    storage = _RemoteStorage(content=b"response-body")
    client = _make_client(
        lambda _request: stream_storage_object(
            storage,
            storage.object_key,
            filename="封面.png",
            disposition_type="attachment",
            extra_headers={"X-Frame-Options": "DENY", "X-Content-Type-Options": "unsafe"},
        )
    )

    response = client.get("/")

    assert response.status_code == 200
    assert response.content == b"response-body"
    assert response.headers["content-length"] == str(len(response.content))
    assert response.headers["accept-ranges"] == "bytes"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["etag"] == '"object-etag"'
    assert response.headers["last-modified"] == "Tue, 14 Jul 2026 08:30:00 GMT"
    assert 'filename="download.png"' in response.headers["content-disposition"]
    assert "filename*=UTF-8''%E5%B0%81%E9%9D%A2.png" in response.headers["content-disposition"]
    assert storage.open_calls == [(storage.object_key, None)]
    assert storage.streams[0].closed is True


@pytest.mark.parametrize(
    ("range_header", "expected_range", "expected_body"),
    [
        ("bytes=2-5", (2, 5), b"2345"),
        ("bytes=7-", (7, 9), b"789"),
        ("bytes=-3", (7, 9), b"789"),
        ("bytes=0-99", (0, 9), b"0123456789"),
    ],
)
def test_stream_storage_object_supports_single_ranges(
    range_header: str,
    expected_range: tuple[int, int],
    expected_body: bytes,
) -> None:
    storage = _RemoteStorage()
    client = _make_client(
        lambda request: stream_storage_object(
            storage,
            storage.object_key,
            range_header=request.headers.get("range"),
        )
    )

    response = client.get("/", headers={"Range": range_header})

    assert response.status_code == 206
    assert response.content == expected_body
    assert response.headers["content-range"] == f"bytes {expected_range[0]}-{expected_range[1]}/10"
    assert response.headers["content-length"] == str(len(expected_body))
    assert storage.open_calls == [(storage.object_key, expected_range)]
    assert storage.streams[0].closed is True


@pytest.mark.parametrize(
    "range_header",
    [
        "items=0-1",
        "bytes=1-2,4-5",
        "bytes=10-",
        "bytes=+1-2",
        "bytes=2-1",
        "bytes=-0",
    ],
)
def test_stream_storage_object_rejects_invalid_or_unsatisfied_ranges(range_header: str) -> None:
    storage = _RemoteStorage()
    client = _make_client(
        lambda request: stream_storage_object(
            storage,
            storage.object_key,
            range_header=request.headers.get("range"),
            extra_headers={"X-Content-Type-Options": "unsafe"},
        )
    )

    response = client.get("/", headers={"Range": range_header})

    assert response.status_code == 416
    assert response.content == b""
    assert response.headers["content-range"] == "bytes */10"
    assert response.headers["content-length"] == "0"
    assert response.headers["accept-ranges"] == "bytes"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["etag"] == '"object-etag"'
    assert storage.open_calls == []


def test_stream_storage_object_closes_stream_when_iteration_fails() -> None:
    storage = _RemoteStorage(fail_stream=True)
    response = stream_storage_object(storage, storage.object_key)
    assert isinstance(response, StreamingResponse)

    with pytest.raises(RuntimeError, match="stream failed"):
        asyncio.run(_consume_streaming_response(response))

    assert storage.streams[0].closed is True


def test_stream_storage_object_does_not_mask_iteration_error_when_close_fails() -> None:
    storage = _RemoteStorage(fail_stream=True, fail_stream_close=True)
    response = stream_storage_object(storage, storage.object_key)
    assert isinstance(response, StreamingResponse)

    with pytest.raises(RuntimeError, match="stream failed"):
        asyncio.run(_consume_streaming_response(response))

    assert storage.streams[0].closed is True


def test_stream_storage_object_closes_stream_when_consumer_stops_early() -> None:
    storage = _RemoteStorage(content=b"two-chunks")
    response = stream_storage_object(storage, storage.object_key)
    assert isinstance(response, StreamingResponse)

    async def consume_first_chunk() -> bytes:
        iterator = response.body_iterator.__aiter__()
        chunk = await anext(iterator)
        await iterator.aclose()
        return chunk if isinstance(chunk, bytes) else chunk.encode()

    assert asyncio.run(consume_first_chunk()) == b"two-c"
    assert storage.streams[0].closed is True


def test_download_storage_object_uses_local_file_response(configured_env: Path, tmp_path: Path) -> None:
    del configured_env
    storage = LocalStorage(root=tmp_path)
    object_key = "exports/report.txt"
    storage.put_bytes(object_key, b"local-report", content_type="text/plain")

    response = download_storage_object(storage, object_key, filename="report.txt")

    assert isinstance(response, FileResponse)
    assert response.headers["content-disposition"].startswith('attachment; filename="report.txt"')
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["accept-ranges"] == "bytes"


def test_stream_storage_object_uses_local_file_response(configured_env: Path, tmp_path: Path) -> None:
    del configured_env
    storage = LocalStorage(root=tmp_path)
    object_key = "preview/index.html"
    storage.put_bytes(object_key, b"<html></html>", content_type="text/html")

    response = stream_storage_object(
        storage,
        object_key,
        media_type="text/html; charset=utf-8",
        extra_headers={"Content-Security-Policy": "default-src 'none'"},
    )

    assert isinstance(response, FileResponse)
    assert response.headers["content-security-policy"] == "default-src 'none'"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_download_storage_object_redirects_to_presigned_url_with_required_headers() -> None:
    storage = _RemoteStorage(presigned_url="https://objects.example/demo?signature=ok")

    response = download_storage_object(
        storage,
        storage.object_key,
        filename="报告\r\n.pdf",
        extra_headers={"Cache-Control": "public", "Referrer-Policy": "origin"},
    )

    assert isinstance(response, RedirectResponse)
    assert response.status_code == 307
    assert response.headers["location"] == "https://objects.example/demo?signature=ok"
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert storage.presign_calls == [
        {
            "object_key": storage.object_key,
            "response_filename": "报告.pdf",
            "response_content_type": "application/octet-stream",
        }
    ]
    assert storage.open_calls == []


def test_download_storage_object_falls_back_to_stream_when_presign_fails() -> None:
    storage = _RemoteStorage(content=b"fallback", presign_error=RuntimeError("presign unavailable"))
    client = _make_client(
        lambda _request: download_storage_object(storage, storage.object_key, filename="fallback.bin")
    )

    response = client.get("/")

    assert response.status_code == 200
    assert response.content == b"fallback"
    assert response.headers["content-disposition"].startswith('attachment; filename="fallback.bin"')
    assert len(storage.presign_calls) == 1
    assert storage.streams[0].closed is True


def test_image_storage_object_keeps_pending_variant_same_origin_and_uncacheable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    storage = _RemoteStorage(content=b"original", object_key="images/source.png", content_type="image/png")
    monkeypatch.setattr(
        storage_responses,
        "select_image_variant",
        lambda _storage, _object_key, _variant: SelectedStorageImage(
            requested_variant="preview",
            object_key=storage.object_key,
            stat=storage.stat_value,
            pending=True,
        ),
    )

    response = image_storage_object(
        storage,
        storage.object_key,
        variant="preview",
        filename="source.html",
        fallback_media_type="image/png",
        extra_headers={"Cache-Control": "public", "X-Image-Variant": "ready"},
    )

    assert isinstance(response, StreamingResponse)
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-image-variant"] == "pending"
    assert response.media_type == "image/png"
    assert response.headers["content-disposition"].startswith('inline; filename="source.png"')
    assert storage.presign_calls == []
    assert asyncio.run(_consume_streaming_response(response)) == b"original"
    assert storage.streams[0].closed is True


@pytest.mark.parametrize("fallback_media_type", [None, "text/html", "image/svg+xml", "application/javascript"])
def test_image_storage_object_rejects_untrusted_original_media_type(
    monkeypatch: pytest.MonkeyPatch,
    fallback_media_type: str | None,
) -> None:
    storage = _RemoteStorage(content=b"image<script>", object_key="images/source.html", content_type="text/html")
    monkeypatch.setattr(
        storage_responses,
        "select_image_variant",
        lambda _storage, _object_key, _variant: SelectedStorageImage(
            requested_variant="original",
            object_key=storage.object_key,
            stat=storage.stat_value,
            pending=False,
        ),
    )

    with pytest.raises(StorageObjectNotFound):
        image_storage_object(
            storage,
            storage.object_key,
            filename="source.html",
            fallback_media_type=fallback_media_type,
        )


@pytest.mark.parametrize(
    ("variant_key", "expected_media_type", "expected_filename"),
    [
        ("images/.variants/source.preview.webp", "image/webp", "source-preview.webp"),
        ("images/.variants/source.preview.jpg", "image/jpeg", "source-preview.jpg"),
    ],
)
def test_image_storage_object_uses_variant_suffix_media_type_and_safe_filename(
    monkeypatch: pytest.MonkeyPatch,
    variant_key: str,
    expected_media_type: str,
    expected_filename: str,
) -> None:
    storage = _RemoteStorage(content=b"preview", object_key=variant_key, content_type="application/octet-stream")
    monkeypatch.setattr(
        storage_responses,
        "select_image_variant",
        lambda _storage, _object_key, _variant: SelectedStorageImage(
            requested_variant="preview",
            object_key=variant_key,
            stat=storage.stat_value,
            pending=False,
        ),
    )

    response = image_storage_object(
        storage,
        "images/source.png",
        variant="preview",
        filename="source.html",
    )

    assert isinstance(response, StreamingResponse)
    assert response.media_type == expected_media_type
    assert response.headers["content-disposition"].startswith(f'inline; filename="{expected_filename}"')
    assert "x-image-variant" not in response.headers
    assert storage.presign_calls == []
    assert asyncio.run(_consume_streaming_response(response)) == b"preview"
    assert storage.streams[0].closed is True
