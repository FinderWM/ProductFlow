"""Provider 工厂注册表回归测试。

锁定 B1（image/text 工厂注册表化）的行为契约：
- 注册表覆盖全部 provider_kind；
- create_image_provider 对未知 kind 报错、create_text_provider 可回退；
- get_text_provider_from_config 对未知 kind 仍回退 mock（保持历史兜底行为）。
"""

from __future__ import annotations

import pytest

# 导入工厂模块以触发注册（注册发生在 factory 模块顶层）
import inspiration_one_backend.infrastructure.image.factory  # noqa: F401
import inspiration_one_backend.infrastructure.text.factory  # noqa: F401
from inspiration_one_backend.infrastructure.image.base import (
    _IMAGE_PROVIDER_FACTORIES,
    ImageProvider,
    create_image_provider,
    register_image_provider,
)
from inspiration_one_backend.infrastructure.image.mock_provider import MockImageProvider
from inspiration_one_backend.infrastructure.provider_config import (
    IMAGE_PROVIDER_KINDS,
    TEXT_PROVIDER_KINDS,
    ResolvedImageProviderConfig,
    ResolvedTextProviderConfig,
)
from inspiration_one_backend.infrastructure.text.base import (
    _TEXT_PROVIDER_FACTORIES,
    TextProvider,
    create_text_provider,
    register_text_provider,
)
from inspiration_one_backend.infrastructure.text.factory import get_text_provider_from_config
from inspiration_one_backend.infrastructure.text.mock_provider import MockTextProvider


def _image_config(provider_kind: str) -> ResolvedImageProviderConfig:
    return ResolvedImageProviderConfig(provider_kind=provider_kind, model="test-model")  # type: ignore[arg-type]


def _text_config(provider_kind: str) -> ResolvedTextProviderConfig:
    return ResolvedTextProviderConfig(provider_kind=provider_kind, brief_model="b", copy_model="c")  # type: ignore[arg-type]


def test_image_registry_covers_all_provider_kinds() -> None:
    assert set(_IMAGE_PROVIDER_FACTORIES) == IMAGE_PROVIDER_KINDS


def test_text_registry_covers_all_provider_kinds() -> None:
    assert set(_TEXT_PROVIDER_FACTORIES) == TEXT_PROVIDER_KINDS


def test_create_image_provider_mock_returns_mock() -> None:
    provider = create_image_provider(_image_config("mock"))
    assert isinstance(provider, MockImageProvider)
    assert isinstance(provider, ImageProvider)


def test_create_image_provider_unknown_kind_raises() -> None:
    with pytest.raises(RuntimeError, match="不支持的图片 provider"):
        create_image_provider(_image_config("does_not_exist"))


def test_create_text_provider_unknown_kind_raises_without_default() -> None:
    with pytest.raises(RuntimeError, match="不支持的文本 provider"):
        create_text_provider(_text_config("does_not_exist"))


def test_create_text_provider_unknown_kind_uses_default_factory() -> None:
    provider = create_text_provider(_text_config("does_not_exist"), default_factory=lambda _c: MockTextProvider())
    assert isinstance(provider, MockTextProvider)


def test_get_text_provider_from_config_falls_back_to_mock() -> None:
    # 历史兜底行为：未知 provider_kind 解析为 mock，而非报错
    provider = get_text_provider_from_config(_text_config("does_not_exist"))
    assert isinstance(provider, MockTextProvider)
    assert isinstance(provider, TextProvider)


def test_register_image_provider_is_dynamic() -> None:
    sentinel_kind = "__test_sentinel_image__"
    assert sentinel_kind not in _IMAGE_PROVIDER_FACTORIES
    register_image_provider(sentinel_kind, lambda _c: MockImageProvider())
    try:
        provider = create_image_provider(_image_config(sentinel_kind))
        assert isinstance(provider, MockImageProvider)
    finally:
        # 注册表是模块级全局，务必清理，避免跨用例状态泄漏
        _IMAGE_PROVIDER_FACTORIES.pop(sentinel_kind, None)


def test_register_text_provider_is_dynamic() -> None:
    sentinel_kind = "__test_sentinel_text__"
    assert sentinel_kind not in _TEXT_PROVIDER_FACTORIES
    register_text_provider(sentinel_kind, lambda _c: MockTextProvider())
    try:
        provider = create_text_provider(_text_config(sentinel_kind))
        assert isinstance(provider, MockTextProvider)
    finally:
        _TEXT_PROVIDER_FACTORIES.pop(sentinel_kind, None)
