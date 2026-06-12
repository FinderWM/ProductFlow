from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from inspiration_one_backend.application.auth import user_has_api_permission
from inspiration_one_backend.application.gallery import (
    list_gallery_entries,
    record_gallery_entry_view,
    save_generated_asset_to_gallery,
)
from inspiration_one_backend.domain.rbac import API_GALLERY_READ, API_GALLERY_WRITE, API_RESOURCES_MODERATE
from inspiration_one_backend.infrastructure.db.models import AuthUser
from inspiration_one_backend.presentation.deps import get_session, require_api_permission
from inspiration_one_backend.presentation.schemas.gallery import (
    GalleryEntryListResponse,
    GalleryEntryResponse,
    GalleryEntryViewResponse,
    SaveGalleryEntryRequest,
    serialize_gallery_entry,
)

router = APIRouter(
    prefix="/api/gallery",
    tags=["gallery"],
)


@router.get("", response_model=GalleryEntryListResponse)
def list_gallery_entries_endpoint(
    resource_group_id: str | None = Query(default=None, min_length=1, max_length=36),
    include_disabled: bool = Query(default=False),
    limit: int | None = Query(default=None, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_GALLERY_READ)),
) -> GalleryEntryListResponse:
    can_include_disabled = include_disabled and user_has_api_permission(session, current_user, API_RESOURCES_MODERATE)
    result = list_gallery_entries(
        session,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
        include_disabled=can_include_disabled,
        resource_group_id=resource_group_id,
        limit=limit,
        offset=offset,
    )
    return GalleryEntryListResponse(
        items=[
            serialize_gallery_entry(item, view_count=result.view_counts.get(item.id, 0)) for item in result.items
        ],
        total=result.total,
        has_more=result.has_more,
        next_offset=result.next_offset,
    )


@router.post("", response_model=GalleryEntryResponse, status_code=status.HTTP_201_CREATED)
def save_gallery_entry_endpoint(
    payload: SaveGalleryEntryRequest,
    response: Response,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_GALLERY_WRITE)),
) -> GalleryEntryResponse:
    result = save_generated_asset_to_gallery(
        session,
        image_session_asset_id=payload.image_session_asset_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    if not result.created:
        response.status_code = status.HTTP_200_OK
    return serialize_gallery_entry(result.entry)


@router.post("/{gallery_entry_id}/views", response_model=GalleryEntryViewResponse)
def record_gallery_entry_view_endpoint(
    gallery_entry_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_GALLERY_READ)),
) -> GalleryEntryViewResponse:
    result = record_gallery_entry_view(
        session,
        gallery_entry_id=gallery_entry_id,
        viewer_key=current_user.id,
    )
    return GalleryEntryViewResponse(
        id=result.entry_id,
        view_count=result.view_count,
        counted=result.counted,
    )
