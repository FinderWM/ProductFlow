from __future__ import annotations

DEFAULT_UI_LAYOUT_SCHEME = "classic"
SUPPORTED_UI_LAYOUT_SCHEMES = ("classic", "workspace")


def is_supported_ui_layout_scheme(value: str | None) -> bool:
    return value in SUPPORTED_UI_LAYOUT_SCHEMES


def resolve_ui_layout_scheme(value: str | None) -> str:
    if is_supported_ui_layout_scheme(value):
        return value
    return DEFAULT_UI_LAYOUT_SCHEME
