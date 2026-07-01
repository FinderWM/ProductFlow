from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from inspiration_one_backend.domain.enums import EnhanceSourceKind, EnhanceStrategy, JobStatus
from inspiration_one_backend.infrastructure.db.models import EnhanceJob


class CreateEnhanceJobRequest(BaseModel):
    source_kind: EnhanceSourceKind
    source_ref: str = Field(min_length=1, max_length=36)
    strategy: EnhanceStrategy
    params: dict[str, Any] = Field(default_factory=dict)
    resource_group_id: str | None = Field(default=None, min_length=1, max_length=36)
    generation_config_mode: Literal["auto", "manual"] = "auto"
    generation_config_id: str | None = Field(default=None, min_length=1, max_length=36)

    @field_validator("generation_config_id", mode="before")
    @classmethod
    def normalize_generation_config_id(cls, value: object) -> str | None:
        normalized = "" if value is None else str(value).strip()
        return normalized or None


class SaveEnhanceJobToLibraryRequest(BaseModel):
    group_ids: list[str] = Field(default_factory=list)


class EnhanceJobResponse(BaseModel):
    id: str
    owner_user_id: str
    source_kind: EnhanceSourceKind
    source_ref: str
    source_width: int
    source_height: int
    source_mime_type: str
    strategy: EnhanceStrategy
    params: dict[str, Any]
    status: JobStatus
    progress_completed: int
    progress_total: int
    result_manifest: dict[str, Any] | None = None
    last_error: str | None = None
    generation_config_mode: Literal["auto", "manual"]
    requested_generation_config_id: str | None = None
    used_generation_config_id: str | None = None
    resource_group_id: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class EnhanceJobListResponse(BaseModel):
    items: list[EnhanceJobResponse]
    total: int
    limit: int
    offset: int


def serialize_enhance_job(job: EnhanceJob) -> EnhanceJobResponse:
    return EnhanceJobResponse(
        id=job.id,
        owner_user_id=job.owner_user_id,
        source_kind=job.source_kind,
        source_ref=job.source_ref,
        source_width=job.source_width,
        source_height=job.source_height,
        source_mime_type=job.source_mime_type,
        strategy=job.strategy,
        params=dict(job.params_json or {}),
        status=job.status,
        progress_completed=job.progress_completed,
        progress_total=job.progress_total,
        result_manifest=_enhance_manifest_with_urls(job),
        last_error=job.last_error,
        generation_config_mode="manual" if job.generation_config_mode == "manual" else "auto",
        requested_generation_config_id=job.requested_generation_config_id,
        used_generation_config_id=job.used_generation_config_id,
        resource_group_id=job.resource_group_id,
        started_at=job.started_at,
        finished_at=job.finished_at,
        created_at=job.created_at,
        updated_at=job.updated_at,
    )


def _enhance_manifest_with_urls(job: EnhanceJob) -> dict[str, Any] | None:
    if not job.result_manifest_json:
        return None
    manifest = dict(job.result_manifest_json)
    tiles: list[dict[str, Any]] = []
    for raw_tile in manifest.get("tiles") or []:
        if not isinstance(raw_tile, dict):
            continue
        tile = dict(raw_tile)
        row = tile.get("row")
        col = tile.get("col")
        if isinstance(row, int) and isinstance(col, int):
            tile["download_url"] = f"/api/enhance-jobs/{job.id}/tiles/{row}/{col}"
        tiles.append(tile)
    manifest["tiles"] = tiles
    if isinstance(manifest.get("final_image_ref"), str) and manifest["final_image_ref"]:
        manifest["final_status"] = "ready"
        manifest["final_download_url"] = f"/api/enhance-jobs/{job.id}/final"
    else:
        manifest["final_status"] = "pending_upload"
        manifest["final_download_url"] = None
    return manifest
