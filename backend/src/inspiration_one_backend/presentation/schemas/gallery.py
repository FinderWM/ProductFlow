from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from inspiration_one_backend.domain.enums import ImageSessionAssetKind
from inspiration_one_backend.infrastructure.db.models import GalleryTag, ImageGalleryEntry
from inspiration_one_backend.presentation.image_variants import build_stored_image_urls
from inspiration_one_backend.presentation.schemas.generation_resource_groups import (
    GenerationResourceGroupTagResponse,
    serialize_generation_resource_group_tag,
)
from inspiration_one_backend.presentation.schemas.image_sessions import (
    ImageSessionAssetResponse,
    image_session_base_asset_ids,
    serialize_image_session_asset,
)
from inspiration_one_backend.presentation.schemas.moderation import (
    ResourceModerationFields,
    serialize_moderation_fields,
)


class SaveGalleryEntryRequest(BaseModel):
    image_session_asset_id: str
    tag_ids: list[str] = Field(default_factory=list)


class GalleryTagResponse(BaseModel):
    id: str
    name: str
    description: str | None = None
    priority: int
    enabled: bool
    created_at: datetime
    updated_at: datetime


class GalleryTagCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    priority: int = 100
    enabled: bool = True


class GalleryTagUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    priority: int | None = None
    enabled: bool | None = None


class GalleryEntryTagsUpdateRequest(BaseModel):
    tag_ids: list[str] = Field(default_factory=list)


class GalleryEntryResponse(ResourceModerationFields):
    id: str
    owner_user_id: str
    owner_username: str | None = None
    image_session_asset_id: str | None = None
    image_session_round_id: str | None = None
    image_session_id: str | None = None
    image_session_title: str | None = None
    inspiration_id: str | None = None
    inspiration_name: str | None = None
    image: ImageSessionAssetResponse
    prompt: str | None = None
    size: str | None = None
    actual_size: str | None = None
    aspect_ratio: str | None = None
    model_name: str | None = None
    provider_name: str | None = None
    prompt_version: str | None = None
    provider_response_id: str | None = None
    image_generation_call_id: str | None = None
    generation_config_id: str | None = None
    generation_group_id: str | None = None
    resource_group_id: str | None = None
    resource_group: GenerationResourceGroupTagResponse
    candidate_index: int | None = None
    candidate_count: int | None = None
    base_asset_ids: list[str]
    base_assets: list[ImageSessionAssetResponse] = Field(default_factory=list)
    base_asset_id: str | None = None
    selected_reference_asset_ids: list[str]
    reference_images: list[dict] = Field(default_factory=list)
    provider_notes: list[str]
    tags: list[GalleryTagResponse] = Field(default_factory=list)
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


def serialize_gallery_tag(tag: GalleryTag) -> GalleryTagResponse:
    return GalleryTagResponse(
        id=tag.id,
        name=tag.name,
        description=tag.description,
        priority=tag.priority,
        enabled=tag.enabled,
        created_at=tag.created_at,
        updated_at=tag.updated_at,
    )


def _gallery_entry_tags(entry: ImageGalleryEntry) -> list[GalleryTagResponse]:
    tags = [
        link.tag
        for link in entry.tag_links
        if link.deleted_at is None
        and link.tag is not None
        and link.tag.deleted_at is None
        and link.tag.enabled
    ]
    tags.sort(key=lambda tag: (-tag.priority, tag.name.casefold(), tag.id))
    return [serialize_gallery_tag(tag) for tag in tags]


def _gallery_entry_base_assets(
    entry: ImageGalleryEntry,
    round_item,
) -> list[ImageSessionAssetResponse]:
    if round_item is None or entry.asset is None:
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


def _gallery_reference_source_ids(entry: ImageGalleryEntry, *, role: str) -> list[str]:
    snapshots = entry.reference_images_json or []
    if not isinstance(snapshots, list):
        return []
    ids: list[str] = []
    for item in snapshots:
        if not isinstance(item, dict) or item.get("role") != role:
            continue
        source_id = item.get("source_id")
        if isinstance(source_id, str) and source_id:
            ids.append(source_id)
    return ids


def _serialize_gallery_image(entry: ImageGalleryEntry) -> ImageSessionAssetResponse:
    urls = build_stored_image_urls(entry, f"/api/gallery/{entry.id}/image")
    return ImageSessionAssetResponse(
        id=entry.image_session_asset_id or entry.id,
        owner_user_id=entry.owner_user_id,
        kind=ImageSessionAssetKind.GENERATED_IMAGE,
        original_filename=entry.original_filename,
        mime_type=entry.mime_type,
        **serialize_moderation_fields(entry).model_dump(),
        **urls,
        gallery_saved=True,
        gallery_entry_id=entry.id,
        created_at=entry.created_at,
    )


def serialize_gallery_entry(entry: ImageGalleryEntry, *, view_count: int = 0) -> GalleryEntryResponse:
    round_item = entry.round
    image_session = entry.asset.session if entry.asset is not None else None
    inspiration = image_session.inspiration if image_session is not None else None
    resource_group = entry.resource_group
    resource_group_id = entry.resource_group_id
    base_asset_ids = _gallery_reference_source_ids(entry, role="base_asset")
    selected_reference_asset_ids = _gallery_reference_source_ids(entry, role="selected_reference")
    base_asset_id_set = set(base_asset_ids)
    all_reference_asset_ids = [
        *base_asset_ids,
        *(asset_id for asset_id in selected_reference_asset_ids if asset_id not in base_asset_id_set),
    ]
    return GalleryEntryResponse(
        id=entry.id,
        owner_user_id=entry.owner_user_id,
        owner_username=entry.owner.username if entry.owner else None,
        image_session_asset_id=entry.image_session_asset_id,
        image_session_round_id=entry.image_session_round_id,
        image_session_id=image_session.id if image_session else None,
        image_session_title=image_session.title if image_session else None,
        inspiration_id=image_session.inspiration_id if image_session else None,
        inspiration_name=inspiration.name if inspiration else None,
        image=_serialize_gallery_image(entry),
        prompt=entry.prompt,
        size=entry.size,
        actual_size=entry.actual_size,
        aspect_ratio=entry.aspect_ratio,
        model_name=entry.model_name,
        provider_name=entry.provider_name,
        prompt_version=entry.prompt_version,
        provider_response_id=entry.provider_response_id,
        image_generation_call_id=entry.image_generation_call_id,
        generation_config_id=entry.generation_config_id,
        generation_group_id=entry.generation_group_id,
        resource_group_id=resource_group_id,
        resource_group=serialize_generation_resource_group_tag(
            resource_group,
            resource_group_id=resource_group_id,
        ),
        candidate_index=entry.candidate_index,
        candidate_count=entry.candidate_count,
        base_asset_ids=all_reference_asset_ids or (image_session_base_asset_ids(round_item) if round_item else []),
        base_assets=_gallery_entry_base_assets(entry, round_item),
        base_asset_id=base_asset_ids[0] if base_asset_ids else (round_item.base_asset_id if round_item else None),
        selected_reference_asset_ids=selected_reference_asset_ids,
        reference_images=entry.reference_images_json or [],
        provider_notes=entry.provider_notes_json or [],
        tags=_gallery_entry_tags(entry),
        view_count=view_count,
        **serialize_moderation_fields(entry).model_dump(),
        created_at=entry.created_at,
    )
