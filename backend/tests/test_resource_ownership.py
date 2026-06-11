from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from helpers import _enable_deletion, _login, _make_demo_image_bytes

from inspiration_one_backend.application.auth import ensure_auth_bootstrapped
from inspiration_one_backend.application.ownership import resolve_owner_user_id
from inspiration_one_backend.domain.errors import BusinessValidationError
from inspiration_one_backend.domain.rbac import ADMIN_USER_ID
from inspiration_one_backend.infrastructure.db.models import DEFAULT_GENERATION_RESOURCE_GROUP_ID, AuthUser, Inspiration

RESOURCE_DISABLED_MESSAGE = "资源已被管理员屏蔽，暂不可使用"


def _create_user_client(app, admin_client: TestClient, username: str, *, role_id: str | None = None) -> TestClient:
    payload = {"username": username, "display_name": username.title()}
    if role_id is not None:
        payload["role_id"] = role_id
    created_user = admin_client.post(
        "/api/rbac/users",
        json=payload,
    )
    assert created_user.status_code == 201
    grant = admin_client.put(
        f"/api/rbac/users/{created_user.json()['id']}/generation-resource-groups",
        json={"resource_group_ids": [DEFAULT_GENERATION_RESOURCE_GROUP_ID]},
    )
    assert grant.status_code == 200

    client = TestClient(app)
    set_password = client.post(
        "/api/auth/password",
        json={
            "username": username,
            "password": f"{username}-password",
            "setup_token": created_user.json()["password_setup_token"],
        },
    )
    assert set_password.status_code == 200
    return client


def _create_inspiration(client: TestClient, name: str) -> dict:
    created = client.post(
        "/api/inspirations",
        data={"name": name, "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID},
        files={"image": (f"{name}.png", _make_demo_image_bytes(), "image/png")},
    )
    assert created.status_code == 201
    return created.json()


def _set_inspiration_updated_at(db_session, inspiration_id: str, value: datetime) -> None:
    inspiration = db_session.get(Inspiration, inspiration_id)
    assert inspiration is not None
    inspiration.updated_at = value
    db_session.commit()


def test_resolve_owner_user_id_rejects_missing_or_archived_user(db_session) -> None:
    ensure_auth_bootstrapped(db_session)

    assert resolve_owner_user_id(db_session, ADMIN_USER_ID) == ADMIN_USER_ID
    with pytest.raises(BusinessValidationError, match="资源归属账号不存在"):
        resolve_owner_user_id(db_session, "missing-user")

    admin = db_session.get(AuthUser, ADMIN_USER_ID)
    assert admin is not None
    admin.archived_at = datetime.now(UTC)
    db_session.commit()

    with pytest.raises(BusinessValidationError, match="资源归属账号不存在"):
        resolve_owner_user_id(db_session, ADMIN_USER_ID)


def test_inspiration_owner_isolation_and_admin_read_only_view(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)
    alice_client = _create_user_client(app, admin_client, "alice")

    admin_inspiration = _create_inspiration(admin_client, "管理员灵感")
    alice_inspiration = _create_inspiration(alice_client, "Alice 灵感")

    alice_list = alice_client.get(
        "/api/inspirations", params={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID}
    )
    assert alice_list.status_code == 200
    alice_items = alice_list.json()["items"]
    assert [item["id"] for item in alice_items] == [alice_inspiration["id"]]
    assert alice_items[0]["owner_username"] == "alice"

    assert alice_client.get(f"/api/inspirations/{admin_inspiration['id']}").status_code == 404
    admin_source_id = admin_inspiration["source_assets"][0]["id"]
    assert alice_client.get(f"/api/source-assets/{admin_source_id}/download").status_code == 404

    admin_list = admin_client.get(
        "/api/inspirations", params={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID}
    )
    assert admin_list.status_code == 200
    owner_by_id = {item["id"]: item["owner_username"] for item in admin_list.json()["items"]}
    assert owner_by_id[admin_inspiration["id"]] == "libow"
    assert owner_by_id[alice_inspiration["id"]] == "alice"

    admin_detail = admin_client.get(f"/api/inspirations/{alice_inspiration['id']}")
    assert admin_detail.status_code == 200
    assert admin_detail.json()["owner_username"] == "alice"

    _enable_deletion(admin_client)
    admin_delete_other = admin_client.delete(f"/api/inspirations/{alice_inspiration['id']}")
    assert admin_delete_other.status_code == 400
    assert admin_delete_other.json()["detail"] == "管理员不能直接编辑其他用户资源"


def test_inspiration_list_filters_by_title_update_time_and_owner(configured_env: Path, db_session) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)
    alice_client = _create_user_client(app, admin_client, "alice")
    bob_client = _create_user_client(app, admin_client, "bob")

    admin_inspiration = _create_inspiration(admin_client, "管理员夏季杯")
    alice_match = _create_inspiration(alice_client, "Alice 夏季托特包")
    alice_outside_range = _create_inspiration(alice_client, "Alice 夏季围巾")
    bob_match = _create_inspiration(bob_client, "Bob 夏季托特包")

    _set_inspiration_updated_at(db_session, admin_inspiration["id"], datetime(2026, 5, 9, 12, 0, 0, tzinfo=UTC))
    _set_inspiration_updated_at(db_session, alice_match["id"], datetime(2026, 5, 10, 10, 11, 12, tzinfo=UTC))
    _set_inspiration_updated_at(db_session, alice_outside_range["id"], datetime(2026, 5, 12, 9, 0, 0, tzinfo=UTC))
    _set_inspiration_updated_at(db_session, bob_match["id"], datetime(2026, 5, 10, 18, 30, 45, tzinfo=UTC))

    admin_filtered = admin_client.get(
        "/api/inspirations",
        params={
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "title": "托特",
            "updated_from": "2026-05-10",
            "updated_to": "2026-05-10",
            "owner_user_id": alice_match["owner_user_id"],
        },
    )

    assert admin_filtered.status_code == 200
    assert admin_filtered.json()["total"] == 1
    assert [item["id"] for item in admin_filtered.json()["items"]] == [alice_match["id"]]

    alice_filtered = alice_client.get(
        "/api/inspirations",
        params={
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "title": "托特",
            "updated_from": "2026-05-10",
            "updated_to": "2026-05-10",
            "owner_user_id": bob_match["owner_user_id"],
        },
    )

    assert alice_filtered.status_code == 200
    assert alice_filtered.json()["total"] == 1
    assert [item["id"] for item in alice_filtered.json()["items"]] == [alice_match["id"]]


def test_image_session_owner_isolation_and_gallery_owner(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)
    alice_client = _create_user_client(app, admin_client, "alice")
    bob_client = _create_user_client(app, admin_client, "bob")

    created_session = alice_client.post("/api/image-sessions", json={"title": "Alice 会话"})
    assert created_session.status_code == 201
    session_id = created_session.json()["id"]
    assert created_session.json()["owner_username"] == "alice"

    generated = alice_client.post(
        f"/api/image-sessions/{session_id}/generate",
        json={
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "prompt": "生成一张白底产品图",
            "size": "1024x1024",
        },
    )
    assert generated.status_code == 202
    asset_id = generated.json()["rounds"][0]["generated_asset"]["id"]
    assert generated.json()["rounds"][0]["generated_asset"]["owner_user_id"] == created_session.json()["owner_user_id"]

    assert bob_client.get(f"/api/image-sessions/{session_id}").status_code == 404
    assert bob_client.get(f"/api/image-session-assets/{asset_id}/download").status_code == 404
    assert bob_client.post("/api/gallery", json={"image_session_asset_id": asset_id}).status_code == 404

    admin_detail = admin_client.get(f"/api/image-sessions/{session_id}")
    assert admin_detail.status_code == 200
    assert admin_detail.json()["owner_username"] == "alice"

    admin_save_other_gallery = admin_client.post("/api/gallery", json={"image_session_asset_id": asset_id})
    assert admin_save_other_gallery.status_code == 400
    assert admin_save_other_gallery.json()["detail"] == "管理员不能直接编辑其他用户资源"

    admin_save_other_resource_library = admin_client.post(
        "/api/resource-library/assets/save",
        json={
            "source_type": "image_session_asset",
            "source_id": asset_id,
            "group_ids": [DEFAULT_GENERATION_RESOURCE_GROUP_ID],
        },
    )
    assert admin_save_other_resource_library.status_code == 400
    assert admin_save_other_resource_library.json()["detail"] == "管理员不能直接编辑其他用户资源"

    admin_generate_other = admin_client.post(
        f"/api/image-sessions/{session_id}/generate",
        json={
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "prompt": "管理员不代用户生成",
            "size": "1024x1024",
            "base_asset_id": asset_id,
        },
    )
    assert admin_generate_other.status_code == 400
    assert admin_generate_other.json()["detail"] == "管理员不能直接编辑其他用户资源"

    saved_gallery = alice_client.post("/api/gallery", json={"image_session_asset_id": asset_id})
    assert saved_gallery.status_code == 201
    assert saved_gallery.json()["owner_username"] == "alice"

    gallery = admin_client.get("/api/gallery", params={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID})
    assert gallery.status_code == 200
    assert gallery.json()["items"][0]["owner_username"] == "alice"


def test_inspiration_moderation_blocks_effective_use_and_restores(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)
    alice_client = _create_user_client(app, admin_client, "alice")

    inspiration = _create_inspiration(alice_client, "待治理灵感")
    source_asset_id = inspiration["source_assets"][0]["id"]

    disabled = admin_client.post(
        f"/api/resources/inspiration/{inspiration['id']}/disable",
        json={"reason": "测试屏蔽"},
    )
    assert disabled.status_code == 200
    assert disabled.json()["effective_enabled"] is False
    assert disabled.json()["disabled_reason"] == "测试屏蔽"

    detail = alice_client.get(f"/api/inspirations/{inspiration['id']}")
    assert detail.status_code == 200
    payload = detail.json()
    assert payload["enabled"] is False
    assert payload["effective_enabled"] is False
    assert payload["source_assets"][0]["effective_enabled"] is False
    assert payload["source_assets"][0]["effective_disabled_resource_type"] == "inspiration"

    blocked_download = alice_client.get(f"/api/source-assets/{source_asset_id}/download")
    assert blocked_download.status_code == 400
    assert blocked_download.json()["detail"] == "资源已被管理员屏蔽，暂不可使用"

    blocked_upload = alice_client.post(
        f"/api/inspirations/{inspiration['id']}/reference-images",
        files={"reference_images": ("ref.png", _make_demo_image_bytes(), "image/png")},
    )
    assert blocked_upload.status_code == 400
    assert blocked_upload.json()["detail"] == "资源已被管理员屏蔽，暂不可使用"

    restored = admin_client.post(f"/api/resources/inspiration/{inspiration['id']}/restore")
    assert restored.status_code == 200
    assert restored.json()["enabled"] is True
    assert restored.json()["effective_enabled"] is True

    restored_download = alice_client.get(f"/api/source-assets/{source_asset_id}/download")
    assert restored_download.status_code == 200


def test_gallery_moderation_visibility_requires_resource_moderation_permission(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)
    moderator_role = admin_client.post("/api/rbac/roles", json={"code": "resource_moderator", "name": "资源治理"})
    assert moderator_role.status_code == 201
    moderator_permissions = admin_client.put(
        f"/api/rbac/roles/{moderator_role.json()['id']}/permissions",
        json={
            "menu_codes": ["gallery"],
            "api_permission_codes": ["gallery:read", "resources:moderate"],
        },
    )
    assert moderator_permissions.status_code == 200

    alice_client = _create_user_client(app, admin_client, "alice")
    bob_client = _create_user_client(app, admin_client, "bob")
    moderator_client = _create_user_client(
        app,
        admin_client,
        "moderator",
        role_id=moderator_role.json()["id"],
    )

    created_session = alice_client.post("/api/image-sessions", json={"title": "Alice 会话"})
    assert created_session.status_code == 201
    session_id = created_session.json()["id"]
    generated = alice_client.post(
        f"/api/image-sessions/{session_id}/generate",
        json={
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "prompt": "生成一张白底产品图",
            "size": "1024x1024",
        },
    )
    assert generated.status_code == 202
    asset_id = generated.json()["rounds"][0]["generated_asset"]["id"]

    saved_gallery = alice_client.post("/api/gallery", json={"image_session_asset_id": asset_id})
    assert saved_gallery.status_code == 201
    entry_id = saved_gallery.json()["id"]

    disabled = admin_client.post(
        f"/api/resources/image_gallery_entry/{entry_id}/disable",
        json={"reason": "测试屏蔽"},
    )
    assert disabled.status_code == 200
    assert disabled.json()["effective_enabled"] is False

    owner_gallery = alice_client.get("/api/gallery", params={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID})
    assert owner_gallery.status_code == 200
    assert owner_gallery.json()["items"] == []

    owner_include_disabled = alice_client.get(
        "/api/gallery",
        params={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID, "include_disabled": True},
    )
    assert owner_include_disabled.status_code == 200
    assert owner_include_disabled.json()["items"] == []

    other_gallery = bob_client.get("/api/gallery", params={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID})
    assert other_gallery.status_code == 200
    assert all(item["id"] != entry_id for item in other_gallery.json()["items"])

    admin_home_gallery = admin_client.get(
        "/api/gallery",
        params={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID},
    )
    assert admin_home_gallery.status_code == 200
    assert admin_home_gallery.json()["items"] == []

    admin_gallery = admin_client.get(
        "/api/gallery",
        params={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID, "include_disabled": True},
    )
    assert admin_gallery.status_code == 200
    assert any(item["id"] == entry_id for item in admin_gallery.json()["items"])
    admin_item = next(item for item in admin_gallery.json()["items"] if item["id"] == entry_id)
    assert admin_item["effective_enabled"] is False

    moderator_gallery = moderator_client.get(
        "/api/gallery",
        params={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID, "include_disabled": True},
    )
    assert moderator_gallery.status_code == 200
    assert any(item["id"] == entry_id for item in moderator_gallery.json()["items"])

    saved_again = alice_client.post("/api/gallery", json={"image_session_asset_id": asset_id})
    assert saved_again.status_code == 400
    assert saved_again.json()["detail"] == "资源已被管理员屏蔽，暂不可使用"


def test_inspiration_resource_moderation_blocks_owner_usage(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)
    alice_client = _create_user_client(app, admin_client, "alice")

    inspiration = _create_inspiration(alice_client, "Alice 待治理灵感")
    inspiration_id = inspiration["id"]
    source_asset_id = inspiration["source_assets"][0]["id"]

    forbidden = alice_client.post(
        f"/api/resources/inspiration/{inspiration_id}/disable",
        json={"reason": "普通用户不能治理资源"},
    )
    assert forbidden.status_code == 403
    assert forbidden.json()["detail"] == "需要管理员权限"

    disabled = admin_client.post(
        f"/api/resources/inspiration/{inspiration_id}/disable",
        json={"reason": "内容不合规"},
    )
    assert disabled.status_code == 200
    assert disabled.json()["enabled"] is False
    assert disabled.json()["effective_enabled"] is False
    assert disabled.json()["effective_disabled_resource_type"] == "inspiration"
    assert disabled.json()["disabled_by_username"] == "libow"
    assert disabled.json()["disabled_reason"] == "内容不合规"

    detail = alice_client.get(f"/api/inspirations/{inspiration_id}")
    assert detail.status_code == 200
    assert detail.json()["enabled"] is False
    assert detail.json()["effective_enabled"] is False
    assert detail.json()["source_assets"][0]["effective_disabled_resource_type"] == "inspiration"

    upload = alice_client.post(
        f"/api/inspirations/{inspiration_id}/reference-images",
        files=[("reference_images", ("reference.png", _make_demo_image_bytes(), "image/png"))],
    )
    assert upload.status_code == 400
    assert upload.json()["detail"] == RESOURCE_DISABLED_MESSAGE

    download = alice_client.get(f"/api/source-assets/{source_asset_id}/download")
    assert download.status_code == 400
    assert download.json()["detail"] == RESOURCE_DISABLED_MESSAGE

    restored = admin_client.post(f"/api/resources/inspiration/{inspiration_id}/restore")
    assert restored.status_code == 200
    assert restored.json()["enabled"] is True
    assert restored.json()["effective_enabled"] is True

    upload_after_restore = alice_client.post(
        f"/api/inspirations/{inspiration_id}/reference-images",
        files=[("reference_images", ("reference.png", _make_demo_image_bytes(), "image/png"))],
    )
    assert upload_after_restore.status_code == 200

    disabled_source = admin_client.post(
        f"/api/resources/source_asset/{source_asset_id}/disable",
        json={"reason": "源图不合规"},
    )
    assert disabled_source.status_code == 200
    assert disabled_source.json()["effective_disabled_resource_type"] == "source_asset"

    detail_after_source_disable = alice_client.get(f"/api/inspirations/{inspiration_id}")
    assert detail_after_source_disable.status_code == 200
    source_by_id = {item["id"]: item for item in detail_after_source_disable.json()["source_assets"]}
    assert source_by_id[source_asset_id]["enabled"] is False
    assert source_by_id[source_asset_id]["effective_disabled_resource_type"] == "source_asset"

    blocked_source_download = alice_client.get(f"/api/source-assets/{source_asset_id}/download")
    assert blocked_source_download.status_code == 400
    assert blocked_source_download.json()["detail"] == RESOURCE_DISABLED_MESSAGE


def test_image_session_and_gallery_moderation_blocks_usage(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)
    alice_client = _create_user_client(app, admin_client, "alice")
    bob_client = _create_user_client(app, admin_client, "bob")

    created_session = alice_client.post("/api/image-sessions", json={"title": "Alice 待治理会话"})
    assert created_session.status_code == 201
    session_id = created_session.json()["id"]

    generated = alice_client.post(
        f"/api/image-sessions/{session_id}/generate",
        json={
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "prompt": "生成一张白底产品图",
            "size": "1024x1024",
        },
    )
    assert generated.status_code == 202
    asset_id = generated.json()["rounds"][0]["generated_asset"]["id"]

    disabled_asset = admin_client.post(
        f"/api/resources/image_session_asset/{asset_id}/disable",
        json={"reason": "图片不合规"},
    )
    assert disabled_asset.status_code == 200
    assert disabled_asset.json()["effective_disabled_resource_type"] == "image_session_asset"

    save_disabled_asset = alice_client.post("/api/gallery", json={"image_session_asset_id": asset_id})
    assert save_disabled_asset.status_code == 400
    assert save_disabled_asset.json()["detail"] == RESOURCE_DISABLED_MESSAGE

    session_detail = alice_client.get(f"/api/image-sessions/{session_id}")
    assert session_detail.status_code == 200
    asset_by_id = {item["id"]: item for item in session_detail.json()["assets"]}
    assert asset_by_id[asset_id]["enabled"] is False
    assert asset_by_id[asset_id]["effective_enabled"] is False

    restored_asset = admin_client.post(f"/api/resources/image_session_asset/{asset_id}/restore")
    assert restored_asset.status_code == 200
    saved_gallery = alice_client.post("/api/gallery", json={"image_session_asset_id": asset_id})
    assert saved_gallery.status_code == 201
    gallery_entry_id = saved_gallery.json()["id"]

    disabled_entry = admin_client.post(
        f"/api/resources/image_gallery_entry/{gallery_entry_id}/disable",
        json={"reason": "画廊条目不展示"},
    )
    assert disabled_entry.status_code == 200
    assert disabled_entry.json()["effective_disabled_resource_type"] == "image_gallery_entry"

    save_disabled_entry = alice_client.post("/api/gallery", json={"image_session_asset_id": asset_id})
    assert save_disabled_entry.status_code == 400
    assert save_disabled_entry.json()["detail"] == RESOURCE_DISABLED_MESSAGE

    alice_gallery = alice_client.get("/api/gallery", params={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID})
    assert alice_gallery.status_code == 200
    assert alice_gallery.json()["items"] == []

    bob_gallery = bob_client.get("/api/gallery", params={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID})
    assert bob_gallery.status_code == 200
    assert bob_gallery.json()["items"] == []

    admin_gallery = admin_client.get(
        "/api/gallery",
        params={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID, "include_disabled": True},
    )
    assert admin_gallery.status_code == 200
    assert admin_gallery.json()["items"][0]["id"] == gallery_entry_id
    assert admin_gallery.json()["items"][0]["enabled"] is False

    disabled_session = admin_client.post(
        f"/api/resources/image_session/{session_id}/disable",
        json={"reason": "会话不合规"},
    )
    assert disabled_session.status_code == 200
    assert disabled_session.json()["effective_disabled_resource_type"] == "image_session"

    generate_disabled_session = alice_client.post(
        f"/api/image-sessions/{session_id}/generate",
        json={
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "prompt": "继续生成",
            "size": "1024x1024",
            "base_asset_id": asset_id,
        },
    )
    assert generate_disabled_session.status_code == 400
    assert generate_disabled_session.json()["detail"] == RESOURCE_DISABLED_MESSAGE
