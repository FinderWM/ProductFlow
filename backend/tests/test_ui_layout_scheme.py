from inspiration_one_backend.domain.ui_layout import (
    DEFAULT_UI_LAYOUT_SCHEME,
    SUPPORTED_UI_LAYOUT_SCHEMES,
    is_supported_ui_layout_scheme,
    resolve_ui_layout_scheme,
)


def test_supported_ui_layout_schemes_are_stable() -> None:
    assert DEFAULT_UI_LAYOUT_SCHEME == "classic"
    assert SUPPORTED_UI_LAYOUT_SCHEMES == ("classic", "workspace")


def test_is_supported_ui_layout_scheme() -> None:
    assert is_supported_ui_layout_scheme("classic") is True
    assert is_supported_ui_layout_scheme("workspace") is True
    assert is_supported_ui_layout_scheme("future") is False
    assert is_supported_ui_layout_scheme(None) is False


def test_resolve_ui_layout_scheme_falls_back_to_classic() -> None:
    assert resolve_ui_layout_scheme("classic") == "classic"
    assert resolve_ui_layout_scheme("workspace") == "workspace"
    assert resolve_ui_layout_scheme("future") == "classic"
    assert resolve_ui_layout_scheme(None) == "classic"
