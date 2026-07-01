from __future__ import annotations

from inspiration_one_backend.domain.enums import DeckSlideStatus, DeckStatus
from inspiration_one_backend.infrastructure.db.models import Deck

ACTIVE_DECK_SLIDE_STATUSES = (DeckSlideStatus.QUEUED, DeckSlideStatus.RUNNING)


def derived_deck_status(deck: Deck) -> DeckStatus:
    if not deck.slides:
        return deck.status
    statuses = [slide.slide_status for slide in deck.slides]
    if all(status == DeckSlideStatus.COMPLETED for status in statuses):
        return DeckStatus.COMPLETED
    if any(status in ACTIVE_DECK_SLIDE_STATUSES for status in statuses):
        return DeckStatus.GENERATING
    if any(status == DeckSlideStatus.FAILED for status in statuses):
        return DeckStatus.FAILED
    if any(slide.image_storage_path for slide in deck.slides):
        return DeckStatus.STYLE_CONFIRMED
    if deck.status in (DeckStatus.DRAFT, DeckStatus.OUTLINE_CONFIRMED, DeckStatus.STYLE_CONFIRMED):
        return deck.status
    if deck.style_key or deck.style_reference_asset_id:
        return DeckStatus.STYLE_CONFIRMED
    return DeckStatus.OUTLINE_CONFIRMED
