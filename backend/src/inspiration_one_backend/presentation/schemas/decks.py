from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from inspiration_one_backend.domain.enums import DeckMaterialSource, DeckSlideStatus, DeckStatus
from inspiration_one_backend.infrastructure.db.models import Deck, DeckSlide

# --- responses -------------------------------------------------------------


class DeckSlideResponse(BaseModel):
    id: str
    order_index: int
    title: str
    points: list[str]
    speaker_notes: str | None
    slide_status: DeckSlideStatus
    last_error: str | None
    image_url: str | None
    image_width: int | None
    image_height: int | None
    material_source: DeckMaterialSource | None
    material_url: str | None
    created_at: datetime
    updated_at: datetime


class DeckResponse(BaseModel):
    id: str
    inspiration_id: str
    resource_group_id: str
    title: str
    status: DeckStatus
    source_input: str | None
    style_key: str | None
    style_reference_asset_id: str | None
    speaker_notes_enabled: bool
    pptx_url: str | None
    slides: list[DeckSlideResponse]
    created_at: datetime
    updated_at: datetime


class DeckSummaryResponse(BaseModel):
    id: str
    inspiration_id: str
    title: str
    status: DeckStatus
    slide_count: int
    created_at: datetime
    updated_at: datetime


class DeckStyleOption(BaseModel):
    key: str
    label: str


# --- requests --------------------------------------------------------------


class CreateDeckRequest(BaseModel):
    resource_group_id: str
    source_input: str | None = None
    title: str | None = None
    max_slides: int | None = None
    style_key: str | None = None


class OutlineSlideInput(BaseModel):
    title: str
    points: list[str] = Field(default_factory=list)


class ReplaceOutlineRequest(BaseModel):
    title: str | None = None
    slides: list[OutlineSlideInput] = Field(min_length=1)


class SetDeckStyleRequest(BaseModel):
    style_key: str | None = None
    style_reference_asset_id: str | None = None


class RenameDeckRequest(BaseModel):
    title: str | None = None
    speaker_notes_enabled: bool | None = None


class UpdateDeckSlideRequest(BaseModel):
    title: str | None = None
    points: list[str] | None = None
    speaker_notes: str | None = None


class SetDeckSlideMaterialRequest(BaseModel):
    source_type: str
    asset_id: str


class ReorderDeckSlidesRequest(BaseModel):
    slide_ids: list[str] = Field(min_length=1)


class EnhanceDeckSlideMaterialRequest(BaseModel):
    prompt: str | None = None


# --- serializers -----------------------------------------------------------


def serialize_deck_slide(slide: DeckSlide) -> DeckSlideResponse:
    return DeckSlideResponse(
        id=slide.id,
        order_index=slide.order_index,
        title=slide.title,
        points=list(slide.points_json or []),
        speaker_notes=slide.speaker_notes,
        slide_status=slide.slide_status,
        last_error=slide.last_error,
        image_url=f"/api/deck-slides/{slide.id}/image" if slide.image_storage_path else None,
        image_width=slide.image_width,
        image_height=slide.image_height,
        material_source=slide.material_source,
        material_url=f"/api/deck-slides/{slide.id}/material" if slide.material_storage_path else None,
        created_at=slide.created_at,
        updated_at=slide.updated_at,
    )


def serialize_deck(deck: Deck) -> DeckResponse:
    return DeckResponse(
        id=deck.id,
        inspiration_id=deck.inspiration_id,
        resource_group_id=deck.resource_group_id,
        title=deck.title,
        status=deck.status,
        source_input=deck.source_input,
        style_key=deck.style_key,
        style_reference_asset_id=deck.style_reference_asset_id,
        speaker_notes_enabled=deck.speaker_notes_enabled,
        pptx_url=f"/api/decks/{deck.id}/pptx" if deck.pptx_storage_path else None,
        slides=[serialize_deck_slide(slide) for slide in deck.slides],
        created_at=deck.created_at,
        updated_at=deck.updated_at,
    )


def serialize_deck_summary(deck: Deck) -> DeckSummaryResponse:
    return DeckSummaryResponse(
        id=deck.id,
        inspiration_id=deck.inspiration_id,
        title=deck.title,
        status=deck.status,
        slide_count=len(deck.slides),
        created_at=deck.created_at,
        updated_at=deck.updated_at,
    )
