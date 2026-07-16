from __future__ import annotations

from io import BytesIO
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from helpers import (
    _execute_workflow_queue_inline,
    _login,
    _make_demo_image_bytes,
    _make_demo_image_bytes_with_size,
    _read_image_size,
)
from PIL import Image

from inspiration_one_backend.infrastructure.db.models import DEFAULT_GENERATION_RESOURCE_GROUP_ID


@pytest.fixture(autouse=True)
def _execute_workflow_queue_inline_fixture(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep API workflow tests deterministic while production delivery goes through Dramatiq."""

    _execute_workflow_queue_inline(monkeypatch)


def test_inspiration_asset_variant_urls_fall_back_to_original_while_variants_are_pending(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    create_inspiration_response = client.post(
        "/api/inspirations",
        data={
            "name": "大尺寸主图样例",
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "category": "个护",
            "price": "99.00",
        },
        files={"image": ("large.png", _make_demo_image_bytes_with_size(2400, 1800), "image/png")},
    )
    assert create_inspiration_response.status_code == 201
    source_asset = next(
        asset for asset in create_inspiration_response.json()["source_assets"] if asset["kind"] == "original_image"
    )

    assert source_asset["download_url"].startswith("/api/source-assets/")
    assert source_asset["preview_url"].endswith("variant=preview")
    assert source_asset["thumbnail_url"].endswith("variant=thumbnail")

    preview = client.get(source_asset["preview_url"])
    assert preview.status_code == 200
    assert preview.headers["content-type"].startswith("image/")
    assert _read_image_size(preview.content) == (2400, 1800)
    assert preview.headers["cache-control"] == "no-store"
    assert preview.headers["x-image-variant"] == "pending"

    thumbnail = client.get(source_asset["thumbnail_url"])
    assert thumbnail.status_code == 200
    assert thumbnail.headers["content-type"].startswith("image/")
    assert _read_image_size(thumbnail.content) == (2400, 1800)
    assert thumbnail.headers["cache-control"] == "no-store"
    assert thumbnail.headers["x-image-variant"] == "pending"


def test_inspiration_create_rejects_invalid_price_and_invalid_image(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    invalid_price = client.post(
        "/api/inspirations",
        data={
            "name": "护手霜",
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "category": "个护",
            "price": "abc",
        },
        files={"image": ("cream.png", _make_demo_image_bytes(), "image/png")},
    )
    assert invalid_price.status_code == 400

    invalid_image = client.post(
        "/api/inspirations",
        data={
            "name": "护手霜",
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "category": "个护",
            "price": "59.00",
        },
        files={"image": ("cream.png", b"not an image", "image/png")},
    )
    assert invalid_image.status_code == 400


@pytest.mark.parametrize(
    ("image_format", "mime_type", "expected_suffix"),
    [("PNG", "image/png", ".png"), ("JPEG", "image/jpeg", ".jpg"), ("WEBP", "image/webp", ".webp")],
)
@pytest.mark.parametrize("filename", ["probe.html", "probe.svg", "probe.js", "probe", "probe.gif"])
def test_image_upload_filename_cannot_control_storage_or_inline_media_type(
    configured_env: Path,
    filename: str,
    image_format: str,
    mime_type: str,
    expected_suffix: str,
) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)
    image_buffer = BytesIO()
    Image.new("RGB", (32, 24), (40, 120, 220)).save(image_buffer, format=image_format)
    image_with_script_tail = image_buffer.getvalue() + b"<script>window.__storage_probe__=true</script>"

    created = client.post(
        "/api/inspirations",
        data={
            "name": f"危险后缀-{filename}",
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        },
        files={"image": (filename, image_with_script_tail, mime_type)},
    )

    assert created.status_code == 201
    source_asset = next(asset for asset in created.json()["source_assets"] if asset["kind"] == "original_image")
    assert source_asset["original_filename"] == filename
    stored_files = list(configured_env.glob("inspirations/*/source/*"))
    assert len(stored_files) == 1
    assert stored_files[0].suffix == expected_suffix
    assert stored_files[0].read_bytes().endswith(b"</script>")

    delivered = client.get(source_asset["download_url"])

    assert delivered.status_code == 200
    assert delivered.headers["content-type"].startswith(mime_type)
    assert f'filename="probe{expected_suffix}"' in delivered.headers["content-disposition"]
    assert ".html" not in delivered.headers["content-disposition"]
    assert ".svg" not in delivered.headers["content-disposition"]
    assert ".js" not in delivered.headers["content-disposition"]
    assert delivered.headers["x-content-type-options"] == "nosniff"


def test_source_asset_delivery_maps_invalid_persisted_key_to_404(configured_env: Path, db_session) -> None:
    from inspiration_one_backend.infrastructure.db.models import SourceAsset
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)
    created = client.post(
        "/api/inspirations",
        data={"name": "无效对象 key", "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID},
        files={"image": ("source.png", _make_demo_image_bytes(), "image/png")},
    )
    assert created.status_code == 201
    source_asset = next(asset for asset in created.json()["source_assets"] if asset["kind"] == "original_image")
    persisted = db_session.get(SourceAsset, source_asset["id"])
    assert persisted is not None
    persisted.storage_object_key = "../invalid.png"
    persisted.storage_path = "../invalid.png"
    db_session.commit()

    response = client.get(source_asset["download_url"])

    assert response.status_code == 404
    assert response.json()["detail"] == "源图文件不存在"


def test_source_asset_delivery_maps_storage_unavailable_to_503(
    configured_env: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from inspiration_one_backend.infrastructure.storage import StorageUnavailable
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)
    created = client.post(
        "/api/inspirations",
        data={"name": "存储不可用", "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID},
        files={"image": ("source.png", _make_demo_image_bytes(), "image/png")},
    )
    assert created.status_code == 201
    source_asset = next(asset for asset in created.json()["source_assets"] if asset["kind"] == "original_image")

    def unavailable(*_args, **_kwargs):
        raise StorageUnavailable("storage unavailable")

    monkeypatch.setattr("inspiration_one_backend.infrastructure.storage.StorageService.stat", unavailable)

    response = client.get(source_asset["download_url"])

    assert response.status_code == 503
    assert response.json()["detail"] == "存储服务暂不可用，请稍后重试"


def test_image_generation_calibrates_oversized_size(configured_env: Path) -> None:
    from inspiration_one_backend.presentation.api import create_app

    app = create_app()
    client = TestClient(app)
    _login(client)

    created = client.post("/api/image-sessions", json={"title": "尺寸校验"})
    assert created.status_code == 201
    generated = client.post(
        f"/api/image-sessions/{created.json()['id']}/generate",
        json={
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "prompt": "生成一张图",
            "size": "99999x99999",
        },
    )
    assert generated.status_code == 202
    assert generated.json()["rounds"][-1]["size"] == "2880x2880"
