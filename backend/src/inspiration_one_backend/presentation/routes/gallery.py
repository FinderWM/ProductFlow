from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from inspiration_one_backend.application.auth import require_generation_resource_group_for_user
from inspiration_one_backend.application.gallery import list_gallery_entries, save_generated_asset_to_gallery
from inspiration_one_backend.domain.rbac import API_GALLERY_READ, API_GALLERY_WRITE
from inspiration_one_backend.infrastructure.db.models import AuthUser
from inspiration_one_backend.presentation.deps import get_session, require_api_permission
from inspiration_one_backend.presentation.schemas.gallery import (
    GalleryEntryListResponse,
    GalleryEntryResponse,
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
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_GALLERY_READ)),
) -> GalleryEntryListResponse:
    normalized_group_id = (resource_group_id or "").strip() or None
    if normalized_group_id is not None:
        resource_group = require_generation_resource_group_for_user(
            session,
            user_id=current_user.id,
            is_admin=current_user.is_admin,
            resource_group_id=normalized_group_id,
        )
        normalized_group_id = resource_group.id
    items = list_gallery_entries(
        session,
        resource_group_id=normalized_group_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return GalleryEntryListResponse(items=[serialize_gallery_entry(item) for item in items])


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
