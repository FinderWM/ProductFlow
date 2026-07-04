from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient
from helpers import _login, _make_demo_image_bytes_with_size

from inspiration_one_backend.application.image_to_code.jobs import execute_image_to_code_job
from inspiration_one_backend.application.resource_library import (
    ResourceLibraryUploadImage,
    upload_resource_library_assets,
)
from inspiration_one_backend.domain.enums import ImageToCodeDeliveryMode, ImageToCodeSourceKind, JobStatus
from inspiration_one_backend.infrastructure.db.models import ADMIN_USER_ID, ImageToCodeJob


def test_image_to_code_job_api_runs_preview_and_downloads(
    configured_env: Path,
    db_session,
    monkeypatch,
) -> None:
    from inspiration_one_backend.presentation.api import create_app

    asset = _create_resource_library_asset(db_session, width=180, height=120)
    monkeypatch.setattr(
        "inspiration_one_backend.infrastructure.queue.enqueue_image_to_code_job",
        execute_image_to_code_job,
    )

    client = TestClient(create_app())
    _login(client)

    created = client.post(
        "/api/image-to-code-jobs",
        json={
            "source_kind": "resource_library_asset",
            "source_ref": asset.id,
            "delivery_mode": "both",
            "page_type": "landing",
            "fidelity_mode": "balanced",
            "responsive_shell": True,
            "export_hd_preview": True,
            "notes": "API test",
        },
    )

    assert created.status_code == 202, created.text
    payload = created.json()
    assert payload["status"] == "succeeded"
    manifest = payload["result_manifest"]
    assert manifest["preview"]["preview_available"] is True
    assert manifest["preview"]["site_preview_url"] == f"/api/image-to-code-jobs/{payload['id']}/preview"
    assert any(artifact["type"] == "site_zip" for artifact in manifest["artifacts"])

    preview = client.get(manifest["preview"]["site_preview_url"])
    assert preview.status_code == 200
    assert "sandbox" in preview.headers["content-security-policy"]
    assert 'href="assets/site.css"' in preview.text
    assert 'src="assets/source.png"' in preview.text

    preview_asset = client.get(f"/api/image-to-code-jobs/{payload['id']}/assets/site.css")
    assert preview_asset.status_code == 200
    assert preview_asset.headers["content-type"].startswith("text/css")

    site_zip = next(artifact for artifact in manifest["artifacts"] if artifact["type"] == "site_zip")
    download = client.get(site_zip["download_url"])
    assert download.status_code == 200
    assert download.headers["content-type"] == "application/zip"

    listed = client.get("/api/image-to-code-jobs")
    assert listed.status_code == 200
    listed_payload = listed.json()
    assert listed_payload["items"][0]["id"] == payload["id"]
    assert listed_payload["total"] == 1
    assert listed_payload["limit"] == 50
    assert listed_payload["offset"] == 0

    detail = client.get(f"/api/image-to-code-jobs/{payload['id']}")
    assert detail.status_code == 200
    assert detail.json()["id"] == payload["id"]


def test_image_to_code_job_api_lists_with_status_filter_and_pagination(configured_env: Path, db_session) -> None:
    from inspiration_one_backend.presentation.api import create_app

    jobs = [
        ImageToCodeJob(
            owner_user_id=ADMIN_USER_ID,
            source_kind=ImageToCodeSourceKind.RESOURCE_LIBRARY_ASSET,
            source_ref=f"asset-{index}",
            source_width=100,
            source_height=100,
            source_mime_type="image/png",
            delivery_mode=ImageToCodeDeliveryMode.BOTH,
            job_params_json={
                "page_type": "landing",
                "fidelity_mode": "balanced",
                "responsive_shell": True,
                "export_hd_preview": True,
                "notes": None,
            },
            status=status,
            progress_phase="queued",
            progress_completed=0,
            progress_total=4,
        )
        for index, status in enumerate([JobStatus.QUEUED, JobStatus.RUNNING, JobStatus.SUCCEEDED], start=1)
    ]
    db_session.add_all(jobs)
    db_session.commit()

    client = TestClient(create_app())
    _login(client)

    filtered = client.get("/api/image-to-code-jobs", params={"status": "succeeded", "limit": 20, "offset": 0})

    assert filtered.status_code == 200
    filtered_payload = filtered.json()
    assert filtered_payload["total"] == 1
    assert filtered_payload["limit"] == 20
    assert filtered_payload["offset"] == 0
    assert [item["status"] for item in filtered_payload["items"]] == ["succeeded"]

    second_page = client.get("/api/image-to-code-jobs", params={"limit": 2, "offset": 2})

    assert second_page.status_code == 200
    second_page_payload = second_page.json()
    assert second_page_payload["total"] == 3
    assert second_page_payload["limit"] == 2
    assert second_page_payload["offset"] == 2
    assert len(second_page_payload["items"]) == 1


def test_image_to_code_job_api_rejects_invalid_page_type(configured_env: Path, db_session) -> None:
    from inspiration_one_backend.presentation.api import create_app

    asset = _create_resource_library_asset(db_session, width=180, height=120)

    client = TestClient(create_app())
    _login(client)

    created = client.post(
        "/api/image-to-code-jobs",
        json={
            "source_kind": "resource_library_asset",
            "source_ref": asset.id,
            "delivery_mode": "both",
            "page_type": "unknown_layout",
            "fidelity_mode": "balanced",
            "responsive_shell": True,
            "export_hd_preview": True,
            "notes": "invalid page type",
        },
    )

    assert created.status_code == 422
    assert "页面类型无效" in created.text


def _create_resource_library_asset(db_session, *, width: int, height: int):
    return upload_resource_library_assets(
        db_session,
        uploads=[
            ResourceLibraryUploadImage(
                filename="source.png",
                mime_type="image/png",
                content=_make_demo_image_bytes_with_size(width, height),
            )
        ],
        group_ids=None,
        actor_user_id=ADMIN_USER_ID,
    )[0]
