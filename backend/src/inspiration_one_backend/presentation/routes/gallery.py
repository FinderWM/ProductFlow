from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from inspiration_one_backend.application.auth import user_has_api_permission
from inspiration_one_backend.application.gallery import (
    create_gallery_tag,
    delete_gallery_tag,
    list_gallery_entries,
    list_gallery_tags,
    record_gallery_entry_view,
    replace_gallery_entry_tags,
    save_generated_asset_to_gallery,
    update_gallery_tag,
)
from inspiration_one_backend.domain.rbac import (
    API_GALLERY_READ,
    API_GALLERY_TAGS_MANAGE,
    API_GALLERY_WRITE,
    API_RESOURCES_MODERATE,
)
from inspiration_one_backend.infrastructure.db.models import AuthUser
from inspiration_one_backend.presentation.deps import get_session, require_admin, require_api_permission
from inspiration_one_backend.presentation.schemas.gallery import (
    GalleryEntryListResponse,
    GalleryEntryResponse,
    GalleryEntryTagsUpdateRequest,
    GalleryEntryViewResponse,
    GalleryTagCreateRequest,
    GalleryTagResponse,
    GalleryTagUpdateRequest,
    SaveGalleryEntryRequest,
    serialize_gallery_entry,
    serialize_gallery_tag,
)

router = APIRouter(
    prefix="/api/gallery",
    tags=["gallery"],
)


def _parse_tag_ids(values: list[str] | None) -> list[str]:
    tag_ids: list[str] = []
    seen: set[str] = set()
    for raw_value in values or []:
        for part in str(raw_value or "").split(","):
            normalized = part.strip()
            if normalized and normalized not in seen:
                seen.add(normalized)
                tag_ids.append(normalized)
    return tag_ids


@router.get("", response_model=GalleryEntryListResponse)
def list_gallery_entries_endpoint(
    resource_group_id: str | None = Query(default=None, min_length=1, max_length=36),
    tag_ids: list[str] | None = Query(default=None),
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
        tag_ids=_parse_tag_ids(tag_ids),
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
        tag_ids=payload.tag_ids,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    if not result.created:
        response.status_code = status.HTTP_200_OK
    return serialize_gallery_entry(result.entry)


@router.get("/tags", response_model=list[GalleryTagResponse])
def list_gallery_tags_endpoint(
    include_disabled: bool = Query(default=False),
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_GALLERY_READ)),
) -> list[GalleryTagResponse]:
    if include_disabled and (
        not current_user.is_admin or not user_has_api_permission(session, current_user, API_GALLERY_TAGS_MANAGE)
    ):
        return [serialize_gallery_tag(tag) for tag in list_gallery_tags(session, include_disabled=False)]
    return [serialize_gallery_tag(tag) for tag in list_gallery_tags(session, include_disabled=include_disabled)]


@router.post("/tags", response_model=GalleryTagResponse, status_code=status.HTTP_201_CREATED)
def create_gallery_tag_endpoint(
    payload: GalleryTagCreateRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_GALLERY_TAGS_MANAGE)),
    admin_user: AuthUser = Depends(require_admin),
) -> GalleryTagResponse:
    tag = create_gallery_tag(
        session,
        name=payload.name,
        description=payload.description,
        priority=payload.priority,
        enabled=payload.enabled,
    )
    return serialize_gallery_tag(tag)


@router.patch("/tags/{tag_id}", response_model=GalleryTagResponse)
def update_gallery_tag_endpoint(
    tag_id: str,
    payload: GalleryTagUpdateRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_GALLERY_TAGS_MANAGE)),
    admin_user: AuthUser = Depends(require_admin),
) -> GalleryTagResponse:
    values = payload.model_dump(exclude_unset=True)
    tag = update_gallery_tag(session, tag_id=tag_id, values=values)
    return serialize_gallery_tag(tag)


@router.delete("/tags/{tag_id}", response_model=GalleryTagResponse)
def delete_gallery_tag_endpoint(
    tag_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_GALLERY_TAGS_MANAGE)),
    admin_user: AuthUser = Depends(require_admin),
) -> GalleryTagResponse:
    tag = delete_gallery_tag(session, tag_id=tag_id)
    return serialize_gallery_tag(tag)


@router.patch("/{gallery_entry_id}/tags", response_model=GalleryEntryResponse)
def replace_gallery_entry_tags_endpoint(
    gallery_entry_id: str,
    payload: GalleryEntryTagsUpdateRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_GALLERY_TAGS_MANAGE)),
    admin_user: AuthUser = Depends(require_admin),
) -> GalleryEntryResponse:
    entry = replace_gallery_entry_tags(session, gallery_entry_id=gallery_entry_id, tag_ids=payload.tag_ids)
    return serialize_gallery_entry(entry)


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
