from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from inspect import Parameter, signature
from pathlib import Path

from productflow_backend.infrastructure.image.base import ImageProvider
from productflow_backend.infrastructure.image.factory import get_image_provider
from productflow_backend.infrastructure.poster.renderer import PosterRenderer
from productflow_backend.infrastructure.text.base import TextProvider
from productflow_backend.infrastructure.text.factory import get_text_provider

TextProviderResolver = Callable[..., TextProvider]
ImageProviderResolver = Callable[..., ImageProvider]
PosterRendererFactory = Callable[[Path], PosterRenderer]


def _provider_from_resolver[T](resolver: Callable[..., T], generation_config_id: str | None = None) -> T:
    try:
        resolver_signature = signature(resolver)
    except (TypeError, ValueError):
        return resolver(generation_config_id)
    parameters = list(resolver_signature.parameters.values())
    accepts_positional = any(
        parameter.kind
        in {
            Parameter.POSITIONAL_ONLY,
            Parameter.POSITIONAL_OR_KEYWORD,
            Parameter.VAR_POSITIONAL,
        }
        for parameter in parameters
    )
    accepts_keyword = any(
        parameter.kind
        in {
            Parameter.POSITIONAL_OR_KEYWORD,
            Parameter.KEYWORD_ONLY,
            Parameter.VAR_KEYWORD,
        }
        for parameter in parameters
    )
    if accepts_positional:
        return resolver(generation_config_id)
    if accepts_keyword:
        return resolver(generation_config_id=generation_config_id)
    return resolver()


def _default_text_provider(generation_config_id: str | None = None) -> TextProvider:
    return _provider_from_resolver(get_text_provider, generation_config_id)


def _default_image_provider(generation_config_id: str | None = None) -> ImageProvider:
    return _provider_from_resolver(get_image_provider, generation_config_id)


@dataclass(frozen=True, slots=True)
class WorkflowExecutionDependencies:
    """Explicit dependency seam for workflow execution provider/renderer adapters."""

    text_provider_resolver: TextProviderResolver = _default_text_provider
    image_provider_resolver: ImageProviderResolver = _default_image_provider
    poster_renderer_factory: PosterRendererFactory = PosterRenderer

    def text_provider(self, generation_config_id: str | None = None) -> TextProvider:
        return _provider_from_resolver(self.text_provider_resolver, generation_config_id)

    def image_provider(self, generation_config_id: str | None = None) -> ImageProvider:
        return _provider_from_resolver(self.image_provider_resolver, generation_config_id)

    def poster_renderer(self, font_path: Path) -> PosterRenderer:
        return self.poster_renderer_factory(font_path)


def default_workflow_execution_dependencies() -> WorkflowExecutionDependencies:
    return WorkflowExecutionDependencies()
