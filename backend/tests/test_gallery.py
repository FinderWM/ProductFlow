from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from helpers import _login, _make_demo_image_bytes

from inspiration_one_backend.application import gallery as gallery_app
from inspiration_one_backend.domain.enums import ImageSessionAssetKind
from inspiration_one_backend.infrastructure.db.models import (
    DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    GenerationResourceGroup,
    ImageGalleryEntry,
    ImageGalleryEntryTag,
    ImageGalleryEntryViewEvent,
    ImageSession,
    ImageSessionAsset,
    ImageSessionRound,
)
from inspiration_one_backend.infrastructure.db.session import get_session_factory
from inspiration_one_backend.presentation.api import create_app


def test_generated_image_can_be_saved_to_gallery_idempotently(configured_env: Path, db_session) -> None:
    app = create_app()
    client = TestClient(app)
    _login(client)
    inspiration = client.post(
        "/api/inspirations",
        data={"name": "画廊灵感产物", "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID},
        files={"image": ("source.png", _make_demo_image_bytes(), "image/png")},
    )
    assert inspiration.status_code == 201
    inspiration_id = inspiration.json()["id"]

    created_session = client.post("/api/image-sessions", json={"inspiration_id": inspiration_id, "title": "画廊会话"})
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
    assert first_round["generated_asset"]["gallery_saved"] is False
    assert first_round["generated_asset"]["gallery_entry_id"] is None
    asset_count_before_save = db_session.query(ImageSessionAsset).count()

    saved = client.post("/api/gallery", json={"image_session_asset_id": asset_id})
    assert saved.status_code == 201
    payload = saved.json()
    assert payload["image_session_asset_id"] == asset_id
    assert payload["image"]["id"] == asset_id
    assert payload["image"]["gallery_saved"] is True
    assert payload["image"]["gallery_entry_id"] == payload["id"]
    assert payload["image_session_round_id"] == first_round["id"]
    assert payload["image_session_id"] == session_id
    assert payload["image_session_title"] == "画廊会话"
    assert payload["inspiration_id"] == inspiration_id
    assert payload["inspiration_name"] == "画廊灵感产物"
    assert payload["prompt"] == "一张用于画廊的图"
    assert payload["size"] == "1024x1024"
    assert payload["actual_size"] == "1024x1024"
    assert payload["provider_name"] == "mock"
    assert payload["candidate_index"] == 1
    assert payload["candidate_count"] == 2
    assert payload["base_assets"] == []
    assert payload["image"]["thumbnail_url"].endswith("variant=thumbnail")

    saved_again = client.post("/api/gallery", json={"image_session_asset_id": asset_id})
    assert saved_again.status_code == 200
    assert saved_again.json()["id"] == payload["id"]
    assert db_session.query(ImageSessionAsset).count() == asset_count_before_save
    assert db_session.query(ImageGalleryEntry).count() == 1

    session_detail = client.get(f"/api/image-sessions/{session_id}")
    assert session_detail.status_code == 200
    session_round = next(item for item in session_detail.json()["rounds"] if item["generated_asset"]["id"] == asset_id)
    assert session_round["generated_asset"]["gallery_saved"] is True
    assert session_round["generated_asset"]["gallery_entry_id"] == payload["id"]

    listed = client.get("/api/gallery", params={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID})
    assert listed.status_code == 200
    items = listed.json()["items"]
    assert len(items) == 1
    assert items[0]["id"] == payload["id"]
    assert items[0]["base_assets"] == []
    assert items[0]["image"]["download_url"].startswith("/api/image-session-assets/")


def test_gallery_entry_includes_base_assets(configured_env: Path) -> None:
    app = create_app()
    client = TestClient(app)
    _login(client)

    created_session = client.post("/api/image-sessions", json={"title": "基图画廊会话"})
    assert created_session.status_code == 201
    session_id = created_session.json()["id"]

    first = client.post(
        f"/api/image-sessions/{session_id}/generate",
        json={
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "prompt": "第一张基础图",
            "size": "1024x1024",
        },
    )
    assert first.status_code == 202
    first_round = next(round_item for round_item in first.json()["rounds"] if round_item["prompt"] == "第一张基础图")
    first_asset = first_round["generated_asset"]

    uploaded = client.post(
        f"/api/image-sessions/{session_id}/reference-images",
        files=[("reference_images", ("ref-a.png", _make_demo_image_bytes(), "image/png"))],
    )
    assert uploaded.status_code == 200
    reference_asset = uploaded.json()["assets"][0]

    branched = client.post(
        f"/api/image-sessions/{session_id}/generate",
        json={
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "prompt": "带基图保存到画廊",
            "size": "1024x1024",
            "base_asset_id": first_asset["id"],
            "selected_reference_asset_ids": [reference_asset["id"]],
        },
    )
    assert branched.status_code == 202
    branch_round = next(
        round_item for round_item in branched.json()["rounds"] if round_item["prompt"] == "带基图保存到画廊"
    )
    branch_asset_id = branch_round["generated_asset"]["id"]

    saved = client.post("/api/gallery", json={"image_session_asset_id": branch_asset_id})
    assert saved.status_code == 201
    payload = saved.json()
    assert payload["base_asset_ids"] == [first_asset["id"], reference_asset["id"]]
    assert [asset["id"] for asset in payload["base_assets"]] == [first_asset["id"], reference_asset["id"]]
    assert [asset["kind"] for asset in payload["base_assets"]] == ["generated_image", "reference_upload"]
    assert [asset["original_filename"] for asset in payload["base_assets"]] == [
        first_asset["original_filename"],
        "ref-a.png",
    ]
    assert all(asset["download_url"].startswith("/api/image-session-assets/") for asset in payload["base_assets"])

    listed = client.get("/api/gallery", params={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID})
    assert listed.status_code == 200
    listed_payload = listed.json()
    assert listed_payload["total"] == 1
    assert [asset["id"] for asset in listed_payload["items"][0]["base_assets"]] == [
        first_asset["id"],
        reference_asset["id"],
    ]


def test_gallery_list_filters_resource_group_and_keeps_group_metadata(
    configured_env: Path,
    db_session,
) -> None:
    app = create_app()
    client = TestClient(app)
    _login(client)

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
    assert [item["id"] for item in default_list.json()["items"]] == [default_entry.id]
    assert {item["resource_group"]["key"] for item in default_list.json()["items"]} == {"default"}

    premium_list = client.get("/api/gallery", params={"resource_group_id": premium_group.id})
    assert premium_list.status_code == 200
    assert [item["id"] for item in premium_list.json()["items"]] == [premium_entry.id]
    assert {item["resource_group"]["key"] for item in premium_list.json()["items"]} == {"premium-gallery"}

    all_list = client.get("/api/gallery")
    assert all_list.status_code == 200
    assert {item["id"] for item in all_list.json()["items"]} == {default_entry.id, premium_entry.id}
    assert all_list.json()["has_more"] is False
    assert all_list.json()["next_offset"] is None


def test_gallery_list_supports_limit_offset(configured_env: Path, db_session) -> None:
    app = create_app()
    client = TestClient(app)
    _login(client)

    image_session = ImageSession(title="图库分页会话")
    db_session.add(image_session)
    db_session.flush()

    base_time = datetime(2026, 1, 1, tzinfo=UTC)
    entries: list[ImageGalleryEntry] = []
    for index in range(3):
        asset = ImageSessionAsset(
            session_id=image_session.id,
            kind=ImageSessionAssetKind.GENERATED_IMAGE,
            original_filename=f"page-{index}.png",
            mime_type="image/png",
            storage_path=f"image-sessions/page-{index}.png",
        )
        db_session.add(asset)
        db_session.flush()
        round_item = ImageSessionRound(
            session_id=image_session.id,
            prompt=f"图库分页 {index}",
            assistant_message="ok",
            size="1024x1024",
            model_name="mock",
            provider_name="mock",
            prompt_version="v1",
            generated_asset_id=asset.id,
            resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        )
        db_session.add(round_item)
        db_session.flush()
        entry = ImageGalleryEntry(
            image_session_asset_id=asset.id,
            image_session_round_id=round_item.id,
            resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            created_at=base_time + timedelta(minutes=index),
        )
        db_session.add(entry)
        entries.append(entry)
    db_session.commit()

    first_page = client.get("/api/gallery", params={"limit": 2, "offset": 0})
    assert first_page.status_code == 200
    first_payload = first_page.json()
    assert [item["id"] for item in first_payload["items"]] == [entries[2].id, entries[1].id]
    assert first_payload["total"] == 3
    assert first_payload["has_more"] is True
    assert first_payload["next_offset"] == 2

    second_page = client.get("/api/gallery", params={"limit": 2, "offset": first_payload["next_offset"]})
    assert second_page.status_code == 200
    second_payload = second_page.json()
    assert [item["id"] for item in second_payload["items"]] == [entries[0].id]
    assert second_payload["total"] == 3
    assert second_payload["has_more"] is False
    assert second_payload["next_offset"] is None


def test_gallery_list_ignores_ungranted_resource_group_for_member(configured_env: Path) -> None:
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
        json={
            "username": "gallery-member",
            "password": "gallery-member-password",
            "setup_token": created_user.json()["password_setup_token"],
        },
    )
    assert set_password.status_code == 200

    listed = user_client.get("/api/gallery", params={"resource_group_id": created_group.json()["id"]})
    assert listed.status_code == 200
    assert listed.json()["items"] == []


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


def _seed_gallery_entry(db_session, *, prompt: str = "点击计数图") -> str:
    image_session = ImageSession(title="点击计数会话")
    db_session.add(image_session)
    db_session.flush()
    asset = ImageSessionAsset(
        session_id=image_session.id,
        kind=ImageSessionAssetKind.GENERATED_IMAGE,
        original_filename="views.png",
        mime_type="image/png",
        storage_path="image-sessions/views.png",
    )
    db_session.add(asset)
    db_session.flush()
    round_item = ImageSessionRound(
        session_id=image_session.id,
        prompt=prompt,
        assistant_message="ok",
        size="1024x1024",
        model_name="mock",
        provider_name="mock",
        prompt_version="v1",
        generated_asset_id=asset.id,
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    )
    db_session.add(round_item)
    db_session.flush()
    entry = ImageGalleryEntry(
        image_session_asset_id=asset.id,
        image_session_round_id=round_item.id,
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    )
    db_session.add(entry)
    db_session.commit()
    return entry.id


def _seed_gallery_entry_with_created_at(db_session, *, prompt: str, created_at: datetime) -> ImageGalleryEntry:
    image_session = ImageSession(title=f"{prompt} 会话")
    db_session.add(image_session)
    db_session.flush()
    asset = ImageSessionAsset(
        session_id=image_session.id,
        kind=ImageSessionAssetKind.GENERATED_IMAGE,
        original_filename=f"{prompt}.png",
        mime_type="image/png",
        storage_path=f"image-sessions/{prompt}.png",
    )
    db_session.add(asset)
    db_session.flush()
    round_item = ImageSessionRound(
        session_id=image_session.id,
        prompt=prompt,
        assistant_message="ok",
        size="1024x1024",
        model_name="mock",
        provider_name="mock",
        prompt_version="v1",
        generated_asset_id=asset.id,
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    )
    db_session.add(round_item)
    db_session.flush()
    entry = ImageGalleryEntry(
        image_session_asset_id=asset.id,
        image_session_round_id=round_item.id,
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        created_at=created_at,
    )
    db_session.add(entry)
    db_session.flush()
    return entry


def _create_member_client_with_permissions(app, admin_client: TestClient, *, username: str, permissions: list[str]):
    role = admin_client.post("/api/rbac/roles", json={"code": f"{username}_role", "name": f"{username} Role"})
    assert role.status_code == 201
    role_id = role.json()["id"]
    role_permissions = admin_client.put(
        f"/api/rbac/roles/{role_id}/permissions",
        json={"menu_codes": ["gallery"], "api_permission_codes": permissions},
    )
    assert role_permissions.status_code == 200
    created_user = admin_client.post(
        "/api/rbac/users",
        json={"username": username, "display_name": username, "role_id": role_id},
    )
    assert created_user.status_code == 201
    user_client = TestClient(app)
    set_password = user_client.post(
        "/api/auth/password",
        json={
            "username": username,
            "password": f"{username}-password",
            "setup_token": created_user.json()["password_setup_token"],
        },
    )
    assert set_password.status_code == 200
    return user_client


def test_gallery_tag_crud_and_entry_relation_require_admin_even_with_permission(
    configured_env: Path,
    db_session,
) -> None:
    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)

    created = admin_client.post(
        "/api/gallery/tags",
        json={"name": "新品 2", "description": "可见标签", "priority": 20},
    )
    assert created.status_code == 201
    tag_id = created.json()["id"]
    disabled = admin_client.post("/api/gallery/tags", json={"name": "隐藏标签", "priority": 30, "enabled": False})
    assert disabled.status_code == 201

    entry_id = _seed_gallery_entry(db_session, prompt="标签权限图")
    updated_entry = admin_client.patch(f"/api/gallery/{entry_id}/tags", json={"tag_ids": [tag_id]})
    assert updated_entry.status_code == 200
    assert [tag["name"] for tag in updated_entry.json()["tags"]] == ["新品 2"]

    member_client = _create_member_client_with_permissions(
        app,
        admin_client,
        username="tag-manager-member",
        permissions=["gallery:read", "gallery:tags_manage"],
    )
    rejected_create = member_client.post("/api/gallery/tags", json={"name": "误授权新增"})
    assert rejected_create.status_code == 403
    assert rejected_create.json()["detail"] == "需要管理员权限"
    rejected_update = member_client.patch(f"/api/gallery/{entry_id}/tags", json={"tag_ids": []})
    assert rejected_update.status_code == 403
    assert rejected_update.json()["detail"] == "需要管理员权限"

    public_tags = member_client.get("/api/gallery/tags")
    assert public_tags.status_code == 200
    assert [tag["name"] for tag in public_tags.json()] == ["新品 2"]
    assert "隐藏标签" not in {tag["name"] for tag in public_tags.json()}

    managed_tags = admin_client.get("/api/gallery/tags", params={"include_disabled": True})
    assert managed_tags.status_code == 200
    assert [tag["name"] for tag in managed_tags.json()] == ["隐藏标签", "新品 2"]


def test_gallery_save_with_tags_required_setting_and_serializes_enabled_tags(configured_env: Path, db_session) -> None:
    app = create_app()
    client = TestClient(app)
    _login(client)

    visible_tag = client.post("/api/gallery/tags", json={"name": "可见标签", "priority": 10})
    assert visible_tag.status_code == 201
    hidden_tag = client.post("/api/gallery/tags", json={"name": "禁用标签", "priority": 20, "enabled": False})
    assert hidden_tag.status_code == 201

    created_session = client.post("/api/image-sessions", json={"title": "标签保存会话"})
    assert created_session.status_code == 201
    generated = client.post(
        f"/api/image-sessions/{created_session.json()['id']}/generate",
        json={
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "prompt": "带标签保存",
            "size": "1024x1024",
        },
    )
    assert generated.status_code == 202
    asset_id = generated.json()["rounds"][0]["generated_asset"]["id"]

    enabled_required = client.patch("/api/settings", json={"values": {"gallery_tag_required_on_save": True}})
    assert enabled_required.status_code == 200
    missing_tags = client.post("/api/gallery", json={"image_session_asset_id": asset_id})
    assert missing_tags.status_code == 400
    assert missing_tags.json()["detail"] == "请选择画廊标签"

    disabled_tag_save = client.post(
        "/api/gallery",
        json={"image_session_asset_id": asset_id, "tag_ids": [hidden_tag.json()["id"]]},
    )
    assert disabled_tag_save.status_code == 400
    assert disabled_tag_save.json()["detail"] == "画廊标签不存在或已禁用"

    saved = client.post(
        "/api/gallery",
        json={"image_session_asset_id": asset_id, "tag_ids": [visible_tag.json()["id"]]},
    )
    assert saved.status_code == 201
    assert [tag["name"] for tag in saved.json()["tags"]] == ["可见标签"]


def test_gallery_tag_filter_matches_any_and_orders_by_match_count(configured_env: Path, db_session) -> None:
    app = create_app()
    client = TestClient(app)
    _login(client)

    tag_a = client.post("/api/gallery/tags", json={"name": "A1", "priority": 1}).json()
    tag_b = client.post("/api/gallery/tags", json={"name": "A2", "priority": 1}).json()
    tag_c = client.post("/api/gallery/tags", json={"name": "C", "priority": 1}).json()
    base_time = datetime(2026, 1, 1, tzinfo=UTC)
    entry_a = _seed_gallery_entry_with_created_at(
        db_session,
        prompt="仅 A",
        created_at=base_time + timedelta(minutes=1),
    )
    entry_both = _seed_gallery_entry_with_created_at(
        db_session,
        prompt="A B",
        created_at=base_time,
    )
    entry_b = _seed_gallery_entry_with_created_at(
        db_session,
        prompt="仅 B",
        created_at=base_time + timedelta(minutes=2),
    )
    entry_c = _seed_gallery_entry_with_created_at(
        db_session,
        prompt="仅 C",
        created_at=base_time + timedelta(minutes=3),
    )
    db_session.add_all(
        [
            ImageGalleryEntryTag(gallery_entry_id=entry_a.id, tag_id=tag_a["id"]),
            ImageGalleryEntryTag(gallery_entry_id=entry_both.id, tag_id=tag_a["id"]),
            ImageGalleryEntryTag(gallery_entry_id=entry_both.id, tag_id=tag_b["id"]),
            ImageGalleryEntryTag(gallery_entry_id=entry_b.id, tag_id=tag_b["id"]),
            ImageGalleryEntryTag(gallery_entry_id=entry_c.id, tag_id=tag_c["id"]),
        ]
    )
    db_session.commit()

    filtered = client.get("/api/gallery", params=[("tag_ids", tag_a["id"]), ("tag_ids", tag_b["id"])])
    assert filtered.status_code == 200
    assert [item["id"] for item in filtered.json()["items"]] == [entry_both.id, entry_b.id, entry_a.id]
    assert filtered.json()["total"] == 3


def test_disabled_and_deleted_gallery_tags_are_hidden_and_delete_soft_deletes_relations(
    configured_env: Path,
    db_session,
) -> None:
    app = create_app()
    client = TestClient(app)
    _login(client)

    tag = client.post("/api/gallery/tags", json={"name": "可删除标签", "priority": 10})
    assert tag.status_code == 201
    tag_id = tag.json()["id"]
    entry = _seed_gallery_entry_with_created_at(
        db_session,
        prompt="删除标签图",
        created_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    db_session.add(ImageGalleryEntryTag(gallery_entry_id=entry.id, tag_id=tag_id))
    db_session.commit()

    disabled = client.patch(f"/api/gallery/tags/{tag_id}", json={"enabled": False})
    assert disabled.status_code == 200
    tags_after_disable = client.get("/api/gallery/tags")
    assert tags_after_disable.status_code == 200
    assert tags_after_disable.json() == []
    listed_after_disable = client.get("/api/gallery")
    assert listed_after_disable.status_code == 200
    assert listed_after_disable.json()["items"][0]["tags"] == []
    filtered_after_disable = client.get("/api/gallery", params={"tag_ids": tag_id})
    assert filtered_after_disable.status_code == 200
    assert filtered_after_disable.json()["items"] == []

    client.patch(f"/api/gallery/tags/{tag_id}", json={"enabled": True})
    deleted = client.delete(f"/api/gallery/tags/{tag_id}")
    assert deleted.status_code == 200
    link = db_session.query(ImageGalleryEntryTag).filter_by(gallery_entry_id=entry.id, tag_id=tag_id).one()
    assert link.deleted_at is not None
    recreated = client.post("/api/gallery/tags", json={"name": "可删除标签", "priority": 10})
    assert recreated.status_code == 201
    assert recreated.json()["id"] != tag_id

    filtered_old = client.get("/api/gallery", params={"tag_ids": tag_id})
    assert filtered_old.status_code == 200
    assert filtered_old.json()["items"] == []


def test_gallery_view_dedups_within_window_and_counts_after_window(configured_env: Path, db_session) -> None:
    entry_id = _seed_gallery_entry(db_session)

    app = create_app()
    client = TestClient(app)
    _login(client)

    first = client.post(f"/api/gallery/{entry_id}/views")
    assert first.status_code == 200
    assert first.json() == {"id": entry_id, "view_count": 1, "counted": True}

    repeat = client.post(f"/api/gallery/{entry_id}/views")
    assert repeat.status_code == 200
    assert repeat.json() == {"id": entry_id, "view_count": 1, "counted": False}

    # 列表返回聚合点击量
    listed = client.get("/api/gallery")
    assert listed.status_code == 200
    item = next(item for item in listed.json()["items"] if item["id"] == entry_id)
    assert item["view_count"] == 1

    # 把窗口外的历史点击改造为过期，再次点击应重新计数
    window_minutes = 60
    expired_at = datetime.now(UTC) - timedelta(minutes=window_minutes + 1)
    event = db_session.query(ImageGalleryEntryViewEvent).filter_by(gallery_entry_id=entry_id).one()
    event.viewed_at = expired_at
    db_session.commit()

    after_window = client.post(f"/api/gallery/{entry_id}/views")
    assert after_window.status_code == 200
    assert after_window.json() == {"id": entry_id, "view_count": 2, "counted": True}


def test_gallery_view_window_is_admin_configurable(configured_env: Path, db_session) -> None:
    entry_id = _seed_gallery_entry(db_session)

    app = create_app()
    client = TestClient(app)
    _login(client)

    # 缩小去重窗口到 1 分钟
    updated = client.patch("/api/settings", json={"values": {"gallery_view_dedup_window_minutes": 1}})
    assert updated.status_code == 200

    first = client.post(f"/api/gallery/{entry_id}/views")
    assert first.json()["counted"] is True

    # 把唯一点击事件改造成 2 分钟前，窗口缩短后应重新计数
    event = db_session.query(ImageGalleryEntryViewEvent).filter_by(gallery_entry_id=entry_id).one()
    event.viewed_at = datetime.now(UTC) - timedelta(minutes=2)
    db_session.commit()

    after = client.post(f"/api/gallery/{entry_id}/views")
    assert after.json()["counted"] is True
    assert after.json()["view_count"] == 2


def test_gallery_view_rejects_unknown_entry(configured_env: Path) -> None:
    app = create_app()
    client = TestClient(app)
    _login(client)

    missing = client.post("/api/gallery/00000000-0000-0000-0000-000000009999/views")
    assert missing.status_code == 404
