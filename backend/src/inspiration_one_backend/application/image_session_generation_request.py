from __future__ import annotations

from base64 import b64encode
from typing import Any

from inspiration_one_backend.application.image_generation_core import (
    normalize_image_generation_tool_options,
    provider_output_with_actual_image_size,
    unique_image_generation_ids,
)
from inspiration_one_backend.application.moderation import ensure_resource_usable
from inspiration_one_backend.config import get_runtime_settings, normalize_image_generation_size
from inspiration_one_backend.domain.enums import ImageSessionAssetKind
from inspiration_one_backend.domain.errors import BusinessValidationError, NotFoundError
from inspiration_one_backend.infrastructure.db.models import ImageSession, ImageSessionAsset
from inspiration_one_backend.infrastructure.image.chat_service import ImageChatTurn
from inspiration_one_backend.infrastructure.storage import LocalStorage

IMAGE_SESSION_IMAGES_API_N_MAX_COUNT = 10


def normalize_tool_options(tool_options: dict[str, Any] | None) -> dict[str, Any] | None:
    return normalize_image_generation_tool_options(tool_options)


def validate_generation_request(
    image_session: ImageSession,
    *,
    size: str,
    generation_count: int,
    max_generation_count: int,
    base_asset_ids: list[str] | None = None,
    base_asset_id: str | None = None,
    selected_reference_asset_ids: list[str] | None = None,
    current_generation_task_id: str | None = None,
) -> tuple[str, list[str], str | None, list[str]]:
    del current_generation_task_id
    if not 1 <= generation_count <= max_generation_count:
        raise BusinessValidationError(f"一次生成数量必须在 1-{max_generation_count} 张之间")
    normalized_size = normalize_image_generation_size(size)
    normalized_base_assets = _normalize_base_assets(
        image_session,
        base_asset_ids=base_asset_ids,
        base_asset_id=base_asset_id,
        selected_reference_asset_ids=selected_reference_asset_ids,
    )
    max_base_images = get_runtime_settings().image_session_max_base_images
    if len(normalized_base_assets) > max_base_images:
        raise BusinessValidationError(f"本轮最多选择 {max_base_images} 张图片上下文")

    return (
        normalized_size,
        [asset.id for asset in normalized_base_assets],
        _legacy_base_asset_id(normalized_base_assets),
        _legacy_selected_reference_asset_ids(normalized_base_assets),
    )


def build_branch_generation_context(
    image_session: ImageSession,
    storage: LocalStorage,
    *,
    base_asset_ids: list[str] | None = None,
    base_asset_id: str | None = None,
    selected_reference_asset_ids: list[str] | None = None,
) -> tuple[list[ImageChatTurn], list[str], str | None, list[str], str | None, list[str]]:
    """Build card-style branch context from the explicit base asset and selected references only."""

    normalized_base_assets = _normalize_base_assets(
        image_session,
        base_asset_ids=base_asset_ids,
        base_asset_id=base_asset_id,
        selected_reference_asset_ids=selected_reference_asset_ids,
    )
    max_base_images = get_runtime_settings().image_session_max_base_images
    if len(normalized_base_assets) > max_base_images:
        raise BusinessValidationError(f"本轮最多选择 {max_base_images} 张图片上下文")

    manual_references = [
        _session_data_url(storage, storage.object_key_for(asset), asset.mime_type)
        for asset in normalized_base_assets[:max_base_images]
    ]

    return (
        [],
        manual_references,
        None,
        [asset.id for asset in normalized_base_assets],
        _legacy_base_asset_id(normalized_base_assets),
        _legacy_selected_reference_asset_ids(normalized_base_assets),
    )


def images_api_batch_count(
    *,
    provider_kind: str,
    remaining_count: int,
) -> int:
    if provider_kind != "openai_images":
        return 1
    return max(1, min(remaining_count, IMAGE_SESSION_IMAGES_API_N_MAX_COUNT))


def provider_output_with_actual_size(
    provider_output_json: dict[str, Any] | None,
    *,
    requested_size: str,
    image_bytes: bytes,
) -> dict[str, Any]:
    return provider_output_with_actual_image_size(
        provider_output_json,
        requested_size=requested_size,
        image_bytes=image_bytes,
    )


def _session_data_url(storage: LocalStorage, path: str, mime_type: str) -> str:
    raw = storage.resolve(path).read_bytes()
    encoded = b64encode(raw).decode("utf-8")
    return f"data:{mime_type};base64,{encoded}"


def _find_session_asset_or_raise(
    image_session: ImageSession,
    asset_id: str,
    *,
    expected_kind: ImageSessionAssetKind | None = None,
    missing_message: str = "会话图片不存在",
) -> ImageSessionAsset:
    asset = next((item for item in image_session.assets if item.id == asset_id), None)
    if asset is None:
        raise NotFoundError(missing_message)
    if expected_kind is not None and asset.kind != expected_kind:
        if expected_kind == ImageSessionAssetKind.GENERATED_IMAGE:
            raise BusinessValidationError("只能从会话生成图继续")
        raise BusinessValidationError("只能选择会话参考图参与本轮生成")
    ensure_resource_usable(asset)
    return asset


def _unique_ids(ids: list[str] | None) -> list[str]:
    return unique_image_generation_ids(ids)


def _normalize_base_assets(
    image_session: ImageSession,
    *,
    base_asset_ids: list[str] | None,
    base_asset_id: str | None,
    selected_reference_asset_ids: list[str] | None,
) -> list[ImageSessionAsset]:
    normalized: list[ImageSessionAsset] = []
    seen: set[str] = set()

    def append_base(asset: ImageSessionAsset) -> None:
        if asset.id in seen:
            return
        seen.add(asset.id)
        normalized.append(asset)

    for asset_id in _unique_ids(base_asset_ids):
        append_base(_find_base_asset_or_raise(image_session, asset_id))

    if base_asset_id:
        append_base(_find_base_asset_or_raise(image_session, base_asset_id))

    for asset_id in _unique_ids(selected_reference_asset_ids):
        append_base(
            _find_session_asset_or_raise(
                image_session,
                asset_id,
                expected_kind=ImageSessionAssetKind.REFERENCE_UPLOAD,
                missing_message="会话参考图不存在",
            )
        )

    return normalized


def _find_base_asset_or_raise(image_session: ImageSession, asset_id: str) -> ImageSessionAsset:
    asset = _find_session_asset_or_raise(image_session, asset_id)
    if asset.kind not in {ImageSessionAssetKind.GENERATED_IMAGE, ImageSessionAssetKind.REFERENCE_UPLOAD}:
        raise BusinessValidationError("只能选择会话生成图或参考图作为基图")
    return asset


def _legacy_base_asset_id(base_assets: list[ImageSessionAsset]) -> str | None:
    generated_asset = next(
        (asset for asset in base_assets if asset.kind == ImageSessionAssetKind.GENERATED_IMAGE),
        None,
    )
    return (generated_asset or base_assets[0]).id if base_assets else None


def _legacy_selected_reference_asset_ids(base_assets: list[ImageSessionAsset]) -> list[str]:
    return [asset.id for asset in base_assets if asset.kind == ImageSessionAssetKind.REFERENCE_UPLOAD]
