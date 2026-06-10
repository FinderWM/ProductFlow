from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from inspiration_one_backend.domain.enums import ResourceLibraryAssetKind, ResourceLibrarySourceType
from inspiration_one_backend.infrastructure.db.models import (
    ResourceLibraryAsset,
    ResourceLibraryAssetGroup,
    ResourceLibraryGroup,
)
from inspiration_one_backend.presentation.image_variants import build_stored_image_urls
from inspiration_one_backend.presentation.schemas.moderation import (
    ResourceModerationFields,
    serialize_moderation_fields,
)


class ResourceLibraryGroupResponse(BaseModel):
    id: str
    owner_user_id: str
    name: str
    sort_order: int
    created_at: datetime
    updated_at: datetime


class ResourceLibraryGroupListResponse(BaseModel):
    items: list[ResourceLibraryGroupResponse]


class CreateResourceLibraryGroupRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    sort_order: int = 0


class UpdateResourceLibraryGroupRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    sort_order: int | None = None


class ResourceLibraryAssetGroupResponse(BaseModel):
    id: str
    name: str
    sort_order: int


class ResourceLibraryAssetResponse(ResourceModerationFields):
    id: str
    owner_user_id: str
    kind: ResourceLibraryAssetKind
    original_filename: str
    mime_type: str
    source_type: ResourceLibrarySourceType
    source_resource_id: str | None = None
    groups: list[ResourceLibraryAssetGroupResponse]
    group_ids: list[str]
    download_url: str
    preview_url: str
    thumbnail_url: str
    archived_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class ResourceLibraryAssetListResponse(BaseModel):
    items: list[ResourceLibraryAssetResponse]


class ResourceLibrarySourceStatusResponse(BaseModel):
    source_id: str
    saved: bool
    asset: ResourceLibraryAssetResponse | None = None
    group_ids: list[str]


class ResourceLibrarySourceStatusListResponse(BaseModel):
    items: list[ResourceLibrarySourceStatusResponse]


class SaveResourceLibraryAssetRequest(BaseModel):
    source_type: ResourceLibrarySourceType
    source_id: str = Field(min_length=1, max_length=36)
    group_ids: list[str] = Field(default_factory=list)


class UpdateResourceLibraryAssetGroupsRequest(BaseModel):
    group_ids: list[str] = Field(min_length=1)


class LoadResourceLibraryAssetToWorkflowNodeRequest(BaseModel):
    node_id: str = Field(min_length=1, max_length=36)


class LoadResourceLibraryAssetToImageSessionRequest(BaseModel):
    image_session_id: str = Field(min_length=1, max_length=36)


def serialize_resource_library_group(group: ResourceLibraryGroup) -> ResourceLibraryGroupResponse:
    return ResourceLibraryGroupResponse(
        id=group.id,
        owner_user_id=group.owner_user_id,
        name=group.name,
        sort_order=group.sort_order,
        created_at=group.created_at,
        updated_at=group.updated_at,
    )


def serialize_resource_library_asset(asset: ResourceLibraryAsset) -> ResourceLibraryAssetResponse:
    urls = build_stored_image_urls(asset, f"/api/resource-library/assets/{asset.id}/download")
    groups = sorted(
        [
            link.group
            for link in asset.group_links
            if isinstance(link, ResourceLibraryAssetGroup)
            and link.group is not None
            and link.group.archived_at is None
        ],
        key=lambda item: (item.sort_order, item.created_at, item.id),
    )
    group_responses = [
        ResourceLibraryAssetGroupResponse(id=group.id, name=group.name, sort_order=group.sort_order)
        for group in groups
    ]
    return ResourceLibraryAssetResponse(
        id=asset.id,
        owner_user_id=asset.owner_user_id,
        kind=asset.kind,
        original_filename=asset.original_filename,
        mime_type=asset.mime_type,
        source_type=asset.source_type,
        source_resource_id=asset.source_resource_id,
        groups=group_responses,
        group_ids=[group.id for group in groups],
        **serialize_moderation_fields(asset).model_dump(),
        **urls,
        archived_at=asset.archived_at,
        created_at=asset.created_at,
        updated_at=asset.updated_at,
    )
