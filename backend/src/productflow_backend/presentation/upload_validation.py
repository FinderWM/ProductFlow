from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from pathlib import Path

from fastapi import HTTPException, UploadFile, status
from PIL import Image, UnidentifiedImageError

from productflow_backend.config import get_runtime_settings


@dataclass(frozen=True, slots=True)
class ValidatedUpload:
    content: bytes
    filename: str
    mime_type: str


@dataclass(frozen=True, slots=True)
class ValidatedTextDocumentUpload(ValidatedUpload):
    text: str


_IMAGE_FORMAT_MIME_TYPES = {
    "PNG": "image/png",
    "JPEG": "image/jpeg",
    "WEBP": "image/webp",
}

_TEXT_DOCUMENT_MIME_TYPES = {
    "text/plain",
    "text/markdown",
    "text/csv",
    "application/json",
}
_TEXT_DOCUMENT_EXTENSIONS = {".txt", ".md", ".csv", ".json"}
_TEXT_DOCUMENT_EXTENSION_MIME_TYPES = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".json": "application/json",
}
_MAX_TEXT_DOCUMENT_BYTES = 1_000_000


async def read_validated_image_upload(upload: UploadFile, *, fallback_filename: str) -> ValidatedUpload:
    """校验上传图片：MIME 类型 / 大小 / 像素 / 内容格式一致性。"""
    settings = get_runtime_settings()
    filename = upload.filename or fallback_filename
    declared_mime = (upload.content_type or "application/octet-stream").split(";", maxsplit=1)[0].strip().lower()
    if declared_mime not in settings.allowed_image_mime_types:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"不支持的图片类型: {declared_mime}",
        )

    content = await upload.read(settings.upload_max_image_bytes + 1)
    if len(content) > settings.upload_max_image_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"图片超过大小限制: {settings.upload_max_image_bytes} bytes",
        )
    if not content:
        raise HTTPException(status_code=400, detail="图片内容不能为空")

    try:
        with Image.open(BytesIO(content)) as image:
            image.verify()
        with Image.open(BytesIO(content)) as image:
            width, height = image.size
            detected_mime = _IMAGE_FORMAT_MIME_TYPES.get(image.format or "")
    except (OSError, UnidentifiedImageError) as exc:
        raise HTTPException(status_code=400, detail="上传文件不是可解码图片") from exc

    if width <= 0 or height <= 0 or width * height > settings.upload_max_pixels:
        raise HTTPException(
            status_code=400,
            detail=f"图片像素超过限制: {settings.upload_max_pixels}",
        )
    if detected_mime not in settings.allowed_image_mime_types:
        raise HTTPException(status_code=415, detail="不支持的真实图片格式")
    if detected_mime != declared_mime:
        raise HTTPException(status_code=400, detail="图片内容格式与 Content-Type 不一致")

    return ValidatedUpload(content=content, filename=filename, mime_type=detected_mime)


def validate_reference_image_count(count: int) -> None:
    max_count = get_runtime_settings().upload_max_reference_images
    if count > max_count:
        raise HTTPException(status_code=400, detail=f"参考图最多上传 {max_count} 张")


async def read_validated_text_document_upload(
    upload: UploadFile,
    *,
    fallback_filename: str,
) -> ValidatedTextDocumentUpload:
    filename = upload.filename or fallback_filename
    suffix = Path(filename).suffix.lower()
    if suffix not in _TEXT_DOCUMENT_EXTENSIONS:
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="不支持的文档扩展名")

    declared_mime = (upload.content_type or "application/octet-stream").split(";", maxsplit=1)[0].strip().lower()
    if declared_mime in {"", "application/octet-stream"}:
        declared_mime = _TEXT_DOCUMENT_EXTENSION_MIME_TYPES[suffix]
    if declared_mime not in _TEXT_DOCUMENT_MIME_TYPES:
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail=f"不支持的文档类型: {declared_mime}",
        )

    content = await upload.read(_MAX_TEXT_DOCUMENT_BYTES + 1)
    if len(content) > _MAX_TEXT_DOCUMENT_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="文档超过大小限制")
    if not content:
        raise HTTPException(status_code=400, detail="文档内容不能为空")

    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="文档必须使用 UTF-8 编码") from exc

    return ValidatedTextDocumentUpload(content=content, filename=filename, mime_type=declared_mime, text=text)
