from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session

from inspiration_one_backend.application.image_to_code.execution import (
    ImageToCodeBuildBundle,
    ImageToCodeJobParams,
    ImageToCodeSourceSnapshot,
    build_image_to_code_bundle,
)
from inspiration_one_backend.application.moderation import ensure_resource_usable
from inspiration_one_backend.application.ownership import ensure_actor_can_mutate_owner
from inspiration_one_backend.application.queue_submission import enqueue_or_mark_failed
from inspiration_one_backend.application.time import now_utc
from inspiration_one_backend.domain.enums import (
    ImageToCodeDeliveryMode,
    ImageToCodeSourceKind,
    JobStatus,
    ResourceLibraryAssetKind,
)
from inspiration_one_backend.domain.errors import BusinessValidationError, NotFoundError
from inspiration_one_backend.infrastructure.db.models import ImageToCodeJob, ResourceLibraryAsset
from inspiration_one_backend.infrastructure.db.session import get_session_factory
from inspiration_one_backend.infrastructure.image.base import image_dimensions_from_bytes
from inspiration_one_backend.infrastructure.storage import LocalStorage

logger = logging.getLogger(__name__)

IMAGE_TO_CODE_CANCELLED_REASON = "已取消"
IMAGE_TO_CODE_RECOVERY_STALE_AFTER = timedelta(minutes=30)


def list_image_to_code_jobs(
    session: Session,
    *,
    actor_user_id: str,
    limit: int = 50,
    offset: int = 0,
    status_filter: JobStatus | None = None,
) -> list[ImageToCodeJob]:
    conditions = [ImageToCodeJob.owner_user_id == actor_user_id]
    if status_filter is not None:
        conditions.append(ImageToCodeJob.status == status_filter)
    return list(
        session.scalars(
            select(ImageToCodeJob)
            .where(*conditions)
            .order_by(ImageToCodeJob.created_at.desc(), ImageToCodeJob.id.desc())
            .offset(max(0, offset))
            .limit(max(1, min(limit, 100)))
        ).all()
    )


def count_image_to_code_jobs(
    session: Session,
    *,
    actor_user_id: str,
    status_filter: JobStatus | None = None,
) -> int:
    conditions = [ImageToCodeJob.owner_user_id == actor_user_id]
    if status_filter is not None:
        conditions.append(ImageToCodeJob.status == status_filter)
    return int(session.scalar(select(func.count()).select_from(ImageToCodeJob).where(*conditions)) or 0)


def get_image_to_code_job(
    session: Session,
    job_id: str,
    *,
    actor_user_id: str,
    actor_is_admin: bool = False,
) -> ImageToCodeJob:
    job = session.get(ImageToCodeJob, job_id)
    if job is None:
        raise NotFoundError("图片转代码任务不存在")
    ensure_actor_can_mutate_owner(
        owner_user_id=job.owner_user_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        missing_message="图片转代码任务不存在",
    )
    return job


def create_image_to_code_job(
    session: Session,
    *,
    source_kind: ImageToCodeSourceKind,
    source_ref: str,
    delivery_mode: ImageToCodeDeliveryMode,
    params: dict[str, Any],
    actor_user_id: str,
    actor_is_admin: bool = False,
    storage: LocalStorage | None = None,
) -> ImageToCodeJob:
    storage = storage or LocalStorage()
    source = load_image_to_code_source(
        session,
        source_kind=source_kind,
        source_ref=source_ref,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        storage=storage,
    )
    normalized_params = ImageToCodeJobParams.model_validate(params)
    job = ImageToCodeJob(
        owner_user_id=source.owner_user_id,
        source_kind=source_kind,
        source_ref=source_ref,
        source_width=source.width,
        source_height=source.height,
        source_mime_type=source.mime_type,
        delivery_mode=delivery_mode,
        job_params_json=normalized_params.model_dump(mode="json"),
        status=JobStatus.QUEUED,
        progress_phase="queued",
        progress_completed=0,
        progress_total=_progress_total_for_delivery_mode(delivery_mode),
    )
    session.add(job)
    session.commit()
    session.refresh(job)
    return job


def submit_image_to_code_job(
    session: Session,
    *,
    source_kind: ImageToCodeSourceKind,
    source_ref: str,
    delivery_mode: ImageToCodeDeliveryMode,
    params: dict[str, Any],
    actor_user_id: str,
    actor_is_admin: bool = False,
    storage: LocalStorage | None = None,
) -> ImageToCodeJob:
    job = create_image_to_code_job(
        session,
        source_kind=source_kind,
        source_ref=source_ref,
        delivery_mode=delivery_mode,
        params=params,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        storage=storage,
    )
    from inspiration_one_backend.infrastructure.queue import enqueue_image_to_code_job

    enqueue_or_mark_failed(
        job.id,
        enqueue=enqueue_image_to_code_job,
        mark_failed=mark_image_to_code_job_enqueue_failed,
    )
    session.expire_all()
    return session.get(ImageToCodeJob, job.id) or job


def mark_image_to_code_job_enqueue_failed(job_id: str, reason: str) -> None:
    session = get_session_factory()()
    try:
        job = session.get(ImageToCodeJob, job_id)
        if job is not None and job.status == JobStatus.QUEUED:
            job.status = JobStatus.FAILED
            job.last_error = reason
            job.finished_at = now_utc()
            job.progress_phase = "enqueue_failed"
            job.progress_updated_at = now_utc()
            session.commit()
    finally:
        session.close()


def cancel_image_to_code_job(
    session: Session,
    job_id: str,
    *,
    actor_user_id: str,
    actor_is_admin: bool = False,
) -> ImageToCodeJob:
    job = get_image_to_code_job(session, job_id, actor_user_id=actor_user_id, actor_is_admin=actor_is_admin)
    if job.status in {JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.CANCELLED}:
        raise BusinessValidationError("任务已结束，不能取消")
    job.status = JobStatus.CANCELLED
    job.last_error = IMAGE_TO_CODE_CANCELLED_REASON
    job.finished_at = now_utc()
    job.progress_phase = "cancelled"
    job.progress_updated_at = now_utc()
    session.commit()
    session.refresh(job)
    return job


def retry_image_to_code_job(
    session: Session,
    job_id: str,
    *,
    actor_user_id: str,
    actor_is_admin: bool = False,
    storage: LocalStorage | None = None,
) -> ImageToCodeJob:
    job = get_image_to_code_job(session, job_id, actor_user_id=actor_user_id, actor_is_admin=actor_is_admin)
    if job.status not in {JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.CANCELLED}:
        raise BusinessValidationError("任务运行中，不能重跑")
    params = dict(job.job_params_json or {})
    params["retry_from_job_id"] = job.id
    return submit_image_to_code_job(
        session,
        source_kind=job.source_kind,
        source_ref=job.source_ref,
        delivery_mode=job.delivery_mode,
        params=params,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        storage=storage,
    )


def execute_image_to_code_job(job_id: str) -> None:
    session = get_session_factory()()
    storage = LocalStorage()
    try:
        if not _claim_image_to_code_job(session, job_id):
            return
        job = session.get(ImageToCodeJob, job_id)
        if job is None:
            return
        _set_progress(session, job, phase="analyzing", completed=0)
        source = load_image_to_code_source(
            session,
            source_kind=job.source_kind,
            source_ref=job.source_ref,
            actor_user_id=job.owner_user_id,
            actor_is_admin=False,
            storage=storage,
        )
        params = ImageToCodeJobParams.model_validate(job.job_params_json or {})
        bundle = build_image_to_code_bundle(
            source=source,
            delivery_mode=job.delivery_mode,
            params=params,
        )
        if _job_cancelled(session, job.id):
            raise BusinessValidationError(IMAGE_TO_CODE_CANCELLED_REASON)
        _set_progress(session, job, phase="writing_artifacts", completed=max(1, job.progress_total - 1))
        manifest = _persist_bundle(
            job=job,
            bundle=bundle,
            source=source,
            params=params,
            storage=storage,
        )
        if _job_cancelled(session, job.id):
            raise BusinessValidationError(IMAGE_TO_CODE_CANCELLED_REASON)
        _mark_image_to_code_job_succeeded(session, job_id=job.id, manifest=manifest)
    except Exception as exc:  # noqa: BLE001
        session.rollback()
        _settle_image_to_code_failure(job_id, exc, storage=storage)
    finally:
        session.close()


def recover_unfinished_image_to_code_jobs(
    *,
    reset_stale_running: bool = False,
    stale_running_after: timedelta = IMAGE_TO_CODE_RECOVERY_STALE_AFTER,
) -> int:
    cutoff = now_utc() - stale_running_after
    session = get_session_factory()()
    job_ids: list[str] = []
    try:
        jobs = list(
            session.scalars(
                select(ImageToCodeJob).where(ImageToCodeJob.status.in_((JobStatus.QUEUED, JobStatus.RUNNING)))
            ).all()
        )
        for job in jobs:
            if job.status == JobStatus.RUNNING:
                if not reset_stale_running:
                    continue
                heartbeat = _latest_job_heartbeat(job)
                if heartbeat is not None and heartbeat > cutoff:
                    continue
                job.status = JobStatus.QUEUED
                job.started_at = None
                job.progress_phase = "requeued_after_idle"
                job.progress_updated_at = now_utc()
            job_ids.append(job.id)
        session.commit()
    except Exception:  # noqa: BLE001
        session.rollback()
        logger.exception("恢复图片转代码任务时读取数据库失败")
        return 0
    finally:
        session.close()

    if not job_ids:
        return 0
    from inspiration_one_backend.infrastructure.queue import enqueue_image_to_code_job

    enqueued = 0
    for job_id in job_ids:
        try:
            enqueue_image_to_code_job(job_id)
            enqueued += 1
        except Exception:  # noqa: BLE001
            logger.exception("恢复图片转代码任务入队失败: job_id=%s", job_id)
    return enqueued


def load_image_to_code_source(
    session: Session,
    *,
    source_kind: ImageToCodeSourceKind,
    source_ref: str,
    actor_user_id: str,
    actor_is_admin: bool,
    storage: LocalStorage,
) -> ImageToCodeSourceSnapshot:
    if source_kind != ImageToCodeSourceKind.RESOURCE_LIBRARY_ASSET:
        raise BusinessValidationError("当前仅支持从资源库图片创建图片转代码任务")
    asset = session.get(ResourceLibraryAsset, source_ref)
    if asset is None or asset.archived_at is not None:
        raise NotFoundError("资源库图片不存在")
    ensure_actor_can_mutate_owner(
        owner_user_id=asset.owner_user_id,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        missing_message="资源库图片不存在",
    )
    ensure_resource_usable(asset)
    if asset.kind != ResourceLibraryAssetKind.IMAGE:
        raise BusinessValidationError("当前仅支持图片资源")
    path = storage.resolve(asset.storage_path)
    content = path.read_bytes()
    width, height = image_dimensions_from_bytes(content)
    return ImageToCodeSourceSnapshot(
        owner_user_id=asset.owner_user_id,
        filename=asset.original_filename,
        mime_type=asset.mime_type or "image/png",
        width=width,
        height=height,
        content=content,
    )


def _persist_bundle(
    *,
    job: ImageToCodeJob,
    bundle: ImageToCodeBuildBundle,
    source: ImageToCodeSourceSnapshot,
    params: ImageToCodeJobParams,
    storage: LocalStorage,
) -> dict[str, Any]:
    site_storage_keys: dict[str, str] = {}
    for file_payload in bundle.site_files:
        site_storage_keys[file_payload.relative_path] = storage.save_image_to_code_file(
            job.id,
            f"site/{file_payload.relative_path}",
            file_payload.content,
            content_type=file_payload.mime_type,
            warm_variants=file_payload.warm_variants,
        )

    artifact_entries: list[dict[str, Any]] = []
    for artifact in bundle.artifact_payloads:
        if artifact.artifact_id == "site_index_html":
            storage_key = site_storage_keys["index.html"]
        else:
            subdir = _artifact_subdir(artifact.artifact_type)
            storage_key = storage.save_image_to_code_file(
                job.id,
                f"{subdir}/{artifact.filename}",
                artifact.content,
                content_type=artifact.mime_type,
                warm_variants=artifact.artifact_type in {"source_snapshot", "preview_image"},
            )
        artifact_entries.append(
            {
                "id": artifact.artifact_id,
                "type": artifact.artifact_type,
                "label": artifact.label,
                "filename": artifact.filename,
                "mime_type": artifact.mime_type,
                "size_bytes": len(artifact.content),
                "storage_key": storage_key,
                "preview_role": artifact.preview_role,
            }
        )

    preview_assets = {
        relative_path: storage_key
        for relative_path, storage_key in site_storage_keys.items()
        if relative_path != "index.html"
    }
    return {
        "input": {
            "filename": source.filename,
            "mime_type": source.mime_type,
            "width": source.width,
            "height": source.height,
        },
        "params": params.model_dump(mode="json"),
        "preview": {
            "preview_image_artifact_id": "preview_image",
            "site_preview_enabled": True,
            "site_preview_url": f"/api/image-to-code-jobs/{job.id}/preview",
            "preview_asset_paths": sorted(preview_assets.keys()),
        },
        "static_site": bundle.static_site_summary,
        "figma_export": bundle.figma_summary,
        "warnings": bundle.warnings,
        "retry_from_job_id": params.retry_from_job_id,
        "artifacts": artifact_entries,
        "preview_index_storage_key": site_storage_keys["index.html"],
        "preview_asset_storage_keys": preview_assets,
        "delivery_report": bundle.delivery_report_json,
    }


def _artifact_subdir(artifact_type: str) -> str:
    return {
        "source_snapshot": "source",
        "preview_image": "preview",
        "site_zip": "site",
        "layers_manifest": "reports",
        "delivery_report_json": "reports",
        "delivery_report_md": "reports",
        "figma_layer_spec": "figma",
        "figma_import_zip": "figma",
        "figma_readme": "figma",
    }.get(artifact_type, "reports")


def _claim_image_to_code_job(session: Session, job_id: str) -> bool:
    claimed = session.execute(
        update(ImageToCodeJob)
        .where(ImageToCodeJob.id == job_id, ImageToCodeJob.status == JobStatus.QUEUED)
        .values(
            status=JobStatus.RUNNING,
            started_at=now_utc(),
            progress_phase="running",
            progress_updated_at=now_utc(),
            attempts=ImageToCodeJob.attempts + 1,
        )
    )
    assert isinstance(claimed, CursorResult)
    session.commit()
    return claimed.rowcount > 0


def _mark_image_to_code_job_succeeded(session: Session, *, job_id: str, manifest: dict[str, Any]) -> None:
    job = session.get(ImageToCodeJob, job_id)
    if job is None:
        return
    job.status = JobStatus.SUCCEEDED
    job.result_manifest_json = manifest
    job.last_error = None
    job.finished_at = now_utc()
    job.progress_phase = "succeeded"
    job.progress_completed = job.progress_total
    job.progress_updated_at = now_utc()
    session.commit()


def _settle_image_to_code_failure(job_id: str, exc: Exception, *, storage: LocalStorage) -> None:
    failure_session = get_session_factory()()
    try:
        job = failure_session.get(ImageToCodeJob, job_id)
        if job is None:
            return
        if str(exc) == IMAGE_TO_CODE_CANCELLED_REASON or job.status == JobStatus.CANCELLED:
            job.status = JobStatus.CANCELLED
            job.last_error = IMAGE_TO_CODE_CANCELLED_REASON
            job.progress_phase = "cancelled"
        else:
            logger.exception("图片转代码任务失败: job_id=%s", job_id, exc_info=exc)
            job.status = JobStatus.FAILED
            job.last_error = str(exc) or "图片转代码执行失败"
            job.progress_phase = "failed"
        job.finished_at = now_utc()
        job.progress_updated_at = now_utc()
        job.result_manifest_json = None
        failure_session.commit()
        storage.delete_image_to_code_artifacts(job_id)
    finally:
        failure_session.close()


def _set_progress(session: Session, job: ImageToCodeJob, *, phase: str, completed: int) -> None:
    job.progress_phase = phase
    job.progress_completed = max(0, min(completed, job.progress_total))
    job.progress_updated_at = now_utc()
    session.commit()
    session.refresh(job)


def _job_cancelled(session: Session, job_id: str) -> bool:
    session.expire_all()
    job = session.get(ImageToCodeJob, job_id)
    return job is not None and job.status == JobStatus.CANCELLED


def _progress_total_for_delivery_mode(delivery_mode: ImageToCodeDeliveryMode) -> int:
    if delivery_mode in {ImageToCodeDeliveryMode.FIGMA_EXPORT, ImageToCodeDeliveryMode.BOTH}:
        return 4
    return 3


def _latest_job_heartbeat(job: ImageToCodeJob) -> datetime | None:
    candidates = [job.progress_updated_at, job.updated_at, job.started_at]
    resolved = [value for value in candidates if isinstance(value, datetime)]
    if not resolved:
        return None
    latest = max(resolved)
    if latest.tzinfo is None:
        return latest.replace(tzinfo=UTC)
    return latest
