from __future__ import annotations

import hashlib
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from helpers import (
    _enable_deletion,
    _execute_workflow_queue_inline,
    _login,
    _make_demo_image_bytes,
    _wait_for_workflow_run,
)
from sqlalchemy import event

from productflow_backend.application.canvas_templates import get_builtin_canvas_template
from productflow_backend.application.product_workflow.templates import TEMPLATE_METADATA_CONFIG_KEY
from productflow_backend.application.use_cases import (
    add_reference_images,
    create_product,
    list_products,
)
from productflow_backend.domain.enums import (
    CopyStatus,
    PosterKind,
    ProductWorkflowState,
    SourceAssetKind,
    WorkflowNodeStatus,
    WorkflowNodeType,
    WorkflowRunStatus,
)
from productflow_backend.domain.errors import BusinessValidationError
from productflow_backend.infrastructure.db.models import (
    DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    CopySet,
    GenerationResourceGroup,
    PosterVariant,
    Product,
    ProductWorkflow,
    SourceAsset,
    WorkflowEdge,
    WorkflowNode,
    WorkflowNodeRun,
    WorkflowRun,
)
from productflow_backend.infrastructure.provider_config import TEXT_PURPOSE, add_generation_config


@pytest.fixture(autouse=True)
def _execute_workflow_queue_inline_fixture(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep API workflow tests deterministic while production delivery goes through Dramatiq."""

    _execute_workflow_queue_inline(monkeypatch)


def _password_md5(value: str) -> str:
    return hashlib.md5(value.encode(), usedforsecurity=False).hexdigest()


def test_product_create_persists_source_note_for_ai_context(configured_env: Path) -> None:
    from productflow_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    response = client.post(
        "/api/products",
        data={
            "name": "露营保温杯",
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "category": "户外",
            "price": "79.00",
            "source_note": "316 不锈钢，主打长效保温和车载杯架适配。",
        },
        files={"image": ("cup.png", _make_demo_image_bytes(), "image/png")},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["source_note"] == "316 不锈钢，主打长效保温和车载杯架适配。"

    minimal = client.post(
        "/api/products",
        data={"name": "极简商品壳", "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID},
        files={"image": ("minimal.png", _make_demo_image_bytes(), "image/png")},
    )
    assert minimal.status_code == 201
    minimal_payload = minimal.json()
    assert minimal_payload["category"] is None
    assert minimal_payload["price"] is None
    assert minimal_payload["source_note"] is None


def test_default_product_create_preserves_lazy_workflow_behavior(configured_env: Path, db_session) -> None:
    from productflow_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    created = client.post(
        "/api/products",
        data={"name": "默认画布商品", "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID},
        files={"image": ("default.png", _make_demo_image_bytes(), "image/png")},
    )

    assert created.status_code == 201
    product_id = created.json()["id"]
    db_session.expire_all()
    assert db_session.query(ProductWorkflow).filter_by(product_id=product_id).count() == 0

    workflow_response = client.get(f"/api/products/{product_id}/workflow")
    assert workflow_response.status_code == 200
    workflow = workflow_response.json()
    assert len(workflow["nodes"]) == 4
    assert len(workflow["edges"]) == 4
    assert {node["title"] for node in workflow["nodes"]} == {"灵感", "文案", "生图", "参考图"}

    default_key = client.post(
        "/api/products",
        data={
            "name": "显式默认画布商品",
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "canvas_template_key": "default",
        },
        files={"image": ("explicit-default.png", _make_demo_image_bytes(), "image/png")},
    )
    assert default_key.status_code == 201
    db_session.expire_all()
    assert db_session.query(ProductWorkflow).filter_by(product_id=default_key.json()["id"]).count() == 0


def test_product_create_materializes_full_canvas_template(configured_env: Path, db_session) -> None:
    from productflow_backend.presentation.api import create_app

    template = get_builtin_canvas_template("ecommerce-main-image-v1")
    app = create_app()
    client = TestClient(app)
    _login(client)

    created = client.post(
        "/api/products",
        data={
            "name": "模板画布商品",
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "canvas_template_key": template.key,
        },
        files={"image": ("template.png", _make_demo_image_bytes(), "image/png")},
    )

    assert created.status_code == 201
    product_id = created.json()["id"]
    db_session.expire_all()
    workflow = db_session.query(ProductWorkflow).filter_by(product_id=product_id, active=True).one()
    assert workflow.title == template.title
    assert workflow.initial_entry_mode == "image"

    nodes = db_session.query(WorkflowNode).filter_by(workflow_id=workflow.id).all()
    edges = db_session.query(WorkflowEdge).filter_by(workflow_id=workflow.id).all()
    assert len(nodes) == len(template.nodes)
    assert len(edges) == len(template.edges)

    persisted_node_ids_by_template_key: dict[str, str] = {}
    unmatched_nodes = list(nodes)
    for template_node in template.nodes:
        expected_config = {
            **template_node.config_json,
            TEMPLATE_METADATA_CONFIG_KEY: {
                "source": "builtin",
                "template_key": template.key,
                "node_key": template_node.key,
            },
        }
        if template_node.node_type in {
            WorkflowNodeType.COPY_GENERATION,
            WorkflowNodeType.IMAGE_GENERATION,
            WorkflowNodeType.TAIL_SPLITTER,
        }:
            expected_config["resource_group_id"] = DEFAULT_GENERATION_RESOURCE_GROUP_ID
        matched_node = None
        for node in unmatched_nodes:
            if (
                node.node_type != template_node.node_type
                or node.title != template_node.title
                or node.position_x != template_node.position_x
                or node.position_y != template_node.position_y
            ):
                continue
            if template_node.node_type == WorkflowNodeType.PRODUCT_CONTEXT:
                if all(node.config_json.get(key) == value for key, value in expected_config.items()):
                    assert node.config_json["name"] == "模板画布商品"
                    assert node.config_json["owner_id"] == product_id
                    assert node.config_json["entry_type"] == "image"
                    assert "category" not in node.config_json
                    assert "price" not in node.config_json
                    matched_node = node
                    break
                continue
            if node.config_json == expected_config:
                matched_node = node
                break
        assert matched_node is not None
        unmatched_nodes.remove(matched_node)
        persisted_node_ids_by_template_key[template_node.key] = matched_node.id

    assert set(persisted_node_ids_by_template_key) == {node.key for node in template.nodes}
    persisted_edges = {
        (edge.source_node_id, edge.target_node_id, edge.source_handle, edge.target_handle) for edge in edges
    }
    assert persisted_edges == {
        (
            persisted_node_ids_by_template_key[edge.source_node_key],
            persisted_node_ids_by_template_key[edge.target_node_key],
            edge.source_handle,
            edge.target_handle,
        )
        for edge in template.edges
    }

    workflow_response = client.get(f"/api/products/{product_id}/workflow")
    assert workflow_response.status_code == 200
    assert workflow_response.json()["id"] == workflow.id


def test_product_create_rejects_invalid_canvas_template_key(configured_env: Path) -> None:
    from productflow_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    response = client.post(
        "/api/products",
        data={
            "name": "坏模板商品",
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "canvas_template_key": "missing-template",
        },
        files={"image": ("missing.png", _make_demo_image_bytes(), "image/png")},
    )

    assert response.status_code == 400
    assert "画布模板不存在" in response.json()["detail"]


def test_product_create_requires_resource_group_for_authorized_entry(db_session, configured_env: Path) -> None:  # noqa: ARG001
    from productflow_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    missing_group_response = client.post(
        "/api/products",
        data={"name": "缺少生成分组"},
        files={"image": ("missing-group.png", _make_demo_image_bytes(), "image/png")},
    )
    assert missing_group_response.status_code == 422

    with pytest.raises(BusinessValidationError, match="请选择供应商生成分组"):
        create_product(
            db_session,
            name="缺少生成分组",
            category=None,
            price=None,
            source_note=None,
            image_bytes=_make_demo_image_bytes(),
            filename="missing-group.png",
            content_type="image/png",
            resource_group_id=" ",
            actor_is_admin=True,
            require_resource_group_grant=True,
        )


def test_product_create_rejects_ungranted_resource_group_for_member(configured_env: Path) -> None:
    from productflow_backend.presentation.api import create_app

    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)

    created_group = admin_client.post(
        "/api/settings/generation-resource-groups",
        json={"key": "premium-product", "name": "高阶灵感分组", "sort_order": 20, "enabled": True},
    )
    assert created_group.status_code == 200
    premium_group_id = created_group.json()["id"]
    created_user = admin_client.post(
        "/api/rbac/users",
        json={"username": "product-member", "display_name": "Product Member"},
    )
    assert created_user.status_code == 201

    user_client = TestClient(app)
    set_password = user_client.post(
        "/api/auth/password",
        json={"username": "product-member", "client_password_md5": _password_md5("product-member-password")},
    )
    assert set_password.status_code == 200

    rejected = user_client.post(
        "/api/products",
        data={"name": "未授权分组灵感", "resource_group_id": premium_group_id},
        files={"image": ("unauthorized.png", _make_demo_image_bytes(), "image/png")},
    )
    assert rejected.status_code == 400
    assert rejected.json()["detail"] == "账号未授权使用该供应商生成分组"


def test_product_create_filters_canvas_template_by_entry_mode(configured_env: Path, db_session) -> None:
    from productflow_backend.application.product_workflow.user_templates import create_global_canvas_template
    from productflow_backend.presentation.api import create_app

    template = get_builtin_canvas_template("ecommerce-main-image-v1").model_copy(update={"entry_mode": "copy"})
    create_global_canvas_template(
        db_session,
        key="copy-entry-global-template",
        title="文案入口模板",
        description="只允许文案入口使用",
        kind="full_canvas",
        entry_mode="copy",
        template_json=template.model_dump(mode="json"),
    )

    app = create_app()
    client = TestClient(app)
    _login(client)

    rejected = client.post(
        "/api/products",
        data={
            "name": "入口不匹配",
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "canvas_template_key": "copy-entry-global-template",
            "initial_workflow_entry": "image",
        },
        files={"image": ("entry.png", _make_demo_image_bytes(), "image/png")},
    )
    assert rejected.status_code == 400
    assert rejected.json()["detail"] == "画布模板入口类型与开始方式不匹配"

    accepted = client.post(
        "/api/products",
        data={
            "name": "文案入口模板",
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "canvas_template_key": "copy-entry-global-template",
            "initial_workflow_entry": "copy",
            "entry_text": "这是一段用于文案入口的起始内容",
        },
        files={"image": ("entry-copy.png", _make_demo_image_bytes(), "image/png")},
    )
    assert accepted.status_code == 201
    db_session.expire_all()
    workflow = db_session.query(ProductWorkflow).filter_by(product_id=accepted.json()["id"], active=True).one()
    assert workflow.initial_entry_mode == "copy"


def test_product_create_template_persists_text_entry_context_for_summary(configured_env: Path, db_session) -> None:
    from productflow_backend.application.product_workflow.user_templates import create_global_canvas_template
    from productflow_backend.presentation.api import create_app

    entry_text = "免安装收纳架适配厨房场景"
    template = get_builtin_canvas_template("ecommerce-main-image-v1").model_copy(update={"entry_mode": "copy"})
    create_global_canvas_template(
        db_session,
        key="copy-entry-summary-template",
        title="文案入口摘要模板",
        description="用于列表摘要测试",
        kind="full_canvas",
        entry_mode="copy",
        template_json=template.model_dump(mode="json"),
    )

    app = create_app()
    client = TestClient(app)
    _login(client)

    created = client.post(
        "/api/products",
        data={
            "name": "模板文案入口灵感",
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "canvas_template_key": "copy-entry-summary-template",
            "initial_workflow_entry": "copy",
            "entry_text": entry_text,
        },
        files={"image": ("entry-copy-summary.png", _make_demo_image_bytes(), "image/png")},
    )
    assert created.status_code == 201

    db_session.expire_all()
    workflow = db_session.query(ProductWorkflow).filter_by(product_id=created.json()["id"], active=True).one()
    context_node = (
        db_session.query(WorkflowNode)
        .filter_by(workflow_id=workflow.id, node_type=WorkflowNodeType.PRODUCT_CONTEXT)
        .one()
    )
    product_id = created.json()["id"]
    assert context_node.config_json["entry_type"] == "copy"
    assert context_node.config_json["owner_id"] == product_id
    assert "category" not in context_node.config_json
    assert "price" not in context_node.config_json
    assert context_node.config_json["long_text"] == entry_text
    assert context_node.config_json["source_note"] == entry_text

    listed = client.get("/api/products", params={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID})
    assert listed.status_code == 200
    item = next(item for item in listed.json()["items"] if item["id"] == created.json()["id"])
    assert item["initial_workflow_entry"] == "copy"
    assert item["initial_entry_text"] == entry_text
    assert item["initial_entry_text_excerpt"] == "免安装收纳架"
    assert item["source_image_thumbnail_url"]
    assert item["latest_generated_image_thumbnail_url"] is None


def test_product_list_filters_by_selected_resource_group(configured_env: Path) -> None:
    from productflow_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    created_group = client.post(
        "/api/settings/generation-resource-groups",
        json={"key": "premium-list", "name": "高阶列表分组", "sort_order": 20, "enabled": True},
    )
    assert created_group.status_code == 200
    premium_group_id = created_group.json()["id"]
    default_product = client.post(
        "/api/products",
        data={"name": "默认分组灵感", "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID},
        files={"image": ("default-list.png", _make_demo_image_bytes(), "image/png")},
    )
    assert default_product.status_code == 201
    premium_product = client.post(
        "/api/products",
        data={"name": "高阶分组灵感", "resource_group_id": premium_group_id},
        files={"image": ("premium-list.png", _make_demo_image_bytes(), "image/png")},
    )
    assert premium_product.status_code == 201

    default_list = client.get("/api/products", params={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID})
    assert default_list.status_code == 200
    assert {item["id"] for item in default_list.json()["items"]} == {default_product.json()["id"]}
    assert default_list.json()["items"][0]["resource_group"]["key"] == "default"

    premium_list = client.get("/api/products", params={"resource_group_id": premium_group_id})
    assert premium_list.status_code == 200
    assert {item["id"] for item in premium_list.json()["items"]} == {premium_product.json()["id"]}
    assert premium_list.json()["items"][0]["resource_group"]["key"] == "premium-list"


def test_successful_workflow_generation_updates_product_resource_group(
    configured_env: Path,
    db_session,
) -> None:
    from productflow_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    created_group = client.post(
        "/api/settings/generation-resource-groups",
        json={"key": "premium-workflow", "name": "高阶工作流分组", "sort_order": 20, "enabled": True},
    )
    assert created_group.status_code == 200
    premium_group_id = created_group.json()["id"]
    db_session.expire_all()
    created_config = add_generation_config(
        db_session,
        resource_group_id=premium_group_id,
        name="premium text",
        purpose=TEXT_PURPOSE,
        provider_kind="mock",
        provider_profile_id=None,
        model_settings={"brief_model": "mock-brief", "copy_model": "mock-copy"},
        config={},
        priority=10,
        max_concurrency=1,
        enabled=True,
    )
    assert created_config.resource_group_id == premium_group_id
    created_product = client.post(
        "/api/products",
        data={"name": "跨分组生成灵感", "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID},
        files={"image": ("workflow-group.png", _make_demo_image_bytes(), "image/png")},
    )
    assert created_product.status_code == 201
    product_id = created_product.json()["id"]
    assert created_product.json()["resource_group_id"] == DEFAULT_GENERATION_RESOURCE_GROUP_ID

    workflow = client.get(f"/api/products/{product_id}/workflow")
    assert workflow.status_code == 200
    copy_node = next(node for node in workflow.json()["nodes"] if node["node_type"] == "copy_generation")
    patched_node = client.patch(
        f"/api/workflow-nodes/{copy_node['id']}",
        json={"config_json": {**copy_node["config_json"], "resource_group_id": premium_group_id}},
    )
    assert patched_node.status_code == 200

    run_response = client.post(f"/api/products/{product_id}/workflow/run", json={"start_node_id": copy_node["id"]})
    assert run_response.status_code == 200
    _wait_for_workflow_run(client, product_id, status="succeeded")

    db_session.expire_all()
    product = db_session.get(Product, product_id)
    assert product is not None
    assert product.resource_group_id == premium_group_id

    detail = client.get(f"/api/products/{product_id}")
    assert detail.status_code == 200
    assert detail.json()["resource_group"]["key"] == "premium-workflow"


def test_product_create_accepts_broad_builtin_canvas_template_key(configured_env: Path, db_session) -> None:
    from productflow_backend.presentation.api import create_app

    template = get_builtin_canvas_template("ecommerce-sku-variant-image-v1")
    app = create_app()
    client = TestClient(app)
    _login(client)

    response = client.post(
        "/api/products",
        data={
            "name": "规格模板商品",
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "canvas_template_key": template.key,
        },
        files={"image": ("sku-template.png", _make_demo_image_bytes(), "image/png")},
    )

    assert response.status_code == 201
    product_id = response.json()["id"]
    db_session.expire_all()
    workflow = db_session.query(ProductWorkflow).filter_by(product_id=product_id, active=True).one()
    assert workflow.title == template.title
    assert db_session.query(WorkflowNode).filter_by(workflow_id=workflow.id).count() == len(template.nodes)
    assert db_session.query(WorkflowEdge).filter_by(workflow_id=workflow.id).count() == len(template.edges)


def test_product_list_summary_uses_latest_run_first_generated_image(configured_env: Path, db_session) -> None:
    from productflow_backend.presentation.api import create_app

    product = create_product(
        db_session,
        name="最新生成图摘要",
        category=None,
        price=None,
        source_note=None,
        image_bytes=None,
        filename=None,
        content_type=None,
        initial_workflow_entry="blank",
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    )
    workflow = db_session.query(ProductWorkflow).filter_by(product_id=product.id, active=True).one()
    context_node = (
        db_session.query(WorkflowNode)
        .filter_by(workflow_id=workflow.id, node_type=WorkflowNodeType.PRODUCT_CONTEXT)
        .one()
    )
    first_image_node = WorkflowNode(
        workflow_id=workflow.id,
        node_type=WorkflowNodeType.IMAGE_GENERATION,
        title="第一张生成图节点",
        position_x=320,
        position_y=100,
        config_json={"instruction": "先生成这一张"},
    )
    later_image_node = WorkflowNode(
        workflow_id=workflow.id,
        node_type=WorkflowNodeType.IMAGE_GENERATION,
        title="后续生成图节点",
        position_x=620,
        position_y=100,
        config_json={"instruction": "后生成这一张"},
    )
    db_session.add_all([first_image_node, later_image_node])
    db_session.flush()
    db_session.add_all(
        [
            WorkflowEdge(
                workflow_id=workflow.id,
                source_node_id=context_node.id,
                target_node_id=first_image_node.id,
            ),
            WorkflowEdge(
                workflow_id=workflow.id,
                source_node_id=context_node.id,
                target_node_id=later_image_node.id,
            ),
        ]
    )
    copy_set = CopySet(
        product_id=product.id,
        status=CopyStatus.CONFIRMED,
        structured_payload={
            "version": 2,
            "summary": "摘要",
            "content": {"kind": "blocks", "blocks": [{"id": "headline", "text": "摘要"}]},
        },
        model_structured_payload={
            "version": 2,
            "summary": "摘要",
            "content": {"kind": "blocks", "blocks": [{"id": "headline", "text": "摘要"}]},
        },
        provider_name="test",
        model_name="test",
        prompt_version="test",
    )
    db_session.add(copy_set)
    db_session.flush()
    now = datetime(2026, 6, 3, 12, 0, tzinfo=UTC)
    old_poster = PosterVariant(
        product_id=product.id,
        copy_set_id=copy_set.id,
        kind=PosterKind.MAIN_IMAGE,
        template_name="old",
        storage_path="products/posters/old.png",
        width=800,
        height=800,
        created_at=now,
    )
    first_poster = PosterVariant(
        product_id=product.id,
        copy_set_id=copy_set.id,
        kind=PosterKind.MAIN_IMAGE,
        template_name="first",
        storage_path="products/posters/first.png",
        width=800,
        height=800,
        created_at=now + timedelta(minutes=1),
    )
    latest_created_poster = PosterVariant(
        product_id=product.id,
        copy_set_id=copy_set.id,
        kind=PosterKind.MAIN_IMAGE,
        template_name="latest-created",
        storage_path="products/posters/latest-created.png",
        width=800,
        height=800,
        created_at=now + timedelta(minutes=2),
    )
    db_session.add_all([old_poster, first_poster, latest_created_poster])
    db_session.flush()
    old_run = WorkflowRun(
        workflow_id=workflow.id,
        status=WorkflowRunStatus.SUCCEEDED,
        started_at=now,
        finished_at=now + timedelta(seconds=10),
    )
    latest_run = WorkflowRun(
        workflow_id=workflow.id,
        status=WorkflowRunStatus.SUCCEEDED,
        started_at=now + timedelta(minutes=5),
        finished_at=now + timedelta(minutes=6),
    )
    db_session.add_all([old_run, latest_run])
    db_session.flush()
    db_session.add_all(
        [
            WorkflowNodeRun(
                workflow_run_id=old_run.id,
                node_id=first_image_node.id,
                status=WorkflowNodeStatus.SUCCEEDED,
                poster_variant_id=old_poster.id,
                started_at=now,
                finished_at=now + timedelta(seconds=10),
            ),
            WorkflowNodeRun(
                workflow_run_id=latest_run.id,
                node_id=first_image_node.id,
                status=WorkflowNodeStatus.SUCCEEDED,
                poster_variant_id=first_poster.id,
                started_at=now + timedelta(minutes=5),
                finished_at=now + timedelta(minutes=5, seconds=20),
            ),
            WorkflowNodeRun(
                workflow_run_id=latest_run.id,
                node_id=later_image_node.id,
                status=WorkflowNodeStatus.SUCCEEDED,
                poster_variant_id=latest_created_poster.id,
                started_at=now + timedelta(minutes=5, seconds=30),
                finished_at=now + timedelta(minutes=5, seconds=50),
            ),
        ]
    )
    db_session.commit()

    app = create_app()
    client = TestClient(app)
    _login(client)

    listed = client.get("/api/products", params={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID})
    assert listed.status_code == 200
    item = next(item for item in listed.json()["items"] if item["id"] == product.id)
    assert item["initial_workflow_entry"] == "blank"
    assert item["initial_entry_text"] is None
    assert item["latest_generated_image_download_url"] == f"/api/posters/{first_poster.id}/download"
    assert item["latest_generated_image_preview_url"] == f"/api/posters/{first_poster.id}/download?variant=preview"
    assert item["latest_generated_image_thumbnail_url"] == f"/api/posters/{first_poster.id}/download?variant=thumbnail"
    assert latest_created_poster.id not in item["latest_generated_image_download_url"]


def test_legacy_jobrun_routes_are_removed(configured_env: Path) -> None:
    from productflow_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    created = client.post(
        "/api/products",
        data={"name": "无传统任务商品", "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID},
        files={"image": ("legacy.png", _make_demo_image_bytes(), "image/png")},
    )
    assert created.status_code == 201
    product_id = created.json()["id"]

    assert client.post(f"/api/products/{product_id}/copy-jobs").status_code == 404
    assert client.post(f"/api/products/{product_id}/poster-jobs").status_code == 404
    assert client.post("/api/posters/missing/regenerate").status_code == 404
    assert client.get("/api/jobs/missing").status_code == 404

    history = client.get(f"/api/products/{product_id}/history")
    assert history.status_code == 200
    assert set(history.json()) == {"copy_sets", "poster_variants"}


def test_product_history_can_filter_by_resource_group(configured_env: Path, db_session) -> None:
    from productflow_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    created = client.post(
        "/api/products",
        data={"name": "分组历史商品", "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID},
        files={"image": ("history.png", _make_demo_image_bytes(), "image/png")},
    )
    assert created.status_code == 201
    product_id = created.json()["id"]

    premium_group = GenerationResourceGroup(key="premium-history", name="高阶历史分组", sort_order=20)
    db_session.add(premium_group)
    db_session.flush()

    legacy_copy = CopySet(
        product_id=product_id,
        structured_payload={"summary": "legacy", "content": {"kind": "freeform", "text": "legacy"}},
        provider_name="mock",
        model_name="mock-text",
        prompt_version="v1",
        resource_group_id=None,
    )
    default_copy = CopySet(
        product_id=product_id,
        structured_payload={"summary": "default", "content": {"kind": "freeform", "text": "default"}},
        provider_name="mock",
        model_name="mock-text",
        prompt_version="v1",
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    )
    premium_copy = CopySet(
        product_id=product_id,
        structured_payload={"summary": "premium", "content": {"kind": "freeform", "text": "premium"}},
        provider_name="mock",
        model_name="mock-text",
        prompt_version="v1",
        resource_group_id=premium_group.id,
    )
    db_session.add_all([legacy_copy, default_copy, premium_copy])
    db_session.flush()
    db_session.add_all(
        [
            PosterVariant(
                product_id=product_id,
                copy_set_id=legacy_copy.id,
                kind=PosterKind.MAIN_IMAGE,
                template_name="legacy",
                storage_path="products/history/legacy.png",
                width=800,
                height=800,
                resource_group_id=None,
            ),
            PosterVariant(
                product_id=product_id,
                copy_set_id=default_copy.id,
                kind=PosterKind.MAIN_IMAGE,
                template_name="default",
                storage_path="products/history/default.png",
                width=800,
                height=800,
                resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            ),
            PosterVariant(
                product_id=product_id,
                copy_set_id=premium_copy.id,
                kind=PosterKind.MAIN_IMAGE,
                template_name="premium",
                storage_path="products/history/premium.png",
                width=800,
                height=800,
                resource_group_id=premium_group.id,
            ),
        ]
    )
    db_session.commit()

    default_history = client.get(
        f"/api/products/{product_id}/history",
        params={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID},
    )
    assert default_history.status_code == 200
    default_payload = default_history.json()
    assert {item["id"] for item in default_payload["copy_sets"]} == {legacy_copy.id, default_copy.id}
    assert {item["copy_set_id"] for item in default_payload["poster_variants"]} == {legacy_copy.id, default_copy.id}
    assert {item["resource_group"]["key"] for item in default_payload["copy_sets"]} == {"default"}

    premium_history = client.get(
        f"/api/products/{product_id}/history",
        params={"resource_group_id": premium_group.id},
    )
    assert premium_history.status_code == 200
    premium_payload = premium_history.json()
    assert [item["id"] for item in premium_payload["copy_sets"]] == [premium_copy.id]
    assert [item["copy_set_id"] for item in premium_payload["poster_variants"]] == [premium_copy.id]
    assert premium_payload["copy_sets"][0]["resource_group"]["key"] == "premium-history"


def test_product_can_be_deleted_from_api(configured_env: Path, db_session) -> None:
    from productflow_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    created = client.post(
        "/api/products",
        data={"name": "待删除商品", "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID},
        files={"image": ("delete.png", _make_demo_image_bytes(), "image/png")},
    )
    assert created.status_code == 201
    product_id = created.json()["id"]
    product_root = configured_env / "products" / product_id
    assert product_root.exists()
    run = client.post(f"/api/products/{product_id}/workflow/run", json={})
    assert run.status_code == 200
    completed = _wait_for_workflow_run(client, product_id, status="succeeded")
    assert completed["runs"][0]["node_runs"]
    product_with_artifacts = client.get(f"/api/products/{product_id}")
    assert product_with_artifacts.status_code == 200
    assert product_with_artifacts.json()["copy_sets"]
    assert product_with_artifacts.json()["poster_variants"]

    _enable_deletion(client)
    deleted = client.delete(f"/api/products/{product_id}")
    assert deleted.status_code == 204
    assert deleted.content == b""

    listed = client.get("/api/products", params={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID})
    assert listed.status_code == 200
    listed_product = next(item for item in listed.json()["items"] if item["id"] == product_id)
    assert listed_product["deleted_at"] is not None
    assert listed_product["deleted_by_user_id"] is not None
    visible_to_admin = client.get(f"/api/products/{product_id}")
    assert visible_to_admin.status_code == 200
    assert visible_to_admin.json()["deleted_at"] is not None

    db_session.expire_all()
    persisted = db_session.get(Product, product_id)
    assert persisted is not None
    assert persisted.deleted_at is not None
    assert product_root.exists()


def test_reference_images_can_be_attached_to_product(db_session, configured_env: Path) -> None:
    product = create_product(
        db_session,
        name="陶瓷马克杯",
        category="家居",
        price="39.00",
        source_note=None,
        image_bytes=_make_demo_image_bytes(),
        filename="mug.png",
        content_type="image/png",
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    )

    updated = add_reference_images(
        db_session,
        product_id=product.id,
        reference_image_uploads=[
            (_make_demo_image_bytes(), "sample-1.png", "image/png"),
            (_make_demo_image_bytes(), "sample-2.png", "image/png"),
        ],
    )

    reference_assets = [asset for asset in updated.source_assets if asset.kind == SourceAssetKind.REFERENCE_IMAGE]
    assert len(reference_assets) == 2
    assert all((Path(configured_env) / asset.storage_path).exists() for asset in reference_assets)
    assert all(asset.storage_backend == "local" for asset in reference_assets)
    assert all(asset.storage_bucket is None for asset in reference_assets)
    assert all(asset.storage_object_key == asset.storage_path for asset in reference_assets)


def test_product_status_filter_uses_database_pagination_before_eager_loading(db_session, configured_env: Path) -> None:
    draft = create_product(
        db_session,
        name="草稿商品",
        category=None,
        price=None,
        source_note=None,
        image_bytes=_make_demo_image_bytes(),
        filename="draft.png",
        content_type="image/png",
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    )
    copy_ready = create_product(
        db_session,
        name="文案商品",
        category=None,
        price=None,
        source_note=None,
        image_bytes=_make_demo_image_bytes(),
        filename="copy.png",
        content_type="image/png",
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    )
    poster_ready = create_product(
        db_session,
        name="海报商品",
        category=None,
        price=None,
        source_note=None,
        image_bytes=_make_demo_image_bytes(),
        filename="poster.png",
        content_type="image/png",
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    )

    copy_set = CopySet(
        product_id=copy_ready.id,
        status=CopyStatus.CONFIRMED,
        structured_payload={
            "version": 2,
            "summary": "海报标题",
            "content": {"kind": "blocks", "blocks": [{"id": "headline", "text": "标题"}]},
        },
        model_structured_payload={
            "version": 2,
            "summary": "海报标题",
            "content": {"kind": "blocks", "blocks": [{"id": "headline", "text": "标题"}]},
        },
        provider_name="test",
        model_name="test",
        prompt_version="test",
    )
    db_session.add(copy_set)
    db_session.flush()
    copy_ready.current_confirmed_copy_set_id = copy_set.id

    poster_copy_set = CopySet(
        product_id=poster_ready.id,
        status=CopyStatus.CONFIRMED,
        structured_payload={
            "version": 2,
            "summary": "海报标题",
            "content": {"kind": "blocks", "blocks": [{"id": "headline", "text": "标题"}]},
        },
        model_structured_payload={
            "version": 2,
            "summary": "海报标题",
            "content": {"kind": "blocks", "blocks": [{"id": "headline", "text": "标题"}]},
        },
        provider_name="test",
        model_name="test",
        prompt_version="test",
    )
    db_session.add(poster_copy_set)
    db_session.flush()
    poster_ready.current_confirmed_copy_set_id = poster_copy_set.id
    db_session.add(
        PosterVariant(
            product_id=poster_ready.id,
            copy_set_id=poster_copy_set.id,
            kind=PosterKind.MAIN_IMAGE,
            template_name="test",
            storage_path="products/poster/poster.png",
            width=800,
            height=800,
        )
    )
    db_session.commit()
    db_session.expire_all()

    product_selects: list[str] = []

    @event.listens_for(db_session.bind, "before_cursor_execute")
    def record_product_query(conn, cursor, statement, parameters, context, executemany):
        normalized_statement = " ".join(statement.lower().split())
        if (
            normalized_statement.startswith("select products.id")
            and "from products" in normalized_statement
            and "limit" in normalized_statement
        ):
            product_selects.append(normalized_statement)

    try:
        products, total = list_products(
            db_session,
            status=ProductWorkflowState.DRAFT,
            page=1,
            page_size=1,
            resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        )
    finally:
        event.remove(db_session.bind, "before_cursor_execute", record_product_query)

    assert total == 1
    assert [product.id for product in products] == [draft.id]
    assert len(product_selects) == 1
    assert "exists" in product_selects[0]
    assert "limit" in product_selects[0]

    copy_products, copy_total = list_products(
        db_session,
        status=ProductWorkflowState.COPY_READY,
        page=1,
        page_size=10,
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    )
    poster_products, poster_total = list_products(
        db_session,
        status=ProductWorkflowState.POSTER_READY,
        page=1,
        page_size=10,
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    )
    failed_products, failed_total = list_products(
        db_session,
        status=ProductWorkflowState.FAILED,
        page=1,
        page_size=10,
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    )

    assert copy_total == 1
    assert [product.id for product in copy_products] == [copy_ready.id]
    assert poster_total == 1
    assert [product.id for product in poster_products] == [poster_ready.id]
    assert failed_total == 0
    assert failed_products == []


def test_product_list_requires_resource_group_for_authorized_entry(db_session, configured_env: Path) -> None:  # noqa: ARG001
    from productflow_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    missing_group_response = client.get("/api/products")
    assert missing_group_response.status_code == 422

    with pytest.raises(BusinessValidationError, match="请选择供应商生成分组"):
        list_products(
            db_session,
            status=None,
            page=1,
            page_size=20,
            resource_group_id="",
            actor_is_admin=True,
            require_resource_group_grant=True,
        )


def test_product_reference_image_can_be_deleted(configured_env: Path, db_session) -> None:
    from productflow_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    created = client.post(
        "/api/products",
        data={
            "name": "香薰蜡烛",
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "category": "家居",
            "price": "49.00",
        },
        files=[
            ("image", ("main.png", _make_demo_image_bytes(), "image/png")),
            ("reference_images", ("ref.png", _make_demo_image_bytes(), "image/png")),
        ],
    )
    assert created.status_code == 201
    payload = created.json()
    original_asset = next(asset for asset in payload["source_assets"] if asset["kind"] == "original_image")
    reference_asset = next(asset for asset in payload["source_assets"] if asset["kind"] == "reference_image")

    db_session.expire_all()
    persisted_reference = db_session.get(SourceAsset, reference_asset["id"])
    assert persisted_reference is not None
    reference_path = Path(configured_env) / persisted_reference.storage_path
    assert reference_path.exists()

    deleted = client.delete(f"/api/source-assets/{reference_asset['id']}")
    assert deleted.status_code == 200
    assert all(asset["id"] != reference_asset["id"] for asset in deleted.json()["source_assets"])

    db_session.expire_all()
    assert db_session.get(SourceAsset, reference_asset["id"]) is None
    assert not reference_path.exists()

    rejected = client.delete(f"/api/source-assets/{original_asset['id']}")
    assert rejected.status_code == 400
    assert "只能删除商品参考图" in rejected.json()["detail"]
