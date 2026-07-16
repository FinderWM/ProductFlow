from __future__ import annotations

from datetime import timedelta

import sqlalchemy as sa
from helpers import _make_demo_image_bytes_with_size

from inspiration_one_backend.application.image_to_code.jobs import (
    cancel_image_to_code_job,
    create_image_to_code_job,
    execute_image_to_code_job,
    recover_unfinished_image_to_code_jobs,
    retry_image_to_code_job,
)
from inspiration_one_backend.application.resource_library import (
    ResourceLibraryUploadImage,
    upload_resource_library_assets,
)
from inspiration_one_backend.application.time import now_utc
from inspiration_one_backend.domain.enums import ImageToCodeDeliveryMode, ImageToCodeSourceKind, JobStatus
from inspiration_one_backend.infrastructure.db.models import ADMIN_USER_ID, ImageToCodeJob
from inspiration_one_backend.infrastructure.storage import LocalStorage


def test_image_to_code_job_lifecycle_succeeds(db_session) -> None:
    asset = _create_resource_library_asset(db_session, width=180, height=120)

    job = create_image_to_code_job(
        db_session,
        source_kind=ImageToCodeSourceKind.RESOURCE_LIBRARY_ASSET,
        source_ref=asset.id,
        delivery_mode=ImageToCodeDeliveryMode.BOTH,
        params={
            "page_type": "landing",
            "fidelity_mode": "balanced",
            "responsive_shell": True,
            "export_hd_preview": True,
            "notes": "lifecycle test",
        },
        actor_user_id=ADMIN_USER_ID,
        actor_is_admin=True,
    )

    execute_image_to_code_job(job.id)

    db_session.expire_all()
    saved = db_session.get(ImageToCodeJob, job.id)
    assert saved is not None
    assert saved.status == JobStatus.SUCCEEDED
    assert saved.result_manifest_json is not None
    assert saved.progress_completed == saved.progress_total
    assert saved.result_manifest_json["preview"]["site_preview_enabled"] is True
    assert saved.result_manifest_json["preview_index_storage_key"] == f"image-to-code/{job.id}/site/index.html"
    artifact_types = {artifact["type"] for artifact in saved.result_manifest_json["artifacts"]}
    assert {"site_zip", "figma_import_zip", "preview_image", "site_index_html"} <= artifact_types
    preview_image = next(
        artifact for artifact in saved.result_manifest_json["artifacts"] if artifact["type"] == "preview_image"
    )
    assert LocalStorage().stat(preview_image["storage_key"]).content_length > 0


def test_image_to_code_job_cancel_and_retry_create_new_job(db_session, monkeypatch) -> None:
    asset = _create_resource_library_asset(db_session, width=160, height=110)
    monkeypatch.setattr(
        "inspiration_one_backend.infrastructure.queue.enqueue_image_to_code_job",
        lambda job_id: None,
    )

    job = create_image_to_code_job(
        db_session,
        source_kind=ImageToCodeSourceKind.RESOURCE_LIBRARY_ASSET,
        source_ref=asset.id,
        delivery_mode=ImageToCodeDeliveryMode.STATIC_SITE,
        params={
            "page_type": "marketing",
            "fidelity_mode": "visual_first",
            "responsive_shell": True,
            "export_hd_preview": False,
            "notes": None,
        },
        actor_user_id=ADMIN_USER_ID,
        actor_is_admin=True,
    )

    cancelled = cancel_image_to_code_job(
        db_session,
        job.id,
        actor_user_id=ADMIN_USER_ID,
        actor_is_admin=True,
    )
    assert cancelled.status == JobStatus.CANCELLED

    retried = retry_image_to_code_job(
        db_session,
        job.id,
        actor_user_id=ADMIN_USER_ID,
        actor_is_admin=True,
    )
    assert retried.id != job.id
    assert retried.status == JobStatus.QUEUED
    assert retried.job_params_json["retry_from_job_id"] == job.id


def test_image_to_code_job_recovery_requeues_stale_running_jobs(db_session, monkeypatch) -> None:
    asset = _create_resource_library_asset(db_session, width=140, height=90)
    queued = create_image_to_code_job(
        db_session,
        source_kind=ImageToCodeSourceKind.RESOURCE_LIBRARY_ASSET,
        source_ref=asset.id,
        delivery_mode=ImageToCodeDeliveryMode.STATIC_SITE,
        params={
            "page_type": "landing",
            "fidelity_mode": "balanced",
            "responsive_shell": True,
            "export_hd_preview": True,
            "notes": None,
        },
        actor_user_id=ADMIN_USER_ID,
        actor_is_admin=True,
    )
    stale_running = create_image_to_code_job(
        db_session,
        source_kind=ImageToCodeSourceKind.RESOURCE_LIBRARY_ASSET,
        source_ref=asset.id,
        delivery_mode=ImageToCodeDeliveryMode.STATIC_SITE,
        params={
            "page_type": "landing",
            "fidelity_mode": "balanced",
            "responsive_shell": True,
            "export_hd_preview": True,
            "notes": None,
        },
        actor_user_id=ADMIN_USER_ID,
        actor_is_admin=True,
    )
    fresh_running = create_image_to_code_job(
        db_session,
        source_kind=ImageToCodeSourceKind.RESOURCE_LIBRARY_ASSET,
        source_ref=asset.id,
        delivery_mode=ImageToCodeDeliveryMode.STATIC_SITE,
        params={
            "page_type": "landing",
            "fidelity_mode": "balanced",
            "responsive_shell": True,
            "export_hd_preview": True,
            "notes": None,
        },
        actor_user_id=ADMIN_USER_ID,
        actor_is_admin=True,
    )
    stale_time = now_utc() - timedelta(hours=1)
    fresh_time = now_utc()
    stale_running.status = JobStatus.RUNNING
    stale_running.started_at = stale_time
    stale_running.progress_updated_at = stale_time
    fresh_running.status = JobStatus.RUNNING
    fresh_running.started_at = fresh_time
    fresh_running.progress_updated_at = fresh_time
    db_session.commit()
    db_session.execute(
        sa.update(ImageToCodeJob)
        .where(ImageToCodeJob.id == stale_running.id)
        .values(updated_at=stale_time, started_at=stale_time, progress_updated_at=stale_time, status=JobStatus.RUNNING)
    )
    db_session.execute(
        sa.update(ImageToCodeJob)
        .where(ImageToCodeJob.id == fresh_running.id)
        .values(updated_at=fresh_time, started_at=fresh_time, progress_updated_at=fresh_time, status=JobStatus.RUNNING)
    )
    db_session.commit()

    enqueued_ids: list[str] = []
    monkeypatch.setattr(
        "inspiration_one_backend.infrastructure.queue.enqueue_image_to_code_job",
        lambda job_id: enqueued_ids.append(job_id),
    )

    enqueued = recover_unfinished_image_to_code_jobs(
        reset_stale_running=True,
        stale_running_after=timedelta(minutes=5),
    )

    assert enqueued == 2
    assert set(enqueued_ids) == {queued.id, stale_running.id}
    db_session.expire_all()
    assert db_session.get(ImageToCodeJob, stale_running.id).status == JobStatus.QUEUED
    assert db_session.get(ImageToCodeJob, fresh_running.id).status == JobStatus.RUNNING


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
