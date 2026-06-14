from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from inspiration_one_backend.application.moderation import ensure_resource_usable
from inspiration_one_backend.application.resource_library import (
    ResourceLibrarySourceStatus,
    ResourceLibraryUploadImage,
    archive_resource_library_asset,
    archive_resource_library_group,
    create_resource_library_group,
    list_resource_library_assets,
    list_resource_library_groups,
    list_resource_library_source_statuses,
    load_resource_library_asset_to_image_session,
    load_resource_library_asset_to_workflow_node,
    save_resource_library_asset_from_source,
    update_resource_library_asset_groups,
    update_resource_library_group,
)
from inspiration_one_backend.application.resource_library import (
    upload_resource_library_assets as upload_resource_library_assets_use_case,
)
from inspiration_one_backend.domain.enums import ResourceLibrarySourceType
from inspiration_one_backend.infrastructure.db.models import AuthUser, ResourceLibraryAsset
from inspiration_one_backend.infrastructure.storage import ImageVariantName, LocalStorage
from inspiration_one_backend.presentation.deps import get_session, require_authenticated
from inspiration_one_backend.presentation.image_variants import build_variant_filename
from inspiration_one_backend.presentation.schemas.image_sessions import (
    ImageSessionDetailResponse,
    serialize_image_session_detail,
)
from inspiration_one_backend.presentation.schemas.inspiration_workflows import (
    InspirationWorkflowResponse,
    serialize_inspiration_workflow,
)
from inspiration_one_backend.presentation.schemas.resource_library import (
    CreateResourceLibraryGroupRequest,
    LoadResourceLibraryAssetToImageSessionRequest,
    LoadResourceLibraryAssetToWorkflowNodeRequest,
    ResourceLibraryAssetListResponse,
    ResourceLibraryAssetResponse,
    ResourceLibraryGroupListResponse,
    ResourceLibraryGroupResponse,
    ResourceLibrarySourceStatusListResponse,
    ResourceLibrarySourceStatusResponse,
    SaveResourceLibraryAssetRequest,
    UpdateResourceLibraryAssetGroupsRequest,
    UpdateResourceLibraryGroupRequest,
    serialize_resource_library_asset,
    serialize_resource_library_group,
)
from inspiration_one_backend.presentation.upload_validation import (
    read_validated_image_upload,
    validate_reference_image_count,
)

router = APIRouter(
    prefix="/api/resource-library",
    tags=["resource-library"],
)


@router.get("/groups", response_model=ResourceLibraryGroupListResponse)
def list_resource_library_groups_endpoint(
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_authenticated),
) -> ResourceLibraryGroupListResponse:
    groups = list_resource_library_groups(session, actor_user_id=current_user.id)
    return ResourceLibraryGroupListResponse(items=[serialize_resource_library_group(item) for item in groups])


@router.post("/groups", response_model=ResourceLibraryGroupResponse, status_code=status.HTTP_201_CREATED)
def create_resource_library_group_endpoint(
    payload: CreateResourceLibraryGroupRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_authenticated),
) -> ResourceLibraryGroupResponse:
    group = create_resource_library_group(
        session,
        name=payload.name,
        sort_order=payload.sort_order,
        actor_user_id=current_user.id,
    )
    return serialize_resource_library_group(group)


@router.patch("/groups/{group_id}", response_model=ResourceLibraryGroupResponse)
def update_resource_library_group_endpoint(
    group_id: str,
    payload: UpdateResourceLibraryGroupRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_authenticated),
) -> ResourceLibraryGroupResponse:
    group = update_resource_library_group(
        session,
        group_id=group_id,
        name=payload.name,
        sort_order=payload.sort_order,
        actor_user_id=current_user.id,
    )
    return serialize_resource_library_group(group)


@router.delete("/groups/{group_id}", status_code=status.HTTP_204_NO_CONTENT)
def archive_resource_library_group_endpoint(
    group_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_authenticated),
) -> None:
    archive_resource_library_group(session, group_id=group_id, actor_user_id=current_user.id)


@router.get("/assets", response_model=ResourceLibraryAssetListResponse)
def list_resource_library_assets_endpoint(
    group_id: str | None = Query(default=None, min_length=1, max_length=36),
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_authenticated),
) -> ResourceLibraryAssetListResponse:
    assets = list_resource_library_assets(session, group_id=group_id, actor_user_id=current_user.id)
    return ResourceLibraryAssetListResponse(items=[serialize_resource_library_asset(item) for item in assets])


@router.get("/source-status", response_model=ResourceLibrarySourceStatusListResponse)
def list_resource_library_source_status_endpoint(
    source_type: ResourceLibrarySourceType,
    source_ids: Annotated[list[str] | None, Query()] = None,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_authenticated),
) -> ResourceLibrarySourceStatusListResponse:
    statuses = list_resource_library_source_statuses(
        session,
        source_type=source_type,
        source_ids=source_ids or [],
        actor_user_id=current_user.id,
    )
    return ResourceLibrarySourceStatusListResponse(
        items=[_serialize_source_status(status_item) for status_item in statuses]
    )


@router.post("/assets/save", response_model=ResourceLibraryAssetResponse, status_code=status.HTTP_201_CREATED)
def save_resource_library_asset_endpoint(
    payload: SaveResourceLibraryAssetRequest,
    response: Response,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_authenticated),
) -> ResourceLibraryAssetResponse:
    result = save_resource_library_asset_from_source(
        session,
        source_type=payload.source_type,
        source_id=payload.source_id,
        group_ids=payload.group_ids,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    if not result.created:
        response.status_code = status.HTTP_200_OK
    return serialize_resource_library_asset(result.asset)


@router.post("/assets/upload", response_model=ResourceLibraryAssetListResponse, status_code=status.HTTP_201_CREATED)
async def upload_resource_library_assets_endpoint(
    images: list[UploadFile] = File(...),
    group_ids: Annotated[list[str] | None, Form()] = None,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_authenticated),
) -> ResourceLibraryAssetListResponse:
    validate_reference_image_count(len(images))
    uploads: list[ResourceLibraryUploadImage] = []
    for image in images:
        validated = await read_validated_image_upload(image, fallback_filename="resource-library-image.bin")
        uploads.append(
            ResourceLibraryUploadImage(
                filename=validated.filename,
                mime_type=validated.mime_type,
                content=validated.content,
            )
        )
    assets = upload_resource_library_assets_use_case(
        session,
        uploads=uploads,
        group_ids=group_ids or [],
        actor_user_id=current_user.id,
    )
    return ResourceLibraryAssetListResponse(items=[serialize_resource_library_asset(asset) for asset in assets])


@router.patch("/assets/{asset_id}/groups", response_model=ResourceLibraryAssetResponse)
def update_resource_library_asset_groups_endpoint(
    asset_id: str,
    payload: UpdateResourceLibraryAssetGroupsRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_authenticated),
) -> ResourceLibraryAssetResponse:
    asset = update_resource_library_asset_groups(
        session,
        asset_id=asset_id,
        group_ids=payload.group_ids,
        actor_user_id=current_user.id,
    )
    return serialize_resource_library_asset(asset)


@router.delete("/assets/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def archive_resource_library_asset_endpoint(
    asset_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_authenticated),
) -> None:
    archive_resource_library_asset(session, asset_id=asset_id, actor_user_id=current_user.id)


@router.post("/assets/{asset_id}/load-to-workflow-node", response_model=InspirationWorkflowResponse)
def load_resource_library_asset_to_workflow_node_endpoint(
    asset_id: str,
    payload: LoadResourceLibraryAssetToWorkflowNodeRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_authenticated),
) -> InspirationWorkflowResponse:
    workflow = load_resource_library_asset_to_workflow_node(
        session,
        asset_id=asset_id,
        node_id=payload.node_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return serialize_inspiration_workflow(workflow)


@router.post("/assets/{asset_id}/load-to-image-session", response_model=ImageSessionDetailResponse)
def load_resource_library_asset_to_image_session_endpoint(
    asset_id: str,
    payload: LoadResourceLibraryAssetToImageSessionRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_authenticated),
) -> ImageSessionDetailResponse:
    image_session = load_resource_library_asset_to_image_session(
        session,
        asset_id=asset_id,
        image_session_id=payload.image_session_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return serialize_image_session_detail(image_session)


@router.get("/assets/{asset_id}/download")
def download_resource_library_asset_endpoint(
    asset_id: str,
    variant: ImageVariantName = Query(default="original"),
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_authenticated),
) -> Response:
    asset = session.get(ResourceLibraryAsset, asset_id)
    if asset is None or asset.owner_user_id != current_user.id or asset.archived_at is not None:
        raise HTTPException(status_code=404, detail="资源不存在")
    ensure_resource_usable(asset)
    storage = LocalStorage()
    object_key = storage.object_key_for(asset)
    try:
        path, media_type = storage.resolve_for_variant(
            object_key,
            variant,
            fallback_media_type=asset.mime_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="资源文件不存在") from exc
    filename = build_variant_filename(asset.original_filename, variant=variant, resolved_suffix=path.suffix)
    return FileResponse(path, media_type=media_type, filename=filename)


def _serialize_source_status(status_item: ResourceLibrarySourceStatus) -> ResourceLibrarySourceStatusResponse:
    if status_item.asset is None:
        return ResourceLibrarySourceStatusResponse(
            source_id=status_item.source_id,
            saved=False,
            asset=None,
            group_ids=[],
        )
    asset = serialize_resource_library_asset(status_item.asset)
    return ResourceLibrarySourceStatusResponse(
        source_id=status_item.source_id,
        saved=True,
        asset=asset,
        group_ids=asset.group_ids,
    )
