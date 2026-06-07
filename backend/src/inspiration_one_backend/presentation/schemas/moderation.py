from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from inspiration_one_backend.application.moderation import (
    ResourceModerationResult,
    ResourceModerationState,
    ResourceType,
    moderation_payload,
)
from inspiration_one_backend.infrastructure.db.models import (
    CanvasTemplate,
    CanvasTemplateCategory,
    ImageGalleryEntry,
    ImageSession,
    ImageSessionAsset,
    Inspiration,
    PosterVariant,
    SourceAsset,
)


class ModerationStatusResponse(BaseModel):
    enabled: bool
    disabled_at: datetime | None = None
    disabled_by_user_id: str | None = None
    disabled_by_username: str | None = None
    disabled_reason: str | None = None
    effective_enabled: bool
    effective_disabled_resource_type: str | None = None
    effective_disabled_resource_id: str | None = None
    effective_disabled_reason: str | None = None


class ResourceModerationRequest(BaseModel):
    enabled: bool
    reason: str | None = Field(default=None, max_length=500)


class DisableResourceRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class ResourceModerationResponse(ModerationStatusResponse):
    resource_type: str
    resource_id: str
    owner_user_id: str | None = None
    owner_username: str | None = None


class ModeratedResourceResponse(BaseModel):
    enabled: bool
    disabled_at: datetime | None = None
    disabled_by_user_id: str | None = None
    disabled_by_username: str | None = None
    disabled_reason: str | None = None
    effective_enabled: bool
    effective_disabled_resource_type: str | None = None
    effective_disabled_resource_id: str | None = None
    effective_disabled_reason: str | None = None


ResourceModerationFields = ModeratedResourceResponse


def serialize_moderation_fields(resource: Any) -> ResourceModerationFields:
    return ResourceModerationFields(**moderation_payload(_resource_type_for_instance(resource), resource))


def serialize_moderation_status(state: ResourceModerationState) -> ModerationStatusResponse:
    source = state.effective_disabled_source
    return ModerationStatusResponse(
        enabled=state.enabled,
        disabled_at=state.disabled_at,
        disabled_by_user_id=state.disabled_by_user_id,
        disabled_by_username=state.disabled_by_username,
        disabled_reason=state.disabled_reason,
        effective_enabled=state.effective_enabled,
        effective_disabled_resource_type=source.resource_type if source else None,
        effective_disabled_resource_id=source.resource_id if source else None,
        effective_disabled_reason=source.reason if source else None,
    )


def serialize_resource_moderation(result: ResourceModerationResult) -> ResourceModerationResponse:
    status = serialize_moderation_status(result.state)
    return ResourceModerationResponse(
        resource_type=result.resource_type,
        resource_id=result.resource_id,
        owner_user_id=result.owner_user_id,
        owner_username=result.owner_username,
        **status.model_dump(),
    )


def _resource_type_for_instance(resource: Any) -> ResourceType:
    if isinstance(resource, Inspiration):
        return "inspiration"
    if isinstance(resource, SourceAsset):
        return "source_asset"
    if isinstance(resource, PosterVariant):
        return "poster_variant"
    if isinstance(resource, ImageSession):
        return "image_session"
    if isinstance(resource, ImageSessionAsset):
        return "image_session_asset"
    if isinstance(resource, ImageGalleryEntry):
        return "image_gallery_entry"
    if isinstance(resource, CanvasTemplate):
        return "canvas_template"
    if isinstance(resource, CanvasTemplateCategory):
        return "canvas_template_category"
    raise TypeError(f"Unsupported moderated resource: {type(resource).__name__}")
