from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator

from inspiration_one_backend.domain.enums import ImageToCodeDeliveryMode, ImageToCodeSourceKind, JobStatus
from inspiration_one_backend.infrastructure.db.models import ImageToCodeJob

_ALLOWED_PAGE_TYPES = {"landing", "marketing", "editorial"}
_ALLOWED_FIDELITY_MODES = {"balanced", "visual_first", "structure_first"}


class CreateImageToCodeJobRequest(BaseModel):
    source_kind: ImageToCodeSourceKind = ImageToCodeSourceKind.RESOURCE_LIBRARY_ASSET
    source_ref: str = Field(min_length=1, max_length=36)
    delivery_mode: ImageToCodeDeliveryMode = ImageToCodeDeliveryMode.BOTH
    page_type: str = "landing"
    fidelity_mode: str = "balanced"
    responsive_shell: bool = True
    export_hd_preview: bool = True
    notes: str | None = Field(default=None, max_length=2000)

    @field_validator("page_type", mode="before")
    @classmethod
    def normalize_page_type(cls, value: object) -> str:
        normalized = str(value or "landing").strip().lower()
        if normalized not in _ALLOWED_PAGE_TYPES:
            raise ValueError("页面类型无效")
        return normalized

    @field_validator("fidelity_mode", mode="before")
    @classmethod
    def normalize_fidelity_mode(cls, value: object) -> str:
        normalized = str(value or "balanced").strip().lower()
        if normalized not in _ALLOWED_FIDELITY_MODES:
            raise ValueError("保真模式无效")
        return normalized

    @field_validator("notes", mode="before")
    @classmethod
    def normalize_notes(cls, value: object) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text or None


class ImageToCodeJobResponse(BaseModel):
    id: str
    owner_user_id: str
    source_kind: ImageToCodeSourceKind
    source_ref: str
    source_width: int
    source_height: int
    source_mime_type: str
    delivery_mode: ImageToCodeDeliveryMode
    params: dict[str, Any]
    status: JobStatus
    progress_phase: str | None = None
    progress_completed: int
    progress_total: int
    result_manifest: dict[str, Any] | None = None
    last_error: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class ImageToCodeJobListResponse(BaseModel):
    items: list[ImageToCodeJobResponse]
    total: int
    limit: int
    offset: int


def serialize_image_to_code_job(job: ImageToCodeJob) -> ImageToCodeJobResponse:
    return ImageToCodeJobResponse(
        id=job.id,
        owner_user_id=job.owner_user_id,
        source_kind=job.source_kind,
        source_ref=job.source_ref,
        source_width=job.source_width,
        source_height=job.source_height,
        source_mime_type=job.source_mime_type,
        delivery_mode=job.delivery_mode,
        params=dict(job.job_params_json or {}),
        status=job.status,
        progress_phase=job.progress_phase,
        progress_completed=job.progress_completed,
        progress_total=job.progress_total,
        result_manifest=_public_image_to_code_manifest(job),
        last_error=job.last_error,
        started_at=job.started_at,
        finished_at=job.finished_at,
        created_at=job.created_at,
        updated_at=job.updated_at,
    )


def _public_image_to_code_manifest(job: ImageToCodeJob) -> dict[str, Any] | None:
    manifest = job.result_manifest_json
    if not isinstance(manifest, dict):
        return None
    public_manifest = dict(manifest)
    preview = dict(public_manifest.get("preview") or {})
    artifacts = []
    preview_image_url: str | None = None
    for raw_artifact in manifest.get("artifacts") or []:
        if not isinstance(raw_artifact, dict):
            continue
        artifact = dict(raw_artifact)
        artifact.pop("storage_key", None)
        artifact["download_url"] = f"/api/image-to-code-jobs/{job.id}/artifacts/{artifact['id']}/download"
        if artifact.get("id") == "preview_image":
            preview_image_url = artifact["download_url"]
        artifacts.append(artifact)
    preview["preview_image_url"] = preview_image_url
    preview["site_preview_url"] = f"/api/image-to-code-jobs/{job.id}/preview"
    preview["preview_available"] = bool(manifest.get("preview_index_storage_key"))
    public_manifest["preview"] = preview
    public_manifest["artifacts"] = artifacts
    public_manifest.pop("preview_index_storage_key", None)
    public_manifest.pop("preview_asset_storage_keys", None)
    return public_manifest
