from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.orm import Session, load_only, selectinload

from inspiration_one_backend.application.admission import (
    get_generation_queue_overview,
    get_queued_generation_positions,
    get_workflow_run_queue_metadata,
)
from inspiration_one_backend.application.inspiration_workflow.tail_confirmation import workflow_run_is_user_active
from inspiration_one_backend.domain.enums import WorkflowNodeType
from inspiration_one_backend.domain.errors import NotFoundError
from inspiration_one_backend.domain.workflow_rules import WorkflowRuleEdge, WorkflowRuleNode, topological_node_ids
from inspiration_one_backend.infrastructure.db.models import (
    DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    Inspiration,
    InspirationWorkflow,
    WorkflowEdge,
    WorkflowNode,
    WorkflowNodeRun,
    WorkflowRun,
)

DEFAULT_WORKFLOW_TITLE = "灵感创意工作流"
DEFAULT_IMAGE_SIZE = "1024x1024"


@dataclass(frozen=True, slots=True)
class InspirationWorkflowStatusSnapshot:
    workflow: InspirationWorkflow
    nodes: list[WorkflowNode]
    runs: list[WorkflowRun]
    node_context_runs: list[WorkflowRun]


def workflow_query():
    return select(InspirationWorkflow).options(
        selectinload(InspirationWorkflow.inspiration).selectinload(Inspiration.source_assets),
        selectinload(InspirationWorkflow.inspiration).selectinload(Inspiration.creative_briefs),
        selectinload(InspirationWorkflow.inspiration).selectinload(Inspiration.copy_sets),
        selectinload(InspirationWorkflow.inspiration).selectinload(Inspiration.poster_variants),
        selectinload(InspirationWorkflow.inspiration).selectinload(Inspiration.confirmed_copy_set),
        selectinload(InspirationWorkflow.nodes),
        selectinload(InspirationWorkflow.edges),
        selectinload(InspirationWorkflow.runs).selectinload(WorkflowRun.node_runs),
    )


def workflow_status_query():
    return select(InspirationWorkflow).options(
        load_only(
            InspirationWorkflow.id,
            InspirationWorkflow.inspiration_id,
            InspirationWorkflow.title,
            InspirationWorkflow.active,
            InspirationWorkflow.initial_entry_mode,
            InspirationWorkflow.created_at,
            InspirationWorkflow.updated_at,
        ),
    )


def get_inspiration_or_raise(session: Session, inspiration_id: str) -> Inspiration:
    inspiration = session.scalar(
        select(Inspiration)
        .options(
            selectinload(Inspiration.source_assets),
            selectinload(Inspiration.creative_briefs),
            selectinload(Inspiration.copy_sets),
            selectinload(Inspiration.poster_variants),
            selectinload(Inspiration.confirmed_copy_set),
        )
        .where(Inspiration.id == inspiration_id)
    )
    if inspiration is None:
        raise NotFoundError("灵感产物不存在")
    return inspiration


def get_workflow_or_raise(session: Session, workflow_id: str) -> InspirationWorkflow:
    workflow = session.scalar(workflow_query().where(InspirationWorkflow.id == workflow_id))
    if workflow is None:
        raise NotFoundError("工作流不存在")
    attach_workflow_run_queue_metadata(session, workflow.runs)
    return workflow


def get_active_workflow(session: Session, inspiration_id: str) -> InspirationWorkflow | None:
    workflow = session.scalar(
        workflow_query().where(
            InspirationWorkflow.inspiration_id == inspiration_id, InspirationWorkflow.active.is_(True)
        )
    )
    if workflow is not None:
        attach_workflow_run_queue_metadata(session, workflow.runs)
    return workflow


def attach_workflow_run_queue_metadata(session: Session, runs: list[WorkflowRun]) -> None:
    overview = get_generation_queue_overview(session)
    queued_positions = get_queued_generation_positions(session)
    for run in runs:
        run.__dict__["_queue_metadata"] = get_workflow_run_queue_metadata(
            session,
            run,
            overview=overview,
            queued_positions=queued_positions,
        )


def get_active_workflow_status(session: Session, inspiration_id: str) -> InspirationWorkflowStatusSnapshot:
    workflow = session.scalar(
        workflow_status_query().where(
            InspirationWorkflow.inspiration_id == inspiration_id, InspirationWorkflow.active.is_(True)
        )
    )
    if workflow is None:
        get_inspiration_or_raise(session, inspiration_id)
        raise NotFoundError("工作流不存在")
    nodes = list(
        session.scalars(
            select(WorkflowNode)
            .options(
                load_only(
                    WorkflowNode.id,
                    WorkflowNode.workflow_id,
                    WorkflowNode.status,
                    WorkflowNode.failure_reason,
                    WorkflowNode.last_run_at,
                    WorkflowNode.updated_at,
                )
            )
            .where(WorkflowNode.workflow_id == workflow.id)
            .order_by(WorkflowNode.position_x, WorkflowNode.position_y, WorkflowNode.created_at)
        )
    )
    runs = list(
        session.scalars(
            select(WorkflowRun)
            .options(
                load_only(
                    WorkflowRun.id,
                    WorkflowRun.workflow_id,
                    WorkflowRun.status,
                    WorkflowRun.started_at,
                    WorkflowRun.finished_at,
                    WorkflowRun.failure_reason,
                    WorkflowRun.is_retryable,
                    WorkflowRun.progress_metadata,
                ),
                selectinload(WorkflowRun.node_runs).load_only(
                    WorkflowNodeRun.id,
                    WorkflowNodeRun.workflow_run_id,
                    WorkflowNodeRun.node_id,
                    WorkflowNodeRun.status,
                    WorkflowNodeRun.failure_reason,
                    WorkflowNodeRun.started_at,
                    WorkflowNodeRun.finished_at,
                ),
            )
            .where(WorkflowRun.workflow_id == workflow.id)
            .order_by(desc(WorkflowRun.started_at), desc(WorkflowRun.id))
            .limit(10)
        )
    )
    node_context_runs = list(
        session.scalars(
            select(WorkflowRun)
            .options(
                load_only(
                    WorkflowRun.id,
                    WorkflowRun.workflow_id,
                    WorkflowRun.status,
                    WorkflowRun.started_at,
                    WorkflowRun.finished_at,
                    WorkflowRun.failure_reason,
                    WorkflowRun.is_retryable,
                    WorkflowRun.progress_metadata,
                ),
                selectinload(WorkflowRun.node_runs).load_only(
                    WorkflowNodeRun.id,
                    WorkflowNodeRun.workflow_run_id,
                    WorkflowNodeRun.node_id,
                    WorkflowNodeRun.status,
                    WorkflowNodeRun.failure_reason,
                    WorkflowNodeRun.started_at,
                    WorkflowNodeRun.finished_at,
                ),
            )
            .where(WorkflowRun.workflow_id == workflow.id)
            .order_by(desc(WorkflowRun.started_at), desc(WorkflowRun.id))
        )
    )
    attach_workflow_run_queue_metadata(session, runs)
    return InspirationWorkflowStatusSnapshot(
        workflow=workflow,
        nodes=nodes,
        runs=runs,
        node_context_runs=node_context_runs,
    )


def get_node_or_raise(session: Session, node_id: str) -> WorkflowNode:
    node = session.get(WorkflowNode, node_id)
    if node is None:
        raise NotFoundError("工作流节点不存在")
    return node


def get_edge_or_raise(session: Session, edge_id: str) -> WorkflowEdge:
    edge = session.get(WorkflowEdge, edge_id)
    if edge is None:
        raise NotFoundError("工作流连线不存在")
    return edge


def default_node_specs(inspiration: Inspiration) -> list[dict[str, Any]]:
    resource_group_id = inspiration.resource_group_id or DEFAULT_GENERATION_RESOURCE_GROUP_ID
    return [
        {
            "key": "context",
            "node_type": WorkflowNodeType.INSPIRATION_CONTEXT,
            "title": "灵感",
            "position_x": 40,
            "position_y": 120,
            "config_json": {},
        },
        {
            "key": "copy",
            "node_type": WorkflowNodeType.COPY_GENERATION,
            "title": "文案",
            "position_x": 320,
            "position_y": 80,
            "config_json": {
                "instruction": f"围绕 {inspiration.name} 生成一版适合灵感产物图的文案",
                "resource_group_id": resource_group_id,
            },
        },
        {
            "key": "image",
            "node_type": WorkflowNodeType.IMAGE_GENERATION,
            "title": "生图",
            "position_x": 620,
            "position_y": 100,
            "config_json": {
                "instruction": "结合灵感产物和文案生成灵感产物图",
                "size": DEFAULT_IMAGE_SIZE,
                "resource_group_id": resource_group_id,
            },
        },
        {
            "key": "reference",
            "node_type": WorkflowNodeType.REFERENCE_IMAGE,
            "title": "参考图",
            "position_x": 920,
            "position_y": 120,
            "config_json": {"role": "reference", "label": "生成结果槽位"},
        },
    ]


def default_edges(nodes_by_key: dict[str, WorkflowNode], workflow_id: str) -> list[WorkflowEdge]:
    pairs = [
        ("context", "copy"),
        ("context", "image"),
        ("copy", "image"),
        ("image", "reference"),
    ]
    return [
        WorkflowEdge(
            workflow_id=workflow_id,
            source_node_id=nodes_by_key[source].id,
            target_node_id=nodes_by_key[target].id,
            source_handle="output",
            target_handle="input",
        )
        for source, target in pairs
    ]


def default_title_for_type(node_type: WorkflowNodeType) -> str:
    return {
        WorkflowNodeType.INSPIRATION_CONTEXT: "灵感",
        WorkflowNodeType.REFERENCE_IMAGE: "参考图",
        WorkflowNodeType.COPY_GENERATION: "文案",
        WorkflowNodeType.IMAGE_GENERATION: "生图",
        WorkflowNodeType.TAIL_SPLITTER: "尾巴节点",
    }[node_type]


def topological_nodes(workflow: InspirationWorkflow) -> list[WorkflowNode]:
    nodes = {node.id: node for node in workflow.nodes}
    ordered_ids = topological_node_ids(
        [
            WorkflowRuleNode(
                id=node.id,
                node_type=node.node_type,
                position_x=node.position_x,
                config_json=node.config_json,
            )
            for node in workflow.nodes
        ],
        [
            WorkflowRuleEdge(source_node_id=edge.source_node_id, target_node_id=edge.target_node_id)
            for edge in workflow.edges
        ],
    )
    return [nodes[node_id] for node_id in ordered_ids]


def latest_workflow_runs(workflow: InspirationWorkflow, limit: int = 10) -> list[WorkflowRun]:
    return sorted(
        workflow.runs,
        key=lambda item: (
            item.started_at,
            workflow_run_is_user_active(item.status),
            item.finished_at or item.started_at,
            item.id,
        ),
        reverse=True,
    )[:limit]
