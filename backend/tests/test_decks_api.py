from __future__ import annotations

from fastapi.testclient import TestClient
from helpers import _login

from inspiration_one_backend.infrastructure.db.models import (
    DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    Inspiration,
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
