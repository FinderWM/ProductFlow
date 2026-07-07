from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient
from helpers import _login, _make_demo_image_bytes

from inspiration_one_backend.domain.enums import PosterKind
from inspiration_one_backend.infrastructure.db.models import (
    DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    CopySet,
    ImageSessionAsset,
    PosterVariant,
    ResourceLibraryAsset,
    SourceAsset,
)
from inspiration_one_backend.presentation.api import create_app


def _create_inspiration_with_reference(client: TestClient, name: str = "资源库灵感") -> tuple[str, str, str]:
    created = client.post(
        "/api/inspirations",
        data={"name": name, "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID},
        files={"image": ("source.png", _make_demo_image_bytes(), "image/png")},
    )
    assert created.status_code == 201
    inspiration_id = created.json()["id"]
    workflow = client.get(f"/api/inspirations/{inspiration_id}/workflow")
    assert workflow.status_code == 200
    reference_node = next(node for node in workflow.json()["nodes"] if node["node_type"] == "reference_image")
    uploaded = client.post(
        f"/api/workflow-nodes/{reference_node['id']}/image",
        data={"role": "style", "label": "资源库参考图"},
        files={"image": ("reference.png", _make_demo_image_bytes(), "image/png")},
    )
    assert uploaded.status_code == 200
    filled_node = next(node for node in uploaded.json()["nodes"] if node["id"] == reference_node["id"])
    return inspiration_id, reference_node["id"], filled_node["output_json"]["source_asset_ids"][0]


def _create_poster_variant(db_session, storage_root: Path, inspiration_id: str) -> str:
    copy_set = CopySet(
        inspiration_id=inspiration_id,
        structured_payload={
            "version": 2,
            "summary": "资源库海报",
            "content": {"kind": "blocks", "blocks": [{"id": "headline", "text": "资源库海报"}]},
        },
        model_structured_payload={
            "version": 2,
            "summary": "资源库海报",
            "content": {"kind": "blocks", "blocks": [{"id": "headline", "text": "资源库海报"}]},
        },
        provider_name="test",
        model_name="test",
        prompt_version="test",
    )
    db_session.add(copy_set)
    db_session.flush()
    storage_path = f"inspirations/{inspiration_id}/posters/resource-library-poster.png"
    poster_path = storage_root / storage_path
    poster_path.parent.mkdir(parents=True, exist_ok=True)
    poster_path.write_bytes(_make_demo_image_bytes())
    poster = PosterVariant(
        inspiration_id=inspiration_id,
        copy_set_id=copy_set.id,
        kind=PosterKind.MAIN_IMAGE,
        template_name="test",
        mime_type="image/png",
        storage_path=storage_path,
        width=1024,
        height=1024,
    )
    db_session.add(poster)
    db_session.commit()
    return poster.id


def _assert_resource_asset_uses_resource_library_storage(
    db_session,
    *,
    resource_asset_id: str,
    source_model: type,
    source_id: str,
) -> None:
    db_session.expire_all()
    resource_asset = db_session.get(ResourceLibraryAsset, resource_asset_id)
    source_object = db_session.get(source_model, source_id)
    assert resource_asset is not None
    assert source_object is not None
    source_object_key = source_object.storage_object_key or source_object.storage_path
    assert resource_asset.storage_path.startswith("resource_library/")
    assert resource_asset.storage_object_key == resource_asset.storage_path
    assert resource_asset.storage_path != source_object_key


def test_resource_library_group_crud_and_default_group(configured_env: Path) -> None:
    app = create_app()
    client = TestClient(app)
    _login(client)

    initial = client.get("/api/resource-library/groups")
    assert initial.status_code == 200
    assert [group["name"] for group in initial.json()["items"]] == ["默认分组"]

    created = client.post("/api/resource-library/groups", json={"name": "品牌参考", "sort_order": 20})
    assert created.status_code == 201
    group_id = created.json()["id"]
    renamed = client.patch(f"/api/resource-library/groups/{group_id}", json={"name": "品牌资产", "sort_order": 10})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "品牌资产"
    assert renamed.json()["sort_order"] == 10

    archived = client.delete(f"/api/resource-library/groups/{group_id}")
    assert archived.status_code == 204
    listed = client.get("/api/resource-library/groups")
    assert listed.status_code == 200
    assert {group["name"] for group in listed.json()["items"]} == {"默认分组"}


def test_resource_library_saves_inspiration_source_image(configured_env: Path) -> None:
    app = create_app()
    client = TestClient(app)
    _login(client)

    created = client.post(
        "/api/inspirations",
        data={"name": "资源库主图", "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID},
        files={"image": ("source.png", _make_demo_image_bytes(), "image/png")},
    )
    assert created.status_code == 201
    source_asset_id = next(
        asset["id"] for asset in created.json()["source_assets"] if asset["kind"] == "original_image"
    )
    group_id = client.get("/api/resource-library/groups").json()["items"][0]["id"]

    saved = client.post(
        "/api/resource-library/assets/save",
        json={"source_type": "source_asset", "source_id": source_asset_id, "group_ids": [group_id]},
    )

    assert saved.status_code == 201
    assert saved.json()["source_type"] == "source_asset"
    assert saved.json()["source_resource_id"] == source_asset_id
    assert saved.json()["group_ids"] == [group_id]


def test_resource_library_uploads_manual_images_to_default_and_selected_groups(
    configured_env: Path,
    db_session,
) -> None:
    app = create_app()
    client = TestClient(app)
    _login(client)

    default_group_id = client.get("/api/resource-library/groups").json()["items"][0]["id"]
    uploaded_default = client.post(
        "/api/resource-library/assets/upload",
        files=[("images", ("manual.png", _make_demo_image_bytes(), "image/png"))],
    )

    assert uploaded_default.status_code == 201
    default_item = uploaded_default.json()["items"][0]
    assert default_item["source_type"] == "upload"
    assert default_item["source_resource_id"] is None
    assert default_item["group_ids"] == [default_group_id]
    db_session.expire_all()
    default_asset = db_session.get(ResourceLibraryAsset, default_item["id"])
    assert default_asset is not None
    assert default_asset.storage_path.startswith("resource_library/")
    assert default_asset.storage_object_key == default_asset.storage_path

    group_id = client.post("/api/resource-library/groups", json={"name": "手动素材"}).json()["id"]
    uploaded_group = client.post(
        "/api/resource-library/assets/upload",
        data={"group_ids": group_id},
        files=[
            ("images", ("manual-a.png", _make_demo_image_bytes(), "image/png")),
            ("images", ("manual-b.png", _make_demo_image_bytes(), "image/png")),
        ],
    )

    assert uploaded_group.status_code == 201
    uploaded_ids = {item["id"] for item in uploaded_group.json()["items"]}
    assert len(uploaded_ids) == 2
    assert all(item["source_type"] == "upload" for item in uploaded_group.json()["items"])
    assert all(item["group_ids"] == [group_id] for item in uploaded_group.json()["items"])
    listed_group = client.get("/api/resource-library/assets", params={"group_id": group_id})
    assert listed_group.status_code == 200
    assert {item["id"] for item in listed_group.json()["items"]} == uploaded_ids


def test_resource_library_saves_sources_idempotently_with_multiple_groups(
    configured_env: Path,
    db_session,
) -> None:
    app = create_app()
    client = TestClient(app)
    _login(client)
    inspiration_id, _, source_asset_id = _create_inspiration_with_reference(client)
    poster_id = _create_poster_variant(db_session, configured_env, inspiration_id)
    created_session = client.post("/api/image-sessions", json={"title": "资源库会话"})
    assert created_session.status_code == 201
    session_id = created_session.json()["id"]
    generated = client.post(
        f"/api/image-sessions/{session_id}/generate",
        json={
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "prompt": "生成一张资源库图片",
            "size": "1024x1024",
        },
    )
    assert generated.status_code == 202
    generated_asset_id = generated.json()["rounds"][0]["generated_asset"]["id"]

    first_group = client.post("/api/resource-library/groups", json={"name": "组 A"}).json()["id"]
    second_group = client.post("/api/resource-library/groups", json={"name": "组 B"}).json()["id"]

    saved_source = client.post(
        "/api/resource-library/assets/save",
        json={"source_type": "source_asset", "source_id": source_asset_id, "group_ids": [first_group]},
    )
    assert saved_source.status_code == 201
    source_resource_id = saved_source.json()["id"]
    assert saved_source.json()["source_type"] == "source_asset"
    assert saved_source.json()["group_ids"] == [first_group]
    assert saved_source.json()["thumbnail_url"].endswith("variant=thumbnail")
    _assert_resource_asset_uses_resource_library_storage(
        db_session,
        resource_asset_id=source_resource_id,
        source_model=SourceAsset,
        source_id=source_asset_id,
    )

    saved_source_again = client.post(
        "/api/resource-library/assets/save",
        json={"source_type": "source_asset", "source_id": source_asset_id, "group_ids": [first_group, second_group]},
    )
    assert saved_source_again.status_code == 200
    assert saved_source_again.json()["id"] == source_resource_id
    assert set(saved_source_again.json()["group_ids"]) == {first_group, second_group}

    saved_source_duplicate_group = client.post(
        "/api/resource-library/assets/save",
        json={"source_type": "source_asset", "source_id": source_asset_id, "group_ids": [first_group]},
    )
    assert saved_source_duplicate_group.status_code == 200
    assert saved_source_duplicate_group.json()["id"] == source_resource_id
    assert saved_source_duplicate_group.json()["group_ids"].count(first_group) == 1
    assert set(saved_source_duplicate_group.json()["group_ids"]) == {first_group, second_group}

    source_status = client.get(
        "/api/resource-library/source-status",
        params={"source_type": "source_asset", "source_ids": source_asset_id},
    )
    assert source_status.status_code == 200
    assert source_status.json()["items"] == [
        {
            "source_id": source_asset_id,
            "saved": True,
            "asset": saved_source_duplicate_group.json(),
            "group_ids": saved_source_duplicate_group.json()["group_ids"],
        }
    ]

    saved_poster = client.post(
        "/api/resource-library/assets/save",
        json={"source_type": "poster_variant", "source_id": poster_id, "group_ids": [second_group]},
    )
    assert saved_poster.status_code == 201
    assert saved_poster.json()["source_type"] == "poster_variant"
    _assert_resource_asset_uses_resource_library_storage(
        db_session,
        resource_asset_id=saved_poster.json()["id"],
        source_model=PosterVariant,
        source_id=poster_id,
    )

    saved_generated = client.post(
        "/api/resource-library/assets/save",
        json={"source_type": "image_session_asset", "source_id": generated_asset_id, "group_ids": []},
    )
    assert saved_generated.status_code == 400
    assert saved_generated.json()["detail"] == "请选择至少一个资源分组"

    saved_generated = client.post(
        "/api/resource-library/assets/save",
        json={"source_type": "image_session_asset", "source_id": generated_asset_id, "group_ids": [first_group]},
    )
    assert saved_generated.status_code == 201
    assert saved_generated.json()["source_type"] == "image_session_asset"
    assert saved_generated.json()["group_ids"] == [first_group]
    _assert_resource_asset_uses_resource_library_storage(
        db_session,
        resource_asset_id=saved_generated.json()["id"],
        source_model=ImageSessionAsset,
        source_id=generated_asset_id,
    )

    disabled_inspiration = client.post(
        f"/api/resources/inspiration/{inspiration_id}/disable",
        json={"reason": "源灵感风险"},
    )
    assert disabled_inspiration.status_code == 200

    listed_after_inspiration_disable = client.get("/api/resource-library/assets")
    assert listed_after_inspiration_disable.status_code == 200
    disabled_items = {item["id"]: item for item in listed_after_inspiration_disable.json()["items"]}
    assert disabled_items[source_resource_id]["effective_enabled"] is True
    assert disabled_items[source_resource_id]["effective_disabled_resource_type"] is None
    assert disabled_items[saved_poster.json()["id"]]["effective_enabled"] is True
    assert disabled_items[saved_poster.json()["id"]]["effective_disabled_resource_type"] is None

    blocked_load = client.post(
        f"/api/resource-library/assets/{source_resource_id}/load-to-workflow-node",
        json={"node_id": "missing-node"},
    )
    assert blocked_load.status_code == 404
    assert blocked_load.json()["detail"] == "工作流节点不存在"

    restored_inspiration = client.post(f"/api/resources/inspiration/{inspiration_id}/restore")
    assert restored_inspiration.status_code == 200
    listed_after_inspiration_restore = client.get("/api/resource-library/assets")
    assert listed_after_inspiration_restore.status_code == 200
    restored_items = {item["id"]: item for item in listed_after_inspiration_restore.json()["items"]}
    assert restored_items[source_resource_id]["effective_enabled"] is True
    assert restored_items[saved_poster.json()["id"]]["effective_enabled"] is True

    disabled_generated_asset = client.post(
        f"/api/resources/image_session_asset/{generated_asset_id}/disable",
        json={"reason": "生成图风险"},
    )
    assert disabled_generated_asset.status_code == 200

    listed_after_generated_disable = client.get("/api/resource-library/assets")
    assert listed_after_generated_disable.status_code == 200
    generated_disabled_items = {item["id"]: item for item in listed_after_generated_disable.json()["items"]}
    assert generated_disabled_items[saved_generated.json()["id"]]["effective_enabled"] is True
    assert generated_disabled_items[saved_generated.json()["id"]]["effective_disabled_resource_type"] is None

    restored_generated_asset = client.post(f"/api/resources/image_session_asset/{generated_asset_id}/restore")
    assert restored_generated_asset.status_code == 200
    listed_after_generated_restore = client.get("/api/resource-library/assets")
    assert listed_after_generated_restore.status_code == 200
    generated_restored_items = {item["id"]: item for item in listed_after_generated_restore.json()["items"]}
    assert generated_restored_items[saved_generated.json()["id"]]["effective_enabled"] is True

    group_a_items = client.get("/api/resource-library/assets", params={"group_id": first_group})
    assert group_a_items.status_code == 200
    assert {item["id"] for item in group_a_items.json()["items"]} == {
        source_resource_id,
        saved_generated.json()["id"],
    }

    group_b_items = client.get("/api/resource-library/assets", params={"group_id": second_group})
    assert group_b_items.status_code == 200
    assert {item["id"] for item in group_b_items.json()["items"]} == {
        source_resource_id,
        saved_poster.json()["id"],
    }
    assert db_session.query(ResourceLibraryAsset).count() == 3


def test_resource_library_loads_image_to_workflow_node_and_image_session(configured_env: Path) -> None:
    app = create_app()
    client = TestClient(app)
    _login(client)
    inspiration_id, reference_node_id, source_asset_id = _create_inspiration_with_reference(client, "资源库加载")
    saved = client.post(
        "/api/resource-library/assets/save",
        json={
            "source_type": "source_asset",
            "source_id": source_asset_id,
            "group_ids": [client.get("/api/resource-library/groups").json()["items"][0]["id"]],
        },
    )
    assert saved.status_code == 201
    resource_id = saved.json()["id"]

    loaded_workflow = client.post(
        f"/api/resource-library/assets/{resource_id}/load-to-workflow-node",
        json={"node_id": reference_node_id},
    )
    assert loaded_workflow.status_code == 200
    loaded_node = next(node for node in loaded_workflow.json()["nodes"] if node["id"] == reference_node_id)
    loaded_source_asset_id = loaded_node["output_json"]["source_asset_ids"][0]
    assert loaded_source_asset_id != source_asset_id
    assert loaded_node["config_json"]["source_asset_ids"] == [loaded_source_asset_id]

    inspiration_after = client.get(f"/api/inspirations/{inspiration_id}")
    assert inspiration_after.status_code == 200
    assert loaded_source_asset_id in {asset["id"] for asset in inspiration_after.json()["source_assets"]}

    created_session = client.post("/api/image-sessions", json={"title": "资源库加载会话"})
    assert created_session.status_code == 201
    image_session_id = created_session.json()["id"]
    loaded_session = client.post(
        f"/api/resource-library/assets/{resource_id}/load-to-image-session",
        json={"image_session_id": image_session_id},
    )
    assert loaded_session.status_code == 200
    reference_assets = [asset for asset in loaded_session.json()["assets"] if asset["kind"] == "reference_upload"]
    assert len(reference_assets) == 1
    assert reference_assets[0]["original_filename"] == saved.json()["original_filename"]
    assert reference_assets[0]["download_url"].startswith("/api/image-session-assets/")


def test_resource_library_archives_asset_and_hides_it_from_read_paths(configured_env: Path) -> None:
    app = create_app()
    client = TestClient(app)
    _login(client)
    _, reference_node_id, source_asset_id = _create_inspiration_with_reference(client, "资源库归档")
    group_id = client.get("/api/resource-library/groups").json()["items"][0]["id"]
    saved = client.post(
        "/api/resource-library/assets/save",
        json={"source_type": "source_asset", "source_id": source_asset_id, "group_ids": [group_id]},
    )
    assert saved.status_code == 201
    resource_id = saved.json()["id"]

    archived = client.delete(f"/api/resource-library/assets/{resource_id}")
    assert archived.status_code == 204

    listed = client.get("/api/resource-library/assets")
    assert listed.status_code == 200
    assert listed.json()["items"] == []

    source_status = client.get(
        "/api/resource-library/source-status",
        params={"source_type": "source_asset", "source_ids": source_asset_id},
    )
    assert source_status.status_code == 200
    assert source_status.json()["items"] == [
        {"source_id": source_asset_id, "saved": False, "asset": None, "group_ids": []}
    ]

    downloaded = client.get(f"/api/resource-library/assets/{resource_id}/download")
    assert downloaded.status_code == 404

    loaded_workflow = client.post(
        f"/api/resource-library/assets/{resource_id}/load-to-workflow-node",
        json={"node_id": reference_node_id},
    )
    assert loaded_workflow.status_code == 404


def test_resource_library_rejects_admin_saving_other_user_source(configured_env: Path) -> None:
    app = create_app()
    admin_client = TestClient(app)
    _login(admin_client)

    created_user = admin_client.post(
        "/api/rbac/users",
        json={"username": "resource-member", "display_name": "Resource Member"},
    )
    assert created_user.status_code == 201
    grant = admin_client.put(
        f"/api/rbac/users/{created_user.json()['id']}/generation-resource-groups",
        json={"resource_group_ids": [DEFAULT_GENERATION_RESOURCE_GROUP_ID]},
    )
    assert grant.status_code == 200

    member_client = TestClient(app)
    password = member_client.post(
        "/api/auth/password",
        json={
            "username": "resource-member",
            "password": "resource-member-password",
            "setup_token": created_user.json()["password_setup_token"],
        },
    )
    assert password.status_code == 200
    _, _, member_source_asset_id = _create_inspiration_with_reference(member_client, "成员资源")

    rejected = admin_client.post(
        "/api/resource-library/assets/save",
        json={"source_type": "source_asset", "source_id": member_source_asset_id, "group_ids": []},
    )
    assert rejected.status_code == 400
    assert rejected.json()["detail"] == "管理员不能直接编辑其他用户资源"
