from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from inspiration_one_backend.application.canvas_templates import CanvasTemplateNodeSpec
from inspiration_one_backend.application.copy_payloads import normalize_copy_node_config
from inspiration_one_backend.application.deck_generation_config import normalize_deck_slide_size
from inspiration_one_backend.application.image_generation_core import normalize_image_generation_tool_options
from inspiration_one_backend.application.inspiration_workflow import graph as inspiration_workflow_graph
from inspiration_one_backend.application.inspiration_workflow.artifacts import (
    copy_node_output,
    fill_reference_node,
    image_asset_output,
    source_asset_for_poster_variant,
)
from inspiration_one_backend.application.inspiration_workflow.context import (
    image_size_from_config,
    inspiration_context_output,
    normalize_inspiration_context_config,
    optional_config_text,
)
from inspiration_one_backend.application.inspiration_workflow.image_enhance import normalize_image_enhance_config
from inspiration_one_backend.application.inspiration_workflow.tail_confirmation import (
    remove_pending_tail_confirmation,
    run_has_pending_tail_confirmation,
    run_has_pending_tail_confirmations,
    workflow_run_is_user_active,
)
from inspiration_one_backend.application.inspiration_workflow.tail_splitter import (
    TailSplitPlanImageGenerationConfig,
    TailSplitPlanItemSelection,
    normalize_tail_splitter_config,
)
from inspiration_one_backend.application.inspiration_workflow.tail_splitter import (
    apply_tail_split_plan as apply_tail_split_plan_to_graph,
)
from inspiration_one_backend.application.inspiration_workflow.templates import materialize_canvas_template_graph
from inspiration_one_backend.application.inspiration_workflow.user_templates import (
    extract_reusable_node_config,
    get_canvas_template,
)
from inspiration_one_backend.application.task_notifications import publish_workflow_run_notification_safely
from inspiration_one_backend.application.time import now_utc
from inspiration_one_backend.application.use_cases import update_copy_set
from inspiration_one_backend.domain.durable_generation_tasks import WORKFLOW_RUN_GENERATION_TASK_CONTRACT
from inspiration_one_backend.domain.enums import (
    SourceAssetKind,
    WorkflowNodeStatus,
    WorkflowNodeType,
    WorkflowRunStatus,
)
from inspiration_one_backend.domain.errors import BusinessError, BusinessValidationError, NotFoundError
from inspiration_one_backend.infrastructure.db.models import (
    DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    CopySet,
    InspirationWorkflow,
    PosterVariant,
    SourceAsset,
    WorkflowEdge,
    WorkflowNode,
    WorkflowNodeRun,
    WorkflowRun,
)
from inspiration_one_backend.infrastructure.storage import LocalStorage

NODE_GROUP_TEMPLATE_COLLISION_NODE_WIDTH = 248
NODE_GROUP_TEMPLATE_COLLISION_NODE_HEIGHT = 248
NODE_GROUP_TEMPLATE_COLLISION_GAP = 32
NODE_GROUP_TEMPLATE_CONTEXT_ANCHOR_GAP = 220
GENERATION_RESOURCE_GROUP_NODE_TYPES = frozenset(
    {
        WorkflowNodeType.COPY_GENERATION,
        WorkflowNodeType.IMAGE_GENERATION,
        WorkflowNodeType.IMAGE_ENHANCE,
        WorkflowNodeType.TAIL_SPLITTER,
    }
)


def _default_generation_resource_group_config(
    node_type: WorkflowNodeType,
    config_json: dict[str, Any] | None,
    *,
    resource_group_id: str | None,
) -> dict[str, Any]:
    config = dict(config_json or {})
    if node_type in GENERATION_RESOURCE_GROUP_NODE_TYPES:
        config.setdefault("resource_group_id", resource_group_id or DEFAULT_GENERATION_RESOURCE_GROUP_ID)
    return config


@dataclass(frozen=True, slots=True)
class AppliedWorkflowTemplateGroup:
    workflow: InspirationWorkflow
    nodes_by_template_key: dict[str, WorkflowNode]

    @property
    def workflow_node_ids_by_template_key(self) -> dict[str, str]:
        return {template_key: node.id for template_key, node in self.nodes_by_template_key.items()}


@dataclass(frozen=True, slots=True)
class _NodeBounds:
    left: int
    top: int
    right: int
    bottom: int


def _node_bounds(position_x: int, position_y: int) -> _NodeBounds:
    return _NodeBounds(
        left=position_x,
        top=position_y,
        right=position_x + NODE_GROUP_TEMPLATE_COLLISION_NODE_WIDTH,
        bottom=position_y + NODE_GROUP_TEMPLATE_COLLISION_NODE_HEIGHT,
    )


def _node_bounds_overlap(first: _NodeBounds, second: _NodeBounds) -> bool:
    return (
        first.left < second.right
        and first.right > second.left
        and first.top < second.bottom
        and first.bottom > second.top
    )


def _node_group_template_offsets(
    *,
    template_nodes: tuple[CanvasTemplateNodeSpec, ...],
    existing_nodes: list[WorkflowNode],
    position_x: int,
    position_y: int,
    anchor_node: WorkflowNode | None = None,
) -> tuple[int, int]:
    min_x = min(node.position_x for node in template_nodes)
    min_y = min(node.position_y for node in template_nodes)
    if anchor_node is not None:
        # 节点组复用现有灵感产物资料节点，新增节点从它右侧展开，避免回贴到画布左侧。
        position_x = max(
            position_x,
            anchor_node.position_x + NODE_GROUP_TEMPLATE_COLLISION_NODE_WIDTH + NODE_GROUP_TEMPLATE_CONTEXT_ANCHOR_GAP,
        )
        position_y = max(position_y, anchor_node.position_y)
    position_x_offset = position_x - min_x
    position_y_offset = position_y - min_y
    existing_bounds = [_node_bounds(node.position_x, node.position_y) for node in existing_nodes]

    for _ in range(len(existing_bounds) + 1):
        # 只向下平移到冲突节点底部，保留用户拖放的横向位置。
        template_bounds = [
            _node_bounds(node.position_x + position_x_offset, node.position_y + position_y_offset)
            for node in template_nodes
        ]
        overlapping_existing_bounds = [
            existing
            for existing in existing_bounds
            if any(_node_bounds_overlap(template_bound, existing) for template_bound in template_bounds)
        ]
        if not overlapping_existing_bounds:
            return position_x_offset, position_y_offset
        position_y_offset = max(bound.bottom for bound in overlapping_existing_bounds) + (
            NODE_GROUP_TEMPLATE_COLLISION_GAP - min_y
        )

    return position_x_offset, position_y_offset


def _insertable_template_nodes(
    template_nodes: tuple[CanvasTemplateNodeSpec, ...],
) -> tuple[CanvasTemplateNodeSpec, ...]:
    return tuple(
        node
        for node in template_nodes
        if node.node_type not in {WorkflowNodeType.INSPIRATION_CONTEXT, WorkflowNodeType.DECK_GENERATION}
    )


def _single_inspiration_context_node(workflow: InspirationWorkflow) -> WorkflowNode:
    inspiration_context_nodes = [
        node for node in workflow.nodes if node.node_type == WorkflowNodeType.INSPIRATION_CONTEXT
    ]
    if len(inspiration_context_nodes) != 1:
        raise BusinessValidationError("模板需要当前画布中的灵感产物资料节点")
    return inspiration_context_nodes[0]


def _active_workflow_run(workflow: InspirationWorkflow) -> WorkflowRun | None:
    return next(
        (
            run
            for run in sorted(workflow.runs, key=lambda item: item.started_at, reverse=True)
            if WORKFLOW_RUN_GENERATION_TASK_CONTRACT.is_active(run.status)
        ),
        None,
    )


def normalize_workflow_node_config(node_type: WorkflowNodeType, config_json: dict[str, Any] | None) -> dict[str, Any]:
    config = dict(config_json or {})
    if node_type == WorkflowNodeType.INSPIRATION_CONTEXT:
        return normalize_inspiration_context_config(config)
    if node_type == WorkflowNodeType.DECK_GENERATION:
        config.setdefault("style_key", None)
        config["deck_slide_size"] = normalize_deck_slide_size(config.get("deck_slide_size"))
        config.setdefault("slide_count_mode", "auto")
        config.setdefault("planning_strategy", "hybrid")
        config.setdefault("include_transitive_inputs", False)
        config.setdefault("source_order", [])
        config.setdefault("excluded_source_item_ids", [])
        config.setdefault("slide_bindings", [])
        return config
    if node_type == WorkflowNodeType.COPY_GENERATION:
        try:
            normalized_copy_config = normalize_copy_node_config(config).model_dump(mode="json")
        except ValueError as exc:
            raise BusinessValidationError(str(exc)) from exc
        return {**config, **normalized_copy_config}
    if node_type == WorkflowNodeType.TAIL_SPLITTER:
        try:
            return normalize_tail_splitter_config(config)
        except ValueError as exc:
            raise BusinessValidationError(str(exc)) from exc
    if node_type == WorkflowNodeType.IMAGE_GENERATION:
        try:
            normalized_size = image_size_from_config(config)
        except ValueError as exc:
            raise BusinessValidationError(str(exc)) from exc
        if normalized_size is not None:
            config["size"] = normalized_size
        if "tool_options" in config:
            raw_tool_options = config.get("tool_options")
            config["tool_options"] = normalize_image_generation_tool_options(
                raw_tool_options if isinstance(raw_tool_options, dict) else None
            )
    if node_type == WorkflowNodeType.IMAGE_ENHANCE:
        config = normalize_image_enhance_config(config)
    return config


def _inspiration_context_runtime_config(
    workflow: InspirationWorkflow,
    config_json: dict[str, Any] | None = None,
) -> dict[str, Any]:
    inspiration = workflow.inspiration
    config = dict(config_json or {})
    config["name"] = config.get("name") or inspiration.name
    config["owner_id"] = inspiration.id
    config["entry_type"] = workflow.initial_entry_mode
    if "long_text" not in config and inspiration.source_note:
        config["long_text"] = inspiration.source_note
        config["source_note"] = inspiration.source_note
    return normalize_inspiration_context_config(config)


def _preserve_inspiration_context_runtime_config(
    node: WorkflowNode,
    config_json: dict[str, Any],
) -> dict[str, Any]:
    config = dict(config_json)
    config["owner_id"] = node.workflow.inspiration_id
    config["entry_type"] = node.workflow.initial_entry_mode
    return normalize_inspiration_context_config(config)


def apply_workflow_node_patch(
    node: WorkflowNode,
    *,
    title: str | None = None,
    config_json: dict[str, Any] | None = None,
) -> bool:
    changed = False
    if title is not None:
        next_title = title.strip() or inspiration_workflow_graph.default_title_for_type(node.node_type)
        if next_title != node.title:
            node.title = next_title
            changed = True
    if config_json is not None:
        normalized_config = normalize_workflow_node_config(node.node_type, config_json)
        if node.node_type == WorkflowNodeType.INSPIRATION_CONTEXT:
            normalized_config = _preserve_inspiration_context_runtime_config(node, normalized_config)
        if (
            node.node_type in GENERATION_RESOURCE_GROUP_NODE_TYPES
            and "resource_group_id" not in normalized_config
            and isinstance(node.config_json, dict)
            and node.config_json.get("resource_group_id")
        ):
            normalized_config["resource_group_id"] = node.config_json["resource_group_id"]
        config_changed = normalized_config != (node.config_json or {})
        if config_changed:
            node.config_json = normalized_config
            changed = True
            if node.status == WorkflowNodeStatus.FAILED:
                node.status = WorkflowNodeStatus.IDLE
                node.failure_reason = None
    return changed


def get_or_create_inspiration_workflow(session: Session, inspiration_id: str) -> InspirationWorkflow:
    existing = inspiration_workflow_graph.get_active_workflow(session, inspiration_id)
    if existing is not None:
        if _normalize_inspiration_context_singleton(session, existing):
            session.commit()
            session.expire_all()
            return inspiration_workflow_graph.get_active_workflow(
                session, inspiration_id
            ) or inspiration_workflow_graph.get_workflow_or_raise(session, existing.id)
        return existing

    inspiration = inspiration_workflow_graph.get_inspiration_or_raise(session, inspiration_id)
    workflow = InspirationWorkflow(
        inspiration_id=inspiration.id,
        title=inspiration_workflow_graph.DEFAULT_WORKFLOW_TITLE,
        active=True,
        initial_entry_mode="image",
    )
    session.add(workflow)
    session.flush()

    nodes_by_key: dict[str, WorkflowNode] = {}
    for spec in inspiration_workflow_graph.default_node_specs(inspiration):
        key = str(spec.pop("key"))
        if key == "context":
            spec["config_json"] = _inspiration_context_runtime_config(workflow, spec.get("config_json"))
        node = WorkflowNode(workflow_id=workflow.id, **spec)
        session.add(node)
        nodes_by_key[key] = node
    session.flush()
    for edge in inspiration_workflow_graph.default_edges(nodes_by_key, workflow.id):
        session.add(edge)
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        existing = inspiration_workflow_graph.get_active_workflow(session, inspiration_id)
        if existing is not None:
            return existing
        raise
    session.expire_all()
    return inspiration_workflow_graph.get_active_workflow(
        session, inspiration_id
    ) or inspiration_workflow_graph.get_workflow_or_raise(session, workflow.id)


def create_workflow_node(
    session: Session,
    *,
    inspiration_id: str,
    node_type: WorkflowNodeType,
    title: str,
    position_x: int,
    position_y: int,
    config_json: dict[str, Any] | None,
) -> InspirationWorkflow:
    workflow = get_or_create_inspiration_workflow(session, inspiration_id)
    if node_type == WorkflowNodeType.INSPIRATION_CONTEXT and any(
        node.node_type == WorkflowNodeType.INSPIRATION_CONTEXT for node in workflow.nodes
    ):
        raise BusinessValidationError("灵感产物资料节点已存在")
    node = WorkflowNode(
        workflow_id=workflow.id,
        node_type=node_type,
        title=title.strip() or inspiration_workflow_graph.default_title_for_type(node_type),
        position_x=position_x,
        position_y=position_y,
        config_json=(
            _inspiration_context_runtime_config(workflow, config_json)
            if node_type == WorkflowNodeType.INSPIRATION_CONTEXT
            else normalize_workflow_node_config(
                node_type,
                _default_generation_resource_group_config(
                    node_type,
                    config_json,
                    resource_group_id=workflow.inspiration.resource_group_id,
                ),
            )
        ),
    )
    session.add(node)
    workflow.updated_at = now_utc()
    session.commit()
    session.expire_all()
    return inspiration_workflow_graph.get_workflow_or_raise(session, workflow.id)


def apply_node_group_template_to_workflow(
    session: Session,
    *,
    inspiration_id: str,
    template_key: str,
    position_x: int,
    position_y: int,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
) -> InspirationWorkflow:
    applied = materialize_node_group_template_to_workflow(
        session,
        inspiration_id=inspiration_id,
        template_key=template_key,
        position_x=position_x,
        position_y=position_y,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )
    session.commit()
    session.expire_all()
    return inspiration_workflow_graph.get_workflow_or_raise(session, applied.workflow.id)


def materialize_node_group_template_to_workflow(
    session: Session,
    *,
    inspiration_id: str,
    template_key: str,
    position_x: int,
    position_y: int,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
) -> AppliedWorkflowTemplateGroup:
    template = get_canvas_template(
        session,
        template_key.strip(),
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )
    workflow = inspiration_workflow_graph.get_active_workflow(session, inspiration_id)
    if workflow is None:
        inspiration_workflow_graph.get_inspiration_or_raise(session, inspiration_id)
        raise BusinessValidationError("需要先创建或打开画布后才能添加模板")
    # 模板里的灵感产物资料节点是占位符，落到已有画布时要映射到当前灵感产物资料节点。
    needs_inspiration_context = any(
        node.node_type == WorkflowNodeType.INSPIRATION_CONTEXT for node in template.nodes
    ) or bool(template.default_external_connections)
    inspiration_context_node = _single_inspiration_context_node(workflow) if needs_inspiration_context else None
    insertable_template_nodes = _insertable_template_nodes(template.nodes)
    if not insertable_template_nodes:
        raise BusinessValidationError("模板没有可添加到当前画布的节点")
    existing_nodes_by_template_key = {
        node.key: inspiration_context_node
        for node in template.nodes
        if node.node_type == WorkflowNodeType.INSPIRATION_CONTEXT and inspiration_context_node is not None
    }
    external_source_nodes = (
        {"existing_inspiration_context": inspiration_context_node} if inspiration_context_node is not None else {}
    )
    position_x_offset, position_y_offset = _node_group_template_offsets(
        template_nodes=insertable_template_nodes,
        existing_nodes=list(workflow.nodes),
        position_x=position_x,
        position_y=position_y,
        anchor_node=inspiration_context_node,
    )
    nodes_by_template_key = materialize_canvas_template_graph(
        session,
        workflow=workflow,
        template=template,
        position_x_offset=position_x_offset,
        position_y_offset=position_y_offset,
        existing_nodes_by_template_key=existing_nodes_by_template_key,
        external_source_nodes_by_template_source=external_source_nodes,
        resource_group_id=workflow.inspiration.resource_group_id,
    )
    workflow.updated_at = now_utc()
    session.flush()
    session.expire(workflow, ["nodes", "edges"])
    refreshed = inspiration_workflow_graph.get_workflow_or_raise(session, workflow.id)
    try:
        inspiration_workflow_graph.topological_nodes(refreshed)
    except BusinessError:
        session.rollback()
        raise
    except ValueError as exc:
        session.rollback()
        raise BusinessValidationError(str(exc)) from exc
    return AppliedWorkflowTemplateGroup(
        workflow=refreshed,
        nodes_by_template_key=nodes_by_template_key,
    )


def duplicate_workflow_node_group(
    session: Session,
    *,
    inspiration_id: str,
    node_ids: list[str],
    position_x: int | None = None,
    position_y: int | None = None,
    offset_x: int = 48,
    offset_y: int = 48,
) -> InspirationWorkflow:
    if not node_ids:
        raise BusinessValidationError("请选择要复制的节点")
    if len(set(node_ids)) != len(node_ids):
        raise BusinessValidationError("复制节点不能重复")

    workflow = inspiration_workflow_graph.get_active_workflow(session, inspiration_id)
    if workflow is None:
        inspiration_workflow_graph.get_inspiration_or_raise(session, inspiration_id)
        raise BusinessValidationError("需要先创建或打开画布后才能复制节点")

    workflow_nodes_by_id = {node.id: node for node in workflow.nodes}
    unknown_node_ids = [node_id for node_id in node_ids if node_id not in workflow_nodes_by_id]
    if unknown_node_ids:
        raise BusinessValidationError("复制节点包含不属于当前画布的节点")

    selected_nodes = [
        workflow_nodes_by_id[node_id]
        for node_id in node_ids
        if workflow_nodes_by_id[node_id].node_type != WorkflowNodeType.INSPIRATION_CONTEXT
    ]
    if not selected_nodes:
        raise BusinessValidationError("请选择要复制的节点")

    min_x = min(node.position_x for node in selected_nodes)
    min_y = min(node.position_y for node in selected_nodes)
    position_x_offset = (position_x - min_x) if position_x is not None else offset_x
    position_y_offset = (position_y - min_y) if position_y is not None else offset_y

    nodes_by_original_id: dict[str, WorkflowNode] = {}
    for node in selected_nodes:
        duplicated_node = WorkflowNode(
            workflow_id=workflow.id,
            node_type=node.node_type,
            title=node.title,
            position_x=node.position_x + position_x_offset,
            position_y=node.position_y + position_y_offset,
            config_json=extract_reusable_node_config(node),
        )
        session.add(duplicated_node)
        nodes_by_original_id[node.id] = duplicated_node

    session.flush()
    for edge in workflow.edges:
        source_node = nodes_by_original_id.get(edge.source_node_id)
        target_node = nodes_by_original_id.get(edge.target_node_id)
        if source_node is None or target_node is None:
            continue
        session.add(
            WorkflowEdge(
                workflow_id=workflow.id,
                source_node_id=source_node.id,
                target_node_id=target_node.id,
                source_handle=edge.source_handle,
                target_handle=edge.target_handle,
            )
        )

    workflow.updated_at = now_utc()
    session.flush()
    session.expire(workflow, ["nodes", "edges"])
    refreshed = inspiration_workflow_graph.get_workflow_or_raise(session, workflow.id)
    try:
        inspiration_workflow_graph.topological_nodes(refreshed)
    except BusinessError:
        session.rollback()
        raise
    except ValueError as exc:
        session.rollback()
        raise BusinessValidationError(str(exc)) from exc
    session.commit()
    session.expire_all()
    return inspiration_workflow_graph.get_workflow_or_raise(session, workflow.id)


def update_workflow_node(
    session: Session,
    *,
    node_id: str,
    title: str | None,
    position_x: int | None,
    position_y: int | None,
    config_json: dict[str, Any] | None,
) -> InspirationWorkflow:
    node = inspiration_workflow_graph.get_node_or_raise(session, node_id)
    touched = title is not None or position_x is not None or position_y is not None or config_json is not None
    apply_workflow_node_patch(node, title=title, config_json=config_json)
    if position_x is not None:
        node.position_x = position_x
    if position_y is not None:
        node.position_y = position_y
    if touched:
        node.workflow.updated_at = now_utc()
    session.commit()
    session.expire_all()
    return inspiration_workflow_graph.get_workflow_or_raise(session, node.workflow_id)


def update_workflow_copy_set(
    session: Session,
    *,
    node_id: str,
    structured_payload: dict[str, Any],
) -> InspirationWorkflow:
    node = inspiration_workflow_graph.get_node_or_raise(session, node_id)
    if node.node_type != WorkflowNodeType.COPY_GENERATION:
        raise BusinessValidationError("只有文案节点可以编辑文案")
    workflow_id = node.workflow_id
    workflow = inspiration_workflow_graph.get_workflow_or_raise(session, workflow_id)
    copy_set_id = (node.output_json or {}).get("copy_set_id")
    if not isinstance(copy_set_id, str) or not copy_set_id:
        raise BusinessValidationError("文案节点还没有生成文案")

    copy_set = session.get(CopySet, copy_set_id)
    if copy_set is None or copy_set.inspiration_id != workflow.inspiration_id:
        raise NotFoundError("文案版本不存在")

    copy_set = update_copy_set(
        session,
        copy_set_id=copy_set.id,
        structured_payload=structured_payload,
    )
    node = inspiration_workflow_graph.get_node_or_raise(session, node_id)
    output = dict(node.output_json or {})
    output.update(copy_node_output(copy_set, creative_brief_id=copy_set.creative_brief_id, manual_edit=True))
    node.output_json = output
    node.workflow.updated_at = now_utc()
    node.workflow.inspiration.updated_at = now_utc()
    session.commit()
    session.expire_all()
    return inspiration_workflow_graph.get_workflow_or_raise(session, workflow_id)


def upload_workflow_node_image(
    session: Session,
    *,
    node_id: str,
    image_bytes: bytes,
    filename: str,
    content_type: str,
    role: str | None = None,
    label: str | None = None,
    storage: LocalStorage | None = None,
) -> InspirationWorkflow:
    """把上传图存为工作流节点资源，并绑定到节点输出。"""
    node = inspiration_workflow_graph.get_node_or_raise(session, node_id)
    if node.node_type not in {WorkflowNodeType.REFERENCE_IMAGE, WorkflowNodeType.INSPIRATION_CONTEXT}:
        raise BusinessValidationError("只有参考图或上下文节点可以上传图片")
    workflow = inspiration_workflow_graph.get_workflow_or_raise(session, node.workflow_id)
    storage = storage or LocalStorage()
    if node.node_type == WorkflowNodeType.INSPIRATION_CONTEXT:
        relative_path = storage.save_context_image_upload(workflow.inspiration_id, filename, image_bytes)
        kind = SourceAssetKind.CONTEXT_IMAGE
    else:
        relative_path = storage.save_reference_upload(workflow.inspiration_id, filename, image_bytes)
        kind = SourceAssetKind.REFERENCE_IMAGE
    storage_metadata = storage.metadata_for(relative_path)
    asset = SourceAsset(
        inspiration_id=workflow.inspiration_id,
        kind=kind,
        original_filename=filename,
        mime_type=content_type or "application/octet-stream",
        **storage_metadata.as_model_kwargs(),
    )
    session.add(asset)
    session.flush()

    config = dict(node.config_json or {})
    if node.node_type == WorkflowNodeType.INSPIRATION_CONTEXT:
        config["image_source_asset_id"] = asset.id
        config.pop("source_asset_id", None)
        config.pop("source_asset_ids", None)
        node.config_json = _inspiration_context_runtime_config(workflow, config)
        node.output_json = {
            **inspiration_context_output(workflow.inspiration, node, workflow=workflow),
            "summary": "已替换上下文图片",
        }
        node.status = WorkflowNodeStatus.SUCCEEDED
        node.failure_reason = None
        node.last_run_at = now_utc()
        workflow.updated_at = now_utc()
        workflow.inspiration.updated_at = now_utc()
        session.commit()
        session.expire_all()
        return inspiration_workflow_graph.get_workflow_or_raise(session, workflow.id)

    if role is not None:
        config["role"] = role.strip() or "reference"
    if label is not None:
        config["label"] = label.strip() or filename
    config["source_asset_ids"] = [asset.id]
    config.pop("source_poster_variant_id", None)
    node.config_json = config
    node.output_json = image_asset_output(
        [asset],
        summary="已替换参考图",
        role=optional_config_text(config, "role"),
        label=optional_config_text(config, "label"),
    )
    node.status = WorkflowNodeStatus.SUCCEEDED
    node.failure_reason = None
    node.last_run_at = now_utc()
    workflow.updated_at = now_utc()
    workflow.inspiration.updated_at = now_utc()
    session.commit()
    session.expire_all()
    return inspiration_workflow_graph.get_workflow_or_raise(session, workflow.id)


def upload_workflow_node_document(
    session: Session,
    *,
    node_id: str,
    document_bytes: bytes,
    filename: str,
    content_type: str,
    document_text: str,
    storage: LocalStorage | None = None,
) -> InspirationWorkflow:
    node = inspiration_workflow_graph.get_node_or_raise(session, node_id)
    if node.node_type != WorkflowNodeType.INSPIRATION_CONTEXT:
        raise BusinessValidationError("只有上下文节点可以上传文档")
    workflow = inspiration_workflow_graph.get_workflow_or_raise(session, node.workflow_id)
    storage = storage or LocalStorage()
    relative_path = storage.save_document_upload(workflow.inspiration_id, filename, document_bytes)
    storage_metadata = storage.metadata_for(relative_path)
    asset = SourceAsset(
        inspiration_id=workflow.inspiration_id,
        kind=SourceAssetKind.CONTEXT_DOCUMENT,
        original_filename=filename,
        mime_type=content_type or "application/octet-stream",
        **storage_metadata.as_model_kwargs(),
    )
    session.add(asset)
    session.flush()

    config = dict(node.config_json or {})
    config.update(
        {
            "document_source_asset_id": asset.id,
            "document_filename": filename,
            "document_mime_type": content_type,
            "document_text": document_text,
        }
    )
    node.config_json = _inspiration_context_runtime_config(workflow, config)
    node.output_json = {
        **inspiration_context_output(workflow.inspiration, node, workflow=workflow),
        "summary": "已上传上下文文档",
    }
    node.status = WorkflowNodeStatus.SUCCEEDED
    node.failure_reason = None
    node.last_run_at = now_utc()
    workflow.updated_at = now_utc()
    workflow.inspiration.updated_at = now_utc()
    session.commit()
    session.expire_all()
    return inspiration_workflow_graph.get_workflow_or_raise(session, workflow.id)


def bind_workflow_node_image(
    session: Session,
    *,
    node_id: str,
    source_asset_id: str | None = None,
    poster_variant_id: str | None = None,
    storage: LocalStorage | None = None,
) -> InspirationWorkflow:
    """把已有灵感产物图片绑定到参考图节点。

    SourceAsset 直接复用已有行；PosterVariant 优先复用同一次工作流生成时已经填充的 SourceAsset，
    找不到时再把海报文件复制成新的 reference SourceAsset。
    """
    if bool(source_asset_id) == bool(poster_variant_id):
        raise BusinessValidationError("请选择一张图片")

    node = inspiration_workflow_graph.get_node_or_raise(session, node_id)
    if node.node_type != WorkflowNodeType.REFERENCE_IMAGE:
        raise BusinessValidationError("只有参考图节点可以填充图片")
    workflow = inspiration_workflow_graph.get_workflow_or_raise(session, node.workflow_id)

    source_poster_variant_id: str | None = None
    if source_asset_id:
        asset = session.get(SourceAsset, source_asset_id)
        if asset is None or asset.inspiration_id != workflow.inspiration_id:
            raise NotFoundError("源图不存在")
        if asset.kind != SourceAssetKind.REFERENCE_IMAGE:
            raise BusinessValidationError("只能绑定参考图素材")
        if asset.source_poster_variant_id:
            poster = session.get(PosterVariant, asset.source_poster_variant_id)
            if poster is not None and poster.inspiration_id == workflow.inspiration_id:
                source_poster_variant_id = poster.id
    else:
        poster = session.get(PosterVariant, poster_variant_id)
        if poster is None or poster.inspiration_id != workflow.inspiration_id:
            raise NotFoundError("海报不存在")
        source_poster_variant_id = poster.id
        asset = source_asset_for_poster_variant(
            session,
            workflow=workflow,
            poster_variant_id=poster.id,
            storage=storage,
        )

    fill_reference_node(node, asset, source_poster_variant_id=source_poster_variant_id)
    workflow.updated_at = now_utc()
    workflow.inspiration.updated_at = now_utc()
    session.commit()
    session.expire_all()
    return inspiration_workflow_graph.get_workflow_or_raise(session, workflow.id)


def clear_workflow_node_image(
    session: Session,
    *,
    node_id: str,
) -> InspirationWorkflow:
    """清空参考图节点的当前图片绑定，保留节点角色/标签配置。"""
    node = inspiration_workflow_graph.get_node_or_raise(session, node_id)
    if node.node_type != WorkflowNodeType.REFERENCE_IMAGE:
        raise BusinessValidationError("只有参考图节点可以清除图片")
    workflow = inspiration_workflow_graph.get_workflow_or_raise(session, node.workflow_id)

    config = dict(node.config_json or {})
    config.pop("source_asset_id", None)
    config.pop("source_asset_ids", None)
    config.pop("source_poster_variant_id", None)
    node.config_json = config
    node.output_json = None
    node.status = WorkflowNodeStatus.IDLE
    node.failure_reason = None
    node.last_run_at = None
    workflow.updated_at = now_utc()
    workflow.inspiration.updated_at = now_utc()
    session.commit()
    session.expire_all()
    return inspiration_workflow_graph.get_workflow_or_raise(session, workflow.id)


def apply_tail_split_plan(
    session: Session,
    *,
    node_id: str,
    plan_id: str,
    item_ids: list[str] | None,
    items: list[TailSplitPlanItemSelection] | None = None,
    image_generation_config: TailSplitPlanImageGenerationConfig | None = None,
    position_x: int | None = None,
    position_y: int | None = None,
    reuse_public_copy_node: bool = False,
    reuse_public_reference_node: bool = False,
    enqueue: Callable[[str], None] | None = None,
) -> InspirationWorkflow:
    node = inspiration_workflow_graph.get_node_or_raise(session, node_id)
    applied = apply_tail_split_plan_to_graph(
        session,
        tail_node=node,
        plan_id=plan_id,
        item_ids=item_ids,
        items=items,
        image_generation_config=image_generation_config,
        position_x=position_x,
        position_y=position_y,
        reuse_public_copy_node=reuse_public_copy_node,
        reuse_public_reference_node=reuse_public_reference_node,
    )
    completed_run_ids = _resolve_tail_confirmation_runs_after_apply(
        session,
        workflow_id=applied.workflow.id,
        tail_node_id=node.id,
        plan_id=plan_id,
    )
    session.commit()
    for run_id in completed_run_ids:
        run = session.get(WorkflowRun, run_id)
        if run is not None:
            publish_workflow_run_notification_safely(run)
    session.expire_all()
    return inspiration_workflow_graph.get_workflow_or_raise(session, applied.workflow.id)


def _resolve_tail_confirmation_runs_after_apply(
    session: Session,
    *,
    workflow_id: str,
    tail_node_id: str,
    plan_id: str,
) -> list[str]:
    runs = list(
        session.scalars(
            select(WorkflowRun)
            .options(selectinload(WorkflowRun.node_runs))
            .where(
                WorkflowRun.workflow_id == workflow_id,
                WorkflowRun.status.in_((WorkflowRunStatus.RUNNING, WorkflowRunStatus.WAITING_CONFIRMATION)),
            )
        )
    )
    completed_run_ids: list[str] = []
    for run in runs:
        if not workflow_run_is_user_active(run.status):
            continue
        if not run_has_pending_tail_confirmation(run, tail_node_id=tail_node_id, plan_id=plan_id):
            continue
        has_queued_or_running = _run_has_queued_or_running_node_runs(run)
        now = now_utc()
        remove_pending_tail_confirmation(run, tail_node_id=tail_node_id, plan_id=plan_id)
        if has_queued_or_running:
            run.status = WorkflowRunStatus.RUNNING
            run.failure_reason = None
            run.finished_at = None
        elif run_has_pending_tail_confirmations(run):
            run.status = WorkflowRunStatus.WAITING_CONFIRMATION
        else:
            run.status = WorkflowRunStatus.SUCCEEDED
            run.failure_reason = None
            run.finished_at = now
            completed_run_ids.append(run.id)
        run.workflow.updated_at = now
    session.flush()
    return completed_run_ids


def _run_has_queued_or_running_node_runs(run: WorkflowRun) -> bool:
    return any(
        WORKFLOW_RUN_GENERATION_TASK_CONTRACT.execution_is_queued(node_run.status)
        or WORKFLOW_RUN_GENERATION_TASK_CONTRACT.execution_is_running(node_run.status)
        for node_run in run.node_runs
    )


def create_workflow_edge(
    session: Session,
    *,
    inspiration_id: str,
    source_node_id: str,
    target_node_id: str,
    source_handle: str | None = None,
    target_handle: str | None = None,
) -> InspirationWorkflow:
    workflow = get_or_create_inspiration_workflow(session, inspiration_id)
    nodes = {node.id: node for node in workflow.nodes}
    if source_node_id == target_node_id:
        raise BusinessValidationError("工作流连线不能连接到自身")
    if source_node_id not in nodes or target_node_id not in nodes:
        raise BusinessValidationError("工作流连线节点不属于当前灵感产物")
    if nodes[source_node_id].node_type == WorkflowNodeType.DECK_GENERATION:
        raise BusinessValidationError("演示节点不能作为连线来源")
    edge = WorkflowEdge(
        workflow_id=workflow.id,
        source_node_id=source_node_id,
        target_node_id=target_node_id,
        source_handle=source_handle,
        target_handle=target_handle,
    )
    session.add(edge)
    workflow.updated_at = now_utc()
    session.flush()
    session.expire(workflow, ["nodes", "edges"])
    refreshed = inspiration_workflow_graph.get_workflow_or_raise(session, workflow.id)
    try:
        inspiration_workflow_graph.topological_nodes(refreshed)
    except BusinessError:
        session.rollback()
        raise
    except ValueError as exc:
        session.rollback()
        raise BusinessValidationError(str(exc)) from exc
    session.commit()
    session.expire_all()
    return inspiration_workflow_graph.get_workflow_or_raise(session, workflow.id)


def delete_workflow_edge(session: Session, *, edge_id: str) -> InspirationWorkflow:
    edge = inspiration_workflow_graph.get_edge_or_raise(session, edge_id)
    workflow_id = edge.workflow_id
    edge.workflow.updated_at = now_utc()
    session.delete(edge)
    session.commit()
    session.expire_all()
    return inspiration_workflow_graph.get_workflow_or_raise(session, workflow_id)


def delete_workflow_node(session: Session, *, node_id: str) -> InspirationWorkflow:
    node = inspiration_workflow_graph.get_node_or_raise(session, node_id)
    workflow = inspiration_workflow_graph.get_workflow_or_raise(session, node.workflow_id)
    if (
        _active_workflow_run(workflow) is not None
        or WORKFLOW_RUN_GENERATION_TASK_CONTRACT.execution_is_queued(node.status)
        or WORKFLOW_RUN_GENERATION_TASK_CONTRACT.execution_is_running(node.status)
    ):
        raise BusinessValidationError("运行中，稍后删除")

    workflow_id = workflow.id
    workflow.updated_at = now_utc()
    session.execute(
        delete(WorkflowEdge).where(
            (WorkflowEdge.workflow_id == workflow_id)
            & ((WorkflowEdge.source_node_id == node.id) | (WorkflowEdge.target_node_id == node.id))
        )
    )
    session.execute(delete(WorkflowNodeRun).where(WorkflowNodeRun.node_id == node.id))
    session.delete(node)
    session.commit()
    session.expire_all()
    return inspiration_workflow_graph.get_workflow_or_raise(session, workflow_id)


def _normalize_inspiration_context_singleton(session: Session, workflow: InspirationWorkflow) -> bool:
    inspiration_nodes = sorted(
        [node for node in workflow.nodes if node.node_type == WorkflowNodeType.INSPIRATION_CONTEXT],
        key=lambda item: (item.created_at, item.position_x, item.position_y),
    )
    changed = False
    if not inspiration_nodes:
        context = WorkflowNode(
            workflow_id=workflow.id,
            node_type=WorkflowNodeType.INSPIRATION_CONTEXT,
            title="灵感",
            position_x=40,
            position_y=120,
            config_json=_inspiration_context_runtime_config(workflow),
        )
        session.add(context)
        session.flush()
        inspiration_nodes = [context]
        changed = True
    primary = inspiration_nodes[0]
    normalized_primary_config = _inspiration_context_runtime_config(workflow, primary.config_json)
    if normalized_primary_config != (primary.config_json or {}):
        primary.config_json = normalized_primary_config
        changed = True
    duplicate_ids = {node.id for node in inspiration_nodes[1:]}
    if duplicate_ids:
        session.execute(
            delete(WorkflowEdge).where(
                (WorkflowEdge.workflow_id == workflow.id)
                & (WorkflowEdge.source_node_id.in_(duplicate_ids) | WorkflowEdge.target_node_id.in_(duplicate_ids))
            )
        )
        session.execute(delete(WorkflowNodeRun).where(WorkflowNodeRun.node_id.in_(duplicate_ids)))
        for duplicate in inspiration_nodes[1:]:
            session.delete(duplicate)
        changed = True
    if changed:
        workflow.updated_at = now_utc()
    return changed
