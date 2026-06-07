from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationInfo, field_validator, model_validator

from inspiration_one_backend.domain.enums import PosterKind

TAIL_SPLITTER_DEFAULT_MAX_ITEMS = 8
TAIL_SPLITTER_MIN_ITEMS = 1


def _normalize_ai_scalar_text(value: Any, *, field_name: str) -> Any:
    """Normalize provider JSON scalar text fields without hiding malformed structures."""

    if not isinstance(value, list):
        return value
    if not value:
        raise ValueError(f"{field_name}不能为空")
    parts: list[str] = []
    for item in value:
        if not isinstance(item, str):
            raise ValueError(f"{field_name}数组项必须是文本")
        text = item.strip()
        if not text:
            raise ValueError(f"{field_name}数组项不能为空")
        parts.append(text)
    return "、".join(parts)


def _validate_tail_splitter_max_items(value: int) -> int:
    if value < TAIL_SPLITTER_MIN_ITEMS:
        raise ValueError(f"最大拆分数不能小于 {TAIL_SPLITTER_MIN_ITEMS}")
    return value


class InspirationInput(BaseModel):
    """文本生成器需要的最小灵感产物信息。"""

    name: str
    category: str | None = None
    price: str | None = None
    source_note: str | None = None
    image_path: str


class CreativeBriefPayload(BaseModel):
    """灵感产物理解结果：定位/受众/卖点/禁忌词/海报风格。"""

    positioning: str
    audience: str
    selling_angles: list[str] = Field(min_length=3, max_length=5)
    taboo_phrases: list[str] = Field(default_factory=list)
    poster_style_hint: str

    @field_validator("positioning", "audience", "poster_style_hint", mode="before")
    @classmethod
    def normalize_scalar_text(cls, value: Any, info: ValidationInfo) -> Any:
        """模型偶发把短文本字段输出成字符串数组；只接受纯文本数组并拼成展示字符串。"""

        return _normalize_ai_scalar_text(value, field_name=info.field_name)


class CopySlotRequest(BaseModel):
    """文案节点可选槽位请求；不等于模型必须生成固定字段。"""

    key: str
    label: str
    required: bool = False
    hint: str | None = None

    @field_validator("key", "label")
    @classmethod
    def validate_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("文案槽位 key/label 不能为空")
        return value

    @field_validator("hint")
    @classmethod
    def normalize_hint(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class CopyNodeConfigV2(BaseModel):
    """文案节点 v2 配置。缺省值让旧节点进入同一条 v2 路径。"""

    version: Literal[2] = 2
    instruction: str = ""
    purpose: str | None = None
    channel: str | None = None
    tone: str | None = None
    output_mode: Literal["freeform", "blocks", "layout_brief"] = "blocks"
    requested_slots: list[CopySlotRequest] = Field(default_factory=list)


class CopyBlock(BaseModel):
    """一段可编辑文案块。label/role/visual_hint 都是可选增强，不强迫模型编造。"""

    id: str
    role: str | None = None
    label: str | None = None
    text: str
    note: str | None = None
    visual_hint: str | None = None
    priority: int | None = None

    @field_validator("text")
    @classmethod
    def validate_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("文案块正文不能为空")
        return value


class CopySection(BaseModel):
    """layout_brief 的可编辑分区。"""

    id: str
    title: str | None = None
    body: str | None = None
    items: list[CopyBlock] = Field(default_factory=list)
    visual_hint: str | None = None

    @model_validator(mode="after")
    def validate_section_content(self) -> CopySection:
        if not (self.title or self.body or self.items or self.visual_hint):
            raise ValueError("文案分区不能为空")
        return self


class FreeformCopyContent(BaseModel):
    kind: Literal["freeform"] = "freeform"
    text: str

    @field_validator("text")
    @classmethod
    def validate_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("自由文案不能为空")
        return value


class BlocksCopyContent(BaseModel):
    kind: Literal["blocks"] = "blocks"
    blocks: list[CopyBlock] = Field(min_length=1)


class LayoutBriefCopyContent(BaseModel):
    kind: Literal["layout_brief"] = "layout_brief"
    sections: list[CopySection] = Field(min_length=1)


CopyContent = FreeformCopyContent | BlocksCopyContent | LayoutBriefCopyContent


class VisualGuidance(BaseModel):
    main_message: str | None = None
    hierarchy: list[str] = Field(default_factory=list)
    composition_hint: str | None = None
    text_density: Literal["none", "low", "medium", "high"] | None = None
    avoid: list[str] = Field(default_factory=list)


class CopyPayloadV2(BaseModel):
    """文案节点 v2 输出：稳定外壳 + 弹性内容。"""

    version: Literal[2] = 2
    purpose: str | None = None
    summary: str
    content: CopyContent = Field(discriminator="kind")
    visual_guidance: VisualGuidance | None = None

    @field_validator("summary")
    @classmethod
    def validate_summary(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("文案摘要不能为空")
        return value


class PosterRenderResult(BaseModel):
    """海报渲染结果元信息。"""

    kind: PosterKind
    template_name: str
    storage_path: str
    width: int
    height: int
    mime_type: str = "image/png"


class ReferenceImageInput(BaseModel):
    """海报渲染/生成需要的参考图信息。"""

    path: Path
    mime_type: str
    filename: str
    role: str | None = None
    label: str | None = None


class TailSplitterConfig(BaseModel):
    """尾巴节点配置。文件解析入口先保留为 document_source。"""

    description: str = ""
    source_text: str = ""
    max_items: int = TAIL_SPLITTER_DEFAULT_MAX_ITEMS
    generation_config_mode: Literal["auto", "manual"] = "auto"
    generation_config_id: str | None = None
    document_source: dict[str, Any] | None = None

    @field_validator("description", "source_text", mode="before")
    @classmethod
    def normalize_text(cls, value: Any) -> Any:
        if value is None:
            return ""
        if not isinstance(value, str):
            return value
        return value.strip()

    @field_validator("max_items", mode="before")
    @classmethod
    def normalize_max_items_input(cls, value: Any) -> Any:
        if value is None:
            return TAIL_SPLITTER_DEFAULT_MAX_ITEMS
        if isinstance(value, str) and not value.strip():
            return TAIL_SPLITTER_DEFAULT_MAX_ITEMS
        return value

    @field_validator("max_items")
    @classmethod
    def validate_max_items(cls, value: int) -> int:
        return _validate_tail_splitter_max_items(value)

    @field_validator("generation_config_mode", mode="before")
    @classmethod
    def normalize_generation_config_mode(cls, value: Any) -> Any:
        if value is None:
            return "auto"
        if isinstance(value, str):
            normalized = value.strip().lower()
            return normalized or "auto"
        return value

    @field_validator("generation_config_id")
    @classmethod
    def normalize_generation_config_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None


class TailSplitPlanInput(BaseModel):
    """尾巴拆分 provider 入参。"""

    inspiration_name: str
    category: str | None = None
    price: str | None = None
    source_note: str | None = None
    source_text: str = ""
    description: str = ""
    upstream_text_contexts: list[str] = Field(default_factory=list)
    reference_images: list[ReferenceImageInput] = Field(default_factory=list)
    max_items: int = TAIL_SPLITTER_DEFAULT_MAX_ITEMS

    @field_validator("max_items")
    @classmethod
    def validate_max_items(cls, value: int) -> int:
        return _validate_tail_splitter_max_items(value)


class TailSplitPlanDraftItem(BaseModel):
    """Provider 返回的单个拆分项。id/order 可缺省，由应用层补齐。"""

    id: str | None = None
    order: int | None = None
    title: str
    instruction: str
    visual_intent: str
    source_refs: list[str] = Field(default_factory=list)

    @field_validator("id", "title", "instruction", "visual_intent", mode="before")
    @classmethod
    def normalize_scalar_text(cls, value: Any, info: ValidationInfo) -> Any:
        return _normalize_ai_scalar_text(value, field_name=info.field_name)

    @field_validator("title", "instruction", "visual_intent")
    @classmethod
    def validate_required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("拆分项标题、提示词和画面意图不能为空")
        return value

    @field_validator("id")
    @classmethod
    def normalize_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return value.strip() or None

    @field_validator("source_refs", mode="before")
    @classmethod
    def normalize_source_refs_input(cls, value: Any) -> Any:
        if value is None:
            return []
        if isinstance(value, str):
            value = value.strip()
            return [value] if value else []
        return value

    @field_validator("source_refs")
    @classmethod
    def normalize_source_refs(cls, value: list[str]) -> list[str]:
        return [item.strip() for item in value if item.strip()]


class TailSplitPlanDraft(BaseModel):
    """Provider 返回的拆分计划草稿。"""

    source_summary: str
    items: list[TailSplitPlanDraftItem] = Field(min_length=1)

    @field_validator("source_summary", mode="before")
    @classmethod
    def normalize_source_summary(cls, value: Any) -> Any:
        return _normalize_ai_scalar_text(value, field_name="source_summary")

    @field_validator("source_summary")
    @classmethod
    def validate_source_summary(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("拆分计划摘要不能为空")
        return value


class TailSplitPlanItem(BaseModel):
    id: str
    order: int
    title: str
    instruction: str
    visual_intent: str
    source_refs: list[str] = Field(default_factory=list)


class TailSplitPlan(BaseModel):
    version: Literal[1] = 1
    plan_id: str
    status: Literal["pending", "applied"] = "pending"
    source_summary: str
    items: list[TailSplitPlanItem] = Field(min_length=1)
    created_at: datetime


class TailAppliedBatch(BaseModel):
    batch_id: str
    plan_id: str
    item_ids: list[str]
    node_ids: list[str]
    created_at: datetime


class TailSplitterOutput(BaseModel):
    summary: str
    latest_plan: TailSplitPlan | None = None
    applied_batches: list[TailAppliedBatch] = Field(default_factory=list)


class PosterGenerationInput(BaseModel):
    """海报/改图生成入参：聚合灵感产物、可选文案与图片上下文。"""

    copy_prompt_mode: Literal["copy", "image_edit"] = "copy"
    inspiration_name: str
    category: str | None = None
    price: str | None = None
    source_note: str | None = None
    instruction: str | None = None
    image_size: str | None = None
    tool_options: dict[str, Any] | None = None
    structured_copy_context: str | None = None
    source_image: Path | None = None
    reference_images: list[ReferenceImageInput] = Field(default_factory=list)
