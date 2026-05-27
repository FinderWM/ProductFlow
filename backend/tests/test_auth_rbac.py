from __future__ import annotations

import hashlib
from pathlib import Path

from fastapi.testclient import TestClient
from helpers import _login


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
    assert "rbac:manage" not in payload["api_permissions"]

    products = user_client.get("/api/products")
    assert products.status_code == 200

    settings = user_client.get("/api/settings")
    assert settings.status_code == 403
    assert settings.json()["detail"] == "没有接口权限"

    rbac_users = user_client.get("/api/rbac/users")
    assert rbac_users.status_code == 403
    assert rbac_users.json()["detail"] == "需要管理员权限"


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
