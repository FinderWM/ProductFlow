from __future__ import annotations

from sqlalchemy.orm import Session

from inspiration_one_backend.infrastructure.provider_config import (
    ResolvedTextProviderConfig,
    resolve_text_provider_config,
)
from inspiration_one_backend.infrastructure.text.base import (
    TextProvider,
    create_text_provider,
    register_text_provider,
)
from inspiration_one_backend.infrastructure.text.mock_provider import MockTextProvider
from inspiration_one_backend.infrastructure.text.openai_chat_completions_provider import (
    OpenAIChatCompletionsTextProvider,
)
from inspiration_one_backend.infrastructure.text.openai_provider import OpenAITextProvider


def get_text_provider(generation_config_id: str | None = None, *, session: Session | None = None) -> TextProvider:
    """根据统一供应商用途绑定选择文本生成供应商。"""
    provider_config = resolve_text_provider_config(generation_config_id=generation_config_id, session=session)
    return get_text_provider_from_config(provider_config)


register_text_provider("openai", OpenAITextProvider)
register_text_provider("openai_chat_completions", OpenAIChatCompletionsTextProvider)
register_text_provider("mock", lambda _config: MockTextProvider())


def get_text_provider_from_config(provider_config: ResolvedTextProviderConfig) -> TextProvider:
    # 未注册的 provider_kind 回退到 mock，保持既有兜底行为
    return create_text_provider(provider_config, default_factory=lambda _config: MockTextProvider())
