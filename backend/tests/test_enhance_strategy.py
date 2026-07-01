from __future__ import annotations

from datetime import UTC, datetime
from io import BytesIO

from PIL import Image

from inspiration_one_backend.application.enhance.strategy import (
    DEFAULT_ENHANCE_PROMPT,
    DirectParams,
    EnhanceContext,
    TiledParams,
    run_direct_strategy,
    run_tiled_strategy,
)
from inspiration_one_backend.infrastructure.image.chat_service import GeneratedChatImage
from inspiration_one_backend.infrastructure.storage import LocalStorage


class FakeImageChatService:
    def __init__(self) -> None:
        self.max_reference_images = 0
        self.calls: list[dict] = []

    def generate(
        self,
        *,
        prompt: str,
        size: str,
        manual_reference_images: list[str],
        **_: object,
    ) -> GeneratedChatImage:
        width, height = (int(part) for part in size.split("x", maxsplit=1))
        self.calls.append(
            {
                "prompt": prompt,
                "size": size,
                "manual_reference_images": manual_reference_images,
                "max_reference_images": self.max_reference_images,
            }
        )
        return GeneratedChatImage(
            bytes_data=_image_bytes(width, height),
            mime_type="image/png",
            model_name="mock",
            provider_name="mock",
            prompt_version="test",
            size=size,
            generated_at=datetime.now(UTC),
        )


def test_direct_strategy_uses_default_prompt_and_custom_prompt(db_session) -> None:
    storage = LocalStorage()
    source = _image_bytes(320, 240)
    service = FakeImageChatService()
    progress: list[tuple[int, int]] = []
    ctx = EnhanceContext(
        session=db_session,
        storage=storage,
        service=service,  # type: ignore[arg-type]
        source_image_bytes=source,
        source_mime="image/png",
        source_width=320,
        source_height=240,
        output_prefix="enhance/direct-default",
        reference_limit=1,
        progress_callback=lambda completed, total: progress.append((completed, total)),
    )

    result = run_direct_strategy(ctx, DirectParams(target_width=640, target_height=480))

    assert result.final_image_ref == "enhance/direct-default/final.png"
    assert result.completed_call_count == 1
    assert progress == [(1, 1)]
    assert service.calls[0]["prompt"] == DEFAULT_ENHANCE_PROMPT
    assert service.calls[0]["size"] == "640x480"
    assert service.calls[0]["max_reference_images"] == 1

    custom_service = FakeImageChatService()
    custom_ctx = EnhanceContext(
        session=db_session,
        storage=storage,
        service=custom_service,  # type: ignore[arg-type]
        source_image_bytes=source,
        source_mime="image/png",
        source_width=320,
        source_height=240,
        output_prefix="enhance/direct-custom",
        quality_prompt="custom prompt",
    )
    run_direct_strategy(custom_ctx, DirectParams(target_width=640, target_height=480))
    assert custom_service.calls[0]["prompt"] == "custom prompt"


def test_tiled_strategy_derives_grid_and_progress_for_supported_scales(db_session) -> None:
    for scale, expected in ((2, (1, 2)), (3, (1, 2)), (4, (2, 3))):
        service = FakeImageChatService()
        progress: list[tuple[int, int]] = []
        ctx = EnhanceContext(
            session=db_session,
            storage=LocalStorage(),
            service=service,  # type: ignore[arg-type]
            source_image_bytes=_image_bytes(513, 257),
            source_mime="image/png",
            source_width=513,
            source_height=257,
            output_prefix=f"enhance/tiled-{scale}",
            reference_limit=2,
            progress_callback=_append_progress(progress),
        )

        result = run_tiled_strategy(ctx, TiledParams(scale=scale, tile_base_size=1024))

        expected_rows, expected_cols = expected
        assert (result.rows, result.cols) == expected
        assert result.final_width == 513 * scale
        assert result.final_height == 257 * scale
        assert result.completed_call_count == expected_rows * expected_cols
        assert len(result.tiles) == expected_rows * expected_cols
        assert progress[-1] == (expected_rows * expected_cols, expected_rows * expected_cols)
        assert len(service.calls) == expected_rows * expected_cols
        assert all(call["max_reference_images"] == 2 for call in service.calls)
        assert all(len(call["manual_reference_images"]) == 2 for call in service.calls)


def test_tiled_strategy_8k_final_counts_rows_times_cols(db_session) -> None:
    service = FakeImageChatService()
    ctx = EnhanceContext(
        session=db_session,
        storage=LocalStorage(),
        service=service,  # type: ignore[arg-type]
        source_image_bytes=_image_bytes(2048, 2048),
        source_mime="image/png",
        source_width=2048,
        source_height=2048,
        output_prefix="enhance/tiled-8k",
        reference_limit=2,
    )

    result = run_tiled_strategy(ctx, TiledParams(scale=4, tile_base_size=1024))

    assert (result.final_width, result.final_height) == (8192, 8192)
    assert (result.rows, result.cols) == (8, 8)
    assert result.completed_call_count == 64
    assert len(service.calls) == 64


def test_tiled_strategy_includes_custom_quality_prompt(db_session) -> None:
    service = FakeImageChatService()
    ctx = EnhanceContext(
        session=db_session,
        storage=LocalStorage(),
        service=service,  # type: ignore[arg-type]
        source_image_bytes=_image_bytes(120, 90),
        source_mime="image/png",
        source_width=120,
        source_height=90,
        output_prefix="enhance/tiled-custom-prompt",
        quality_prompt="保留原始文字边缘，不要重绘字体",
    )

    run_tiled_strategy(ctx, TiledParams(scale=2, tile_base_size=256))

    assert "保留原始文字边缘，不要重绘字体" in service.calls[0]["prompt"]


def test_tiled_strategy_backend_stitch_writes_final(db_session) -> None:
    service = FakeImageChatService()
    storage = LocalStorage()
    ctx = EnhanceContext(
        session=db_session,
        storage=storage,
        service=service,  # type: ignore[arg-type]
        source_image_bytes=_image_bytes(120, 90),
        source_mime="image/png",
        source_width=120,
        source_height=90,
        output_prefix="enhance/tiled-stitch",
    )

    result = run_tiled_strategy(ctx, TiledParams(scale=2, tile_base_size=128), backend_stitch=True)

    assert result.final_image_ref == "enhance/tiled-stitch/final.png"
    assert len(result.tiles) == 1
    assert _image_size(storage.resolve(result.final_image_ref).read_bytes()) == (240, 180)


def _image_bytes(width: int, height: int) -> bytes:
    image = Image.new("RGB", (width, height), (128, 160, 192))
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


def _append_progress(progress: list[tuple[int, int]]):
    def callback(completed: int, total: int) -> None:
        progress.append((completed, total))

    return callback


def _image_size(content: bytes) -> tuple[int, int]:
    with Image.open(BytesIO(content)) as image:
        return image.size
