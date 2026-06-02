from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from productflow_backend.application.image_sessions import (
    add_image_session_reference_images,
    attach_image_session_asset_to_product,
    cancel_image_session_generation_task,
    create_image_session,
    delete_image_session,
    delete_image_session_reference_image,
    get_image_session_detail,
    get_image_session_status,
    list_image_sessions,
    polish_image_session_prompt,
    retry_image_session_generation_task,
    submit_image_session_generation_task,
    update_image_session,
)
from productflow_backend.application.moderation import ensure_resource_usable
from productflow_backend.domain.rbac import API_IMAGE_CHAT_GENERATE, API_IMAGE_CHAT_READ, API_IMAGE_CHAT_WRITE
from productflow_backend.infrastructure.db.models import AuthUser, ImageSessionAsset
from productflow_backend.infrastructure.storage import ImageVariantName, LocalStorage
from productflow_backend.presentation.deps import get_session, require_api_permission, require_deletion_enabled
from productflow_backend.presentation.image_variants import build_variant_filename
from productflow_backend.presentation.schemas.image_sessions import (
    AttachImageSessionAssetRequest,
    CreateImageSessionRequest,
    GenerateImageSessionRoundRequest,
    ImageSessionDetailResponse,
    ImageSessionListResponse,
    ImageSessionStatusResponse,
    PolishImageSessionPromptRequest,
    PolishImageSessionPromptResponse,
    ProductWritebackResponse,
    UpdateImageSessionRequest,
    serialize_image_session_detail,
    serialize_image_session_status,
    serialize_image_session_summary,
)
from productflow_backend.presentation.upload_validation import (
    read_validated_image_upload,
    validate_reference_image_count,
)

router = APIRouter(
    prefix="/api",
    tags=["image-sessions"],
)


@router.get("/image-sessions", response_model=ImageSessionListResponse)
def list_image_sessions_endpoint(
    product_id: str | None = Query(default=None),
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_IMAGE_CHAT_READ)),
) -> ImageSessionListResponse:
    items = list_image_sessions(
        session,
        product_id=product_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return ImageSessionListResponse(items=[serialize_image_session_summary(item) for item in items])


@router.post("/image-sessions", response_model=ImageSessionDetailResponse, status_code=status.HTTP_201_CREATED)
def create_image_session_endpoint(
    payload: CreateImageSessionRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_IMAGE_CHAT_WRITE)),
) -> ImageSessionDetailResponse:
    image_session = create_image_session(
        session,
        product_id=payload.product_id,
        title=payload.title,
        owner_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return serialize_image_session_detail(image_session)


@router.get("/image-sessions/{image_session_id}", response_model=ImageSessionDetailResponse)
def get_image_session_detail_endpoint(
    image_session_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_IMAGE_CHAT_READ)),
) -> ImageSessionDetailResponse:
    image_session = get_image_session_detail(
        session,
        image_session_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return serialize_image_session_detail(image_session)


@router.get("/image-sessions/{image_session_id}/status", response_model=ImageSessionStatusResponse)
def get_image_session_status_endpoint(
    image_session_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_IMAGE_CHAT_READ)),
) -> ImageSessionStatusResponse:
    snapshot = get_image_session_status(
        session,
        image_session_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return serialize_image_session_status(snapshot)


@router.patch("/image-sessions/{image_session_id}", response_model=ImageSessionDetailResponse)
def update_image_session_endpoint(
    image_session_id: str,
    payload: UpdateImageSessionRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_IMAGE_CHAT_WRITE)),
) -> ImageSessionDetailResponse:
    image_session = update_image_session(
        session,
        image_session_id=image_session_id,
        title=payload.title,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return serialize_image_session_detail(image_session)


@router.delete(
    "/image-sessions/{image_session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_deletion_enabled)],
)
def delete_image_session_endpoint(
    image_session_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_IMAGE_CHAT_WRITE)),
) -> None:
    delete_image_session(
        session,
        image_session_id=image_session_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )


@router.post("/image-sessions/{image_session_id}/reference-images", response_model=ImageSessionDetailResponse)
async def upload_image_session_reference_images_endpoint(
    image_session_id: str,
    reference_images: list[UploadFile] = File(...),
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_IMAGE_CHAT_WRITE)),
) -> ImageSessionDetailResponse:
    payloads: list[tuple[bytes, str, str]] = []
    validate_reference_image_count(len(reference_images))
    for image in reference_images:
        validated_image = await read_validated_image_upload(image, fallback_filename="reference.bin")
        payloads.append(
            (
                validated_image.content,
                validated_image.filename,
                validated_image.mime_type,
            )
        )
    image_session = add_image_session_reference_images(
        session,
        image_session_id=image_session_id,
        reference_image_uploads=payloads,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return serialize_image_session_detail(image_session)


@router.delete(
    "/image-sessions/{image_session_id}/reference-images/{asset_id}",
    response_model=ImageSessionDetailResponse,
)
def delete_image_session_reference_image_endpoint(
    image_session_id: str,
    asset_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_IMAGE_CHAT_WRITE)),
) -> ImageSessionDetailResponse:
    image_session = delete_image_session_reference_image(
        session,
        image_session_id=image_session_id,
        asset_id=asset_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return serialize_image_session_detail(image_session)


@router.post("/image-sessions/prompt-polish", response_model=PolishImageSessionPromptResponse)
def polish_image_session_prompt_endpoint(
    payload: PolishImageSessionPromptRequest,
    current_user: AuthUser = Depends(require_api_permission(API_IMAGE_CHAT_GENERATE)),
) -> PolishImageSessionPromptResponse:
    result = polish_image_session_prompt(
        prompt=payload.prompt,
        generation_config_mode=payload.generation_config_mode,
        generation_config_id=payload.generation_config_id,
        user_id=current_user.id,
    )
    return PolishImageSessionPromptResponse(
        prompt=result.prompt,
        model_name=result.model_name,
        generation_config_id=result.generation_config_id,
    )


@router.post(
    "/image-sessions/{image_session_id}/generate",
    response_model=ImageSessionDetailResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def generate_image_session_round_endpoint(
    image_session_id: str,
    payload: GenerateImageSessionRoundRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_IMAGE_CHAT_GENERATE)),
) -> ImageSessionDetailResponse:
    image_session = submit_image_session_generation_task(
        session,
        image_session_id=image_session_id,
        prompt=payload.prompt,
        size=payload.size,
        base_asset_id=payload.base_asset_id,
        selected_reference_asset_ids=payload.selected_reference_asset_ids,
        generation_count=payload.generation_count,
        tool_options=payload.tool_options.model_dump(exclude_none=True) if payload.tool_options else None,
        generation_config_mode=payload.generation_config_mode,
        generation_config_id=payload.generation_config_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return serialize_image_session_detail(image_session)


@router.post(
    "/image-sessions/{image_session_id}/generation-tasks/{task_id}/retry",
    response_model=ImageSessionDetailResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
def retry_image_session_generation_task_endpoint(
    image_session_id: str,
    task_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_IMAGE_CHAT_GENERATE)),
) -> ImageSessionDetailResponse:
    image_session = retry_image_session_generation_task(
        session,
        image_session_id=image_session_id,
        task_id=task_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return serialize_image_session_detail(image_session)


@router.post(
    "/image-sessions/{image_session_id}/generation-tasks/{task_id}/cancel",
    response_model=ImageSessionDetailResponse,
)
def cancel_image_session_generation_task_endpoint(
    image_session_id: str,
    task_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_IMAGE_CHAT_GENERATE)),
) -> ImageSessionDetailResponse:
    image_session = cancel_image_session_generation_task(
        session,
        image_session_id=image_session_id,
        task_id=task_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return serialize_image_session_detail(image_session)


@router.post(
    "/image-sessions/{image_session_id}/assets/{asset_id}/attach-to-product",
    response_model=ProductWritebackResponse,
)
def attach_image_session_asset_to_product_endpoint(
    image_session_id: str,
    asset_id: str,
    payload: AttachImageSessionAssetRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_IMAGE_CHAT_WRITE)),
) -> ProductWritebackResponse:
    product = attach_image_session_asset_to_product(
        session,
        image_session_id=image_session_id,
        asset_id=asset_id,
        target=payload.target,
        product_id=payload.product_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    message = "已加入商品参考图" if payload.target == "reference" else "已设为商品主图"
    return ProductWritebackResponse(product_id=product.id, message=message)


@router.get("/image-session-assets/{asset_id}/download")
def download_image_session_asset_endpoint(
    asset_id: str,
    variant: ImageVariantName = Query(default="original"),
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_IMAGE_CHAT_READ)),
) -> Response:
    stmt = select(ImageSessionAsset).where(ImageSessionAsset.id == asset_id)
    if not current_user.is_admin:
        stmt = stmt.where(ImageSessionAsset.owner_user_id == current_user.id)
    asset = session.scalar(stmt)
    if asset is None:
        raise HTTPException(status_code=404, detail="会话图片不存在")
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
        raise HTTPException(status_code=404, detail="会话图片文件不存在") from exc
    filename = build_variant_filename(asset.original_filename, variant=variant, resolved_suffix=path.suffix)
    return FileResponse(path, media_type=media_type, filename=filename)
