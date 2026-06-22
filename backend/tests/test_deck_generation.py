from __future__ import annotations

from io import BytesIO

from PIL import Image

from inspiration_one_backend.application.auth import ensure_auth_bootstrapped
from inspiration_one_backend.application.deck_generation_core import (
    enhance_deck_slide_material,
    execute_deck_slide_generation_task,
)
from inspiration_one_backend.domain.enums import DeckMaterialSource, DeckSlideStatus, DeckStatus
from inspiration_one_backend.infrastructure.db.models import (
    DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    Deck,
    DeckSlide,
    Inspiration,
)
from inspiration_one_backend.infrastructure.provider_config import ensure_provider_config_bootstrapped
from inspiration_one_backend.infrastructure.storage import LocalStorage


def _bootstrap(db_session):
    ensure_auth_bootstrapped(db_session)
    ensure_provider_config_bootstrapped(db_session)
    db_session.commit()


def test_execute_deck_slide_generation_completes(db_session):
    _bootstrap(db_session)
    inspiration = Inspiration(name="测试灵感", resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID)
    db_session.add(inspiration)
    db_session.flush()
    deck = Deck(
        inspiration_id=inspiration.id,
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        title="季度汇报",
        status=DeckStatus.GENERATING,
        style_key="clean_business",
    )
    db_session.add(deck)
    db_session.flush()
    slide = DeckSlide(
        deck_id=deck.id,
        order_index=0,
        title="封面",
        points_json=["要点A", "要点B"],
        slide_status=DeckSlideStatus.QUEUED,
    )
    db_session.add(slide)
    db_session.commit()
    slide_id, deck_id = slide.id, deck.id

    execute_deck_slide_generation_task(slide_id)

    db_session.expire_all()
    refreshed = db_session.get(DeckSlide, slide_id)
    assert refreshed.slide_status == DeckSlideStatus.COMPLETED
    assert refreshed.image_storage_path
    assert refreshed.image_width and refreshed.image_height
    assert db_session.get(Deck, deck_id).status == DeckStatus.COMPLETED


def test_enhance_deck_slide_material_marks_enhanced(db_session):
    _bootstrap(db_session)
    inspiration = Inspiration(name="测试灵感2", resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID)
    db_session.add(inspiration)
    db_session.flush()
    deck = Deck(
        inspiration_id=inspiration.id,
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        title="增强测试",
    )
    db_session.add(deck)
    db_session.flush()

    storage = LocalStorage()
    buffer = BytesIO()
    Image.new("RGB", (64, 64), (200, 180, 160)).save(buffer, format="PNG")
    relative = storage.save_deck_slide_material(deck.id, 0, buffer.getvalue())
    meta = storage.metadata_for(relative).as_model_kwargs()
    slide = DeckSlide(
        deck_id=deck.id,
        order_index=0,
        title="配图页",
        slide_status=DeckSlideStatus.PENDING,
        material_source=DeckMaterialSource.UPLOAD,
        material_mime_type="image/png",
        material_storage_path=meta["storage_path"],
        material_storage_backend=meta["storage_backend"],
        material_storage_bucket=meta["storage_bucket"],
        material_storage_object_key=meta["storage_object_key"],
    )
    db_session.add(slide)
    db_session.commit()

    result = enhance_deck_slide_material(db_session, slide_id=slide.id, prompt="提升清晰度")

    assert result.material_source == DeckMaterialSource.ENHANCED
    assert result.material_storage_path
