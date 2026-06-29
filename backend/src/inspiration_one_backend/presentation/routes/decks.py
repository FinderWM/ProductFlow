from __future__ import annotations

from fastapi import APIRouter, Depends, File, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from inspiration_one_backend.application import decks as deck_use_cases
from inspiration_one_backend.application.decks import (
    create_deck,
    delete_deck,
    enhance_deck_slide_material,
    export_deck_pptx,
    generate_deck,
    generate_deck_sample,
    generate_deck_slide_speaker_notes,
    get_deck_or_raise,
    get_deck_slide_or_raise,
    list_decks,
    regenerate_deck_slide,
    rename_deck,
    reorder_deck_slides,
    replace_deck_outline,
    set_deck_style,
    update_deck_slide,
)
from inspiration_one_backend.domain.errors import NotFoundError
from inspiration_one_backend.domain.rbac import API_DECK_GENERATE, API_DECK_READ, API_DECK_WRITE
from inspiration_one_backend.infrastructure.db.models import AuthUser
from inspiration_one_backend.infrastructure.deck.styles import list_deck_styles
from inspiration_one_backend.infrastructure.storage import LocalStorage
from inspiration_one_backend.presentation.deps import get_session, require_api_permission
from inspiration_one_backend.presentation.schemas.decks import (
    CreateDeckRequest,
    DeckResponse,
    DeckSlideResponse,
    DeckStyleOption,
    DeckSummaryResponse,
    EnhanceDeckSlideMaterialRequest,
    RenameDeckRequest,
    ReorderDeckSlidesRequest,
    ReplaceOutlineRequest,
    SetDeckSlideMaterialRequest,
    SetDeckStyleRequest,
    UpdateDeckSlideRequest,
    serialize_deck,
    serialize_deck_slide,
    serialize_deck_summary,
)

router = APIRouter(prefix="/api", tags=["decks"])


def _ensure_generic_deck_mutable(session: Session, deck_id: str) -> None:
    deck_use_cases.ensure_deck_mutable_from_generic_endpoint(session, get_deck_or_raise(session, deck_id))


def _ensure_generic_deck_slide_mutable(session: Session, slide_id: str) -> None:
    deck_use_cases.ensure_deck_slide_mutable_from_generic_endpoint(session, get_deck_slide_or_raise(session, slide_id))


@router.get("/deck-styles", response_model=list[DeckStyleOption])
async def list_deck_styles_endpoint(
    _current_user: AuthUser = Depends(require_api_permission(API_DECK_READ)),
) -> list[DeckStyleOption]:
    return [DeckStyleOption(**style) for style in list_deck_styles()]


@router.post(
    "/inspirations/{inspiration_id}/decks",
    response_model=DeckResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_deck_endpoint(
    inspiration_id: str,
    payload: CreateDeckRequest,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_DECK_GENERATE)),
) -> DeckResponse:
    deck = create_deck(
        session,
        inspiration_id=inspiration_id,
        resource_group_id=payload.resource_group_id,
        actor_user_id=current_user.id,
        actor_is_admin=current_user.is_admin,
        source_input=payload.source_input,
        title=payload.title,
        max_slides=payload.max_slides,
        style_key=payload.style_key,
    )
    return serialize_deck(deck, session=session)


@router.get("/inspirations/{inspiration_id}/decks", response_model=list[DeckSummaryResponse])
async def list_decks_endpoint(
    inspiration_id: str,
    session: Session = Depends(get_session),
    _current_user: AuthUser = Depends(require_api_permission(API_DECK_READ)),
) -> list[DeckSummaryResponse]:
    return [serialize_deck_summary(deck, session=session) for deck in list_decks(session, inspiration_id)]


@router.get("/decks/{deck_id}", response_model=DeckResponse)
async def get_deck_endpoint(
    deck_id: str,
    session: Session = Depends(get_session),
    _current_user: AuthUser = Depends(require_api_permission(API_DECK_READ)),
) -> DeckResponse:
    return serialize_deck(get_deck_or_raise(session, deck_id), session=session)


@router.patch("/decks/{deck_id}", response_model=DeckResponse)
async def rename_deck_endpoint(
    deck_id: str,
    payload: RenameDeckRequest,
    session: Session = Depends(get_session),
    _current_user: AuthUser = Depends(require_api_permission(API_DECK_WRITE)),
) -> DeckResponse:
    _ensure_generic_deck_mutable(session, deck_id)
    deck = rename_deck(session, deck_id, title=payload.title, speaker_notes_enabled=payload.speaker_notes_enabled)
    return serialize_deck(deck, session=session)


@router.delete("/decks/{deck_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_deck_endpoint(
    deck_id: str,
    session: Session = Depends(get_session),
    _current_user: AuthUser = Depends(require_api_permission(API_DECK_WRITE)),
) -> None:
    _ensure_generic_deck_mutable(session, deck_id)
    delete_deck(session, deck_id)


@router.put("/decks/{deck_id}/outline", response_model=DeckResponse)
async def replace_deck_outline_endpoint(
    deck_id: str,
    payload: ReplaceOutlineRequest,
    session: Session = Depends(get_session),
    _current_user: AuthUser = Depends(require_api_permission(API_DECK_WRITE)),
) -> DeckResponse:
    _ensure_generic_deck_mutable(session, deck_id)
    deck = replace_deck_outline(
        session,
        deck_id,
        title=payload.title,
        slides=[slide.model_dump() for slide in payload.slides],
    )
    return serialize_deck(deck, session=session)


@router.post("/decks/{deck_id}/style", response_model=DeckResponse)
async def set_deck_style_endpoint(
    deck_id: str,
    payload: SetDeckStyleRequest,
    session: Session = Depends(get_session),
    _current_user: AuthUser = Depends(require_api_permission(API_DECK_WRITE)),
) -> DeckResponse:
    _ensure_generic_deck_mutable(session, deck_id)
    deck = set_deck_style(
        session,
        deck_id,
        style_key=payload.style_key,
        style_reference_asset_id=payload.style_reference_asset_id,
    )
    return serialize_deck(deck, session=session)


@router.post("/decks/{deck_id}/sample", response_model=DeckResponse)
async def generate_deck_sample_endpoint(
    deck_id: str,
    session: Session = Depends(get_session),
    _current_user: AuthUser = Depends(require_api_permission(API_DECK_GENERATE)),
) -> DeckResponse:
    _ensure_generic_deck_mutable(session, deck_id)
    generate_deck_sample(session, deck_id)
    return serialize_deck(get_deck_or_raise(session, deck_id), session=session)


@router.post("/decks/{deck_id}/generate", response_model=DeckResponse)
async def generate_deck_endpoint(
    deck_id: str,
    session: Session = Depends(get_session),
    _current_user: AuthUser = Depends(require_api_permission(API_DECK_GENERATE)),
) -> DeckResponse:
    _ensure_generic_deck_mutable(session, deck_id)
    deck = generate_deck(session, deck_id)
    return serialize_deck(deck, session=session)


@router.put("/deck-slides/{slide_id}", response_model=DeckSlideResponse)
async def update_deck_slide_endpoint(
    slide_id: str,
    payload: UpdateDeckSlideRequest,
    session: Session = Depends(get_session),
    _current_user: AuthUser = Depends(require_api_permission(API_DECK_WRITE)),
) -> DeckSlideResponse:
    _ensure_generic_deck_slide_mutable(session, slide_id)
    slide = update_deck_slide(
        session,
        slide_id,
        title=payload.title,
        points=payload.points,
        speaker_notes=payload.speaker_notes,
    )
    return serialize_deck_slide(slide)


@router.post("/deck-slides/{slide_id}/regenerate", response_model=DeckSlideResponse)
async def regenerate_deck_slide_endpoint(
    slide_id: str,
    session: Session = Depends(get_session),
    _current_user: AuthUser = Depends(require_api_permission(API_DECK_GENERATE)),
) -> DeckSlideResponse:
    _ensure_generic_deck_slide_mutable(session, slide_id)
    return serialize_deck_slide(regenerate_deck_slide(session, slide_id))


@router.put("/deck-slides/{slide_id}/material", response_model=DeckSlideResponse)
async def set_deck_slide_material_endpoint(
    slide_id: str,
    payload: SetDeckSlideMaterialRequest,
    session: Session = Depends(get_session),
    _current_user: AuthUser = Depends(require_api_permission(API_DECK_WRITE)),
) -> DeckSlideResponse:
    _ensure_generic_deck_slide_mutable(session, slide_id)
    slide = deck_use_cases.set_deck_slide_material_from_source(
        session, slide_id, source_type=payload.source_type, asset_id=payload.asset_id
    )
    return serialize_deck_slide(slide)


@router.post("/deck-slides/{slide_id}/material/upload", response_model=DeckSlideResponse)
async def upload_deck_slide_material_endpoint(
    slide_id: str,
    image: UploadFile = File(...),
    session: Session = Depends(get_session),
    _current_user: AuthUser = Depends(require_api_permission(API_DECK_WRITE)),
) -> DeckSlideResponse:
    _ensure_generic_deck_slide_mutable(session, slide_id)
    content = await image.read()
    slide = deck_use_cases.set_deck_slide_material_from_upload(
        session,
        slide_id,
        filename=image.filename or "material.png",
        content=content,
        mime_type=image.content_type,
    )
    return serialize_deck_slide(slide)


@router.post("/deck-slides/{slide_id}/material/enhance", response_model=DeckSlideResponse)
async def enhance_deck_slide_material_endpoint(
    slide_id: str,
    payload: EnhanceDeckSlideMaterialRequest,
    session: Session = Depends(get_session),
    _current_user: AuthUser = Depends(require_api_permission(API_DECK_GENERATE)),
) -> DeckSlideResponse:
    _ensure_generic_deck_slide_mutable(session, slide_id)
    slide = enhance_deck_slide_material(session, slide_id=slide_id, prompt=payload.prompt)
    return serialize_deck_slide(slide)


@router.post("/deck-slides/{slide_id}/speaker-notes", response_model=DeckSlideResponse)
async def generate_deck_slide_speaker_notes_endpoint(
    slide_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_DECK_GENERATE)),
) -> DeckSlideResponse:
    _ensure_generic_deck_slide_mutable(session, slide_id)
    slide = generate_deck_slide_speaker_notes(session, slide_id, actor_user_id=current_user.id)
    return serialize_deck_slide(slide)


@router.get("/deck-slides/{slide_id}/image")
async def download_deck_slide_image_endpoint(
    slide_id: str,
    session: Session = Depends(get_session),
    _current_user: AuthUser = Depends(require_api_permission(API_DECK_READ)),
) -> FileResponse:
    slide = get_deck_slide_or_raise(session, slide_id)
    if not slide.image_storage_path:
        raise NotFoundError("幻灯片尚未生成图片")
    path = LocalStorage().resolve(slide.image_storage_path)
    return FileResponse(path, media_type=slide.image_mime_type or "image/png")


@router.get("/deck-slides/{slide_id}/material")
async def download_deck_slide_material_endpoint(
    slide_id: str,
    session: Session = Depends(get_session),
    _current_user: AuthUser = Depends(require_api_permission(API_DECK_READ)),
) -> FileResponse:
    slide = get_deck_slide_or_raise(session, slide_id)
    if not slide.material_storage_path:
        raise NotFoundError("幻灯片没有配图")
    path = LocalStorage().resolve(slide.material_storage_path)
    return FileResponse(path, media_type=slide.material_mime_type or "image/png")


@router.post("/decks/{deck_id}/export", response_model=DeckResponse)
async def export_deck_endpoint(
    deck_id: str,
    session: Session = Depends(get_session),
    _current_user: AuthUser = Depends(require_api_permission(API_DECK_WRITE)),
) -> DeckResponse:
    _ensure_generic_deck_mutable(session, deck_id)
    return serialize_deck(export_deck_pptx(session, deck_id), session=session)


@router.get("/decks/{deck_id}/pptx")
async def download_deck_pptx_endpoint(
    deck_id: str,
    session: Session = Depends(get_session),
    _current_user: AuthUser = Depends(require_api_permission(API_DECK_READ)),
) -> FileResponse:
    deck = get_deck_or_raise(session, deck_id)
    if not deck.pptx_storage_path:
        raise NotFoundError("演示文稿尚未导出")
    path = LocalStorage().resolve(deck.pptx_storage_path)
    return FileResponse(
        path,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        filename=f"{deck.title}.pptx",
    )


@router.post("/deck-slides/{slide_id}/resource-library", status_code=status.HTTP_204_NO_CONTENT)
async def save_deck_slide_to_resource_library_endpoint(
    slide_id: str,
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(require_api_permission(API_DECK_WRITE)),
) -> None:
    _ensure_generic_deck_slide_mutable(session, slide_id)
    deck_use_cases.save_deck_slide_to_resource_library(
        session, slide_id, actor_user_id=current_user.id, actor_is_admin=current_user.is_admin
    )


@router.put("/decks/{deck_id}/slide-order", response_model=DeckResponse)
async def reorder_deck_slides_endpoint(
    deck_id: str,
    payload: ReorderDeckSlidesRequest,
    session: Session = Depends(get_session),
    _current_user: AuthUser = Depends(require_api_permission(API_DECK_WRITE)),
) -> DeckResponse:
    _ensure_generic_deck_mutable(session, deck_id)
    return serialize_deck(reorder_deck_slides(session, deck_id, slide_ids=payload.slide_ids), session=session)


@router.post("/decks/{deck_id}/style-reference", response_model=DeckResponse)
async def upload_deck_style_reference_endpoint(
    deck_id: str,
    image: UploadFile = File(...),
    session: Session = Depends(get_session),
    _current_user: AuthUser = Depends(require_api_permission(API_DECK_WRITE)),
) -> DeckResponse:
    _ensure_generic_deck_mutable(session, deck_id)
    content = await image.read()
    deck = deck_use_cases.set_deck_style_reference_from_upload(
        session, deck_id, content=content, mime_type=image.content_type
    )
    return serialize_deck(deck, session=session)
