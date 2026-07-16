from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from inspiration_one_backend.application.contracts import PosterGenerationInput, ReferenceImageInput
from inspiration_one_backend.application.inspiration_workflow.image_generation import (
    generate_workflow_images_concurrently,
)
from inspiration_one_backend.application.inspiration_workflow_dependencies import (
    WorkflowExecutionDependencies,
    default_workflow_execution_dependencies,
)
from inspiration_one_backend.domain.enums import PosterKind


def test_workflow_execution_dependencies_use_explicit_resolvers_without_global_factories() -> None:
    text_provider = object()
    image_provider = object()
    rendered_paths: list[Path] = []

    def renderer_factory(font_path: Path) -> Any:
        rendered_paths.append(font_path)
        return {"font_path": font_path}

    dependencies = WorkflowExecutionDependencies(
        text_provider_resolver=lambda: text_provider,
        image_provider_resolver=lambda: image_provider,
        poster_renderer_factory=renderer_factory,
    )

    font_path = Path("/tmp/inspiration-one-test-font.ttf")

    assert dependencies.text_provider() is text_provider
    assert dependencies.image_provider() is image_provider
    assert dependencies.poster_renderer(font_path) == {"font_path": font_path}
    assert rendered_paths == [font_path]


def test_default_workflow_execution_dependencies_use_direct_factory_resolvers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    text_provider = object()
    image_provider = object()

    monkeypatch.setattr(
        "inspiration_one_backend.application.inspiration_workflow_dependencies.get_text_provider",
        lambda: text_provider,
    )
    monkeypatch.setattr(
        "inspiration_one_backend.application.inspiration_workflow_dependencies.get_image_provider",
        lambda: image_provider,
    )

    dependencies = default_workflow_execution_dependencies()

    assert dependencies.text_provider() is text_provider
    assert dependencies.image_provider() is image_provider


def test_workflow_image_generation_uses_injected_renderer_factory() -> None:
    rendered_font_paths: list[Path] = []

    class FakeRenderer:
        def __init__(self, font_path: Path) -> None:
            rendered_font_paths.append(font_path)

        def render(self, render_input: PosterGenerationInput, kind: PosterKind) -> bytes:
            assert render_input.inspiration_name == "渲染注入测试"
            assert kind == PosterKind.MAIN_IMAGE
            return b"injected-renderer-bytes"

    font_path = Path("/tmp/inspiration-one-injected-renderer.ttf")
    source_image = ReferenceImageInput(
        bytes_data=b"injected-source-bytes",
        mime_type="image/png",
        filename="injected-source.png",
        source_key="inspirations/test/injected-source.png",
    )

    generated = generate_workflow_images_concurrently(
        render_input=PosterGenerationInput(
            inspiration_name="渲染注入测试",
            structured_copy_context="摘要：测试主标题\n卖点：卖点一\n卖点：卖点二\n卖点：卖点三",
            source_image=source_image,
        ),
        kind=PosterKind.MAIN_IMAGE,
        target_count=1,
        poster_generation_mode="rendered",
        poster_font_path=font_path,
        image_providers=None,
        renderer_factory=FakeRenderer,
    )

    assert rendered_font_paths == [font_path]
    assert generated[0].content == b"injected-renderer-bytes"
