from __future__ import annotations

import hashlib
from pathlib import Path

from fastapi.testclient import TestClient
from helpers import _login, _make_demo_image_bytes

from productflow_backend.application.canvas_templates import get_builtin_canvas_template


def _password_md5(value: str) -> str:
    return hashlib.md5(value.encode(), usedforsecurity=False).hexdigest()


def _create_user_client(app, admin_client: TestClient, username: str) -> TestClient:
    created_user = admin_client.post(
        "/api/rbac/users",
        json={"username": username, "display_name": username.title()},
    )
    assert created_user.status_code == 201

    client = TestClient(app)
    password_md5 = _password_md5(f"{username}-password")
    set_password = client.post(
        "/api/auth/password",
        json={"username": username, "client_password_md5": password_md5},
    )
    assert set_password.status_code == 200
    return client


def _create_product(client: TestClient, name: str) -> dict:
    created = client.post(
        "/api/products",
        data={"name": name},
        files={"image": (f"{name}.png", _make_demo_image_bytes(), "image/png")},
    )
    assert created.status_code == 201
    return created.json()


def _save_first_node_group_template(client: TestClient, product_id: str, category_id: str | None = None) -> dict:
    workflow = client.get(f"/api/products/{product_id}/workflow")
    assert workflow.status_code == 200
    nodes = [
        node
        for node in workflow.json()["nodes"]
        if node["node_type"] in {"copy_generation", "image_generation", "reference_image"}
    ][:2]
    saved = client.post(
        f"/api/products/{product_id}/workflow/user-template-groups",
        json={
            "title": "个人复用链路",
            "node_ids": [node["id"] for node in nodes],
            "category_id": category_id,
        },
    )
    assert saved.status_code == 201
    return saved.json()


def test_builtin_templates_seed_to_database_and_support_search_category_filter(configured_env: Path) -> None:
    from productflow_backend.presentation.api import create_app

    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)

    categories = admin_client.get("/api/workflow/canvas-template-categories")
    assert categories.status_code == 200
    builtin_categories = {item["name"]: item for item in categories.json()["items"] if item["scope"] == "global"}
    expected_category_keys = {
        "平台首图": {
            "ecommerce-main-image-v1",
            "ecommerce-taobao-main-image-v1",
            "ecommerce-white-background-image-v1",
        },
        "详情说服": {
            "ecommerce-sku-variant-image-v1",
            "ecommerce-feature-infographic-v1",
            "ecommerce-size-spec-image-v1",
            "ecommerce-scale-reference-image-v1",
            "ecommerce-package-checklist-image-v1",
            "ecommerce-usage-steps-image-v1",
            "ecommerce-comparison-image-v1",
            "ecommerce-detail-material-image-v1",
        },
        "场景图册": {
            "ecommerce-multi-angle-image-v1",
            "ecommerce-model-lifestyle-image-v1",
            "ecommerce-scene-image-v1",
        },
        "内容种草": {
            "ecommerce-xiaohongshu-image-v1",
            "ecommerce-short-video-cover-v1",
        },
        "活动投放": {"ecommerce-campaign-promotion-image-v1"},
    }
    assert set(builtin_categories) == set(expected_category_keys)

    search = admin_client.get("/api/workflow/canvas-templates", params={"search": "淘宝"})
    assert search.status_code == 200
    assert {item["key"] for item in search.json()["items"]} == {"ecommerce-taobao-main-image-v1"}

    for category_name, expected_keys in expected_category_keys.items():
        category = builtin_categories[category_name]
        filtered = admin_client.get(
            "/api/workflow/canvas-templates",
            params={"category_id": category["id"], "scope": "global"},
        )
        assert filtered.status_code == 200
        payload = filtered.json()
        assert {item["key"] for item in payload["items"]} == expected_keys
        assert {item["category_id"] for item in payload["items"]} == {category["id"]}
        assert {item["category_name"] for item in payload["items"]} == {category_name}
        assert {item["entry_mode"] for item in payload["items"]} == {"image"}


def test_canvas_template_catalog_filters_by_initial_entry_mode(configured_env: Path) -> None:
    from productflow_backend.application.product_workflow.user_templates import create_global_canvas_template
    from productflow_backend.infrastructure.db.session import get_session_factory
    from productflow_backend.presentation.api import create_app

    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)
    session = get_session_factory()()
    try:
        template = get_builtin_canvas_template("ecommerce-main-image-v1").model_copy(update={"entry_mode": "copy"})
        create_global_canvas_template(
            session,
            key="copy-entry-catalog-template",
            title="文案入口目录模板",
            description="目录过滤用",
            kind="full_canvas",
            entry_mode="copy",
            template_json=template.model_dump(mode="json"),
        )
    finally:
        session.close()

    image_templates = admin_client.get("/api/workflow/canvas-templates", params={"initial_workflow_entry": "image"})
    assert image_templates.status_code == 200
    assert "copy-entry-catalog-template" not in {item["key"] for item in image_templates.json()["items"]}

    copy_templates = admin_client.get("/api/workflow/canvas-templates", params={"initial_workflow_entry": "copy"})
    assert copy_templates.status_code == 200
    assert {item["key"] for item in copy_templates.json()["items"]} == {"copy-entry-catalog-template"}

    blank_templates = admin_client.get("/api/workflow/canvas-templates", params={"initial_workflow_entry": "blank"})
    assert blank_templates.status_code == 200
    payload = blank_templates.json()["items"]
    assert "copy-entry-catalog-template" in {item["key"] for item in payload}
    assert {item["entry_mode"] for item in payload} >= {"image", "copy"}


def test_user_template_categories_and_templates_are_owner_scoped(configured_env: Path) -> None:
    from productflow_backend.presentation.api import create_app

    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)
    alice_client = _create_user_client(app, admin_client, "alice")
    bob_client = _create_user_client(app, admin_client, "bob")

    category = alice_client.post(
        "/api/workflow/user-template-categories",
        json={"name": "Alice 分类", "sort_order": 20},
    )
    assert category.status_code == 201
    product = _create_product(alice_client, "Alice 模板灵感")
    template = _save_first_node_group_template(alice_client, product["id"], category.json()["id"])

    alice_templates = alice_client.get("/api/workflow/canvas-templates", params={"scope": "user"})
    assert alice_templates.status_code == 200
    assert {item["key"] for item in alice_templates.json()["items"]} == {template["key"]}
    assert alice_templates.json()["items"][0]["category_name"] == "Alice 分类"

    bob_templates = bob_client.get("/api/workflow/canvas-templates", params={"scope": "user"})
    assert bob_templates.status_code == 200
    assert template["key"] not in {item["key"] for item in bob_templates.json()["items"]}

    bob_update = bob_client.patch(
        f"/api/workflow/user-template-groups/{template['user_template_id']}",
        json={"title": "Bob 不能改"},
    )
    assert bob_update.status_code == 404

    admin_update = admin_client.patch(
        f"/api/workflow/user-template-groups/{template['user_template_id']}",
        json={"title": "管理员不代改"},
    )
    assert admin_update.status_code == 400
    assert admin_update.json()["detail"] == "管理员不能直接编辑其他用户资源"

    admin_templates = admin_client.get("/api/workflow/canvas-templates", params={"scope": "user"})
    assert admin_templates.status_code == 200
    assert template["key"] in {item["key"] for item in admin_templates.json()["items"]}


def test_user_template_restore_is_owner_scoped(configured_env: Path) -> None:
    from productflow_backend.presentation.api import create_app

    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)
    alice_client = _create_user_client(app, admin_client, "alice")
    bob_client = _create_user_client(app, admin_client, "bob")

    product = _create_product(alice_client, "Alice 恢复模板灵感")
    template = _save_first_node_group_template(alice_client, product["id"])
    template_id = template["user_template_id"]

    archived = alice_client.delete(f"/api/workflow/user-template-groups/{template_id}")
    assert archived.status_code == 204
    assert template["key"] not in {
        item["key"]
        for item in alice_client.get("/api/workflow/canvas-templates", params={"scope": "user"}).json()["items"]
    }

    bob_restore = bob_client.post(f"/api/workflow/user-template-groups/{template_id}/restore")
    assert bob_restore.status_code == 404

    admin_restore = admin_client.post(f"/api/workflow/user-template-groups/{template_id}/restore")
    assert admin_restore.status_code == 400
    assert admin_restore.json()["detail"] == "管理员不能直接编辑其他用户资源"

    restored = alice_client.post(f"/api/workflow/user-template-groups/{template_id}/restore")
    assert restored.status_code == 200
    assert restored.json()["key"] == template["key"]


def test_global_template_management_requires_rbac_and_archives_restore(configured_env: Path) -> None:
    from productflow_backend.presentation.api import create_app

    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)
    alice_client = _create_user_client(app, admin_client, "alice")

    forbidden = alice_client.post(
        "/api/workflow/global-template-categories",
        json={"name": "普通用户不能建全局分类"},
    )
    assert forbidden.status_code == 403
    assert forbidden.json()["detail"] == "没有接口权限"

    category = admin_client.post(
        "/api/workflow/global-template-categories",
        json={"name": "运营全局模板", "sort_order": 5},
    )
    assert category.status_code == 201

    builtin = get_builtin_canvas_template("ecommerce-main-image-v1")
    created = admin_client.post(
        "/api/workflow/global-canvas-templates",
        json={
            "key": "custom-global-main-v1",
            "title": "运营主图模板",
            "description": "运营维护的全局模板",
            "kind": "full_canvas",
            "entry_mode": "image",
            "sort_order": 9,
            "category_id": category.json()["id"],
            "template_json": builtin.model_dump(mode="json"),
        },
    )
    assert created.status_code == 201
    template_id = created.json()["template_id"]

    alice_search = alice_client.get("/api/workflow/canvas-templates", params={"search": "运营主图"})
    assert alice_search.status_code == 200
    assert {item["key"] for item in alice_search.json()["items"]} == {"custom-global-main-v1"}

    archived = admin_client.delete(f"/api/workflow/global-canvas-templates/{template_id}")
    assert archived.status_code == 204
    hidden = alice_client.get("/api/workflow/canvas-templates", params={"search": "运营主图"})
    assert hidden.status_code == 200
    assert hidden.json()["items"] == []

    restored = admin_client.post(f"/api/workflow/global-canvas-templates/{template_id}/restore")
    assert restored.status_code == 200
    assert restored.json()["key"] == "custom-global-main-v1"
    assert restored.json()["sort_order"] == 9


def test_disabled_template_category_cannot_be_reused(configured_env: Path) -> None:
    from productflow_backend.presentation.api import create_app

    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)
    alice_client = _create_user_client(app, admin_client, "alice")

    category = alice_client.post(
        "/api/workflow/user-template-categories",
        json={"name": "待屏蔽分类"},
    )
    assert category.status_code == 201

    disabled = admin_client.post(
        f"/api/resources/canvas_template_category/{category.json()['id']}/disable",
        json={"reason": "分类暂不可用"},
    )
    assert disabled.status_code == 200

    product = _create_product(alice_client, "分类屏蔽灵感")
    workflow = alice_client.get(f"/api/products/{product['id']}/workflow")
    assert workflow.status_code == 200
    copy_node = next(node for node in workflow.json()["nodes"] if node["node_type"] == "copy_generation")

    blocked = alice_client.post(
        f"/api/products/{product['id']}/workflow/user-template-groups",
        json={
            "title": "不能挂屏蔽分类",
            "node_ids": [copy_node["id"]],
            "category_id": category.json()["id"],
        },
    )
    assert blocked.status_code == 400
    assert blocked.json()["detail"] == "资源已被管理员屏蔽，暂不可使用"
