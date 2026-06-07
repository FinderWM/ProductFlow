from __future__ import annotations

from collections.abc import Iterable
from copy import deepcopy
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from productflow_backend.application.canvas_templates import CanvasTemplate, validate_canvas_template
from productflow_backend.application.product_workflow.context import normalize_product_context_config
from productflow_backend.application.product_workflow.user_templates import get_canvas_template
from productflow_backend.domain.enums import WorkflowNodeType
from productflow_backend.domain.errors import BusinessValidationError, NotFoundError
from productflow_backend.infrastructure.db.models import (
    DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    Product,
    ProductWorkflow,
    WorkflowEdge,
    WorkflowNode,
)

DEFAULT_PRODUCT_CREATION_CANVAS_TEMPLATE_KEYS = frozenset({"", "default", "basic", "blank", "minimal"})
TEMPLATE_METADATA_CONFIG_KEY = "_canvas_template"
InitialWorkflowEntry = str
GENERATION_RESOURCE_GROUP_NODE_TYPES = frozenset(
    {
        WorkflowNodeType.COPY_GENERATION,
        WorkflowNodeType.IMAGE_GENERATION,
        WorkflowNodeType.TAIL_SPLITTER,
    }
)


def _default_resource_group_config(
    node_type: WorkflowNodeType,
    config_json: dict[str, Any],
    *,
    resource_group_id: str | None,
) -> dict[str, Any]:
    config = dict(config_json)
    if node_type in GENERATION_RESOURCE_GROUP_NODE_TYPES:
        config["resource_group_id"] = resource_group_id or config.get(
            "resource_group_id",
            DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        )
    return config


def resolve_product_creation_canvas_template(
    session: Session,
    canvas_template_key: str | None,
    *,
    initial_workflow_entry: InitialWorkflowEntry = "image",
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
) -> CanvasTemplate | None:
    template_key = (canvas_template_key or "").strip()
    if template_key in DEFAULT_PRODUCT_CREATION_CANVAS_TEMPLATE_KEYS:
        return None

    template = get_canvas_template(
        session,
        template_key,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )
    if template.kind != "full_canvas":
        raise BusinessValidationError("商品创建只支持完整画布模板，节点组模板请在画布内添加")
    if initial_workflow_entry != "blank" and template.entry_mode != initial_workflow_entry:
        raise BusinessValidationError("画布模板入口类型与开始方式不匹配")
    return template


def materialize_product_workflow_from_template(
    session: Session,
    *,
    product_id: str,
    template: CanvasTemplate,
    initial_entry_mode: InitialWorkflowEntry = "image",
    entry_text: str | None = None,
    product_context_config: dict[str, object] | None = None,
    resource_group_id: str | None = None,
) -> ProductWorkflow:
    validate_canvas_template(template)
    if template.kind != "full_canvas":
        raise BusinessValidationError("商品创建只支持完整画布模板，节点组模板请在画布内添加")

    product_exists = session.scalar(select(Product.id).where(Product.id == product_id))
    if product_exists is None:
        raise NotFoundError("商品不存在")

    active_workflow_id = session.scalar(
        select(ProductWorkflow.id).where(
            ProductWorkflow.product_id == product_id,
            ProductWorkflow.active.is_(True),
        )
    )
    if active_workflow_id is not None:
        raise BusinessValidationError("商品已有活动画布")

    workflow = ProductWorkflow(
        product_id=product_id,
        title=template.title,
        active=True,
        initial_entry_mode=initial_entry_mode,
    )
    session.add(workflow)
    session.flush()

    nodes_by_template_key = materialize_canvas_template_graph(
        session,
        workflow=workflow,
        template=template,
        resource_group_id=resource_group_id,
    )
    _persist_template_product_context(
        nodes_by_template_key.values(),
        initial_entry_mode=initial_entry_mode,
        entry_text=entry_text,
        product_context_config=product_context_config,
    )
    session.flush()
    return workflow


def materialize_canvas_template_graph(
    session: Session,
    *,
    workflow: ProductWorkflow,
    template: CanvasTemplate,
    position_x_offset: int = 0,
    position_y_offset: int = 0,
    existing_nodes_by_template_key: dict[str, WorkflowNode] | None = None,
    external_source_nodes_by_template_source: dict[str, WorkflowNode] | None = None,
    resource_group_id: str | None = None,
) -> dict[str, WorkflowNode]:
    validate_canvas_template(template)
    nodes_by_template_key: dict[str, WorkflowNode] = dict(existing_nodes_by_template_key or {})
    for node_spec in template.nodes:
        if node_spec.key in nodes_by_template_key:
            continue
        config_json = _default_resource_group_config(
            node_spec.node_type,
            deepcopy(node_spec.config_json),
            resource_group_id=resource_group_id,
        )
        if template.source == "builtin":
            config_json[TEMPLATE_METADATA_CONFIG_KEY] = {
                "source": template.source,
                "template_key": template.key,
                "node_key": node_spec.key,
            }
        node = WorkflowNode(
            workflow_id=workflow.id,
            node_type=node_spec.node_type,
            title=node_spec.title,
            position_x=node_spec.position_x + position_x_offset,
            position_y=node_spec.position_y + position_y_offset,
            config_json=config_json,
        )
        session.add(node)
        nodes_by_template_key[node_spec.key] = node
    session.flush()

    for edge_spec in template.edges:
        session.add(
            WorkflowEdge(
                workflow_id=workflow.id,
                source_node_id=nodes_by_template_key[edge_spec.source_node_key].id,
                target_node_id=nodes_by_template_key[edge_spec.target_node_key].id,
                source_handle=edge_spec.source_handle,
                target_handle=edge_spec.target_handle,
            )
        )
    external_sources = external_source_nodes_by_template_source or {}
    for connection in template.default_external_connections:
        source_node = external_sources.get(connection.source)
        if source_node is None:
            raise BusinessValidationError("节点组模板需要当前画布中的商品资料节点")
        session.add(
            WorkflowEdge(
                workflow_id=workflow.id,
                source_node_id=source_node.id,
                target_node_id=nodes_by_template_key[connection.target_node_key].id,
                source_handle="output",
                target_handle="input",
            )
        )
    session.flush()
    return nodes_by_template_key


def _persist_template_product_context(
    nodes: Iterable[WorkflowNode],
    *,
    initial_entry_mode: InitialWorkflowEntry,
    entry_text: str | None,
    product_context_config: dict[str, object] | None,
) -> None:
    product_context_node = next(
        (
            node
            for node in nodes
            if isinstance(node, WorkflowNode) and node.node_type == WorkflowNodeType.PRODUCT_CONTEXT
        ),
        None,
    )
    if product_context_node is None:
        return
    config = {**(product_context_node.config_json or {}), **(product_context_config or {})}
    if initial_entry_mode in {"copy", "tail"}:
        normalized_text = (entry_text or "").strip()
        if normalized_text:
            config.setdefault("entry_type", initial_entry_mode)
            config.setdefault("long_text", normalized_text)
            config.setdefault("source_note", normalized_text)
    product_context_node.config_json = normalize_product_context_config(config)
