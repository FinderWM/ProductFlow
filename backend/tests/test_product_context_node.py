from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from helpers import _execute_workflow_queue_inline, _login, _make_demo_image_bytes, _wait_for_workflow_run


@pytest.fixture(autouse=True)
def _execute_workflow_queue_inline_fixture(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep API workflow tests deterministic while production delivery goes through Dramatiq."""

    _execute_workflow_queue_inline(monkeypatch)


def test_product_context_dynamic_fields_accept_only_scalar_values(configured_env: Path) -> None:
    from productflow_backend.application.product_workflow.context import normalize_product_context_config
    from productflow_backend.domain.errors import BusinessValidationError

    normalized = normalize_product_context_config(
        {
            "entry_type": "copy",
            "source_note": " legacy long text ",
            "dynamic_fields": {
                " enabled ": True,
                "stock": 12,
                "weight": 1.5,
                "note": " warm light ",
                "empty": None,
            },
        }
    )

    assert normalized["entry_type"] == "copy"
    assert normalized["long_text"] == "legacy long text"
    assert normalized["dynamic_fields"] == {
        "enabled": True,
        "stock": 12,
        "weight": 1.5,
        "note": "warm light",
        "empty": None,
    }

    with pytest.raises(BusinessValidationError, match="动态信息只支持"):
        normalize_product_context_config({"dynamic_fields": {"nested": {"bad": True}}})

    with pytest.raises(BusinessValidationError, match="动态信息只支持"):
        normalize_product_context_config({"dynamic_fields": {"items": ["bad"]}})

    with pytest.raises(BusinessValidationError, match="动态信息 key 不能为空"):
        normalize_product_context_config({"dynamic_fields": {" ": "bad"}})


def test_product_context_document_upload_validates_text_documents(configured_env: Path) -> None:
    from productflow_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    created = client.post(
        "/api/products",
        data={"name": "露营灯"},
        files={"image": ("lamp.png", _make_demo_image_bytes(), "image/png")},
    )
    assert created.status_code == 201
    product_id = created.json()["id"]
    workflow = client.get(f"/api/products/{product_id}/workflow").json()
    context_node = next(node for node in workflow["nodes"] if node["node_type"] == "product_context")

    uploaded = client.post(
        f"/api/workflow-nodes/{context_node['id']}/document",
        files={"document": ("brief.md", b"# brief\nwarm light", "text/markdown")},
    )
    assert uploaded.status_code == 200
    uploaded_context = next(node for node in uploaded.json()["nodes"] if node["id"] == context_node["id"])
    assert uploaded_context["config_json"]["document_filename"] == "brief.md"
    assert uploaded_context["config_json"]["document_mime_type"] == "text/markdown"
    assert uploaded_context["config_json"]["document_text"] == "# brief\nwarm light"
    assert uploaded_context["output_json"]["document_text"] == "# brief\nwarm light"

    detail = client.get(f"/api/products/{product_id}").json()
    document_asset = next(asset for asset in detail["source_assets"] if asset["kind"] == "context_document")
    assert document_asset["original_filename"] == "brief.md"
    assert document_asset["mime_type"] == "text/markdown"

    invalid_utf8 = client.post(
        f"/api/workflow-nodes/{context_node['id']}/document",
        files={"document": ("bad.txt", b"\xff", "text/plain")},
    )
    assert invalid_utf8.status_code == 400
    assert invalid_utf8.json()["detail"] == "文档必须使用 UTF-8 编码"

    unsupported_extension = client.post(
        f"/api/workflow-nodes/{context_node['id']}/document",
        files={"document": ("bad.pdf", b"text", "text/plain")},
    )
    assert unsupported_extension.status_code == 415


def test_product_create_initializes_rich_product_context(configured_env: Path) -> None:
    from productflow_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    long_text = "三阶魔方，顺滑磁吸结构，适合入门练习和竞速进阶。"
    created = client.post(
        "/api/products",
        data={
            "name": "三阶魔方",
            "owner_id": "goods-333",
            "category": "益智玩具",
            "price": "39.90",
            "initial_workflow_entry": "copy",
            "long_text": long_text,
            "dynamic_fields_json": json.dumps(
                {"color": "黑色", "magnetic": True, "level": 3, "note": None},
                ensure_ascii=False,
            ),
        },
        files={
            "image": ("cube.png", _make_demo_image_bytes(), "image/png"),
            "context_document": ("brief.md", "核心卖点：顺滑、稳定、磁吸。".encode(), "text/markdown"),
        },
    )
    assert created.status_code == 201
    product_id = created.json()["id"]
    assert created.json()["source_note"] == long_text
    assert {asset["kind"] for asset in created.json()["source_assets"]} >= {
        "original_image",
        "context_document",
    }

    workflow = client.get(f"/api/products/{product_id}/workflow")
    assert workflow.status_code == 200
    payload = workflow.json()
    context_node = next(node for node in payload["nodes"] if node["node_type"] == "product_context")
    copy_node = next(node for node in payload["nodes"] if node["node_type"] == "copy_generation")
    image_asset = next(asset for asset in created.json()["source_assets"] if asset["kind"] == "original_image")
    document_asset = next(asset for asset in created.json()["source_assets"] if asset["kind"] == "context_document")

    assert context_node["config_json"]["name"] == "三阶魔方"
    assert context_node["config_json"]["owner_id"] == "goods-333"
    assert context_node["config_json"]["entry_type"] == "copy"
    assert context_node["config_json"]["category"] == "益智玩具"
    assert context_node["config_json"]["price"] == "39.90"
    assert context_node["config_json"]["long_text"] == long_text
    assert context_node["config_json"]["source_note"] == long_text
    assert context_node["config_json"]["image_source_asset_id"] == image_asset["id"]
    assert context_node["config_json"]["document_source_asset_id"] == document_asset["id"]
    assert context_node["config_json"]["document_filename"] == "brief.md"
    assert context_node["config_json"]["document_mime_type"] == "text/markdown"
    assert context_node["config_json"]["document_text"] == "核心卖点：顺滑、稳定、磁吸。"
    assert context_node["config_json"]["dynamic_fields"] == {
        "color": "黑色",
        "magnetic": True,
        "level": 3,
        "note": None,
    }
    assert copy_node["config_json"]["source_note"] == long_text

    listed = client.get("/api/products")
    assert listed.status_code == 200
    item = next(item for item in listed.json()["items"] if item["id"] == product_id)
    assert item["initial_workflow_entry"] == "copy"
    assert item["initial_entry_text"] == long_text


def test_product_create_rejects_invalid_dynamic_fields_json(configured_env: Path) -> None:
    from productflow_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    invalid_json = client.post(
        "/api/products",
        data={
            "name": "动态字段坏 JSON",
            "initial_workflow_entry": "blank",
            "dynamic_fields_json": "{bad",
        },
    )
    assert invalid_json.status_code == 400
    assert invalid_json.json()["detail"] == "动态信息必须是有效 JSON"

    invalid_object = client.post(
        "/api/products",
        data={
            "name": "动态字段非对象",
            "initial_workflow_entry": "blank",
            "dynamic_fields_json": "[1, 2]",
        },
    )
    assert invalid_object.status_code == 400
    assert invalid_object.json()["detail"] == "动态信息必须是 JSON 对象"


def test_product_context_fields_flow_to_downstream_image_node(configured_env: Path) -> None:
    from productflow_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    created = client.post(
        "/api/products",
        data={"name": "折叠露营灯"},
        files={"image": ("lamp.png", _make_demo_image_bytes(), "image/png")},
    )
    assert created.status_code == 201
    product_id = created.json()["id"]
    workflow = client.get(f"/api/products/{product_id}/workflow").json()
    context_node = next(node for node in workflow["nodes"] if node["node_type"] == "product_context")
    image_node = next(node for node in workflow["nodes"] if node["node_type"] == "image_generation")

    context_image = client.post(
        f"/api/workflow-nodes/{context_node['id']}/image",
        files={"image": ("context.png", _make_demo_image_bytes(), "image/png")},
    )
    assert context_image.status_code == 200
    context_after_image = next(node for node in context_image.json()["nodes"] if node["id"] == context_node["id"])

    context_document = client.post(
        f"/api/workflow-nodes/{context_node['id']}/document",
        files={"document": ("brief.txt", "轻量，三档亮度，帐篷挂钩。".encode(), "text/plain")},
    )
    assert context_document.status_code == 200
    context_after_document = next(node for node in context_document.json()["nodes"] if node["id"] == context_node["id"])

    patched_config = {
        **context_after_document["config_json"],
        "name": "折叠露营灯",
        "owner_id": "goods-789",
        "entry_type": "tail",
        "category": "户外照明",
        "price": "89",
        "long_text": "主打轻量照明、帐篷氛围和应急备用。",
        "dynamic_fields": {"waterproof": True, "lumens": 300, "scene": "露营"},
    }
    patched_context = client.patch(
        f"/api/workflow-nodes/{context_node['id']}",
        json={"config_json": patched_config},
    )
    assert patched_context.status_code == 200
    patched_context_node = next(node for node in patched_context.json()["nodes"] if node["id"] == context_node["id"])
    assert (
        patched_context_node["config_json"]["image_source_asset_id"]
        == context_after_image["config_json"]["image_source_asset_id"]
    )

    selected_run = client.post(
        f"/api/products/{product_id}/workflow/run",
        json={"start_node_id": image_node["id"]},
    )
    assert selected_run.status_code == 200
    payload = _wait_for_workflow_run(client, product_id, status="succeeded")
    image_output = next(node for node in payload["nodes"] if node["id"] == image_node["id"])["output_json"]
    product_context = image_output["context_summary"]["product_context"]

    assert product_context["owner_id"] == "goods-789"
    assert product_context["entry_type"] == "tail"
    assert product_context["long_text"] == "主打轻量照明、帐篷氛围和应急备用。"
    assert product_context["document_filename"] == "brief.txt"
    assert product_context["dynamic_fields"] == {"waterproof": True, "lumens": 300, "scene": "露营"}
    assert image_output["context_summary"]["reference_image_count"] >= 1
    assert any("主打轻量照明" in source["text"] for source in image_output["context_sources"])
    assert any("轻量，三档亮度" in source["text"] for source in image_output["context_sources"])
    assert any(
        "动态信息" in source["text"] and "lumens" in source["text"]
        for source in image_output["context_sources"]
    )
