from __future__ import annotations

from sqlalchemy.orm import Session

from inspiration_one_backend.infrastructure.provider_config import resolve_text_provider_config
from inspiration_one_backend.infrastructure.text.base import TextProvider
from inspiration_one_backend.infrastructure.text.mock_provider import MockTextProvider
from inspiration_one_backend.infrastructure.text.openai_provider import OpenAITextProvider


def get_text_provider(generation_config_id: str | None = None, *, session: Session | None = None) -> TextProvider:
    """根据统一供应商用途绑定选择文本生成供应商。"""
    provider_config = resolve_text_provider_config(generation_config_id=generation_config_id, session=session)
    if provider_config.provider_kind == "openai":
        return OpenAITextProvider(provider_config)
    return MockTextProvider()
