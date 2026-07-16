from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from inspiration_one_backend.application.contracts import BlocksCopyContent, CopyBlock, CopyPayloadV2
from inspiration_one_backend.application.copy_payloads import (
    copy_payload_to_output,
    normalize_copy_payload,
)
from inspiration_one_backend.application.inspiration_workflow.context import optional_config_text
from inspiration_one_backend.application.time import now_utc
from inspiration_one_backend.domain.enums import (
    CopyStatus,
    SourceAssetKind,
    WorkflowNodeStatus,
    WorkflowNodeType,
)
from inspiration_one_backend.domain.errors import BusinessValidationError, NotFoundError
from inspiration_one_backend.infrastructure.db.models import (
    CopySet,
    Inspiration,
    InspirationWorkflow,
    PosterVariant,
    SourceAsset,
    WorkflowNode,
)
from inspiration_one_backend.infrastructure.image.base import infer_extension
from inspiration_one_backend.infrastructure.storage import (
    InvalidStorageObjectKey,
    LocalStorage,
    StorageObjectNotFound,
)


@dataclass(frozen=True, slots=True)
class GeneratedWorkflowImage:
    target_index: int
    content: bytes
    width: int
    height: int
    template_name: str
    mime_type: str
    provider_name: str | None = None
    model_name: str | None = None
    provider_response_id: str | None = None
    provider_response_status: str | None = None
    provider_output_json: dict[str, Any] | None = None


def create_context_copy_set(
    session: Session,
    *,
    inspiration: Inspiration,
    inspiration_context: dict[str, str | None],
    node: WorkflowNode,
) -> CopySet:
    instruction = optional_config_text(node.config_json, "instruction")
    inspiration_name = inspiration_context["name"] or "自由创作"
    source_note = inspiration_context["source_note"]
    blocks = [
        CopyBlock(id="inspiration-name", role="subject", label="灵感产物", text=inspiration_name),
        *[
            CopyBlock(id=f"context-{index}", role="context", label=f"上下文 {index}", text=item, priority=index)
            for index, item in enumerate(
                [
                    source_note,
                    inspiration_context["category"],
                    instruction,
                ],
                start=1,
            )
            if item
        ],
    ]
    structured_payload = CopyPayloadV2(
        purpose="workflow_context",
        summary=instruction or inspiration_name,
        content=BlocksCopyContent(blocks=blocks),
    )
    copy_set = CopySet(
        inspiration_id=inspiration.id,
        creative_brief_id=None,
        status=CopyStatus.DRAFT,
        structured_payload=structured_payload.model_dump(mode="json"),
        model_structured_payload=structured_payload.model_dump(mode="json"),
        provider_name="workflow_context",
        model_name="inspiration_context",
        prompt_version="v1",
    )
    session.add(copy_set)
    session.flush()
    inspiration.updated_at = now_utc()
    return copy_set


def image_asset_output(
    assets: list[SourceAsset],
    *,
    summary: str,
    role: str | None = None,
    label: str | None = None,
) -> dict[str, Any]:
    return {
        "source_asset_ids": [asset.id for asset in assets],
        "image_asset_ids": [asset.id for asset in assets],
        "images": [
            {
                "source_asset_id": asset.id,
                "filename": asset.original_filename,
                "mime_type": asset.mime_type,
                "role": role,
                "label": label,
            }
            for asset in assets
        ],
        "role": role,
        "label": label,
        "summary": summary,
    }


def copy_node_output(
    copy_set: CopySet,
    *,
    creative_brief_id: str | None,
    manual_edit: bool = False,
) -> dict[str, Any]:
    if not isinstance(copy_set.structured_payload, dict):
        raise ValueError("文案版本缺少 structured_payload")
    structured_payload = normalize_copy_payload(copy_set.structured_payload)
    output: dict[str, Any] = {
        "copy_set_id": copy_set.id,
        "creative_brief_id": creative_brief_id,
        **copy_payload_to_output(structured_payload),
    }
    if manual_edit:
        output["manual_edit"] = True
    return output


def lookup_source_asset_for_poster_variant(
    session: Session,
    *,
    workflow: InspirationWorkflow,
    poster_variant_id: str,
) -> SourceAsset | None:
    """Find a workflow-local SourceAsset for a poster without mutating ORM state."""
    asset = session.scalar(
        select(SourceAsset)
        .where(
            SourceAsset.inspiration_id == workflow.inspiration_id,
            SourceAsset.kind == SourceAssetKind.REFERENCE_IMAGE,
            SourceAsset.source_poster_variant_id == poster_variant_id,
        )
        .order_by(SourceAsset.created_at.desc())
    )
    if asset is not None:
        return asset

    for node in workflow.nodes:
        if node.node_type != WorkflowNodeType.IMAGE_GENERATION:
            continue
        output = node.output_json or {}
        raw_poster_ids = output.get("generated_poster_variant_ids")
        raw_source_asset_ids = output.get("filled_source_asset_ids")
        poster_ids = (
            [item for item in raw_poster_ids if isinstance(item, str)] if isinstance(raw_poster_ids, list) else []
        )
        source_asset_ids = (
            [item for item in raw_source_asset_ids if isinstance(item, str)]
            if isinstance(raw_source_asset_ids, list)
            else []
        )
        for poster_id, source_asset_id in zip(poster_ids, source_asset_ids, strict=False):
            if poster_id != poster_variant_id:
                continue
            asset = session.get(SourceAsset, source_asset_id)
            if (
                asset is not None
                and asset.inspiration_id == workflow.inspiration_id
                and asset.kind == SourceAssetKind.REFERENCE_IMAGE
            ):
                return asset
    for node in workflow.nodes:
        if node.node_type != WorkflowNodeType.REFERENCE_IMAGE:
            continue
        output = node.output_json or {}
        if output.get("source_poster_variant_id") != poster_variant_id:
            continue
        raw_source_asset_ids = output.get("source_asset_ids")
        source_asset_ids = (
            [item for item in raw_source_asset_ids if isinstance(item, str)]
            if isinstance(raw_source_asset_ids, list)
            else []
        )
        source_asset_id = source_asset_ids[0] if source_asset_ids else None
        if source_asset_id is None:
            continue
        asset = session.get(SourceAsset, source_asset_id)
        if (
            asset is not None
            and asset.inspiration_id == workflow.inspiration_id
            and asset.kind == SourceAssetKind.REFERENCE_IMAGE
        ):
            return asset
    return None


def materialize_poster_variant_source_asset(
    session: Session,
    *,
    workflow: InspirationWorkflow,
    poster_variant_id: str,
    storage: LocalStorage | None = None,
) -> SourceAsset:
    """Ensure a poster variant has a reference SourceAsset without mutating workflow nodes."""
    poster = session.get(PosterVariant, poster_variant_id)
    if poster is None or poster.inspiration_id != workflow.inspiration_id:
        raise NotFoundError("海报不存在")

    asset = lookup_source_asset_for_poster_variant(session, workflow=workflow, poster_variant_id=poster.id)
    if asset is not None:
        if asset.source_poster_variant_id is None:
            asset.source_poster_variant_id = poster.id
            session.flush()
        return asset

    storage = storage or LocalStorage()
    filename = f"poster-{poster.id}{infer_extension(poster.mime_type)}"
    try:
        reference_path = storage.copy_to_reference_upload(
            storage.object_key_for(poster),
            workflow.inspiration_id,
            content_type=poster.mime_type,
        )
    except (InvalidStorageObjectKey, StorageObjectNotFound) as exc:
        raise BusinessValidationError("海报文件不存在") from exc
    storage_metadata = storage.metadata_for(reference_path)
    asset = SourceAsset(
        inspiration_id=workflow.inspiration_id,
        kind=SourceAssetKind.REFERENCE_IMAGE,
        original_filename=filename,
        mime_type=poster.mime_type,
        **storage_metadata.as_model_kwargs(),
        source_poster_variant_id=poster.id,
    )
    session.add(asset)
    session.flush()
    return asset


def source_asset_for_poster_variant(
    session: Session,
    *,
    workflow: InspirationWorkflow,
    poster_variant_id: str,
    storage: LocalStorage | None = None,
) -> SourceAsset | None:
    """Backward-compatible write helper for poster-to-reference materialization."""
    return materialize_poster_variant_source_asset(
        session,
        workflow=workflow,
        poster_variant_id=poster_variant_id,
        storage=storage,
    )


def fill_reference_node(
    node: WorkflowNode,
    asset: SourceAsset,
    *,
    source_poster_variant_id: str | None = None,
) -> None:
    config = dict(node.config_json or {})
    config["source_asset_ids"] = [asset.id]
    config.setdefault("role", "reference")
    config.setdefault("label", node.title)
    if source_poster_variant_id:
        config["source_poster_variant_id"] = source_poster_variant_id
    else:
        config.pop("source_poster_variant_id", None)
    node.config_json = config
    node.output_json = image_asset_output(
        [asset],
        summary="已填充参考图",
        role=optional_config_text(config, "role"),
        label=optional_config_text(config, "label"),
    )
    if source_poster_variant_id:
        node.output_json["source_poster_variant_id"] = source_poster_variant_id
    node.status = WorkflowNodeStatus.SUCCEEDED
    node.failure_reason = None
    node.last_run_at = now_utc()
