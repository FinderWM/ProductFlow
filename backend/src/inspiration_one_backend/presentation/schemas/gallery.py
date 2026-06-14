from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from inspiration_one_backend.infrastructure.db.models import ImageGalleryEntry
from inspiration_one_backend.presentation.schemas.generation_resource_groups import (
    GenerationResourceGroupTagResponse,
    serialize_generation_resource_group_tag,
)
from inspiration_one_backend.presentation.schemas.image_sessions import (
    ImageSessionAssetResponse,
    extract_actual_image_size,
    extract_provider_notes,
    image_session_base_asset_ids,
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
    base_asset_ids: list[str]
    base_assets: list[ImageSessionAssetResponse] = Field(default_factory=list)
    base_asset_id: str | None = None
    selected_reference_asset_ids: list[str]
    provider_notes: list[str]
    view_count: int = 0
    created_at: datetime


class GalleryEntryListResponse(BaseModel):
    items: list[GalleryEntryResponse]
    total: int = 0
    has_more: bool = False
    next_offset: int | None = None


class GalleryEntryViewResponse(BaseModel):
    id: str
    view_count: int
    counted: bool


def _gallery_entry_base_assets(
    entry: ImageGalleryEntry,
    round_item,
) -> list[ImageSessionAssetResponse]:
    if round_item is None:
        return []
    base_asset_ids = image_session_base_asset_ids(round_item)
    if not base_asset_ids:
        return []
    assets_by_id = {asset.id: asset for asset in entry.asset.session.assets}
    return [
        serialize_image_session_asset(asset)
        for asset_id in base_asset_ids
        if (asset := assets_by_id.get(asset_id)) is not None
    ]


def serialize_gallery_entry(entry: ImageGalleryEntry, *, view_count: int = 0) -> GalleryEntryResponse:
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
        image=serialize_image_session_asset(entry.asset, gallery_entry_id=entry.id),
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
        base_asset_ids=image_session_base_asset_ids(round_item) if round_item else [],
        base_assets=_gallery_entry_base_assets(entry, round_item),
        base_asset_id=round_item.base_asset_id if round_item else None,
        selected_reference_asset_ids=round_item.selected_reference_asset_ids or [] if round_item else [],
        provider_notes=extract_provider_notes(round_item.provider_output_json) if round_item else [],
        view_count=view_count,
        **serialize_moderation_fields(entry).model_dump(),
        created_at=entry.created_at,
    )
