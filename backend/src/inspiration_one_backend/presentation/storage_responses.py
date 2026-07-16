from __future__ import annotations

import logging
import unicodedata
from collections.abc import Iterator, Mapping
from datetime import UTC
from email.utils import format_datetime
from pathlib import Path
from typing import Literal, NoReturn
from urllib.parse import quote

from fastapi import HTTPException, status
from fastapi.responses import FileResponse, RedirectResponse, Response, StreamingResponse

from inspiration_one_backend.application.storage_variants import (
    RequestedStorageImageVariantName,
    SelectedStorageImage,
    select_image_variant,
)
from inspiration_one_backend.domain.image_media import (
    image_mime_type_for_suffix,
    normalize_image_mime_type,
    safe_image_delivery_filename,
)
from inspiration_one_backend.infrastructure.storage import (
    InvalidStorageObjectKey,
    LocalStorage,
    StorageError,
    StorageObjectNotFound,
    StorageUnavailable,
    StoredObjectStat,
)

ContentDispositionType = Literal["inline", "attachment"]

logger = logging.getLogger(__name__)


def raise_storage_response_error(exc: StorageError, *, not_found_detail: str) -> NoReturn:
    """Translate storage delivery failures at the HTTP boundary without leaking backend details."""

    if isinstance(exc, (StorageObjectNotFound, InvalidStorageObjectKey)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=not_found_detail) from exc
    if isinstance(exc, StorageUnavailable):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="存储服务暂不可用，请稍后重试",
        ) from exc
    raise exc


class RangeNotSatisfiable(ValueError):
    pass


def _parse_single_range(range_header: str | None, *, total_length: int) -> tuple[int, int] | None:
    if range_header is None:
        return None
    unit, separator, raw_value = range_header.strip().partition("=")
    if separator != "=" or unit.strip().lower() != "bytes":
        raise RangeNotSatisfiable("仅支持 bytes Range")
    value = raw_value.strip()
    if not value or "," in value or total_length <= 0:
        raise RangeNotSatisfiable("Range 不可满足")
    raw_start, dash, raw_end = value.partition("-")
    if dash != "-":
        raise RangeNotSatisfiable("Range 格式无效")

    if not raw_start:
        suffix_length = _parse_range_number(raw_end)
        if suffix_length <= 0:
            raise RangeNotSatisfiable("Range 长度无效")
        start = max(total_length - suffix_length, 0)
        return start, total_length - 1

    start = _parse_range_number(raw_start)
    if start < 0 or start >= total_length:
        raise RangeNotSatisfiable("Range 起始位置越界")
    if not raw_end:
        return start, total_length - 1
    end = _parse_range_number(raw_end)
    if end < start:
        raise RangeNotSatisfiable("Range 结束位置无效")
    return start, min(end, total_length - 1)


def _parse_range_number(value: str) -> int:
    if not value or not value.isascii() or not value.isdecimal():
        raise RangeNotSatisfiable("Range 格式无效")
    return int(value)


def _etag_header(etag: str | None) -> str | None:
    if not etag:
        return None
    normalized = etag.strip()
    if not normalized or any(character in normalized for character in ("\r", "\n")):
        return None
    if normalized.startswith('W/"') or (normalized.startswith('"') and normalized.endswith('"')):
        return normalized
    if '"' in normalized:
        return None
    return f'"{normalized}"'


def _last_modified_header(stat: StoredObjectStat) -> str | None:
    if stat.last_modified is None:
        return None
    value = stat.last_modified
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return format_datetime(value.astimezone(UTC), usegmt=True)


def _sanitize_filename(filename: str) -> str:
    characters: list[str] = []
    for character in filename:
        if character in {"\r", "\n"}:
            continue
        characters.append("_" if ord(character) < 32 or ord(character) == 127 else character)
    sanitized = "".join(characters)
    return sanitized.replace("/", "_").replace("\\", "_").strip() or "download"


def _safe_ascii_filename(filename: str) -> str:
    sanitized = _sanitize_filename(filename)
    suffix = unicodedata.normalize("NFKD", Path(sanitized).suffix).encode("ascii", "ignore").decode()
    ascii_name = unicodedata.normalize("NFKD", sanitized).encode("ascii", "ignore").decode().strip()
    ascii_name = ascii_name.replace('"', "_")
    ascii_name = "".join(character if 32 <= ord(character) < 127 else "_" for character in ascii_name)
    if not ascii_name or ascii_name in {".", "..", suffix}:
        return f"download{suffix}"
    return ascii_name


def _content_disposition(filename: str, disposition_type: ContentDispositionType) -> str:
    sanitized = _sanitize_filename(filename)
    fallback = _safe_ascii_filename(sanitized)
    encoded = quote(sanitized, safe="")
    return f'{disposition_type}; filename="{fallback}"; filename*=UTF-8\'\'{encoded}'


def _response_headers(
    stat: StoredObjectStat,
    *,
    content_length: int,
    filename: str | None,
    disposition_type: ContentDispositionType | None,
    extra_headers: Mapping[str, str] | None,
) -> dict[str, str]:
    headers = dict(extra_headers or {})
    headers.update(
        {
            "Accept-Ranges": "bytes",
            "Content-Length": str(content_length),
            "X-Content-Type-Options": "nosniff",
        }
    )
    etag = _etag_header(stat.etag)
    if etag is not None:
        headers["ETag"] = etag
    last_modified = _last_modified_header(stat)
    if last_modified is not None:
        headers["Last-Modified"] = last_modified
    if filename and disposition_type:
        headers["Content-Disposition"] = _content_disposition(filename, disposition_type)
    return headers


def _stream_body(stream, *, object_key: str) -> Iterator[bytes]:
    try:
        yield from stream.iter_chunks()
    except Exception:
        logger.exception("存储对象流式响应中断: object_key=%s", object_key)
        raise
    finally:
        try:
            stream.close()
        except Exception:
            logger.exception("存储对象响应流关闭失败: object_key=%s", object_key)


def _range_not_satisfiable_response(
    stat: StoredObjectStat,
    *,
    extra_headers: Mapping[str, str] | None,
) -> Response:
    headers = _response_headers(
        stat,
        content_length=0,
        filename=None,
        disposition_type=None,
        extra_headers=extra_headers,
    )
    headers["Content-Range"] = f"bytes */{stat.content_length}"
    return Response(status_code=416, headers=headers)


def stream_storage_object(
    storage: LocalStorage,
    object_key: str,
    *,
    range_header: str | None = None,
    filename: str | None = None,
    disposition_type: ContentDispositionType | None = None,
    media_type: str | None = None,
    extra_headers: Mapping[str, str] | None = None,
    stat: StoredObjectStat | None = None,
) -> Response:
    resolved_stat = stat or storage.stat(object_key)
    try:
        byte_range = _parse_single_range(range_header, total_length=resolved_stat.content_length)
    except RangeNotSatisfiable:
        return _range_not_satisfiable_response(resolved_stat, extra_headers=extra_headers)

    if byte_range is None:
        native_path = storage.native_path(object_key)
        if native_path is not None:
            return _local_file_response(
                native_path,
                resolved_stat,
                filename=filename,
                disposition_type=disposition_type,
                media_type=media_type,
                extra_headers=extra_headers,
            )

    status_code = 200
    content_length = resolved_stat.content_length
    if byte_range is not None:
        start, end = byte_range
        status_code = 206
        content_length = end - start + 1
    stream = storage.open_stream(object_key, byte_range=byte_range)
    headers = _response_headers(
        resolved_stat,
        content_length=content_length,
        filename=filename,
        disposition_type=disposition_type,
        extra_headers=extra_headers,
    )
    if byte_range is not None:
        start, end = byte_range
        headers["Content-Range"] = f"bytes {start}-{end}/{resolved_stat.content_length}"
    return StreamingResponse(
        _stream_body(stream, object_key=object_key),
        status_code=status_code,
        media_type=media_type or resolved_stat.content_type,
        headers=headers,
    )


def _local_file_response(
    path: Path,
    stat: StoredObjectStat,
    *,
    filename: str | None,
    disposition_type: ContentDispositionType | None,
    media_type: str | None,
    extra_headers: Mapping[str, str] | None,
) -> FileResponse:
    headers = _response_headers(
        stat,
        content_length=stat.content_length,
        filename=filename,
        disposition_type=disposition_type,
        extra_headers=extra_headers,
    )
    return FileResponse(path, media_type=media_type or stat.content_type, headers=headers)


def download_storage_object(
    storage: LocalStorage,
    object_key: str,
    *,
    filename: str,
    range_header: str | None = None,
    media_type: str | None = None,
    extra_headers: Mapping[str, str] | None = None,
    allow_presign: bool = True,
) -> Response:
    stat = storage.stat(object_key)
    resolved_media_type = media_type or stat.content_type
    if range_header is None:
        native_path = storage.native_path(object_key)
        if native_path is not None:
            return _local_file_response(
                native_path,
                stat,
                filename=filename,
                disposition_type="attachment",
                media_type=resolved_media_type,
                extra_headers=extra_headers,
            )
        if allow_presign:
            try:
                signed_url = storage.presign_get(
                    object_key,
                    response_filename=_sanitize_filename(filename),
                    response_content_type=resolved_media_type,
                )
            except Exception as exc:
                logger.warning(
                    "存储附件签名失败，回退流式响应: object_key=%s error_type=%s",
                    object_key,
                    type(exc).__name__,
                )
            else:
                if signed_url:
                    redirect_headers = dict(extra_headers or {})
                    redirect_headers.update(
                        {
                            "Cache-Control": "no-store",
                            "Referrer-Policy": "no-referrer",
                        }
                    )
                    return RedirectResponse(signed_url, status_code=307, headers=redirect_headers)
    return stream_storage_object(
        storage,
        object_key,
        range_header=range_header,
        filename=filename,
        disposition_type="attachment",
        media_type=resolved_media_type,
        extra_headers=extra_headers,
        stat=stat,
    )


def image_storage_object(
    storage: LocalStorage,
    object_key: str,
    *,
    variant: RequestedStorageImageVariantName = "original",
    range_header: str | None = None,
    filename: str | None = None,
    fallback_media_type: str | None = None,
    extra_headers: Mapping[str, str] | None = None,
) -> Response:
    selected = select_image_variant(storage, object_key, variant)
    media_type = _trusted_delivery_image_media_type(
        selected,
        requested_variant=variant,
        fallback_media_type=fallback_media_type,
    )
    resolved_filename = _selected_image_filename(
        filename,
        requested_variant=variant,
        pending=selected.pending,
        media_type=media_type,
    )
    headers = dict(extra_headers or {})
    if selected.pending:
        headers["Cache-Control"] = "no-store"
        headers["X-Image-Variant"] = "pending"
    if range_header is None:
        native_path = storage.native_path(selected.object_key)
        if native_path is not None:
            return _local_file_response(
                native_path,
                selected.stat,
                filename=resolved_filename,
                disposition_type="inline" if resolved_filename else None,
                media_type=media_type,
                extra_headers=headers,
            )
    return stream_storage_object(
        storage,
        selected.object_key,
        range_header=range_header,
        filename=resolved_filename,
        disposition_type="inline" if resolved_filename else None,
        media_type=media_type,
        extra_headers=headers,
        stat=selected.stat,
    )


def _selected_image_filename(
    original_filename: str | None,
    *,
    requested_variant: RequestedStorageImageVariantName,
    pending: bool,
    media_type: str,
) -> str | None:
    if original_filename is None:
        return None
    if requested_variant == "original" or pending:
        return safe_image_delivery_filename(original_filename, media_type)
    stem = Path(safe_image_delivery_filename(original_filename, media_type)).stem or "image"
    return safe_image_delivery_filename(f"{stem}-{requested_variant}", media_type)


def _trusted_delivery_image_media_type(
    selected: SelectedStorageImage,
    *,
    requested_variant: RequestedStorageImageVariantName,
    fallback_media_type: str | None,
) -> str:
    if requested_variant != "original" and not selected.pending:
        media_type = image_mime_type_for_suffix(selected.object_key)
        if media_type is None:
            raise StorageObjectNotFound("图片变体媒体类型无效")
        return media_type
    if fallback_media_type is None:
        raise StorageObjectNotFound("图片媒体类型缺失")
    try:
        return normalize_image_mime_type(fallback_media_type)
    except ValueError as exc:
        raise StorageObjectNotFound("图片媒体类型无效") from exc
