from __future__ import annotations

from datetime import UTC, date, datetime, time
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from inspiration_one_backend.application.moderation import ensure_resource_usable
from inspiration_one_backend.application.use_cases import (
    InspirationContextDocumentInput,
    add_reference_images,
    confirm_copy_set,
    create_inspiration,
    delete_inspiration,
    delete_reference_image,
    get_inspiration_detail,
    get_inspiration_history,
    list_inspirations,
    update_copy_set,
)
from inspiration_one_backend.domain.enums import InspirationWorkflowState
from inspiration_one_backend.domain.rbac import API_INSPIRATIONS_READ, API_INSPIRATIONS_WRITE
from inspiration_one_backend.infrastructure.db.models import AuthUser, PosterVariant, SourceAsset
from inspiration_one_backend.infrastructure.storage import ImageVariantName, LocalStorage
from inspiration_one_backend.presentation.deps import get_session, require_api_permission, require_deletion_enabled
from inspiration_one_backend.presentation.image_variants import build_variant_filename
from inspiration_one_backend.presentation.schemas.inspirations import (
    CopySetResponse,
    CopySetUpdateRequest,
    InspirationDetailResponse,
    InspirationHistoryResponse,
    InspirationListResponse,
    serialize_copy_set,
    serialize_inspiration_detail,
    serialize_inspiration_summary,
    serialize_poster_variant,
)
from inspiration_one_backend.presentation.upload_validation import (
    read_validated_image_upload,
    read_validated_text_document_upload,
    validate_reference_image_count,
)

router = APIRouter(
    prefix="/api",
    tags=["inspirations"],
)


@router.post("/inspirations", response_model=InspirationDetailResponse, status_code=status.HTTP_201_CREATED)
async def create_inspiration_endpoint(
    name: str = Form(...),
    image: UploadFile | None = File(default=None),
    reference_images: list[UploadFile] | None = File(default=None),
    category: str | None = Form(default=None),
    price: str | None = Form(default=None),
    source_note: str | None = Form(default=None),
    long_text: str | None = Form(default=None),
    dynamic_fields_json: str | None = Form(default=None),
    context_document: UploadFile | None = File(default=None),
    canvas_template_key: str | None = Form(default=None),
    initial_workflow_entry: str | None = Form(default=None),
    entry_text: str | None = Form(default=None),
    resource_group_id: str = Form(..., min_length=1, max_length=36),
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> InspirationDetailResponse:
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
    context_document_payload: InspirationContextDocumentInput | None = None
    if context_document is not None:
        validated_document = await read_validated_text_document_upload(
            context_document,
            fallback_filename="context-document.txt",
        )
        context_document_payload = InspirationContextDocumentInput(
            content=validated_document.content,
            filename=validated_document.filename,
            mime_type=validated_document.mime_type,
            text=validated_document.text,
        )
    inspiration = create_inspiration(
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
        long_text=long_text,
        dynamic_fields_json=dynamic_fields_json,
        context_document_upload=context_document_payload,
        owner_user_id=current_user.id,
        resource_group_id=resource_group_id,
        actor_is_admin=current_user.is_admin,
        require_resource_group_grant=True,
    )
    return serialize_inspiration_detail(inspiration)


@router.get("/inspirations", response_model=InspirationListResponse)
def list_inspirations_endpoint(
    status: InspirationWorkflowState | None = None,
    title: str | None = Query(default=None, max_length=120),
    updated_from: date | None = Query(default=None),
    updated_to: date | None = Query(default=None),
    owner_user_id: str | None = Query(default=None),
    resource_group_id: str | None = Query(default=None, min_length=1, max_length=36),
    only_deleted: bool = Query(default=False),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_READ)),
) -> InspirationListResponse:
    items, total = list_inspirations(
        session,
        status=status,
        page=page,
        page_size=page_size,
        title=title,
        updated_from=_start_of_day(updated_from),
        updated_to=_start_of_day(updated_to),
        owner_user_id=owner_user_id,
        resource_group_id=resource_group_id,
        only_deleted=only_deleted,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
        require_resource_group_grant=True,
    )
    return InspirationListResponse(
        items=[serialize_inspiration_summary(item) for item in items],
        total=total,
        page=page,
        page_size=page_size,
    )


def _start_of_day(value: date | None) -> datetime | None:
    return datetime.combine(value, time.min, tzinfo=UTC) if value is not None else None


@router.get("/inspirations/{inspiration_id}", response_model=InspirationDetailResponse)
def get_inspiration_detail_endpoint(
    inspiration_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_READ)),
) -> InspirationDetailResponse:
    return serialize_inspiration_detail(
        get_inspiration_detail(
            session,
            inspiration_id,
            actor_user_id=current_user.id,
            actor_is_admin=current_user.is_admin,
        )
    )


@router.delete(
    "/inspirations/{inspiration_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_deletion_enabled)],
)
def delete_inspiration_endpoint(
    inspiration_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> None:
    delete_inspiration(
        session,
        inspiration_id=inspiration_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )


@router.post("/inspirations/{inspiration_id}/reference-images", response_model=InspirationDetailResponse)
async def upload_reference_images_endpoint(
    inspiration_id: str,
    reference_images: list[UploadFile] = File(...),
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> InspirationDetailResponse:
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
    inspiration = add_reference_images(
        session,
        inspiration_id=inspiration_id,
        reference_image_uploads=reference_payloads,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return serialize_inspiration_detail(inspiration)


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
) -> Response:
    poster = session.scalar(
        select(PosterVariant).options(selectinload(PosterVariant.inspiration)).where(PosterVariant.id == poster_id)
    )
    if poster is None or (not current_user.is_admin and poster.inspiration.owner_user_id != current_user.id):
        raise HTTPException(status_code=404, detail="海报不存在")
    ensure_resource_usable(poster)
    storage = LocalStorage()
    object_key = storage.object_key_for(poster)
    try:
        path, media_type = storage.resolve_for_variant(
            object_key,
            variant,
            fallback_media_type=poster.mime_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="海报文件不存在") from exc
    filename = build_variant_filename(
        f"{poster.kind.value}{Path(object_key).suffix or '.png'}",
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
) -> Response:
    asset = session.scalar(
        select(SourceAsset).options(selectinload(SourceAsset.inspiration)).where(SourceAsset.id == asset_id)
    )
    if asset is None or (not current_user.is_admin and asset.inspiration.owner_user_id != current_user.id):
        raise HTTPException(status_code=404, detail="源图不存在")
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
        raise HTTPException(status_code=404, detail="源图文件不存在") from exc
    filename = build_variant_filename(asset.original_filename, variant=variant, resolved_suffix=path.suffix)
    return FileResponse(path, media_type=media_type, filename=filename)


@router.delete("/source-assets/{asset_id}", response_model=InspirationDetailResponse)
def delete_source_asset_endpoint(
    asset_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_WRITE)),
) -> InspirationDetailResponse:
    inspiration = delete_reference_image(
        session,
        asset_id=asset_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return serialize_inspiration_detail(inspiration)


@router.get("/inspirations/{inspiration_id}/history", response_model=InspirationHistoryResponse)
def get_inspiration_history_endpoint(
    inspiration_id: str,
    resource_group_id: str | None = Query(default=None),
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_INSPIRATIONS_READ)),
) -> InspirationHistoryResponse:
    history = get_inspiration_history(
        session,
        inspiration_id,
        resource_group_id=resource_group_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
    )
    return InspirationHistoryResponse(
        copy_sets=[serialize_copy_set(item) for item in history["copy_sets"]],
        poster_variants=[serialize_poster_variant(item) for item in history["poster_variants"]],
    )
