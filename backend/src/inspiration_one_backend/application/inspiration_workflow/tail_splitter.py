from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from pydantic import ValidationError
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from inspiration_one_backend.application.contracts import (
    TailAppliedBatch,
    TailSplitPlan,
    TailSplitPlanDraft,
    TailSplitPlanItem,
    TailSplitterConfig,
    TailSplitterOutput,
)
from inspiration_one_backend.application.image_generation_core import normalize_image_generation_tool_options
from inspiration_one_backend.application.inspiration_workflow import graph as inspiration_workflow_graph
from inspiration_one_backend.application.inspiration_workflow.artifacts import image_asset_output
from inspiration_one_backend.application.inspiration_workflow.context import (
    collect_incoming_context,
    image_size_from_config,
)
from inspiration_one_backend.application.time import now_utc
from inspiration_one_backend.config import get_runtime_settings
from inspiration_one_backend.domain.enums import WorkflowNodeStatus, WorkflowNodeType
from inspiration_one_backend.domain.errors import BusinessValidationError
from inspiration_one_backend.infrastructure.db.models import (
    InspirationWorkflow,
    SourceAsset,
    WorkflowEdge,
    WorkflowNode,
    WorkflowNodeRun,
)

DEFAULT_TAIL_SPLITTER_SUMMARY = "尾巴节点待运行"
TAIL_SPLITTER_PUBLIC_COPY_TITLE = "公共约束"
TAIL_SPLITTER_PUBLIC_REFERENCE_TITLE = "公共参考图"
TAIL_SPLITTER_IMAGE_X_GAP = 300
TAIL_SPLITTER_OUTPUT_X_GAP = 300
TAIL_SPLITTER_PUBLIC_X_GAP = 300
TAIL_SPLITTER_PUBLIC_COPY_Y_OFFSET = -180
TAIL_SPLITTER_PUBLIC_REFERENCE_Y_OFFSET = 40
TAIL_SPLITTER_ROW_GAP = 180


@dataclass(frozen=True, slots=True)
class AppliedTailSplitPlan:
    workflow: InspirationWorkflow
    batch_id: str
    created_node_ids: list[str]


@dataclass(frozen=True, slots=True)
class TailSplitPlanItemSelection:
    id: str
    instruction: str | None = None


@dataclass(frozen=True, slots=True)
class TailSplitPlanImageGenerationConfig:
    size: str | None = None
    resource_group_id: str | None = None
    generation_config_mode: str | None = None
    generation_config_id: str | None = None
    tool_options: dict[str, Any] | None = None


def normalize_tail_splitter_config(config_json: dict[str, Any] | None) -> dict[str, Any]:
    config = dict(config_json or {})
    normalized = read_tail_splitter_config_for_runtime(config)
    return {**config, **normalized.model_dump(mode="json")}


def read_tail_splitter_config(config_json: dict[str, Any] | None) -> TailSplitterConfig:
    try:
        return TailSplitterConfig.model_validate(config_json or {})
    except ValidationError as exc:
        raise ValueError(_tail_splitter_validation_error_message(exc)) from exc


def read_tail_splitter_config_for_runtime(
    config_json: dict[str, Any] | None,
    *,
    max_items_limit: int | None = None,
) -> TailSplitterConfig:
    config = read_tail_splitter_config(config_json)
    validate_tail_splitter_max_items(config.max_items, max_items_limit=max_items_limit)
    return config


def validate_tail_splitter_max_items(value: int, *, max_items_limit: int | None = None) -> int:
    resolved_limit = (
        int(max_items_limit)
        if max_items_limit is not None
        else int(get_runtime_settings().generation_tail_splitter_max_items)
    )
    if value > resolved_limit:
        raise ValueError(f"最大拆分数不能超过 {resolved_limit}")
    return value


def _tail_splitter_validation_error_message(exc: ValidationError) -> str:
    error = exc.errors()[0] if exc.errors() else {}
    loc = tuple(error.get("loc", ()))
    error_type = str(error.get("type") or "")
    ctx_error = error.get("ctx", {}).get("error")
    if ctx_error is not None:
        return str(ctx_error)
    if loc == ("max_items",):
        return "最大拆分数必须是整数"
    if loc == ("generation_config_mode",):
        return "生成配置模式必须是 auto 或 manual"
    if loc == ("generation_config_id",):
        return "生成配置 ID 必须是文本"
    if loc == ("description",):
        return "拆分说明必须是文本"
    if loc == ("source_text",):
        return "拆分源文本必须是文本"
    if loc == ("document_source",):
        return "尾巴节点文档来源必须是对象"
    if error_type:
        return f"尾巴节点配置无效：{'.'.join(str(part) for part in loc) or 'config'} {error_type}"
    return "尾巴节点配置无效，请调整节点设置后重试"


def read_tail_splitter_output(output_json: dict[str, Any] | None) -> TailSplitterOutput:
    if not isinstance(output_json, dict):
        return TailSplitterOutput(summary=DEFAULT_TAIL_SPLITTER_SUMMARY)
    try:
        return TailSplitterOutput.model_validate(output_json)
    except ValidationError:
        summary = output_json.get("summary")
        return TailSplitterOutput(
            summary=summary.strip() if isinstance(summary, str) and summary.strip() else DEFAULT_TAIL_SPLITTER_SUMMARY
        )


def build_tail_split_plan_output(
    draft: TailSplitPlanDraft,
    *,
    existing_output_json: dict[str, Any] | None,
) -> TailSplitterOutput:
    existing = read_tail_splitter_output(existing_output_json)
    return TailSplitterOutput(
        summary=f"已拆分 {len(draft.items)} 个生图方向",
        latest_plan=build_tail_split_plan(draft),
        applied_batches=existing.applied_batches,
    )


def build_tail_split_plan(draft: TailSplitPlanDraft) -> TailSplitPlan:
    created_at = now_utc()
    items = [
        TailSplitPlanItem(
            id=item.id or f"item-{index}",
            order=item.order or index,
            title=item.title,
            instruction=item.instruction,
            visual_intent=item.visual_intent,
            source_refs=item.source_refs,
        )
        for index, item in enumerate(draft.items, start=1)
    ]
    return TailSplitPlan(
        plan_id=str(uuid4()),
        status="pending",
        source_summary=draft.source_summary,
        items=items,
        created_at=created_at,
    )


def pending_tail_split_plan_or_raise(node: WorkflowNode, *, plan_id: str | None = None) -> TailSplitPlan:
    output = read_tail_splitter_output(node.output_json)
    plan = output.latest_plan
    if plan is None:
        raise BusinessValidationError("尾巴节点还没有拆分计划")
    if plan_id is not None and plan.plan_id != plan_id:
        raise BusinessValidationError("尾巴节点拆分计划已变化，请刷新后重试")
    if plan.status != "pending":
        raise BusinessValidationError("当前拆分计划已应用，请重新运行尾巴节点")
    return plan


def apply_tail_split_plan(
    session: Session,
    *,
    tail_node: WorkflowNode,
    plan_id: str,
    item_ids: list[str] | None,
    items: list[TailSplitPlanItemSelection] | None = None,
    image_generation_config: TailSplitPlanImageGenerationConfig | None = None,
    position_x: int | None = None,
    position_y: int | None = None,
    reuse_public_copy_node: bool = False,
    reuse_public_reference_node: bool = False,
) -> AppliedTailSplitPlan:
    if tail_node.node_type != WorkflowNodeType.TAIL_SPLITTER:
        raise BusinessValidationError("只有尾巴节点可以应用拆分计划")
    workflow = inspiration_workflow_graph.get_workflow_or_raise(session, tail_node.workflow_id)
    plan = pending_tail_split_plan_or_raise(tail_node, plan_id=plan_id)
    selected_items = _selected_plan_items(plan, item_ids=item_ids, items=items)
    image_node_base_config = _image_node_base_config(
        tail_resource_group_id=_resource_group_id_from_config(tail_node.config_json),
        image_generation_config=image_generation_config,
    )
    origin_x = position_x if position_x is not None else tail_node.position_x
    origin_y = position_y if position_y is not None else tail_node.position_y
    batch_id = str(uuid4())
    reusable_public_copy_node = (
        _tail_generated_public_node(workflow, tail_node, role="public_copy") if reuse_public_copy_node else None
    )
    reusable_public_reference_node = (
        _tail_generated_public_node(workflow, tail_node, role="public_reference")
        if reuse_public_reference_node
        else None
    )
    preserved_node_ids = {
        node.id for node in (reusable_public_copy_node, reusable_public_reference_node) if node is not None
    }

    delete_tail_generated_branch(session, workflow=workflow, tail_node=tail_node, preserve_node_ids=preserved_node_ids)
    session.expire(workflow, ["nodes", "edges"])
    workflow = inspiration_workflow_graph.get_workflow_or_raise(session, workflow.id)
    tail_node = inspiration_workflow_graph.get_node_or_raise(session, tail_node.id)
    reusable_public_copy_node = _get_preserved_node_or_none(
        session,
        node_id=reusable_public_copy_node.id if reusable_public_copy_node is not None else None,
        workflow_id=workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        tail_node_id=tail_node.id,
        role="public_copy",
    )
    reusable_public_reference_node = _get_preserved_node_or_none(
        session,
        node_id=reusable_public_reference_node.id if reusable_public_reference_node is not None else None,
        workflow_id=workflow.id,
        node_type=WorkflowNodeType.REFERENCE_IMAGE,
        tail_node_id=tail_node.id,
        role="public_reference",
    )

    shared_reference_node = reusable_public_reference_node or _build_public_reference_node(
        session,
        workflow=workflow,
        tail_node=tail_node,
        plan=plan,
        batch_id=batch_id,
        position_x=origin_x + TAIL_SPLITTER_PUBLIC_X_GAP,
        position_y=origin_y + TAIL_SPLITTER_PUBLIC_REFERENCE_Y_OFFSET,
    )
    shared_copy_node = reusable_public_copy_node or _build_public_copy_node(
        workflow=workflow,
        tail_node=tail_node,
        plan=plan,
        batch_id=batch_id,
        resource_group_id=_resource_group_id_from_config(tail_node.config_json),
        position_x=origin_x + TAIL_SPLITTER_PUBLIC_X_GAP,
        position_y=origin_y + TAIL_SPLITTER_PUBLIC_COPY_Y_OFFSET,
    )
    if reusable_public_copy_node is None:
        session.add(shared_copy_node)

    created_nodes: list[WorkflowNode] = [shared_copy_node, shared_reference_node]
    item_node_ids: list[str] = []
    for index, item in enumerate(selected_items):
        row_y = origin_y + index * TAIL_SPLITTER_ROW_GAP
        image_node = WorkflowNode(
            workflow_id=workflow.id,
            node_type=WorkflowNodeType.IMAGE_GENERATION,
            title=item.title,
            position_x=origin_x + TAIL_SPLITTER_PUBLIC_X_GAP + TAIL_SPLITTER_IMAGE_X_GAP,
            position_y=row_y,
            config_json={
                **image_node_base_config,
                "instruction": item.instruction,
                "generated_by": _generated_by_metadata(
                    tail_node_id=tail_node.id,
                    plan_id=plan.plan_id,
                    batch_id=batch_id,
                    role="image_trigger",
                    item_id=item.id,
                ),
                "tail_plan_item": item.model_dump(mode="json"),
            },
        )
        output_reference = WorkflowNode(
            workflow_id=workflow.id,
            node_type=WorkflowNodeType.REFERENCE_IMAGE,
            title=f"{item.title} 输出",
            position_x=origin_x + TAIL_SPLITTER_PUBLIC_X_GAP + TAIL_SPLITTER_IMAGE_X_GAP + TAIL_SPLITTER_OUTPUT_X_GAP,
            position_y=row_y,
            config_json={
                "role": "reference",
                "label": f"{item.title} 输出",
                "generated_by": _generated_by_metadata(
                    tail_node_id=tail_node.id,
                    plan_id=plan.plan_id,
                    batch_id=batch_id,
                    role="output_reference",
                    item_id=item.id,
                ),
            },
        )
        session.add(image_node)
        session.add(output_reference)
        created_nodes.extend([image_node, output_reference])
    session.flush()
    created_node_ids = [node.id for node in created_nodes if node.id not in preserved_node_ids]

    item_nodes = created_nodes[2:]
    for image_node, output_reference in zip(item_nodes[::2], item_nodes[1::2], strict=True):
        session.add(
            WorkflowEdge(
                workflow_id=workflow.id,
                source_node_id=tail_node.id,
                target_node_id=image_node.id,
                source_handle="output",
                target_handle="input",
            )
        )
        session.add(
            WorkflowEdge(
                workflow_id=workflow.id,
                source_node_id=shared_copy_node.id,
                target_node_id=image_node.id,
                source_handle="output",
                target_handle="input",
            )
        )
        session.add(
            WorkflowEdge(
                workflow_id=workflow.id,
                source_node_id=shared_reference_node.id,
                target_node_id=image_node.id,
                source_handle="output",
                target_handle="input",
            )
        )
        session.add(
            WorkflowEdge(
                workflow_id=workflow.id,
                source_node_id=image_node.id,
                target_node_id=output_reference.id,
                source_handle="output",
                target_handle="input",
            )
        )
        item_node_ids.extend([image_node.id, output_reference.id])

    output = read_tail_splitter_output(tail_node.output_json)
    output.summary = f"已应用 {len(selected_items)} 个生图方向"
    output.latest_plan = plan.model_copy(update={"status": "applied"})
    output.applied_batches = [
        TailAppliedBatch(
            batch_id=batch_id,
            plan_id=plan.plan_id,
            item_ids=[item.id for item in selected_items],
            node_ids=[shared_copy_node.id, shared_reference_node.id, *item_node_ids],
            created_at=now_utc(),
        )
    ]
    tail_node.output_json = output.model_dump(mode="json")
    workflow.updated_at = now_utc()
    session.flush()
    session.expire(workflow, ["nodes", "edges"])
    refreshed = inspiration_workflow_graph.get_workflow_or_raise(session, workflow.id)
    try:
        inspiration_workflow_graph.topological_nodes(refreshed)
    except ValueError as exc:
        raise BusinessValidationError(str(exc)) from exc
    return AppliedTailSplitPlan(
        workflow=refreshed,
        batch_id=batch_id,
        created_node_ids=created_node_ids,
    )


def delete_tail_generated_branch(
    session: Session,
    *,
    workflow: InspirationWorkflow,
    tail_node: WorkflowNode,
    preserve_node_ids: set[str] | None = None,
) -> list[str]:
    node_ids = set(_tail_generated_node_ids(workflow, tail_node))
    node_ids -= preserve_node_ids or set()
    if not node_ids:
        return []
    session.execute(
        delete(WorkflowEdge).where(
            (WorkflowEdge.workflow_id == workflow.id)
            & ((WorkflowEdge.source_node_id.in_(node_ids)) | (WorkflowEdge.target_node_id.in_(node_ids)))
        )
    )
    session.execute(delete(WorkflowNodeRun).where(WorkflowNodeRun.node_id.in_(node_ids)))
    for node in workflow.nodes:
        if node.id in node_ids:
            session.delete(node)
    workflow.updated_at = now_utc()
    session.flush()
    return sorted(node_ids)


def _selected_plan_items(
    plan: TailSplitPlan,
    *,
    item_ids: list[str] | None,
    items: list[TailSplitPlanItemSelection] | None = None,
) -> list[TailSplitPlanItem]:
    if items:
        instruction_by_id: dict[str, str] = {}
        for item in items:
            item_id = item.id.strip()
            if not item_id:
                continue
            instruction = (item.instruction or "").strip()
            if not instruction:
                raise BusinessValidationError("生图指令不能为空")
            instruction_by_id[item_id] = instruction
        if not instruction_by_id:
            raise BusinessValidationError("请至少保留一个拆分项")
        selected_id_set = set(instruction_by_id)
        selected_items = [
            item.model_copy(update={"instruction": instruction_by_id[item.id]})
            for item in plan.items
            if item.id in selected_id_set
        ]
        if len(selected_items) != len(selected_id_set):
            raise BusinessValidationError("所选拆分项不存在")
        return selected_items
    if item_ids is None:
        return list(plan.items)
    deduplicated_ids = list(dict.fromkeys(item_id.strip() for item_id in item_ids if item_id.strip()))
    if not deduplicated_ids:
        raise BusinessValidationError("请至少保留一个拆分项")
    selected_id_set = set(deduplicated_ids)
    selected_items = [item for item in plan.items if item.id in selected_id_set]
    if not selected_items:
        raise BusinessValidationError("所选拆分项不存在")
    if len(selected_items) != len(selected_id_set):
        raise BusinessValidationError("所选拆分项不存在")
    return selected_items


def _image_node_base_config(
    *,
    tail_resource_group_id: str | None,
    image_generation_config: TailSplitPlanImageGenerationConfig | None,
) -> dict[str, Any]:
    config: dict[str, Any] = {
        "size": inspiration_workflow_graph.DEFAULT_IMAGE_SIZE,
        "resource_group_id": tail_resource_group_id,
        "generation_config_mode": "auto",
        "generation_config_id": None,
    }
    if image_generation_config is not None:
        if image_generation_config.size is not None:
            config["size"] = image_generation_config.size
        if image_generation_config.resource_group_id is not None:
            config["resource_group_id"] = image_generation_config.resource_group_id.strip() or None
        mode = (image_generation_config.generation_config_mode or config["generation_config_mode"]).strip().lower()
        generation_config_id = (image_generation_config.generation_config_id or "").strip() or None
        if mode == "manual" or generation_config_id is not None:
            raise BusinessValidationError("生成入口只能选择供应商生成分组")
        if mode != "auto":
            raise BusinessValidationError("生图生成配置模式必须是 auto")
        if image_generation_config.tool_options is not None:
            config["tool_options"] = image_generation_config.tool_options
    try:
        config["size"] = image_size_from_config(config) or inspiration_workflow_graph.DEFAULT_IMAGE_SIZE
    except ValueError as exc:
        raise BusinessValidationError(str(exc)) from exc
    if "tool_options" in config:
        raw_tool_options = config.get("tool_options")
        config["tool_options"] = normalize_image_generation_tool_options(
            raw_tool_options if isinstance(raw_tool_options, dict) else None
        )
    return config


def _public_copy_instruction(plan: TailSplitPlan) -> str:
    return (
        f"提炼适用于当前整批图片的统一约束、风格和禁忌词，供所有下游生图触发器复用。当前拆分摘要：{plan.source_summary}"
    )


def _build_public_copy_node(
    *,
    workflow: InspirationWorkflow,
    tail_node: WorkflowNode,
    plan: TailSplitPlan,
    batch_id: str,
    resource_group_id: str | None,
    position_x: int,
    position_y: int,
) -> WorkflowNode:
    return WorkflowNode(
        workflow_id=workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title=TAIL_SPLITTER_PUBLIC_COPY_TITLE,
        position_x=position_x,
        position_y=position_y,
        config_json={
            "version": 2,
            "instruction": _public_copy_instruction(plan),
            "tone": "清晰可信",
            "channel": "公共约束",
            "output_mode": "blocks",
            "resource_group_id": resource_group_id,
            "generation_config_mode": "auto",
            "generation_config_id": None,
            "generated_by": _generated_by_metadata(
                tail_node_id=tail_node.id,
                plan_id=plan.plan_id,
                batch_id=batch_id,
                role="public_copy",
            ),
        },
    )


def _build_public_reference_node(
    session: Session,
    *,
    workflow: InspirationWorkflow,
    tail_node: WorkflowNode,
    plan: TailSplitPlan,
    batch_id: str,
    position_x: int,
    position_y: int,
) -> WorkflowNode:
    incoming_context = collect_incoming_context(workflow, tail_node.id, include_transitive_inspiration_context=True)
    asset_ids = incoming_context.image_asset_ids
    config_json: dict[str, Any] = {
        "role": "reference",
        "label": TAIL_SPLITTER_PUBLIC_REFERENCE_TITLE,
        "generated_by": _generated_by_metadata(
            tail_node_id=tail_node.id,
            plan_id=plan.plan_id,
            batch_id=batch_id,
            role="public_reference",
        ),
    }
    node = WorkflowNode(
        workflow_id=workflow.id,
        node_type=WorkflowNodeType.REFERENCE_IMAGE,
        title=TAIL_SPLITTER_PUBLIC_REFERENCE_TITLE,
        position_x=position_x,
        position_y=position_y,
        config_json=config_json,
    )
    if asset_ids:
        assets = list(session.scalars(select(SourceAsset).where(SourceAsset.id.in_(asset_ids))))
        assets = [asset for asset in assets if asset.inspiration_id == workflow.inspiration_id]
        if assets:
            config_json["source_asset_ids"] = [asset.id for asset in assets]
            node.output_json = image_asset_output(
                assets,
                summary=f"公共参考图 {len(assets)} 张",
                role="reference",
                label=TAIL_SPLITTER_PUBLIC_REFERENCE_TITLE,
            )
            node.status = WorkflowNodeStatus.SUCCEEDED
            node.failure_reason = None
            node.last_run_at = now_utc()
    session.add(node)
    return node


def _resource_group_id_from_config(config_json: dict[str, Any] | None) -> str | None:
    if not isinstance(config_json, dict):
        return None
    value = config_json.get("resource_group_id")
    return value.strip() if isinstance(value, str) and value.strip() else None


def _tail_generated_node_ids(workflow: InspirationWorkflow, tail_node: WorkflowNode) -> list[str]:
    output = read_tail_splitter_output(tail_node.output_json)
    node_ids = {node_id for batch in output.applied_batches for node_id in batch.node_ids}
    for node in workflow.nodes:
        generated_by = _generated_by(node.config_json)
        if generated_by.get("tail_node_id") == tail_node.id:
            node_ids.add(node.id)
    node_ids.discard(tail_node.id)
    return list(node_ids)


def _tail_generated_public_node(
    workflow: InspirationWorkflow,
    tail_node: WorkflowNode,
    *,
    role: str,
) -> WorkflowNode | None:
    expected_type = {
        "public_copy": WorkflowNodeType.COPY_GENERATION,
        "public_reference": WorkflowNodeType.REFERENCE_IMAGE,
    }.get(role)
    if expected_type is None:
        return None
    nodes_by_id = {node.id: node for node in workflow.nodes}
    output = read_tail_splitter_output(tail_node.output_json)
    for batch in reversed(output.applied_batches):
        for node_id in batch.node_ids:
            node = nodes_by_id.get(node_id)
            if (
                node is not None
                and node.node_type == expected_type
                and _generated_by_matches(node, tail_node_id=tail_node.id, role=role)
            ):
                return node
    candidates = [
        node
        for node in workflow.nodes
        if node.node_type == expected_type and _generated_by_matches(node, tail_node_id=tail_node.id, role=role)
    ]
    return sorted(candidates, key=lambda node: node.created_at, reverse=True)[0] if candidates else None


def _get_preserved_node_or_none(
    session: Session,
    *,
    node_id: str | None,
    workflow_id: str,
    node_type: WorkflowNodeType,
    tail_node_id: str,
    role: str,
) -> WorkflowNode | None:
    if node_id is None:
        return None
    node = session.get(WorkflowNode, node_id)
    if node is None or node.workflow_id != workflow_id or node.node_type != node_type:
        return None
    if not _generated_by_matches(node, tail_node_id=tail_node_id, role=role):
        return None
    return node


def _generated_by_matches(node: WorkflowNode, *, tail_node_id: str, role: str) -> bool:
    generated_by = _generated_by(node.config_json)
    return generated_by.get("tail_node_id") == tail_node_id and generated_by.get("role") == role


def _generated_by_metadata(
    *,
    tail_node_id: str,
    plan_id: str,
    batch_id: str,
    role: str,
    item_id: str | None = None,
) -> dict[str, Any]:
    metadata: dict[str, Any] = {
        "tail_node_id": tail_node_id,
        "plan_id": plan_id,
        "batch_id": batch_id,
        "role": role,
    }
    if item_id is not None:
        metadata["item_id"] = item_id
    return metadata


def _generated_by(config_json: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(config_json, dict):
        return {}
    generated_by = config_json.get("generated_by")
    return generated_by if isinstance(generated_by, dict) else {}
