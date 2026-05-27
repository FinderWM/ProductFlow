from __future__ import annotations

import hashlib
from pathlib import Path

from fastapi.testclient import TestClient
from helpers import _execute_workflow_queue_inline, _login


def _password_md5(value: str) -> str:
    return hashlib.md5(value.encode(), usedforsecurity=False).hexdigest()


def test_admin_can_seed_password_and_receives_all_menus(configured_env: Path) -> None:
    from productflow_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)

    _login(client)

    state = client.get("/api/auth/session")
    assert state.status_code == 200
    payload = state.json()
    assert payload["authenticated"] is True
    assert payload["user"]["username"] == "libow"
    assert payload["user"]["is_admin"] is True
    assert {menu["code"] for menu in payload["menus"]} >= {"inspirations", "settings", "rbac"}
    assert "rbac:manage" in payload["api_permissions"]


def test_default_user_role_excludes_settings_and_rbac_permissions(configured_env: Path) -> None:
    from productflow_backend.presentation.api import create_app

    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)

    created_user = admin_client.post(
        "/api/rbac/users",
        json={"username": "alice", "display_name": "Alice"},
    )
    assert created_user.status_code == 201
    assert created_user.json()["password_pending"] is True

    user_client = TestClient(app)
    password_md5 = _password_md5("alice-password")
    set_password = user_client.post(
        "/api/auth/password",
        json={"username": "alice", "client_password_md5": password_md5},
    )
    assert set_password.status_code == 200

    session_state = user_client.get("/api/auth/session")
    assert session_state.status_code == 200
    payload = session_state.json()
    assert payload["authenticated"] is True
    assert payload["user"]["username"] == "alice"
    assert {menu["code"] for menu in payload["menus"]} == {
        "inspirations",
        "image_chat",
        "gallery",
        "status",
        "usage_stats",
    }
    assert "settings:read" not in payload["api_permissions"]
    assert "settings:provider_write" not in payload["api_permissions"]
    assert "settings:migrate" not in payload["api_permissions"]
    assert "rbac:manage" not in payload["api_permissions"]

    products = user_client.get("/api/products")
    assert products.status_code == 200

    status_page_data = user_client.get("/api/settings/generation-config-status")
    assert status_page_data.status_code == 200

    runtime_config = user_client.get("/api/settings/runtime")
    assert runtime_config.status_code == 200

    generation_options = user_client.get("/api/settings/generation-config-options")
    assert generation_options.status_code == 200

    settings = user_client.get("/api/settings")
    assert settings.status_code == 403
    assert settings.json()["detail"] == "没有接口权限"

    provider_config = user_client.get("/api/settings/provider-config")
    assert provider_config.status_code == 403
    assert provider_config.json()["detail"] == "没有接口权限"

    generation_configs = user_client.get("/api/settings/generation-configs")
    assert generation_configs.status_code == 403
    assert generation_configs.json()["detail"] == "没有接口权限"

    rbac_users = user_client.get("/api/rbac/users")
    assert rbac_users.status_code == 403
    assert rbac_users.json()["detail"] == "需要管理员权限"


def test_runtime_and_generation_option_apis_require_matching_rbac_permission(configured_env: Path) -> None:
    from productflow_backend.presentation.api import create_app

    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)

    created_role = admin_client.post("/api/rbac/roles", json={"code": "status_reader", "name": "状态只读"})
    assert created_role.status_code == 201
    role_id = created_role.json()["id"]

    permissions = admin_client.put(
        f"/api/rbac/roles/{role_id}/permissions",
        json={"menu_codes": ["status"], "api_permission_codes": ["status:read"]},
    )
    assert permissions.status_code == 200

    created_user = admin_client.post(
        "/api/rbac/users",
        json={"username": "status-only", "display_name": "Status Only", "role_id": role_id},
    )
    assert created_user.status_code == 201

    user_client = TestClient(app)
    password_md5 = _password_md5("status-password")
    set_password = user_client.post(
        "/api/auth/password",
        json={"username": "status-only", "client_password_md5": password_md5},
    )
    assert set_password.status_code == 200

    status_page_data = user_client.get("/api/settings/generation-config-status")
    assert status_page_data.status_code == 200

    runtime_config = user_client.get("/api/settings/runtime")
    assert runtime_config.status_code == 403
    assert runtime_config.json()["detail"] == "没有接口权限"

    generation_options = user_client.get("/api/settings/generation-config-options")
    assert generation_options.status_code == 403
    assert generation_options.json()["detail"] == "没有接口权限"

    settings = user_client.get("/api/settings")
    assert settings.status_code == 403
    assert settings.json()["detail"] == "没有接口权限"


def test_role_permission_save_auto_adds_settings_menu_and_read_permission(configured_env: Path) -> None:
    from productflow_backend.presentation.api import create_app

    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)

    created_role = admin_client.post("/api/rbac/roles", json={"code": "settings_ops", "name": "设置运维"})
    assert created_role.status_code == 201
    role_id = created_role.json()["id"]

    permissions = admin_client.put(
        f"/api/rbac/roles/{role_id}/permissions",
        json={"menu_codes": [], "api_permission_codes": ["settings:provider_write", "settings:migrate"]},
    )
    assert permissions.status_code == 200
    payload = permissions.json()
    assert payload["menu_codes"] == ["settings"]
    assert payload["api_permission_codes"] == ["settings:migrate", "settings:provider_write", "settings:read"]

    fetched = admin_client.get(f"/api/rbac/roles/{role_id}/permissions")
    assert fetched.status_code == 200
    fetched_payload = fetched.json()
    assert fetched_payload["menu_codes"] == ["settings"]
    assert fetched_payload["api_permission_codes"] == ["settings:migrate", "settings:provider_write", "settings:read"]


def test_settings_provider_write_permission_is_separate_from_runtime_write(configured_env: Path) -> None:
    from productflow_backend.presentation.api import create_app

    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)

    created_role = admin_client.post("/api/rbac/roles", json={"code": "provider_ops", "name": "供应商运维"})
    assert created_role.status_code == 201
    role_id = created_role.json()["id"]

    permissions = admin_client.put(
        f"/api/rbac/roles/{role_id}/permissions",
        json={"menu_codes": [], "api_permission_codes": ["settings:provider_write"]},
    )
    assert permissions.status_code == 200

    created_user = admin_client.post(
        "/api/rbac/users",
        json={"username": "provider-ops", "display_name": "Provider Ops", "role_id": role_id},
    )
    assert created_user.status_code == 201

    user_client = TestClient(app)
    password_md5 = _password_md5("provider-ops-password")
    set_password = user_client.post(
        "/api/auth/password",
        json={"username": "provider-ops", "client_password_md5": password_md5},
    )
    assert set_password.status_code == 200

    provider_config = user_client.get("/api/settings/provider-config")
    assert provider_config.status_code == 200

    created_profile = user_client.post(
        "/api/settings/provider-profiles",
        json={
            "name": "图片网关",
            "base_url": "https://image.example/v1",
            "api_key": "image-secret-key",
            "capabilities": ["image_images"],
            "default_models": {"image_model": "gpt-image-2"},
            "config": {},
            "enabled": True,
        },
    )
    assert created_profile.status_code == 200

    update_runtime = user_client.patch("/api/settings", json={"values": {"deletion_enabled": True}})
    assert update_runtime.status_code == 403
    assert update_runtime.json()["detail"] == "没有接口权限"


def test_settings_migrate_permission_is_separate_from_provider_write_and_runtime_write(configured_env: Path) -> None:
    from productflow_backend.presentation.api import create_app

    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)
    exported = admin_client.get("/api/settings/export")
    assert exported.status_code == 200

    created_role = admin_client.post("/api/rbac/roles", json={"code": "settings_migrator", "name": "设置迁移"})
    assert created_role.status_code == 201
    role_id = created_role.json()["id"]

    permissions = admin_client.put(
        f"/api/rbac/roles/{role_id}/permissions",
        json={"menu_codes": [], "api_permission_codes": ["settings:migrate"]},
    )
    assert permissions.status_code == 200

    created_user = admin_client.post(
        "/api/rbac/users",
        json={"username": "settings-migrator", "display_name": "Settings Migrator", "role_id": role_id},
    )
    assert created_user.status_code == 201

    user_client = TestClient(app)
    password_md5 = _password_md5("settings-migrator-password")
    set_password = user_client.post(
        "/api/auth/password",
        json={"username": "settings-migrator", "client_password_md5": password_md5},
    )
    assert set_password.status_code == 200

    preview = user_client.post("/api/settings/import/preview", json=exported.json())
    assert preview.status_code == 200

    provider_profile = user_client.post(
        "/api/settings/provider-profiles",
        json={
            "name": "图片网关",
            "base_url": "https://image.example/v1",
            "api_key": "image-secret-key",
            "capabilities": ["image_images"],
            "default_models": {"image_model": "gpt-image-2"},
            "config": {},
            "enabled": True,
        },
    )
    assert provider_profile.status_code == 403
    assert provider_profile.json()["detail"] == "没有接口权限"

    update_runtime = user_client.patch("/api/settings", json={"values": {"deletion_enabled": True}})
    assert update_runtime.status_code == 403
    assert update_runtime.json()["detail"] == "没有接口权限"


def test_admin_can_reset_regular_user_password_to_pending(configured_env: Path) -> None:
    from productflow_backend.presentation.api import create_app

    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)

    created_user = admin_client.post(
        "/api/rbac/users",
        json={"username": "bob", "display_name": "Bob"},
    )
    assert created_user.status_code == 201
    user_id = created_user.json()["id"]

    user_client = TestClient(app)
    password_md5 = _password_md5("bob-password")
    assert user_client.post(
        "/api/auth/password",
        json={"username": "bob", "client_password_md5": password_md5},
    ).status_code == 200

    reset = admin_client.post(f"/api/rbac/users/{user_id}/reset-password")
    assert reset.status_code == 200
    assert reset.json()["password_pending"] is True

    login = user_client.post("/api/auth/login", json={"username": "bob", "client_password_md5": password_md5})
    assert login.status_code == 401


def test_tail_workflow_endpoints_follow_generate_and_write_permissions(
    configured_env: Path,
    monkeypatch,
) -> None:
    from productflow_backend.presentation.api import create_app

    _execute_workflow_queue_inline(monkeypatch)
    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)

    created_role = admin_client.post("/api/rbac/roles", json={"code": "tail_ops", "name": "Tail Ops"})
    assert created_role.status_code == 201
    role_id = created_role.json()["id"]

    permissions = admin_client.put(
        f"/api/rbac/roles/{role_id}/permissions",
        json={
            "menu_codes": ["inspirations"],
            "api_permission_codes": ["inspirations:read", "inspirations:write"],
        },
    )
    assert permissions.status_code == 200

    created_user = admin_client.post(
        "/api/rbac/users",
        json={"username": "tail-ops", "display_name": "Tail Ops", "role_id": role_id},
    )
    assert created_user.status_code == 201

    user_client = TestClient(app)
    password_md5 = _password_md5("tail-ops-password")
    set_password = user_client.post(
        "/api/auth/password",
        json={"username": "tail-ops", "client_password_md5": password_md5},
    )
    assert set_password.status_code == 200

    created_product = user_client.post(
        "/api/products",
        data={"name": "Tail RBAC 商品", "initial_workflow_entry": "tail"},
    )
    assert created_product.status_code == 201
    product_id = created_product.json()["id"]

    workflow = user_client.get(f"/api/products/{product_id}/workflow")
    assert workflow.status_code == 200
    tail_node_id = next(
        node["id"] for node in workflow.json()["nodes"] if node["node_type"] == "tail_splitter"
    )

    apply_with_write_permission = user_client.post(
        f"/api/workflow-nodes/{tail_node_id}/tail-split-plan/apply",
        json={"plan_id": "plan-missing", "item_ids": []},
    )
    assert apply_with_write_permission.status_code == 400
    assert "拆分计划" in apply_with_write_permission.json()["detail"]

    run_without_generate_permission = user_client.post(
        f"/api/products/{product_id}/workflow/run",
        json={"start_node_id": tail_node_id},
    )
    assert run_without_generate_permission.status_code == 403
    assert run_without_generate_permission.json()["detail"] == "没有接口权限"

    updated_permissions = admin_client.put(
        f"/api/rbac/roles/{role_id}/permissions",
        json={
            "menu_codes": ["inspirations"],
            "api_permission_codes": ["inspirations:read", "inspirations:generate"],
        },
    )
    assert updated_permissions.status_code == 200

    run_with_generate_permission = user_client.post(
        f"/api/products/{product_id}/workflow/run",
        json={"start_node_id": tail_node_id},
    )
    assert run_with_generate_permission.status_code == 200

    apply_without_write_permission = user_client.post(
        f"/api/workflow-nodes/{tail_node_id}/tail-split-plan/apply",
        json={"plan_id": "plan-missing", "item_ids": []},
    )
    assert apply_without_write_permission.status_code == 403
    assert apply_without_write_permission.json()["detail"] == "没有接口权限"
