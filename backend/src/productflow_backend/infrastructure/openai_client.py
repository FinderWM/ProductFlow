from __future__ import annotations

from typing import Any

OPENAI_COMPATIBLE_DEFAULT_HEADERS = {"User-Agent": "ProductFlow/1.0", "Accept": "application/json"}
OPENAI_COMPATIBLE_DEFAULT_TIMEOUT_SECONDS = 120.0


def build_openai_client_kwargs(*, api_key: str | None, base_url: str | None = None) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "api_key": api_key,
        "default_headers": dict(OPENAI_COMPATIBLE_DEFAULT_HEADERS),
        "timeout": OPENAI_COMPATIBLE_DEFAULT_TIMEOUT_SECONDS,
    }
    if base_url:
        kwargs["base_url"] = base_url
    return kwargs
