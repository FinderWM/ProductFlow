from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from helpers import _execute_workflow_queue_inline, _login, _wait_for_workflow_run

from productflow_backend.domain.enums import WorkflowNodeType, WorkflowRunStatus
from productflow_backend.domain.workflow_rules import WorkflowRuleNode, should_execute_missing_upstream


@pytest.fixture(autouse=True)
def _execute_workflow_queue_inline_fixture(monkeypatch: pytest.MonkeyPatch) -> None:
    _execute_workflow_queue_inline(monkeypatch)


def _workflow_node(payload: dict, node_type: str) -> dict:
    return next(node for node in payload["nodes"] if node["node_type"] == node_type)


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
            "position_x": tail_node["position_x"] + 80,
            "position_y": tail_node["position_y"],
        },
    )
    assert applied.status_code == 200
    applied_payload = applied.json()

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
    assert first_run.id in {run.id for run in workflow.runs}
    tail_node = next(node for node in workflow.nodes if node.id == tail_node.id)
    first_batch = tail_node.output_json["applied_batches"][-1]
    first_batch_node_ids = set(first_batch["node_ids"])

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
