from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Callable
from typing import TYPE_CHECKING

from inspiration_one_backend.application.contracts import (
    CopyNodeConfigV2,
    CopyPayloadV2,
    CreativeBriefPayload,
    DeckOutlineInput,
    DeckOutlinePayload,
    InspirationInput,
    ReferenceImageInput,
    SpeakerNotesInput,
    SpeakerNotesPayload,
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

    @abstractmethod
    def generate_outline(self, payload: DeckOutlineInput) -> tuple[DeckOutlinePayload, str]:
        raise NotImplementedError

    @abstractmethod
    def generate_speaker_notes(self, payload: SpeakerNotesInput) -> tuple[SpeakerNotesPayload, str]:
        raise NotImplementedError


if TYPE_CHECKING:
    from inspiration_one_backend.infrastructure.provider_config import ResolvedTextProviderConfig

TextProviderFactory = Callable[["ResolvedTextProviderConfig"], TextProvider]

_TEXT_PROVIDER_FACTORIES: dict[str, TextProviderFactory] = {}


def register_text_provider(provider_kind: str, factory: TextProviderFactory) -> None:
    """按 provider_kind 注册文本 provider 工厂，对齐 storage 注册表模式。"""
    _TEXT_PROVIDER_FACTORIES[provider_kind] = factory


def create_text_provider(
    provider_config: ResolvedTextProviderConfig,
    *,
    default_factory: TextProviderFactory | None = None,
) -> TextProvider:
    """按 provider_kind 查表创建文本 provider；未注册时回退到 default_factory。"""
    factory = _TEXT_PROVIDER_FACTORIES.get(provider_config.provider_kind)
    if factory is None:
        if default_factory is not None:
            return default_factory(provider_config)
        raise RuntimeError(f"暂不支持的文本 provider: {provider_config.provider_kind}")
    return factory(provider_config)
