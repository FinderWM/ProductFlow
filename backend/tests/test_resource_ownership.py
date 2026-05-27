from __future__ import annotations

import hashlib
from pathlib import Path

from fastapi.testclient import TestClient
from helpers import _enable_deletion, _login, _make_demo_image_bytes

RESOURCE_DISABLED_MESSAGE = "资源已被管理员屏蔽，暂不可使用"


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


def test_product_owner_isolation_and_admin_read_only_view(configured_env: Path) -> None:
    from productflow_backend.presentation.api import create_app

    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)
    alice_client = _create_user_client(app, admin_client, "alice")

    admin_product = _create_product(admin_client, "管理员灵感")
    alice_product = _create_product(alice_client, "Alice 灵感")

    alice_list = alice_client.get("/api/products")
    assert alice_list.status_code == 200
    alice_items = alice_list.json()["items"]
    assert [item["id"] for item in alice_items] == [alice_product["id"]]
    assert alice_items[0]["owner_username"] == "alice"

    assert alice_client.get(f"/api/products/{admin_product['id']}").status_code == 404
    admin_source_id = admin_product["source_assets"][0]["id"]
    assert alice_client.get(f"/api/source-assets/{admin_source_id}/download").status_code == 404

    admin_list = admin_client.get("/api/products")
    assert admin_list.status_code == 200
    owner_by_id = {item["id"]: item["owner_username"] for item in admin_list.json()["items"]}
    assert owner_by_id[admin_product["id"]] == "libow"
    assert owner_by_id[alice_product["id"]] == "alice"

    admin_detail = admin_client.get(f"/api/products/{alice_product['id']}")
    assert admin_detail.status_code == 200
    assert admin_detail.json()["owner_username"] == "alice"

    _enable_deletion(admin_client)
    admin_delete_other = admin_client.delete(f"/api/products/{alice_product['id']}")
    assert admin_delete_other.status_code == 400
    assert admin_delete_other.json()["detail"] == "管理员不能直接编辑其他用户资源"


def test_image_session_owner_isolation_and_gallery_owner(configured_env: Path) -> None:
    from productflow_backend.presentation.api import create_app

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
        json={"prompt": "生成一张白底产品图", "size": "1024x1024"},
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

    admin_generate_other = admin_client.post(
        f"/api/image-sessions/{session_id}/generate",
        json={"prompt": "管理员不代用户生成", "size": "1024x1024", "base_asset_id": asset_id},
    )
    assert admin_generate_other.status_code == 400
    assert admin_generate_other.json()["detail"] == "管理员不能直接编辑其他用户资源"

    saved_gallery = alice_client.post("/api/gallery", json={"image_session_asset_id": asset_id})
    assert saved_gallery.status_code == 201
    assert saved_gallery.json()["owner_username"] == "alice"

    gallery = admin_client.get("/api/gallery")
    assert gallery.status_code == 200
    assert gallery.json()["items"][0]["owner_username"] == "alice"


def test_product_moderation_blocks_effective_use_and_restores(configured_env: Path) -> None:
    from productflow_backend.presentation.api import create_app

    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)
    alice_client = _create_user_client(app, admin_client, "alice")

    product = _create_product(alice_client, "待治理灵感")
    source_asset_id = product["source_assets"][0]["id"]

    disabled = admin_client.post(
        f"/api/resources/product/{product['id']}/disable",
        json={"reason": "测试屏蔽"},
    )
    assert disabled.status_code == 200
    assert disabled.json()["effective_enabled"] is False
    assert disabled.json()["disabled_reason"] == "测试屏蔽"

    detail = alice_client.get(f"/api/products/{product['id']}")
    assert detail.status_code == 200
    payload = detail.json()
    assert payload["enabled"] is False
    assert payload["effective_enabled"] is False
    assert payload["source_assets"][0]["effective_enabled"] is False
    assert payload["source_assets"][0]["effective_disabled_resource_type"] == "product"

    blocked_download = alice_client.get(f"/api/source-assets/{source_asset_id}/download")
    assert blocked_download.status_code == 400
    assert blocked_download.json()["detail"] == "资源已被管理员屏蔽，暂不可使用"

    blocked_upload = alice_client.post(
        f"/api/products/{product['id']}/reference-images",
        files={"reference_images": ("ref.png", _make_demo_image_bytes(), "image/png")},
    )
    assert blocked_upload.status_code == 400
    assert blocked_upload.json()["detail"] == "资源已被管理员屏蔽，暂不可使用"

    restored = admin_client.post(f"/api/resources/product/{product['id']}/restore")
    assert restored.status_code == 200
    assert restored.json()["enabled"] is True
    assert restored.json()["effective_enabled"] is True

    restored_download = alice_client.get(f"/api/source-assets/{source_asset_id}/download")
    assert restored_download.status_code == 200


def test_gallery_moderation_keeps_owner_visibility_and_hides_from_others(configured_env: Path) -> None:
    from productflow_backend.presentation.api import create_app

    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)
    alice_client = _create_user_client(app, admin_client, "alice")
    bob_client = _create_user_client(app, admin_client, "bob")

    created_session = alice_client.post("/api/image-sessions", json={"title": "Alice 会话"})
    assert created_session.status_code == 201
    session_id = created_session.json()["id"]
    generated = alice_client.post(
        f"/api/image-sessions/{session_id}/generate",
        json={"prompt": "生成一张白底产品图", "size": "1024x1024"},
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

    owner_gallery = alice_client.get("/api/gallery")
    assert owner_gallery.status_code == 200
    assert [item["id"] for item in owner_gallery.json()["items"]] == [entry_id]
    assert owner_gallery.json()["items"][0]["effective_enabled"] is False

    other_gallery = bob_client.get("/api/gallery")
    assert other_gallery.status_code == 200
    assert all(item["id"] != entry_id for item in other_gallery.json()["items"])

    admin_gallery = admin_client.get("/api/gallery")
    assert admin_gallery.status_code == 200
    assert any(item["id"] == entry_id for item in admin_gallery.json()["items"])

    saved_again = alice_client.post("/api/gallery", json={"image_session_asset_id": asset_id})
    assert saved_again.status_code == 400
    assert saved_again.json()["detail"] == "资源已被管理员屏蔽，暂不可使用"


def test_product_resource_moderation_blocks_owner_usage(configured_env: Path) -> None:
    from productflow_backend.presentation.api import create_app

    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)
    alice_client = _create_user_client(app, admin_client, "alice")

    product = _create_product(alice_client, "Alice 待治理灵感")
    product_id = product["id"]
    source_asset_id = product["source_assets"][0]["id"]

    forbidden = alice_client.post(
        f"/api/resources/product/{product_id}/disable",
        json={"reason": "普通用户不能治理资源"},
    )
    assert forbidden.status_code == 403
    assert forbidden.json()["detail"] == "需要管理员权限"

    disabled = admin_client.post(
        f"/api/resources/product/{product_id}/disable",
        json={"reason": "内容不合规"},
    )
    assert disabled.status_code == 200
    assert disabled.json()["enabled"] is False
    assert disabled.json()["effective_enabled"] is False
    assert disabled.json()["effective_disabled_resource_type"] == "product"
    assert disabled.json()["disabled_by_username"] == "libow"
    assert disabled.json()["disabled_reason"] == "内容不合规"

    detail = alice_client.get(f"/api/products/{product_id}")
    assert detail.status_code == 200
    assert detail.json()["enabled"] is False
    assert detail.json()["effective_enabled"] is False
    assert detail.json()["source_assets"][0]["effective_disabled_resource_type"] == "product"

    upload = alice_client.post(
        f"/api/products/{product_id}/reference-images",
        files=[("reference_images", ("reference.png", _make_demo_image_bytes(), "image/png"))],
    )
    assert upload.status_code == 400
    assert upload.json()["detail"] == RESOURCE_DISABLED_MESSAGE

    download = alice_client.get(f"/api/source-assets/{source_asset_id}/download")
    assert download.status_code == 400
    assert download.json()["detail"] == RESOURCE_DISABLED_MESSAGE

    restored = admin_client.post(f"/api/resources/product/{product_id}/restore")
    assert restored.status_code == 200
    assert restored.json()["enabled"] is True
    assert restored.json()["effective_enabled"] is True

    upload_after_restore = alice_client.post(
        f"/api/products/{product_id}/reference-images",
        files=[("reference_images", ("reference.png", _make_demo_image_bytes(), "image/png"))],
    )
    assert upload_after_restore.status_code == 200

    disabled_source = admin_client.post(
        f"/api/resources/source_asset/{source_asset_id}/disable",
        json={"reason": "源图不合规"},
    )
    assert disabled_source.status_code == 200
    assert disabled_source.json()["effective_disabled_resource_type"] == "source_asset"

    detail_after_source_disable = alice_client.get(f"/api/products/{product_id}")
    assert detail_after_source_disable.status_code == 200
    source_by_id = {item["id"]: item for item in detail_after_source_disable.json()["source_assets"]}
    assert source_by_id[source_asset_id]["enabled"] is False
    assert source_by_id[source_asset_id]["effective_disabled_resource_type"] == "source_asset"

    blocked_source_download = alice_client.get(f"/api/source-assets/{source_asset_id}/download")
    assert blocked_source_download.status_code == 400
    assert blocked_source_download.json()["detail"] == RESOURCE_DISABLED_MESSAGE


def test_image_session_and_gallery_moderation_blocks_usage(configured_env: Path) -> None:
    from productflow_backend.presentation.api import create_app

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
        json={"prompt": "生成一张白底产品图", "size": "1024x1024"},
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

    alice_gallery = alice_client.get("/api/gallery")
    assert alice_gallery.status_code == 200
    assert alice_gallery.json()["items"][0]["id"] == gallery_entry_id
    assert alice_gallery.json()["items"][0]["enabled"] is False

    bob_gallery = bob_client.get("/api/gallery")
    assert bob_gallery.status_code == 200
    assert bob_gallery.json()["items"] == []

    disabled_session = admin_client.post(
        f"/api/resources/image_session/{session_id}/disable",
        json={"reason": "会话不合规"},
    )
    assert disabled_session.status_code == 200
    assert disabled_session.json()["effective_disabled_resource_type"] == "image_session"

    generate_disabled_session = alice_client.post(
        f"/api/image-sessions/{session_id}/generate",
        json={"prompt": "继续生成", "size": "1024x1024", "base_asset_id": asset_id},
    )
    assert generate_disabled_session.status_code == 400
    assert generate_disabled_session.json()["detail"] == RESOURCE_DISABLED_MESSAGE
