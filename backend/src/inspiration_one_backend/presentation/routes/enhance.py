from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from inspiration_one_backend.application.enhance.execution import ENHANCE_FINAL_MAX_UPLOAD_BYTES
from inspiration_one_backend.application.enhance.jobs import (
    attach_enhance_job_to_image_session,
    cancel_enhance_job,
    count_enhance_jobs,
    get_enhance_job,
    list_enhance_jobs,
    save_enhance_job_to_library,
    submit_enhance_job,
    upload_enhance_final,
)
from inspiration_one_backend.domain.enums import JobStatus
from inspiration_one_backend.domain.rbac import API_ENHANCE_GENERATE, API_ENHANCE_READ
from inspiration_one_backend.infrastructure.db.models import AuthUser
from inspiration_one_backend.infrastructure.storage import ImageVariantName, LocalStorage
from inspiration_one_backend.presentation.deps import get_session, require_api_permission
from inspiration_one_backend.presentation.image_variants import build_variant_filename
from inspiration_one_backend.presentation.schemas.enhance import (
    CreateEnhanceJobRequest,
    EnhanceJobListResponse,
    EnhanceJobResponse,
    SaveEnhanceJobToLibraryRequest,
    serialize_enhance_job,
)
from inspiration_one_backend.presentation.schemas.image_sessions import (
    ImageSessionDetailResponse,
    serialize_image_session_detail,
)
from inspiration_one_backend.presentation.schemas.resource_library import (
    ResourceLibraryAssetResponse,
    serialize_resource_library_asset,
)

router = APIRouter(prefix="/api/enhance-jobs", tags=["enhance"])
ENHANCE_FINAL_MULTIPART_OVERHEAD_BYTES = 1024 * 1024


@router.post("", response_model=EnhanceJobResponse, status_code=status.HTTP_202_ACCEPTED)
def create_enhance_job_endpoint(
    payload: CreateEnhanceJobRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_ENHANCE_GENERATE)),
) -> EnhanceJobResponse:
    job = submit_enhance_job(
        session,
        source_kind=payload.source_kind,
        source_ref=payload.source_ref,
        strategy=payload.strategy,
        params=payload.params,
        resource_group_id=payload.resource_group_id,
        generation_config_mode=payload.generation_config_mode,
        generation_config_id=payload.generation_config_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return serialize_enhance_job(job)


@router.get("", response_model=EnhanceJobListResponse)
def list_enhance_jobs_endpoint(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    status_filter: JobStatus | None = Query(default=None, alias="status"),
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_ENHANCE_READ)),
) -> EnhanceJobListResponse:
    jobs = list_enhance_jobs(
        session,
        actor_user_id=current_user.id,
        limit=limit,
        offset=offset,
        status_filter=status_filter,
    )
    total = count_enhance_jobs(session, actor_user_id=current_user.id, status_filter=status_filter)
    return EnhanceJobListResponse(
        items=[serialize_enhance_job(job) for job in jobs],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/{job_id}", response_model=EnhanceJobResponse)
def get_enhance_job_endpoint(
    job_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_ENHANCE_READ)),
) -> EnhanceJobResponse:
    job = get_enhance_job(
        session,
        job_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return serialize_enhance_job(job)


@router.post("/{job_id}/cancel", response_model=EnhanceJobResponse)
def cancel_enhance_job_endpoint(
    job_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_ENHANCE_GENERATE)),
) -> EnhanceJobResponse:
    job = cancel_enhance_job(
        session,
        job_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return serialize_enhance_job(job)


@router.get("/{job_id}/tiles/{row}/{col}")
def download_enhance_tile_endpoint(
    job_id: str,
    row: int,
    col: int,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_ENHANCE_READ)),
) -> FileResponse:
    job = get_enhance_job(
        session,
        job_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    storage_key = _tile_storage_key(job.result_manifest_json, row=row, col=col)
    if storage_key is None:
        raise HTTPException(status_code=404, detail="增强切片不存在")
    return _file_response(storage_key, filename=f"enhance-{row}-{col}.png")


@router.get("/{job_id}/final")
def download_enhance_final_endpoint(
    job_id: str,
    variant: ImageVariantName = Query(default="original"),
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_ENHANCE_READ)),
) -> FileResponse:
    job = get_enhance_job(
        session,
        job_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    manifest = job.result_manifest_json or {}
    final_ref = manifest.get("final_image_ref")
    if not isinstance(final_ref, str) or not final_ref:
        raise HTTPException(status_code=404, detail="增强结果不存在")
    return _file_response(
        final_ref,
        filename=build_variant_filename(f"enhance-{job.id}.png", variant=variant, resolved_suffix=".png"),
        variant=variant,
        fallback_media_type=str(manifest.get("final_mime_type") or job.source_mime_type or "image/png"),
    )


@router.post("/{job_id}/final", response_model=EnhanceJobResponse)
async def upload_enhance_final_endpoint(
    job_id: str,
    request: Request,
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_ENHANCE_GENERATE)),
) -> EnhanceJobResponse:
    _ensure_final_upload_request_size(request)
    content = await file.read(ENHANCE_FINAL_MAX_UPLOAD_BYTES + 1)
    if len(content) > ENHANCE_FINAL_MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail="拼接结果文件过大")
    job = upload_enhance_final(
        session,
        job_id,
        content=content,
        mime_type=file.content_type or "image/png",
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return serialize_enhance_job(job)


@router.post("/{job_id}/save-to-library", response_model=ResourceLibraryAssetResponse)
def save_enhance_job_to_library_endpoint(
    job_id: str,
    payload: SaveEnhanceJobToLibraryRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_ENHANCE_GENERATE)),
) -> ResourceLibraryAssetResponse:
    result = save_enhance_job_to_library(
        session,
        job_id,
        group_ids=payload.group_ids,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return serialize_resource_library_asset(result.asset)


@router.post("/{job_id}/attach-to-image-session", response_model=ImageSessionDetailResponse)
def attach_enhance_job_to_image_session_endpoint(
    job_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_ENHANCE_GENERATE)),
) -> ImageSessionDetailResponse:
    image_session = attach_enhance_job_to_image_session(
        session,
        job_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return serialize_image_session_detail(image_session)


def _tile_storage_key(manifest: dict[str, Any] | None, *, row: int, col: int) -> str | None:
    for raw_tile in (manifest or {}).get("tiles") or []:
        if not isinstance(raw_tile, dict):
            continue
        if raw_tile.get("row") == row and raw_tile.get("col") == col:
            storage_key = raw_tile.get("storage_key")
            return storage_key if isinstance(storage_key, str) and storage_key else None
    return None


def _file_response(
    storage_key: str,
    *,
    filename: str,
    variant: ImageVariantName = "original",
    fallback_media_type: str = "image/png",
) -> FileResponse:
    try:
        path, media_type = LocalStorage().resolve_for_variant(
            storage_key,
            variant,
            fallback_media_type=fallback_media_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="增强文件不存在") from exc
    return FileResponse(path, media_type=media_type, filename=filename)


def _ensure_final_upload_request_size(request: Request) -> None:
    raw_content_length = request.headers.get("content-length")
    if raw_content_length is None:
        return
    try:
        content_length = int(raw_content_length)
    except ValueError:
        return
    max_request_size = ENHANCE_FINAL_MAX_UPLOAD_BYTES + ENHANCE_FINAL_MULTIPART_OVERHEAD_BYTES
    if content_length > max_request_size:
        raise HTTPException(status_code=status.HTTP_413_CONTENT_TOO_LARGE, detail="拼接结果文件过大")
