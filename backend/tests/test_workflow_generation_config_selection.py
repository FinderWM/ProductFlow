from __future__ import annotations

import pytest
from helpers import _make_demo_image_bytes
from sqlalchemy.orm import Session

from inspiration_one_backend.application.contracts import PosterGenerationInput
from inspiration_one_backend.application.inspiration_workflow.artifacts import copy_node_output
from inspiration_one_backend.application.inspiration_workflow.image_generation import execute_workflow_image_generation
from inspiration_one_backend.application.inspiration_workflow.tail_splitter import TailSplitPlanImageGenerationConfig
from inspiration_one_backend.application.inspiration_workflow_dependencies import WorkflowExecutionDependencies
from inspiration_one_backend.application.inspiration_workflows import (
    apply_tail_split_plan,
    get_or_create_inspiration_workflow,
    run_inspiration_workflow,
    update_workflow_node,
)
from inspiration_one_backend.application.use_cases import create_inspiration
from inspiration_one_backend.domain.enums import CopyStatus, WorkflowNodeStatus, WorkflowNodeType, WorkflowRunStatus
from inspiration_one_backend.domain.errors import BusinessValidationError
from inspiration_one_backend.infrastructure.db.models import (
    DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    CopySet,
    GenerationConfig,
    WorkflowEdge,
    WorkflowNode,
)
from inspiration_one_backend.infrastructure.provider_config import (
    IMAGE_PURPOSE,
    TEXT_PURPOSE,
    add_generation_config,
    add_generation_resource_group,
)


def _add_mock_generation_config(
    session: Session,
    *,
    purpose: str,
    name: str,
    resource_group_id: str = DEFAULT_GENERATION_RESOURCE_GROUP_ID,
) -> GenerationConfig:
    return add_generation_config(
        session,
        resource_group_id=resource_group_id,
        name=name,
        purpose=purpose,
        provider_kind="mock",
        provider_profile_id=None,
        model_settings=(
            {"brief_model": "mock-brief", "copy_model": "mock-copy"}
            if purpose == TEXT_PURPOSE
            else {"model": "mock-image"}
        ),
        config={},
        priority=1000,
        max_concurrency=4,
    )


def _create_image_workflow(session: Session, *, name: str = "手动配置图片工作流"):
    inspiration = create_inspiration(
        session,
        name=name,
        category=None,
        price=None,
        source_note=None,
        image_bytes=_make_demo_image_bytes(),
        filename=f"{name}.png",
        content_type="image/png",
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        actor_is_admin=True,
    )
    return inspiration, get_or_create_inspiration_workflow(session, inspiration.id)


def _create_tail_workflow(session: Session):
    inspiration = create_inspiration(
        session,
        name="手动配置尾巴工作流",
        category=None,
        price=None,
        source_note=None,
        image_bytes=None,
        filename=None,
        content_type=None,
        initial_workflow_entry="tail",
        entry_text="免安装、收纳整洁、细节材质、不同场景摆放。",
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        actor_is_admin=True,
    )
    return inspiration, get_or_create_inspiration_workflow(session, inspiration.id)


def _node(workflow, node_type: WorkflowNodeType):
    return next(node for node in workflow.nodes if node.node_type == node_type)


class _FastPosterRenderer:
    def render(self, *_args, **_kwargs) -> bytes:
        return _make_demo_image_bytes()


class _CapturingPosterRenderer:
    def __init__(self, captured_inputs: list[PosterGenerationInput]) -> None:
        self._captured_inputs = captured_inputs

    def render(self, payload: PosterGenerationInput, *_args, **_kwargs) -> bytes:
        self._captured_inputs.append(payload)
        return _make_demo_image_bytes()


def _fast_workflow_dependencies() -> WorkflowExecutionDependencies:
    return WorkflowExecutionDependencies(poster_renderer_factory=lambda _font_path: _FastPosterRenderer())


def _capturing_workflow_dependencies(captured_inputs: list[PosterGenerationInput]) -> WorkflowExecutionDependencies:
    return WorkflowExecutionDependencies(
        poster_renderer_factory=lambda _font_path: _CapturingPosterRenderer(captured_inputs)
    )


def _copy_set_with_text(session: Session, *, inspiration_id: str, summary: str, text: str) -> CopySet:
    payload = {
        "version": 2,
        "purpose": summary,
        "summary": summary,
        "content": {
            "kind": "blocks",
            "blocks": [{"id": "main", "role": "body", "label": "正文", "text": text}],
        },
    }
    copy_set = CopySet(
        inspiration_id=inspiration_id,
        creative_brief_id=None,
        status=CopyStatus.DRAFT,
        structured_payload=payload,
        model_structured_payload=payload,
        provider_name="test",
        model_name="test",
        prompt_version="v1",
    )
    session.add(copy_set)
    session.flush()
    return copy_set


def _fill_copy_node(node: WorkflowNode, copy_set: CopySet) -> None:
    node.output_json = copy_node_output(copy_set, creative_brief_id=None)
    node.status = WorkflowNodeStatus.SUCCEEDED
    node.failure_reason = None


def test_workflow_copy_generation_manual_text_config_is_used(db_session: Session) -> None:
    text_config = _add_mock_generation_config(db_session, purpose=TEXT_PURPOSE, name="指定文案配置")
    inspiration, workflow = _create_image_workflow(db_session)
    copy_node = _node(workflow, WorkflowNodeType.COPY_GENERATION)
    workflow = update_workflow_node(
        db_session,
        node_id=copy_node.id,
        title=None,
        position_x=None,
        position_y=None,
        config_json={
            **copy_node.config_json,
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "generation_config_mode": "manual",
            "generation_config_id": text_config.id,
        },
    )
    copy_node = _node(workflow, WorkflowNodeType.COPY_GENERATION)

    workflow = run_inspiration_workflow(db_session, inspiration_id=inspiration.id, start_node_id=copy_node.id)
    copy_node = _node(workflow, WorkflowNodeType.COPY_GENERATION)

    assert copy_node.output_json["generation_config_id"] == text_config.id
    assert copy_node.output_json["resource_group_id"] == DEFAULT_GENERATION_RESOURCE_GROUP_ID


def test_workflow_tail_splitter_manual_text_config_is_used(db_session: Session) -> None:
    text_config = _add_mock_generation_config(db_session, purpose=TEXT_PURPOSE, name="指定尾巴文案配置")
    inspiration, workflow = _create_tail_workflow(db_session)
    tail_node = _node(workflow, WorkflowNodeType.TAIL_SPLITTER)
    workflow = update_workflow_node(
        db_session,
        node_id=tail_node.id,
        title=None,
        position_x=None,
        position_y=None,
        config_json={
            **tail_node.config_json,
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "generation_config_mode": "manual",
            "generation_config_id": text_config.id,
        },
    )
    tail_node = _node(workflow, WorkflowNodeType.TAIL_SPLITTER)

    workflow = run_inspiration_workflow(db_session, inspiration_id=inspiration.id, start_node_id=tail_node.id)
    tail_node = _node(workflow, WorkflowNodeType.TAIL_SPLITTER)

    assert tail_node.output_json["generation_config_id"] == text_config.id
    assert tail_node.output_json["resource_group_id"] == DEFAULT_GENERATION_RESOURCE_GROUP_ID
    assert next(run for run in workflow.runs if run.status == WorkflowRunStatus.WAITING_CONFIRMATION)


def test_workflow_image_generation_manual_image_config_is_used(db_session: Session) -> None:
    image_config = _add_mock_generation_config(db_session, purpose=IMAGE_PURPOSE, name="指定图片配置")
    inspiration, workflow = _create_image_workflow(db_session)
    image_node = _node(workflow, WorkflowNodeType.IMAGE_GENERATION)
    workflow = update_workflow_node(
        db_session,
        node_id=image_node.id,
        title=None,
        position_x=None,
        position_y=None,
        config_json={
            **image_node.config_json,
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "generation_config_mode": "manual",
            "generation_config_id": image_config.id,
        },
    )
    image_node = _node(workflow, WorkflowNodeType.IMAGE_GENERATION)

    output = execute_workflow_image_generation(
        db_session,
        workflow=workflow,
        node=image_node,
        dependencies=_fast_workflow_dependencies(),
    )

    assert output["generation_config_id"] == image_config.id
    assert output["resource_group_id"] == DEFAULT_GENERATION_RESOURCE_GROUP_ID


def test_workflow_manual_config_rejects_wrong_purpose_and_group(db_session: Session) -> None:
    text_config = _add_mock_generation_config(db_session, purpose=TEXT_PURPOSE, name="文案配置")
    image_config = _add_mock_generation_config(db_session, purpose=IMAGE_PURPOSE, name="图片配置")
    other_group = add_generation_resource_group(db_session, key="other-manual", name="其它手动分组")
    other_text_config = _add_mock_generation_config(
        db_session,
        purpose=TEXT_PURPOSE,
        name="其它分组文案配置",
        resource_group_id=other_group.id,
    )
    inspiration, workflow = _create_image_workflow(db_session, name="手动配置错误工作流")
    copy_node = _node(workflow, WorkflowNodeType.COPY_GENERATION)

    workflow = update_workflow_node(
        db_session,
        node_id=copy_node.id,
        title=None,
        position_x=None,
        position_y=None,
        config_json={
            **copy_node.config_json,
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "generation_config_mode": "manual",
            "generation_config_id": image_config.id,
        },
    )
    copy_node = _node(workflow, WorkflowNodeType.COPY_GENERATION)
    with pytest.raises(BusinessValidationError, match="文案节点只能使用文案生成配置"):
        run_inspiration_workflow(db_session, inspiration_id=inspiration.id, start_node_id=copy_node.id)

    image_inspiration, image_workflow = _create_image_workflow(db_session, name="手动配置图片错误工作流")
    image_node = _node(image_workflow, WorkflowNodeType.IMAGE_GENERATION)
    workflow = update_workflow_node(
        db_session,
        node_id=image_node.id,
        title=None,
        position_x=None,
        position_y=None,
        config_json={
            **image_node.config_json,
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "generation_config_mode": "manual",
            "generation_config_id": text_config.id,
        },
    )
    image_node = _node(workflow, WorkflowNodeType.IMAGE_GENERATION)
    with pytest.raises(BusinessValidationError, match="生图节点只能使用图片生成配置"):
        run_inspiration_workflow(db_session, inspiration_id=image_inspiration.id, start_node_id=image_node.id)

    group_inspiration, group_workflow = _create_image_workflow(db_session, name="手动配置分组错误工作流")
    copy_node = _node(group_workflow, WorkflowNodeType.COPY_GENERATION)
    workflow = update_workflow_node(
        db_session,
        node_id=copy_node.id,
        title=None,
        position_x=None,
        position_y=None,
        config_json={
            **copy_node.config_json,
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "generation_config_mode": "manual",
            "generation_config_id": other_text_config.id,
        },
    )
    copy_node = _node(workflow, WorkflowNodeType.COPY_GENERATION)
    with pytest.raises(BusinessValidationError, match="手动指定的生成配置不属于当前供应商生成分组"):
        run_inspiration_workflow(db_session, inspiration_id=group_inspiration.id, start_node_id=copy_node.id)


def test_tail_split_plan_apply_preserves_manual_image_generation_config(db_session: Session) -> None:
    text_config = _add_mock_generation_config(db_session, purpose=TEXT_PURPOSE, name="尾巴拆分文案配置")
    image_config = _add_mock_generation_config(db_session, purpose=IMAGE_PURPOSE, name="尾巴批量生图配置")
    inspiration, workflow = _create_tail_workflow(db_session)
    tail_node = _node(workflow, WorkflowNodeType.TAIL_SPLITTER)
    workflow = update_workflow_node(
        db_session,
        node_id=tail_node.id,
        title=None,
        position_x=None,
        position_y=None,
        config_json={
            **tail_node.config_json,
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "generation_config_mode": "manual",
            "generation_config_id": text_config.id,
        },
    )
    tail_node = _node(workflow, WorkflowNodeType.TAIL_SPLITTER)
    workflow = run_inspiration_workflow(db_session, inspiration_id=inspiration.id, start_node_id=tail_node.id)
    tail_node = _node(workflow, WorkflowNodeType.TAIL_SPLITTER)
    plan = tail_node.output_json["latest_plan"]

    workflow = apply_tail_split_plan(
        db_session,
        node_id=tail_node.id,
        plan_id=plan["plan_id"],
        item_ids=[plan["items"][0]["id"]],
        image_generation_config=TailSplitPlanImageGenerationConfig(
            resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            generation_config_mode="manual",
            generation_config_id=image_config.id,
        ),
    )
    generated_image_nodes = [
        node
        for node in workflow.nodes
        if node.node_type == WorkflowNodeType.IMAGE_GENERATION
        and node.config_json.get("generated_by", {}).get("tail_node_id") == tail_node.id
    ]

    assert generated_image_nodes
    assert all(node.config_json["generation_config_mode"] == "manual" for node in generated_image_nodes)
    assert all(node.config_json["generation_config_id"] == image_config.id for node in generated_image_nodes)


def test_tail_split_image_generation_prompt_prioritizes_public_and_manual_context(db_session: Session) -> None:
    inspiration, workflow = _create_tail_workflow(db_session)
    tail_node = _node(workflow, WorkflowNodeType.TAIL_SPLITTER)
    workflow = run_inspiration_workflow(db_session, inspiration_id=inspiration.id, start_node_id=tail_node.id)
    tail_node = _node(workflow, WorkflowNodeType.TAIL_SPLITTER)
    plan = tail_node.output_json["latest_plan"]

    workflow = apply_tail_split_plan(
        db_session,
        node_id=tail_node.id,
        plan_id=plan["plan_id"],
        item_ids=[plan["items"][0]["id"]],
        image_generation_config=TailSplitPlanImageGenerationConfig(
            resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        ),
    )
    image_node = next(
        node
        for node in workflow.nodes
        if node.node_type == WorkflowNodeType.IMAGE_GENERATION
        and node.config_json.get("generated_by", {}).get("tail_node_id") == tail_node.id
    )
    public_copy_node = next(
        node
        for node in workflow.nodes
        if node.node_type == WorkflowNodeType.COPY_GENERATION
        and node.config_json.get("generated_by", {}).get("role") == "public_copy"
    )
    public_copy_set = _copy_set_with_text(
        db_session,
        inspiration_id=inspiration.id,
        summary="公共风格约束",
        text="整批图片必须保持简洁 PPT 风格，禁止补充未要求的业务分支。",
    )
    _fill_copy_node(public_copy_node, public_copy_set)

    manual_copy_node = WorkflowNode(
        workflow_id=workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="手动补充资料",
        position_x=image_node.position_x - 200,
        position_y=image_node.position_y + 120,
        config_json={},
    )
    db_session.add(manual_copy_node)
    db_session.flush()
    manual_copy_set = _copy_set_with_text(
        db_session,
        inspiration_id=inspiration.id,
        summary="手动节点关键信息",
        text="手动节点只提供当前页可用的两张参考图含义。",
    )
    _fill_copy_node(manual_copy_node, manual_copy_set)
    db_session.add(
        WorkflowEdge(
            workflow_id=workflow.id,
            source_node_id=manual_copy_node.id,
            target_node_id=image_node.id,
            source_handle="output",
            target_handle="input",
        )
    )
    db_session.flush()
    db_session.expire(workflow, ["nodes", "edges"])
    workflow = get_or_create_inspiration_workflow(db_session, inspiration.id)
    image_node = next(node for node in workflow.nodes if node.id == image_node.id)

    captured_inputs: list[PosterGenerationInput] = []
    execute_workflow_image_generation(
        db_session,
        workflow=workflow,
        node=image_node,
        dependencies=_capturing_workflow_dependencies(captured_inputs),
    )

    render_input = captured_inputs[0]
    instruction = render_input.instruction or ""
    assert "P0 当前生图节点描述" in instruction
    assert "P1 公共约束" in instruction
    assert "P2 用户手动直连辅助信息" in instruction
    assert "P3 自动上游/全局资料" in instruction
    assert instruction.index("P1 公共约束：") < instruction.index("P2 用户手动直连辅助信息：")
    assert instruction.index("P2 用户手动直连辅助信息：") < instruction.index("P3 自动上游/全局资料（")
    assert "公共风格约束" in instruction
    assert "手动节点关键信息" in instruction
    assert "免安装" in instruction
    assert "上游文本上下文：" not in instruction
    assert render_input.source_note is None
