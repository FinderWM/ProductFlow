from __future__ import annotations

from typing import Any


def build_image_urls(base_download_url: str) -> dict[str, str]:
    return {
        "download_url": base_download_url,
        "preview_url": f"{base_download_url}?variant=preview",
        "thumbnail_url": f"{base_download_url}?variant=thumbnail",
    }


def build_stored_image_urls(_stored_object: Any, fallback_download_url: str) -> dict[str, str]:
    return build_image_urls(fallback_download_url)
