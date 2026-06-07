from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from inspiration_one_backend.infrastructure.db.models import ImageGalleryEntry
from inspiration_one_backend.presentation.schemas.generation_resource_groups import (
    GenerationResourceGroupTagResponse,
    serialize_generation_resource_group_tag,
)
from inspiration_one_backend.presentation.schemas.image_sessions import (
    ImageSessionAssetResponse,
    extract_actual_image_size,
    extract_provider_notes,
    serialize_image_session_asset,
)
from inspiration_one_backend.presentation.schemas.moderation import (
    ResourceModerationFields,
    serialize_moderation_fields,
)


class SaveGalleryEntryRequest(BaseModel):
    image_session_asset_id: str


class GalleryEntryResponse(ResourceModerationFields):
    id: str
    owner_user_id: str
    owner_username: str | None = None
    image_session_asset_id: str
    image_session_round_id: str | None = None
    image_session_id: str
    image_session_title: str
    inspiration_id: str | None = None
    inspiration_name: str | None = None
    image: ImageSessionAssetResponse
    prompt: str | None = None
    size: str | None = None
    actual_size: str | None = None
    model_name: str | None = None
    provider_name: str | None = None
    prompt_version: str | None = None
    provider_response_id: str | None = None
    image_generation_call_id: str | None = None
    generation_group_id: str | None = None
    resource_group_id: str | None = None
    resource_group: GenerationResourceGroupTagResponse
    candidate_index: int | None = None
    candidate_count: int | None = None
    base_asset_id: str | None = None
    selected_reference_asset_ids: list[str]
    provider_notes: list[str]
    created_at: datetime


class GalleryEntryListResponse(BaseModel):
    items: list[GalleryEntryResponse]


def serialize_gallery_entry(entry: ImageGalleryEntry) -> GalleryEntryResponse:
    round_item = entry.round
    image_session = entry.asset.session
    inspiration = image_session.inspiration
    resource_group = entry.resource_group or (round_item.resource_group if round_item else None)
    resource_group_id = entry.resource_group_id or (round_item.resource_group_id if round_item else None)
    return GalleryEntryResponse(
        id=entry.id,
        owner_user_id=entry.owner_user_id,
        owner_username=entry.owner.username if entry.owner else None,
        image_session_asset_id=entry.image_session_asset_id,
        image_session_round_id=entry.image_session_round_id,
        image_session_id=image_session.id,
        image_session_title=image_session.title,
        inspiration_id=image_session.inspiration_id,
        inspiration_name=inspiration.name if inspiration else None,
        image=serialize_image_session_asset(entry.asset),
        prompt=round_item.prompt if round_item else None,
        size=round_item.size if round_item else None,
        actual_size=extract_actual_image_size(round_item.provider_output_json) if round_item else None,
        model_name=round_item.model_name if round_item else None,
        provider_name=round_item.provider_name if round_item else None,
        prompt_version=round_item.prompt_version if round_item else None,
        provider_response_id=round_item.provider_response_id if round_item else None,
        image_generation_call_id=round_item.image_generation_call_id if round_item else None,
        generation_group_id=round_item.generation_group_id if round_item else None,
        resource_group_id=resource_group_id,
        resource_group=serialize_generation_resource_group_tag(
            resource_group,
            resource_group_id=resource_group_id,
        ),
        candidate_index=round_item.candidate_index if round_item else None,
        candidate_count=round_item.candidate_count if round_item else None,
        base_asset_id=round_item.base_asset_id if round_item else None,
        selected_reference_asset_ids=round_item.selected_reference_asset_ids or [] if round_item else [],
        provider_notes=extract_provider_notes(round_item.provider_output_json) if round_item else [],
        **serialize_moderation_fields(entry).model_dump(),
        created_at=entry.created_at,
    )
