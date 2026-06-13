from __future__ import annotations

from typing import Any

import httpx

from inspiration_one_backend.application.contracts import (
    CopyNodeConfigV2,
    CopyPayloadV2,
    CreativeBriefPayload,
    InspirationInput,
    ReferenceImageInput,
    TailSplitPlanDraft,
    TailSplitPlanInput,
)
from inspiration_one_backend.application.copy_payloads import normalize_copy_payload
from inspiration_one_backend.config import get_runtime_settings
from inspiration_one_backend.infrastructure.openai_client import (
    OPENAI_COMPATIBLE_DEFAULT_HEADERS,
    OPENAI_COMPATIBLE_DEFAULT_TIMEOUT_SECONDS,
)
from inspiration_one_backend.infrastructure.openai_response_parsing import (
    read_json_object_from_response,
    response_output_text,
)
from inspiration_one_backend.infrastructure.prompts import text_or_default
from inspiration_one_backend.infrastructure.provider_config import (
    ResolvedTextProviderConfig,
    resolve_text_provider_config,
)
from inspiration_one_backend.infrastructure.text.base import TextProvider

DEFAULT_CHAT_COMPLETIONS_BASE_URL = "https://api.openai.com/v1"
CHAT_COMPLETIONS_ENDPOINT_FAMILY = "chat/completions"


def normalize_chat_completions_url(base_url: str | None) -> str:
    normalized = (base_url or DEFAULT_CHAT_COMPLETIONS_BASE_URL).strip().rstrip("/")
    if normalized.endswith("/chat/completions"):
        return normalized
    if normalized.endswith("/v1"):
        return f"{normalized}/chat/completions"
    return f"{normalized}/v1/chat/completions"


class OpenAIChatCompletionsTextProvider(TextProvider):
    provider_name = "openai-chat-completions"
    prompt_version = "chat-completions-json-v1"

    def __init__(self, provider_config: ResolvedTextProviderConfig | None = None) -> None:
        settings = get_runtime_settings()
        resolved_config = provider_config or resolve_text_provider_config()
        self.api_key = resolved_config.api_key
        self.base_url = resolved_config.base_url
        self.endpoint_url = normalize_chat_completions_url(self.base_url)
        self.brief_model = resolved_config.brief_model
        self.copy_model = resolved_config.copy_model
        self.structured_json_response_format_enabled = resolved_config.structured_json_response_format_enabled
        self.brief_system_prompt = settings.prompt_brief_system
        self.copy_system_prompt = settings.prompt_copy_system
        self.image_prompt_polish_system_prompt = settings.prompt_image_prompt_polish_system
        self.tail_split_system_prompt = settings.prompt_tail_split_system

    def _chat_completion(
        self,
        *,
        model: str,
        instructions: str,
        content: str,
        response_format_json: bool = False,
    ) -> str:
        if not self.api_key:
            raise RuntimeError("文案供应商档案缺少 API Key")
        headers = {
            **OPENAI_COMPATIBLE_DEFAULT_HEADERS,
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload: dict[str, Any] = {
            "model": model,
            "messages": [
                {"role": "system", "content": instructions},
                {"role": "user", "content": content},
            ],
            "stream": False,
        }
        if response_format_json:
            payload["response_format"] = {"type": "json_object"}
        with httpx.Client(timeout=OPENAI_COMPATIBLE_DEFAULT_TIMEOUT_SECONDS, headers=headers) as client:
            response = client.post(self.endpoint_url, json=payload)
            response.raise_for_status()
        return self._response_text(response)

    def _response_text(self, response: httpx.Response) -> str:
        content_type = response.headers.get("content-type", "")
        text = response.text
        if "text/event-stream" in content_type or text.lstrip().startswith("data:"):
            return response_output_text(text) or text
        payload = response.json()
        if not isinstance(payload, dict):
            return text
        return _chat_completion_payload_text(payload) or text

    def _read_output_json(self, response: object) -> dict[str, Any]:
        return read_json_object_from_response(response, error_label="文案 Chat Completions provider")

    def generate_brief(self, inspiration: InspirationInput) -> tuple[CreativeBriefPayload, str]:
        response_text = self._chat_completion(
            model=self.brief_model,
            instructions=text_or_default(self.brief_system_prompt, "请输出简洁、结构化的中文 JSON。"),
            content=(
                f"灵感产物名：{inspiration.name}\n"
                f"类目：{inspiration.category or '未提供'}\n"
                f"价格：{inspiration.price or '未提供'}\n"
                f"灵感产物描述/补充说明：{inspiration.source_note or '未提供'}\n"
                "请输出字段：positioning、audience、selling_angles(3到5条)、"
                "taboo_phrases、poster_style_hint。"
            ),
            response_format_json=self.structured_json_response_format_enabled,
        )
        payload = CreativeBriefPayload.model_validate(self._read_output_json(response_text))
        return payload, self.brief_model

    def generate_copy(
        self,
        inspiration: InspirationInput,
        brief: CreativeBriefPayload,
        config: CopyNodeConfigV2 | None = None,
        reference_images: list[ReferenceImageInput] | None = None,
    ) -> tuple[CopyPayloadV2, str]:
        config = config or CopyNodeConfigV2()
        reference_images = reference_images or []
        reference_lines = [
            (
                f"{index}. {reference.label or reference.filename}"
                f"（角色：{reference.role or '参考图'}，类型：{reference.mime_type}，文件：{reference.filename}）"
            )
            for index, reference in enumerate(reference_images, start=1)
        ]
        reference_text = "\n".join(reference_lines) if reference_lines else "未连接"
        response_text = self._chat_completion(
            model=self.copy_model,
            instructions=text_or_default(self.copy_system_prompt, "请输出中文 JSON，不要输出 markdown。"),
            content=(
                f"灵感产物名：{inspiration.name}\n"
                f"类目：{inspiration.category or '未提供'}\n"
                f"价格：{inspiration.price or '未提供'}\n"
                f"灵感产物描述/补充说明：{inspiration.source_note or '未提供'}\n"
                f"参考图：{reference_text}\n"
                f"文案用途：{config.purpose or '未指定'}\n"
                f"输出模式：{config.output_mode}\n"
                f"渠道：{config.channel or '未指定'}\n"
                f"语气：{config.tone or '未指定'}\n"
                f"本轮文案要求：{config.instruction or '按灵感产物和场景自由组织文案'}\n"
                f"可选槽位：{[slot.model_dump(mode='json') for slot in config.requested_slots]}\n"
                f"灵感产物定位：{brief.positioning}\n"
                f"目标人群：{brief.audience}\n"
                f"卖点角度：{', '.join(brief.selling_angles)}\n"
                f"禁忌表达：{', '.join(brief.taboo_phrases) or '无'}\n"
                "请输出 v2 JSON 外壳：version=2、purpose、summary、content、visual_guidance。\n"
                "content.kind 必须是 freeform、blocks 或 layout_brief。"
                "不要为了满足固定字段编造 CTA、海报标题或固定 3 到 5 条卖点。"
            ),
            response_format_json=self.structured_json_response_format_enabled,
        )
        raw_payload = self._read_output_json(response_text)
        payload = normalize_copy_payload(
            _normalize_loose_copy_payload(raw_payload, fallback_purpose=config.purpose),
            fallback_purpose=config.purpose,
        )
        return payload, self.copy_model

    def polish_image_prompt(self, prompt: str) -> tuple[str, str]:
        response_text = self._chat_completion(
            model=self.copy_model,
            instructions=text_or_default(
                self.image_prompt_polish_system_prompt,
                "只输出润色后的中文画面描述，不要输出 markdown、标题或解释。",
            ),
            content=f"原始画面描述：\n{prompt.strip()}",
        ).strip()
        if not response_text:
            raise ValueError("文案 provider 未返回润色结果")
        return response_text, self.copy_model

    def generate_tail_split_plan(self, payload: TailSplitPlanInput) -> tuple[TailSplitPlanDraft, str]:
        reference_lines = [
            (
                f"{index}. {reference.label or reference.filename}"
                f"（角色：{reference.role or '参考图'}，类型：{reference.mime_type}，文件：{reference.filename}）"
            )
            for index, reference in enumerate(payload.reference_images, start=1)
        ]
        upstream_text = "\n".join(
            f"{index}. {text}" for index, text in enumerate(payload.upstream_text_contexts, start=1)
        )
        response_text = self._chat_completion(
            model=self.copy_model,
            instructions=text_or_default(
                self.tail_split_system_prompt,
                "把输入拆成多条彼此独立、适合后续单独生图的方向。只输出 JSON 对象。",
            ),
            content=(
                f"灵感产物名：{payload.inspiration_name}\n"
                f"类目：{payload.category or '未提供'}\n"
                f"价格：{payload.price or '未提供'}\n"
                f"灵感产物描述/补充说明：{payload.source_note or '未提供'}\n"
                f"粘贴长文本：{payload.source_text or '未提供'}\n"
                f"尾巴节点描述：{payload.description or '未提供'}\n"
                f"上游文案上下文：\n{upstream_text or '未提供'}\n"
                f"参考图：\n{chr(10).join(reference_lines) if reference_lines else '未提供'}\n"
                f"最多拆分项：{payload.max_items}\n"
                "请输出字段：source_summary、items。\n"
                "items 为数组，每项包含 title、instruction、visual_intent、source_refs。\n"
                "要求：\n"
                "1. 最多拆分项是数量上限，不是必须输出的数量；请按实际内容输出 1 到该上限之间的合理数量；\n"
                "2. 不要为了填满上限硬拆，也不要把同一画面目标改写成多个 item；\n"
                "3. instruction 必须是可直接用于后续生图触发器的完整中文提示词；\n"
                "4. 每个 item 聚焦不同画面目标，不要只是同义改写；\n"
                '5. source_refs 必须是字符串数组，例如 ["入口长文本：正视图", "参考图 1"]；'
                "没有来源时输出 []。"
            ),
            response_format_json=self.structured_json_response_format_enabled,
        )
        return TailSplitPlanDraft.model_validate(self._read_output_json(response_text)), self.copy_model

    def test_structured_json_response_format(self) -> tuple[dict[str, Any], str]:
        response_text = self._chat_completion(
            model=self.copy_model,
            instructions="只输出 JSON 对象，不要输出 markdown、标题或解释。",
            content=(
                '请返回一个 JSON 对象，包含字段 ok=true、kind="structured_json_response_format_test"、'
                'items=["response_format"]。'
            ),
            response_format_json=True,
        )
        payload = self._read_output_json(response_text)
        if not payload:
            raise ValueError("结构化 JSON response_format 测试返回空 JSON 对象")
        return payload, self.copy_model


_LOOSE_COPY_META_KEYS = {
    "version",
    "purpose",
    "summary",
    "content",
    "visual_guidance",
    "visualGuidance",
    "摘要",
    "用途",
    "视觉建议",
    "画面建议",
    "构图建议",
}


def _normalize_loose_copy_payload(payload: dict[str, Any], *, fallback_purpose: str | None) -> dict[str, Any]:
    if payload.get("version") == 2 or "content" in payload:
        return payload

    blocks = _loose_copy_blocks(payload)
    if not blocks:
        return payload

    visual_guidance = (
        payload.get("visual_guidance")
        or payload.get("visualGuidance")
        or payload.get("视觉建议")
        or payload.get("画面建议")
        or payload.get("构图建议")
    )
    normalized: dict[str, Any] = {
        "version": 2,
        "purpose": _loose_text(payload.get("purpose") or payload.get("用途")) or fallback_purpose,
        "summary": _loose_text(payload.get("summary") or payload.get("摘要")) or blocks[0]["text"],
        "content": {"kind": "blocks", "blocks": blocks},
    }
    if isinstance(visual_guidance, dict):
        normalized["visual_guidance"] = visual_guidance
    elif _loose_text(visual_guidance):
        normalized["visual_guidance"] = {"composition_hint": _loose_text(visual_guidance)}
    return normalized


def _loose_copy_blocks(payload: dict[str, Any]) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    for key, value in payload.items():
        if key in _LOOSE_COPY_META_KEYS:
            continue
        _append_loose_copy_blocks(blocks, key=key, value=value)
    return blocks


def _append_loose_copy_blocks(blocks: list[dict[str, Any]], *, key: str, value: Any) -> None:
    label = _humanize_loose_copy_key(key)
    if isinstance(value, list):
        for item in value:
            _append_loose_copy_blocks(blocks, key=key, value=item)
        return
    if isinstance(value, dict):
        direct_text = _loose_text(
            value.get("text")
            or value.get("copy")
            or value.get("content")
            or value.get("description")
            or value.get("body")
            or value.get("subtitle")
        )
        if direct_text:
            blocks.append(
                {
                    "id": f"block-{len(blocks) + 1}",
                    "role": _loose_text(value.get("role") or value.get("type")),
                    "label": _loose_text(value.get("label") or value.get("title") or value.get("name")) or label,
                    "text": direct_text,
                }
            )
            return
        for nested_key, nested_value in value.items():
            _append_loose_copy_blocks(blocks, key=f"{label}_{nested_key}", value=nested_value)
        return
    text = _loose_text(value)
    if text:
        blocks.append({"id": f"block-{len(blocks) + 1}", "label": label, "text": text})


def _loose_text(value: Any) -> str:
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        return "；".join(text for item in value if (text := _loose_text(item)))
    return ""


def _humanize_loose_copy_key(key: str) -> str:
    return key.replace("_", " ").replace("-", " ").strip() or "文案"


def _chat_completion_payload_text(payload: dict[str, Any]) -> str:
    choices = payload.get("choices")
    if not isinstance(choices, list):
        return ""
    chunks: list[str] = []
    for choice in choices:
        if not isinstance(choice, dict):
            continue
        message = choice.get("message")
        if isinstance(message, dict):
            content = message.get("content")
            if isinstance(content, str):
                chunks.append(content)
        delta = choice.get("delta")
        if isinstance(delta, dict):
            content = delta.get("content")
            if isinstance(content, str):
                chunks.append(content)
    return "".join(chunks)
