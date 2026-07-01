from __future__ import annotations

from datetime import UTC, datetime

from fastapi.testclient import TestClient
from helpers import _login, _make_demo_image_bytes

from inspiration_one_backend.application.auth import ensure_auth_bootstrapped
from inspiration_one_backend.application.inspiration_workflow import graph as inspiration_workflow_graph
from inspiration_one_backend.application.inspiration_workflow.deck_sources import (
    SOURCE_UNAVAILABLE_DISABLED_POSTER_VARIANT,
    SOURCE_UNAVAILABLE_DISABLED_SOURCE_ASSET,
    SOURCE_UNAVAILABLE_MISSING_SOURCE_ASSET,
    SOURCE_UNAVAILABLE_NODE_NOT_SUCCEEDED,
    build_deck_source_manifest,
    create_or_replace_deck_node_outline,
    refresh_deck_source_manifest,
)
from inspiration_one_backend.domain.enums import (
    DeckMaterialSource,
    DeckStatus,
    PosterKind,
    SourceAssetKind,
    WorkflowNodeStatus,
    WorkflowNodeType,
)
from inspiration_one_backend.domain.rbac import ADMIN_USER_ID
from inspiration_one_backend.infrastructure.db.models import (
    DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    CopySet,
    Deck,
    DeckSlide,
    GenerationConfig,
    Inspiration,
    InspirationWorkflow,
    PosterVariant,
    SourceAsset,
    WorkflowEdge,
    WorkflowNode,
)
from inspiration_one_backend.infrastructure.provider_config import (
    IMAGE_PURPOSE,
    TEXT_PURPOSE,
    ensure_provider_config_bootstrapped,
)


def _create_workflow(db_session) -> tuple[Inspiration, InspirationWorkflow, WorkflowNode]:
    inspiration = Inspiration(
        name="演示节点来源测试",
        source_note="用于测试 DAG 演示节点的来源清单",
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
    )
    db_session.add(inspiration)
    db_session.flush()
    workflow = InspirationWorkflow(inspiration_id=inspiration.id, title="演示画布", active=True)
    db_session.add(workflow)
    db_session.flush()
    deck_node = WorkflowNode(
        workflow_id=workflow.id,
        node_type=WorkflowNodeType.DECK_GENERATION,
        title="演示节点",
        position_x=800,
        position_y=0,
        config_json={},
    )
    db_session.add(deck_node)
    db_session.flush()
    return inspiration, workflow, deck_node


def _copy_set(db_session, inspiration_id: str, *, summary: str = "核心卖点") -> CopySet:
    copy_set = CopySet(
        inspiration_id=inspiration_id,
        structured_payload={
            "version": 2,
            "summary": summary,
            "content": {
                "kind": "blocks",
                "blocks": [{"id": "headline", "label": "标题", "text": "更轻、更稳、更好看"}],
            },
        },
        model_structured_payload={
            "version": 2,
            "summary": summary,
            "content": {
                "kind": "blocks",
                "blocks": [{"id": "headline", "label": "标题", "text": "更轻、更稳、更好看"}],
            },
        },
        provider_name="test",
        model_name="test",
        prompt_version="test",
    )
    db_session.add(copy_set)
    db_session.flush()
    return copy_set


def _source_asset(
    db_session,
    inspiration_id: str,
    *,
    filename: str,
    enabled: bool = True,
    source_poster_variant_id: str | None = None,
) -> SourceAsset:
    asset = SourceAsset(
        inspiration_id=inspiration_id,
        kind=SourceAssetKind.REFERENCE_IMAGE,
        original_filename=filename,
        mime_type="image/png",
        storage_path=f"inspirations/{inspiration_id}/reference/{filename}",
        source_poster_variant_id=source_poster_variant_id,
        enabled=enabled,
        disabled_reason=None if enabled else "素材已禁用",
    )
    db_session.add(asset)
    db_session.flush()
    return asset


def _poster(
    db_session,
    inspiration_id: str,
    copy_set_id: str,
    *,
    enabled: bool = True,
) -> PosterVariant:
    poster = PosterVariant(
        inspiration_id=inspiration_id,
        copy_set_id=copy_set_id,
        kind=PosterKind.PROMO_POSTER,
        template_name="test-template",
        mime_type="image/png",
        storage_path=f"inspirations/{inspiration_id}/posters/poster.png",
        width=1024,
        height=1024,
        enabled=enabled,
        disabled_reason=None if enabled else "海报已禁用",
    )
    db_session.add(poster)
    db_session.flush()
    return poster


def _generation_config(
    db_session,
    *,
    purpose: str,
    name: str,
    resource_group_id: str = DEFAULT_GENERATION_RESOURCE_GROUP_ID,
) -> GenerationConfig:
    config = GenerationConfig(
        purpose=purpose,
        name=name,
        provider_kind="mock",
        resource_group_id=resource_group_id,
        model_settings_json={"brief_model": "mock-brief", "copy_model": "mock-copy"}
        if purpose == TEXT_PURPOSE
        else {"model": "mock-image"},
        config_json={},
        enabled=True,
    )
    db_session.add(config)
    db_session.flush()
    return config


def _node(
    db_session,
    workflow_id: str,
    *,
    node_type: WorkflowNodeType,
    title: str,
    status: WorkflowNodeStatus = WorkflowNodeStatus.SUCCEEDED,
    config_json: dict | None = None,
    output_json: dict | None = None,
) -> WorkflowNode:
    node = WorkflowNode(
        workflow_id=workflow_id,
        node_type=node_type,
        title=title,
        status=status,
        config_json=config_json or {},
        output_json=output_json,
        last_run_at=datetime(2026, 6, 25, tzinfo=UTC) if status == WorkflowNodeStatus.SUCCEEDED else None,
    )
    db_session.add(node)
    db_session.flush()
    return node


def _edge(db_session, workflow_id: str, source_node_id: str, target_node_id: str) -> WorkflowEdge:
    edge = WorkflowEdge(workflow_id=workflow_id, source_node_id=source_node_id, target_node_id=target_node_id)
    db_session.add(edge)
    db_session.flush()
    return edge


def _refreshed_workflow(db_session, workflow_id: str) -> InspirationWorkflow:
    db_session.commit()
    return inspiration_workflow_graph.get_workflow_or_raise(db_session, workflow_id)


def test_deck_source_manifest_collects_item_scoped_copy_reference_and_posters(db_session) -> None:
    inspiration, workflow, deck_node = _create_workflow(db_session)
    copy_set = _copy_set(db_session, inspiration.id)
    reference_asset = _source_asset(db_session, inspiration.id, filename="reference.png")
    image_copy_set = _copy_set(db_session, inspiration.id, summary="图片配文")
    poster_a = _poster(db_session, inspiration.id, image_copy_set.id)
    poster_b = _poster(db_session, inspiration.id, image_copy_set.id)
    paired_asset = _source_asset(db_session, inspiration.id, filename="paired.png")

    copy_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="文案节点",
        output_json={"copy_set_id": copy_set.id, "summary": "文案摘要"},
    )
    reference_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.REFERENCE_IMAGE,
        title="参考图节点",
        config_json={"source_asset_ids": [reference_asset.id]},
        output_json={"source_asset_ids": [reference_asset.id]},
    )
    image_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.IMAGE_GENERATION,
        title="生图节点",
        output_json={
            "copy_set_id": image_copy_set.id,
            "generated_poster_variant_ids": [poster_a.id, poster_b.id],
            "filled_source_asset_ids": [paired_asset.id],
        },
    )
    for source in (copy_node, reference_node, image_node):
        _edge(db_session, workflow.id, source.id, deck_node.id)

    workflow = _refreshed_workflow(db_session, workflow.id)
    deck_node = next(node for node in workflow.nodes if node.id == deck_node.id)
    manifest = build_deck_source_manifest(db_session, workflow=workflow, deck_node=deck_node)
    sources = {item.source_item_id: item for item in manifest.available_sources}

    assert f"node:{copy_node.id}:copy:{copy_set.id}" in sources
    assert f"node:{reference_node.id}:asset:{reference_asset.id}" in sources
    assert f"node:{image_node.id}:poster:{poster_a.id}" in sources
    assert f"node:{image_node.id}:poster:{poster_b.id}" in sources
    assert sources[f"node:{image_node.id}:poster:{poster_a.id}"].source_asset_id == paired_asset.id
    assert sources[f"node:{image_node.id}:poster:{poster_b.id}"].source_asset_id is None
    assert manifest.copy_set_ids == sorted([copy_set.id, image_copy_set.id])
    assert manifest.source_asset_ids == sorted([paired_asset.id, reference_asset.id])
    assert manifest.poster_variant_ids == sorted([poster_a.id, poster_b.id])
    assert manifest.unavailable_sources == []
    assert manifest.source_fingerprint
    assert "生图节点" in manifest.model_summary


def test_deck_source_manifest_respects_excluded_sources_and_configured_order(db_session) -> None:
    inspiration, workflow, deck_node = _create_workflow(db_session)
    copy_set = _copy_set(db_session, inspiration.id)
    reference_asset = _source_asset(db_session, inspiration.id, filename="reference.png")
    image_copy_set = _copy_set(db_session, inspiration.id, summary="图片配文")
    poster = _poster(db_session, inspiration.id, image_copy_set.id)

    copy_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="文案节点",
        output_json={"copy_set_id": copy_set.id, "summary": "文案摘要"},
    )
    reference_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.REFERENCE_IMAGE,
        title="参考图节点",
        config_json={"source_asset_ids": [reference_asset.id]},
        output_json={"source_asset_ids": [reference_asset.id]},
    )
    image_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.IMAGE_GENERATION,
        title="生图节点",
        output_json={
            "copy_set_id": image_copy_set.id,
            "generated_poster_variant_ids": [poster.id],
        },
    )
    for source in (copy_node, reference_node, image_node):
        _edge(db_session, workflow.id, source.id, deck_node.id)

    excluded_source_id = f"node:{copy_node.id}:copy:{copy_set.id}"
    first_source_id = f"node:{image_node.id}:poster:{poster.id}"
    second_source_id = f"node:{reference_node.id}:asset:{reference_asset.id}"
    deck_node.config_json = {
        "excluded_source_item_ids": [excluded_source_id],
        "source_order": [first_source_id, second_source_id, excluded_source_id],
    }

    workflow = _refreshed_workflow(db_session, workflow.id)
    deck_node = next(node for node in workflow.nodes if node.id == deck_node.id)
    manifest = build_deck_source_manifest(db_session, workflow=workflow, deck_node=deck_node)

    assert [item.source_item_id for item in manifest.available_sources] == [
        first_source_id,
        second_source_id,
        excluded_source_id,
    ]
    selected_flags = {item.source_item_id: item.selected for item in manifest.available_sources}
    assert selected_flags[excluded_source_id] is False
    assert selected_flags[first_source_id] is True
    assert "文案节点" not in manifest.model_summary
    assert "生图节点" in manifest.model_summary


def test_deck_source_manifest_respects_node_source_order_tokens_for_available_and_unavailable_sources(
    db_session,
) -> None:
    inspiration, workflow, deck_node = _create_workflow(db_session)
    first_copy_set = _copy_set(db_session, inspiration.id, summary="首个文案")
    second_copy_set = _copy_set(db_session, inspiration.id, summary="第二个文案")
    first_copy_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="首个文案节点",
        output_json={"copy_set_id": first_copy_set.id},
    )
    second_copy_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="第二个文案节点",
        output_json={"copy_set_id": second_copy_set.id},
    )
    first_pending_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="首个待运行节点",
        status=WorkflowNodeStatus.IDLE,
    )
    second_pending_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="第二个待运行节点",
        status=WorkflowNodeStatus.IDLE,
    )
    for source in (first_copy_node, second_copy_node, first_pending_node, second_pending_node):
        _edge(db_session, workflow.id, source.id, deck_node.id)

    deck_node.config_json = {
        "source_order": [
            f"node:{second_pending_node.id}",
            f"node:{second_copy_node.id}",
            f"node:{first_copy_node.id}",
            f"node:{first_pending_node.id}",
        ]
    }

    workflow = _refreshed_workflow(db_session, workflow.id)
    deck_node = next(node for node in workflow.nodes if node.id == deck_node.id)
    manifest = build_deck_source_manifest(db_session, workflow=workflow, deck_node=deck_node)

    assert [item.source_item_id for item in manifest.available_sources] == [
        f"node:{second_copy_node.id}:copy:{second_copy_set.id}",
        f"node:{first_copy_node.id}:copy:{first_copy_set.id}",
    ]
    assert [item.source_item_id for item in manifest.unavailable_sources] == [
        f"node:{second_pending_node.id}:node_not_succeeded",
        f"node:{first_pending_node.id}:node_not_succeeded",
    ]


def test_deck_node_outline_persists_planning_strategy_and_auto_slide_count_mode(db_session) -> None:
    inspiration, workflow, deck_node = _create_workflow(db_session)
    ensure_auth_bootstrapped(db_session)
    copy_set = _copy_set(db_session, inspiration.id)
    copy_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="文案节点",
        output_json={"copy_set_id": copy_set.id, "summary": "文案摘要"},
    )
    _edge(db_session, workflow.id, copy_node.id, deck_node.id)
    db_session.commit()

    workflow = inspiration_workflow_graph.get_workflow_or_raise(db_session, workflow.id)
    deck_node = next(node for node in workflow.nodes if node.id == deck_node.id)
    deck = create_or_replace_deck_node_outline(
        db_session,
        workflow=workflow,
        deck_node=deck_node,
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        actor_user_id=ADMIN_USER_ID,
        actor_is_admin=True,
        planning_strategy="image_led",
        slide_count_mode="auto",
        max_slides=17,
        source_input="补充说明",
    )

    db_session.refresh(deck_node)
    assert deck_node.config_json["planning_strategy"] == "image_led"
    assert deck_node.config_json["slide_count_mode"] == "auto"
    assert "尽量控制在 17 页左右" not in deck.source_input
    assert "图片驱动" in deck.source_input
    assert "允许按素材自动决定页数" in deck.source_input


def test_deck_node_outline_persists_grouping_section_and_cap_config(db_session) -> None:
    inspiration, workflow, deck_node = _create_workflow(db_session)
    ensure_auth_bootstrapped(db_session)
    copy_set = _copy_set(db_session, inspiration.id)
    copy_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="文案节点",
        output_json={"copy_set_id": copy_set.id, "summary": "文案摘要"},
    )
    image_copy_set = _copy_set(db_session, inspiration.id, summary="图片配文")
    image_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.IMAGE_GENERATION,
        title="生图节点",
        output_json={
            "copy_set_id": image_copy_set.id,
            "generated_poster_variant_ids": [
                _poster(db_session, inspiration.id, image_copy_set.id).id,
                _poster(db_session, inspiration.id, image_copy_set.id).id,
            ],
        },
    )
    for source in (copy_node, image_node):
        _edge(db_session, workflow.id, source.id, deck_node.id)
    db_session.commit()

    workflow = inspiration_workflow_graph.get_workflow_or_raise(db_session, workflow.id)
    deck_node = next(node for node in workflow.nodes if node.id == deck_node.id)
    deck = create_or_replace_deck_node_outline(
        db_session,
        workflow=workflow,
        deck_node=deck_node,
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        actor_user_id=ADMIN_USER_ID,
        actor_is_admin=True,
        planning_strategy="hybrid",
        slide_count_mode="target",
        max_slides=6,
        group_by="source_node",
        section_pages=False,
        per_group_image_cap=1,
    )

    db_session.refresh(deck_node)
    assert deck_node.config_json["group_by"] == "source_node"
    assert deck_node.config_json["section_pages"] is False
    assert deck_node.config_json["per_group_image_cap"] == 1
    assert "主体分组：source_node，共 1 组，分节页：关闭，每组代表图上限：1" in deck.source_input


def test_deck_source_manifest_builds_hybrid_planning_summary_with_group_capping(db_session) -> None:
    inspiration, workflow, deck_node = _create_workflow(db_session)
    copy_set = _copy_set(db_session, inspiration.id)
    copy_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="总文案",
        output_json={"copy_set_id": copy_set.id, "summary": "整体卖点"},
    )
    image_copy_set = _copy_set(db_session, inspiration.id, summary="图片配文")
    first_image_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.IMAGE_GENERATION,
        title="主图一组",
        output_json={
            "copy_set_id": image_copy_set.id,
            "generated_poster_variant_ids": [
                _poster(db_session, inspiration.id, image_copy_set.id).id,
                _poster(db_session, inspiration.id, image_copy_set.id).id,
            ],
        },
    )
    second_image_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.IMAGE_GENERATION,
        title="主图二组",
        output_json={
            "copy_set_id": image_copy_set.id,
            "generated_poster_variant_ids": [
                _poster(db_session, inspiration.id, image_copy_set.id).id,
                _poster(db_session, inspiration.id, image_copy_set.id).id,
            ],
        },
    )
    for source in (copy_node, first_image_node, second_image_node):
        _edge(db_session, workflow.id, source.id, deck_node.id)

    workflow = _refreshed_workflow(db_session, workflow.id)
    deck_node = next(node for node in workflow.nodes if node.id == deck_node.id)
    manifest = build_deck_source_manifest(
        db_session,
        workflow=workflow,
        deck_node=deck_node,
        planning_strategy="hybrid",
        slide_count_mode="target",
        target_slide_count=6,
    )

    assert "规划草案" in manifest.model_summary
    assert "策略：混合智能" in manifest.model_summary
    assert "页数模式：目标 6 页" in manifest.model_summary
    assert "主体分组：source_node，共 2 组" in manifest.model_summary
    assert "每组代表图上限：1" in manifest.model_summary
    assert "备选图片：2 张" in manifest.model_summary
    assert "总文案(" in manifest.model_summary


def test_deck_source_manifest_builds_copy_led_planning_summary(db_session) -> None:
    inspiration, workflow, deck_node = _create_workflow(db_session)
    copy_set = _copy_set(db_session, inspiration.id)
    image_copy_set = _copy_set(db_session, inspiration.id, summary="图片配文")
    copy_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="核心文案",
        output_json={"copy_set_id": copy_set.id, "summary": "文案摘要"},
    )
    image_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.IMAGE_GENERATION,
        title="辅助主图",
        output_json={
            "copy_set_id": image_copy_set.id,
            "generated_poster_variant_ids": [_poster(db_session, inspiration.id, image_copy_set.id).id],
        },
    )
    for source in (copy_node, image_node):
        _edge(db_session, workflow.id, source.id, deck_node.id)

    workflow = _refreshed_workflow(db_session, workflow.id)
    deck_node = next(node for node in workflow.nodes if node.id == deck_node.id)
    manifest = build_deck_source_manifest(
        db_session,
        workflow=workflow,
        deck_node=deck_node,
        planning_strategy="copy_led",
        slide_count_mode="auto",
    )

    assert "策略：文案驱动" in manifest.model_summary
    assert "主线文案来源：核心文案(" in manifest.model_summary
    assert "辅助图片来源：辅助主图(" in manifest.model_summary
    assert "中段图片主线" not in manifest.model_summary


def test_deck_source_manifest_builds_image_led_tail_group_summary(db_session) -> None:
    inspiration, workflow, deck_node = _create_workflow(db_session)
    copy_set = _copy_set(db_session, inspiration.id)
    tail_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.TAIL_SPLITTER,
        title="拆尾节点",
        output_json={
            "summary": "已应用 2 个方向",
            "latest_plan": {
                "version": 1,
                "plan_id": "plan-1",
                "status": "applied",
                "source_summary": "长文拆分",
                "items": [
                    {
                        "id": "tail-item-1",
                        "order": 1,
                        "title": "第一段",
                        "instruction": "突出轻便",
                        "visual_intent": "桌面场景",
                        "source_refs": [],
                    },
                    {
                        "id": "tail-item-2",
                        "order": 2,
                        "title": "第二段",
                        "instruction": "突出稳固",
                        "visual_intent": "户外场景",
                        "source_refs": [],
                    },
                ],
                "created_at": "2026-06-25T00:00:00Z",
            },
            "applied_batches": [
                {
                    "batch_id": "batch-1",
                    "plan_id": "plan-1",
                    "item_ids": ["tail-item-1", "tail-item-2"],
                    "node_ids": [],
                    "created_at": "2026-06-25T00:00:01Z",
                }
            ],
        },
    )
    child_image_a = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.IMAGE_GENERATION,
        title="拆尾图一",
        config_json={
            "generated_by": {"tail_node_id": tail_node.id, "batch_id": "batch-1", "item_id": "tail-item-1"},
            "tail_plan_item": {"id": "tail-item-1", "title": "第一段"},
        },
        output_json={
            "copy_set_id": copy_set.id,
            "generated_poster_variant_ids": [_poster(db_session, inspiration.id, copy_set.id).id],
        },
    )
    child_image_b = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.IMAGE_GENERATION,
        title="拆尾图二",
        config_json={
            "generated_by": {"tail_node_id": tail_node.id, "batch_id": "batch-1", "item_id": "tail-item-2"},
            "tail_plan_item": {"id": "tail-item-2", "title": "第二段"},
        },
        output_json={
            "copy_set_id": copy_set.id,
            "generated_poster_variant_ids": [_poster(db_session, inspiration.id, copy_set.id).id],
        },
    )
    tail_node.output_json["applied_batches"][0]["node_ids"] = [child_image_a.id, child_image_b.id]
    _edge(db_session, workflow.id, tail_node.id, deck_node.id)

    workflow = _refreshed_workflow(db_session, workflow.id)
    deck_node = next(node for node in workflow.nodes if node.id == deck_node.id)
    manifest = build_deck_source_manifest(
        db_session,
        workflow=workflow,
        deck_node=deck_node,
        planning_strategy="image_led",
        slide_count_mode="target",
        target_slide_count=8,
    )

    assert "策略：图片驱动" in manifest.model_summary
    assert "主体分组：tail_item，共 2 组" in manifest.model_summary
    assert "分节页：开启" in manifest.model_summary
    assert "tail_item:tail-item-1" in manifest.model_summary
    assert "tail_item:tail-item-2" in manifest.model_summary


def test_deck_source_manifest_marks_unavailable_nodes_and_disabled_resources(db_session) -> None:
    inspiration, workflow, deck_node = _create_workflow(db_session)
    copy_set = _copy_set(db_session, inspiration.id)
    disabled_asset = _source_asset(db_session, inspiration.id, filename="disabled.png", enabled=False)
    disabled_poster = _poster(db_session, inspiration.id, copy_set.id, enabled=False)

    pending_copy = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="待运行文案",
        status=WorkflowNodeStatus.IDLE,
        output_json=None,
    )
    reference_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.REFERENCE_IMAGE,
        title="禁用参考图",
        config_json={"source_asset_ids": [disabled_asset.id, "missing-asset"]},
        output_json={"source_asset_ids": [disabled_asset.id, "missing-asset"]},
    )
    image_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.IMAGE_GENERATION,
        title="禁用海报",
        output_json={
            "copy_set_id": copy_set.id,
            "generated_poster_variant_ids": [disabled_poster.id, "missing-poster"],
        },
    )
    for source in (pending_copy, reference_node, image_node):
        _edge(db_session, workflow.id, source.id, deck_node.id)

    workflow = _refreshed_workflow(db_session, workflow.id)
    deck_node = next(node for node in workflow.nodes if node.id == deck_node.id)
    manifest = build_deck_source_manifest(db_session, workflow=workflow, deck_node=deck_node)
    reasons_by_id = {item.source_item_id: item.reason for item in manifest.unavailable_sources}

    assert reasons_by_id[f"node:{pending_copy.id}:node_not_succeeded"] == SOURCE_UNAVAILABLE_NODE_NOT_SUCCEEDED
    assert reasons_by_id[f"node:{reference_node.id}:asset:{disabled_asset.id}"] == (
        SOURCE_UNAVAILABLE_DISABLED_SOURCE_ASSET
    )
    assert reasons_by_id[f"node:{reference_node.id}:asset:missing-asset"] == SOURCE_UNAVAILABLE_MISSING_SOURCE_ASSET
    assert reasons_by_id[f"node:{image_node.id}:poster:{disabled_poster.id}"] == (
        SOURCE_UNAVAILABLE_DISABLED_POSTER_VARIANT
    )
    assert reasons_by_id[f"node:{image_node.id}:poster:missing-poster"] == "missing_poster_variant"
    assert manifest.available_sources == []


def test_deck_source_manifest_collects_tail_applied_batch_child_outputs(db_session) -> None:
    inspiration, workflow, deck_node = _create_workflow(db_session)
    copy_set = _copy_set(db_session, inspiration.id)
    poster = _poster(db_session, inspiration.id, copy_set.id)

    tail_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.TAIL_SPLITTER,
        title="拆尾节点",
        output_json={
            "summary": "已应用 1 个生图方向",
            "latest_plan": {
                "version": 1,
                "plan_id": "plan-1",
                "status": "applied",
                "source_summary": "长文拆分",
                "items": [
                    {
                        "id": "tail-item-1",
                        "order": 1,
                        "title": "第一段",
                        "instruction": "突出轻便",
                        "visual_intent": "桌面场景",
                        "source_refs": [],
                    }
                ],
                "created_at": "2026-06-25T00:00:00Z",
            },
            "applied_batches": [
                {
                    "batch_id": "batch-1",
                    "plan_id": "plan-1",
                    "item_ids": ["tail-item-1"],
                    "node_ids": [],
                    "created_at": "2026-06-25T00:00:01Z",
                }
            ],
        },
    )
    child_image = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.IMAGE_GENERATION,
        title="拆尾生图",
        config_json={
            "generated_by": {
                "tail_node_id": tail_node.id,
                "batch_id": "batch-1",
                "item_id": "tail-item-1",
            },
            "tail_plan_item": {"id": "tail-item-1", "title": "第一段"},
        },
        output_json={
            "copy_set_id": copy_set.id,
            "generated_poster_variant_ids": [poster.id],
        },
    )
    tail_node.output_json["applied_batches"][0]["node_ids"] = [child_image.id]
    _edge(db_session, workflow.id, tail_node.id, deck_node.id)

    workflow = _refreshed_workflow(db_session, workflow.id)
    deck_node = next(node for node in workflow.nodes if node.id == deck_node.id)
    manifest = build_deck_source_manifest(db_session, workflow=workflow, deck_node=deck_node)
    sources = {item.source_item_id: item for item in manifest.available_sources}

    assert f"node:{tail_node.id}:tail_plan:plan-1" in sources
    tail_source_id = f"tail:tail-item-1:poster:{poster.id}"
    assert tail_source_id in sources
    assert sources[tail_source_id].workflow_node_id == child_image.id
    assert sources[tail_source_id].tail_batch_id == "batch-1"
    assert sources[tail_source_id].tail_item_id == "tail-item-1"
    assert manifest.tail_batch_ids == ["batch-1"]


def test_deck_source_manifest_respects_tail_source_order_tokens_for_tail_batches(db_session) -> None:
    inspiration, workflow, deck_node = _create_workflow(db_session)
    first_copy_set = _copy_set(db_session, inspiration.id, summary="第一段文案")
    second_copy_set = _copy_set(db_session, inspiration.id, summary="第二段文案")

    tail_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.TAIL_SPLITTER,
        title="拆尾节点",
        output_json={
            "summary": "已应用 2 个拆尾方向",
            "latest_plan": {
                "version": 1,
                "plan_id": "plan-1",
                "status": "applied",
                "source_summary": "长文拆分",
                "items": [
                    {
                        "id": "tail-item-1",
                        "order": 1,
                        "title": "第一段",
                        "instruction": "突出轻便",
                        "visual_intent": "桌面场景",
                        "source_refs": [],
                    },
                    {
                        "id": "tail-item-2",
                        "order": 2,
                        "title": "第二段",
                        "instruction": "突出续航",
                        "visual_intent": "移动场景",
                        "source_refs": [],
                    },
                ],
                "created_at": "2026-06-25T00:00:00Z",
            },
            "applied_batches": [
                {
                    "batch_id": "batch-1",
                    "plan_id": "plan-1",
                    "item_ids": ["tail-item-1"],
                    "node_ids": [],
                    "created_at": "2026-06-25T00:00:01Z",
                },
                {
                    "batch_id": "batch-2",
                    "plan_id": "plan-1",
                    "item_ids": ["tail-item-2"],
                    "node_ids": [],
                    "created_at": "2026-06-25T00:00:02Z",
                },
            ],
        },
    )
    first_copy_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="第一段文案节点",
        config_json={
            "generated_by": {"item_id": "tail-item-1", "role": "copy"},
            "tail_plan_item": {"id": "tail-item-1", "title": "第一段"},
        },
        output_json={"copy_set_id": first_copy_set.id},
    )
    second_copy_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="第二段文案节点",
        config_json={
            "generated_by": {"item_id": "tail-item-2", "role": "copy"},
            "tail_plan_item": {"id": "tail-item-2", "title": "第二段"},
        },
        output_json={"copy_set_id": second_copy_set.id},
    )
    first_pending_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="第一段待运行节点",
        status=WorkflowNodeStatus.IDLE,
        config_json={
            "generated_by": {"item_id": "tail-item-1", "role": "copy"},
            "tail_plan_item": {"id": "tail-item-1", "title": "第一段"},
        },
    )
    second_pending_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="第二段待运行节点",
        status=WorkflowNodeStatus.IDLE,
        config_json={
            "generated_by": {"item_id": "tail-item-2", "role": "copy"},
            "tail_plan_item": {"id": "tail-item-2", "title": "第二段"},
        },
    )
    tail_node.output_json["applied_batches"][0]["node_ids"] = [first_copy_node.id, first_pending_node.id]
    tail_node.output_json["applied_batches"][1]["node_ids"] = [second_copy_node.id, second_pending_node.id]
    _edge(db_session, workflow.id, tail_node.id, deck_node.id)

    deck_node.config_json = {
        "source_order": [
            f"node:{tail_node.id}",
            "tail:tail-item-2",
            "tail:tail-item-1",
        ]
    }

    workflow = _refreshed_workflow(db_session, workflow.id)
    deck_node = next(node for node in workflow.nodes if node.id == deck_node.id)
    manifest = build_deck_source_manifest(db_session, workflow=workflow, deck_node=deck_node)

    assert [item.source_item_id for item in manifest.available_sources] == [
        f"node:{tail_node.id}:tail_plan:plan-1",
        f"tail:tail-item-2:copy:{second_copy_set.id}",
        f"tail:tail-item-1:copy:{first_copy_set.id}",
    ]
    assert [item.source_item_id for item in manifest.unavailable_sources] == [
        f"tail:tail-item-2:node:{second_pending_node.id}:node_not_succeeded",
        f"tail:tail-item-1:node:{first_pending_node.id}:node_not_succeeded",
    ]


def test_deck_source_manifest_is_read_only_for_poster_asset_lookup(db_session) -> None:
    inspiration, workflow, deck_node = _create_workflow(db_session)
    copy_set = _copy_set(db_session, inspiration.id)
    poster = _poster(db_session, inspiration.id, copy_set.id)
    paired_asset = _source_asset(db_session, inspiration.id, filename="paired.png")
    image_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.IMAGE_GENERATION,
        title="生图节点",
        output_json={
            "copy_set_id": copy_set.id,
            "generated_poster_variant_ids": [poster.id],
            "filled_source_asset_ids": [paired_asset.id],
        },
    )
    _edge(db_session, workflow.id, image_node.id, deck_node.id)
    db_session.commit()
    before_asset_count = db_session.query(SourceAsset).count()
    before_asset_link = paired_asset.source_poster_variant_id
    before_node_output = dict(image_node.output_json or {})

    workflow = inspiration_workflow_graph.get_workflow_or_raise(db_session, workflow.id)
    deck_node = next(node for node in workflow.nodes if node.id == deck_node.id)
    manifest = build_deck_source_manifest(db_session, workflow=workflow, deck_node=deck_node)
    source = next(item for item in manifest.available_sources if item.poster_variant_id == poster.id)

    assert source.source_asset_id == paired_asset.id
    assert db_session.query(SourceAsset).count() == before_asset_count
    db_session.refresh(paired_asset)
    db_session.refresh(image_node)
    assert paired_asset.source_poster_variant_id == before_asset_link
    assert image_node.output_json == before_node_output


def test_deck_source_manifest_collects_transitive_inputs_only_when_requested(db_session) -> None:
    inspiration, workflow, deck_node = _create_workflow(db_session)
    copy_set = _copy_set(db_session, inspiration.id)
    context_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.INSPIRATION_CONTEXT,
        title="上游上下文",
        status=WorkflowNodeStatus.IDLE,
        config_json={"long_text": "递归来源上下文"},
        output_json=None,
    )
    copy_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="直接文案",
        output_json={"copy_set_id": copy_set.id},
    )
    _edge(db_session, workflow.id, context_node.id, copy_node.id)
    _edge(db_session, workflow.id, copy_node.id, deck_node.id)

    workflow = _refreshed_workflow(db_session, workflow.id)
    deck_node = next(node for node in workflow.nodes if node.id == deck_node.id)
    direct_manifest = build_deck_source_manifest(
        db_session,
        workflow=workflow,
        deck_node=deck_node,
        include_transitive_inputs=False,
    )
    transitive_manifest = build_deck_source_manifest(
        db_session,
        workflow=workflow,
        deck_node=deck_node,
        include_transitive_inputs=True,
    )

    direct_ids = {item.source_item_id for item in direct_manifest.available_sources}
    transitive_ids = {item.source_item_id for item in transitive_manifest.available_sources}
    assert f"node:{copy_node.id}:copy:{copy_set.id}" in direct_ids
    assert f"node:{context_node.id}:context" not in direct_ids
    assert f"node:{context_node.id}:context" in transitive_ids
    assert direct_manifest.source_fingerprint != transitive_manifest.source_fingerprint


def test_deck_source_manifest_stale_fingerprint_tracks_last_saved_value(db_session) -> None:
    inspiration, workflow, deck_node = _create_workflow(db_session)
    copy_set = _copy_set(db_session, inspiration.id)
    copy_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="文案节点",
        output_json={"copy_set_id": copy_set.id},
    )
    _edge(db_session, workflow.id, copy_node.id, deck_node.id)

    workflow = _refreshed_workflow(db_session, workflow.id)
    deck_node = next(node for node in workflow.nodes if node.id == deck_node.id)
    first_manifest = build_deck_source_manifest(db_session, workflow=workflow, deck_node=deck_node)
    assert first_manifest.source_stale is False

    deck_node.config_json = {"last_source_fingerprint": "different"}
    stale_manifest = build_deck_source_manifest(db_session, workflow=workflow, deck_node=deck_node)

    assert stale_manifest.last_source_fingerprint == "different"
    assert stale_manifest.source_fingerprint == first_manifest.source_fingerprint
    assert stale_manifest.source_stale is True


def test_refresh_deck_source_manifest_persists_node_and_deck_snapshot_without_materializing(db_session) -> None:
    inspiration, workflow, deck_node = _create_workflow(db_session)
    copy_set = _copy_set(db_session, inspiration.id)
    poster = _poster(db_session, inspiration.id, copy_set.id)
    paired_asset = _source_asset(db_session, inspiration.id, filename="paired.png")
    deck = Deck(
        inspiration_id=inspiration.id,
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        workflow_node_id=deck_node.id,
        title="节点演示",
        status=DeckStatus.DRAFT,
        source_manifest_json={"old": True},
    )
    db_session.add(deck)
    db_session.flush()
    deck_node.config_json = {"deck_id": deck.id}
    image_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.IMAGE_GENERATION,
        title="生图节点",
        output_json={
            "copy_set_id": copy_set.id,
            "generated_poster_variant_ids": [poster.id],
            "filled_source_asset_ids": [paired_asset.id],
        },
    )
    _edge(db_session, workflow.id, image_node.id, deck_node.id)
    db_session.commit()
    before_asset_count = db_session.query(SourceAsset).count()

    workflow = inspiration_workflow_graph.get_workflow_or_raise(db_session, workflow.id)
    deck_node = next(node for node in workflow.nodes if node.id == deck_node.id)
    manifest = refresh_deck_source_manifest(db_session, workflow=workflow, deck_node=deck_node)

    db_session.refresh(deck)
    db_session.refresh(paired_asset)
    assert manifest.source_stale is False
    assert deck.source_manifest_json["source_fingerprint"] == manifest.source_fingerprint
    assert deck.source_manifest_json["available_sources"][0]["source_item_id"] == (
        f"node:{image_node.id}:poster:{poster.id}"
    )
    assert deck_node.config_json["last_source_fingerprint"] == manifest.source_fingerprint
    assert deck_node.output_json["deck_id"] == deck.id
    assert deck_node.output_json["source_manifest"]["poster_variant_ids"] == [poster.id]
    assert db_session.query(SourceAsset).count() == before_asset_count
    assert paired_asset.source_poster_variant_id is None


def test_deck_sources_endpoint_returns_manifest_without_poster_lookup_mutation(
    configured_env,
    db_session,
) -> None:
    from inspiration_one_backend.presentation.api import create_app

    inspiration, workflow, deck_node = _create_workflow(db_session)
    copy_set = _copy_set(db_session, inspiration.id)
    poster = _poster(db_session, inspiration.id, copy_set.id)
    paired_asset = _source_asset(db_session, inspiration.id, filename="paired.png")
    image_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.IMAGE_GENERATION,
        title="生图节点",
        output_json={
            "copy_set_id": copy_set.id,
            "generated_poster_variant_ids": [poster.id],
            "filled_source_asset_ids": [paired_asset.id],
        },
    )
    _edge(db_session, workflow.id, image_node.id, deck_node.id)
    db_session.commit()
    before_asset_count = db_session.query(SourceAsset).count()

    app = create_app()
    client = TestClient(app)
    _login(client)
    response = client.get(f"/api/inspirations/{inspiration.id}/workflow/nodes/{deck_node.id}/deck/sources")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["workflow_id"] == workflow.id
    assert payload["deck_node_id"] == deck_node.id
    assert payload["available_sources"][0]["source_item_id"] == f"node:{image_node.id}:poster:{poster.id}"
    assert payload["available_sources"][0]["source_asset_id"] == paired_asset.id
    assert payload["available_sources"][0]["planning_role"] == "primary"
    assert payload["available_sources"][0]["download_url"] == f"/api/source-assets/{paired_asset.id}/download"
    assert payload["available_sources"][0]["preview_url"].endswith("?variant=preview")
    assert payload["available_sources"][0]["thumbnail_url"].endswith("?variant=thumbnail")
    assert payload["planning_strategy"] == "hybrid"
    assert payload["slide_count_mode"] == "auto"
    assert payload["group_by"] == "source_node"
    assert payload["section_pages"] is False
    assert payload["per_group_image_cap"] == 1
    assert payload["primary_visual_source_item_ids"] == [f"node:{image_node.id}:poster:{poster.id}"]
    assert payload["alternate_visual_source_item_ids"] == []
    assert payload["planned_groups"][0]["primary_visual_source_item_ids"] == [
        f"node:{image_node.id}:poster:{poster.id}"
    ]
    assert payload["source_stale"] is False
    assert db_session.query(SourceAsset).count() == before_asset_count
    db_session.refresh(paired_asset)
    assert paired_asset.source_poster_variant_id is None


def test_refresh_deck_sources_endpoint_persists_fingerprint_and_returns_current_manifest(
    db_session,
) -> None:
    from inspiration_one_backend.presentation.api import create_app

    inspiration, workflow, deck_node = _create_workflow(db_session)
    copy_set = _copy_set(db_session, inspiration.id)
    copy_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="文案节点",
        output_json={"copy_set_id": copy_set.id},
    )
    _edge(db_session, workflow.id, copy_node.id, deck_node.id)
    db_session.commit()

    app = create_app()
    client = TestClient(app)
    _login(client)
    response = client.post(f"/api/inspirations/{inspiration.id}/workflow/nodes/{deck_node.id}/deck/refresh-sources")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["source_stale"] is False
    assert payload["available_sources"][0]["source_item_id"] == f"node:{copy_node.id}:copy:{copy_set.id}"
    db_session.refresh(deck_node)
    assert deck_node.config_json["last_source_fingerprint"] == payload["source_fingerprint"]
    assert deck_node.output_json["source_fingerprint"] == payload["source_fingerprint"]


def test_workflow_deck_sample_endpoint_does_not_leave_deck_generating(
    configured_env,
    db_session,
    monkeypatch,
) -> None:
    from inspiration_one_backend.application import decks as deck_use_cases
    from inspiration_one_backend.application.deck_generation_core import execute_deck_slide_generation_task
    from inspiration_one_backend.presentation.api import create_app

    monkeypatch.setattr(deck_use_cases, "enqueue_deck_slide_generation_task", execute_deck_slide_generation_task)

    ensure_auth_bootstrapped(db_session)
    ensure_provider_config_bootstrapped(db_session)
    db_session.commit()

    inspiration, workflow, deck_node = _create_workflow(db_session)
    copy_set = _copy_set(db_session, inspiration.id)
    copy_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="文案节点",
        output_json={"copy_set_id": copy_set.id, "summary": "样张来源"},
    )
    _edge(db_session, workflow.id, copy_node.id, deck_node.id)

    deck = Deck(
        inspiration_id=inspiration.id,
        workflow_node_id=deck_node.id,
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        title="样张演示",
        status=DeckStatus.STYLE_CONFIRMED,
        style_key="clean_business",
    )
    db_session.add(deck)
    db_session.flush()
    deck_node.config_json = {"deck_id": deck.id, "style_key": "clean_business"}
    db_session.add_all(
        [
            DeckSlide(
                deck_id=deck.id,
                order_index=0,
                title="封面",
                points_json=["封面要点"],
            ),
            DeckSlide(
                deck_id=deck.id,
                order_index=1,
                title="正文",
                points_json=["正文要点"],
            ),
        ]
    )
    db_session.commit()

    app = create_app()
    client = TestClient(app)
    _login(client)

    response = client.post(f"/api/inspirations/{inspiration.id}/workflow/nodes/{deck_node.id}/deck/sample")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "style_confirmed"
    assert payload["generated_slide_count"] == 1
    assert payload["slides"][0]["slide_status"] == "completed"
    assert payload["slides"][1]["slide_status"] == "pending"

    workflow_response = client.get(f"/api/inspirations/{inspiration.id}/workflow")
    assert workflow_response.status_code == 200, workflow_response.text
    workflow_payload = workflow_response.json()
    returned_node = next(item for item in workflow_payload["nodes"] if item["id"] == deck_node.id)
    assert returned_node["output_json"]["deck_status"] == "style_confirmed"
    assert returned_node["output_json"]["generated_slide_count"] == 1


def test_stale_generating_deck_is_derived_as_style_confirmed_in_read_paths(
    configured_env,
    db_session,
) -> None:
    from inspiration_one_backend.presentation.api import create_app

    ensure_auth_bootstrapped(db_session)
    ensure_provider_config_bootstrapped(db_session)
    db_session.commit()

    inspiration, workflow, deck_node = _create_workflow(db_session)
    copy_set = _copy_set(db_session, inspiration.id)
    copy_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="文案节点",
        output_json={"copy_set_id": copy_set.id, "summary": "当前来源"},
    )
    _edge(db_session, workflow.id, copy_node.id, deck_node.id)

    deck = Deck(
        inspiration_id=inspiration.id,
        workflow_node_id=deck_node.id,
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        title="脏状态演示",
        status=DeckStatus.GENERATING,
        style_key="clean_business",
    )
    db_session.add(deck)
    db_session.flush()
    deck_node.config_json = {"deck_id": deck.id, "style_key": "clean_business"}
    db_session.add_all(
        [
            DeckSlide(
                deck_id=deck.id,
                order_index=0,
                title="封面",
                points_json=["封面要点"],
                image_storage_path="decks/demo/cover.png",
            ),
            DeckSlide(
                deck_id=deck.id,
                order_index=1,
                title="正文",
                points_json=["正文要点"],
            ),
        ]
    )
    db_session.commit()

    app = create_app()
    client = TestClient(app)
    _login(client)

    deck_response = client.get(f"/api/decks/{deck.id}")
    assert deck_response.status_code == 200, deck_response.text
    deck_payload = deck_response.json()
    assert deck_payload["status"] == "style_confirmed"
    assert deck_payload["generated_slide_count"] == 1

    workflow_response = client.get(f"/api/inspirations/{inspiration.id}/workflow")
    assert workflow_response.status_code == 200, workflow_response.text
    workflow_payload = workflow_response.json()
    returned_node = next(item for item in workflow_payload["nodes"] if item["id"] == deck_node.id)
    assert returned_node["output_json"]["deck_status"] == "style_confirmed"
    assert returned_node["output_json"]["generated_slide_count"] == 1


def test_workflow_endpoint_derives_live_deck_source_stale_without_persisting_snapshot(
    configured_env,
    db_session,
) -> None:
    from inspiration_one_backend.presentation.api import create_app

    inspiration, workflow, deck_node = _create_workflow(db_session)
    first_copy_set = _copy_set(db_session, inspiration.id, summary="首批文案")
    first_copy_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="首批文案节点",
        output_json={"copy_set_id": first_copy_set.id},
    )
    _edge(db_session, workflow.id, first_copy_node.id, deck_node.id)
    db_session.commit()

    workflow = inspiration_workflow_graph.get_workflow_or_raise(db_session, workflow.id)
    deck_node = next(node for node in workflow.nodes if node.id == deck_node.id)
    baseline_manifest = refresh_deck_source_manifest(db_session, workflow=workflow, deck_node=deck_node)

    db_session.refresh(deck_node)
    assert deck_node.output_json["source_stale"] is False

    second_copy_set = _copy_set(db_session, inspiration.id, summary="新增文案")
    second_copy_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="新增文案节点",
        output_json={"copy_set_id": second_copy_set.id},
    )
    _edge(db_session, workflow.id, second_copy_node.id, deck_node.id)
    db_session.commit()

    app = create_app()
    client = TestClient(app)
    _login(client)
    response = client.get(f"/api/inspirations/{inspiration.id}/workflow")

    assert response.status_code == 200, response.text
    payload = response.json()
    returned_node = next(item for item in payload["nodes"] if item["id"] == deck_node.id)
    assert returned_node["output_json"]["source_stale"] is True
    assert returned_node["output_json"]["source_fingerprint"] != baseline_manifest.source_fingerprint
    assert returned_node["output_json"]["source_manifest"]["source_item_ids"] == sorted(
        [
            f"node:{first_copy_node.id}:copy:{first_copy_set.id}",
            f"node:{second_copy_node.id}:copy:{second_copy_set.id}",
        ]
    )

    db_session.refresh(deck_node)
    assert deck_node.output_json["source_stale"] is False
    assert deck_node.output_json["source_fingerprint"] == baseline_manifest.source_fingerprint


def test_workflow_mutation_response_derives_live_deck_source_stale_without_persisting_snapshot(
    configured_env,
    db_session,
) -> None:
    from inspiration_one_backend.presentation.api import create_app

    inspiration, workflow, deck_node = _create_workflow(db_session)
    first_copy_set = _copy_set(db_session, inspiration.id, summary="首批文案")
    first_copy_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="首批文案节点",
        output_json={"copy_set_id": first_copy_set.id},
    )
    _edge(db_session, workflow.id, first_copy_node.id, deck_node.id)
    db_session.commit()

    workflow = inspiration_workflow_graph.get_workflow_or_raise(db_session, workflow.id)
    deck_node = next(node for node in workflow.nodes if node.id == deck_node.id)
    baseline_manifest = refresh_deck_source_manifest(db_session, workflow=workflow, deck_node=deck_node)

    db_session.refresh(deck_node)
    assert deck_node.output_json["source_stale"] is False

    second_copy_set = _copy_set(db_session, inspiration.id, summary="新增文案")
    second_copy_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="新增文案节点",
        output_json={"copy_set_id": second_copy_set.id},
    )
    _edge(db_session, workflow.id, second_copy_node.id, deck_node.id)
    db_session.commit()

    app = create_app()
    client = TestClient(app)
    _login(client)
    response = client.patch(f"/api/workflow-nodes/{deck_node.id}", json={"title": "已重命名 Deck 节点"})

    assert response.status_code == 200, response.text
    payload = response.json()
    returned_node = next(item for item in payload["nodes"] if item["id"] == deck_node.id)
    assert returned_node["output_json"]["source_stale"] is True
    assert returned_node["output_json"]["source_fingerprint"] != baseline_manifest.source_fingerprint
    assert returned_node["output_json"]["source_manifest"]["source_item_ids"] == sorted(
        [
            f"node:{first_copy_node.id}:copy:{first_copy_set.id}",
            f"node:{second_copy_node.id}:copy:{second_copy_set.id}",
        ]
    )

    db_session.refresh(deck_node)
    assert deck_node.output_json["source_stale"] is False
    assert deck_node.output_json["source_fingerprint"] == baseline_manifest.source_fingerprint


def test_deck_sources_endpoint_rejects_non_deck_node(db_session) -> None:
    from inspiration_one_backend.presentation.api import create_app

    inspiration, workflow, _deck_node = _create_workflow(db_session)
    copy_set = _copy_set(db_session, inspiration.id)
    copy_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="文案节点",
        output_json={"copy_set_id": copy_set.id},
    )
    db_session.commit()

    app = create_app()
    client = TestClient(app)
    _login(client)
    response = client.get(f"/api/inspirations/{inspiration.id}/workflow/nodes/{copy_node.id}/deck/sources")

    assert response.status_code == 400
    assert response.json()["detail"] == "只有演示节点可以构建来源清单"


def test_deck_outline_endpoint_creates_dag_deck_and_updates_node_snapshot(db_session) -> None:
    from inspiration_one_backend.presentation.api import create_app

    ensure_provider_config_bootstrapped(db_session)
    inspiration, workflow, deck_node = _create_workflow(db_session)
    copy_set = _copy_set(db_session, inspiration.id)
    copy_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="文案节点",
        output_json={"copy_set_id": copy_set.id},
    )
    _edge(db_session, workflow.id, copy_node.id, deck_node.id)
    db_session.commit()

    app = create_app()
    client = TestClient(app)
    _login(client)
    response = client.post(
        f"/api/inspirations/{inspiration.id}/workflow/nodes/{deck_node.id}/deck/outline",
        json={
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "title": "画布演示大纲",
            "max_slides": 3,
            "style_key": "clean_business",
            "source_input": "补充讲解结构",
            "group_by": "source_node",
            "section_pages": False,
            "per_group_image_cap": 2,
        },
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["workflow_node_id"] == deck_node.id
    assert payload["workflow_node_exists"] is True
    assert payload["title"] == "画布演示大纲"
    assert payload["status"] == "outline_confirmed"
    assert payload["slides"]
    assert payload["source_manifest_json"]["available_sources"][0]["source_item_id"] == (
        f"node:{copy_node.id}:copy:{copy_set.id}"
    )
    assert payload["slides"][0]["source_manifest_json"]["page_type"] == "cover"
    assert payload["slides"][0]["source_manifest_json"]["source_ref_ids"] == [
        f"node:{copy_node.id}:copy:{copy_set.id}"
    ]
    assert payload["slides"][0]["source_manifest_json"]["source_item_ids"] == [
        f"node:{copy_node.id}:copy:{copy_set.id}"
    ]

    db_session.refresh(deck_node)
    deck = db_session.get(Deck, payload["id"])
    assert deck is not None
    assert deck.workflow_node_id == deck_node.id
    assert deck.status == DeckStatus.OUTLINE_CONFIRMED
    assert deck_node.config_json["deck_id"] == deck.id
    assert deck_node.config_json["resource_group_id"] == DEFAULT_GENERATION_RESOURCE_GROUP_ID
    assert deck_node.config_json["group_by"] == "source_node"
    assert deck_node.config_json["section_pages"] is False
    assert deck_node.config_json["per_group_image_cap"] == 2
    assert deck_node.output_json["deck_id"] == deck.id
    assert deck_node.output_json["deck_title"] == "画布演示大纲"
    assert deck_node.output_json["last_action"] == "outline"


def test_deck_outline_endpoint_persists_text_and_image_generation_config_selection(db_session) -> None:
    from inspiration_one_backend.presentation.api import create_app

    ensure_provider_config_bootstrapped(db_session)
    text_config = _generation_config(db_session, purpose=TEXT_PURPOSE, name="演示文案配置")
    image_config = _generation_config(db_session, purpose=IMAGE_PURPOSE, name="演示图片配置")
    inspiration, workflow, deck_node = _create_workflow(db_session)
    copy_set = _copy_set(db_session, inspiration.id)
    copy_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="文案节点",
        output_json={"copy_set_id": copy_set.id},
    )
    _edge(db_session, workflow.id, copy_node.id, deck_node.id)
    db_session.commit()

    app = create_app()
    client = TestClient(app)
    _login(client)
    response = client.post(
        f"/api/inspirations/{inspiration.id}/workflow/nodes/{deck_node.id}/deck/outline",
        json={
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "text_generation_config_mode": "manual",
            "text_generation_config_id": text_config.id,
            "image_generation_config_mode": "manual",
            "image_generation_config_id": image_config.id,
        },
    )

    assert response.status_code == 200, response.text
    db_session.refresh(deck_node)
    assert deck_node.config_json["text_generation_config_mode"] == "manual"
    assert deck_node.config_json["text_generation_config_id"] == text_config.id
    assert deck_node.config_json["image_generation_config_mode"] == "manual"
    assert deck_node.config_json["image_generation_config_id"] == image_config.id


def test_deck_outline_endpoint_rejects_wrong_generation_config_purpose(db_session) -> None:
    from inspiration_one_backend.presentation.api import create_app

    ensure_provider_config_bootstrapped(db_session)
    wrong_text_config = _generation_config(db_session, purpose=IMAGE_PURPOSE, name="错误文案配置")
    inspiration, workflow, deck_node = _create_workflow(db_session)
    copy_set = _copy_set(db_session, inspiration.id)
    copy_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="文案节点",
        output_json={"copy_set_id": copy_set.id},
    )
    _edge(db_session, workflow.id, copy_node.id, deck_node.id)
    db_session.commit()

    app = create_app()
    client = TestClient(app)
    _login(client)
    response = client.post(
        f"/api/inspirations/{inspiration.id}/workflow/nodes/{deck_node.id}/deck/outline",
        json={
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "text_generation_config_mode": "manual",
            "text_generation_config_id": wrong_text_config.id,
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "演示文稿文案只能使用文案生成配置"


def test_deck_speaker_notes_endpoint_rejects_wrong_text_generation_config_purpose(db_session) -> None:
    from inspiration_one_backend.presentation.api import create_app

    ensure_provider_config_bootstrapped(db_session)
    inspiration, workflow, deck_node = _create_workflow(db_session)
    copy_set = _copy_set(db_session, inspiration.id)
    copy_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="文案节点",
        output_json={"copy_set_id": copy_set.id},
    )
    _edge(db_session, workflow.id, copy_node.id, deck_node.id)
    db_session.commit()

    app = create_app()
    client = TestClient(app)
    _login(client)
    outline = client.post(
        f"/api/inspirations/{inspiration.id}/workflow/nodes/{deck_node.id}/deck/outline",
        json={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID, "source_input": "第一页。第二页。"},
    )
    assert outline.status_code == 200, outline.text
    slide_id = outline.json()["slides"][0]["id"]

    wrong_text_config = _generation_config(db_session, purpose=IMAGE_PURPOSE, name="错误备注配置")
    db_session.refresh(deck_node)
    deck_node.config_json = {
        **(deck_node.config_json or {}),
        "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        "text_generation_config_mode": "manual",
        "text_generation_config_id": wrong_text_config.id,
    }
    db_session.commit()

    response = client.post(
        f"/api/inspirations/{inspiration.id}/workflow/nodes/{deck_node.id}/deck/slides/{slide_id}/speaker-notes"
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "演示文稿文案只能使用文案生成配置"


def test_deck_sample_endpoint_rejects_wrong_image_generation_config_purpose(db_session) -> None:
    from inspiration_one_backend.presentation.api import create_app

    ensure_provider_config_bootstrapped(db_session)
    inspiration, workflow, deck_node = _create_workflow(db_session)
    copy_set = _copy_set(db_session, inspiration.id)
    copy_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="文案节点",
        output_json={"copy_set_id": copy_set.id},
    )
    _edge(db_session, workflow.id, copy_node.id, deck_node.id)
    db_session.commit()

    app = create_app()
    client = TestClient(app)
    _login(client)
    outline = client.post(
        f"/api/inspirations/{inspiration.id}/workflow/nodes/{deck_node.id}/deck/outline",
        json={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID, "source_input": "第一页。第二页。"},
    )
    assert outline.status_code == 200, outline.text

    wrong_image_config = _generation_config(db_session, purpose=TEXT_PURPOSE, name="错误图片配置")
    db_session.refresh(deck_node)
    deck_node.config_json = {
        **(deck_node.config_json or {}),
        "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        "image_generation_config_mode": "manual",
        "image_generation_config_id": wrong_image_config.id,
    }
    db_session.commit()

    response = client.post(f"/api/inspirations/{inspiration.id}/workflow/nodes/{deck_node.id}/deck/sample")

    assert response.status_code == 400
    assert response.json()["detail"] == "演示文稿图片只能使用图片生成配置"


def test_deck_regenerate_endpoint_rejects_wrong_image_generation_config_purpose(db_session) -> None:
    from inspiration_one_backend.presentation.api import create_app

    ensure_provider_config_bootstrapped(db_session)
    inspiration, workflow, deck_node = _create_workflow(db_session)
    copy_set = _copy_set(db_session, inspiration.id)
    copy_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="文案节点",
        output_json={"copy_set_id": copy_set.id},
    )
    _edge(db_session, workflow.id, copy_node.id, deck_node.id)
    db_session.commit()

    app = create_app()
    client = TestClient(app)
    _login(client)
    outline = client.post(
        f"/api/inspirations/{inspiration.id}/workflow/nodes/{deck_node.id}/deck/outline",
        json={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID, "source_input": "第一页。第二页。"},
    )
    assert outline.status_code == 200, outline.text
    slide_id = outline.json()["slides"][0]["id"]

    wrong_image_config = _generation_config(db_session, purpose=TEXT_PURPOSE, name="错误重生成配置")
    db_session.refresh(deck_node)
    deck_node.config_json = {
        **(deck_node.config_json or {}),
        "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        "image_generation_config_mode": "manual",
        "image_generation_config_id": wrong_image_config.id,
    }
    db_session.commit()

    response = client.post(
        f"/api/inspirations/{inspiration.id}/workflow/nodes/{deck_node.id}/deck/slides/{slide_id}/regenerate"
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "演示文稿图片只能使用图片生成配置"


def test_deck_outline_endpoint_reuses_existing_deck_id_and_replaces_slides(db_session) -> None:
    from inspiration_one_backend.presentation.api import create_app

    ensure_provider_config_bootstrapped(db_session)
    inspiration, workflow, deck_node = _create_workflow(db_session)
    copy_set = _copy_set(db_session, inspiration.id)
    copy_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="文案节点",
        output_json={"copy_set_id": copy_set.id},
    )
    _edge(db_session, workflow.id, copy_node.id, deck_node.id)
    deck = Deck(
        inspiration_id=inspiration.id,
        resource_group_id=DEFAULT_GENERATION_RESOURCE_GROUP_ID,
        workflow_node_id=deck_node.id,
        title="旧大纲",
        status=DeckStatus.OUTLINE_CONFIRMED,
    )
    db_session.add(deck)
    db_session.flush()
    db_session.add(
        DeckSlide(
            deck_id=deck.id,
            order_index=0,
            title="旧页面",
            points_json=["旧内容"],
        )
    )
    deck_node.config_json = {"deck_id": deck.id, "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID}
    db_session.commit()
    old_deck_id = deck.id

    app = create_app()
    client = TestClient(app)
    _login(client)
    first = client.post(
        f"/api/inspirations/{inspiration.id}/workflow/nodes/{deck_node.id}/deck/outline",
        json={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID, "source_input": "第一版。第二版。"},
    )

    assert first.status_code == 200, first.text
    payload = first.json()
    assert payload["id"] == old_deck_id
    assert all(slide["title"] != "旧页面" for slide in payload["slides"])
    db_session.refresh(deck)
    assert deck.id == old_deck_id
    assert deck.source_manifest_json["source_fingerprint"] == payload["source_manifest_json"]["source_fingerprint"]
    assert [slide.title for slide in deck.slides] == [slide["title"] for slide in payload["slides"]]


def test_deck_outline_endpoint_rejects_without_available_sources(db_session) -> None:
    from inspiration_one_backend.presentation.api import create_app

    ensure_provider_config_bootstrapped(db_session)
    inspiration, _workflow, deck_node = _create_workflow(db_session)
    db_session.commit()

    app = create_app()
    client = TestClient(app)
    _login(client)
    response = client.post(
        f"/api/inspirations/{inspiration.id}/workflow/nodes/{deck_node.id}/deck/outline",
        json={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "演示节点没有可用来源"


def test_deck_node_basic_actions_update_deck_and_node_snapshot(db_session) -> None:
    from inspiration_one_backend.presentation.api import create_app

    ensure_provider_config_bootstrapped(db_session)
    inspiration, workflow, deck_node = _create_workflow(db_session)
    copy_set = _copy_set(db_session, inspiration.id)
    copy_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="文案节点",
        output_json={"copy_set_id": copy_set.id},
    )
    _edge(db_session, workflow.id, copy_node.id, deck_node.id)
    db_session.commit()

    app = create_app()
    client = TestClient(app)
    _login(client)
    outline = client.post(
        f"/api/inspirations/{inspiration.id}/workflow/nodes/{deck_node.id}/deck/outline",
        json={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID, "source_input": "第一段。第二段。第三段。"},
    )
    assert outline.status_code == 200, outline.text
    deck_payload = outline.json()
    deck_id = deck_payload["id"]
    slide_ids = [slide["id"] for slide in deck_payload["slides"]]

    renamed = client.patch(
        f"/api/inspirations/{inspiration.id}/workflow/nodes/{deck_node.id}/deck",
        json={"title": "节点内改名", "speaker_notes_enabled": False},
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["title"] == "节点内改名"
    assert renamed.json()["speaker_notes_enabled"] is False

    styled = client.post(
        f"/api/inspirations/{inspiration.id}/workflow/nodes/{deck_node.id}/deck/style",
        json={"style_key": "clean_business"},
    )
    assert styled.status_code == 200, styled.text
    assert styled.json()["style_key"] == "clean_business"

    updated_slide = client.put(
        f"/api/inspirations/{inspiration.id}/workflow/nodes/{deck_node.id}/deck/slides/{slide_ids[0]}",
        json={"title": "单页改写", "points": ["A", "B"], "speaker_notes": "讲稿"},
    )
    assert updated_slide.status_code == 200, updated_slide.text
    assert updated_slide.json()["title"] == "单页改写"
    assert updated_slide.json()["points"] == ["A", "B"]
    assert updated_slide.json()["speaker_notes"] == "讲稿"

    reordered = client.put(
        f"/api/inspirations/{inspiration.id}/workflow/nodes/{deck_node.id}/deck/slide-order",
        json={"slide_ids": list(reversed(slide_ids))},
    )
    assert reordered.status_code == 200, reordered.text
    assert [slide["id"] for slide in reordered.json()["slides"]] == list(reversed(slide_ids))

    db_session.refresh(deck_node)
    assert deck_node.output_json["deck_id"] == deck_id
    assert deck_node.output_json["deck_title"] == "节点内改名"
    assert deck_node.output_json["last_action"] == "reorder_slides"


def test_deck_outline_endpoint_includes_manual_title_and_slide_context_in_source_input(db_session) -> None:
    from inspiration_one_backend.presentation.api import create_app

    ensure_provider_config_bootstrapped(db_session)
    inspiration, workflow, deck_node = _create_workflow(db_session)
    copy_set = _copy_set(db_session, inspiration.id)
    copy_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="文案节点",
        output_json={"copy_set_id": copy_set.id, "summary": "文案摘要"},
    )
    _edge(db_session, workflow.id, copy_node.id, deck_node.id)
    db_session.commit()

    app = create_app()
    client = TestClient(app)
    _login(client)
    response = client.post(
        f"/api/inspirations/{inspiration.id}/workflow/nodes/{deck_node.id}/deck/outline",
        json={
            "resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID,
            "title": "路演主标题",
            "source_input": "补充说明",
            "slide_context": [
                {"title": "封面草稿", "points": ["卖点一", "卖点二"]},
                {"points": ["仅要点"]},
            ],
        },
    )

    assert response.status_code == 200, response.text
    source_input = response.json()["source_input"]
    assert "用户预设演示标题：路演主标题" in source_input
    assert "用户补充：补充说明" in source_input
    assert "当前演示草稿（供本次重新生成参考）：" in source_input
    assert "第 1 页《封面草稿》：卖点一；卖点二" in source_input
    assert "第 2 页《未命名页面》：仅要点" in source_input


def test_deck_node_slide_material_binding_uses_manifest_source_item(configured_env, db_session) -> None:
    from inspiration_one_backend.presentation.api import create_app

    ensure_provider_config_bootstrapped(db_session)
    inspiration, workflow, deck_node = _create_workflow(db_session)
    copy_set = _copy_set(db_session, inspiration.id)
    poster_path = f"inspirations/{inspiration.id}/posters/material.png"
    disk_path = configured_env / poster_path
    disk_path.parent.mkdir(parents=True, exist_ok=True)
    disk_path.write_bytes(_make_demo_image_bytes())
    poster = PosterVariant(
        inspiration_id=inspiration.id,
        copy_set_id=copy_set.id,
        kind=PosterKind.PROMO_POSTER,
        template_name="绑定海报",
        mime_type="image/png",
        storage_path=poster_path,
        width=800,
        height=800,
    )
    db_session.add(poster)
    db_session.flush()
    image_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.IMAGE_GENERATION,
        title="生图节点",
        output_json={"copy_set_id": copy_set.id, "generated_poster_variant_ids": [poster.id]},
    )
    _edge(db_session, workflow.id, image_node.id, deck_node.id)
    db_session.commit()

    app = create_app()
    client = TestClient(app)
    _login(client)
    outline = client.post(
        f"/api/inspirations/{inspiration.id}/workflow/nodes/{deck_node.id}/deck/outline",
        json={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID, "source_input": "绑定素材页"},
    )
    assert outline.status_code == 200, outline.text
    slide_id = outline.json()["slides"][0]["id"]
    source_item_id = f"node:{image_node.id}:poster:{poster.id}"
    invalid = client.put(
        f"/api/inspirations/{inspiration.id}/workflow/nodes/{deck_node.id}/deck/slides/{slide_id}/material",
        json={"source_item_id": "node:missing:poster:missing"},
    )
    assert invalid.status_code == 400
    assert invalid.json()["detail"] == "演示素材来源不可用"

    response = client.put(
        f"/api/inspirations/{inspiration.id}/workflow/nodes/{deck_node.id}/deck/slides/{slide_id}/material",
        json={"source_item_id": source_item_id, "target_slot": "visual", "caption_source": "model"},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["material_source"] == "source_asset"
    assert payload["material_url"] == f"/api/deck-slides/{slide_id}/material"
    assert payload["source_manifest_json"]["source_item_id"] == source_item_id
    assert payload["source_manifest_json"]["poster_variant_id"] == poster.id
    assert payload["source_manifest_json"]["target_slot"] == "visual"
    assert payload["source_manifest_json"]["caption_source"] == "model"
    assert payload["source_manifest_json"]["page_type"] == "cover"
    assert payload["source_manifest_json"]["source_ref_ids"] == [source_item_id]
    db_session.refresh(deck_node)
    assert deck_node.config_json["slide_bindings"][slide_id]["source_item_id"] == source_item_id
    assert deck_node.output_json["last_action"] == "bind_slide_material"
    materialized = db_session.query(SourceAsset).filter_by(source_poster_variant_id=poster.id).one()
    assert materialized.storage_path.startswith(f"inspirations/{inspiration.id}/reference/")


def test_deck_node_slide_material_enhance_uses_workflow_endpoint(configured_env, db_session) -> None:
    from inspiration_one_backend.presentation.api import create_app

    ensure_provider_config_bootstrapped(db_session)
    inspiration, workflow, deck_node = _create_workflow(db_session)
    copy_set = _copy_set(db_session, inspiration.id)
    copy_node = _node(
        db_session,
        workflow.id,
        node_type=WorkflowNodeType.COPY_GENERATION,
        title="文案节点",
        output_json={"copy_set_id": copy_set.id},
    )
    _edge(db_session, workflow.id, copy_node.id, deck_node.id)
    db_session.commit()

    app = create_app()
    client = TestClient(app)
    _login(client)
    outline = client.post(
        f"/api/inspirations/{inspiration.id}/workflow/nodes/{deck_node.id}/deck/outline",
        json={"resource_group_id": DEFAULT_GENERATION_RESOURCE_GROUP_ID, "source_input": "增强素材页"},
    )
    assert outline.status_code == 200, outline.text
    slide_id = outline.json()["slides"][0]["id"]

    upload = client.put(
        f"/api/inspirations/{inspiration.id}/workflow/nodes/{deck_node.id}/deck/slides/{slide_id}/material",
        json={"source_item_id": "node:missing:poster:missing"},
    )
    assert upload.status_code == 400

    db_slide = db_session.get(DeckSlide, slide_id)
    assert db_slide is not None
    db_slide.material_source = DeckMaterialSource.UPLOAD
    db_slide.material_mime_type = "image/png"
    db_slide.material_storage_path = f"inspirations/{inspiration.id}/deck-material/{slide_id}.png"
    db_slide.material_storage_backend = "local"
    db_slide.material_storage_bucket = None
    db_slide.material_storage_object_key = None
    disk_path = configured_env / db_slide.material_storage_path
    disk_path.parent.mkdir(parents=True, exist_ok=True)
    disk_path.write_bytes(_make_demo_image_bytes())
    db_session.commit()

    response = client.post(
        f"/api/inspirations/{inspiration.id}/workflow/nodes/{deck_node.id}/deck/slides/{slide_id}/material/enhance",
        json={"prompt": "提升清晰度"},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["material_source"] == "enhanced"
    assert payload["material_url"] == f"/api/deck-slides/{slide_id}/material"
    db_session.refresh(deck_node)
    assert deck_node.output_json["last_action"] == "enhance_material"
