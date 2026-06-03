from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel

from productflow_backend.application.copy_payloads import copy_set_structured_payload
from productflow_backend.application.product_workflow import graph as product_workflow_graph
from productflow_backend.application.product_workflow.context import normalize_product_context_config
from productflow_backend.application.use_cases import derive_product_state
from productflow_backend.domain.enums import (
    CopyStatus,
    PosterKind,
    ProductWorkflowState,
    SourceAssetKind,
    WorkflowNodeStatus,
    WorkflowNodeType,
)
from productflow_backend.domain.errors import BusinessValidationError
from productflow_backend.infrastructure.db.models import (
    CopySet,
    CreativeBrief,
    PosterVariant,
    Product,
    ProductWorkflow,
    SourceAsset,
    WorkflowNode,
    WorkflowRun,
)
from productflow_backend.presentation.image_variants import build_stored_image_urls
from productflow_backend.presentation.schemas.moderation import ResourceModerationFields, serialize_moderation_fields


class SourceAssetResponse(ResourceModerationFields):
    id: str
    kind: SourceAssetKind
    original_filename: str
    mime_type: str
    source_poster_variant_id: str | None = None
    download_url: str
    preview_url: str
    thumbnail_url: str
    created_at: datetime


class CreativeBriefSummaryResponse(BaseModel):
    id: str
    payload: dict[str, Any]
    provider_name: str
    model_name: str
    prompt_version: str
    created_at: datetime


class CopySetResponse(BaseModel):
    id: str
    creative_brief_id: str | None
    status: CopyStatus
    structured_payload: dict[str, Any]
    model_structured_payload: dict[str, Any] | None = None
    provider_name: str
    model_name: str
    prompt_version: str
    created_at: datetime
    updated_at: datetime
    edited_at: datetime | None = None
    confirmed_at: datetime | None = None


class PosterVariantResponse(ResourceModerationFields):
    id: str
    product_id: str
    copy_set_id: str
    kind: PosterKind
    template_name: str
    mime_type: str
    width: int
    height: int
    download_url: str
    preview_url: str
    thumbnail_url: str
    created_at: datetime


class ProductSummaryResponse(ResourceModerationFields):
    id: str
    owner_user_id: str
    owner_username: str | None = None
    name: str
    category: str | None = None
    price: Decimal | None = None
    workflow_state: ProductWorkflowState
    latest_copy_status: CopyStatus | None = None
    latest_poster_at: datetime | None = None
    source_image_filename: str | None = None
    source_image_download_url: str | None = None
    source_image_preview_url: str | None = None
    source_image_thumbnail_url: str | None = None
    initial_workflow_entry: str | None = None
    initial_entry_text: str | None = None
    initial_entry_text_excerpt: str | None = None
    latest_generated_image_download_url: str | None = None
    latest_generated_image_preview_url: str | None = None
    latest_generated_image_thumbnail_url: str | None = None
    deleted_at: datetime | None = None
    deleted_by_user_id: str | None = None
    created_at: datetime
    updated_at: datetime


class ProductListResponse(BaseModel):
    items: list[ProductSummaryResponse]
    total: int
    page: int
    page_size: int


class ProductDetailResponse(ResourceModerationFields):
    id: str
    owner_user_id: str
    owner_username: str | None = None
    name: str
    category: str | None = None
    price: Decimal | None = None
    source_note: str | None = None
    workflow_state: ProductWorkflowState
    source_assets: list[SourceAssetResponse]
    latest_brief: CreativeBriefSummaryResponse | None = None
    current_confirmed_copy_set: CopySetResponse | None = None
    copy_sets: list[CopySetResponse]
    poster_variants: list[PosterVariantResponse]
    deleted_at: datetime | None = None
    deleted_by_user_id: str | None = None
    created_at: datetime
    updated_at: datetime


class ProductHistoryResponse(BaseModel):
    copy_sets: list[CopySetResponse]
    poster_variants: list[PosterVariantResponse]


class CopySetUpdateRequest(BaseModel):
    structured_payload: dict[str, Any]


def serialize_source_asset(asset: SourceAsset) -> SourceAssetResponse:
    urls = build_stored_image_urls(asset, f"/api/source-assets/{asset.id}/download")
    return SourceAssetResponse(
        id=asset.id,
        kind=asset.kind,
        original_filename=asset.original_filename,
        mime_type=asset.mime_type,
        source_poster_variant_id=asset.source_poster_variant_id,
        **serialize_moderation_fields(asset).model_dump(),
        **urls,
        created_at=asset.created_at,
    )


def serialize_brief(brief: CreativeBrief) -> CreativeBriefSummaryResponse:
    return CreativeBriefSummaryResponse(
        id=brief.id,
        payload=brief.payload,
        provider_name=brief.provider_name,
        model_name=brief.model_name,
        prompt_version=brief.prompt_version,
        created_at=brief.created_at,
    )


def serialize_copy_set(copy_set: CopySet) -> CopySetResponse:
    return CopySetResponse(
        id=copy_set.id,
        creative_brief_id=copy_set.creative_brief_id,
        status=copy_set.status,
        structured_payload=copy_set_structured_payload(copy_set).model_dump(mode="json"),
        model_structured_payload=copy_set.model_structured_payload,
        provider_name=copy_set.provider_name,
        model_name=copy_set.model_name,
        prompt_version=copy_set.prompt_version,
        created_at=copy_set.created_at,
        updated_at=copy_set.updated_at,
        edited_at=copy_set.edited_at,
        confirmed_at=copy_set.confirmed_at,
    )


def serialize_poster_variant(poster: PosterVariant) -> PosterVariantResponse:
    urls = build_stored_image_urls(poster, f"/api/posters/{poster.id}/download")
    return PosterVariantResponse(
        id=poster.id,
        product_id=poster.product_id,
        copy_set_id=poster.copy_set_id,
        kind=poster.kind,
        template_name=poster.template_name,
        mime_type=poster.mime_type,
        width=poster.width,
        height=poster.height,
        **serialize_moderation_fields(poster).model_dump(),
        **urls,
        created_at=poster.created_at,
    )


def _active_workflow(product: Product) -> ProductWorkflow | None:
    workflows = sorted(product.workflows, key=lambda item: (item.updated_at, item.id), reverse=True)
    return next((workflow for workflow in workflows if workflow.active), None)


def _workflow_nodes_in_order(workflow: ProductWorkflow) -> list[WorkflowNode]:
    try:
        return product_workflow_graph.topological_nodes(workflow)
    except (BusinessValidationError, ValueError):
        return sorted(
            workflow.nodes,
            key=lambda item: (item.position_x, item.position_y, item.created_at, item.id),
        )


def _clean_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _text_excerpt(value: str | None) -> str | None:
    normalized = _clean_text(value)
    if normalized is None:
        return None
    return normalized[:6]


def _initial_entry_text(workflow: ProductWorkflow | None) -> str | None:
    if workflow is None or workflow.initial_entry_mode not in {"copy", "tail"}:
        return None

    ordered_nodes = _workflow_nodes_in_order(workflow)
    product_context_node = next(
        (node for node in ordered_nodes if node.node_type == WorkflowNodeType.PRODUCT_CONTEXT),
        None,
    )
    if product_context_node is not None:
        config = normalize_product_context_config(product_context_node.config_json)
        text = _clean_text(config.get("long_text") or config.get("source_note"))
        if text is not None:
            return text

    fallback_node_type = (
        WorkflowNodeType.COPY_GENERATION if workflow.initial_entry_mode == "copy" else WorkflowNodeType.TAIL_SPLITTER
    )
    fallback_node = next((node for node in ordered_nodes if node.node_type == fallback_node_type), None)
    if fallback_node is None:
        return None
    fallback_config = fallback_node.config_json or {}
    fallback_key = "source_note" if workflow.initial_entry_mode == "copy" else "source_text"
    return _clean_text(fallback_config.get(fallback_key))


def _datetime_sort_value(value: datetime | None) -> float:
    return value.timestamp() if value is not None else 0.0


def _latest_runs_with_generated_images(workflow: ProductWorkflow) -> list[WorkflowRun]:
    return sorted(
        [
            run
            for run in workflow.runs
            if any(
                node_run.status == WorkflowNodeStatus.SUCCEEDED and node_run.poster_variant_id
                for node_run in run.node_runs
            )
        ],
        key=lambda item: (
            _datetime_sort_value(item.finished_at or item.started_at),
            _datetime_sort_value(item.started_at),
            item.id,
        ),
        reverse=True,
    )


def _latest_generated_poster(product: Product, workflow: ProductWorkflow | None) -> PosterVariant | None:
    if workflow is None:
        return None

    poster_by_id = {poster.id: poster for poster in product.poster_variants}
    nodes_by_id = {node.id: node for node in workflow.nodes}
    node_order = {node.id: index for index, node in enumerate(_workflow_nodes_in_order(workflow))}
    for run in _latest_runs_with_generated_images(workflow):
        image_node_runs = [
            node_run
            for node_run in run.node_runs
            if node_run.status == WorkflowNodeStatus.SUCCEEDED
            and node_run.poster_variant_id
            and nodes_by_id.get(node_run.node_id) is not None
            and nodes_by_id[node_run.node_id].node_type == WorkflowNodeType.IMAGE_GENERATION
        ]
        if not image_node_runs:
            continue
        selected_node_run = min(
            image_node_runs,
            key=lambda item: (
                node_order.get(item.node_id, len(node_order)),
                _datetime_sort_value(item.finished_at or item.started_at),
                _datetime_sort_value(item.started_at),
                item.id,
            ),
        )
        if selected_node_run.poster_variant_id is None:
            continue
        poster = poster_by_id.get(selected_node_run.poster_variant_id)
        if poster is not None:
            return poster
    return None


def serialize_product_summary(product: Product) -> ProductSummaryResponse:
    latest_copy = max(product.copy_sets, key=lambda item: item.created_at, default=None)
    latest_poster = max(product.poster_variants, key=lambda item: item.created_at, default=None)
    source = next((item for item in product.source_assets if item.kind == SourceAssetKind.ORIGINAL_IMAGE), None)
    source_urls = build_stored_image_urls(source, f"/api/source-assets/{source.id}/download") if source else {}
    active_workflow = _active_workflow(product)
    initial_entry_text = _initial_entry_text(active_workflow)
    latest_generated_poster = _latest_generated_poster(product, active_workflow)
    latest_generated_urls = (
        build_stored_image_urls(latest_generated_poster, f"/api/posters/{latest_generated_poster.id}/download")
        if latest_generated_poster
        else {}
    )
    return ProductSummaryResponse(
        id=product.id,
        owner_user_id=product.owner_user_id,
        owner_username=product.owner.username if product.owner else None,
        name=product.name,
        category=product.category,
        price=product.price,
        workflow_state=derive_product_state(product),
        latest_copy_status=latest_copy.status if latest_copy else None,
        latest_poster_at=latest_poster.created_at if latest_poster else None,
        source_image_filename=source.original_filename if source else None,
        source_image_download_url=source_urls.get("download_url"),
        source_image_preview_url=source_urls.get("preview_url"),
        source_image_thumbnail_url=source_urls.get("thumbnail_url"),
        initial_workflow_entry=active_workflow.initial_entry_mode if active_workflow else None,
        initial_entry_text=initial_entry_text,
        initial_entry_text_excerpt=_text_excerpt(initial_entry_text),
        latest_generated_image_download_url=latest_generated_urls.get("download_url"),
        latest_generated_image_preview_url=latest_generated_urls.get("preview_url"),
        latest_generated_image_thumbnail_url=latest_generated_urls.get("thumbnail_url"),
        **serialize_moderation_fields(product).model_dump(),
        deleted_at=product.deleted_at,
        deleted_by_user_id=product.deleted_by_user_id,
        created_at=product.created_at,
        updated_at=product.updated_at,
    )


def serialize_product_detail(product: Product) -> ProductDetailResponse:
    latest_brief = max(product.creative_briefs, key=lambda item: item.created_at, default=None)
    copy_sets = sorted(product.copy_sets, key=lambda item: item.created_at, reverse=True)
    poster_variants = sorted(product.poster_variants, key=lambda item: item.created_at, reverse=True)
    return ProductDetailResponse(
        id=product.id,
        owner_user_id=product.owner_user_id,
        owner_username=product.owner.username if product.owner else None,
        name=product.name,
        category=product.category,
        price=product.price,
        source_note=product.source_note,
        workflow_state=derive_product_state(product),
        source_assets=[serialize_source_asset(item) for item in product.source_assets],
        latest_brief=serialize_brief(latest_brief) if latest_brief else None,
        current_confirmed_copy_set=(
            serialize_copy_set(product.confirmed_copy_set) if product.confirmed_copy_set else None
        ),
        copy_sets=[serialize_copy_set(item) for item in copy_sets],
        poster_variants=[serialize_poster_variant(item) for item in poster_variants],
        **serialize_moderation_fields(product).model_dump(),
        deleted_at=product.deleted_at,
        deleted_by_user_id=product.deleted_by_user_id,
        created_at=product.created_at,
        updated_at=product.updated_at,
    )
