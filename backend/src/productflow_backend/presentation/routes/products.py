from __future__ import annotations

from datetime import UTC, date, datetime, time
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from productflow_backend.application.moderation import ensure_resource_usable
from productflow_backend.application.use_cases import (
    add_reference_images,
    confirm_copy_set,
    create_product,
    delete_product,
    delete_reference_image,
    get_product_detail,
    get_product_history,
    list_products,
    update_copy_set,
)
from productflow_backend.domain.enums import ProductWorkflowState
from productflow_backend.domain.rbac import API_INSPIRATIONS_READ, API_INSPIRATIONS_WRITE
from productflow_backend.infrastructure.db.models import AuthUser, PosterVariant, SourceAsset
from productflow_backend.infrastructure.storage import ImageVariantName, LocalStorage
from productflow_backend.presentation.deps import get_session, require_api_permission, require_deletion_enabled
from productflow_backend.presentation.image_variants import build_variant_filename
from productflow_backend.presentation.schemas.products import (
    CopySetResponse,
    CopySetUpdateRequest,
    ProductDetailResponse,
    ProductHistoryResponse,
    ProductListResponse,
    serialize_copy_set,
    serialize_poster_variant,
    serialize_product_detail,
    serialize_product_summary,
)
from productflow_backend.presentation.upload_validation import (
    read_validated_image_upload,
    validate_reference_image_count,
)

router = APIRouter(
    prefix="/api",
    tags=["products"],
)


@router.post("/products", response_model=ProductDetailResponse, status_code=status.HTTP_201_CREATED)
async def create_product_endpoint(
    name: str = Form(...),
    image: UploadFile | None = File(default=None),
    reference_images: list[UploadFile] | None = File(default=None),
    category: str | None = Form(default=None),
    price: str | None = Form(default=None),
    source_note: str | None = Form(default=None),
    canvas_template_key: str | None = Form(default=None),
    initial_workflow_entry: str | None = Form(default=None),
    entry_text: str | None = Form(default=None),
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> ProductDetailResponse:
    main_image = await read_validated_image_upload(image, fallback_filename="upload.bin") if image is not None else None
    reference_payloads: list[tuple[bytes, str, str]] = []
    validate_reference_image_count(len(reference_images or []))
    for reference_image in reference_images or []:
        validated_reference = await read_validated_image_upload(reference_image, fallback_filename="reference.bin")
        reference_payloads.append(
            (
                validated_reference.content,
                validated_reference.filename,
                validated_reference.mime_type,
            )
        )
    product = create_product(
        session,
        name=name,
        category=category,
        price=price,
        source_note=source_note,
        image_bytes=main_image.content if main_image is not None else None,
        filename=main_image.filename if main_image is not None else None,
        content_type=main_image.mime_type if main_image is not None else None,
        reference_image_uploads=reference_payloads,
        canvas_template_key=canvas_template_key,
        initial_workflow_entry=initial_workflow_entry,
        entry_text=entry_text,
        owner_user_id=current_user.id,
    )
    return serialize_product_detail(product)


@router.get("/products", response_model=ProductListResponse)
def list_products_endpoint(
    status: ProductWorkflowState | None = None,
    title: str | None = Query(default=None, max_length=120),
    updated_from: date | None = Query(default=None),
    updated_to: date | None = Query(default=None),
    owner_user_id: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_READ)),
) -> ProductListResponse:
    items, total = list_products(
        session,
        status=status,
        page=page,
        page_size=page_size,
        title=title,
        updated_from=_start_of_day(updated_from),
        updated_to=_start_of_day(updated_to),
        owner_user_id=owner_user_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return ProductListResponse(
        items=[serialize_product_summary(item) for item in items],
        total=total,
        page=page,
        page_size=page_size,
    )


def _start_of_day(value: date | None) -> datetime | None:
    return datetime.combine(value, time.min, tzinfo=UTC) if value is not None else None


@router.get("/products/{product_id}", response_model=ProductDetailResponse)
def get_product_detail_endpoint(
    product_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_READ)),
) -> ProductDetailResponse:
    return serialize_product_detail(
        get_product_detail(
            session,
            product_id,
            actor_user_id=current_user.id,
            actor_is_admin=current_user.is_admin,
        )
    )


@router.delete(
    "/products/{product_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_deletion_enabled)],
)
def delete_product_endpoint(
    product_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> None:
    delete_product(
        session,
        product_id=product_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )


@router.post("/products/{product_id}/reference-images", response_model=ProductDetailResponse)
async def upload_reference_images_endpoint(
    product_id: str,
    reference_images: list[UploadFile] = File(...),
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> ProductDetailResponse:
    reference_payloads: list[tuple[bytes, str, str]] = []
    validate_reference_image_count(len(reference_images))
    for reference_image in reference_images:
        validated_reference = await read_validated_image_upload(reference_image, fallback_filename="reference.bin")
        reference_payloads.append(
            (
                validated_reference.content,
                validated_reference.filename,
                validated_reference.mime_type,
            )
        )
    product = add_reference_images(
        session,
        product_id=product_id,
        reference_image_uploads=reference_payloads,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return serialize_product_detail(product)


@router.patch("/copy-sets/{copy_set_id}", response_model=CopySetResponse)
def update_copy_set_endpoint(
    copy_set_id: str,
    payload: CopySetUpdateRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> CopySetResponse:
    copy_set = update_copy_set(
        session,
        copy_set_id=copy_set_id,
        structured_payload=payload.structured_payload,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return serialize_copy_set(copy_set)


@router.post("/copy-sets/{copy_set_id}/confirm", response_model=CopySetResponse)
def confirm_copy_set_endpoint(
    copy_set_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> CopySetResponse:
    copy_set = confirm_copy_set(
        session,
        copy_set_id=copy_set_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return serialize_copy_set(copy_set)


@router.get("/posters/{poster_id}/download")
def download_poster_endpoint(
    poster_id: str,
    variant: ImageVariantName = Query(default="original"),
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_READ)),
) -> FileResponse:
    poster = session.scalar(
        select(PosterVariant).options(selectinload(PosterVariant.product)).where(PosterVariant.id == poster_id)
    )
    if poster is None or (not current_user.is_admin and poster.product.owner_user_id != current_user.id):
        raise HTTPException(status_code=404, detail="海报不存在")
    ensure_resource_usable(poster)
    storage = LocalStorage()
    try:
        path, media_type = storage.resolve_for_variant(
            poster.storage_path,
            variant,
            fallback_media_type=poster.mime_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="海报文件不存在") from exc
    if not path.exists():
        raise HTTPException(status_code=404, detail="海报文件不存在")
    filename = build_variant_filename(
        f"{poster.kind.value}{Path(poster.storage_path).suffix or '.png'}",
        variant=variant,
        resolved_suffix=path.suffix,
    )
    return FileResponse(path, media_type=media_type, filename=filename)


@router.get("/source-assets/{asset_id}/download")
def download_source_asset_endpoint(
    asset_id: str,
    variant: ImageVariantName = Query(default="original"),
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_READ)),
) -> FileResponse:
    asset = session.scalar(
        select(SourceAsset).options(selectinload(SourceAsset.product)).where(SourceAsset.id == asset_id)
    )
    if asset is None or (not current_user.is_admin and asset.product.owner_user_id != current_user.id):
        raise HTTPException(status_code=404, detail="源图不存在")
    ensure_resource_usable(asset)
    storage = LocalStorage()
    try:
        path, media_type = storage.resolve_for_variant(
            asset.storage_path,
            variant,
            fallback_media_type=asset.mime_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="源图文件不存在") from exc
    if not path.exists():
        raise HTTPException(status_code=404, detail="源图文件不存在")
    filename = build_variant_filename(asset.original_filename, variant=variant, resolved_suffix=path.suffix)
    return FileResponse(path, media_type=media_type, filename=filename)


@router.delete("/source-assets/{asset_id}", response_model=ProductDetailResponse)
def delete_source_asset_endpoint(
    asset_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> ProductDetailResponse:
    product = delete_reference_image(
        session,
        asset_id=asset_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return serialize_product_detail(product)


@router.get("/products/{product_id}/history", response_model=ProductHistoryResponse)
def get_product_history_endpoint(
    product_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_READ)),
) -> ProductHistoryResponse:
    history = get_product_history(
        session,
        product_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return ProductHistoryResponse(
        copy_sets=[serialize_copy_set(item) for item in history["copy_sets"]],
        poster_variants=[serialize_poster_variant(item) for item in history["poster_variants"]],
    )
