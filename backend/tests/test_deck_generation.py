from __future__ import annotations

from io import BytesIO

from PIL import Image

from inspiration_one_backend.application import deck_generation_core
from inspiration_one_backend.application.auth import ensure_auth_bootstrapped
from inspiration_one_backend.application.deck_generation_config import (
    resolve_deck_generation_config_selection_for_execution,
)
from inspiration_one_backend.application.deck_generation_core import (
    enhance_deck_slide_material,
    execute_deck_slide_generation_task,
)
from inspiration_one_backend.domain.enums import DeckMaterialSource, DeckSlideStatus, DeckStatus
from inspiration_one_backend.infrastructure.db.models import (
    DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    Deck,
    DeckSlide,
    EnhanceJob,
    GenerationConfig,
    Inspiration,
    WorkflowNode,
)
from inspiration_one_backend.infrastructure.provider_config import IMAGE_PURPOSE, ensure_provider_config_bootstrapped
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


def test_execute_deck_slide_generation_uses_node_slide_size(db_session, monkeypatch):
    _bootstrap(db_session)
    inspiration = Inspiration(name="测试节点尺寸", resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID)
    db_session.add(inspiration)
    db_session.flush()
    deck_node = WorkflowNode(
        workflow_id="workflow-size",
        node_type="deck_generation",
        title="演示节点",
        position_x=0,
        position_y=0,
        config_json={"deck_slide_size": "1280x720"},
    )
    db_session.add(deck_node)
    db_session.flush()
    deck = Deck(
        inspiration_id=inspiration.id,
        workflow_node_id=deck_node.id,
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        title="节点尺寸测试",
        status=DeckStatus.GENERATING,
        style_key="clean_business",
    )
    db_session.add(deck)
    db_session.flush()
    slide = DeckSlide(
        deck_id=deck.id,
        order_index=0,
        title="封面",
        points_json=["要点A"],
        slide_status=DeckSlideStatus.QUEUED,
    )
    db_session.add(slide)
    db_session.commit()

    recorded: dict[str, str] = {}
    original_generate = deck_generation_core.ImageChatService.generate

    def record_generate(
        self,
        prompt,
        size,
        manual_reference_images,
        history=None,
        previous_response_id=None,
        tool_options=None,
        progress_callback=None,
    ):
        recorded["size"] = size
        return original_generate(
            self,
            prompt,
            size,
            manual_reference_images,
            history,
            previous_response_id,
            tool_options,
            progress_callback,
        )

    monkeypatch.setattr(deck_generation_core.ImageChatService, "generate", record_generate)

    execute_deck_slide_generation_task(slide.id)

    assert recorded["size"] == "1280x720"


def test_execute_deck_sample_generation_does_not_leave_deck_generating(db_session):
    _bootstrap(db_session)
    inspiration = Inspiration(name="测试灵感样张", resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID)
    db_session.add(inspiration)
    db_session.flush()
    deck = Deck(
        inspiration_id=inspiration.id,
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        title="样张测试",
        status=DeckStatus.GENERATING,
        style_key="clean_business",
    )
    db_session.add(deck)
    db_session.flush()
    cover = DeckSlide(
        deck_id=deck.id,
        order_index=0,
        title="封面",
        points_json=["要点A"],
        slide_status=DeckSlideStatus.QUEUED,
    )
    body = DeckSlide(
        deck_id=deck.id,
        order_index=1,
        title="正文",
        points_json=["要点B"],
        slide_status=DeckSlideStatus.PENDING,
    )
    db_session.add_all([cover, body])
    db_session.commit()
    cover_id, deck_id = cover.id, deck.id

    execute_deck_slide_generation_task(cover_id)

    db_session.expire_all()
    refreshed_cover = db_session.get(DeckSlide, cover_id)
    assert refreshed_cover is not None
    assert refreshed_cover.slide_status == DeckSlideStatus.COMPLETED
    refreshed_deck = db_session.get(Deck, deck_id)
    assert refreshed_deck is not None
    assert refreshed_deck.status == DeckStatus.STYLE_CONFIRMED


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
    assert result.material_enhance_job_id
    job = db_session.get(EnhanceJob, result.material_enhance_job_id)
    assert job is not None
    assert job.status == "succeeded"
    assert job.result_manifest_json["final_image_ref"] == result.material_storage_path


def test_resolve_deck_image_generation_selection_from_workflow_node(db_session):
    _bootstrap(db_session)
    inspiration = Inspiration(name="测试灵感节点配置", resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID)
    db_session.add(inspiration)
    db_session.flush()
    config = GenerationConfig(
        purpose=IMAGE_PURPOSE,
        name="指定演示图片配置",
        provider_kind="mock",
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        model_settings_json={"model": "mock-image"},
        config_json={},
        enabled=True,
    )
    db_session.add(config)
    db_session.flush()
    deck_node = WorkflowNode(
        workflow_id="workflow-1",
        node_type="deck_generation",
        title="演示节点",
        position_x=0,
        position_y=0,
        config_json={
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "image_generation_config_mode": "manual",
            "image_generation_config_id": config.id,
        },
    )
    db_session.add(deck_node)
    db_session.flush()
    deck = Deck(
        inspiration_id=inspiration.id,
        workflow_node_id=deck_node.id,
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        title="图片配置测试",
        status=DeckStatus.STYLE_CONFIRMED,
        style_key="clean_business",
    )
    db_session.add(deck)
    db_session.commit()

    selection = resolve_deck_generation_config_selection_for_execution(db_session, deck=deck, purpose="image")

    assert selection.mode == "manual"
    assert selection.generation_config_id == config.id
    assert selection.resource_group_id == DEFAULT_GENERATION_RESOURCE_GROUP_ID
