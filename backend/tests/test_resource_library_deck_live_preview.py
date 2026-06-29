from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient
from helpers import _login, _make_demo_image_bytes

from inspiration_one_backend.domain.enums import WorkflowNodeType
from inspiration_one_backend.infrastructure.db.models import DEFAULT_GENERATION_RESOURCE_GROUP_ID, WorkflowNode
from inspiration_one_backend.infrastructure.db.session import get_session_factory
from inspiration_one_backend.presentation.api import create_app


def _create_inspiration_with_reference(client: TestClient, name: str) -> tuple[str, str, str]:
    created = client.post(
        "/api/inspirations",
        data={"name": name, "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID},
        files={"image": ("source.png", _make_demo_image_bytes(), "image/png")},
    )
    assert created.status_code == 201
    inspiration_id = created.json()["id"]

    workflow = client.get(f"/api/inspirations/{inspiration_id}/workflow")
    assert workflow.status_code == 200
    reference_node = next(node for node in workflow.json()["nodes"] if node["node_type"] == "reference_image")

    uploaded = client.post(
        f"/api/workflow-nodes/{reference_node['id']}/image",
        data={"role": "style", "label": "资源库参考图"},
        files={"image": ("reference.png", _make_demo_image_bytes(), "image/png")},
    )
    assert uploaded.status_code == 200
    filled_node = next(node for node in uploaded.json()["nodes"] if node["id"] == reference_node["id"])
    return inspiration_id, reference_node["id"], filled_node["output_json"]["source_asset_ids"][0]


def test_resource_library_load_to_workflow_node_returns_live_deck_preview_without_persisting_snapshot(
    configured_env: Path,
) -> None:
    app = create_app()
    client = TestClient(app)
    _login(client)

    inspiration_id, reference_node_id, source_asset_id = _create_inspiration_with_reference(client, "资源库演示预览")

    created_deck_node = client.post(
        f"/api/inspirations/{inspiration_id}/workflow/nodes",
        json={
            "node_type": "deck_generation",
            "title": "演示节点",
            "position_x": 1180,
            "position_y": 220,
            "config_json": {},
        },
    )
    assert created_deck_node.status_code == 201
    deck_node = next(node for node in created_deck_node.json()["nodes"] if node["node_type"] == "deck_generation")

    connect_reference_to_deck = client.post(
        f"/api/inspirations/{inspiration_id}/workflow/edges",
        json={
            "source_node_id": reference_node_id,
            "target_node_id": deck_node["id"],
            "source_handle": "output",
            "target_handle": "input",
        },
    )
    assert connect_reference_to_deck.status_code == 201

    session_factory = get_session_factory()
    with session_factory() as session:
        persisted_deck_node = session.get(WorkflowNode, deck_node["id"])
        assert persisted_deck_node is not None
        assert persisted_deck_node.node_type == WorkflowNodeType.DECK_GENERATION
        assert persisted_deck_node.output_json is None

    default_group_id = client.get("/api/resource-library/groups").json()["items"][0]["id"]
    saved = client.post(
        "/api/resource-library/assets/save",
        json={
            "source_type": "source_asset",
            "source_id": source_asset_id,
            "group_ids": [default_group_id],
        },
    )
    assert saved.status_code == 201
    resource_id = saved.json()["id"]

    loaded_workflow = client.post(
        f"/api/resource-library/assets/{resource_id}/load-to-workflow-node",
        json={"node_id": reference_node_id},
    )
    assert loaded_workflow.status_code == 200
    loaded_reference_node = next(node for node in loaded_workflow.json()["nodes"] if node["id"] == reference_node_id)
    loaded_deck_node = next(node for node in loaded_workflow.json()["nodes"] if node["id"] == deck_node["id"])

    loaded_source_asset_id = loaded_reference_node["output_json"]["source_asset_ids"][0]
    assert loaded_source_asset_id != source_asset_id
    assert loaded_deck_node["output_json"]["last_action"] == "refresh_sources"
    assert loaded_deck_node["output_json"]["source_manifest"]["source_asset_ids"] == [loaded_source_asset_id]
    assert loaded_deck_node["output_json"]["source_manifest"]["source_item_ids"]

    with session_factory() as session:
        persisted_deck_node = session.get(WorkflowNode, deck_node["id"])
        assert persisted_deck_node is not None
        assert persisted_deck_node.output_json is None
