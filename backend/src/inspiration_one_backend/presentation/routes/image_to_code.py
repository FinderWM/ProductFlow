from __future__ import annotations

import mimetypes
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from inspiration_one_backend.application.image_to_code.jobs import (
    cancel_image_to_code_job,
    count_image_to_code_jobs,
    get_image_to_code_job,
    list_image_to_code_jobs,
    retry_image_to_code_job,
    submit_image_to_code_job,
)
from inspiration_one_backend.domain.enums import JobStatus
from inspiration_one_backend.domain.rbac import API_IMAGE_TO_CODE_GENERATE, API_IMAGE_TO_CODE_READ
from inspiration_one_backend.infrastructure.db.models import AuthUser
from inspiration_one_backend.infrastructure.storage import LocalStorage
from inspiration_one_backend.presentation.deps import get_session, require_api_permission
from inspiration_one_backend.presentation.schemas.image_to_code import (
    CreateImageToCodeJobRequest,
    ImageToCodeJobListResponse,
    ImageToCodeJobResponse,
    serialize_image_to_code_job,
)

router = APIRouter(prefix="/api/image-to-code-jobs", tags=["image_to_code"])

_HTML_PREVIEW_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'none'; "
        "img-src 'self' data:; "
        "style-src 'self' 'unsafe-inline'; "
        "font-src 'self' data:; "
        "connect-src 'none'; "
        "script-src 'none'; "
        "base-uri 'none'; "
        "form-action 'none'; "
        "frame-ancestors 'self'; "
        "sandbox"
    ),
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
}


@router.post("", response_model=ImageToCodeJobResponse, status_code=status.HTTP_202_ACCEPTED)
def create_image_to_code_job_endpoint(
    payload: CreateImageToCodeJobRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_IMAGE_TO_CODE_GENERATE)),
) -> ImageToCodeJobResponse:
    job = submit_image_to_code_job(
        session,
        source_kind=payload.source_kind,
        source_ref=payload.source_ref,
        delivery_mode=payload.delivery_mode,
        params={
            "page_type": payload.page_type,
            "fidelity_mode": payload.fidelity_mode,
            "responsive_shell": payload.responsive_shell,
            "export_hd_preview": payload.export_hd_preview,
            "notes": payload.notes,
        },
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return serialize_image_to_code_job(job)


@router.get("", response_model=ImageToCodeJobListResponse)
def list_image_to_code_jobs_endpoint(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    status_filter: JobStatus | None = Query(default=None, alias="status"),
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_IMAGE_TO_CODE_READ)),
) -> ImageToCodeJobListResponse:
    jobs = list_image_to_code_jobs(
        session,
        actor_user_id=current_user.id,
        limit=limit,
        offset=offset,
        status_filter=status_filter,
    )
    total = count_image_to_code_jobs(session, actor_user_id=current_user.id, status_filter=status_filter)
    return ImageToCodeJobListResponse(
        items=[serialize_image_to_code_job(job) for job in jobs],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{job_id}", response_model=ImageToCodeJobResponse)
def get_image_to_code_job_endpoint(
    job_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_IMAGE_TO_CODE_READ)),
) -> ImageToCodeJobResponse:
    job = get_image_to_code_job(
        session,
        job_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return serialize_image_to_code_job(job)


@router.post("/{job_id}/cancel", response_model=ImageToCodeJobResponse)
def cancel_image_to_code_job_endpoint(
    job_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_IMAGE_TO_CODE_GENERATE)),
) -> ImageToCodeJobResponse:
    job = cancel_image_to_code_job(
        session,
        job_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return serialize_image_to_code_job(job)


@router.post("/{job_id}/retry", response_model=ImageToCodeJobResponse, status_code=status.HTTP_202_ACCEPTED)
def retry_image_to_code_job_endpoint(
    job_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_IMAGE_TO_CODE_GENERATE)),
) -> ImageToCodeJobResponse:
    job = retry_image_to_code_job(
        session,
        job_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return serialize_image_to_code_job(job)


@router.get("/{job_id}/preview")
def image_to_code_preview_endpoint(
    job_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_IMAGE_TO_CODE_READ)),
) -> FileResponse:
    job = get_image_to_code_job(
        session,
        job_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    storage_key = _preview_index_storage_key(job.result_manifest_json)
    if storage_key is None:
        raise HTTPException(status_code=404, detail="网页预览不存在")
    path = _resolve_storage_key(storage_key, detail="网页预览不存在")
    return FileResponse(path, media_type="text/html; charset=utf-8", headers=_HTML_PREVIEW_HEADERS)


@router.get("/{job_id}/preview/assets/{asset_path:path}")
@router.get("/{job_id}/assets/{asset_path:path}")
def image_to_code_preview_asset_endpoint(
    job_id: str,
    asset_path: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_IMAGE_TO_CODE_READ)),
) -> FileResponse:
    job = get_image_to_code_job(
        session,
        job_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    storage_key = _preview_asset_storage_key(job.result_manifest_json, asset_path)
    if storage_key is None:
        raise HTTPException(status_code=404, detail="网页预览资源不存在")
    media_type = mimetypes.guess_type(asset_path)[0] or "application/octet-stream"
    path = _resolve_storage_key(storage_key, detail="网页预览资源不存在")
    return FileResponse(path, media_type=media_type, headers={"X-Content-Type-Options": "nosniff"})


@router.get("/{job_id}/artifacts/{artifact_id}/download")
def download_image_to_code_artifact_endpoint(
    job_id: str,
    artifact_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_IMAGE_TO_CODE_READ)),
) -> FileResponse:
    job = get_image_to_code_job(
        session,
        job_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    artifact = _artifact_record(job.result_manifest_json, artifact_id)
    if artifact is None:
        raise HTTPException(status_code=404, detail="交付文件不存在")
    storage_key = artifact.get("storage_key")
    filename = artifact.get("filename")
    mime_type = artifact.get("mime_type")
    if not isinstance(storage_key, str) or not storage_key:
        raise HTTPException(status_code=404, detail="交付文件不存在")
    path = _resolve_storage_key(storage_key, detail="交付文件不存在")
    return FileResponse(
        path,
        media_type=str(mime_type or "application/octet-stream"),
        filename=str(filename or artifact_id),
        headers={"X-Content-Type-Options": "nosniff"},
    )


def _artifact_record(manifest: dict[str, Any] | None, artifact_id: str) -> dict[str, Any] | None:
    for raw_artifact in (manifest or {}).get("artifacts") or []:
        if isinstance(raw_artifact, dict) and raw_artifact.get("id") == artifact_id:
            return raw_artifact
    return None


def _preview_index_storage_key(manifest: dict[str, Any] | None) -> str | None:
    storage_key = (manifest or {}).get("preview_index_storage_key")
    return storage_key if isinstance(storage_key, str) and storage_key else None


def _preview_asset_storage_key(manifest: dict[str, Any] | None, asset_path: str) -> str | None:
    preview_assets = (manifest or {}).get("preview_asset_storage_keys")
    if not isinstance(preview_assets, dict):
        return None
    normalized = asset_path.strip().lstrip("/")
    storage_key = preview_assets.get(normalized)
    if not isinstance(storage_key, str) or not storage_key:
        storage_key = preview_assets.get(f"assets/{normalized}")
    return storage_key if isinstance(storage_key, str) and storage_key else None


def _resolve_storage_key(storage_key: str, *, detail: str) -> Any:
    try:
        return LocalStorage().resolve(storage_key)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=detail) from exc
