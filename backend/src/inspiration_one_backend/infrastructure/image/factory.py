from __future__ import annotations

from sqlalchemy.orm import Session

from inspiration_one_backend.infrastructure.image.base import (
    ImageProvider,
    create_image_provider,
    register_image_provider,
)
from inspiration_one_backend.infrastructure.image.gemini_provider import GoogleGeminiImageProvider
from inspiration_one_backend.infrastructure.image.images_provider import OpenAIImagesImageProvider
from inspiration_one_backend.infrastructure.image.mock_provider import MockImageProvider
from inspiration_one_backend.infrastructure.image.openai_chat_provider import OpenAIChatImageProvider
from inspiration_one_backend.infrastructure.image.responses_provider import OpenAIResponsesImageProvider
from inspiration_one_backend.infrastructure.provider_config import resolve_image_provider_config

register_image_provider("mock", lambda _config: MockImageProvider())
register_image_provider("openai_responses", OpenAIResponsesImageProvider)
register_image_provider("openai_images", OpenAIImagesImageProvider)
register_image_provider("openai_chat_image", OpenAIChatImageProvider)
register_image_provider("google_gemini_image", GoogleGeminiImageProvider)


def get_image_provider(generation_config_id: str | None = None, *, session: Session | None = None) -> ImageProvider:
    """根据统一供应商用途绑定选择图片生成供应商。"""
    provider_config = resolve_image_provider_config(generation_config_id=generation_config_id, session=session)
    return create_image_provider(provider_config)
