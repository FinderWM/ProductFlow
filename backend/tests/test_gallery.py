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
    assert items[0]["image"]["download_url"].startswith("/api/image-session-assets/")


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
