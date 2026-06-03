from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any, Literal, cast

from sqlalchemy import desc, exists, func, literal, select
from sqlalchemy.orm import Session, selectinload

from productflow_backend.application.copy_payloads import normalize_copy_payload
from productflow_backend.application.moderation import ensure_resource_usable
from productflow_backend.application.ownership import ensure_actor_can_mutate_owner, resolve_owner_user_id
from productflow_backend.application.product_workflow import graph as product_workflow_graph
from productflow_backend.application.product_workflow.templates import (
    materialize_product_workflow_from_template,
    resolve_product_creation_canvas_template,
)
from productflow_backend.application.time import now_utc
from productflow_backend.domain.durable_generation_tasks import WORKFLOW_RUN_GENERATION_TASK_CONTRACT
from productflow_backend.domain.enums import (
    CopyStatus,
    ProductWorkflowState,
    SourceAssetKind,
    WorkflowNodeType,
)
from productflow_backend.domain.errors import BusinessValidationError, NotFoundError
from productflow_backend.infrastructure.db.models import (
    CopySet,
    PosterVariant,
    Product,
    ProductWorkflow,
    SourceAsset,
    WorkflowEdge,
    WorkflowNode,
    WorkflowNodeRun,
    WorkflowRun,
)
from productflow_backend.infrastructure.storage import LocalStorage

InitialWorkflowEntry = Literal["image", "copy", "tail", "blank"]


def _normalize_required_text(value: str, *, field_name: str, max_length: int) -> str:
    normalized = value.strip()
    if not normalized:
        raise BusinessValidationError(f"{field_name}不能为空")
    if len(normalized) > max_length:
        raise BusinessValidationError(f"{field_name}不能超过 {max_length} 个字符")
    return normalized


def _normalize_optional_text(value: str | None, *, field_name: str, max_length: int) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if len(normalized) > max_length:
        raise BusinessValidationError(f"{field_name}不能超过 {max_length} 个字符")
    return normalized


def _normalize_optional_search_text(value: str | None, *, max_length: int) -> str | None:
    if value is None:
        return None
    normalized = " ".join(value.strip().split())
    if not normalized:
        return None
    return normalized[:max_length]


def _normalize_price(value: str | None) -> Decimal | None:
    if value is None or not value.strip():
        return None
    try:
        price = Decimal(value.strip())
    except InvalidOperation as exc:
        raise BusinessValidationError("价格格式不正确") from exc
    if not price.is_finite() or price < 0:
        raise BusinessValidationError("价格必须是非负数字")
    if abs(price.as_tuple().exponent) > 2:
        raise BusinessValidationError("价格最多保留两位小数")
    return price


def _normalize_initial_workflow_entry(value: str | None) -> InitialWorkflowEntry:
    normalized = (value or "image").strip() or "image"
    if normalized not in {"image", "copy", "tail", "blank"}:
        raise BusinessValidationError("初始工作台入口不支持")
    return cast(InitialWorkflowEntry, normalized)


def _normalize_entry_text(value: str | None, *, initial_workflow_entry: InitialWorkflowEntry) -> str | None:
    if initial_workflow_entry not in {"copy", "tail"}:
        return _normalize_optional_text(value, field_name="入口内容", max_length=4000)
    normalized = _normalize_required_text(value or "", field_name="入口内容", max_length=4000)
    if initial_workflow_entry == "copy" and len(normalized) < 4:
        raise BusinessValidationError("文案入口内容太短")
    if initial_workflow_entry == "tail" and len(normalized) < 4:
        raise BusinessValidationError("尾巴入口内容太短")
    return normalized


def _materialize_initial_workflow(
    session: Session,
    *,
    product: Product,
    initial_workflow_entry: InitialWorkflowEntry,
    entry_text: str | None,
    source_asset: SourceAsset | None,
) -> None:
    workflow = ProductWorkflow(
        product_id=product.id,
        title=product_workflow_graph.DEFAULT_WORKFLOW_TITLE,
        active=True,
        initial_entry_mode=initial_workflow_entry,
    )
    session.add(workflow)
    session.flush()

    product_context_node = WorkflowNode(
        workflow_id=workflow.id,
        node_type=WorkflowNodeType.PRODUCT_CONTEXT,
        title="灵感",
        position_x=40,
        position_y=120,
        config_json={},
    )
    session.add(product_context_node)
    session.flush()

    if initial_workflow_entry == "image":
        if source_asset is None:
            raise BusinessValidationError("图片入口需要上传灵感主图")
        session.delete(product_context_node)
        session.flush()

        nodes_by_key: dict[str, WorkflowNode] = {}
        for spec in product_workflow_graph.default_node_specs(product):
            key = str(spec.pop("key"))
            node = WorkflowNode(workflow_id=workflow.id, **spec)
            session.add(node)
            nodes_by_key[key] = node
        session.flush()
        for edge in product_workflow_graph.default_edges(nodes_by_key, workflow.id):
            session.add(edge)
        return

    if initial_workflow_entry == "blank":
        return

    if initial_workflow_entry == "copy":
        copy_node = WorkflowNode(
            workflow_id=workflow.id,
            node_type=WorkflowNodeType.COPY_GENERATION,
            title="文案",
            position_x=320,
            position_y=100,
            config_json={
                "version": 2,
                "instruction": f"基于以下入口内容生成一版适合灵感图的文案：\n{entry_text}",
                "source_note": entry_text,
                "tone": "清晰可信",
                "channel": "灵感图",
                "output_mode": "blocks",
                "generation_config_mode": "auto",
                "generation_config_id": None,
            },
        )
        session.add(copy_node)
        session.flush()
        session.add(
            WorkflowEdge(
                workflow_id=workflow.id,
                source_node_id=product_context_node.id,
                target_node_id=copy_node.id,
                source_handle="output",
                target_handle="input",
            )
        )
        return

    tail_node = WorkflowNode(
        workflow_id=workflow.id,
        node_type=WorkflowNodeType.TAIL_SPLITTER,
        title="尾巴节点",
        position_x=320,
        position_y=100,
        config_json={
            "description": "根据入口内容拆分为可执行的生图方向。",
            "source_text": entry_text,
            "max_items": 8,
            "generation_config_mode": "auto",
            "generation_config_id": None,
            "document_source": None,
        },
    )
    session.add(tail_node)
    session.flush()
    session.add(
        WorkflowEdge(
            workflow_id=workflow.id,
            source_node_id=product_context_node.id,
            target_node_id=tail_node.id,
            source_handle="output",
            target_handle="input",
        )
    )


def _product_query():
    return (
        select(Product)
        .options(
            selectinload(Product.source_assets),
            selectinload(Product.creative_briefs),
            selectinload(Product.copy_sets),
            selectinload(Product.poster_variants),
            selectinload(Product.confirmed_copy_set),
            selectinload(Product.owner),
            selectinload(Product.deleted_by),
            selectinload(Product.workflows).load_only(
                ProductWorkflow.id,
                ProductWorkflow.product_id,
                ProductWorkflow.active,
                ProductWorkflow.initial_entry_mode,
                ProductWorkflow.created_at,
                ProductWorkflow.updated_at,
            ),
            selectinload(Product.workflows)
            .selectinload(ProductWorkflow.nodes)
            .load_only(
                WorkflowNode.id,
                WorkflowNode.workflow_id,
                WorkflowNode.node_type,
                WorkflowNode.position_x,
                WorkflowNode.position_y,
                WorkflowNode.config_json,
                WorkflowNode.created_at,
            ),
            selectinload(Product.workflows)
            .selectinload(ProductWorkflow.edges)
            .load_only(
                WorkflowEdge.id,
                WorkflowEdge.workflow_id,
                WorkflowEdge.source_node_id,
                WorkflowEdge.target_node_id,
                WorkflowEdge.created_at,
            ),
            selectinload(Product.workflows)
            .selectinload(ProductWorkflow.runs)
            .load_only(
                WorkflowRun.id,
                WorkflowRun.workflow_id,
                WorkflowRun.status,
                WorkflowRun.started_at,
                WorkflowRun.finished_at,
            )
            .selectinload(WorkflowRun.node_runs)
            .load_only(
                WorkflowNodeRun.id,
                WorkflowNodeRun.workflow_run_id,
                WorkflowNodeRun.node_id,
                WorkflowNodeRun.status,
                WorkflowNodeRun.poster_variant_id,
                WorkflowNodeRun.started_at,
                WorkflowNodeRun.finished_at,
            ),
        )
        .order_by(desc(Product.updated_at))
    )


def _get_product_or_raise(
    session: Session,
    product_id: str,
    *,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
) -> Product:
    stmt = _product_query().where(Product.id == product_id)
    if actor_user_id is not None and not actor_is_admin:
        stmt = stmt.where(Product.owner_user_id == actor_user_id, Product.deleted_at.is_(None))
    product = session.scalar(stmt)
    if product is None:
        raise NotFoundError("商品不存在")
    return product


def _get_copy_set_or_raise(session: Session, copy_set_id: str) -> CopySet:
    stmt = select(CopySet).options(selectinload(CopySet.product)).where(CopySet.id == copy_set_id)
    copy_set = session.scalar(stmt)
    if copy_set is None:
        raise NotFoundError("文案不存在")
    return copy_set


def derive_product_state(product: Product) -> ProductWorkflowState:
    """从商品关联数据推导流程状态，用于列表过滤。"""
    if product.poster_variants:
        return ProductWorkflowState.POSTER_READY
    if product.current_confirmed_copy_set_id:
        return ProductWorkflowState.COPY_READY
    return ProductWorkflowState.DRAFT


def _product_status_filter(status: ProductWorkflowState):
    has_poster = exists(
        select(literal(1)).select_from(PosterVariant).where(PosterVariant.product_id == Product.id)
    ).correlate(Product)
    if status == ProductWorkflowState.POSTER_READY:
        return has_poster
    if status == ProductWorkflowState.COPY_READY:
        return Product.current_confirmed_copy_set_id.is_not(None) & ~has_poster
    if status == ProductWorkflowState.DRAFT:
        return Product.current_confirmed_copy_set_id.is_(None) & ~has_poster
    return literal(False)


def create_product(
    session: Session,
    *,
    name: str,
    category: str | None,
    price: str | None,
    source_note: str | None,
    image_bytes: bytes | None,
    filename: str | None,
    content_type: str | None,
    reference_image_uploads: list[tuple[bytes, str, str]] | None = None,
    canvas_template_key: str | None = None,
    initial_workflow_entry: str | None = None,
    entry_text: str | None = None,
    owner_user_id: str | None = None,
    storage: LocalStorage | None = None,
) -> Product:
    """创建商品，保存原始图和参考图到本地存储。"""
    resolved_owner_user_id = resolve_owner_user_id(session, owner_user_id)
    explicit_initial_workflow_entry = initial_workflow_entry is not None
    workflow_entry = _normalize_initial_workflow_entry(initial_workflow_entry)
    normalized_entry_text = _normalize_entry_text(entry_text, initial_workflow_entry=workflow_entry)
    canvas_template = resolve_product_creation_canvas_template(
        session,
        canvas_template_key,
        initial_workflow_entry=workflow_entry,
        actor_user_id=resolved_owner_user_id,
    )
    if image_bytes is None and (canvas_template is not None or workflow_entry == "image"):
        raise BusinessValidationError("请先上传灵感图")
    storage = storage or LocalStorage()
    product = Product(
        owner_user_id=resolved_owner_user_id,
        name=_normalize_required_text(name, field_name="商品名", max_length=255),
        category=_normalize_optional_text(category, field_name="类目", max_length=120),
        price=_normalize_price(price),
        source_note=_normalize_optional_text(source_note, field_name="备注", max_length=4000),
    )
    session.add(product)
    session.flush()

    original_source_asset: SourceAsset | None = None
    if image_bytes is not None:
        resolved_filename = filename or "upload.bin"
        relative_path = storage.save_product_upload(product.id, resolved_filename, image_bytes)
        storage_metadata = storage.metadata_for(relative_path)
        original_source_asset = SourceAsset(
            product_id=product.id,
            kind=SourceAssetKind.ORIGINAL_IMAGE,
            original_filename=resolved_filename,
            mime_type=content_type or "application/octet-stream",
            **storage_metadata.as_model_kwargs(),
        )
        session.add(original_source_asset)
        session.flush()
    for reference_bytes, reference_filename, reference_content_type in reference_image_uploads or []:
        reference_path = storage.save_reference_upload(product.id, reference_filename, reference_bytes)
        storage_metadata = storage.metadata_for(reference_path)
        session.add(
            SourceAsset(
                product_id=product.id,
                kind=SourceAssetKind.REFERENCE_IMAGE,
                original_filename=reference_filename,
                mime_type=reference_content_type or "application/octet-stream",
                **storage_metadata.as_model_kwargs(),
            )
        )
    if canvas_template is not None:
        materialize_product_workflow_from_template(
            session,
            product_id=product.id,
            template=canvas_template,
            initial_entry_mode=workflow_entry,
            entry_text=normalized_entry_text,
        )
    elif explicit_initial_workflow_entry:
        _materialize_initial_workflow(
            session,
            product=product,
            initial_workflow_entry=workflow_entry,
            entry_text=normalized_entry_text,
            source_asset=original_source_asset,
        )
    session.commit()
    session.expire_all()
    return _get_product_or_raise(session, product.id)


def add_reference_images(
    session: Session,
    *,
    product_id: str,
    reference_image_uploads: list[tuple[bytes, str, str]],
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
    storage: LocalStorage | None = None,
) -> Product:
    product = _get_product_or_raise(
        session,
        product_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )
    ensure_actor_can_mutate_owner(
        owner_user_id=product.owner_user_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        missing_message="商品不存在",
    )
    ensure_resource_usable(product)
    storage = storage or LocalStorage()
    for reference_bytes, reference_filename, reference_content_type in reference_image_uploads:
        reference_path = storage.save_reference_upload(product.id, reference_filename, reference_bytes)
        storage_metadata = storage.metadata_for(reference_path)
        session.add(
            SourceAsset(
                product_id=product.id,
                kind=SourceAssetKind.REFERENCE_IMAGE,
                original_filename=reference_filename,
                mime_type=reference_content_type or "application/octet-stream",
                **storage_metadata.as_model_kwargs(),
            )
        )
    session.commit()
    session.expire_all()
    return _get_product_or_raise(session, product.id)


def delete_reference_image(
    session: Session,
    *,
    asset_id: str,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
    storage: LocalStorage | None = None,
) -> Product:
    asset = session.scalar(
        select(SourceAsset).options(selectinload(SourceAsset.product)).where(SourceAsset.id == asset_id)
    )
    if asset is None:
        raise NotFoundError("商品参考图不存在")
    if asset.kind != SourceAssetKind.REFERENCE_IMAGE:
        raise BusinessValidationError("只能删除商品参考图")
    ensure_actor_can_mutate_owner(
        owner_user_id=asset.product.owner_user_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        missing_message="商品参考图不存在",
    )
    ensure_resource_usable(asset)

    product_id = asset.product_id
    storage = storage or LocalStorage()
    storage_path = storage.object_key_for(asset)
    product = _get_product_or_raise(session, product_id)
    product.updated_at = now_utc()
    session.delete(asset)
    session.commit()
    storage.delete_image_with_variants(storage_path)
    session.expire_all()
    return _get_product_or_raise(session, product_id)


def list_products(
    session: Session,
    *,
    status: ProductWorkflowState | None,
    page: int,
    page_size: int,
    title: str | None = None,
    updated_from: datetime | None = None,
    updated_to: datetime | None = None,
    owner_user_id: str | None = None,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
) -> tuple[list[Product], int]:
    page = max(page, 1)
    page_size = min(max(page_size, 1), 100)
    start = (page - 1) * page_size
    filters = []
    if actor_user_id is not None and not actor_is_admin:
        filters.append(Product.owner_user_id == actor_user_id)
        filters.append(Product.deleted_at.is_(None))
    if actor_is_admin and owner_user_id:
        filters.append(Product.owner_user_id == owner_user_id)
    if status is not None:
        filters.append(_product_status_filter(status))
    normalized_title = _normalize_optional_search_text(title, max_length=120)
    if normalized_title is not None:
        filters.append(Product.name.ilike(f"%{normalized_title}%"))
    if updated_from is not None:
        filters.append(Product.updated_at >= updated_from)
    if updated_to is not None:
        filters.append(Product.updated_at < updated_to + timedelta(days=1))

    total = session.scalar(select(func.count()).select_from(Product).where(*filters)) or 0
    products = session.scalars(_product_query().where(*filters).offset(start).limit(page_size)).all()
    return list(products), total


def get_product_detail(
    session: Session,
    product_id: str,
    *,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
) -> Product:
    return _get_product_or_raise(
        session,
        product_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )


def delete_product(
    session: Session,
    *,
    product_id: str,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
    storage: LocalStorage | None = None,
) -> None:
    product = _get_product_or_raise(
        session,
        product_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )
    ensure_actor_can_mutate_owner(
        owner_user_id=product.owner_user_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        missing_message="商品不存在",
    )
    ensure_resource_usable(product)
    if product.deleted_at is not None:
        raise NotFoundError("商品不存在")
    active_workflow_run = session.scalar(
        select(WorkflowRun)
        .join(ProductWorkflow, WorkflowRun.workflow_id == ProductWorkflow.id)
        .where(
            ProductWorkflow.product_id == product_id,
            WorkflowRun.status.in_(WORKFLOW_RUN_GENERATION_TASK_CONTRACT.active_statuses),
        )
    )
    if active_workflow_run is not None:
        raise BusinessValidationError("商品工作流运行中，稍后删除")
    product.deleted_at = now_utc()
    product.deleted_by_user_id = actor_user_id
    product.updated_at = product.deleted_at
    session.commit()


def update_copy_set(
    session: Session,
    *,
    copy_set_id: str,
    structured_payload: dict[str, Any],
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
) -> CopySet:
    copy_set = _get_copy_set_or_raise(session, copy_set_id)
    ensure_actor_can_mutate_owner(
        owner_user_id=copy_set.product.owner_user_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        missing_message="文案不存在",
    )
    ensure_resource_usable(copy_set.product)
    try:
        payload = normalize_copy_payload(structured_payload)
    except ValueError as exc:
        raise BusinessValidationError(str(exc)) from exc
    copy_set.structured_payload = payload.model_dump(mode="json")
    copy_set.edited_at = now_utc()
    session.commit()
    session.refresh(copy_set)
    return copy_set


def confirm_copy_set(
    session: Session,
    *,
    copy_set_id: str,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
) -> CopySet:
    copy_set = _get_copy_set_or_raise(session, copy_set_id)
    product = _get_product_or_raise(
        session,
        copy_set.product_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )
    ensure_actor_can_mutate_owner(
        owner_user_id=product.owner_user_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        missing_message="文案不存在",
    )
    ensure_resource_usable(product)
    copy_set.status = CopyStatus.CONFIRMED
    copy_set.confirmed_at = now_utc()
    product.current_confirmed_copy_set_id = copy_set.id
    session.commit()
    session.refresh(copy_set)
    return copy_set


def get_product_history(
    session: Session,
    product_id: str,
    *,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
) -> dict[str, Any]:
    product = _get_product_or_raise(
        session,
        product_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )
    return {
        "copy_sets": sorted(product.copy_sets, key=lambda item: item.created_at, reverse=True),
        "poster_variants": sorted(product.poster_variants, key=lambda item: item.created_at, reverse=True),
    }
