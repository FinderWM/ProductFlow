from __future__ import annotations

from inspiration_one_backend.application.contracts import (
    CopyNodeConfigV2,
    CreativeBriefPayload,
    InspirationInput,
    ReferenceImageInput,
)
from inspiration_one_backend.infrastructure.prompts import text_or_default
from inspiration_one_backend.infrastructure.provider_config import TextStructuredOutputConfig
from inspiration_one_backend.infrastructure.text.structured_output import (
    BRIEF_SCHEMA,
    COPY_SCHEMA,
    structured_output_instructions,
)

BRIEF_SYSTEM_FALLBACK = "请输出简洁、结构化的中文 JSON。"
COPY_SYSTEM_FALLBACK = "请输出中文 JSON，不要输出 markdown。"


def build_brief_user_content(inspiration: InspirationInput) -> str:
    return (
        f"灵感产物名：{inspiration.name}\n"
        f"类目：{inspiration.category or '未提供'}\n"
        f"价格：{inspiration.price or '未提供'}\n"
        f"灵感产物描述/补充说明：{inspiration.source_note or '未提供'}\n"
        "请输出字段：positioning、audience、selling_angles(3到5条)、taboo_phrases、poster_style_hint。"
    )


def build_copy_reference_text(reference_images: list[ReferenceImageInput] | None = None) -> str:
    references = reference_images or []
    reference_lines = [
        (
            f"{index}. {reference.label or reference.filename}"
            f"（角色：{reference.role or '参考图'}，类型：{reference.mime_type}，文件：{reference.filename}）"
        )
        for index, reference in enumerate(references, start=1)
    ]
    return "\n".join(reference_lines) if reference_lines else "未连接"


def build_copy_user_content(
    inspiration: InspirationInput,
    brief: CreativeBriefPayload,
    config: CopyNodeConfigV2 | None = None,
    reference_images: list[ReferenceImageInput] | None = None,
) -> str:
    resolved_config = config or CopyNodeConfigV2()
    reference_text = build_copy_reference_text(reference_images)
    return (
        f"灵感产物名：{inspiration.name}\n"
        f"类目：{inspiration.category or '未提供'}\n"
        f"价格：{inspiration.price or '未提供'}\n"
        f"灵感产物描述/补充说明：{inspiration.source_note or '未提供'}\n"
        f"参考图：{reference_text}\n"
        f"文案用途：{resolved_config.purpose or '未指定'}\n"
        f"输出模式：{resolved_config.output_mode}\n"
        f"渠道：{resolved_config.channel or '未指定'}\n"
        f"语气：{resolved_config.tone or '未指定'}\n"
        f"本轮文案要求：{resolved_config.instruction or '按灵感产物和场景自由组织文案'}\n"
        f"可选槽位：{[slot.model_dump(mode='json') for slot in resolved_config.requested_slots]}\n"
        f"灵感产物定位：{brief.positioning}\n"
        f"目标人群：{brief.audience}\n"
        f"卖点角度：{', '.join(brief.selling_angles)}\n"
        f"禁忌表达：{', '.join(brief.taboo_phrases) or '无'}\n"
        "请输出 v2 JSON 外壳：version=2、purpose、summary、content、visual_guidance。\n"
        "content.kind 必须是 freeform、blocks 或 layout_brief。"
        "不要为了满足固定字段编造 CTA、海报标题或固定 3 到 5 条卖点。"
    )


def build_brief_system_instructions(
    system_prompt: str | None,
    structured_output: TextStructuredOutputConfig,
) -> str:
    return structured_output_instructions(
        text_or_default(system_prompt, BRIEF_SYSTEM_FALLBACK),
        structured_output,
        BRIEF_SCHEMA,
    )


def build_copy_system_instructions(
    system_prompt: str | None,
    structured_output: TextStructuredOutputConfig,
) -> str:
    return structured_output_instructions(
        text_or_default(system_prompt, COPY_SYSTEM_FALLBACK),
        structured_output,
        COPY_SCHEMA,
    )
