from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient
from helpers import _login, _make_demo_image_bytes_with_size

from inspiration_one_backend.application.enhance.jobs import execute_enhance_job
from inspiration_one_backend.application.use_cases import create_inspiration
from inspiration_one_backend.domain.enums import EnhanceSourceKind, EnhanceStrategy, ImageSessionAssetKind, JobStatus
from inspiration_one_backend.infrastructure.db.models import (
    ADMIN_USER_ID,
    DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    AppSetting,
    EnhanceJob,
    ImageSession,
    ImageSessionAsset,
)
from inspiration_one_backend.infrastructure.provider_config import ensure_provider_config_bootstrapped
from inspiration_one_backend.infrastructure.storage import LocalStorage


def test_enhance_job_api_runs_and_serves_same_origin_final(
    configured_env: Path,
    db_session,
    monkeypatch,
) -> None:
    from inspiration_one_backend.presentation.api import create_app

    ensure_provider_config_bootstrapped(db_session)
    inspiration = create_inspiration(
        db_session,
        name="API 增强输入",
        category=None,
        price=None,
        source_note=None,
        image_bytes=_make_demo_image_bytes_with_size(160, 120),
        filename="source.png",
        content_type="image/png",
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        actor_is_admin=True,
    )
    source_id = inspiration.source_assets[0].id
    monkeypatch.setattr("inspiration_one_backend.infrastructure.queue.enqueue_enhance_job", execute_enhance_job)

    client = TestClient(create_app())
    _login(client)

    created = client.post(
        "/api/enhance-jobs",
        json={
            "source_kind": "source_asset",
            "source_ref": source_id,
            "strategy": "direct",
            "params": {"target_width": 512, "target_height": 512},
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        },
    )

    assert created.status_code == 202, created.text
    payload = created.json()
    assert payload["status"] == "succeeded"
    manifest = payload["result_manifest"]
    assert manifest["final_status"] == "ready"
    assert manifest["final_download_url"] == f"/api/enhance-jobs/{payload['id']}/final"
    assert manifest["tiles"][0]["download_url"] == f"/api/enhance-jobs/{payload['id']}/tiles/0/0"

    final = client.get(manifest["final_download_url"])
    assert final.status_code == 200
    assert final.headers["content-type"] == "image/png"

    tile = client.get(manifest["tiles"][0]["download_url"])
    assert tile.status_code == 200
    assert tile.headers["content-type"] == "image/png"

    listed = client.get("/api/enhance-jobs")
    assert listed.status_code == 200
    listed_payload = listed.json()
    assert listed_payload["items"][0]["id"] == payload["id"]
    assert listed_payload["total"] == 1
    assert listed_payload["limit"] == 50
    assert listed_payload["offset"] == 0


def test_enhance_job_api_lists_with_status_filter_and_pagination(configured_env: Path, db_session) -> None:
    from inspiration_one_backend.presentation.api import create_app

    jobs = [
        EnhanceJob(
            owner_user_id=ADMIN_USER_ID,
            source_kind=EnhanceSourceKind.SOURCE_ASSET,
            source_ref=f"source-{index}",
            source_width=100,
            source_height=100,
            source_mime_type="image/png",
            strategy=EnhanceStrategy.DIRECT,
            params_json={"target_width": 512, "target_height": 512},
            status=status,
            progress_completed=0,
            progress_total=1,
            resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        )
        for index, status in enumerate([JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.SUCCEEDED], start=1)
    ]
    db_session.add_all(jobs)
    db_session.commit()

    client = TestClient(create_app())
    _login(client)

    filtered = client.get("/api/enhance-jobs", params={"status": "succeeded", "limit": 20, "offset": 0})

    assert filtered.status_code == 200
    filtered_payload = filtered.json()
    assert filtered_payload["total"] == 1
    assert filtered_payload["limit"] == 20
    assert filtered_payload["offset"] == 0
    assert [item["status"] for item in filtered_payload["items"]] == ["succeeded"]

    second_page = client.get("/api/enhance-jobs", params={"limit": 2, "offset": 2})

    assert second_page.status_code == 200
    second_page_payload = second_page.json()
    assert second_page_payload["total"] == 3
    assert second_page_payload["limit"] == 2
    assert second_page_payload["offset"] == 2
    assert len(second_page_payload["items"]) == 1


def test_tiled_enhance_job_api_accepts_final_upload_above_generation_max_dimension(
    configured_env: Path,
    db_session,
    monkeypatch,
) -> None:
    from inspiration_one_backend.presentation.api import create_app

    db_session.add(AppSetting(key="image_generation_max_dimension", value="512"))
    db_session.commit()
    ensure_provider_config_bootstrapped(db_session)
    inspiration = create_inspiration(
        db_session,
        name="API 分块增强输入",
        category=None,
        price=None,
        source_note=None,
        image_bytes=_make_demo_image_bytes_with_size(200, 200),
        filename="source.png",
        content_type="image/png",
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        actor_is_admin=True,
    )
    source_id = inspiration.source_assets[0].id
    monkeypatch.setattr("inspiration_one_backend.infrastructure.queue.enqueue_enhance_job", execute_enhance_job)

    client = TestClient(create_app())
    _login(client)

    created = client.post(
        "/api/enhance-jobs",
        json={
            "source_kind": "source_asset",
            "source_ref": source_id,
            "strategy": "tiled",
            "params": {"scale": 4, "tile_base_size": 512},
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        },
    )
    assert created.status_code == 202, created.text
    payload = created.json()
    assert payload["status"] == "succeeded"
    manifest = payload["result_manifest"]
    assert manifest["final_width"] == 800
    assert manifest["final_height"] == 800
    assert manifest["final_image_ref"] is None
    assert manifest["final_status"] == "pending_upload"
    assert manifest["final_download_url"] is None

    uploaded = client.post(
        f"/api/enhance-jobs/{payload['id']}/final",
        files={"file": ("final.png", _make_demo_image_bytes_with_size(800, 800), "image/png")},
    )
    assert uploaded.status_code == 200, uploaded.text
    uploaded_manifest = uploaded.json()["result_manifest"]
    assert uploaded_manifest["final_image_ref"] == f"enhance/{payload['id']}/final.png"
    assert uploaded_manifest["final_status"] == "ready"
    assert uploaded_manifest["final_download_url"] == f"/api/enhance-jobs/{payload['id']}/final"

    final = client.get(uploaded_manifest["final_download_url"])
    assert final.status_code == 200
    assert final.headers["content-type"] == "image/png"


def test_enhance_job_api_attaches_result_to_image_session(
    configured_env: Path,
    db_session,
) -> None:
    from inspiration_one_backend.presentation.api import create_app

    image_session = ImageSession(
        owner_user_id=ADMIN_USER_ID,
        title="增强回填会话",
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    )
    db_session.add(image_session)
    db_session.flush()
    storage = LocalStorage()
    source_path = storage.save_image_session_generated(
        image_session.id,
        _make_demo_image_bytes_with_size(160, 120),
        content_type="image/png",
    )
    source_asset = ImageSessionAsset(
        owner_user_id=ADMIN_USER_ID,
        session_id=image_session.id,
        kind=ImageSessionAssetKind.GENERATED_IMAGE,
        original_filename="source.png",
        mime_type="image/png",
        **storage.metadata_for(source_path).as_model_kwargs(),
    )
    db_session.add(source_asset)
    db_session.flush()
    job = EnhanceJob(
        owner_user_id=ADMIN_USER_ID,
        source_kind=EnhanceSourceKind.IMAGE_SESSION_ASSET,
        source_ref=source_asset.id,
        source_width=160,
        source_height=120,
        source_mime_type="image/png",
        strategy=EnhanceStrategy.DIRECT,
        params_json={"target_width": 320, "target_height": 240},
        status=JobStatus.SUCCEEDED,
        progress_completed=1,
        progress_total=1,
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    )
    db_session.add(job)
    db_session.flush()
    final_ref = storage.save_enhance_final(
        f"enhance/{job.id}",
        _make_demo_image_bytes_with_size(320, 240),
        content_type="image/png",
    )
    job.result_manifest_json = {
        "strategy": "direct",
        "final_width": 320,
        "final_height": 240,
        "rows": 1,
        "cols": 1,
        "final_image_ref": final_ref,
        "final_status": "ready",
        "tiles": [],
    }
    db_session.commit()

    client = TestClient(create_app())
    _login(client)

    attached = client.post(f"/api/enhance-jobs/{job.id}/attach-to-image-session")

    assert attached.status_code == 200, attached.text
    payload = attached.json()
    assert payload["id"] == image_session.id
    assert len(payload["rounds"]) == 1
    assert payload["rounds"][0]["provider_response_id"] == job.id
    assert payload["rounds"][0]["base_asset_ids"] == [source_asset.id]
    assert payload["rounds"][0]["generated_asset"]["kind"] == "generated_image"

    attached_again = client.post(f"/api/enhance-jobs/{job.id}/attach-to-image-session")
    assert attached_again.status_code == 200, attached_again.text
    assert [round_item["id"] for round_item in attached_again.json()["rounds"]] == [
        payload["rounds"][0]["id"]
    ]


def test_enhance_final_upload_rejects_oversized_request_before_service(
    configured_env: Path,
    monkeypatch,
) -> None:
    from inspiration_one_backend.presentation.api import create_app
    from inspiration_one_backend.presentation.routes import enhance as enhance_routes

    monkeypatch.setattr(enhance_routes, "ENHANCE_FINAL_MAX_UPLOAD_BYTES", 8)
    monkeypatch.setattr(enhance_routes, "ENHANCE_FINAL_MULTIPART_OVERHEAD_BYTES", 0)

    def fail_upload(*_args, **_kwargs):
        raise AssertionError("upload_enhance_final should not be called for oversized requests")

    monkeypatch.setattr(enhance_routes, "upload_enhance_final", fail_upload)

    client = TestClient(create_app())
    _login(client)

    response = client.post(
        "/api/enhance-jobs/job-1/final",
        files={"file": ("final.png", b"0123456789", "image/png")},
    )

    assert response.status_code == 413
    assert response.json() == {"detail": "拼接结果文件过大"}
