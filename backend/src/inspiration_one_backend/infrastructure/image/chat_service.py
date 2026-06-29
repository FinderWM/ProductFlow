from __future__ import annotations

from base64 import b64encode
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from io import BytesIO
from textwrap import shorten
from typing import Any

from PIL import Image, ImageDraw

from inspiration_one_backend.config import get_runtime_settings
from inspiration_one_backend.infrastructure.image.base import parse_size
from inspiration_one_backend.infrastructure.image.gemini_provider import (
    GoogleGeminiImageClient,
    GoogleGeminiReferenceImage,
)
from inspiration_one_backend.infrastructure.image.images_provider import ImagesReferenceImage, OpenAIImagesClient
from inspiration_one_backend.infrastructure.image.openai_chat_provider import (
    ChatCompletionsImageResult,
    OpenAIChatImageClient,
)
from inspiration_one_backend.infrastructure.image.responses_provider import (
    OpenAIResponsesImageClient,
    ResponsesReferenceImage,
    build_responses_reference_images_from_data_urls,
    decode_reference_data_url,
)
from inspiration_one_backend.infrastructure.prompts import render_prompt_template
from inspiration_one_backend.infrastructure.provider_config import (
    ResolvedImageProviderConfig,
    resolve_image_provider_config,
)


@dataclass(slots=True)
class GeneratedChatImage:
    """AI 生成的图片结果。"""

    bytes_data: bytes
    mime_type: str
    model_name: str
    provider_name: str
    prompt_version: str
    size: str
    generated_at: datetime
    provider_response_id: str | None = None
    previous_response_id: str | None = None
    image_generation_call_id: str | None = None
    provider_request_json: dict | None = None
    provider_output_json: dict | None = None

    @property
    def data_url(self) -> str:
        encoded = b64encode(self.bytes_data).decode("utf-8")
        return f"data:{self.mime_type};base64,{encoded}"


@dataclass(frozen=True, slots=True)
class ImageChatTurn:
    role: str
    content: str
    image_data_url: str | None = None


class ImageChatService:
    provider_name = "image-session"
    prompt_version = "responses-image-session-v1"

    def __init__(
        self,
        provider_config: ResolvedImageProviderConfig | None = None,
        *,
        generation_config_id: str | None = None,
    ) -> None:
        settings = get_runtime_settings()
        self.provider_config = provider_config or resolve_image_provider_config(
            generation_config_id=generation_config_id
        )
        self.provider_kind = self.provider_config.provider_kind
        self.prompt_template = settings.prompt_image_chat_template
        self.max_reference_images = settings.image_session_max_base_images

    def generate(
        self,
        prompt: str,
        size: str,
        manual_reference_images: list[str],
        history: list[ImageChatTurn] | None = None,
        previous_response_id: str | None = None,
        tool_options: dict | None = None,
        progress_callback: Callable[[dict[str, Any]], None] | None = None,
    ) -> GeneratedChatImage:
        if self.provider_kind == "mock":
            return self._generate_mock(
                prompt=prompt,
                size=size,
                manual_reference_images=manual_reference_images,
                history=history,
            )
        if self.provider_kind == "openai_responses":
            return self._generate_openai_responses(
                prompt=prompt,
                size=size,
                manual_reference_images=manual_reference_images,
                history=history,
                previous_response_id=previous_response_id,
                tool_options=tool_options,
                progress_callback=progress_callback,
            )
        if self.provider_kind == "openai_images":
            return self._generate_openai_images(
                prompt=prompt,
                size=size,
                manual_reference_images=manual_reference_images,
                history=history,
                tool_options=tool_options,
            )
        if self.provider_kind == "openai_chat_image":
            return self._generate_openai_chat_image(
                prompt=prompt,
                size=size,
                manual_reference_images=manual_reference_images,
                history=history,
                tool_options=tool_options,
            )
        if self.provider_kind == "google_gemini_image":
            return self._generate_google_gemini(
                prompt=prompt,
                size=size,
                manual_reference_images=manual_reference_images,
                history=history,
            )
        raise RuntimeError(f"暂不支持的图片 provider: {self.provider_kind}")

    def generate_many(
        self,
        prompt: str,
        size: str,
        manual_reference_images: list[str],
        history: list[ImageChatTurn] | None = None,
        *,
        candidate_count: int,
        tool_options: dict | None = None,
    ) -> list[GeneratedChatImage]:
        if candidate_count <= 0:
            return []
        if self.provider_kind == "openai_images":
            return self._generate_openai_images_many(
                prompt=prompt,
                size=size,
                manual_reference_images=manual_reference_images,
                history=history,
                tool_options=tool_options,
                candidate_count=candidate_count,
            )
        return [
            self.generate(
                prompt=prompt,
                size=size,
                manual_reference_images=manual_reference_images,
                history=history,
                tool_options=tool_options,
            )
            for _ in range(candidate_count)
        ]

    def _generate_mock(
        self,
        prompt: str,
        size: str,
        manual_reference_images: list[str],
        history: list[ImageChatTurn] | None,
    ) -> GeneratedChatImage:
        width, height = parse_size(size)
        accent = (99, 91, 255)
        image = Image.new("RGB", (width, height), (240, 244, 255))
        draw = ImageDraw.Draw(image)

        lines = [
            "Inspiration One Image Chat",
            f"Refs: {len(manual_reference_images)} upload",
            shorten(prompt, width=100, placeholder="..."),
        ]
        y = max(40, height // 10)
        for index, line in enumerate(lines):
            draw.text((48, y + index * 42), line, fill=accent if index == 0 else (47, 47, 61))
        draw.rounded_rectangle(
            (48, y + 190, width - 48, height - 48),
            radius=28,
            outline=(184, 184, 201),
            width=3,
            fill=(255, 255, 255),
        )
        draw.text(
            (72, y + 230),
            "Mock 模式：这里会显示真实图片供应商返回的图片。",
            fill=(82, 82, 91),
        )
        draw.text(
            (72, y + 280),
            "继续分支时，只会传入选择的基图和勾选参考图。",
            fill=(82, 82, 91),
        )

        buffer = BytesIO()
        image.save(buffer, format="PNG")
        return GeneratedChatImage(
            bytes_data=buffer.getvalue(),
            mime_type="image/png",
            model_name="mock-image-chat-v1",
            provider_name="mock",
            prompt_version=self.prompt_version,
            size=size,
            generated_at=datetime.now(UTC),
            previous_response_id=None,
            provider_request_json={
                "prompt": prompt,
                "size": size,
                "history_count": len(history or []),
                "manual_reference_count": len(manual_reference_images),
                "previous_response_id": None,
            },
        )

    def _generate_openai_responses(
        self,
        prompt: str,
        size: str,
        manual_reference_images: list[str],
        history: list[ImageChatTurn] | None,
        previous_response_id: str | None,
        tool_options: dict | None,
        progress_callback: Callable[[dict[str, Any]], None] | None,
    ) -> GeneratedChatImage:
        client = OpenAIResponsesImageClient(self.provider_config)
        result = client.generate_image(
            prompt=self._build_prompt(prompt=prompt, history=history, size=size),
            size=size,
            reference_images=self._collect_reference_images(
                self._generation_reference_images(history, manual_reference_images)
            ),
            previous_response_id=previous_response_id,
            tool_options=tool_options,
            progress_callback=progress_callback,
        )
        return GeneratedChatImage(
            bytes_data=result.bytes_data,
            mime_type=result.mime_type,
            model_name=result.model_name,
            provider_name=result.provider_name,
            prompt_version=self.prompt_version,
            size=size,
            generated_at=result.generated_at,
            provider_response_id=result.provider_response_id,
            previous_response_id=result.previous_response_id,
            image_generation_call_id=result.image_generation_call_id,
            provider_request_json=result.provider_request_json,
            provider_output_json=result.provider_output_json,
        )

    def _build_prompt(
        self,
        prompt: str,
        history: list[ImageChatTurn] | None = None,
        size: str = "",
    ) -> str:
        return render_prompt_template(
            self.prompt_template,
            {
                "prompt": prompt.strip(),
                "history_block": self._history_block(history),
                "size": size,
            },
        )

    def _history_block(self, history: list[ImageChatTurn] | None) -> str:
        lines: list[str] = []
        for turn in history or []:
            content = turn.content.strip()
            if not content and not turn.image_data_url:
                continue
            role_label = "用户" if turn.role == "user" else "助手" if turn.role == "assistant" else "系统"
            if content:
                line = f"{role_label}：{content}"
            else:
                line = f"{role_label}：（附图）"
            if turn.image_data_url and content:
                line = f"{line}（附图）"
            lines.append(line)
        return "\n".join(lines) if lines else "无显式上游上下文"

    def _generation_reference_images(
        self,
        history: list[ImageChatTurn] | None,
        manual_reference_images: list[str],
    ) -> list[str]:
        history_image_data_urls = [
            turn.image_data_url.strip()
            for turn in history or []
            if isinstance(turn.image_data_url, str) and turn.image_data_url.strip()
        ]
        return [*history_image_data_urls, *manual_reference_images]

    def _collect_reference_images(
        self,
        manual_reference_images: list[str],
    ) -> list[ResponsesReferenceImage]:
        reference_limit = max(0, self.max_reference_images)
        return build_responses_reference_images_from_data_urls(manual_reference_images, limit=reference_limit)

    def _generate_openai_images(
        self,
        prompt: str,
        size: str,
        manual_reference_images: list[str],
        history: list[ImageChatTurn] | None,
        tool_options: dict | None,
    ) -> GeneratedChatImage:
        return self._generate_openai_images_many(
            prompt=prompt,
            size=size,
            manual_reference_images=manual_reference_images,
            history=history,
            tool_options=tool_options,
            candidate_count=None,
        )[0]

    def _generate_openai_images_many(
        self,
        prompt: str,
        size: str,
        manual_reference_images: list[str],
        history: list[ImageChatTurn] | None,
        tool_options: dict | None,
        candidate_count: int | None,
    ) -> list[GeneratedChatImage]:
        client = OpenAIImagesClient(self.provider_config)
        full_prompt = self._build_prompt(prompt=prompt, history=history, size=size)
        request_options = self._images_api_request_options(tool_options, candidate_count=candidate_count)

        reference_images = self._collect_images_api_references(
            self._generation_reference_images(history, manual_reference_images)
        )
        if reference_images:
            results = client.edit(image=reference_images, prompt=full_prompt, size=size, **request_options)
        else:
            results = client.generate(prompt=full_prompt, size=size, **request_options)

        return [self._chat_image_from_images_result(result, size=size) for result in results]

    def _images_api_request_options(
        self,
        tool_options: dict | None,
        *,
        candidate_count: int | None,
    ) -> dict[str, Any]:
        options: dict[str, Any] = {}
        if isinstance(tool_options, dict):
            model = self._optional_tool_text(tool_options.get("model"))
            quality = self._optional_tool_text(tool_options.get("quality"))
            if model:
                options["model"] = model
            if quality:
                options["quality"] = quality
        n = candidate_count or 1
        options["n"] = max(1, min(10, n))
        return options

    def _chat_image_from_images_result(self, result: Any, *, size: str) -> GeneratedChatImage:
        return GeneratedChatImage(
            bytes_data=result.bytes_data,
            mime_type=result.mime_type,
            model_name=result.model_name,
            provider_name="openai-images",
            prompt_version=self.prompt_version,
            size=size,
            generated_at=result.generated_at,
            provider_response_id=None,
            previous_response_id=None,
            image_generation_call_id=None,
            provider_request_json=result.provider_request_json,
            provider_output_json=result.provider_output_json,
        )

    def _generate_openai_chat_image(
        self,
        prompt: str,
        size: str,
        manual_reference_images: list[str],
        history: list[ImageChatTurn] | None,
        tool_options: dict | None,
    ) -> GeneratedChatImage:
        client = OpenAIChatImageClient(self.provider_config)
        full_prompt = self._build_prompt(prompt=prompt, history=history, size=size)
        result = client.generate_image(
            prompt=full_prompt,
            size=size,
            reference_images=self._collect_images_api_references(
                self._generation_reference_images(history, manual_reference_images)
            ),
            model=self._openai_chat_model_option(tool_options),
        )
        return self._chat_image_from_openai_chat_result(result, size=size)

    def _openai_chat_model_option(self, tool_options: dict | None) -> str | None:
        if not isinstance(tool_options, dict):
            return None
        return self._optional_tool_text(tool_options.get("model"))

    def _chat_image_from_openai_chat_result(
        self,
        result: ChatCompletionsImageResult,
        *,
        size: str,
    ) -> GeneratedChatImage:
        return GeneratedChatImage(
            bytes_data=result.bytes_data,
            mime_type=result.mime_type,
            model_name=result.model_name,
            provider_name=result.provider_name,
            prompt_version=self.prompt_version,
            size=size,
            generated_at=result.generated_at,
            provider_response_id=result.provider_response_id,
            previous_response_id=None,
            image_generation_call_id=None,
            provider_request_json=result.provider_request_json,
            provider_output_json=result.provider_output_json,
        )

    def _optional_tool_text(self, value: Any) -> str | None:
        normalized = "" if value is None else str(value).strip()
        return normalized or None

    def _generate_google_gemini(
        self,
        prompt: str,
        size: str,
        manual_reference_images: list[str],
        history: list[ImageChatTurn] | None,
    ) -> GeneratedChatImage:
        client = GoogleGeminiImageClient(self.provider_config)
        full_prompt = self._build_prompt(prompt=prompt, history=history, size=size)
        result = client.generate_image(
            prompt=full_prompt,
            size=size,
            reference_images=self._collect_gemini_references(
                self._generation_reference_images(history, manual_reference_images)
            ),
        )
        return GeneratedChatImage(
            bytes_data=result.bytes_data,
            mime_type=result.mime_type,
            model_name=result.model_name,
            provider_name=result.provider_name,
            prompt_version=self.prompt_version,
            size=size,
            generated_at=result.generated_at,
            provider_response_id=result.provider_response_id,
            previous_response_id=None,
            image_generation_call_id=None,
            provider_request_json=result.provider_request_json,
            provider_output_json=result.provider_output_json,
        )

    def _collect_images_api_references(
        self,
        manual_reference_images: list[str],
    ) -> list[ImagesReferenceImage]:
        references: list[ImagesReferenceImage] = []
        reference_limit = max(0, self.max_reference_images)
        if reference_limit <= 0:
            return references
        has_base_image = False
        reference_index = 1
        for index, data_url in enumerate(manual_reference_images[:reference_limit], start=1):
            ref = decode_reference_data_url(data_url)
            if not has_base_image and index == 1:
                filename = "base.png"
                has_base_image = True
            else:
                filename = f"reference-{reference_index}.png"
                reference_index += 1
            references.append(
                ImagesReferenceImage(
                    bytes_data=ref.bytes_data,
                    mime_type=ref.mime_type,
                    filename=filename,
                )
            )
        return references

    def _collect_gemini_references(
        self,
        manual_reference_images: list[str],
    ) -> list[GoogleGeminiReferenceImage]:
        return [
            GoogleGeminiReferenceImage(
                bytes_data=reference.bytes_data,
                mime_type=reference.mime_type,
                filename=reference.filename,
            )
            for reference in self._collect_images_api_references(manual_reference_images)
        ]
