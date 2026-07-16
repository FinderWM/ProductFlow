from __future__ import annotations

from pathlib import Path

IMAGE_MIME_TYPE_TO_SUFFIX: dict[str, str] = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
}

IMAGE_SUFFIX_TO_MIME_TYPE: dict[str, str] = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
}

TRUSTED_IMAGE_MIME_TYPES = frozenset(IMAGE_MIME_TYPE_TO_SUFFIX)


def normalize_image_mime_type(mime_type: str) -> str:
    if not isinstance(mime_type, str):
        raise ValueError("图片类型不能为空")
    normalized = mime_type.split(";", maxsplit=1)[0].strip().lower()
    if normalized not in TRUSTED_IMAGE_MIME_TYPES:
        raise ValueError(f"不支持的图片类型: {normalized or mime_type}")
    return normalized


def image_suffix_for_mime_type(mime_type: str) -> str:
    return IMAGE_MIME_TYPE_TO_SUFFIX[normalize_image_mime_type(mime_type)]


def image_mime_type_for_suffix(filename_or_suffix: str) -> str | None:
    suffix = filename_or_suffix.strip().lower()
    if not suffix.startswith("."):
        suffix = Path(suffix).suffix.lower()
    return IMAGE_SUFFIX_TO_MIME_TYPE.get(suffix)


def safe_image_display_filename(filename: str | None, *, fallback: str = "image") -> str:
    candidate = (filename or "").replace("\\", "/").rsplit("/", maxsplit=1)[-1]
    sanitized = "".join(
        "_" if ord(character) < 32 or ord(character) == 127 else character
        for character in candidate
        if character not in {"\r", "\n"}
    ).strip()
    return sanitized if sanitized not in {"", ".", ".."} else fallback


def safe_image_delivery_filename(
    filename: str | None,
    mime_type: str,
    *,
    fallback: str = "image",
) -> str:
    suffix = image_suffix_for_mime_type(mime_type)
    display_name = safe_image_display_filename(filename, fallback=fallback)
    stem = Path(display_name).stem.strip().rstrip(".")
    if not stem or stem in {".", ".."}:
        stem = fallback
    max_stem_length = max(1, 255 - len(suffix))
    return f"{stem[:max_stem_length]}{suffix}"
