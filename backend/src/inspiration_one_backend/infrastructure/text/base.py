from __future__ import annotations

from abc import ABC, abstractmethod

from inspiration_one_backend.application.contracts import (
    CopyNodeConfigV2,
    CopyPayloadV2,
    CreativeBriefPayload,
    InspirationInput,
    ReferenceImageInput,
    TailSplitPlanDraft,
    TailSplitPlanInput,
)


class TextProvider(ABC):
    """文本生成器抽象接口：灵感产物理解(brief) + 文案生成(copy)。"""

    provider_name: str
    prompt_version: str = "v1"

    @abstractmethod
    def generate_brief(self, inspiration: InspirationInput) -> tuple[CreativeBriefPayload, str]:
        raise NotImplementedError

    @abstractmethod
    def generate_copy(
        self,
        inspiration: InspirationInput,
        brief: CreativeBriefPayload,
        config: CopyNodeConfigV2,
        reference_images: list[ReferenceImageInput] | None = None,
    ) -> tuple[CopyPayloadV2, str]:
        raise NotImplementedError

    @abstractmethod
    def polish_image_prompt(self, prompt: str) -> tuple[str, str]:
        raise NotImplementedError

    @abstractmethod
    def generate_tail_split_plan(self, payload: TailSplitPlanInput) -> tuple[TailSplitPlanDraft, str]:
        raise NotImplementedError
