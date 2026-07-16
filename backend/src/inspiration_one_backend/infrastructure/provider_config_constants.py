from __future__ import annotations

import re

# Provider 用途、类型、能力等纯常量。从 provider_config.py 抽出以收敛巨型文件；
# provider_config 仍 re-export 这些名字，外部 import 路径保持不变。

TEXT_PURPOSE = "text"
IMAGE_PURPOSE = "image"
PROVIDER_TYPE_OPENAI_COMPATIBLE = "openai_compatible"
PROVIDER_TYPE_GOOGLE_GEMINI = "google_gemini"
PROVIDER_TYPES = {PROVIDER_TYPE_OPENAI_COMPATIBLE, PROVIDER_TYPE_GOOGLE_GEMINI}

TEXT_PROVIDER_KINDS = {"mock", "openai", "openai_chat_completions"}
IMAGE_PROVIDER_KINDS = {"mock", "openai_responses", "openai_images", "openai_chat_image", "google_gemini_image"}
REAL_IMAGE_PROVIDER_KINDS = IMAGE_PROVIDER_KINDS - {"mock"}
PROVIDER_PURPOSES = {TEXT_PURPOSE, IMAGE_PURPOSE}
CAPABILITY_TEXT_RESPONSES = "text_responses"
CAPABILITY_TEXT_CHAT_COMPLETIONS = "text_chat_completions"
CAPABILITY_IMAGE_RESPONSES = "image_responses"
CAPABILITY_IMAGE_IMAGES = "image_images"
CAPABILITY_IMAGE_CHAT = "image_chat"
CAPABILITY_IMAGE_GOOGLE_GEMINI = "image_google_gemini"
PROVIDER_CAPABILITIES = {
    CAPABILITY_TEXT_RESPONSES,
    CAPABILITY_TEXT_CHAT_COMPLETIONS,
    CAPABILITY_IMAGE_RESPONSES,
    CAPABILITY_IMAGE_IMAGES,
    CAPABILITY_IMAGE_CHAT,
    CAPABILITY_IMAGE_GOOGLE_GEMINI,
}
TEXT_STRUCTURED_JSON_RESPONSE_FORMAT_ENABLED_KEY = "structured_json_response_format_enabled"
TEXT_SUPPORTS_IMAGE_UNDERSTANDING_KEY = "supports_image_understanding"
TEXT_STRUCTURED_OUTPUT_KEY = "structured_output"
TEXT_STRUCTURED_OUTPUT_ENABLED_KEY = "enabled"
TEXT_STRUCTURED_OUTPUT_MODE_KEY = "mode"
TEXT_STRUCTURED_OUTPUT_MODE_JSON_OBJECT = "json_object"
TEXT_STRUCTURED_OUTPUT_MODE_JSON_SCHEMA = "json_schema"
TEXT_STRUCTURED_OUTPUT_MODES = {
    TEXT_STRUCTURED_OUTPUT_MODE_JSON_OBJECT,
    TEXT_STRUCTURED_OUTPUT_MODE_JSON_SCHEMA,
}
UNSET_PROVIDER_FIELD = object()
DEFAULT_GENERATION_CONFIG_PRIORITY = 100
DEFAULT_GENERATION_CONFIG_MAX_CONCURRENCY = 1
DEFAULT_GENERATION_RESOURCE_GROUP_NAME = "default"
RESOURCE_GROUP_KEY_RE = re.compile(r"^[a-z][a-z0-9_-]{1,79}$")

LEGACY_PROVIDER_CONFIG_KEYS = {
    "text_provider_kind",
    "text_api_key",
    "text_base_url",
    "text_brief_model",
    "text_copy_model",
    "image_provider_kind",
    "image_api_key",
    "image_base_url",
    "image_generate_model",
    "image_images_quality",
    "image_images_style",
    "image_responses_background_enabled",
}
