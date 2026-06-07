from __future__ import annotations

import hashlib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from helpers import _login, _make_demo_image_bytes

from productflow_backend.application import gallery as gallery_app
from productflow_backend.domain.enums import ImageSessionAssetKind
from productflow_backend.infrastructure.db.models import (
    DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    GenerationResourceGroup,
    ImageGalleryEntry,
    ImageSession,
    ImageSessionAsset,
    ImageSessionRound,
)
from productflow_backend.infrastructure.db.session import get_session_factory
from productflow_backend.presentation.api import create_app


def _password_md5(value: str) -> str:
    return hashlib.md5(value.encode(), usedforsecurity=False).hexdigest()


def test_generated_image_can_be_saved_to_gallery_idempotently(configured_env: Path, db_session) -> None:
    app = create_app()
    client = TestClient(app)
    _login(client)
    product = client.post(
        "/api/products",
        data={"name": "画廊商品", "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID},
        files={"image": ("source.png", _make_demo_image_bytes(), "image/png")},
    )
    assert product.status_code == 201
    product_id = product.json()["id"]

    created_session = client.post("/api/image-sessions", json={"product_id": product_id, "title": "画廊会话"})
    assert created_session.status_code == 201
    session_id = created_session.json()["id"]

    generated = client.post(
        f"/api/image-sessions/{session_id}/generate",
        json={
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "prompt": "一张用于画廊的图",
            "size": "1024x1024",
            "generation_count": 2,
        },
    )
    assert generated.status_code == 202
    first_round = generated.json()["rounds"][0]
    asset_id = first_round["generated_asset"]["id"]

    saved = client.post("/api/gallery", json={"image_session_asset_id": asset_id})
    assert saved.status_code == 201
    payload = saved.json()
    assert payload["image_session_asset_id"] == asset_id
    assert payload["image_session_round_id"] == first_round["id"]
    assert payload["image_session_id"] == session_id
    assert payload["image_session_title"] == "画廊会话"
    assert payload["product_id"] == product_id
    assert payload["product_name"] == "画廊商品"
    assert payload["prompt"] == "一张用于画廊的图"
    assert payload["size"] == "1024x1024"
    assert payload["actual_size"] == "1024x1024"
    assert payload["provider_name"] == "mock"
    assert payload["candidate_index"] == 1
    assert payload["candidate_count"] == 2
    assert payload["image"]["thumbnail_url"].endswith("variant=thumbnail")

    saved_again = client.post("/api/gallery", json={"image_session_asset_id": asset_id})
    assert saved_again.status_code == 200
    assert saved_again.json()["id"] == payload["id"]
    assert db_session.query(ImageGalleryEntry).count() == 1

    listed = client.get("/api/gallery", params={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID})
    assert listed.status_code == 200
    items = listed.json()["items"]
    assert len(items) == 1
    assert items[0]["id"] == payload["id"]
    assert items[0]["image"]["download_url"].startswith("/api/image-session-assets/")


def test_gallery_list_filters_by_selected_resource_group(configured_env: Path, db_session) -> None:
    app = create_app()
    client = TestClient(app)
    _login(client)

    missing_group = client.get("/api/gallery")
    assert missing_group.status_code == 422

    premium_group = GenerationResourceGroup(key="premium-gallery", name="高阶图库分组", sort_order=20)
    db_session.add(premium_group)
    db_session.flush()
    image_session = ImageSession(title="图库筛选会话")
    db_session.add(image_session)
    db_session.flush()
    default_asset = ImageSessionAsset(
        session_id=image_session.id,
        kind=ImageSessionAssetKind.GENERATED_IMAGE,
        original_filename="default.png",
        mime_type="image/png",
        storage_path="image-sessions/default.png",
    )
    premium_asset = ImageSessionAsset(
        session_id=image_session.id,
        kind=ImageSessionAssetKind.GENERATED_IMAGE,
        original_filename="premium.png",
        mime_type="image/png",
        storage_path="image-sessions/premium.png",
    )
    db_session.add_all([default_asset, premium_asset])
    db_session.flush()
    default_round = ImageSessionRound(
        session_id=image_session.id,
        prompt="默认分组图库",
        assistant_message="ok",
        size="1024x1024",
        model_name="mock",
        provider_name="mock",
        prompt_version="v1",
        generated_asset_id=default_asset.id,
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    )
    premium_round = ImageSessionRound(
        session_id=image_session.id,
        prompt="高阶分组图库",
        assistant_message="ok",
        size="1024x1024",
        model_name="mock",
        provider_name="mock",
        prompt_version="v1",
        generated_asset_id=premium_asset.id,
        resource_group_id=premium_group.id,
    )
    db_session.add_all([default_round, premium_round])
    db_session.flush()
    default_entry = ImageGalleryEntry(
        image_session_asset_id=default_asset.id,
        image_session_round_id=default_round.id,
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    )
    premium_entry = ImageGalleryEntry(
        image_session_asset_id=premium_asset.id,
        image_session_round_id=premium_round.id,
        resource_group_id=premium_group.id,
    )
    db_session.add_all([default_entry, premium_entry])
    db_session.commit()

    default_list = client.get("/api/gallery", params={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID})
    assert default_list.status_code == 200
    assert {item["id"] for item in default_list.json()["items"]} == {default_entry.id}
    assert default_list.json()["items"][0]["resource_group"]["key"] == "default"

    premium_list = client.get("/api/gallery", params={"resource_group_id": premium_group.id})
    assert premium_list.status_code == 200
    assert {item["id"] for item in premium_list.json()["items"]} == {premium_entry.id}
    assert premium_list.json()["items"][0]["resource_group"]["key"] == "premium-gallery"


def test_gallery_list_rejects_ungranted_resource_group_for_member(configured_env: Path) -> None:
    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)

    created_group = admin_client.post(
        "/api/settings/generation-resource-groups",
        json={"key": "member-gallery", "name": "会员图库分组", "sort_order": 20, "enabled": True},
    )
    assert created_group.status_code == 200
    created_user = admin_client.post(
        "/api/rbac/users",
        json={"username": "gallery-member", "display_name": "Gallery Member"},
    )
    assert created_user.status_code == 201

    user_client = TestClient(app)
    set_password = user_client.post(
        "/api/auth/password",
        json={"username": "gallery-member", "client_password_md5": _password_md5("gallery-member-password")},
    )
    assert set_password.status_code == 200

    rejected = user_client.get("/api/gallery", params={"resource_group_id": created_group.json()["id"]})
    assert rejected.status_code == 400
    assert rejected.json()["detail"] == "账号未授权使用该供应商生成分组"


def test_gallery_rejects_non_generated_session_assets(configured_env: Path) -> None:
    app = create_app()
    client = TestClient(app)
    _login(client)
    created_session = client.post("/api/image-sessions", json={"title": "参考图会话"})
    assert created_session.status_code == 201
    session_id = created_session.json()["id"]
    uploaded = client.post(
        f"/api/image-sessions/{session_id}/reference-images",
        files=[("reference_images", ("reference.png", _make_demo_image_bytes(), "image/png"))],
    )
    assert uploaded.status_code == 200
    reference_asset_id = uploaded.json()["assets"][0]["id"]

    saved = client.post("/api/gallery", json={"image_session_asset_id": reference_asset_id})
    assert saved.status_code == 400
    assert saved.json()["detail"] == "只有生成结果可以保存到画廊"


def test_gallery_rejects_generated_asset_without_round(configured_env: Path, db_session) -> None:
    session = ImageSession(title="孤立生成图")
    db_session.add(session)
    db_session.flush()
    asset = ImageSessionAsset(
        session_id=session.id,
        kind=ImageSessionAssetKind.GENERATED_IMAGE,
        original_filename="orphan.png",
        mime_type="image/png",
        storage_path="image-sessions/orphan.png",
    )
    db_session.add(asset)
    db_session.commit()

    app = create_app()
    client = TestClient(app)
    _login(client)

    saved = client.post("/api/gallery", json={"image_session_asset_id": asset.id})
    assert saved.status_code == 404
    assert saved.json()["detail"] == "生成记录不存在"


def test_gallery_save_handles_integrity_race(
    configured_env: Path,
    db_session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = ImageSession(title="并发保存会话")
    db_session.add(session)
    db_session.flush()
    asset = ImageSessionAsset(
        session_id=session.id,
        kind=ImageSessionAssetKind.GENERATED_IMAGE,
        original_filename="race.png",
        mime_type="image/png",
        storage_path="image-sessions/race.png",
    )
    db_session.add(asset)
    db_session.flush()

    round_item = ImageSessionRound(
        session_id=session.id,
        prompt="并发保存",
        assistant_message="ok",
        size="1024x1024",
        model_name="mock",
        provider_name="mock",
        prompt_version="v1",
        generated_asset_id=asset.id,
    )
    db_session.add(round_item)
    db_session.commit()
    existing = ImageGalleryEntry(
        image_session_asset_id=asset.id,
        image_session_round_id=round_item.id,
    )
    db_session.add(existing)
    db_session.commit()
    existing_id = existing.id

    real_get_gallery_entry = gallery_app._get_gallery_entry_by_asset_id
    calls = {"count": 0}

    def stale_initial_gallery_lookup(session, image_session_asset_id: str):
        calls["count"] += 1
        if calls["count"] == 1:
            return None
        return real_get_gallery_entry(session, image_session_asset_id)

    monkeypatch.setattr(gallery_app, "_get_gallery_entry_by_asset_id", stale_initial_gallery_lookup)

    factory = get_session_factory()
    race_session = factory()
    try:
        result = gallery_app.save_generated_asset_to_gallery(race_session, image_session_asset_id=asset.id)

        assert result.created is False
        assert result.entry.id == existing_id
        assert calls["count"] == 2
    finally:
        race_session.close()

    assert db_session.query(ImageGalleryEntry).count() == 1
