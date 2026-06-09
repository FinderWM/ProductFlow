from __future__ import annotations

from sqlalchemy.orm import Session

from inspiration_one_backend.infrastructure.image.base import ImageProvider
from inspiration_one_backend.infrastructure.image.gemini_provider import GoogleGeminiImageProvider
from inspiration_one_backend.infrastructure.image.images_provider import OpenAIImagesImageProvider
from inspiration_one_backend.infrastructure.image.mock_provider import MockImageProvider
from inspiration_one_backend.infrastructure.image.openai_chat_provider import OpenAIChatImageProvider
from inspiration_one_backend.infrastructure.image.responses_provider import OpenAIResponsesImageProvider
from inspiration_one_backend.infrastructure.provider_config import resolve_image_provider_config


def get_image_provider(generation_config_id: str | None = None, *, session: Session | None = None) -> ImageProvider:
    """根据统一供应商用途绑定选择图片生成供应商。"""
    provider_config = resolve_image_provider_config(generation_config_id=generation_config_id, session=session)
    if provider_config.provider_kind == "mock":
        return MockImageProvider()
    if provider_config.provider_kind == "openai_responses":
        return OpenAIResponsesImageProvider(provider_config)
    if provider_config.provider_kind == "openai_images":
        return OpenAIImagesImageProvider(provider_config)
    if provider_config.provider_kind == "openai_chat_image":
        return OpenAIChatImageProvider(provider_config)
    if provider_config.provider_kind == "google_gemini_image":
        return GoogleGeminiImageProvider(provider_config)
    raise RuntimeError(f"暂不支持的图片 provider: {provider_config.provider_kind}")
