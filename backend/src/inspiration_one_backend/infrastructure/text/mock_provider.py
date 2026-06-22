from __future__ import annotations

import re

from inspiration_one_backend.application.contracts import (
    BlocksCopyContent,
    CopyBlock,
    CopyNodeConfigV2,
    CopyPayloadV2,
    CreativeBriefPayload,
    DeckOutlineInput,
    DeckOutlinePayload,
    DeckSlideOutlineDraft,
    InspirationInput,
    ReferenceImageInput,
    SpeakerNotesInput,
    SpeakerNotesPayload,
    TailSplitPlanDraft,
    TailSplitPlanDraftItem,
    TailSplitPlanInput,
    VisualGuidance,
)
from inspiration_one_backend.infrastructure.text.base import TextProvider


class MockTextProvider(TextProvider):
    provider_name = "mock"

    def generate_brief(self, inspiration: InspirationInput) -> tuple[CreativeBriefPayload, str]:
        category = inspiration.category or "通用电商"
        note_hint = f"，重点参考：{inspiration.source_note[:48]}" if inspiration.source_note else ""
        brief = CreativeBriefPayload(
            positioning=f"{category}场景下的实用型灵感产物{note_hint}",
            audience="追求性价比、希望快速了解卖点的电商消费者",
            selling_angles=[
                "突出核心用途，先让人知道买来能解决什么问题",
                "强调到手直观收益，不堆空泛形容词",
                "语言更接近淘宝主图与促销海报风格",
            ],
            taboo_phrases=["全网最低", "包治百病", "绝对有效"],
            poster_style_hint="白底主图 + 强调主卖点的红色促销信息",
        )
        return brief, "mock-brief-v1"

    def generate_copy(
        self,
        inspiration: InspirationInput,
        brief: CreativeBriefPayload,
        config: CopyNodeConfigV2,
        reference_images: list[ReferenceImageInput] | None = None,
    ) -> tuple[CopyPayloadV2, str]:
        category_prefix = f"{inspiration.category} " if inspiration.category else ""
        price_line = f" 参考价 {inspiration.price}" if inspiration.price else ""
        note_line = f"，结合描述：{inspiration.source_note[:36]}" if inspiration.source_note else ""
        instruction_line = f"，本轮方向：{config.instruction[:32]}" if config.instruction else ""
        reference_images = reference_images or []
        reference_hint = ""
        if reference_images:
            first_reference = reference_images[0]
            label = first_reference.label or first_reference.filename
            role = first_reference.role or "参考图"
            reference_hint = f"，参考{role}：{label}"
        title = f"{category_prefix}{inspiration.name}｜实用好上手，店铺主推更省心"
        points = [
            f"核心用途更清楚：{inspiration.name}一眼看懂重点{note_line}{reference_hint}",
            "展示更直接，适合主图、详情页或促销素材快速承接",
            (
                f"语言偏{config.tone or '转化清晰'}，适合{config.channel or '电商'}场景{price_line}{instruction_line}"
            ).strip(),
        ]
        copy = CopyPayloadV2(
            purpose=config.purpose,
            summary=title,
            content=BlocksCopyContent(
                blocks=[
                    CopyBlock(id="headline", role="headline", label="主信息", text=title, priority=1),
                    *[
                        CopyBlock(
                            id=f"point-{index}",
                            role="selling_point",
                            label=f"卖点 {index}",
                            text=point,
                            visual_hint="可作为画面标注或图标旁短说明",
                            priority=index + 1,
                        )
                        for index, point in enumerate(points, start=1)
                    ],
                ]
            ),
            visual_guidance=VisualGuidance(
                main_message=title,
                hierarchy=["灵感产物主体", "核心卖点", "补充说明"],
                composition_hint=brief.poster_style_hint,
                text_density="medium",
                avoid=brief.taboo_phrases,
            ),
        )
        return copy, "mock-copy-v2"

    def polish_image_prompt(self, prompt: str) -> tuple[str, str]:
        normalized = prompt.strip()
        if not normalized:
            return "", "mock-polish-v1"
        return (
            f"{normalized}。画面主体清晰，光线自然，构图干净，突出灵感产物质感与可售卖细节。",
            "mock-polish-v1",
        )

    def generate_tail_split_plan(self, payload: TailSplitPlanInput) -> tuple[TailSplitPlanDraft, str]:
        source_summary_parts = [
            f"灵感产物：{payload.inspiration_name}",
            f"类目：{payload.category}" if payload.category else "",
            f"补充：{payload.source_note[:32]}" if payload.source_note else "",
            f"文本输入：{payload.source_text[:48]}" if payload.source_text else "",
            f"节点描述：{payload.description[:48]}" if payload.description else "",
            f"上游文案：{payload.upstream_text_contexts[0][:36]}" if payload.upstream_text_contexts else "",
            (
                f"参考图：{payload.reference_images[0].label or payload.reference_images[0].filename}"
                if payload.reference_images
                else ""
            ),
        ]
        summary = "；".join(part for part in source_summary_parts if part) or "基于输入内容拆分"

        base_candidates = [
            TailSplitPlanDraftItem(
                title=f"{payload.inspiration_name} 主卖点图",
                instruction=f"突出 {payload.inspiration_name} 的核心用途与直接收益，画面干净，适合电商主图。",
                visual_intent="单品居中，明确展示卖点和质感",
                source_refs=["灵感产物资料", "主卖点拆分"],
            ),
            TailSplitPlanDraftItem(
                title=f"{payload.inspiration_name} 场景使用图",
                instruction="围绕真实使用场景构图，体现使用前后价值，避免空泛修饰词。",
                visual_intent="生活化场景，突出功能触发时刻",
                source_refs=["上游文案", "场景化表达"],
            ),
            TailSplitPlanDraftItem(
                title=f"{payload.inspiration_name} 细节特写图",
                instruction="强调关键材质、工艺或结构细节，保证纹理和边缘清晰。",
                visual_intent="近景特写，强调可信细节",
                source_refs=["图片参考", "细节拆分"],
            ),
            TailSplitPlanDraftItem(
                title=f"{payload.inspiration_name} 规格信息图",
                instruction="展示尺寸或参数重点，留出适合后期添加标注的空间。",
                visual_intent="信息层级清晰，适合详情页参数区",
                source_refs=["规格信息", "结构化输出"],
            ),
        ]
        item_count = _mock_tail_split_item_count(payload, len(base_candidates))
        image_ref = (
            f"参考图：{payload.reference_images[0].label or payload.reference_images[0].filename}"
            if payload.reference_images
            else ""
        )
        text_ref = f"长文本：{payload.source_text[:20]}" if payload.source_text else ""
        description_ref = f"节点描述：{payload.description[:20]}" if payload.description else ""
        for item in base_candidates:
            refs = [*item.source_refs]
            if image_ref:
                refs.append(image_ref)
            if text_ref:
                refs.append(text_ref)
            if description_ref:
                refs.append(description_ref)
            item.source_refs = refs
        return TailSplitPlanDraft(source_summary=summary, items=base_candidates[:item_count]), "mock-tail-split-v1"

    def generate_outline(self, payload: DeckOutlineInput) -> tuple[DeckOutlinePayload, str]:
        seen: set[str] = set()
        signals: list[str] = []
        for text in (payload.source_input, payload.material_summary):
            if not text:
                continue
            for part in re.split(r"[、，,；;。.\n\r]+", text):
                signal = part.strip()
                if len(signal) < 4 or signal in seen:
                    continue
                seen.add(signal)
                signals.append(signal)
        max_slides = max(1, payload.max_slides)
        slides = [
            DeckSlideOutlineDraft(
                title=f"{payload.inspiration_name}｜概览",
                points=[payload.source_note.strip()] if payload.source_note else ["主题与背景介绍"],
                material_hint="灵感主图",
            )
        ]
        for index, signal in enumerate(signals[: max_slides - 1], start=1):
            slides.append(DeckSlideOutlineDraft(title=f"要点 {index}", points=[signal]))
        if len(slides) == 1:
            slides.append(DeckSlideOutlineDraft(title="核心价值", points=["核心卖点一", "核心卖点二"]))
            slides.append(DeckSlideOutlineDraft(title="总结", points=["回顾与行动建议"]))
        outline = DeckOutlinePayload(title=f"{payload.inspiration_name}演示文稿", slides=slides[:max_slides])
        return outline, "mock-deck-outline-v1"

    def generate_speaker_notes(self, payload: SpeakerNotesInput) -> tuple[SpeakerNotesPayload, str]:
        points = "；".join(payload.points) if payload.points else "本页要点"
        notes = f"本页《{payload.slide_title}》围绕「{points}」展开，结合《{payload.deck_title}》整体叙事讲解。"
        return SpeakerNotesPayload(notes=notes), "mock-deck-speaker-notes-v1"


def _mock_tail_split_item_count(payload: TailSplitPlanInput, candidate_count: int) -> int:
    """Choose a content-driven count so max_items behaves as an upper bound in local/mock runs."""

    content_signals = _tail_split_content_signals(payload)
    if content_signals:
        requested_count = len(content_signals)
    elif payload.reference_images:
        requested_count = min(2, len(payload.reference_images))
    elif payload.upstream_text_contexts:
        requested_count = min(2, len(payload.upstream_text_contexts))
    else:
        requested_count = 1
    return max(1, min(payload.max_items, candidate_count, requested_count))


def _tail_split_content_signals(payload: TailSplitPlanInput) -> list[str]:
    text_parts = [payload.source_text, payload.description, payload.source_note, *payload.upstream_text_contexts]
    signals: list[str] = []
    seen: set[str] = set()
    for text in text_parts:
        if not text:
            continue
        for part in re.split(r"[、，,；;。.\n\r]+", text):
            signal = part.strip()
            if len(signal) < 2 or signal in seen:
                continue
            seen.add(signal)
            signals.append(signal)
    return signals
