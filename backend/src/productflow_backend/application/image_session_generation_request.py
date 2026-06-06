from __future__ import annotations

from base64 import b64encode
from typing import Any

from productflow_backend.application.image_generation_core import (
    normalize_image_generation_tool_options,
    provider_output_with_actual_image_size,
    unique_image_generation_ids,
)
from productflow_backend.application.moderation import ensure_resource_usable
from productflow_backend.config import normalize_image_generation_size
from productflow_backend.domain.enums import ImageSessionAssetKind
from productflow_backend.domain.errors import BusinessValidationError, NotFoundError
from productflow_backend.infrastructure.db.models import ImageSession, ImageSessionAsset
from productflow_backend.infrastructure.image.chat_service import ImageChatTurn
from productflow_backend.infrastructure.storage import LocalStorage

MAX_BRANCH_CONTEXT_IMAGES = 6
IMAGE_SESSION_IMAGES_API_N_MAX_COUNT = 10


def normalize_tool_options(tool_options: dict[str, Any] | None) -> dict[str, Any] | None:
    return normalize_image_generation_tool_options(tool_options)


def validate_generation_request(
    image_session: ImageSession,
    *,
    size: str,
    base_asset_id: str | None,
    selected_reference_asset_ids: list[str] | None,
    generation_count: int,
    current_generation_task_id: str | None = None,
    max_generation_count: int,
) -> tuple[str, str | None, list[str]]:
    if not 1 <= generation_count <= max_generation_count:
        raise BusinessValidationError(f"一次生成数量必须在 1-{max_generation_count} 张之间")
    normalized_size = normalize_image_generation_size(size)
    selected_reference_ids = _unique_ids(selected_reference_asset_ids)
    if (1 if base_asset_id else 0) + len(selected_reference_ids) > MAX_BRANCH_CONTEXT_IMAGES:
        raise BusinessValidationError("本轮最多选择 6 张图片上下文（含分支基图）")

    normalized_base_asset_id: str | None = None
    if base_asset_id:
        base_asset = _find_session_asset_or_raise(
            image_session,
            base_asset_id,
            expected_kind=ImageSessionAssetKind.GENERATED_IMAGE,
        )
        normalized_base_asset_id = base_asset.id
    elif _has_prior_generation_request(image_session, current_generation_task_id=current_generation_task_id):
        raise BusinessValidationError("后续生图必须选择一张本会话已生成图片作为基图")

    normalized_reference_ids: list[str] = []
    for asset_id in selected_reference_ids:
        reference_asset = _find_session_asset_or_raise(
            image_session,
            asset_id,
            expected_kind=ImageSessionAssetKind.REFERENCE_UPLOAD,
            missing_message="会话参考图不存在",
        )
        normalized_reference_ids.append(reference_asset.id)

    return normalized_size, normalized_base_asset_id, normalized_reference_ids


def build_branch_generation_context(
    image_session: ImageSession,
    storage: LocalStorage,
    *,
    base_asset_id: str | None,
    selected_reference_asset_ids: list[str] | None,
) -> tuple[list[ImageChatTurn], list[str], str | None, str | None, list[str]]:
    """Build card-style branch context from the explicit base asset and selected references only."""

    manual_references: list[str] = []
    normalized_base_asset_id: str | None = None
    selected_reference_ids = _unique_ids(selected_reference_asset_ids)
    if (1 if base_asset_id else 0) + len(selected_reference_ids) > MAX_BRANCH_CONTEXT_IMAGES:
        raise BusinessValidationError("本轮最多选择 6 张图片上下文（含分支基图）")

    if base_asset_id:
        base_asset = _find_session_asset_or_raise(
            image_session,
            base_asset_id,
            expected_kind=ImageSessionAssetKind.GENERATED_IMAGE,
        )
        normalized_base_asset_id = base_asset.id
        manual_references.append(_session_data_url(storage, storage.object_key_for(base_asset), base_asset.mime_type))

    normalized_reference_ids: list[str] = []
    for asset_id in selected_reference_ids:
        reference_asset = _find_session_asset_or_raise(
            image_session,
            asset_id,
            expected_kind=ImageSessionAssetKind.REFERENCE_UPLOAD,
            missing_message="会话参考图不存在",
        )
        normalized_reference_ids.append(reference_asset.id)
        manual_references.append(
            _session_data_url(storage, storage.object_key_for(reference_asset), reference_asset.mime_type)
        )

    return [], manual_references[:6], None, normalized_base_asset_id, normalized_reference_ids


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


def _has_prior_generation_request(
    image_session: ImageSession,
    *,
    current_generation_task_id: str | None = None,
) -> bool:
    if current_generation_task_id is not None:
        tasks = sorted(image_session.generation_tasks, key=lambda task: (task.created_at, task.id))
        if tasks:
            return tasks[0].id != current_generation_task_id
    if image_session.rounds:
        return True
    if current_generation_task_id is None:
        return bool(image_session.generation_tasks)

    tasks = sorted(image_session.generation_tasks, key=lambda task: (task.created_at, task.id))
    if not tasks:
        return False
    return tasks[0].id != current_generation_task_id

