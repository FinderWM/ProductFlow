from __future__ import annotations

import hashlib
from pathlib import Path

from fastapi.testclient import TestClient
from helpers import _execute_workflow_queue_inline, _login

from inspiration_one_backend.infrastructure.db.models import DEFAULT_GENERATION_RESOURCE_GROUP_ID, AuthUser
from inspiration_one_backend.infrastructure.db.session import get_session_factory


def _password_md5(value: str) -> str:
    return hashlib.md5(value.encode(), usedforsecurity=False).hexdigest()


def _set_password(client: TestClient, *, username: str, password: str, setup_token: str):
    return client.post(
        "/api/auth/password",
        json={"username": username, "password": password, "setup_token": setup_token},
    )


def test_admin_can_seed_password_and_receives_all_menus(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

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


def test_legacy_password_hash_is_upgraded_after_plain_password_login(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)

    created_user = admin_client.post(
        "/api/rbac/users",
        json={"username": "legacy-user", "display_name": "Legacy User"},
    )
    assert created_user.status_code == 201
    legacy_client_md5 = _password_md5("legacy-password")
    legacy_salt = "legacy-salt"
    legacy_hash = hashlib.md5(f"{legacy_client_md5}:{legacy_salt}".encode(), usedforsecurity=False).hexdigest()
    with get_session_factory()() as session:
        user = session.get(AuthUser, created_user.json()["id"])
        assert user is not None
        user.password_hash = legacy_hash
        user.password_salt = legacy_salt
        user.password_setup_token_hash = None
        user.password_setup_token_expires_at = None
        session.commit()

    client = TestClient(app)
    login = client.post("/api/auth/login", json={"username": "legacy-user", "password": "legacy-password"})

    assert login.status_code == 200
    with get_session_factory()() as session:
        user = session.get(AuthUser, created_user.json()["id"])
        assert user is not None
        assert user.password_hash is not None
        assert user.password_hash.startswith("scrypt$")
        assert user.password_salt is None


def test_legacy_password_hash_is_not_upgraded_after_client_md5_login(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)

    created_user = admin_client.post(
        "/api/rbac/users",
        json={"username": "legacy-md5-user", "display_name": "Legacy MD5 User"},
    )
    assert created_user.status_code == 201
    legacy_client_md5 = _password_md5("legacy-password")
    legacy_salt = "legacy-md5-salt"
    legacy_hash = hashlib.md5(f"{legacy_client_md5}:{legacy_salt}".encode(), usedforsecurity=False).hexdigest()
    with get_session_factory()() as session:
        user = session.get(AuthUser, created_user.json()["id"])
        assert user is not None
        user.password_hash = legacy_hash
        user.password_salt = legacy_salt
        user.password_setup_token_hash = None
        user.password_setup_token_expires_at = None
        session.commit()

    legacy_client = TestClient(app)
    legacy_login = legacy_client.post(
        "/api/auth/login",
        json={"username": "legacy-md5-user", "client_password_md5": legacy_client_md5},
    )
    assert legacy_login.status_code == 200
    with get_session_factory()() as session:
        user = session.get(AuthUser, created_user.json()["id"])
        assert user is not None
        assert user.password_hash == legacy_hash
        assert user.password_salt == legacy_salt

    plain_client = TestClient(app)
    plain_login = plain_client.post(
        "/api/auth/login",
        json={"username": "legacy-md5-user", "password": "legacy-password"},
    )
    assert plain_login.status_code == 200
    with get_session_factory()() as session:
        user = session.get(AuthUser, created_user.json()["id"])
        assert user is not None
        assert user.password_hash is not None
        assert user.password_hash.startswith("scrypt$")
        assert user.password_salt is None


def test_password_setup_requires_one_time_token(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)

    created_user = admin_client.post(
        "/api/rbac/users",
        json={"username": "token-user", "display_name": "Token User"},
    )
    assert created_user.status_code == 201
    setup_token = created_user.json()["password_setup_token"]
    client = TestClient(app)

    missing_token = client.post(
        "/api/auth/password",
        json={"username": "token-user", "password": "token-password"},
    )
    assert missing_token.status_code == 422

    wrong_token = _set_password(client, username="token-user", password="token-password", setup_token="wrong-token")
    assert wrong_token.status_code == 400
    assert wrong_token.json()["detail"] == "设密凭据无效或已过期"

    correct_token = _set_password(client, username="token-user", password="token-password", setup_token=setup_token)
    assert correct_token.status_code == 200

    reused_token = _set_password(client, username="token-user", password="other-password", setup_token=setup_token)
    assert reused_token.status_code == 400
    assert reused_token.json()["detail"] == "该账号已设置密码"


def test_default_user_role_excludes_settings_and_rbac_permissions(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)

    created_user = admin_client.post(
        "/api/rbac/users",
        json={"username": "alice", "display_name": "Alice"},
    )
    assert created_user.status_code == 201
    assert created_user.json()["password_pending"] is True
    setup_token = created_user.json()["password_setup_token"]
    grant = admin_client.put(
        f"/api/rbac/users/{created_user.json()['id']}/generation-resource-groups",
        json={"resource_group_ids": [DEFAULT_GENERATION_RESOURCE_GROUP_ID]},
    )
    assert grant.status_code == 200

    user_client = TestClient(app)
    set_password = _set_password(
        user_client,
        username="alice",
        password="alice-password",
        setup_token=setup_token,
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

    inspirations = user_client.get(
        "/api/inspirations", params={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID}
    )
    assert inspirations.status_code == 200

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


def test_admin_can_grant_generation_resource_groups_to_user(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)

    created_group = admin_client.post(
        "/api/settings/generation-resource-groups",
        json={"key": "campaign", "name": "活动分组", "sort_order": 20, "enabled": True},
    )
    assert created_group.status_code == 200
    group_id = created_group.json()["id"]

    admin_groups = admin_client.get("/api/settings/my-generation-resource-groups")
    assert admin_groups.status_code == 200
    assert group_id in {group["id"] for group in admin_groups.json()}

    created_user = admin_client.post(
        "/api/rbac/users",
        json={"username": "campaign-user", "display_name": "Campaign User"},
    )
    assert created_user.status_code == 201
    assert created_user.json()["resource_groups"] == []
    user_id = created_user.json()["id"]

    admin_user_page = admin_client.get("/api/rbac/users", params={"username": "libow", "page": 1, "page_size": 10})
    assert admin_user_page.status_code == 200
    admin_user = next(item for item in admin_user_page.json()["items"] if item["is_admin"])
    assert DEFAULT_GENERATION_RESOURCE_GROUP_ID in {group["id"] for group in admin_user["resource_groups"]}
    assert group_id in {group["id"] for group in admin_user["resource_groups"]}

    regular_user_page = admin_client.get(
        "/api/rbac/users",
        params={"username": "campaign-user", "page": 1, "page_size": 10},
    )
    assert regular_user_page.status_code == 200
    regular_user = regular_user_page.json()["items"][0]
    assert regular_user["resource_groups"] == []

    user_client = TestClient(app)
    set_password = _set_password(
        user_client,
        username="campaign-user",
        password="campaign-password",
        setup_token=created_user.json()["password_setup_token"],
    )
    assert set_password.status_code == 200

    before_grant = user_client.get("/api/settings/my-generation-resource-groups")
    assert before_grant.status_code == 200
    assert before_grant.json() == []

    grant = admin_client.put(
        f"/api/rbac/users/{user_id}/generation-resource-groups",
        json={"resource_group_ids": [group_id]},
    )
    assert grant.status_code == 200
    assert grant.json() == {"user_id": user_id, "resource_group_ids": [group_id]}

    after_grant = user_client.get("/api/settings/my-generation-resource-groups")
    assert after_grant.status_code == 200
    assert [group["id"] for group in after_grant.json()] == [group_id]

    granted_user_page = admin_client.get(
        "/api/rbac/users",
        params={"username": "campaign-user", "page": 1, "page_size": 10},
    )
    assert granted_user_page.status_code == 200
    granted_user = granted_user_page.json()["items"][0]
    assert granted_user["resource_groups"] == [{"id": group_id, "key": "campaign", "name": "活动分组"}]


def test_admin_can_page_and_filter_rbac_users_and_role_counts(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)

    alpha_role = admin_client.post("/api/rbac/roles", json={"code": "alpha_ops", "name": "Alpha Ops"})
    assert alpha_role.status_code == 201
    alpha_role_id = alpha_role.json()["id"]
    beta_role = admin_client.post("/api/rbac/roles", json={"code": "beta_ops", "name": "Beta Ops"})
    assert beta_role.status_code == 201
    beta_role_id = beta_role.json()["id"]

    for username, role_id in (
        ("alpha-one", alpha_role_id),
        ("alpha-two", alpha_role_id),
        ("beta-one", beta_role_id),
    ):
        created_user = admin_client.post(
            "/api/rbac/users",
            json={"username": username, "display_name": username, "role_id": role_id},
        )
        assert created_user.status_code == 201

    username_page = admin_client.get("/api/rbac/users", params={"username": "alpha", "page": 1, "page_size": 1})
    assert username_page.status_code == 200
    username_payload = username_page.json()
    assert username_payload["total"] == 2
    assert username_payload["page"] == 1
    assert username_payload["page_size"] == 1
    assert len(username_payload["items"]) == 1
    assert username_payload["items"][0]["username"] == "alpha-one"

    role_page = admin_client.get("/api/rbac/users", params={"role_id": alpha_role_id, "page": 1, "page_size": 10})
    assert role_page.status_code == 200
    role_payload = role_page.json()
    assert role_payload["total"] == 2
    assert {item["username"] for item in role_payload["items"]} == {"alpha-one", "alpha-two"}

    roles = admin_client.get("/api/rbac/roles")
    assert roles.status_code == 200
    role_counts = {role["code"]: role["user_count"] for role in roles.json()}
    assert role_counts["alpha_ops"] == 2
    assert role_counts["beta_ops"] == 1


def test_runtime_and_generation_option_apis_require_matching_rbac_permission(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

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
    set_password = _set_password(
        user_client,
        username="status-only",
        password="status-password",
        setup_token=created_user.json()["password_setup_token"],
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
    from inspiration_one_backend.presentation.api import create_app

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


def test_global_template_permission_lives_under_settings_menu(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)

    catalog = admin_client.get("/api/rbac/permissions")
    assert catalog.status_code == 200
    template_permission = next(
        item for item in catalog.json()["api_permissions"] if item["code"] == "templates:manage_global"
    )
    assert template_permission["menu_code"] == "settings"

    created_role = admin_client.post("/api/rbac/roles", json={"code": "template_ops", "name": "模板配置"})
    assert created_role.status_code == 201
    role_id = created_role.json()["id"]

    permissions = admin_client.put(
        f"/api/rbac/roles/{role_id}/permissions",
        json={"menu_codes": [], "api_permission_codes": ["templates:manage_global"]},
    )
    assert permissions.status_code == 200
    payload = permissions.json()
    assert payload["menu_codes"] == ["settings"]
    assert payload["api_permission_codes"] == ["settings:read", "templates:manage_global"]


def test_settings_provider_write_permission_is_separate_from_runtime_write(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

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
    set_password = _set_password(
        user_client,
        username="provider-ops",
        password="provider-ops-password",
        setup_token=created_user.json()["password_setup_token"],
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

    created_group = user_client.post(
        "/api/settings/generation-resource-groups",
        json={"key": "provider_ops_group", "name": "供应商运维分组", "sort_order": 30, "enabled": True},
    )
    assert created_group.status_code == 200
    group_id = created_group.json()["id"]

    created_generation_config = user_client.post(
        "/api/settings/generation-configs",
        json={
            "resource_group_id": group_id,
            "name": "供应商运维文案配置",
            "purpose": "text",
            "provider_kind": "mock",
            "model_settings": {"brief_model": "mock-brief", "copy_model": "mock-copy"},
            "config": {},
            "priority": 50,
            "max_concurrency": 1,
            "enabled": True,
        },
    )
    assert created_generation_config.status_code == 200

    update_runtime = user_client.patch("/api/settings", json={"values": {"deletion_enabled": True}})
    assert update_runtime.status_code == 403
    assert update_runtime.json()["detail"] == "没有接口权限"


def test_settings_migrate_permission_is_separate_from_provider_write_and_runtime_write(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

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
    set_password = _set_password(
        user_client,
        username="settings-migrator",
        password="settings-migrator-password",
        setup_token=created_user.json()["password_setup_token"],
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
    from inspiration_one_backend.presentation.api import create_app

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
    assert (
        _set_password(
            user_client,
            username="bob",
            password="bob-password",
            setup_token=created_user.json()["password_setup_token"],
        ).status_code
        == 200
    )

    reset = admin_client.post(f"/api/rbac/users/{user_id}/reset-password")
    assert reset.status_code == 200
    assert reset.json()["password_pending"] is True
    assert reset.json()["password_setup_token"]

    login = user_client.post("/api/auth/login", json={"username": "bob", "password": "bob-password"})
    assert login.status_code == 401


def test_tail_workflow_endpoints_follow_generate_and_write_permissions(
    configured_env: Path,
    monkeypatch,
) -> None:
    from inspiration_one_backend.presentation.api import create_app

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
    grant = admin_client.put(
        f"/api/rbac/users/{created_user.json()['id']}/generation-resource-groups",
        json={"resource_group_ids": [DEFAULT_GENERATION_RESOURCE_GROUP_ID]},
    )
    assert grant.status_code == 200

    user_client = TestClient(app)
    set_password = _set_password(
        user_client,
        username="tail-ops",
        password="tail-ops-password",
        setup_token=created_user.json()["password_setup_token"],
    )
    assert set_password.status_code == 200

    created_inspiration = user_client.post(
        "/api/inspirations",
        data={
            "name": "Tail RBAC 灵感产物",
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "initial_workflow_entry": "tail",
            "entry_text": "免安装、收纳整洁、细节材质、不同场景摆放。",
        },
    )
    assert created_inspiration.status_code == 201
    inspiration_id = created_inspiration.json()["id"]

    workflow = user_client.get(f"/api/inspirations/{inspiration_id}/workflow")
    assert workflow.status_code == 200
    tail_node = next(node for node in workflow.json()["nodes"] if node["node_type"] == "tail_splitter")
    tail_node_id = tail_node["id"]

    configured_tail = user_client.patch(
        f"/api/workflow-nodes/{tail_node_id}",
        json={"config_json": {**tail_node["config_json"], "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID}},
    )
    assert configured_tail.status_code == 200

    apply_with_write_permission = user_client.post(
        f"/api/workflow-nodes/{tail_node_id}/tail-split-plan/apply",
        json={"plan_id": "plan-missing", "item_ids": []},
    )
    assert apply_with_write_permission.status_code == 400
    assert "拆分计划" in apply_with_write_permission.json()["detail"]

    run_without_generate_permission = user_client.post(
        f"/api/inspirations/{inspiration_id}/workflow/run",
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
        f"/api/inspirations/{inspiration_id}/workflow/run",
        json={"start_node_id": tail_node_id},
    )
    assert run_with_generate_permission.status_code == 200

    apply_without_write_permission = user_client.post(
        f"/api/workflow-nodes/{tail_node_id}/tail-split-plan/apply",
        json={"plan_id": "plan-missing", "item_ids": []},
    )
    assert apply_without_write_permission.status_code == 403
    assert apply_without_write_permission.json()["detail"] == "没有接口权限"
