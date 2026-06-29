from __future__ import annotations

from fastapi.testclient import TestClient
from helpers import _login

from inspiration_one_backend.domain.enums import DeckStatus, WorkflowNodeType
from inspiration_one_backend.infrastructure.db.models import (
    DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    Deck,
    DeckSlide,
    Inspiration,
    InspirationWorkflow,
    WorkflowNode,
)
from inspiration_one_backend.infrastructure.db.session import get_session_factory
from inspiration_one_backend.infrastructure.provider_config import ensure_provider_config_bootstrapped


def _seed_inspiration() -> str:
    factory = get_session_factory()
    with factory() as session:
        ensure_provider_config_bootstrapped(session)
        inspiration = Inspiration(name="测试灵感", resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID)
        session.add(inspiration)
        session.commit()
        return inspiration.id


def _seed_dag_deck() -> tuple[str, str, str, str]:
    factory = get_session_factory()
    with factory() as session:
        ensure_provider_config_bootstrapped(session)
        inspiration = Inspiration(name="DAG 演示灵感", resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID)
        session.add(inspiration)
        session.flush()

        workflow = InspirationWorkflow(inspiration_id=inspiration.id, title="DAG 画布", active=True)
        session.add(workflow)
        session.flush()

        node = WorkflowNode(
            workflow_id=workflow.id,
            node_type=WorkflowNodeType.DECK_GENERATION,
            title="演示节点",
            config_json={"style_key": "clean_business"},
        )
        session.add(node)
        session.flush()

        deck = Deck(
            inspiration_id=inspiration.id,
            workflow_node_id=node.id,
            resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            title="画布演示",
            status=DeckStatus.OUTLINE_CONFIRMED,
            source_manifest_json={"workflow_node_ids": [node.id]},
        )
        session.add(deck)
        session.flush()

        slide = DeckSlide(
            deck_id=deck.id,
            order_index=0,
            title="封面",
            points_json=["A", "B"],
            source_manifest_json={"source_item_ids": ["node:item"]},
        )
        session.add(slide)
        session.commit()
        return inspiration.id, deck.id, slide.id, node.id


def test_deck_api_create_generate_flow(configured_env, monkeypatch):
    # 让 deck 生成同步执行（生产走 Dramatiq）。
    from inspiration_one_backend.application import decks as deck_use_cases
    from inspiration_one_backend.application.deck_generation_core import execute_deck_slide_generation_task

    monkeypatch.setattr(deck_use_cases, "enqueue_deck_slide_generation_task", execute_deck_slide_generation_task)

    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)
    inspiration_id = _seed_inspiration()

    created = client.post(
        f"/api/inspirations/{inspiration_id}/decks",
        json={
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "source_input": "轻巧便携。一键萃取。续航持久。",
            "style_key": "clean_business",
        },
    )
    assert created.status_code == 201, created.text
    deck = created.json()
    assert deck["slides"], deck
    deck_id = deck["id"]

    styles = client.get("/api/deck-styles")
    assert styles.status_code == 200
    assert any(style["key"] == "clean_business" for style in styles.json())

    generated = client.post(f"/api/decks/{deck_id}/generate")
    assert generated.status_code == 200, generated.text

    detail = client.get(f"/api/decks/{deck_id}")
    assert detail.status_code == 200
    body = detail.json()
    assert body["status"] == "completed", body
    assert all(slide["slide_status"] == "completed" for slide in body["slides"]), body
    assert all(slide["image_url"] for slide in body["slides"]), body

    # 单页图片可下载
    first_slide = body["slides"][0]
    image = client.get(first_slide["image_url"])
    assert image.status_code == 200
    assert image.headers["content-type"].startswith("image/")

    # 导出 pptx 并下载
    exported = client.post(f"/api/decks/{deck_id}/export")
    assert exported.status_code == 200, exported.text
    assert exported.json()["pptx_url"]
    pptx = client.get(f"/api/decks/{deck_id}/pptx")
    assert pptx.status_code == 200
    assert pptx.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.presentationml"
    )
    assert pptx.content[:2] == b"PK"

    # 单页存资源库
    save = client.post(f"/api/deck-slides/{first_slide['id']}/resource-library")
    assert save.status_code == 204, save.text


def test_deck_api_outline_edit_and_rename(configured_env, monkeypatch):
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)
    inspiration_id = _seed_inspiration()

    created = client.post(
        f"/api/inspirations/{inspiration_id}/decks",
        json={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID, "source_input": "要点一。要点二。"},
    )
    assert created.status_code == 201, created.text
    deck_id = created.json()["id"]

    edited = client.put(
        f"/api/decks/{deck_id}/outline",
        json={"title": "改后的标题", "slides": [{"title": "新封面", "points": ["A", "B"]}]},
    )
    assert edited.status_code == 200, edited.text
    body = edited.json()
    assert body["status"] == "outline_confirmed"
    assert body["title"] == "改后的标题"
    assert len(body["slides"]) == 1

    renamed = client.patch(f"/api/decks/{deck_id}", json={"title": "最终标题"})
    assert renamed.status_code == 200
    assert renamed.json()["title"] == "最终标题"


def test_active_dag_deck_generic_mutations_are_guarded(configured_env):
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)
    inspiration_id, deck_id, slide_id, node_id = _seed_dag_deck()

    detail = client.get(f"/api/decks/{deck_id}")
    assert detail.status_code == 200, detail.text
    detail_body = detail.json()
    assert detail_body["workflow_node_id"] == node_id
    assert detail_body["workflow_node_exists"] is True
    assert detail_body["workflow_node_title"] == "演示节点"
    assert detail_body["source_manifest_json"] == {"workflow_node_ids": [node_id]}
    assert detail_body["slides"][0]["source_manifest_json"] == {"source_item_ids": ["node:item"]}

    history = client.get(f"/api/inspirations/{inspiration_id}/decks")
    assert history.status_code == 200, history.text
    assert history.json()[0]["workflow_node_id"] == node_id
    assert history.json()[0]["workflow_node_exists"] is True

    guarded_deck_update = client.patch(f"/api/decks/{deck_id}", json={"title": "绕过节点改名"})
    assert guarded_deck_update.status_code == 400
    assert guarded_deck_update.json()["detail"] == "请在画布演示节点中编辑"

    guarded_generate = client.post(f"/api/decks/{deck_id}/generate")
    assert guarded_generate.status_code == 400
    assert guarded_generate.json()["detail"] == "请在画布演示节点中编辑"

    guarded_outline = client.put(
        f"/api/decks/{deck_id}/outline",
        json={"title": "绕过节点改大纲", "slides": [{"title": "封面", "points": ["A"]}]},
    )
    assert guarded_outline.status_code == 400
    assert guarded_outline.json()["detail"] == "请在画布演示节点中编辑"

    guarded_style = client.post(f"/api/decks/{deck_id}/style", json={"style_key": "clean_business"})
    assert guarded_style.status_code == 400
    assert guarded_style.json()["detail"] == "请在画布演示节点中编辑"

    guarded_sample = client.post(f"/api/decks/{deck_id}/sample")
    assert guarded_sample.status_code == 400
    assert guarded_sample.json()["detail"] == "请在画布演示节点中编辑"

    guarded_export = client.post(f"/api/decks/{deck_id}/export")
    assert guarded_export.status_code == 400
    assert guarded_export.json()["detail"] == "请在画布演示节点中编辑"

    guarded_reorder = client.put(f"/api/decks/{deck_id}/slide-order", json={"slide_ids": [slide_id]})
    assert guarded_reorder.status_code == 400
    assert guarded_reorder.json()["detail"] == "请在画布演示节点中编辑"

    guarded_style_reference = client.post(
        f"/api/decks/{deck_id}/style-reference",
        files={"image": ("style.png", b"fake-image", "image/png")},
    )
    assert guarded_style_reference.status_code == 400
    assert guarded_style_reference.json()["detail"] == "请在画布演示节点中编辑"

    guarded_slide_update = client.put(
        f"/api/deck-slides/{slide_id}",
        json={"title": "绕过节点改单页", "points": ["X"], "speaker_notes": "备注"},
    )
    assert guarded_slide_update.status_code == 400
    assert guarded_slide_update.json()["detail"] == "请在画布演示节点中编辑"

    guarded_regenerate = client.post(f"/api/deck-slides/{slide_id}/regenerate")
    assert guarded_regenerate.status_code == 400
    assert guarded_regenerate.json()["detail"] == "请在画布演示节点中编辑"

    guarded_material = client.put(
        f"/api/deck-slides/{slide_id}/material",
        json={"source_type": "resource_library", "asset_id": "asset-1"},
    )
    assert guarded_material.status_code == 400
    assert guarded_material.json()["detail"] == "请在画布演示节点中编辑"

    guarded_material_upload = client.post(
        f"/api/deck-slides/{slide_id}/material/upload",
        files={"image": ("material.png", b"fake-image", "image/png")},
    )
    assert guarded_material_upload.status_code == 400
    assert guarded_material_upload.json()["detail"] == "请在画布演示节点中编辑"

    guarded_material_enhance = client.post(f"/api/deck-slides/{slide_id}/material/enhance", json={"prompt": "增强"})
    assert guarded_material_enhance.status_code == 400
    assert guarded_material_enhance.json()["detail"] == "请在画布演示节点中编辑"

    guarded_notes = client.post(f"/api/deck-slides/{slide_id}/speaker-notes")
    assert guarded_notes.status_code == 400
    assert guarded_notes.json()["detail"] == "请在画布演示节点中编辑"

    guarded_resource_library = client.post(f"/api/deck-slides/{slide_id}/resource-library")
    assert guarded_resource_library.status_code == 400
    assert guarded_resource_library.json()["detail"] == "请在画布演示节点中编辑"

    guarded_delete = client.delete(f"/api/decks/{deck_id}")
    assert guarded_delete.status_code == 400
    assert guarded_delete.json()["detail"] == "请在画布演示节点中编辑"

    factory = get_session_factory()
    with factory() as session:
        node = session.get(WorkflowNode, node_id)
        assert node is not None
        session.delete(node)
        session.commit()

    deleted_source_detail = client.get(f"/api/decks/{deck_id}")
    assert deleted_source_detail.status_code == 200, deleted_source_detail.text
    assert deleted_source_detail.json()["workflow_node_id"] == node_id
    assert deleted_source_detail.json()["workflow_node_exists"] is False

    legacy_rename = client.patch(f"/api/decks/{deck_id}", json={"title": "历史演示"})
    assert legacy_rename.status_code == 200, legacy_rename.text
    assert legacy_rename.json()["title"] == "历史演示"
    assert legacy_rename.json()["workflow_node_id"] == node_id
    assert legacy_rename.json()["workflow_node_exists"] is False
