from __future__ import annotations

from pathlib import Path
from typing import Any

from productflow_backend.infrastructure.storage import LocalStorage


def build_image_urls(base_download_url: str) -> dict[str, str]:
    return {
        "download_url": base_download_url,
        "preview_url": f"{base_download_url}?variant=preview",
        "thumbnail_url": f"{base_download_url}?variant=thumbnail",
    }


def build_stored_image_urls(stored_object: Any, fallback_download_url: str) -> dict[str, str]:
    return LocalStorage().public_urls_for(stored_object) or build_image_urls(fallback_download_url)


def build_variant_filename(original_filename: str, *, variant: str, resolved_suffix: str) -> str:
    if variant == "original":
        return original_filename
    stem = Path(original_filename).stem or "image"
    return f"{stem}-{variant}{resolved_suffix}"
