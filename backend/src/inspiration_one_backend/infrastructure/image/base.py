from __future__ import annotations

from abc import ABC, abstractmethod
from base64 import b64decode, b64encode
from collections.abc import Callable
from io import BytesIO
from typing import TYPE_CHECKING, Any

from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel

from inspiration_one_backend.application.contracts import PosterGenerationInput, ReferenceImageInput
from inspiration_one_backend.domain.enums import PosterKind


class GeneratedImagePayload(BaseModel):
    kind: PosterKind
    bytes_data: bytes
    mime_type: str = "image/png"
    width: int
    height: int
    variant_label: str
    provider_response_id: str | None = None
    provider_response_status: str | None = None
    provider_output_json: dict[str, Any] | None = None


class ImageProvider(ABC):
    """图片生成器抽象接口：用于 AI 海报生成。"""

    provider_name: str
    prompt_version: str = "v1"

    @abstractmethod
    def generate_poster_image(
        self,
        poster: PosterGenerationInput,
        kind: PosterKind,
    ) -> tuple[GeneratedImagePayload, str]:
        raise NotImplementedError


def parse_size(size: str) -> tuple[int, int]:
    width_str, height_str = size.lower().split("x", maxsplit=1)
    return int(width_str), int(height_str)


def decode_b64_image(data: str) -> bytes:
    return b64decode(data)


def encode_reference_image(reference: ReferenceImageInput) -> str:
    raw = reference.path.read_bytes()
    encoded = b64encode(raw).decode("utf-8")
    return f"data:{reference.mime_type};base64,{encoded}"


def infer_extension(mime_type: str) -> str:
    return {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
    }.get(mime_type, ".bin")


def image_dimensions_from_bytes(bytes_data: bytes) -> tuple[int, int] | None:
    try:
        with Image.open(BytesIO(bytes_data)) as image:
            return image.width, image.height
    except (OSError, UnidentifiedImageError):
        return None


if TYPE_CHECKING:
    from inspiration_one_backend.infrastructure.provider_config import ResolvedImageProviderConfig

ImageProviderFactory = Callable[["ResolvedImageProviderConfig"], ImageProvider]

_IMAGE_PROVIDER_FACTORIES: dict[str, ImageProviderFactory] = {}


def register_image_provider(provider_kind: str, factory: ImageProviderFactory) -> None:
    """按 provider_kind 注册图片 provider 工厂，对齐 storage 注册表模式。"""
    _IMAGE_PROVIDER_FACTORIES[provider_kind] = factory


def create_image_provider(
    provider_config: ResolvedImageProviderConfig,
    *,
    default_factory: ImageProviderFactory | None = None,
) -> ImageProvider:
    """按 provider_kind 查表创建图片 provider；未注册且无兜底时报错。"""
    factory = _IMAGE_PROVIDER_FACTORIES.get(provider_config.provider_kind)
    if factory is None:
        if default_factory is not None:
            return default_factory(provider_config)
        raise RuntimeError(f"暂不支持的图片 provider: {provider_config.provider_kind}")
    return factory(provider_config)
