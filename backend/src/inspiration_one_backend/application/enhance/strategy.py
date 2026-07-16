from __future__ import annotations

from base64 import b64encode
from collections.abc import Callable
from dataclasses import dataclass
from io import BytesIO
from math import ceil

from PIL import Image, ImageOps
from sqlalchemy.orm import Session

from inspiration_one_backend.infrastructure.image.base import image_dimensions_from_bytes
from inspiration_one_backend.infrastructure.image.chat_service import ImageChatService
from inspiration_one_backend.infrastructure.storage import LocalStorage

from .limits import ENHANCE_FINAL_MAX_UPLOAD_BYTES

DEFAULT_ENHANCE_PROMPT = "在保持主体与构图不变的前提下，提升清晰度、细节与画质。"
TILED_ENHANCE_PROMPT_TEMPLATE = """请对【附图 2】进行超分辨率增强。

【附图 1】是完整的原始图片，仅用作全局风格、色调、光照、主体的参考。
【附图 2】是从原图中切出的第 {row} 行第 {col} 列（共 {rows}x{cols} 块）局部区域，
该区域在最终图中的相对位置为左上角 ({x_pct:.2f}%, {y_pct:.2f}%)。
{quality_instruction}

任务：
1. 在保持与原图整体风格、色调、光照完全一致的前提下，增强【附图 2】这一局部的清晰度、纹理细节、边缘锐度。
2. 不得改变主体内容、构图、物体相对位置。
3. 输出尺寸严格匹配 {tile_width}x{tile_height}，输出范围必须覆盖输入切片的完整区域。
"""


@dataclass(frozen=True, slots=True)
class DirectParams:
    target_width: int
    target_height: int


@dataclass(frozen=True, slots=True)
class TiledParams:
    scale: int
    tile_base_size: int = 1024
    overlap_pct: int = 10


@dataclass(frozen=True, slots=True)
class EnhanceContext:
    session: Session
    storage: LocalStorage
    service: ImageChatService
    source_image_bytes: bytes
    source_mime: str
    source_width: int
    source_height: int
    output_prefix: str
    reference_limit: int = 2
    quality_prompt: str | None = None
    progress_callback: Callable[[int, int], None] | None = None
    cancel_check: Callable[[], bool] | None = None


@dataclass(frozen=True, slots=True)
class EnhanceTile:
    row: int
    col: int
    rows: int
    cols: int
    storage_key: str
    target_x: int
    target_y: int
    target_width: int
    target_height: int
    blend_edges: tuple[str, ...]
    width: int
    height: int
    source_x: int
    source_y: int
    source_width: int
    source_height: int


@dataclass(frozen=True, slots=True)
class EnhanceResult:
    tiles: list[EnhanceTile]
    final_width: int
    final_height: int
    rows: int
    cols: int
    final_image_ref: str | None = None
    completed_call_count: int = 0


class EnhanceCancelledError(RuntimeError):
    """Raised when the caller's cancellation callback asks a strategy to stop."""


def run_direct_strategy(ctx: EnhanceContext, params: DirectParams) -> EnhanceResult:
    _validate_direct_params(params)
    if ctx.cancel_check is not None and ctx.cancel_check():
        raise EnhanceCancelledError("图片增强已取消")
    ctx.service.max_reference_images = ctx.reference_limit
    prompt = ctx.quality_prompt or DEFAULT_ENHANCE_PROMPT
    result = ctx.service.generate(
        prompt=prompt,
        size=f"{params.target_width}x{params.target_height}",
        manual_reference_images=[_data_url(ctx.source_image_bytes, ctx.source_mime)],
    )
    dimensions = image_dimensions_from_bytes(result.bytes_data)
    if dimensions != (params.target_width, params.target_height):
        raise ValueError("图片供应商返回的尺寸与请求尺寸不一致")
    storage_key = ctx.storage.save_enhance_final(
        ctx.output_prefix,
        result.bytes_data,
        content_type=result.mime_type,
    )
    _emit_progress(ctx, 1, 1)
    tile = EnhanceTile(
        row=0,
        col=0,
        rows=1,
        cols=1,
        storage_key=storage_key,
        target_x=0,
        target_y=0,
        target_width=params.target_width,
        target_height=params.target_height,
        blend_edges=(),
        width=params.target_width,
        height=params.target_height,
        source_x=0,
        source_y=0,
        source_width=ctx.source_width,
        source_height=ctx.source_height,
    )
    return EnhanceResult(
        tiles=[tile],
        final_width=params.target_width,
        final_height=params.target_height,
        rows=1,
        cols=1,
        final_image_ref=storage_key,
        completed_call_count=1,
    )


def run_tiled_strategy(ctx: EnhanceContext, params: TiledParams, *, backend_stitch: bool = False) -> EnhanceResult:
    _validate_tiled_params(params)
    ctx.service.max_reference_images = ctx.reference_limit
    final_width = ctx.source_width * params.scale
    final_height = ctx.source_height * params.scale
    cols = ceil(final_width / params.tile_base_size)
    rows = ceil(final_height / params.tile_base_size)
    total = rows * cols
    source_image = _open_image(ctx.source_image_bytes)
    full_reference = _data_url(ctx.source_image_bytes, ctx.source_mime)
    tiles: list[EnhanceTile] = []
    completed = 0
    for row in range(rows):
        for col in range(cols):
            if ctx.cancel_check is not None and ctx.cancel_check():
                raise EnhanceCancelledError("图片增强已取消")
            geometry = _tile_geometry(
                row=row,
                col=col,
                rows=rows,
                cols=cols,
                final_width=final_width,
                final_height=final_height,
                source_width=ctx.source_width,
                source_height=ctx.source_height,
                tile_base_size=params.tile_base_size,
                overlap_pct=params.overlap_pct,
            )
            tile_bytes = _render_source_tile(source_image, geometry)
            result = ctx.service.generate(
                prompt=_tile_prompt(
                    row=row,
                    col=col,
                    rows=rows,
                    cols=cols,
                    final_width=final_width,
                    final_height=final_height,
                    quality_prompt=ctx.quality_prompt,
                    **geometry,
                ),
                size=f"{geometry['target_width']}x{geometry['target_height']}",
                manual_reference_images=[full_reference, _data_url(tile_bytes, "image/png")],
            )
            normalized_bytes = _resize_image_bytes(
                result.bytes_data,
                width=geometry["target_width"],
                height=geometry["target_height"],
            )
            storage_key = ctx.storage.save_enhance_tile(
                ctx.output_prefix,
                row,
                col,
                normalized_bytes,
                content_type=result.mime_type,
            )
            tiles.append(
                EnhanceTile(
                    row=row,
                    col=col,
                    rows=rows,
                    cols=cols,
                    storage_key=storage_key,
                    target_x=geometry["target_x"],
                    target_y=geometry["target_y"],
                    target_width=geometry["target_width"],
                    target_height=geometry["target_height"],
                    blend_edges=_blend_edges(row=row, col=col, rows=rows, cols=cols),
                    width=geometry["target_width"],
                    height=geometry["target_height"],
                    source_x=geometry["source_x"],
                    source_y=geometry["source_y"],
                    source_width=geometry["source_width"],
                    source_height=geometry["source_height"],
                )
            )
            completed += 1
            _emit_progress(ctx, completed, total)

    final_image_ref = (
        stitch_tiles(ctx, tiles, final_width=final_width, final_height=final_height) if backend_stitch else None
    )
    result_tiles = (
        [
            EnhanceTile(
                row=0,
                col=0,
                rows=1,
                cols=1,
                storage_key=final_image_ref,
                target_x=0,
                target_y=0,
                target_width=final_width,
                target_height=final_height,
                blend_edges=(),
                width=final_width,
                height=final_height,
                source_x=0,
                source_y=0,
                source_width=ctx.source_width,
                source_height=ctx.source_height,
            )
        ]
        if final_image_ref is not None
        else tiles
    )
    return EnhanceResult(
        tiles=result_tiles,
        final_width=final_width,
        final_height=final_height,
        rows=rows,
        cols=cols,
        final_image_ref=final_image_ref,
        completed_call_count=completed,
    )


def stitch_tiles(ctx: EnhanceContext, tiles: list[EnhanceTile], *, final_width: int, final_height: int) -> str:
    canvas = Image.new("RGBA", (final_width, final_height), (0, 0, 0, 0))
    for tile in tiles:
        tile_bytes = ctx.storage.read_bytes(tile.storage_key, max_bytes=ENHANCE_FINAL_MAX_UPLOAD_BYTES)
        with Image.open(BytesIO(tile_bytes)) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGBA")
            if image.size != (tile.target_width, tile.target_height):
                image = image.resize((tile.target_width, tile.target_height), Image.Resampling.LANCZOS)
            canvas.alpha_composite(image, (tile.target_x, tile.target_y))
    output = BytesIO()
    canvas.save(output, format="PNG")
    return ctx.storage.save_enhance_final(ctx.output_prefix, output.getvalue(), content_type="image/png")


def _validate_direct_params(params: DirectParams) -> None:
    if params.target_width <= 0 or params.target_height <= 0:
        raise ValueError("增强目标尺寸必须大于 0")


def _validate_tiled_params(params: TiledParams) -> None:
    if params.scale not in {2, 3, 4}:
        raise ValueError("分块增强倍数只能是 2、3 或 4")
    if params.tile_base_size <= 0:
        raise ValueError("分块尺寸必须大于 0")
    if params.overlap_pct < 0 or params.overlap_pct >= 50:
        raise ValueError("分块重叠比例必须在 0-49 之间")


def _data_url(content: bytes, mime_type: str) -> str:
    return f"data:{mime_type};base64,{b64encode(content).decode('utf-8')}"


def _open_image(content: bytes) -> Image.Image:
    with Image.open(BytesIO(content)) as opened:
        return ImageOps.exif_transpose(opened).convert("RGB")


def _tile_geometry(
    *,
    row: int,
    col: int,
    rows: int,
    cols: int,
    final_width: int,
    final_height: int,
    source_width: int,
    source_height: int,
    tile_base_size: int,
    overlap_pct: int,
) -> dict[str, int]:
    target_x = col * tile_base_size
    target_y = row * tile_base_size
    target_width = min(tile_base_size, final_width - target_x)
    target_height = min(tile_base_size, final_height - target_y)
    source_x = target_x // max(1, final_width // source_width)
    source_y = target_y // max(1, final_height // source_height)
    source_tile_width = ceil(target_width / (final_width / source_width))
    source_tile_height = ceil(target_height / (final_height / source_height))
    overlap_x = round(source_tile_width * overlap_pct / 100)
    overlap_y = round(source_tile_height * overlap_pct / 100)
    expanded_x = max(0, source_x - (0 if col == 0 else overlap_x))
    expanded_y = max(0, source_y - (0 if row == 0 else overlap_y))
    expanded_right = min(source_width, source_x + source_tile_width + (0 if col == cols - 1 else overlap_x))
    expanded_bottom = min(source_height, source_y + source_tile_height + (0 if row == rows - 1 else overlap_y))
    return {
        "target_x": target_x,
        "target_y": target_y,
        "target_width": target_width,
        "target_height": target_height,
        "source_x": expanded_x,
        "source_y": expanded_y,
        "source_width": max(1, expanded_right - expanded_x),
        "source_height": max(1, expanded_bottom - expanded_y),
    }


def _render_source_tile(source_image: Image.Image, geometry: dict[str, int]) -> bytes:
    tile = source_image.crop(
        (
            geometry["source_x"],
            geometry["source_y"],
            geometry["source_x"] + geometry["source_width"],
            geometry["source_y"] + geometry["source_height"],
        )
    )
    tile = tile.resize((geometry["target_width"], geometry["target_height"]), Image.Resampling.LANCZOS)
    output = BytesIO()
    tile.save(output, format="PNG")
    return output.getvalue()


def _resize_image_bytes(content: bytes, *, width: int, height: int) -> bytes:
    with Image.open(BytesIO(content)) as opened:
        image = ImageOps.exif_transpose(opened)
        if image.size == (width, height):
            return content
        resized = image.resize((width, height), Image.Resampling.LANCZOS)
        output = BytesIO()
        image_format = opened.format or "PNG"
        resized.save(output, format=image_format)
        return output.getvalue()


def _tile_prompt(
    *,
    row: int,
    col: int,
    rows: int,
    cols: int,
    target_x: int,
    target_y: int,
    target_width: int,
    target_height: int,
    final_width: int,
    final_height: int,
    quality_prompt: str | None = None,
    **_: int,
) -> str:
    return TILED_ENHANCE_PROMPT_TEMPLATE.format(
        row=row + 1,
        col=col + 1,
        rows=rows,
        cols=cols,
        x_pct=(target_x / final_width) * 100 if final_width else 0,
        y_pct=(target_y / final_height) * 100 if final_height else 0,
        quality_instruction=f"\n额外画质要求：{quality_prompt}" if quality_prompt else "",
        tile_width=target_width,
        tile_height=target_height,
    )


def _blend_edges(*, row: int, col: int, rows: int, cols: int) -> tuple[str, ...]:
    edges: list[str] = []
    if row > 0:
        edges.append("top")
    if col < cols - 1:
        edges.append("right")
    if row < rows - 1:
        edges.append("bottom")
    if col > 0:
        edges.append("left")
    return tuple(edges)


def _emit_progress(ctx: EnhanceContext, completed: int, total: int) -> None:
    if ctx.progress_callback is not None:
        ctx.progress_callback(completed, total)
