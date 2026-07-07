from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from json import JSONDecodeError
from typing import Any, Literal, cast

from sqlalchemy import desc, exists, func, literal, or_, select
from sqlalchemy.orm import Session, selectinload

from inspiration_one_backend.application.auth import require_generation_resource_group_for_user
from inspiration_one_backend.application.copy_payloads import normalize_copy_payload
from inspiration_one_backend.application.inspiration_workflow import graph as inspiration_workflow_graph
from inspiration_one_backend.application.inspiration_workflow.context import (
    INSPIRATION_CONTEXT_MARKDOWN_TEXT_MAX_LENGTH,
    normalize_inspiration_context_config,
    normalize_inspiration_context_dynamic_fields,
)
from inspiration_one_backend.application.inspiration_workflow.tail_confirmation import workflow_run_is_user_active
from inspiration_one_backend.application.inspiration_workflow.templates import (
    materialize_inspiration_workflow_from_template,
    resolve_inspiration_creation_canvas_template,
)
from inspiration_one_backend.application.moderation import ensure_resource_usable
from inspiration_one_backend.application.ownership import ensure_actor_can_mutate_owner, resolve_owner_user_id
from inspiration_one_backend.application.resource_library import copy_resource_library_asset_to_inspiration_source_asset
from inspiration_one_backend.application.time import now_utc
from inspiration_one_backend.domain.enums import (
    CopyStatus,
    InspirationWorkflowState,
    SourceAssetKind,
    WorkflowNodeType,
)
from inspiration_one_backend.domain.errors import BusinessValidationError, NotFoundError
from inspiration_one_backend.infrastructure.db.models import (
    DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    CopySet,
    GenerationResourceGroup,
    Inspiration,
    InspirationWorkflow,
    PosterVariant,
    SourceAsset,
    WorkflowEdge,
    WorkflowNode,
    WorkflowNodeRun,
    WorkflowRun,
)
from inspiration_one_backend.infrastructure.provider_config import require_generation_resource_group
from inspiration_one_backend.infrastructure.storage import LocalStorage

InitialWorkflowEntry = Literal["image", "copy", "tail", "blank"]


@dataclass(frozen=True, slots=True)
class InspirationContextDocumentInput:
    content: bytes
    filename: str
    mime_type: str
    text: str


@dataclass(frozen=True, slots=True)
class InspirationContextCreationInput:
    name: str
    owner_id: str
    entry_type: InitialWorkflowEntry
    long_text: str | None
    image_source_asset_id: str | None
    document_source_asset_id: str | None
    document_filename: str | None
    document_mime_type: str | None
    document_text: str | None
    dynamic_fields: dict[str, str | int | float | bool | None]

    def to_config(self) -> dict[str, Any]:
        return normalize_inspiration_context_config(
            {
                "name": self.name,
                "owner_id": self.owner_id,
                "entry_type": self.entry_type,
                "long_text": self.long_text,
                "source_note": self.long_text,
                "image_source_asset_id": self.image_source_asset_id,
                "document_source_asset_id": self.document_source_asset_id,
                "document_filename": self.document_filename,
                "document_mime_type": self.document_mime_type,
                "document_text": self.document_text,
                "dynamic_fields": self.dynamic_fields,
            }
        )


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


def _entry_text_or_long_text(entry_text: str | None, long_text: str | None) -> str | None:
    if entry_text is not None and entry_text.strip():
        return entry_text
    return long_text


def _normalize_entry_text(value: str | None, *, initial_workflow_entry: InitialWorkflowEntry) -> str | None:
    if initial_workflow_entry not in {"copy", "tail"}:
        return _normalize_optional_text(
            value,
            field_name="入口内容",
            max_length=INSPIRATION_CONTEXT_MARKDOWN_TEXT_MAX_LENGTH,
        )
    normalized = _normalize_required_text(
        value or "",
        field_name="入口内容",
        max_length=INSPIRATION_CONTEXT_MARKDOWN_TEXT_MAX_LENGTH,
    )
    if initial_workflow_entry == "copy" and len(normalized) < 4:
        raise BusinessValidationError("文案入口内容太短")
    if initial_workflow_entry == "tail" and len(normalized) < 4:
        raise BusinessValidationError("尾巴入口内容太短")
    return normalized


def _normalize_dynamic_fields_json(value: str | None) -> dict[str, str | int | float | bool | None]:
    if value is None or not value.strip():
        return {}
    try:
        raw = json.loads(value)
    except JSONDecodeError as exc:
        raise BusinessValidationError("动态信息必须是有效 JSON") from exc
    return normalize_inspiration_context_dynamic_fields(raw)


def _materialize_initial_workflow(
    session: Session,
    *,
    inspiration: Inspiration,
    initial_workflow_entry: InitialWorkflowEntry,
    entry_text: str | None,
    source_asset: SourceAsset | None,
    inspiration_context_config: dict[str, Any],
    resource_group_id: str,
) -> None:
    workflow = InspirationWorkflow(
        inspiration_id=inspiration.id,
        title=inspiration_workflow_graph.DEFAULT_WORKFLOW_TITLE,
        active=True,
        initial_entry_mode=initial_workflow_entry,
    )
    session.add(workflow)
    session.flush()

    if initial_workflow_entry == "image":
        if source_asset is None:
            raise BusinessValidationError("图片入口需要上传灵感主图")
        nodes_by_key: dict[str, WorkflowNode] = {}
        for spec in inspiration_workflow_graph.default_node_specs(inspiration):
            key = str(spec.pop("key"))
            if key == "context":
                spec["config_json"] = inspiration_context_config
            node = WorkflowNode(workflow_id=workflow.id, **spec)
            session.add(node)
            nodes_by_key[key] = node
        session.flush()
        for edge in inspiration_workflow_graph.default_edges(nodes_by_key, workflow.id):
            session.add(edge)
        return

    inspiration_context_node = WorkflowNode(
        workflow_id=workflow.id,
        node_type=WorkflowNodeType.INSPIRATION_CONTEXT,
        title="灵感",
        position_x=40,
        position_y=120,
        config_json=inspiration_context_config,
    )
    session.add(inspiration_context_node)
    session.flush()

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
                "resource_group_id": resource_group_id,
            },
        )
        session.add(copy_node)
        session.flush()
        session.add(
            WorkflowEdge(
                workflow_id=workflow.id,
                source_node_id=inspiration_context_node.id,
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
            "resource_group_id": resource_group_id,
            "document_source": None,
        },
    )
    session.add(tail_node)
    session.flush()
    session.add(
        WorkflowEdge(
            workflow_id=workflow.id,
            source_node_id=inspiration_context_node.id,
            target_node_id=tail_node.id,
            source_handle="output",
            target_handle="input",
        )
    )


def _inspiration_query():
    return (
        select(Inspiration)
        .options(
            selectinload(Inspiration.source_assets),
            selectinload(Inspiration.resource_group),
            selectinload(Inspiration.creative_briefs),
            selectinload(Inspiration.copy_sets),
            selectinload(Inspiration.poster_variants),
            selectinload(Inspiration.confirmed_copy_set),
            selectinload(Inspiration.owner),
            selectinload(Inspiration.deleted_by),
            selectinload(Inspiration.workflows).load_only(
                InspirationWorkflow.id,
                InspirationWorkflow.inspiration_id,
                InspirationWorkflow.active,
                InspirationWorkflow.initial_entry_mode,
                InspirationWorkflow.created_at,
                InspirationWorkflow.updated_at,
            ),
            selectinload(Inspiration.workflows)
            .selectinload(InspirationWorkflow.nodes)
            .load_only(
                WorkflowNode.id,
                WorkflowNode.workflow_id,
                WorkflowNode.node_type,
                WorkflowNode.position_x,
                WorkflowNode.position_y,
                WorkflowNode.config_json,
                WorkflowNode.created_at,
            ),
            selectinload(Inspiration.workflows)
            .selectinload(InspirationWorkflow.edges)
            .load_only(
                WorkflowEdge.id,
                WorkflowEdge.workflow_id,
                WorkflowEdge.source_node_id,
                WorkflowEdge.target_node_id,
                WorkflowEdge.created_at,
            ),
            selectinload(Inspiration.workflows)
            .selectinload(InspirationWorkflow.runs)
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
        .order_by(desc(Inspiration.updated_at))
    )


def _get_inspiration_or_raise(
    session: Session,
    inspiration_id: str,
    *,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
) -> Inspiration:
    stmt = _inspiration_query().where(Inspiration.id == inspiration_id)
    if actor_user_id is not None and not actor_is_admin:
        stmt = stmt.where(Inspiration.owner_user_id == actor_user_id, Inspiration.deleted_at.is_(None))
    inspiration = session.scalar(stmt)
    if inspiration is None:
        raise NotFoundError("灵感产物不存在")
    return inspiration


def _get_copy_set_or_raise(session: Session, copy_set_id: str) -> CopySet:
    stmt = select(CopySet).options(selectinload(CopySet.inspiration)).where(CopySet.id == copy_set_id)
    copy_set = session.scalar(stmt)
    if copy_set is None:
        raise NotFoundError("文案不存在")
    return copy_set


def derive_inspiration_state(inspiration: Inspiration) -> InspirationWorkflowState:
    """从灵感产物关联数据推导流程状态，用于列表过滤。"""
    if inspiration.poster_variants:
        return InspirationWorkflowState.POSTER_READY
    if inspiration.current_confirmed_copy_set_id:
        return InspirationWorkflowState.COPY_READY
    return InspirationWorkflowState.DRAFT


def _inspiration_status_filter(status: InspirationWorkflowState):
    has_poster = exists(
        select(literal(1)).select_from(PosterVariant).where(PosterVariant.inspiration_id == Inspiration.id)
    ).correlate(Inspiration)
    if status == InspirationWorkflowState.POSTER_READY:
        return has_poster
    if status == InspirationWorkflowState.COPY_READY:
        return Inspiration.current_confirmed_copy_set_id.is_not(None) & ~has_poster
    if status == InspirationWorkflowState.DRAFT:
        return Inspiration.current_confirmed_copy_set_id.is_(None) & ~has_poster
    return literal(False)


def _resolve_inspiration_resource_group(
    session: Session,
    *,
    resource_group_id: str | None,
    actor_user_id: str | None,
    actor_is_admin: bool,
    require_user_grant: bool,
) -> GenerationResourceGroup:
    normalized_group_id = (resource_group_id or "").strip()
    if not normalized_group_id:
        if require_user_grant:
            raise BusinessValidationError("请选择供应商生成分组")
        normalized_group_id = DEFAULT_GENERATION_RESOURCE_GROUP_ID
    if require_user_grant:
        return require_generation_resource_group_for_user(
            session,
            user_id=actor_user_id,
            is_admin=actor_is_admin,
            resource_group_id=normalized_group_id,
        )
    try:
        return require_generation_resource_group(session, normalized_group_id, require_enabled=True)
    except ValueError as exc:
        raise BusinessValidationError(str(exc)) from exc


def create_inspiration(
    session: Session,
    *,
    name: str,
    category: str | None,
    price: str | None,
    source_note: str | None,
    image_bytes: bytes | None,
    filename: str | None,
    content_type: str | None,
    image_source_asset_id: str | None = None,
    reference_image_uploads: list[tuple[bytes, str, str]] | None = None,
    canvas_template_key: str | None = None,
    initial_workflow_entry: str | None = None,
    entry_text: str | None = None,
    long_text: str | None = None,
    dynamic_fields_json: str | None = None,
    context_document_upload: InspirationContextDocumentInput | None = None,
    owner_user_id: str | None = None,
    resource_group_id: str | None = None,
    actor_is_admin: bool = False,
    require_resource_group_grant: bool = False,
    storage: LocalStorage | None = None,
) -> Inspiration:
    """创建灵感产物，保存原始图和参考图到本地存储。"""
    resolved_owner_user_id = resolve_owner_user_id(session, owner_user_id)
    resource_group = _resolve_inspiration_resource_group(
        session,
        resource_group_id=resource_group_id,
        actor_user_id=resolved_owner_user_id,
        actor_is_admin=actor_is_admin,
        require_user_grant=require_resource_group_grant,
    )
    explicit_initial_workflow_entry = initial_workflow_entry is not None
    workflow_entry = _normalize_initial_workflow_entry(initial_workflow_entry)
    normalized_entry_text = _normalize_entry_text(
        _entry_text_or_long_text(entry_text, long_text),
        initial_workflow_entry=workflow_entry,
    )
    normalized_long_text = _normalize_optional_text(
        long_text,
        field_name="长文案内容",
        max_length=INSPIRATION_CONTEXT_MARKDOWN_TEXT_MAX_LENGTH,
    )
    normalized_source_note = _normalize_optional_text(
        source_note,
        field_name="备注",
        max_length=INSPIRATION_CONTEXT_MARKDOWN_TEXT_MAX_LENGTH,
    )
    normalized_context_long_text = normalized_long_text or normalized_entry_text or normalized_source_note
    normalized_dynamic_fields = _normalize_dynamic_fields_json(dynamic_fields_json)
    canvas_template = resolve_inspiration_creation_canvas_template(
        session,
        canvas_template_key,
        initial_workflow_entry=workflow_entry,
        actor_user_id=resolved_owner_user_id,
    )
    normalized_image_source_asset_id = (image_source_asset_id or "").strip() or None
    if image_bytes is None and normalized_image_source_asset_id is None and workflow_entry == "image":
        raise BusinessValidationError("请先上传灵感图")
    storage = storage or LocalStorage()
    inspiration = Inspiration(
        owner_user_id=resolved_owner_user_id,
        name=_normalize_required_text(name, field_name="灵感产物名", max_length=255),
        category=_normalize_optional_text(category, field_name="类目", max_length=120),
        price=_normalize_price(price),
        source_note=normalized_source_note or normalized_context_long_text,
        resource_group_id=resource_group.id,
    )
    session.add(inspiration)
    session.flush()

    original_source_asset: SourceAsset | None = None
    if image_bytes is not None:
        resolved_filename = filename or "upload.bin"
        relative_path = storage.save_inspiration_upload(inspiration.id, resolved_filename, image_bytes)
        storage_metadata = storage.metadata_for(relative_path)
        original_source_asset = SourceAsset(
            inspiration_id=inspiration.id,
            kind=SourceAssetKind.ORIGINAL_IMAGE,
            original_filename=resolved_filename,
            mime_type=content_type or "application/octet-stream",
            **storage_metadata.as_model_kwargs(),
        )
        session.add(original_source_asset)
        session.flush()
    elif normalized_image_source_asset_id is not None:
        original_source_asset = copy_resource_library_asset_to_inspiration_source_asset(
            session,
            asset_id=normalized_image_source_asset_id,
            inspiration_id=inspiration.id,
            actor_user_id=resolved_owner_user_id,
            kind=SourceAssetKind.ORIGINAL_IMAGE,
            storage=storage,
        )
    context_document_asset: SourceAsset | None = None
    if context_document_upload is not None:
        document_path = storage.save_document_upload(
            inspiration.id,
            context_document_upload.filename,
            context_document_upload.content,
        )
        storage_metadata = storage.metadata_for(document_path)
        context_document_asset = SourceAsset(
            inspiration_id=inspiration.id,
            kind=SourceAssetKind.CONTEXT_DOCUMENT,
            original_filename=context_document_upload.filename,
            mime_type=context_document_upload.mime_type or "application/octet-stream",
            **storage_metadata.as_model_kwargs(),
        )
        session.add(context_document_asset)
        session.flush()
    for reference_bytes, reference_filename, reference_content_type in reference_image_uploads or []:
        reference_path = storage.save_reference_upload(inspiration.id, reference_filename, reference_bytes)
        storage_metadata = storage.metadata_for(reference_path)
        session.add(
            SourceAsset(
                inspiration_id=inspiration.id,
                kind=SourceAssetKind.REFERENCE_IMAGE,
                original_filename=reference_filename,
                mime_type=reference_content_type or "application/octet-stream",
                **storage_metadata.as_model_kwargs(),
            )
        )
    inspiration_context_config = InspirationContextCreationInput(
        name=inspiration.name,
        owner_id=inspiration.id,
        entry_type=workflow_entry,
        long_text=normalized_context_long_text,
        image_source_asset_id=original_source_asset.id if original_source_asset is not None else None,
        document_source_asset_id=context_document_asset.id if context_document_asset is not None else None,
        document_filename=context_document_upload.filename if context_document_upload is not None else None,
        document_mime_type=context_document_upload.mime_type if context_document_upload is not None else None,
        document_text=context_document_upload.text if context_document_upload is not None else None,
        dynamic_fields=normalized_dynamic_fields,
    ).to_config()
    if canvas_template is not None:
        materialize_inspiration_workflow_from_template(
            session,
            inspiration_id=inspiration.id,
            template=canvas_template,
            initial_entry_mode=workflow_entry,
            entry_text=normalized_entry_text,
            inspiration_context_config=inspiration_context_config,
            resource_group_id=resource_group.id,
        )
    elif explicit_initial_workflow_entry:
        _materialize_initial_workflow(
            session,
            inspiration=inspiration,
            initial_workflow_entry=workflow_entry,
            entry_text=normalized_entry_text,
            source_asset=original_source_asset,
            inspiration_context_config=inspiration_context_config,
            resource_group_id=resource_group.id,
        )
    session.commit()
    session.expire_all()
    return _get_inspiration_or_raise(session, inspiration.id)


def add_reference_images(
    session: Session,
    *,
    inspiration_id: str,
    reference_image_uploads: list[tuple[bytes, str, str]],
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
    storage: LocalStorage | None = None,
) -> Inspiration:
    inspiration = _get_inspiration_or_raise(
        session,
        inspiration_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )
    ensure_actor_can_mutate_owner(
        owner_user_id=inspiration.owner_user_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        missing_message="灵感产物不存在",
    )
    ensure_resource_usable(inspiration)
    storage = storage or LocalStorage()
    for reference_bytes, reference_filename, reference_content_type in reference_image_uploads:
        reference_path = storage.save_reference_upload(inspiration.id, reference_filename, reference_bytes)
        storage_metadata = storage.metadata_for(reference_path)
        session.add(
            SourceAsset(
                inspiration_id=inspiration.id,
                kind=SourceAssetKind.REFERENCE_IMAGE,
                original_filename=reference_filename,
                mime_type=reference_content_type or "application/octet-stream",
                **storage_metadata.as_model_kwargs(),
            )
        )
    session.commit()
    session.expire_all()
    return _get_inspiration_or_raise(session, inspiration.id)


def delete_reference_image(
    session: Session,
    *,
    asset_id: str,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
) -> Inspiration:
    asset = session.scalar(
        select(SourceAsset).options(selectinload(SourceAsset.inspiration)).where(SourceAsset.id == asset_id)
    )
    if asset is None:
        raise NotFoundError("灵感产物参考图不存在")
    if asset.kind != SourceAssetKind.REFERENCE_IMAGE:
        raise BusinessValidationError("只能删除灵感产物参考图")
    ensure_actor_can_mutate_owner(
        owner_user_id=asset.inspiration.owner_user_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        missing_message="灵感产物参考图不存在",
    )
    ensure_resource_usable(asset)

    inspiration_id = asset.inspiration_id
    inspiration = _get_inspiration_or_raise(session, inspiration_id)
    inspiration.updated_at = now_utc()
    session.delete(asset)
    session.commit()
    session.expire_all()
    return _get_inspiration_or_raise(session, inspiration_id)


def list_inspirations(
    session: Session,
    *,
    status: InspirationWorkflowState | None,
    page: int,
    page_size: int,
    title: str | None = None,
    updated_from: datetime | None = None,
    updated_to: datetime | None = None,
    owner_user_id: str | None = None,
    resource_group_id: str | None = None,
    only_deleted: bool = False,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
    require_resource_group_grant: bool = False,
) -> tuple[list[Inspiration], int]:
    page = max(page, 1)
    page_size = min(max(page_size, 1), 100)
    start = (page - 1) * page_size
    filters = []
    if actor_user_id is not None and not actor_is_admin:
        filters.append(Inspiration.owner_user_id == actor_user_id)
    if only_deleted and actor_is_admin:
        filters.append(Inspiration.deleted_at.is_not(None))
    else:
        filters.append(Inspiration.deleted_at.is_(None))
    if actor_is_admin and owner_user_id:
        filters.append(Inspiration.owner_user_id == owner_user_id)
    normalized_group_id = (resource_group_id or "").strip() or None
    if normalized_group_id is not None:
        resource_group = _resolve_inspiration_resource_group(
            session,
            resource_group_id=normalized_group_id,
            actor_user_id=actor_user_id,
            actor_is_admin=actor_is_admin,
            require_user_grant=require_resource_group_grant,
        )
        if resource_group.id == DEFAULT_GENERATION_RESOURCE_GROUP_ID:
            filters.append(
                or_(Inspiration.resource_group_id == resource_group.id, Inspiration.resource_group_id.is_(None))
            )
        else:
            filters.append(Inspiration.resource_group_id == resource_group.id)
    if status is not None:
        filters.append(_inspiration_status_filter(status))
    normalized_title = _normalize_optional_search_text(title, max_length=120)
    if normalized_title is not None:
        filters.append(Inspiration.name.ilike(f"%{normalized_title}%"))
    if updated_from is not None:
        filters.append(Inspiration.updated_at >= updated_from)
    if updated_to is not None:
        filters.append(Inspiration.updated_at < updated_to + timedelta(days=1))

    total = session.scalar(select(func.count()).select_from(Inspiration).where(*filters)) or 0
    inspirations = session.scalars(_inspiration_query().where(*filters).offset(start).limit(page_size)).all()
    return list(inspirations), total


def get_inspiration_detail(
    session: Session,
    inspiration_id: str,
    *,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
) -> Inspiration:
    return _get_inspiration_or_raise(
        session,
        inspiration_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )


def delete_inspiration(
    session: Session,
    *,
    inspiration_id: str,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
    storage: LocalStorage | None = None,
) -> None:
    inspiration = _get_inspiration_or_raise(
        session,
        inspiration_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )
    ensure_actor_can_mutate_owner(
        owner_user_id=inspiration.owner_user_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        missing_message="灵感产物不存在",
    )
    ensure_resource_usable(inspiration)
    if inspiration.deleted_at is not None:
        raise NotFoundError("灵感产物不存在")
    active_workflow_runs = list(
        session.scalars(
            select(WorkflowRun)
            .join(InspirationWorkflow, WorkflowRun.workflow_id == InspirationWorkflow.id)
            .where(InspirationWorkflow.inspiration_id == inspiration_id)
        )
    )
    if any(workflow_run_is_user_active(run.status) for run in active_workflow_runs):
        raise BusinessValidationError("灵感产物工作流运行中，稍后删除")
    inspiration.deleted_at = now_utc()
    inspiration.deleted_by_user_id = actor_user_id
    inspiration.updated_at = inspiration.deleted_at
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
        owner_user_id=copy_set.inspiration.owner_user_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        missing_message="文案不存在",
    )
    ensure_resource_usable(copy_set.inspiration)
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
    inspiration = _get_inspiration_or_raise(
        session,
        copy_set.inspiration_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )
    ensure_actor_can_mutate_owner(
        owner_user_id=inspiration.owner_user_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        missing_message="文案不存在",
    )
    ensure_resource_usable(inspiration)
    copy_set.status = CopyStatus.CONFIRMED
    copy_set.confirmed_at = now_utc()
    inspiration.current_confirmed_copy_set_id = copy_set.id
    session.commit()
    session.refresh(copy_set)
    return copy_set


def get_inspiration_history(
    session: Session,
    inspiration_id: str,
    *,
    resource_group_id: str | None = None,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
) -> dict[str, Any]:
    inspiration = _get_inspiration_or_raise(
        session,
        inspiration_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )
    normalized_group_id = (resource_group_id or "").strip() or None
    copy_sets = _filter_by_resource_group(inspiration.copy_sets, normalized_group_id)
    poster_variants = _filter_by_resource_group(inspiration.poster_variants, normalized_group_id)
    return {
        "copy_sets": sorted(copy_sets, key=lambda item: item.created_at, reverse=True),
        "poster_variants": sorted(poster_variants, key=lambda item: item.created_at, reverse=True),
    }


def _filter_by_resource_group(
    items: list[CopySet] | list[PosterVariant],
    resource_group_id: str | None,
) -> list[CopySet] | list[PosterVariant]:
    if resource_group_id is None:
        return items
    if resource_group_id == DEFAULT_GENERATION_RESOURCE_GROUP_ID:
        return [item for item in items if item.resource_group_id in {None, resource_group_id}]
    return [item for item in items if item.resource_group_id == resource_group_id]
