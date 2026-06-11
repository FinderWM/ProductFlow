"""OpenAI-compatible Chat Completions image provider.

This adapter is for third-party gateways whose image models return images from
`/v1/chat/completions`, for example Packy Banana/Gemini image models.
"""

from __future__ import annotations

import logging
import re
from base64 import b64decode, b64encode, urlsafe_b64decode
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx

from inspiration_one_backend.application.contracts import PosterGenerationInput
from inspiration_one_backend.config import get_runtime_settings
from inspiration_one_backend.domain.enums import PosterKind
from inspiration_one_backend.infrastructure.image.base import (
    GeneratedImagePayload,
    ImageProvider,
    image_dimensions_from_bytes,
    parse_size,
)
from inspiration_one_backend.infrastructure.image.images_provider import ImagesReferenceImage
from inspiration_one_backend.infrastructure.image.responses_provider import (
    build_responses_reference_images_from_poster,
    poster_has_reference_input,
)
from inspiration_one_backend.infrastructure.openai_client import (
    OPENAI_COMPATIBLE_DEFAULT_HEADERS,
)
from inspiration_one_backend.infrastructure.prompts import render_prompt_template
from inspiration_one_backend.infrastructure.provider_config import (
    ResolvedImageProviderConfig,
    resolve_image_provider_config,
)

logger = logging.getLogger(__name__)

PROVIDER_REQUEST_FAILURE_MESSAGE = "图片供应商请求失败，请检查供应商配置后重试"
PROVIDER_MISSING_OUTPUT_MESSAGE = "图片供应商没有返回图片结果，请稍后重试"
DEFAULT_CHAT_COMPLETIONS_BASE_URL = "https://api.openai.com/v1"
CHAT_COMPLETIONS_ENDPOINT_FAMILY = "chat/completions"
DATA_URL_RE = re.compile(r"data:(image/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=_-]+)")
URL_RE = re.compile(r"https?://[^\s\"'<>)]+" )
RAW_BASE64_RE = re.compile(r"^[A-Za-z0-9+/=_-]+$")


@dataclass(frozen=True, slots=True)
class ChatImageSource:
    kind: str
    value: str
    mime_type: str | None = None


@dataclass(slots=True)
class ChatCompletionsImageResult:
    bytes_data: bytes
    mime_type: str
    model_name: str
    provider_name: str
    prompt_version: str
    size: str
    generated_at: datetime
    provider_response_id: str | None
    provider_request_json: dict[str, Any]
    provider_output_json: dict[str, Any]


def _mime_type_from_image_bytes(data: bytes) -> str:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "image/webp"
    return "image/png"


def _normalize_chat_completions_url(base_url: str | None) -> str:
    normalized = (base_url or DEFAULT_CHAT_COMPLETIONS_BASE_URL).strip().rstrip("/")
    if normalized.endswith("/chat/completions"):
        return normalized
    if normalized.endswith("/v1"):
        return f"{normalized}/chat/completions"
    return f"{normalized}/v1/chat/completions"


def _image_data_url_from_reference(reference: ImagesReferenceImage) -> str:
    from base64 import b64encode

    return f"data:{reference.mime_type};base64,{b64encode(reference.bytes_data).decode('utf-8')}"


def _decode_data_url(data_url: str) -> tuple[bytes, str] | None:
    match = DATA_URL_RE.search(data_url.strip())
    if match is None:
        return None
    return _decode_raw_base64(match.group(2)), match.group(1)


def _decode_raw_base64(value: str) -> bytes:
    normalized = "".join(value.strip().split())
    padding = "=" * (-len(normalized) % 4)
    if "-" in normalized or "_" in normalized:
        return urlsafe_b64decode(normalized + padding)
    return b64decode(normalized + padding, validate=True)


def _is_image_bytes(value: bytes) -> bool:
    return _mime_type_from_image_bytes(value) != "image/png" or image_dimensions_from_bytes(value) is not None


def _raw_base64_image_source(value: str) -> ChatImageSource | None:
    normalized = "".join(value.strip().split())
    if len(normalized) < 64 or not RAW_BASE64_RE.match(normalized):
        return None
    try:
        image_bytes = _decode_raw_base64(normalized)
    except Exception:  # noqa: BLE001
        return None
    if not _is_image_bytes(image_bytes):
        return None
    return ChatImageSource(kind="base64", value=normalized)


def _source_from_string(value: str) -> list[ChatImageSource]:
    normalized = value.strip()
    if not normalized:
        return []
    sources: list[ChatImageSource] = [
        ChatImageSource(kind="data_url", value=match.group(0), mime_type=match.group(1))
        for match in DATA_URL_RE.finditer(normalized)
    ]
    sources.extend(
        ChatImageSource(kind="url", value=match.group(0).rstrip(".,;")) for match in URL_RE.finditer(normalized)
    )
    if sources:
        return sources
    raw_source = _raw_base64_image_source(normalized)
    return [raw_source] if raw_source is not None else []


def _image_sources_from_value(value: Any) -> list[ChatImageSource]:
    if value is None:
        return []
    if isinstance(value, str):
        return _source_from_string(value)
    if isinstance(value, list | tuple):
        sources: list[ChatImageSource] = []
        for item in value:
            sources.extend(_image_sources_from_value(item))
        return sources
    if not isinstance(value, dict):
        return []

    sources: list[ChatImageSource] = []
    image_url = value.get("image_url")
    if isinstance(image_url, str):
        sources.extend(_source_from_string(image_url))
    elif isinstance(image_url, dict):
        sources.extend(_image_sources_from_value(image_url.get("url")))

    for key in ("url", "b64_json", "base64", "image_base64", "data", "content", "text"):
        sources.extend(_image_sources_from_value(value.get(key)))

    for nested_key in ("images", "parts", "output", "data"):
        nested = value.get(nested_key)
        if nested is not value:
            sources.extend(_image_sources_from_value(nested))
    return sources


def _dedupe_sources(sources: list[ChatImageSource]) -> list[ChatImageSource]:
    seen: set[tuple[str, str]] = set()
    deduped: list[ChatImageSource] = []
    for source in sources:
        key = (source.kind, source.value)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(source)
    return deduped


def extract_chat_image_sources(response_json: dict[str, Any]) -> list[ChatImageSource]:
    sources: list[ChatImageSource] = []
    choices = response_json.get("choices")
    if isinstance(choices, list):
        for choice in choices:
            if not isinstance(choice, dict):
                continue
            sources.extend(_image_sources_from_value(choice.get("message")))

    if not sources:
        sources.extend(_image_sources_from_value(response_json.get("data")))
    if not sources:
        sources.extend(_image_sources_from_value(response_json))
    return _dedupe_sources(sources)


class OpenAIChatImageClient:
    provider_name = "openai-chat-image"
    prompt_version = "chat-completions-image-v1"

    def __init__(self, provider_config: ResolvedImageProviderConfig | None = None) -> None:
        resolved_config = provider_config or resolve_image_provider_config()
        self.api_key = resolved_config.api_key
        self.base_url = resolved_config.base_url
        self.model = resolved_config.model
        self.endpoint_url = _normalize_chat_completions_url(self.base_url)
        self.request_timeout_seconds = float(get_runtime_settings().workflow_image_generation_provider_timeout_seconds)

    def generate_image(
        self,
        *,
        prompt: str,
        size: str,
        reference_images: list[ImagesReferenceImage] | None = None,
        model: str | None = None,
    ) -> ChatCompletionsImageResult:
        if not self.api_key:
            raise RuntimeError("图片供应商档案缺少 API Key")

        reference_images = reference_images or []
        request_model = model or self.model
        payload = self._build_request_payload(prompt=prompt, reference_images=reference_images, model=request_model)
        request_json = self._build_provider_request_json(
            prompt=prompt,
            model=request_model,
            size=size,
            reference_images=reference_images,
        )
        try:
            response_json = self._post_chat_completions(payload)
            sources = extract_chat_image_sources(response_json)
            if not sources:
                raise RuntimeError(PROVIDER_MISSING_OUTPUT_MESSAGE)
            image_bytes, mime_type, source = self._load_image_source(sources[0])
        except RuntimeError as exc:
            if str(exc) == PROVIDER_MISSING_OUTPUT_MESSAGE:
                raise
            logger.error("OpenAI Chat 图片供应商失败: %s", type(exc).__name__, exc_info=True)
            raise RuntimeError(PROVIDER_REQUEST_FAILURE_MESSAGE) from exc
        except Exception as exc:  # noqa: BLE001
            logger.error("OpenAI Chat 图片供应商失败: %s", type(exc).__name__, exc_info=True)
            raise RuntimeError(PROVIDER_REQUEST_FAILURE_MESSAGE) from exc

        return ChatCompletionsImageResult(
            bytes_data=image_bytes,
            mime_type=mime_type,
            model_name=request_model,
            provider_name=self.provider_name,
            prompt_version=self.prompt_version,
            size=size,
            generated_at=datetime.now(UTC),
            provider_response_id=self._response_id(response_json),
            provider_request_json=request_json,
            provider_output_json=self._build_provider_output_json(
                response_json=response_json,
                source=source,
                image_bytes=image_bytes,
                mime_type=mime_type,
            ),
        )

    def _build_request_payload(
        self,
        *,
        prompt: str,
        reference_images: list[ImagesReferenceImage],
        model: str,
    ) -> dict[str, Any]:
        content: str | list[dict[str, Any]]
        if reference_images:
            content = [{"type": "text", "text": prompt}]
            content.extend(
                {
                    "type": "image_url",
                    "image_url": {"url": _image_data_url_from_reference(reference)},
                }
                for reference in reference_images
            )
        else:
            content = prompt
        return {
            "model": model,
            "messages": [{"role": "user", "content": content}],
            "stream": False,
        }

    def _post_chat_completions(self, payload: dict[str, Any]) -> dict[str, Any]:
        headers = {
            **OPENAI_COMPATIBLE_DEFAULT_HEADERS,
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        with httpx.Client(timeout=self.request_timeout_seconds, headers=headers) as client:
            response = client.post(self.endpoint_url, json=payload)
            response.raise_for_status()
            return self._parse_chat_image_response(response)

    def _parse_chat_image_response(self, response: httpx.Response) -> dict[str, Any]:
        try:
            response_payload = response.json()
        except ValueError as exc:
            non_json_payload = self._parse_non_json_image_response(response)
            if non_json_payload is None:
                raise RuntimeError(PROVIDER_MISSING_OUTPUT_MESSAGE) from exc
            return non_json_payload
        if isinstance(response_payload, dict):
            return response_payload
        return {"data": response_payload}

    def _parse_non_json_image_response(self, response: httpx.Response) -> dict[str, Any] | None:
        content = bytes(response.content or b"")
        if not content:
            return None
        content_type = response.headers.get("content-type", "").split(";", maxsplit=1)[0].strip().lower()
        if content_type.startswith("image/") or _is_image_bytes(content):
            mime_type = content_type if content_type.startswith("image/") else _mime_type_from_image_bytes(content)
            return {
                "data": [{"b64_json": b64encode(content).decode("utf-8")}],
                "_inspiration_one_non_json": {
                    "response_format": "raw_image",
                    "content_type": mime_type,
                },
            }

        text = content.decode("utf-8", errors="ignore").strip()
        if not text or not _source_from_string(text):
            return None
        return {
            "choices": [{"message": {"content": text}, "finish_reason": "stop"}],
            "_inspiration_one_non_json": {
                "response_format": "text_image_reference",
                "content_type": content_type or None,
            },
        }

    def _load_image_source(self, source: ChatImageSource) -> tuple[bytes, str, ChatImageSource]:
        if source.kind == "data_url":
            decoded = _decode_data_url(source.value)
            if decoded is None:
                raise RuntimeError(PROVIDER_MISSING_OUTPUT_MESSAGE)
            return decoded[0], decoded[1], source
        if source.kind == "base64":
            image_bytes = _decode_raw_base64(source.value)
            return image_bytes, _mime_type_from_image_bytes(image_bytes), source
        if source.kind == "url":
            headers = {"User-Agent": OPENAI_COMPATIBLE_DEFAULT_HEADERS["User-Agent"], "Accept": "image/*"}
            with httpx.Client(timeout=self.request_timeout_seconds, headers=headers) as client:
                response = client.get(source.value)
                response.raise_for_status()
                image_bytes = response.content
                content_type = response.headers.get("content-type", "").split(";", maxsplit=1)[0].strip().lower()
            mime_type = content_type if content_type.startswith("image/") else _mime_type_from_image_bytes(image_bytes)
            return image_bytes, mime_type, source
        raise RuntimeError(PROVIDER_MISSING_OUTPUT_MESSAGE)

    def _build_provider_request_json(
        self,
        *,
        prompt: str,
        model: str,
        size: str,
        reference_images: list[ImagesReferenceImage],
    ) -> dict[str, Any]:
        return {
            "endpoint": CHAT_COMPLETIONS_ENDPOINT_FAMILY,
            "model": model,
            "size": size,
            "stream": False,
            "message_content_format": "parts" if reference_images else "string",
            "message_count": 1,
            "prompt_character_count": len(prompt),
            "reference_image_count": len(reference_images),
            "reference_images": [
                {
                    "filename": reference.filename,
                    "mime_type": reference.mime_type,
                    "byte_count": len(reference.bytes_data),
                }
                for reference in reference_images
            ],
        }

    def _build_provider_output_json(
        self,
        *,
        response_json: dict[str, Any],
        source: ChatImageSource,
        image_bytes: bytes,
        mime_type: str,
    ) -> dict[str, Any]:
        choices = response_json.get("choices") if isinstance(response_json.get("choices"), list) else []
        finish_reasons = [
            choice.get("finish_reason")
            for choice in choices
            if isinstance(choice, dict) and choice.get("finish_reason") is not None
        ]
        output_json = {
            key: response_json.get(key)
            for key in ("id", "object", "created", "model")
            if response_json.get(key) is not None
        }
        output_json["choices_count"] = len(choices)
        if finish_reasons:
            output_json["finish_reasons"] = finish_reasons
        non_json_metadata = response_json.get("_inspiration_one_non_json")
        if isinstance(non_json_metadata, dict):
            response_format = non_json_metadata.get("response_format")
            content_type = non_json_metadata.get("content_type")
            if response_format:
                output_json["response_format"] = str(response_format)
            if content_type:
                output_json["content_type"] = str(content_type)
        output_json["_inspiration_one"] = {
            "endpoint": CHAT_COMPLETIONS_ENDPOINT_FAMILY,
            "stream": False,
            "image_source": source.kind,
            "image_mime_type": mime_type,
            "image_byte_count": len(image_bytes),
        }
        return output_json

    def _response_id(self, response_json: dict[str, Any]) -> str | None:
        value = response_json.get("id")
        return str(value) if value else None


class OpenAIChatImageProvider(ImageProvider):
    provider_name = "openai-chat-image"
    prompt_version = "chat-completions-poster-image-v1"

    def __init__(self, provider_config: ResolvedImageProviderConfig | None = None) -> None:
        self.provider_config = provider_config or resolve_image_provider_config()

    def generate_poster_image(
        self,
        poster: PosterGenerationInput,
        kind: PosterKind,
    ) -> tuple[GeneratedImagePayload, str]:
        return self.generate_poster_images(poster=poster, kind=kind, count=1)[0]

    def generate_poster_images(
        self,
        poster: PosterGenerationInput,
        kind: PosterKind,
        count: int,
    ) -> list[tuple[GeneratedImagePayload, str]]:
        if count <= 0:
            return []
        settings = get_runtime_settings()
        client = OpenAIChatImageClient(self.provider_config)
        size = poster.image_size or (
            settings.image_main_image_size if kind == PosterKind.MAIN_IMAGE else settings.image_promo_poster_size
        )
        prompt = self._build_prompt(poster, kind, size, settings)
        reference_images = self._build_reference_images_from_poster(poster)
        model = (
            self._optional_tool_text(poster.tool_options.get("model"))
            if isinstance(poster.tool_options, dict)
            else None
        )
        results = [
            client.generate_image(prompt=prompt, size=size, reference_images=reference_images, model=model)
            for _ in range(count)
        ]
        return [
            (self._payload_from_chat_result(result, kind=kind, size=size, index=index), result.model_name)
            for index, result in enumerate(results, start=1)
        ]

    def _payload_from_chat_result(
        self,
        result: ChatCompletionsImageResult,
        *,
        kind: PosterKind,
        size: str,
        index: int,
    ) -> GeneratedImagePayload:
        width, height = parse_size(size)
        dims = image_dimensions_from_bytes(result.bytes_data)
        if dims:
            width, height = dims
        return GeneratedImagePayload(
            kind=kind,
            bytes_data=result.bytes_data,
            mime_type=result.mime_type,
            width=width,
            height=height,
            variant_label=f"v{index}",
            provider_response_id=result.provider_response_id,
            provider_output_json=result.provider_output_json,
        )

    def _build_prompt(self, poster: PosterGenerationInput, kind: PosterKind, size: str, settings: Any) -> str:
        copy_mode = poster.copy_prompt_mode == "copy"
        template = settings.prompt_poster_image_template if copy_mode else settings.prompt_poster_image_edit_template
        return render_prompt_template(
            template,
            {
                "inspiration_name": poster.inspiration_name,
                "category": poster.category or "",
                "price": poster.price or "",
                "source_note": poster.source_note or "",
                "instruction": poster.instruction or "自由生成。",
                "context_block": self._build_context_block(poster),
                "reference_policy": (
                    settings.prompt_poster_image_reference_policy if poster_has_reference_input(poster) else ""
                ),
                "size": size,
                "kind": kind.value,
                "kind_label": "主图" if kind == PosterKind.MAIN_IMAGE else "促销海报",
                "kind_requirements": self._build_kind_requirements(kind),
            },
        )

    def _build_context_block(self, poster: PosterGenerationInput) -> str:
        lines: list[str] = []
        if poster.inspiration_name:
            lines.append(f"- 画面主体：{poster.inspiration_name}")
        if poster.category:
            lines.append(f"- 类目/类型：{poster.category}")
        if poster.price:
            lines.append(f"- 价格：{poster.price}")
        if poster.source_note:
            lines.append(f"- 补充说明：{poster.source_note}")
        if poster.copy_prompt_mode == "copy" and poster.structured_copy_context:
            lines.append(
                "- 可用文案参考（仅在用户要求图片包含文字时使用，不要绘制字段名、标签名或上下文说明）：\n"
                f"{poster.structured_copy_context}"
            )
        if poster.reference_images or poster.source_image is not None:
            reference_paths = {str(reference.path.resolve()) for reference in poster.reference_images}
            if poster.source_image is not None:
                reference_paths.add(str(poster.source_image.resolve()))
            lines.append(f"- 参考图片数量：{len(reference_paths)}")
            if poster.source_image is not None:
                lines.append("- 灵感产物原图：第 1 张输入图片")
            reference_labels = [
                f"{reference.label or reference.filename}（角色：{reference.role or '参考图'}）"
                for reference in poster.reference_images
            ]
            if reference_labels:
                lines.append(f"- 参考图：{'；'.join(reference_labels)}")
        return "\n".join(lines) if lines else "- 无显式上游上下文。"

    def _build_kind_requirements(self, kind: PosterKind) -> str:
        kind_label = "主图" if kind == PosterKind.MAIN_IMAGE else "海报/竖图"
        return (
            f"输出用途：{kind_label}。上游上下文只用于理解画面主体、材质、场景和文案参考；"
            "不要把字段名、标签名、JSON key、上下文说明、品牌、水印或 UI 面板画进图片。"
        )

    def _build_reference_images_from_poster(self, poster: PosterGenerationInput) -> list[ImagesReferenceImage]:
        return [
            ImagesReferenceImage(
                bytes_data=reference.bytes_data,
                mime_type=reference.mime_type,
                filename=reference.filename or f"reference-{index}.png",
            )
            for index, reference in enumerate(build_responses_reference_images_from_poster(poster), start=1)
        ]

    def _optional_tool_text(self, value: Any) -> str | None:
        normalized = "" if value is None else str(value).strip()
        return normalized or None
