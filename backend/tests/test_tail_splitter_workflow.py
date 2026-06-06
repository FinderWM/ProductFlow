from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from helpers import _execute_workflow_queue_inline, _login, _wait_for_workflow_run

from productflow_backend.domain.enums import WorkflowNodeStatus, WorkflowNodeType, WorkflowRunStatus
from productflow_backend.domain.workflow_rules import WorkflowRuleNode, should_execute_missing_upstream
from productflow_backend.infrastructure.db.models import DEFAULT_GENERATION_RESOURCE_GROUP_ID


@pytest.fixture(autouse=True)
def _execute_workflow_queue_inline_fixture(monkeypatch: pytest.MonkeyPatch) -> None:
    _execute_workflow_queue_inline(monkeypatch)


def _workflow_node(payload: dict, node_type: str) -> dict:
    return next(node for node in payload["nodes"] if node["node_type"] == node_type)


def _tail_generated_by(node) -> dict:
    generated_by = node.config_json.get("generated_by") if isinstance(node.config_json, dict) else None
    return generated_by if isinstance(generated_by, dict) else {}


def _tail_generated_node(workflow, *, tail_node_id: str, role: str):
    def matches_role(node) -> bool:
        generated_by = _tail_generated_by(node)
        return generated_by.get("tail_node_id") == tail_node_id and generated_by.get("role") == role

    return next(node for node in workflow.nodes if matches_role(node))


def test_mock_tail_splitter_treats_max_items_as_upper_bound() -> None:
    from productflow_backend.application.contracts import TailSplitPlanInput
    from productflow_backend.infrastructure.text.mock_provider import MockTextProvider

    draft, _model = MockTextProvider().generate_tail_split_plan(
        TailSplitPlanInput(
            product_name="简短商品",
            source_text="只需要一张主图",
            description="",
            max_items=4,
        )
    )

    assert len(draft.items) == 1


def test_product_creation_supports_copy_and_tail_entries_without_image(configured_env: Path) -> None:
    from productflow_backend.presentation.api import create_app

    del configured_env
    app = create_app()
    client = TestClient(app)
    _login(client)

    copy_created = client.post(
        "/api/products",
        data={
            "name": "文案入口商品",
            "initial_workflow_entry": "copy",
            "entry_text": "强调免安装、整洁收纳和家居场景适配。",
        },
    )
    assert copy_created.status_code == 201
    copy_product_id = copy_created.json()["id"]

    copy_workflow = client.get(f"/api/products/{copy_product_id}/workflow")
    assert copy_workflow.status_code == 200
    copy_payload = copy_workflow.json()
    assert {node["node_type"] for node in copy_payload["nodes"]} == {
        "product_context",
        "copy_generation",
    }
    copy_context_node = _workflow_node(copy_payload, "product_context")
    assert copy_context_node["config_json"]["name"] == "文案入口商品"
    assert copy_context_node["config_json"]["entry_type"] == "copy"
    assert copy_context_node["config_json"]["long_text"] == "强调免安装、整洁收纳和家居场景适配。"
    copy_node = _workflow_node(copy_payload, "copy_generation")
    assert copy_node["config_json"]["source_note"] == "强调免安装、整洁收纳和家居场景适配。"
    assert "强调免安装" in copy_node["config_json"]["instruction"]
    assert [(edge["source_node_id"], edge["target_node_id"]) for edge in copy_payload["edges"]]

    tail_created = client.post(
        "/api/products",
        data={
            "name": "尾巴入口商品",
            "initial_workflow_entry": "tail",
            "entry_text": "免安装、收纳整洁、细节材质、不同场景摆放。",
        },
    )
    assert tail_created.status_code == 201
    tail_product_id = tail_created.json()["id"]

    tail_workflow = client.get(f"/api/products/{tail_product_id}/workflow")
    assert tail_workflow.status_code == 200
    tail_payload = tail_workflow.json()
    assert {node["node_type"] for node in tail_payload["nodes"]} == {
        "product_context",
        "tail_splitter",
    }
    tail_context_node = _workflow_node(tail_payload, "product_context")
    assert tail_context_node["config_json"]["name"] == "尾巴入口商品"
    assert tail_context_node["config_json"]["entry_type"] == "tail"
    assert tail_context_node["config_json"]["long_text"] == "免安装、收纳整洁、细节材质、不同场景摆放。"
    tail_node = _workflow_node(tail_payload, "tail_splitter")
    assert tail_node["config_json"]["source_text"] == "免安装、收纳整洁、细节材质、不同场景摆放。"
    assert len(tail_payload["edges"]) == 1

    blank_created = client.post(
        "/api/products",
        data={"name": "空白入口灵感", "initial_workflow_entry": "blank"},
    )
    assert blank_created.status_code == 201
    blank_product_id = blank_created.json()["id"]

    blank_workflow = client.get(f"/api/products/{blank_product_id}/workflow")
    assert blank_workflow.status_code == 200
    blank_payload = blank_workflow.json()
    assert [node["node_type"] for node in blank_payload["nodes"]] == ["product_context"]
    assert blank_payload["nodes"][0]["title"] == "灵感"
    assert blank_payload["nodes"][0]["config_json"]["name"] == "空白入口灵感"
    assert blank_payload["nodes"][0]["config_json"]["entry_type"] == "blank"
    assert blank_payload["edges"] == []

    image_missing = client.post(
        "/api/products",
        data={"name": "图片入口商品", "initial_workflow_entry": "image"},
    )
    assert image_missing.status_code == 400
    assert image_missing.json()["detail"] == "请先上传灵感图"

    copy_missing_text = client.post(
        "/api/products",
        data={"name": "缺内容文案入口", "initial_workflow_entry": "copy"},
    )
    assert copy_missing_text.status_code == 400
    assert copy_missing_text.json()["detail"] == "入口内容不能为空"

    tail_missing_text = client.post(
        "/api/products",
        data={"name": "缺内容尾巴入口", "initial_workflow_entry": "tail"},
    )
    assert tail_missing_text.status_code == 400
    assert tail_missing_text.json()["detail"] == "入口内容不能为空"


def test_tail_splitter_max_items_uses_runtime_config_limit(configured_env: Path) -> None:
    from productflow_backend.presentation.api import create_app

    del configured_env
    app = create_app()
    client = TestClient(app)
    _login(client)

    created = client.post(
        "/api/products",
        data={
            "name": "尾巴拆分上限商品",
            "initial_workflow_entry": "tail",
            "entry_text": "主打免安装、收纳整洁、细节材质、不同场景摆放。",
        },
    )
    assert created.status_code == 201
    product_id = created.json()["id"]
    workflow_payload = client.get(f"/api/products/{product_id}/workflow").json()
    tail_node = _workflow_node(workflow_payload, "tail_splitter")

    legacy_nullable_config = client.patch(
        f"/api/workflow-nodes/{tail_node['id']}",
        json={
            "config_json": {
                "source_text": None,
                "description": None,
                "max_items": None,
                "generation_config_mode": None,
                "generation_config_id": "",
            }
        },
    )
    assert legacy_nullable_config.status_code == 200
    normalized_tail_node = _workflow_node(legacy_nullable_config.json(), "tail_splitter")
    assert normalized_tail_node["config_json"]["source_text"] == ""
    assert normalized_tail_node["config_json"]["description"] == ""
    assert normalized_tail_node["config_json"]["max_items"] == 8
    assert normalized_tail_node["config_json"]["generation_config_mode"] == "auto"
    assert normalized_tail_node["config_json"]["generation_config_id"] is None

    accepted_default_limit = client.patch(
        f"/api/workflow-nodes/{tail_node['id']}",
        json={"config_json": {"max_items": 36}},
    )
    assert accepted_default_limit.status_code == 200

    rejected_default_limit = client.patch(
        f"/api/workflow-nodes/{tail_node['id']}",
        json={"config_json": {"max_items": 37}},
    )
    assert rejected_default_limit.status_code == 400
    assert rejected_default_limit.json()["detail"] == "最大拆分数不能超过 36"

    rejected_invalid_number = client.patch(
        f"/api/workflow-nodes/{tail_node['id']}",
        json={"config_json": {"max_items": "abc"}},
    )
    assert rejected_invalid_number.status_code == 400
    assert rejected_invalid_number.json()["detail"] == "最大拆分数必须是整数"

    rejected_invalid_mode = client.patch(
        f"/api/workflow-nodes/{tail_node['id']}",
        json={"config_json": {"generation_config_mode": "sometimes"}},
    )
    assert rejected_invalid_mode.status_code == 400
    assert rejected_invalid_mode.json()["detail"] == "生成配置模式必须是 auto 或 manual"

    updated_limit = client.patch(
        "/api/settings",
        json={"values": {"generation_tail_splitter_max_items": 48}},
    )
    assert updated_limit.status_code == 200

    accepted_configured_limit = client.patch(
        f"/api/workflow-nodes/{tail_node['id']}",
        json={"config_json": {"max_items": 48}},
    )
    assert accepted_configured_limit.status_code == 200

    rejected_configured_limit = client.patch(
        f"/api/workflow-nodes/{tail_node['id']}",
        json={"config_json": {"max_items": 49}},
    )
    assert rejected_configured_limit.status_code == 400
    assert rejected_configured_limit.json()["detail"] == "最大拆分数不能超过 48"


def test_tail_splitter_run_persists_pending_plan_and_apply_selected_items(configured_env: Path) -> None:
    from productflow_backend.presentation.api import create_app

    del configured_env
    app = create_app()
    client = TestClient(app)
    _login(client)

    created = client.post(
        "/api/products",
        data={
            "name": "尾巴拆分商品",
            "initial_workflow_entry": "tail",
            "entry_text": "主打免安装、收纳整洁、细节材质、不同场景摆放。",
        },
    )
    assert created.status_code == 201
    product_id = created.json()["id"]

    workflow_payload = client.get(f"/api/products/{product_id}/workflow").json()
    tail_node = _workflow_node(workflow_payload, "tail_splitter")

    updated = client.patch(
        f"/api/workflow-nodes/{tail_node['id']}",
        json={
            "config_json": {
                "source_text": "主打免安装、收纳整洁、细节材质、不同场景摆放。",
                "description": "拆成适合电商图片的独立方向。",
                "max_items": 4,
                "generation_config_mode": "auto",
                "generation_config_id": None,
            }
        },
    )
    assert updated.status_code == 200

    run_response = client.post(
        f"/api/products/{product_id}/workflow/run",
        json={"start_node_id": tail_node["id"]},
    )
    assert run_response.status_code == 200

    finished = _wait_for_workflow_run(client, product_id, status="waiting_confirmation")
    assert finished["runs"][0]["is_cancelable"] is True
    assert finished["runs"][0]["queue_active_count"] == 0
    tail_node_after_run = next(node for node in finished["nodes"] if node["id"] == tail_node["id"])
    latest_plan = tail_node_after_run["output_json"]["latest_plan"]
    assert latest_plan["status"] == "pending"
    assert len(latest_plan["items"]) == 4
    assert not any(
        isinstance(node.get("config_json"), dict)
        and isinstance(node["config_json"].get("generated_by"), dict)
        and node["config_json"]["generated_by"].get("tail_node_id") == tail_node["id"]
        for node in finished["nodes"]
    )

    selected_items = [
        {"id": latest_plan["items"][0]["id"], "instruction": "编辑后的第一条生图指令"},
        {"id": latest_plan["items"][1]["id"], "instruction": latest_plan["items"][1]["instruction"]},
    ]
    selected_item_ids = [item["id"] for item in selected_items]
    applied = client.post(
        f"/api/workflow-nodes/{tail_node['id']}/tail-split-plan/apply",
        json={
            "plan_id": latest_plan["plan_id"],
            "item_ids": selected_item_ids,
            "items": selected_items,
            "image_generation_config": {
                "size": "1536x1024",
                "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
                "tool_options": {"quality": "high", "background": "transparent", "n": 2},
            },
            "position_x": tail_node["position_x"] + 80,
            "position_y": tail_node["position_y"],
        },
    )
    assert applied.status_code == 200
    applied_payload = applied.json()
    latest_run_after_apply = applied_payload["runs"][0]
    assert latest_run_after_apply["status"] == "succeeded"
    assert latest_run_after_apply["is_cancelable"] is False
    assert "pending_tail_confirmations" not in latest_run_after_apply["progress_metadata"]

    tail_node_after_apply = next(node for node in applied_payload["nodes"] if node["id"] == tail_node["id"])
    applied_output = tail_node_after_apply["output_json"]
    assert applied_output["latest_plan"]["status"] == "applied"
    assert len(applied_output["applied_batches"]) == 1

    batch = applied_output["applied_batches"][0]
    assert batch["item_ids"] == selected_item_ids
    generated_nodes = [
        node
        for node in applied_payload["nodes"]
        if isinstance(node.get("config_json"), dict)
        and isinstance(node["config_json"].get("generated_by"), dict)
        and node["config_json"]["generated_by"].get("batch_id") == batch["batch_id"]
    ]
    assert {node["config_json"]["generated_by"]["role"] for node in generated_nodes} == {
        "public_copy",
        "public_reference",
        "image_trigger",
        "output_reference",
    }
    assert sum(1 for node in generated_nodes if node["node_type"] == "image_generation") == 2
    assert sum(1 for node in generated_nodes if node["node_type"] == "reference_image") == 3
    assert not any(node["status"] in {"queued", "running"} for node in generated_nodes)

    generated_node_ids = {node["id"] for node in generated_nodes}
    generated_edges = [
        edge
        for edge in applied_payload["edges"]
        if edge["source_node_id"] in generated_node_ids
        or edge["target_node_id"] in generated_node_ids
        or edge["source_node_id"] == tail_node["id"]
    ]
    assert len(generated_edges) == 8
    public_node_ids = {
        node["id"]
        for node in generated_nodes
        if node["config_json"]["generated_by"]["role"] in {"public_copy", "public_reference"}
    }
    assert not any(
        edge["source_node_id"] == tail_node["id"] and edge["target_node_id"] in public_node_ids
        for edge in generated_edges
    )
    edited_image_node = next(
        node
        for node in generated_nodes
        if node["node_type"] == "image_generation"
        and node["config_json"]["generated_by"].get("item_id") == selected_items[0]["id"]
    )
    assert edited_image_node["config_json"]["instruction"] == "编辑后的第一条生图指令"
    generated_image_nodes = [node for node in generated_nodes if node["node_type"] == "image_generation"]
    assert all(node["config_json"]["size"] == "1536x1024" for node in generated_image_nodes)
    assert all(
        node["config_json"]["resource_group_id"] == DEFAULT_GENERATION_RESOURCE_GROUP_ID
        for node in generated_image_nodes
    )
    assert all(node["config_json"]["generation_config_mode"] == "auto" for node in generated_image_nodes)
    assert all(node["config_json"]["generation_config_id"] is None for node in generated_image_nodes)
    assert all(node["config_json"]["tool_options"] == {"quality": "high"} for node in generated_image_nodes)

    second_apply = client.post(
        f"/api/workflow-nodes/{tail_node['id']}/tail-split-plan/apply",
        json={
            "plan_id": latest_plan["plan_id"],
            "item_ids": selected_item_ids,
            "position_x": tail_node["position_x"] + 80,
            "position_y": tail_node["position_y"],
        },
    )
    assert second_apply.status_code == 400
    assert "已应用" in second_apply.json()["detail"]


def test_full_workflow_run_resplits_tail_branch_and_keeps_manual_nodes(db_session) -> None:
    from productflow_backend.application.product_workflows import (
        apply_tail_split_plan,
        create_workflow_node,
        execute_product_workflow_run,
        get_or_create_product_workflow,
        run_product_workflow,
        update_workflow_node,
    )
    from productflow_backend.application.use_cases import create_product
    from productflow_backend.domain.enums import WorkflowNodeType

    product = create_product(
        db_session,
        name="尾巴全图重拆分商品",
        category=None,
        price=None,
        source_note=None,
        image_bytes=None,
        filename=None,
        content_type=None,
        initial_workflow_entry="tail",
        entry_text="主打免安装、收纳整洁、细节材质、不同场景摆放。",
    )
    workflow = get_or_create_product_workflow(db_session, product.id)
    tail_node = next(node for node in workflow.nodes if node.node_type == WorkflowNodeType.TAIL_SPLITTER)

    workflow = update_workflow_node(
        db_session,
        node_id=tail_node.id,
        title=None,
        position_x=None,
        position_y=None,
        config_json={
            "source_text": "主打免安装、收纳整洁、细节材质、不同场景摆放。",
            "description": "拆成适合电商图片的独立方向。",
            "max_items": 4,
            "generation_config_mode": "auto",
            "generation_config_id": None,
        },
    )
    tail_node = next(node for node in workflow.nodes if node.node_type == WorkflowNodeType.TAIL_SPLITTER)

    workflow = run_product_workflow(db_session, product_id=product.id, start_node_id=tail_node.id)
    first_run = next(run for run in workflow.runs if run.status == WorkflowRunStatus.WAITING_CONFIRMATION)
    tail_node = next(node for node in workflow.nodes if node.id == tail_node.id)
    first_plan = tail_node.output_json["latest_plan"]
    assert first_plan["status"] == "pending"
    first_item_ids = [item["id"] for item in first_plan["items"][:2]]

    workflow = apply_tail_split_plan(
        db_session,
        node_id=tail_node.id,
        plan_id=first_plan["plan_id"],
        item_ids=first_item_ids,
        position_x=tail_node.position_x + 80,
        position_y=tail_node.position_y,
        enqueue=lambda run_id: execute_product_workflow_run(run_id),
    )
    db_session.expire_all()
    first_run_after_apply = db_session.get(type(first_run), first_run.id)
    assert first_run_after_apply is not None
    assert first_run_after_apply.status == WorkflowRunStatus.SUCCEEDED
    assert first_run.id in {run.id for run in workflow.runs}
    tail_node = next(node for node in workflow.nodes if node.id == tail_node.id)
    first_batch = tail_node.output_json["applied_batches"][-1]
    first_batch_node_ids = set(first_batch["node_ids"])
    first_batch_nodes = [node for node in workflow.nodes if node.id in first_batch_node_ids]
    assert not any(node.status.value in {"queued", "running"} for node in first_batch_nodes)

    workflow = create_workflow_node(
        db_session,
        product_id=product.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="手动保留节点",
        position_x=tail_node.position_x + 40,
        position_y=tail_node.position_y + 360,
        config_json={"instruction": "手动补充说明"},
    )
    manual_node_id = next(node.id for node in workflow.nodes if node.title == "手动保留节点")

    workflow = update_workflow_node(
        db_session,
        node_id=tail_node.id,
        title=None,
        position_x=None,
        position_y=None,
        config_json={
            "source_text": "补充统一风格、主卖点、使用步骤、材质特写和收纳前后对比。",
            "description": "重新拆成更适合批量生图的电商方向。",
            "max_items": 4,
            "generation_config_mode": "auto",
            "generation_config_id": None,
        },
    )

    workflow = run_product_workflow(db_session, product_id=product.id)
    node_ids_after_full_run = {node.id for node in workflow.nodes}
    assert first_batch_node_ids.issubset(node_ids_after_full_run)
    assert manual_node_id in node_ids_after_full_run

    tail_node = next(node for node in workflow.nodes if node.node_type == WorkflowNodeType.TAIL_SPLITTER)
    latest_plan = tail_node.output_json["latest_plan"]
    assert latest_plan["status"] == "pending"
    waiting_run = next(run for run in workflow.runs if run.status == WorkflowRunStatus.WAITING_CONFIRMATION)
    assert waiting_run.progress_metadata["pending_tail_confirmations"][0]["tail_node_id"] == tail_node.id

    second_item_ids = [item["id"] for item in latest_plan["items"][:2]]
    workflow = apply_tail_split_plan(
        db_session,
        node_id=tail_node.id,
        plan_id=latest_plan["plan_id"],
        item_ids=second_item_ids,
        position_x=tail_node.position_x + 80,
        position_y=tail_node.position_y,
        enqueue=lambda run_id: execute_product_workflow_run(run_id),
    )
    node_ids_after_confirm = {node.id for node in workflow.nodes}
    assert first_batch_node_ids.isdisjoint(node_ids_after_confirm)
    assert manual_node_id in node_ids_after_confirm

    tail_node = next(node for node in workflow.nodes if node.node_type == WorkflowNodeType.TAIL_SPLITTER)
    latest_plan = tail_node.output_json["latest_plan"]
    assert latest_plan["status"] == "applied"

    applied_batches = tail_node.output_json["applied_batches"]
    assert len(applied_batches) == 1
    second_batch = applied_batches[-1]
    assert second_batch["batch_id"] != first_batch["batch_id"]
    assert second_batch["plan_id"] != first_batch["plan_id"]
    assert set(second_batch["node_ids"]).issubset(node_ids_after_confirm)


def test_tail_splitter_reapply_can_reuse_previous_public_nodes(db_session) -> None:
    from productflow_backend.application.product_workflow.artifacts import copy_node_output, image_asset_output
    from productflow_backend.application.product_workflows import (
        apply_tail_split_plan,
        get_or_create_product_workflow,
        run_product_workflow,
        update_workflow_node,
    )
    from productflow_backend.application.use_cases import create_product
    from productflow_backend.domain.enums import CopyStatus, SourceAssetKind
    from productflow_backend.infrastructure.db.models import CopySet, SourceAsset

    product = create_product(
        db_session,
        name="尾巴公共节点复用商品",
        category=None,
        price=None,
        source_note=None,
        image_bytes=None,
        filename=None,
        content_type=None,
        initial_workflow_entry="tail",
        entry_text="主打免安装、收纳整洁、细节材质、不同场景摆放。",
    )
    workflow = get_or_create_product_workflow(db_session, product.id)
    tail_node = next(node for node in workflow.nodes if node.node_type == WorkflowNodeType.TAIL_SPLITTER)
    workflow = update_workflow_node(
        db_session,
        node_id=tail_node.id,
        title=None,
        position_x=None,
        position_y=None,
        config_json={
            "source_text": "主打免安装、收纳整洁、细节材质、不同场景摆放。",
            "description": "拆成适合电商图片的独立方向。",
            "max_items": 4,
            "generation_config_mode": "auto",
            "generation_config_id": None,
        },
    )
    tail_node = next(node for node in workflow.nodes if node.node_type == WorkflowNodeType.TAIL_SPLITTER)

    workflow = run_product_workflow(db_session, product_id=product.id, start_node_id=tail_node.id)
    tail_node = next(node for node in workflow.nodes if node.id == tail_node.id)
    first_plan = tail_node.output_json["latest_plan"]
    first_item_ids = [item["id"] for item in first_plan["items"][:2]]
    workflow = apply_tail_split_plan(
        db_session,
        node_id=tail_node.id,
        plan_id=first_plan["plan_id"],
        item_ids=first_item_ids,
        position_x=tail_node.position_x + 80,
        position_y=tail_node.position_y,
    )
    tail_node = next(node for node in workflow.nodes if node.id == tail_node.id)
    first_batch = tail_node.output_json["applied_batches"][-1]
    public_copy_node = _tail_generated_node(workflow, tail_node_id=tail_node.id, role="public_copy")
    public_reference_node = _tail_generated_node(workflow, tail_node_id=tail_node.id, role="public_reference")

    copy_set = CopySet(
        product_id=product.id,
        status=CopyStatus.DRAFT,
        structured_payload={
            "version": 2,
            "summary": "上一轮公共文案",
            "content": {"kind": "blocks", "blocks": [{"id": "shared", "text": "保留这一版公共约束"}]},
        },
        model_structured_payload={
            "version": 2,
            "summary": "上一轮公共文案",
            "content": {"kind": "blocks", "blocks": [{"id": "shared", "text": "保留这一版公共约束"}]},
        },
        provider_name="test",
        model_name="test",
        prompt_version="test",
    )
    reference_asset = SourceAsset(
        product_id=product.id,
        kind=SourceAssetKind.REFERENCE_IMAGE,
        original_filename="shared-reference.png",
        mime_type="image/png",
        storage_path="products/test/shared-reference.png",
    )
    db_session.add_all([copy_set, reference_asset])
    db_session.flush()
    public_copy_node.output_json = copy_node_output(copy_set, creative_brief_id=None)
    public_copy_node.status = WorkflowNodeStatus.SUCCEEDED
    public_reference_node.config_json = {
        **public_reference_node.config_json,
        "source_asset_ids": [reference_asset.id],
    }
    public_reference_node.output_json = image_asset_output(
        [reference_asset],
        summary="公共参考图 1 张",
        role="reference",
        label="公共参考图",
    )
    public_reference_node.status = WorkflowNodeStatus.SUCCEEDED
    db_session.commit()

    workflow = update_workflow_node(
        db_session,
        node_id=tail_node.id,
        title=None,
        position_x=None,
        position_y=None,
        config_json={
            "source_text": "补充统一风格、主卖点、使用步骤、材质特写和收纳前后对比。",
            "description": "重新拆成更适合批量生图的电商方向。",
            "max_items": 4,
            "generation_config_mode": "auto",
            "generation_config_id": None,
        },
    )
    workflow = run_product_workflow(db_session, product_id=product.id, start_node_id=tail_node.id)
    tail_node = next(node for node in workflow.nodes if node.id == tail_node.id)
    second_plan = tail_node.output_json["latest_plan"]
    second_item_ids = [item["id"] for item in second_plan["items"][:2]]
    workflow = apply_tail_split_plan(
        db_session,
        node_id=tail_node.id,
        plan_id=second_plan["plan_id"],
        item_ids=second_item_ids,
        position_x=tail_node.position_x + 80,
        position_y=tail_node.position_y,
        reuse_public_copy_node=True,
        reuse_public_reference_node=True,
    )

    node_ids_after_reapply = {node.id for node in workflow.nodes}
    public_node_ids = {public_copy_node.id, public_reference_node.id}
    assert public_node_ids.issubset(node_ids_after_reapply)
    assert (set(first_batch["node_ids"]) - public_node_ids).isdisjoint(node_ids_after_reapply)

    reused_public_copy_node = next(node for node in workflow.nodes if node.id == public_copy_node.id)
    reused_public_reference_node = next(node for node in workflow.nodes if node.id == public_reference_node.id)
    assert reused_public_copy_node.output_json["copy_set_id"] == copy_set.id
    assert reused_public_reference_node.output_json["source_asset_ids"] == [reference_asset.id]

    tail_node = next(node for node in workflow.nodes if node.id == tail_node.id)
    second_batch = tail_node.output_json["applied_batches"][-1]
    assert public_node_ids.issubset(set(second_batch["node_ids"]))
    assert second_batch["batch_id"] != first_batch["batch_id"]
    new_image_node_ids = {
        node.id
        for node in workflow.nodes
        if _tail_generated_by(node).get("batch_id") == second_batch["batch_id"]
        and _tail_generated_by(node).get("role") == "image_trigger"
    }
    assert len(new_image_node_ids) == 2
    assert {
        (edge.source_node_id, edge.target_node_id)
        for edge in workflow.edges
        if edge.target_node_id in new_image_node_ids and edge.source_node_id in public_node_ids
    } == {(public_copy_node.id, image_node_id) for image_node_id in new_image_node_ids} | {
        (public_reference_node.id, image_node_id) for image_node_id in new_image_node_ids
    }


def test_run_after_tail_dispatches_independent_generated_branches_in_one_wave(
    db_session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from productflow_backend.application.product_workflows import (
        apply_tail_split_plan,
        execute_product_workflow_run,
        get_or_create_product_workflow,
        run_product_workflow,
        start_product_workflow_run,
        update_workflow_node,
    )
    from productflow_backend.application.use_cases import create_product
    from productflow_backend.infrastructure.db.models import WorkflowRun

    product = create_product(
        db_session,
        name="尾巴后并发分支商品",
        category=None,
        price=None,
        source_note=None,
        image_bytes=None,
        filename=None,
        content_type=None,
        initial_workflow_entry="tail",
        entry_text="主打免安装、收纳整洁、细节材质、不同场景摆放。",
    )
    workflow = get_or_create_product_workflow(db_session, product.id)
    tail_node = next(node for node in workflow.nodes if node.node_type == WorkflowNodeType.TAIL_SPLITTER)
    workflow = update_workflow_node(
        db_session,
        node_id=tail_node.id,
        title=None,
        position_x=None,
        position_y=None,
        config_json={
            "source_text": "主打免安装、收纳整洁、细节材质、不同场景摆放。",
            "description": "拆成适合电商图片的独立方向。",
            "max_items": 4,
            "generation_config_mode": "auto",
            "generation_config_id": None,
        },
    )
    tail_node = next(node for node in workflow.nodes if node.node_type == WorkflowNodeType.TAIL_SPLITTER)

    workflow = run_product_workflow(db_session, product_id=product.id, start_node_id=tail_node.id)
    tail_node = next(node for node in workflow.nodes if node.id == tail_node.id)
    plan = tail_node.output_json["latest_plan"]
    item_ids = [item["id"] for item in plan["items"][:3]]
    workflow = apply_tail_split_plan(
        db_session,
        node_id=tail_node.id,
        plan_id=plan["plan_id"],
        item_ids=item_ids,
        position_x=tail_node.position_x + 80,
        position_y=tail_node.position_y,
        enqueue=lambda run_id: pytest.fail(f"tail apply must not enqueue run {run_id}"),
    )

    tail_node = next(node for node in workflow.nodes if node.id == tail_node.id)
    batch = tail_node.output_json["applied_batches"][-1]
    generated_nodes = [
        node
        for node in workflow.nodes
        if isinstance(node.config_json, dict)
        and node.config_json.get("generated_by", {}).get("batch_id") == batch["batch_id"]
    ]
    image_node_ids = {
        node.id for node in generated_nodes if node.config_json["generated_by"]["role"] == "image_trigger"
    }
    public_copy_node = next(
        node for node in generated_nodes if node.config_json["generated_by"]["role"] == "public_copy"
    )
    assert len(image_node_ids) == 3

    kickoff = start_product_workflow_run(
        db_session,
        product_id=product.id,
        start_node_id=tail_node.id,
        start_mode="after_node",
    )
    run = db_session.get(WorkflowRun, kickoff.run_id)
    assert run is not None
    public_copy_node_run = next(node_run for node_run in run.node_runs if node_run.node_id == public_copy_node.id)
    public_copy_node.status = WorkflowNodeStatus.SUCCEEDED
    public_copy_node_run.status = WorkflowNodeStatus.SUCCEEDED
    db_session.commit()

    dispatched_node_run_ids: list[str] = []
    monkeypatch.setattr(
        "productflow_backend.application.product_workflow.execution.enqueue_workflow_node_run",
        lambda node_run_id: dispatched_node_run_ids.append(node_run_id),
    )

    execute_product_workflow_run(kickoff.run_id)

    db_session.expire_all()
    run = db_session.get(WorkflowRun, kickoff.run_id)
    assert run is not None
    dispatched_node_ids = {node_run.node_id for node_run in run.node_runs if node_run.id in dispatched_node_run_ids}
    assert image_node_ids.issubset(dispatched_node_ids)


def test_tail_splitter_missing_upstream_rules_cover_copy_reference_and_image() -> None:
    tail_node = WorkflowRuleNode(
        id="tail",
        node_type=WorkflowNodeType.TAIL_SPLITTER,
        position_x=200,
        config_json={},
    )
    copy_node = WorkflowRuleNode(
        id="copy",
        node_type=WorkflowNodeType.COPY_GENERATION,
        position_x=100,
        config_json={},
    )
    reference_node = WorkflowRuleNode(
        id="reference",
        node_type=WorkflowNodeType.REFERENCE_IMAGE,
        position_x=100,
        config_json={"source_asset_ids": ["asset-1"]},
    )
    image_node = WorkflowRuleNode(
        id="image",
        node_type=WorkflowNodeType.IMAGE_GENERATION,
        position_x=300,
        config_json={"instruction": "生成图片", "size": "1024x1024"},
    )

    assert should_execute_missing_upstream(copy_node, tail_node) is True
    assert should_execute_missing_upstream(reference_node, tail_node) is True
    assert should_execute_missing_upstream(image_node, tail_node) is True
    assert should_execute_missing_upstream(tail_node, image_node) is True
