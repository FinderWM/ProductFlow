from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, replace
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from inspiration_one_backend.application.copy_payloads import copy_payload_context_text, normalize_copy_payload
from inspiration_one_backend.application.deck_generation_config import (
    deck_generation_config_keys_for_purpose,
    require_deck_generation_config_selection,
)
from inspiration_one_backend.application.deck_status import derived_deck_status
from inspiration_one_backend.application.decks import (
    add_outline_slides_to_deck,
    create_deck,
    enhance_deck_slide_material,
    generate_deck,
    generate_deck_outline_payload,
    generate_deck_sample,
    generate_deck_slide_speaker_notes,
    get_deck_or_raise,
    get_deck_slide_or_raise,
    regenerate_deck_slide,
    rename_deck,
    reorder_deck_slides,
    set_deck_slide_material_from_source,
    set_deck_style,
    update_deck_slide,
)
from inspiration_one_backend.application.inspiration_workflow.artifacts import (
    lookup_source_asset_for_poster_variant,
    materialize_poster_variant_source_asset,
)
from inspiration_one_backend.application.inspiration_workflow.context import (
    inspiration_context_values,
    source_asset_ids_from_config,
)
from inspiration_one_backend.application.inspiration_workflow.query import WorkflowQueryService
from inspiration_one_backend.application.inspiration_workflow.tail_splitter import read_tail_splitter_output
from inspiration_one_backend.domain.enums import (
    DeckMaterialSource,
    DeckStatus,
    SourceAssetKind,
    WorkflowNodeStatus,
    WorkflowNodeType,
)
from inspiration_one_backend.domain.errors import BusinessValidationError
from inspiration_one_backend.infrastructure.db.models import (
    CopySet,
    Deck,
    InspirationWorkflow,
    PosterVariant,
    SourceAsset,
    WorkflowNode,
)
from inspiration_one_backend.infrastructure.deck.styles import is_valid_deck_style

DECK_SOURCE_SUPPORTED_NODE_TYPES = frozenset(
    {
        WorkflowNodeType.INSPIRATION_CONTEXT,
        WorkflowNodeType.COPY_GENERATION,
        WorkflowNodeType.REFERENCE_IMAGE,
        WorkflowNodeType.IMAGE_GENERATION,
        WorkflowNodeType.IMAGE_ENHANCE,
        WorkflowNodeType.TAIL_SPLITTER,
    }
)

SOURCE_UNAVAILABLE_NODE_NOT_SUCCEEDED = "node_not_succeeded"
SOURCE_UNAVAILABLE_EMPTY_OUTPUT = "empty_output"
SOURCE_UNAVAILABLE_MISSING_COPY_SET = "missing_copy_set"
SOURCE_UNAVAILABLE_MISSING_SOURCE_ASSET = "missing_source_asset"
SOURCE_UNAVAILABLE_DISABLED_SOURCE_ASSET = "disabled_source_asset"
SOURCE_UNAVAILABLE_MISSING_POSTER_VARIANT = "missing_poster_variant"
SOURCE_UNAVAILABLE_DISABLED_POSTER_VARIANT = "disabled_poster_variant"
SOURCE_UNAVAILABLE_UNSUPPORTED_NODE_TYPE = "unsupported_node_type"

_MODEL_SUMMARY_ITEM_LIMIT = 40
_SUMMARY_TEXT_LIMIT = 700
_PLANNING_GROUP_ITEM_LIMIT = 8
_DEFAULT_SURROUNDING_PAGE_COUNT = 3


@dataclass(frozen=True, slots=True)
class DeckSourceItem:
    source_item_id: str
    workflow_node_id: str
    workflow_node_title: str
    workflow_node_type: str
    kind: str
    group_id: str | None = None
    selected: bool = True
    summary: str | None = None
    copy_set_id: str | None = None
    source_asset_id: str | None = None
    poster_variant_id: str | None = None
    tail_batch_id: str | None = None
    tail_item_id: str | None = None
    planning_role: str | None = None

    def model_dump(self) -> dict[str, Any]:
        return _without_none(
            {
                "source_item_id": self.source_item_id,
                "workflow_node_id": self.workflow_node_id,
                "workflow_node_title": self.workflow_node_title,
                "workflow_node_type": self.workflow_node_type,
                "kind": self.kind,
                "group_id": self.group_id,
                "selected": self.selected,
                "summary": self.summary,
                "copy_set_id": self.copy_set_id,
                "source_asset_id": self.source_asset_id,
                "poster_variant_id": self.poster_variant_id,
                "tail_batch_id": self.tail_batch_id,
                "tail_item_id": self.tail_item_id,
                "planning_role": self.planning_role,
            }
        )

    def fingerprint_payload(self, *, available: bool, reason: str | None = None) -> dict[str, Any]:
        return _without_none(
            {
                "source_item_id": self.source_item_id,
                "available": available,
                "reason": reason,
                "workflow_node_id": self.workflow_node_id,
                "workflow_node_type": self.workflow_node_type,
                "kind": self.kind,
                "copy_set_id": self.copy_set_id,
                "source_asset_id": self.source_asset_id,
                "poster_variant_id": self.poster_variant_id,
                "tail_batch_id": self.tail_batch_id,
                "tail_item_id": self.tail_item_id,
                "planning_role": self.planning_role,
            }
        )


@dataclass(frozen=True, slots=True)
class DeckUnavailableSource:
    source_item_id: str
    workflow_node_id: str
    workflow_node_title: str
    workflow_node_type: str
    reason: str
    kind: str | None = None
    summary: str | None = None
    copy_set_id: str | None = None
    source_asset_id: str | None = None
    poster_variant_id: str | None = None
    tail_batch_id: str | None = None
    tail_item_id: str | None = None

    def model_dump(self) -> dict[str, Any]:
        return _without_none(
            {
                "source_item_id": self.source_item_id,
                "workflow_node_id": self.workflow_node_id,
                "workflow_node_title": self.workflow_node_title,
                "workflow_node_type": self.workflow_node_type,
                "reason": self.reason,
                "kind": self.kind,
                "summary": self.summary,
                "copy_set_id": self.copy_set_id,
                "source_asset_id": self.source_asset_id,
                "poster_variant_id": self.poster_variant_id,
                "tail_batch_id": self.tail_batch_id,
                "tail_item_id": self.tail_item_id,
            }
        )

    def fingerprint_payload(self) -> dict[str, Any]:
        return _without_none(
            {
                "source_item_id": self.source_item_id,
                "available": False,
                "reason": self.reason,
                "workflow_node_id": self.workflow_node_id,
                "workflow_node_type": self.workflow_node_type,
                "kind": self.kind,
                "copy_set_id": self.copy_set_id,
                "source_asset_id": self.source_asset_id,
                "poster_variant_id": self.poster_variant_id,
                "tail_batch_id": self.tail_batch_id,
                "tail_item_id": self.tail_item_id,
            }
        )


@dataclass(frozen=True, slots=True)
class DeckSourceManifest:
    workflow_id: str
    deck_node_id: str
    include_transitive_inputs: bool
    available_sources: list[DeckSourceItem]
    unavailable_sources: list[DeckUnavailableSource]
    source_fingerprint: str
    last_source_fingerprint: str | None
    source_stale: bool
    model_summary: str
    planning_strategy: str
    slide_count_mode: str
    target_slide_count: int | None
    group_by: str
    section_pages: bool
    per_group_image_cap: int
    primary_visual_source_item_ids: list[str]
    alternate_visual_source_item_ids: list[str]
    planned_groups: list[dict[str, Any]]

    @property
    def workflow_node_ids(self) -> list[str]:
        return sorted({item.workflow_node_id for item in self.available_sources})

    @property
    def copy_set_ids(self) -> list[str]:
        return sorted({item.copy_set_id for item in self.available_sources if item.copy_set_id})

    @property
    def source_asset_ids(self) -> list[str]:
        return sorted({item.source_asset_id for item in self.available_sources if item.source_asset_id})

    @property
    def poster_variant_ids(self) -> list[str]:
        return sorted({item.poster_variant_id for item in self.available_sources if item.poster_variant_id})

    @property
    def tail_batch_ids(self) -> list[str]:
        return sorted({item.tail_batch_id for item in self.available_sources if item.tail_batch_id})

    def model_dump(self) -> dict[str, Any]:
        return {
            "workflow_id": self.workflow_id,
            "deck_node_id": self.deck_node_id,
            "include_transitive_inputs": self.include_transitive_inputs,
            "available_sources": [item.model_dump() for item in self.available_sources],
            "unavailable_sources": [item.model_dump() for item in self.unavailable_sources],
            "source_fingerprint": self.source_fingerprint,
            "last_source_fingerprint": self.last_source_fingerprint,
            "source_stale": self.source_stale,
            "model_summary": self.model_summary,
            "planning_strategy": self.planning_strategy,
            "slide_count_mode": self.slide_count_mode,
            "target_slide_count": self.target_slide_count,
            "group_by": self.group_by,
            "section_pages": self.section_pages,
            "per_group_image_cap": self.per_group_image_cap,
            "primary_visual_source_item_ids": self.primary_visual_source_item_ids,
            "alternate_visual_source_item_ids": self.alternate_visual_source_item_ids,
            "planned_groups": self.planned_groups,
            "workflow_node_ids": self.workflow_node_ids,
            "copy_set_ids": self.copy_set_ids,
            "source_asset_ids": self.source_asset_ids,
            "poster_variant_ids": self.poster_variant_ids,
            "tail_batch_ids": self.tail_batch_ids,
        }


@dataclass(frozen=True, slots=True)
class _TailContext:
    tail_node_id: str
    batch_id: str
    item_id: str | None = None


@dataclass(frozen=True, slots=True)
class _DeckPlanningGroup:
    group_key: str
    label: str
    visual_sources: list[DeckSourceItem]
    text_sources: list[DeckSourceItem]


@dataclass(frozen=True, slots=True)
class _DeckPlanningSummary:
    planning_strategy: str
    slide_count_mode: str
    target_slide_count: int | None
    group_by: str
    section_pages: bool
    per_group_image_cap: int
    primary_visual_source_ids: set[str]
    overflow_visual_source_ids: set[str]
    groups: list[_DeckPlanningGroup]
    summary_text: str


@dataclass(frozen=True, slots=True)
class _DeckSlidePlan:
    page_type: str
    title: str
    source_ref_ids: list[str]
    group_id: str | None = None
    group_label: str | None = None
    material_hint: str | None = None
    caption_source: str | None = None


@dataclass(frozen=True, slots=True)
class _DeckOutlineContextSlide:
    title: str
    points: list[str]


def build_deck_source_manifest(
    session: Session,
    *,
    workflow: InspirationWorkflow,
    deck_node: WorkflowNode,
    include_transitive_inputs: bool | None = None,
    planning_strategy: str | None = None,
    slide_count_mode: str | None = None,
    target_slide_count: int | None = None,
    group_by: str | None = None,
    section_pages: bool | None = None,
    per_group_image_cap: int | None = None,
) -> DeckSourceManifest:
    if deck_node.workflow_id != workflow.id:
        raise BusinessValidationError("演示节点不属于当前画布")
    if deck_node.node_type != WorkflowNodeType.DECK_GENERATION:
        raise BusinessValidationError("只有演示节点可以构建来源清单")

    if include_transitive_inputs is None:
        include_transitive_inputs = bool((deck_node.config_json or {}).get("include_transitive_inputs"))
    excluded_source_item_ids = _string_set((deck_node.config_json or {}).get("excluded_source_item_ids"))
    collector = _DeckSourceCollector(session, workflow, excluded_source_item_ids=excluded_source_item_ids)
    for node in _upstream_source_nodes(workflow, deck_node.id, include_transitive=include_transitive_inputs):
        collector.collect_node(node)

    source_order = _unique_strings((deck_node.config_json or {}).get("source_order") or [])
    available_sources = _ordered_deck_source_items(collector.available_sources, source_order=source_order)
    unavailable_sources = _ordered_unavailable_sources(collector.unavailable_sources, source_order=source_order)
    fingerprint = _source_fingerprint(available_sources, unavailable_sources)
    last_fingerprint = _optional_text((deck_node.config_json or {}).get("last_source_fingerprint"))
    selected_planning_strategy = _normalized_planning_strategy(
        planning_strategy or (deck_node.config_json or {}).get("planning_strategy")
    )
    selected_slide_count_mode = _normalized_slide_count_mode(
        slide_count_mode or (deck_node.config_json or {}).get("slide_count_mode")
    )
    selected_target_slide_count = (
        target_slide_count
        if selected_slide_count_mode == "target"
        else None
    )
    if selected_target_slide_count is None and selected_slide_count_mode == "target":
        selected_target_slide_count = _positive_int((deck_node.config_json or {}).get("target_slide_count"))
    planning = _build_planning_summary(
        available_sources,
        planning_strategy=selected_planning_strategy,
        slide_count_mode=selected_slide_count_mode,
        target_slide_count=selected_target_slide_count,
        group_by=group_by or (deck_node.config_json or {}).get("group_by"),
        section_pages=(
            section_pages
            if section_pages is not None
            else (deck_node.config_json or {}).get("section_pages")
        ),
        per_group_image_cap=per_group_image_cap
        or _positive_int((deck_node.config_json or {}).get("per_group_image_cap")),
    )
    available_sources = _apply_planning_roles(available_sources, planning=planning)
    return DeckSourceManifest(
        workflow_id=workflow.id,
        deck_node_id=deck_node.id,
        include_transitive_inputs=include_transitive_inputs,
        available_sources=available_sources,
        unavailable_sources=unavailable_sources,
        source_fingerprint=fingerprint,
        last_source_fingerprint=last_fingerprint,
        source_stale=bool(last_fingerprint and last_fingerprint != fingerprint),
        model_summary=planning.summary_text,
        planning_strategy=planning.planning_strategy,
        slide_count_mode=planning.slide_count_mode,
        target_slide_count=planning.target_slide_count,
        group_by=planning.group_by,
        section_pages=planning.section_pages,
        per_group_image_cap=planning.per_group_image_cap,
        primary_visual_source_item_ids=sorted(planning.primary_visual_source_ids),
        alternate_visual_source_item_ids=sorted(planning.overflow_visual_source_ids),
        planned_groups=_planning_group_summaries(
            planning.groups,
            primary_visual_source_ids=planning.primary_visual_source_ids,
            overflow_visual_source_ids=planning.overflow_visual_source_ids,
        ),
    )


def refresh_deck_source_manifest(
    session: Session,
    *,
    workflow: InspirationWorkflow,
    deck_node: WorkflowNode,
    include_transitive_inputs: bool | None = None,
) -> DeckSourceManifest:
    manifest = build_deck_source_manifest(
        session,
        workflow=workflow,
        deck_node=deck_node,
        include_transitive_inputs=include_transitive_inputs,
    )
    manifest_payload = manifest.model_dump()
    config = dict(deck_node.config_json or {})
    config["include_transitive_inputs"] = manifest.include_transitive_inputs
    config["last_source_fingerprint"] = manifest.source_fingerprint
    deck_node.config_json = config
    deck_node.output_json = _deck_node_output_snapshot(deck_node=deck_node, manifest=manifest)

    deck_id = _optional_text(config.get("deck_id"))
    if deck_id:
        deck = session.get(Deck, deck_id)
        if deck is not None and deck.inspiration_id == workflow.inspiration_id:
            deck.workflow_node_id = deck_node.id
            deck.source_manifest_json = manifest_payload
    session.commit()
    session.refresh(deck_node)
    return build_deck_source_manifest(
        session,
        workflow=workflow,
        deck_node=deck_node,
        include_transitive_inputs=manifest.include_transitive_inputs,
    )


def preview_deck_node_output(
    session: Session,
    *,
    workflow: InspirationWorkflow,
    deck_node: WorkflowNode,
) -> dict[str, Any] | None:
    if deck_node.node_type != WorkflowNodeType.DECK_GENERATION:
        return deck_node.output_json if isinstance(deck_node.output_json, dict) else None
    manifest = build_deck_source_manifest(session, workflow=workflow, deck_node=deck_node)
    return _deck_node_output_snapshot(
        deck_node=deck_node,
        manifest=manifest,
        deck=_linked_deck_for_snapshot(session, workflow=workflow, deck_node=deck_node),
        last_action=_optional_text(_output_dict(deck_node).get("last_action")) or "refresh_sources",
    )


def create_or_replace_deck_node_outline(
    session: Session,
    *,
    workflow: InspirationWorkflow,
    deck_node: WorkflowNode,
    resource_group_id: str | None,
    actor_user_id: str,
    actor_is_admin: bool,
    title: str | None = None,
    max_slides: int | None = None,
    style_key: str | None = None,
    source_input: str | None = None,
    include_transitive_inputs: bool | None = None,
    planning_strategy: str | None = None,
    slide_count_mode: str | None = None,
    group_by: str | None = None,
    section_pages: bool | None = None,
    per_group_image_cap: int | None = None,
    slide_context: list[dict[str, Any]] | None = None,
    text_generation_config_mode: str | None = None,
    text_generation_config_id: str | None = None,
    image_generation_config_mode: str | None = None,
    image_generation_config_id: str | None = None,
) -> Deck:
    config = dict(deck_node.config_json or {})
    selected_slide_count_mode = _normalized_slide_count_mode(slide_count_mode or config.get("slide_count_mode"))
    selected_max_slides = (
        max_slides or _positive_int(config.get("target_slide_count"))
        if selected_slide_count_mode == "target"
        else None
    )
    selected_planning_strategy = _normalized_planning_strategy(planning_strategy or config.get("planning_strategy"))
    selected_group_by = _normalized_group_by_value(group_by or config.get("group_by"))
    selected_section_pages = _optional_bool(section_pages)
    if selected_section_pages is None and isinstance(config.get("section_pages"), bool):
        selected_section_pages = bool(config.get("section_pages"))
    selected_per_group_image_cap = _bounded_per_group_image_cap(
        per_group_image_cap if per_group_image_cap is not None else config.get("per_group_image_cap")
    )
    existing_deck = _existing_deck_for_node(
        session,
        workflow=workflow,
        deck_node=deck_node,
        config=config,
    )
    manifest = build_deck_source_manifest(
        session,
        workflow=workflow,
        deck_node=deck_node,
        include_transitive_inputs=include_transitive_inputs,
        planning_strategy=selected_planning_strategy,
        slide_count_mode=selected_slide_count_mode,
        target_slide_count=selected_max_slides,
        group_by=selected_group_by,
        section_pages=selected_section_pages,
        per_group_image_cap=selected_per_group_image_cap,
    )
    selected_sources = [item for item in manifest.available_sources if item.selected]
    if not selected_sources:
        raise BusinessValidationError("演示节点没有可用来源")

    manifest_payload = manifest.model_dump()
    selected_resource_group_id = resource_group_id or _optional_text(config.get("resource_group_id"))
    _merge_deck_generation_config_selection(
        config,
        purpose="text",
        mode=text_generation_config_mode,
        generation_config_id=text_generation_config_id,
    )
    _merge_deck_generation_config_selection(
        config,
        purpose="image",
        mode=image_generation_config_mode,
        generation_config_id=image_generation_config_id,
    )
    text_selection = require_deck_generation_config_selection(
        session,
        raw_config=config,
        purpose="text",
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        resource_group_id=selected_resource_group_id,
    )
    require_deck_generation_config_selection(
        session,
        raw_config=config,
        purpose="image",
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
        resource_group_id=selected_resource_group_id,
    )
    selected_title = title or _optional_text(config.get("title"))
    selected_style_key = style_key or _optional_text(config.get("style_key"))
    merged_source_input = _outline_source_input(
        manifest,
        deck_title=selected_title,
        manual_source_input=source_input,
        planning_strategy=selected_planning_strategy,
        slide_count_mode=selected_slide_count_mode,
        target_slide_count=selected_max_slides,
        slide_context=_normalized_outline_slide_context(
            slide_context,
            fallback_deck=existing_deck,
        ),
    )
    if existing_deck is None:
        deck = create_deck(
            session,
            inspiration_id=workflow.inspiration_id,
            resource_group_id=selected_resource_group_id,
            actor_user_id=actor_user_id,
            actor_is_admin=actor_is_admin,
            source_input=merged_source_input,
            title=selected_title,
            max_slides=selected_max_slides,
            style_key=selected_style_key,
            workflow_node_id=deck_node.id,
            source_manifest_json=manifest_payload,
            generation_config_selection=text_selection,
        )
        deck.status = DeckStatus.OUTLINE_CONFIRMED
    else:
        outline, group_id, bounded_max = generate_deck_outline_payload(
            session,
            inspiration_id=workflow.inspiration_id,
            resource_group_id=selected_resource_group_id or existing_deck.resource_group_id,
            actor_user_id=actor_user_id,
            actor_is_admin=actor_is_admin,
            source_input=merged_source_input,
            max_slides=selected_max_slides,
            generation_config_selection=text_selection,
        )
        for slide in list(existing_deck.slides):
            session.delete(slide)
        session.flush()
        existing_deck.resource_group_id = group_id
        existing_deck.workflow_node_id = deck_node.id
        existing_deck.source_input = merged_source_input
        existing_deck.source_manifest_json = manifest_payload
        existing_deck.title = (selected_title or outline.title or existing_deck.title).strip() or "演示文稿"
        if selected_style_key is not None:
            existing_deck.style_key = selected_style_key.strip() if is_valid_deck_style(selected_style_key) else None
        existing_deck.outline_json = {"title": outline.title}
        existing_deck.status = DeckStatus.OUTLINE_CONFIRMED
        existing_deck.last_error = None
        add_outline_slides_to_deck(
            session,
            deck=existing_deck,
            outline=outline,
            max_slides=bounded_max,
            source_manifest_json=None,
        )
        session.commit()
        session.refresh(existing_deck)
        session.expire(existing_deck, ["slides"])
        deck = existing_deck

    _assign_outline_slide_source_manifests(deck, manifest, planning_strategy=selected_planning_strategy)
    config["deck_id"] = deck.id
    config["include_transitive_inputs"] = manifest.include_transitive_inputs
    config["resource_group_id"] = deck.resource_group_id
    config["last_source_fingerprint"] = manifest.source_fingerprint
    config["planning_strategy"] = selected_planning_strategy
    config["slide_count_mode"] = selected_slide_count_mode
    config["group_by"] = selected_group_by
    if selected_section_pages is not None:
        config["section_pages"] = selected_section_pages
    elif "section_pages" not in config:
        config["section_pages"] = True
    if selected_per_group_image_cap is not None:
        config["per_group_image_cap"] = selected_per_group_image_cap
    if selected_max_slides is not None:
        config["target_slide_count"] = selected_max_slides
    if title is not None and title.strip():
        config["title"] = title.strip()
    if style_key is not None and style_key.strip():
        config["style_key"] = style_key.strip()
    deck_node.config_json = config
    deck_node.output_json = _deck_node_output_snapshot(
        deck_node=deck_node,
        manifest=manifest,
        deck=deck,
        last_action="outline",
    )
    session.commit()
    session.refresh(deck)
    return deck


def rename_deck_node_deck(
    session: Session,
    *,
    workflow: InspirationWorkflow,
    deck_node: WorkflowNode,
    title: str | None,
    speaker_notes_enabled: bool | None,
) -> Deck:
    deck = _deck_for_node_or_raise(session, workflow=workflow, deck_node=deck_node)
    deck = rename_deck(session, deck.id, title=title, speaker_notes_enabled=speaker_notes_enabled)
    _sync_deck_node_output(session, workflow=workflow, deck_node=deck_node, deck=deck, last_action="update_deck")
    return deck


def set_deck_node_style(
    session: Session,
    *,
    workflow: InspirationWorkflow,
    deck_node: WorkflowNode,
    style_key: str | None,
) -> Deck:
    deck = _deck_for_node_or_raise(session, workflow=workflow, deck_node=deck_node)
    deck = set_deck_style(session, deck.id, style_key=style_key, style_reference_asset_id=None)
    _sync_deck_node_output(session, workflow=workflow, deck_node=deck_node, deck=deck, last_action="style")
    return deck


def generate_deck_node_sample(
    session: Session,
    *,
    workflow: InspirationWorkflow,
    deck_node: WorkflowNode,
) -> Deck:
    deck = _deck_for_node_or_raise(session, workflow=workflow, deck_node=deck_node)
    require_deck_generation_config_selection(
        session,
        raw_config=deck_node.config_json,
        purpose="image",
        actor_user_id=workflow.inspiration.owner_user_id,
        actor_is_admin=bool(workflow.inspiration.owner and workflow.inspiration.owner.is_admin),
        resource_group_id=deck.resource_group_id,
    )
    generate_deck_sample(session, deck.id)
    deck = get_deck_or_raise(session, deck.id)
    _sync_deck_node_output(session, workflow=workflow, deck_node=deck_node, deck=deck, last_action="sample")
    return deck


def generate_deck_node_deck(
    session: Session,
    *,
    workflow: InspirationWorkflow,
    deck_node: WorkflowNode,
) -> Deck:
    deck = _deck_for_node_or_raise(session, workflow=workflow, deck_node=deck_node)
    require_deck_generation_config_selection(
        session,
        raw_config=deck_node.config_json,
        purpose="image",
        actor_user_id=workflow.inspiration.owner_user_id,
        actor_is_admin=bool(workflow.inspiration.owner and workflow.inspiration.owner.is_admin),
        resource_group_id=deck.resource_group_id,
    )
    deck = generate_deck(session, deck.id)
    _sync_deck_node_output(session, workflow=workflow, deck_node=deck_node, deck=deck, last_action="generate")
    return deck


def reorder_deck_node_slides(
    session: Session,
    *,
    workflow: InspirationWorkflow,
    deck_node: WorkflowNode,
    slide_ids: list[str],
) -> Deck:
    deck = _deck_for_node_or_raise(session, workflow=workflow, deck_node=deck_node)
    deck = reorder_deck_slides(session, deck.id, slide_ids=slide_ids)
    _sync_deck_node_output(session, workflow=workflow, deck_node=deck_node, deck=deck, last_action="reorder_slides")
    return deck


def update_deck_node_slide(
    session: Session,
    *,
    workflow: InspirationWorkflow,
    deck_node: WorkflowNode,
    slide_id: str,
    title: str | None = None,
    points: list[str] | None = None,
    speaker_notes: str | None = None,
) -> Any:
    deck = _deck_for_node_or_raise(session, workflow=workflow, deck_node=deck_node)
    _ensure_slide_belongs_to_deck(session, slide_id=slide_id, deck_id=deck.id)
    slide = update_deck_slide(session, slide_id, title=title, points=points, speaker_notes=speaker_notes)
    _sync_deck_node_output(session, workflow=workflow, deck_node=deck_node, deck=deck, last_action="update_slide")
    return slide


def regenerate_deck_node_slide(
    session: Session,
    *,
    workflow: InspirationWorkflow,
    deck_node: WorkflowNode,
    slide_id: str,
) -> Any:
    deck = _deck_for_node_or_raise(session, workflow=workflow, deck_node=deck_node)
    _ensure_slide_belongs_to_deck(session, slide_id=slide_id, deck_id=deck.id)
    require_deck_generation_config_selection(
        session,
        raw_config=deck_node.config_json,
        purpose="image",
        actor_user_id=workflow.inspiration.owner_user_id,
        actor_is_admin=bool(workflow.inspiration.owner and workflow.inspiration.owner.is_admin),
        resource_group_id=deck.resource_group_id,
    )
    slide = regenerate_deck_slide(session, slide_id)
    _sync_deck_node_output(session, workflow=workflow, deck_node=deck_node, deck=deck, last_action="regenerate_slide")
    return slide


def generate_deck_node_slide_speaker_notes(
    session: Session,
    *,
    workflow: InspirationWorkflow,
    deck_node: WorkflowNode,
    slide_id: str,
    actor_user_id: str,
) -> Any:
    deck = _deck_for_node_or_raise(session, workflow=workflow, deck_node=deck_node)
    _ensure_slide_belongs_to_deck(session, slide_id=slide_id, deck_id=deck.id)
    selection = require_deck_generation_config_selection(
        session,
        raw_config=deck_node.config_json,
        purpose="text",
        actor_user_id=workflow.inspiration.owner_user_id,
        actor_is_admin=bool(workflow.inspiration.owner and workflow.inspiration.owner.is_admin),
        resource_group_id=deck.resource_group_id,
    )
    slide = generate_deck_slide_speaker_notes(
        session,
        slide_id,
        actor_user_id=actor_user_id,
        generation_config_selection=selection,
    )
    _sync_deck_node_output(session, workflow=workflow, deck_node=deck_node, deck=deck, last_action="speaker_notes")
    return slide


def enhance_deck_node_slide_material(
    session: Session,
    *,
    workflow: InspirationWorkflow,
    deck_node: WorkflowNode,
    slide_id: str,
    prompt: str | None = None,
) -> Any:
    deck = _deck_for_node_or_raise(session, workflow=workflow, deck_node=deck_node)
    _ensure_slide_belongs_to_deck(session, slide_id=slide_id, deck_id=deck.id)
    selection = require_deck_generation_config_selection(
        session,
        raw_config=deck_node.config_json,
        purpose="image",
        actor_user_id=workflow.inspiration.owner_user_id,
        actor_is_admin=bool(workflow.inspiration.owner and workflow.inspiration.owner.is_admin),
        resource_group_id=deck.resource_group_id,
    )
    slide = enhance_deck_slide_material(
        session,
        slide_id=slide_id,
        prompt=prompt,
        generation_config_selection=selection,
    )
    _sync_deck_node_output(session, workflow=workflow, deck_node=deck_node, deck=deck, last_action="enhance_material")
    return slide


def bind_deck_node_slide_material(
    session: Session,
    *,
    workflow: InspirationWorkflow,
    deck_node: WorkflowNode,
    slide_id: str,
    source_item_id: str,
    target_slot: str | None = None,
    caption_source: str | None = None,
) -> Any:
    deck = _deck_for_node_or_raise(session, workflow=workflow, deck_node=deck_node)
    _ensure_slide_belongs_to_deck(session, slide_id=slide_id, deck_id=deck.id)
    manifest = build_deck_source_manifest(session, workflow=workflow, deck_node=deck_node)
    item = next((source for source in manifest.available_sources if source.source_item_id == source_item_id), None)
    if item is None:
        raise BusinessValidationError("演示素材来源不可用")
    asset_id = item.source_asset_id
    if asset_id is None and item.poster_variant_id:
        asset = materialize_poster_variant_source_asset(
            session,
            workflow=workflow,
            poster_variant_id=item.poster_variant_id,
        )
        asset_id = asset.id
    if asset_id is None:
        raise BusinessValidationError("当前来源不能作为幻灯片配图")
    asset = session.get(SourceAsset, asset_id)
    if (
        asset is None
        or asset.inspiration_id != workflow.inspiration_id
        or asset.kind != SourceAssetKind.REFERENCE_IMAGE
    ):
        raise BusinessValidationError("演示素材来源不可用")
    if not asset.enabled:
        raise BusinessValidationError("演示素材来源已被禁用")
    slide = set_deck_slide_material_from_source(
        session,
        slide_id,
        source_type=DeckMaterialSource.SOURCE_ASSET.value,
        asset_id=asset.id,
    )
    slide.source_manifest_json = _slide_binding_source_manifest(
        slide.source_manifest_json if isinstance(slide.source_manifest_json, dict) else None,
        item,
        source_asset_id=asset.id,
        target_slot=target_slot,
        caption_source=caption_source,
    )
    _update_slide_binding_config(
        deck_node,
        slide_id=slide.id,
        binding=slide.source_manifest_json,
    )
    _sync_deck_node_output(
        session,
        workflow=workflow,
        deck_node=deck_node,
        deck=deck,
        manifest=manifest,
        last_action="bind_slide_material",
    )
    session.refresh(slide)
    return slide


def unbind_deck_node_slide_material(
    session: Session,
    *,
    workflow: InspirationWorkflow,
    deck_node: WorkflowNode,
    slide_id: str,
) -> Any:
    from inspiration_one_backend.application.decks import clear_deck_slide_material

    deck = _deck_for_node_or_raise(session, workflow=workflow, deck_node=deck_node)
    _ensure_slide_belongs_to_deck(session, slide_id=slide_id, deck_id=deck.id)
    slide = clear_deck_slide_material(session, slide_id)
    _remove_slide_binding_config(deck_node, slide_id=slide.id)
    _sync_deck_node_output(
        session,
        workflow=workflow,
        deck_node=deck_node,
        deck=deck,
        last_action="unbind_slide_material",
    )
    session.refresh(slide)
    return slide


def _remove_slide_binding_config(deck_node: WorkflowNode, *, slide_id: str) -> None:
    config = dict(deck_node.config_json or {})
    raw_bindings = config.get("slide_bindings")
    if not isinstance(raw_bindings, dict):
        return
    slide_bindings = dict(raw_bindings)
    slide_bindings.pop(slide_id, None)
    config["slide_bindings"] = slide_bindings
    deck_node.config_json = config


def _merge_deck_generation_config_selection(
    config: dict[str, Any],
    *,
    purpose: str,
    mode: str | None,
    generation_config_id: str | None,
) -> None:
    mode_key, id_key = deck_generation_config_keys_for_purpose(purpose)
    normalized_mode = _optional_text(mode)
    if normalized_mode is not None:
        config[mode_key] = "manual" if normalized_mode == "manual" else "auto"
    if generation_config_id is not None:
        config[id_key] = _optional_text(generation_config_id)


def _existing_deck_for_node(
    session: Session,
    *,
    workflow: InspirationWorkflow,
    deck_node: WorkflowNode,
    config: dict[str, Any],
) -> Deck | None:
    deck_id = _optional_text(config.get("deck_id"))
    if deck_id is None:
        return None
    deck = session.get(Deck, deck_id)
    if deck is None or deck.inspiration_id != workflow.inspiration_id:
        return None
    if deck.workflow_node_id not in (None, deck_node.id):
        return None
    return deck


def _deck_for_node_or_raise(
    session: Session,
    *,
    workflow: InspirationWorkflow,
    deck_node: WorkflowNode,
) -> Deck:
    if deck_node.workflow_id != workflow.id:
        raise BusinessValidationError("演示节点不属于当前画布")
    if deck_node.node_type != WorkflowNodeType.DECK_GENERATION:
        raise BusinessValidationError("只有演示节点可以编辑演示文稿")
    config = dict(deck_node.config_json or {})
    deck = _existing_deck_for_node(session, workflow=workflow, deck_node=deck_node, config=config)
    if deck is None:
        deck = session.scalar(
            select(Deck).where(
                Deck.inspiration_id == workflow.inspiration_id,
                Deck.workflow_node_id == deck_node.id,
            )
        )
    if deck is None:
        raise BusinessValidationError("演示节点尚未生成大纲")
    if deck.workflow_node_id is None:
        deck.workflow_node_id = deck_node.id
    return deck


def _ensure_slide_belongs_to_deck(session: Session, *, slide_id: str, deck_id: str) -> None:
    slide = get_deck_slide_or_raise(session, slide_id)
    if slide.deck_id != deck_id:
        raise BusinessValidationError("幻灯片不属于当前演示节点")


def _sync_deck_node_output(
    session: Session,
    *,
    workflow: InspirationWorkflow,
    deck_node: WorkflowNode,
    deck: Deck,
    last_action: str,
    manifest: DeckSourceManifest | None = None,
) -> None:
    manifest = manifest or build_deck_source_manifest(session, workflow=workflow, deck_node=deck_node)
    config = dict(deck_node.config_json or {})
    config["deck_id"] = deck.id
    config["resource_group_id"] = deck.resource_group_id
    deck_node.config_json = config
    deck_node.output_json = _deck_node_output_snapshot(
        deck_node=deck_node,
        manifest=manifest,
        deck=deck,
        last_action=last_action,
    )
    session.commit()
    session.refresh(deck)


def _linked_deck_for_snapshot(
    session: Session,
    *,
    workflow: InspirationWorkflow,
    deck_node: WorkflowNode,
) -> Deck | None:
    deck_id = _optional_text((deck_node.config_json or {}).get("deck_id"))
    if deck_id is None:
        deck_id = _optional_text(_output_dict(deck_node).get("deck_id"))
    if deck_id is None:
        return None
    deck = session.get(Deck, deck_id)
    if deck is None or deck.inspiration_id != workflow.inspiration_id:
        return None
    return deck


def _slide_binding_source_manifest(
    existing_manifest: dict[str, Any] | None,
    item: DeckSourceItem,
    *,
    source_asset_id: str,
    target_slot: str | None,
    caption_source: str | None,
) -> dict[str, Any]:
    base_manifest = dict(existing_manifest or {})
    return _without_none(
        {
            **base_manifest,
            "source_item_id": item.source_item_id,
            "workflow_node_id": item.workflow_node_id,
            "workflow_node_title": item.workflow_node_title,
            "workflow_node_type": item.workflow_node_type,
            "kind": item.kind,
            "source_asset_id": source_asset_id,
            "poster_variant_id": item.poster_variant_id,
            "copy_set_id": item.copy_set_id,
            "tail_batch_id": item.tail_batch_id,
            "tail_item_id": item.tail_item_id,
            "target_slot": _optional_text(target_slot),
            "caption_source": _optional_text(caption_source) or base_manifest.get("caption_source"),
        }
    )


def _update_slide_binding_config(deck_node: WorkflowNode, *, slide_id: str, binding: dict[str, Any]) -> None:
    config = dict(deck_node.config_json or {})
    raw_bindings = config.get("slide_bindings")
    slide_bindings = dict(raw_bindings) if isinstance(raw_bindings, dict) else {}
    slide_bindings[slide_id] = binding
    config["slide_bindings"] = slide_bindings
    deck_node.config_json = config


def _slide_outline_source_manifest(manifest: DeckSourceManifest) -> dict[str, Any]:
    return {
        "source_fingerprint": manifest.source_fingerprint,
        "source_item_ids": sorted(item.source_item_id for item in manifest.available_sources if item.selected),
    }


def _assign_outline_slide_source_manifests(
    deck: Deck,
    manifest: DeckSourceManifest,
    *,
    planning_strategy: str,
) -> None:
    slide_plans = _build_slide_plans(
        deck,
        manifest,
        planning_strategy=planning_strategy,
    )
    fallback_manifest = _slide_outline_source_manifest(manifest)
    for index, slide in enumerate(deck.slides):
        plan = slide_plans[index] if index < len(slide_plans) else None
        if plan is None:
            slide.source_manifest_json = fallback_manifest
            continue
        slide.source_manifest_json = _without_none(
            {
                "source_fingerprint": manifest.source_fingerprint,
                "page_type": plan.page_type,
                "group_id": plan.group_id,
                "group_label": plan.group_label,
                "source_ref_ids": plan.source_ref_ids,
                "source_item_ids": plan.source_ref_ids,
                "material_hint": plan.material_hint,
                "caption_source": plan.caption_source,
            }
        )


def _build_slide_plans(
    deck: Deck,
    manifest: DeckSourceManifest,
    *,
    planning_strategy: str,
) -> list[_DeckSlidePlan]:
    selected_sources = [item for item in manifest.available_sources if item.selected]
    text_sources = [item for item in selected_sources if not _is_visual_source(item)]
    visual_sources = [item for item in selected_sources if _is_visual_source(item)]
    primary_visual_sources = [
        item for item in visual_sources if item.source_item_id in set(manifest.primary_visual_source_item_ids)
    ]
    if not deck.slides:
        return []
    if planning_strategy == "copy_led" or not visual_sources:
        return _copy_led_slide_plans(deck, text_sources=text_sources, visual_sources=visual_sources)
    groups = _build_planning_groups(selected_sources, group_by=manifest.group_by)
    return _visual_slide_plans(
        deck,
        text_sources=text_sources,
        visual_sources=visual_sources,
        primary_visual_sources=primary_visual_sources or visual_sources,
        groups=groups,
        section_pages=manifest.section_pages,
    )


def _copy_led_slide_plans(
    deck: Deck,
    *,
    text_sources: list[DeckSourceItem],
    visual_sources: list[DeckSourceItem],
) -> list[_DeckSlidePlan]:
    shared_text_refs = [item.source_item_id for item in text_sources] or [
        item.source_item_id for item in visual_sources[:1]
    ]
    visual_ref = visual_sources[0].source_item_id if visual_sources else None
    plans: list[_DeckSlidePlan] = []
    last_index = max(0, len(deck.slides) - 1)
    for index, slide in enumerate(deck.slides):
        page_type = "cover" if index == 0 else "summary" if index == last_index and len(deck.slides) > 1 else "copy"
        source_ref_ids = shared_text_refs
        material_hint = visual_sources[min(index, len(visual_sources) - 1)].summary if visual_sources else None
        if visual_ref and visual_ref not in source_ref_ids:
            source_ref_ids = [*source_ref_ids, visual_ref]
        plans.append(
            _DeckSlidePlan(
                page_type=page_type,
                title=slide.title,
                source_ref_ids=source_ref_ids,
                material_hint=material_hint,
                caption_source="copy_summary" if text_sources else "visual_summary",
            )
        )
    return plans


def _visual_slide_plans(
    deck: Deck,
    *,
    text_sources: list[DeckSourceItem],
    visual_sources: list[DeckSourceItem],
    primary_visual_sources: list[DeckSourceItem],
    groups: list[_DeckPlanningGroup],
    section_pages: bool,
) -> list[_DeckSlidePlan]:
    primary_text_refs = [item.source_item_id for item in text_sources]
    plans: list[_DeckSlidePlan] = []
    last_index = max(0, len(deck.slides) - 1)
    primary_visual_sources = primary_visual_sources or visual_sources
    body_blueprints: list[tuple[str, _DeckPlanningGroup | None, DeckSourceItem | None]] = []
    if groups:
        for group in groups:
            group_primary_visual_sources = [
                item
                for item in group.visual_sources
                if item.source_item_id in {source.source_item_id for source in primary_visual_sources}
            ]
            if not group_primary_visual_sources and group.visual_sources:
                group_primary_visual_sources = [group.visual_sources[0]]
            if section_pages and group_primary_visual_sources:
                body_blueprints.append(("section", group, group_primary_visual_sources[0]))
            for visual_source in group_primary_visual_sources:
                body_blueprints.append(("image", group, visual_source))
    elif primary_visual_sources:
        for visual_source in primary_visual_sources:
            body_blueprints.append(("image", None, visual_source))
    visual_index = 0
    for index, slide in enumerate(deck.slides):
        if index == 0:
            cover_visual = primary_visual_sources[0] if primary_visual_sources else None
            plans.append(
                _DeckSlidePlan(
                    page_type="cover",
                    title=slide.title,
                    source_ref_ids=primary_text_refs or ([cover_visual.source_item_id] if cover_visual else []),
                    material_hint=cover_visual.summary if cover_visual else None,
                    caption_source="copy_summary" if text_sources else "visual_summary",
                )
            )
            continue
        if index == last_index and len(deck.slides) > 1:
            summary_visual = primary_visual_sources[-1] if primary_visual_sources else None
            plans.append(
                _DeckSlidePlan(
                    page_type="summary",
                    title=slide.title,
                    source_ref_ids=primary_text_refs or ([summary_visual.source_item_id] if summary_visual else []),
                    material_hint=summary_visual.summary if summary_visual else None,
                    caption_source="copy_summary" if text_sources else "visual_summary",
                )
            )
            continue
        blueprint = body_blueprints[min(visual_index, len(body_blueprints) - 1)] if body_blueprints else None
        if blueprint is None:
            fallback_visual = primary_visual_sources[min(visual_index, len(primary_visual_sources) - 1)]
            plans.append(
                _DeckSlidePlan(
                    page_type="image",
                    title=slide.title,
                    source_ref_ids=_unique_preserving_order([fallback_visual.source_item_id, *primary_text_refs]),
                    group_id=fallback_visual.group_id,
                    material_hint=fallback_visual.summary,
                    caption_source="copy_summary" if text_sources else "visual_summary",
                )
            )
            visual_index += 1
            continue
        page_type, group, visual_source = blueprint
        if page_type == "section":
            section_text_sources = group.text_sources if group else []
            source_ref_ids = _unique_preserving_order(
                [
                    *(item.source_item_id for item in section_text_sources),
                    *primary_text_refs,
                    *( [visual_source.source_item_id] if visual_source else [] ),
                ]
            )
            plans.append(
                _DeckSlidePlan(
                    page_type="section",
                    title=slide.title,
                    source_ref_ids=source_ref_ids,
                    group_id=group.group_key if group else None,
                    group_label=group.label if group else None,
                    material_hint=visual_source.summary if visual_source else group.label if group else None,
                    caption_source="copy_summary" if source_ref_ids else "visual_summary",
                )
            )
        else:
            source_ref_ids = _unique_preserving_order(
                [
                    visual_source.source_item_id if visual_source else "",
                    *(item.source_item_id for item in group.text_sources if group),
                    *primary_text_refs,
                ]
            )
            plans.append(
                _DeckSlidePlan(
                    page_type="image",
                    title=slide.title,
                    source_ref_ids=[item for item in source_ref_ids if item],
                    group_id=visual_source.group_id if visual_source else group.group_key if group else None,
                    group_label=group.label if group else None,
                    material_hint=visual_source.summary if visual_source else None,
                    caption_source="copy_summary" if text_sources else "visual_summary",
                )
            )
        visual_index += 1
    return plans


class _DeckSourceCollector:
    def __init__(
        self,
        session: Session,
        workflow: InspirationWorkflow,
        *,
        excluded_source_item_ids: set[str],
    ) -> None:
        self.session = session
        self.workflow = workflow
        self.queries = WorkflowQueryService(session)
        self.excluded_source_item_ids = excluded_source_item_ids
        self.available_sources: list[DeckSourceItem] = []
        self.unavailable_sources: list[DeckUnavailableSource] = []
        self._available_ids: set[str] = set()
        self._unavailable_ids: set[str] = set()

    def collect_node(self, node: WorkflowNode, *, tail_context: _TailContext | None = None) -> None:
        if node.node_type not in DECK_SOURCE_SUPPORTED_NODE_TYPES:
            self._add_node_unavailable(
                node,
                reason=SOURCE_UNAVAILABLE_UNSUPPORTED_NODE_TYPE,
                kind="node",
                tail_context=tail_context,
            )
            return
        if node.node_type == WorkflowNodeType.INSPIRATION_CONTEXT:
            self._collect_inspiration_context(node, tail_context=tail_context)
            return
        if node.status != WorkflowNodeStatus.SUCCEEDED:
            self._add_node_unavailable(
                node,
                reason=SOURCE_UNAVAILABLE_NODE_NOT_SUCCEEDED,
                kind=_default_kind_for_node_type(node.node_type),
                tail_context=tail_context,
            )
            return
        if node.node_type == WorkflowNodeType.COPY_GENERATION:
            self._collect_copy(node, tail_context=tail_context)
            return
        if node.node_type == WorkflowNodeType.REFERENCE_IMAGE:
            self._collect_reference_images(node, tail_context=tail_context)
            return
        if node.node_type == WorkflowNodeType.IMAGE_GENERATION:
            self._collect_generated_images(node, tail_context=tail_context)
            return
        if node.node_type == WorkflowNodeType.TAIL_SPLITTER:
            self._collect_tail_splitter(node)

    def _collect_inspiration_context(self, node: WorkflowNode, *, tail_context: _TailContext | None) -> None:
        context = inspiration_context_values(self.workflow.inspiration, node, workflow=self.workflow)
        summary_parts = [
            _optional_text(context.get("name")),
            _optional_text(context.get("long_text")),
            _optional_text(context.get("source_note")),
        ]
        dynamic_fields = context.get("dynamic_fields")
        if isinstance(dynamic_fields, dict) and dynamic_fields:
            summary_parts.append(
                "；".join(f"{key}: {value}" for key, value in dynamic_fields.items() if value is not None)
            )
        summary = _clip_text(" | ".join(part for part in summary_parts if part), max_length=_SUMMARY_TEXT_LIMIT)
        source_asset_id = _optional_text(context.get("image_source_asset_id"))
        self._add_available(
            DeckSourceItem(
                source_item_id=_context_source_item_id(node, tail_context=tail_context),
                workflow_node_id=node.id,
                workflow_node_title=node.title,
                workflow_node_type=node.node_type.value,
                kind="context",
                group_id=_group_id(node, tail_context=tail_context),
                selected=True,
                summary=summary or "灵感产物上下文",
                source_asset_id=source_asset_id,
                tail_batch_id=tail_context.batch_id if tail_context else None,
                tail_item_id=tail_context.item_id if tail_context else None,
            )
        )

    def _collect_copy(self, node: WorkflowNode, *, tail_context: _TailContext | None) -> None:
        output = _output_dict(node)
        copy_set_id = _optional_text(output.get("copy_set_id"))
        if copy_set_id is None:
            self._add_node_unavailable(
                node,
                reason=SOURCE_UNAVAILABLE_MISSING_COPY_SET,
                kind="copy",
                tail_context=tail_context,
            )
            return
        copy_set = self.queries.copy_set_for_inspiration(copy_set_id, self.workflow.inspiration_id)
        if copy_set is None:
            self._add_unavailable(
                node,
                reason=SOURCE_UNAVAILABLE_MISSING_COPY_SET,
                kind="copy",
                source_item_id=_copy_source_item_id(node, copy_set_id, tail_context=tail_context),
                copy_set_id=copy_set_id,
                tail_context=tail_context,
            )
            return
        self._add_available(
            DeckSourceItem(
                source_item_id=_copy_source_item_id(node, copy_set.id, tail_context=tail_context),
                workflow_node_id=node.id,
                workflow_node_title=node.title,
                workflow_node_type=node.node_type.value,
                kind="copy",
                group_id=_group_id(node, tail_context=tail_context),
                selected=True,
                summary=_copy_set_summary(copy_set, fallback=_optional_text(output.get("summary"))),
                copy_set_id=copy_set.id,
                tail_batch_id=tail_context.batch_id if tail_context else None,
                tail_item_id=tail_context.item_id if tail_context else None,
            )
        )

    def _collect_reference_images(self, node: WorkflowNode, *, tail_context: _TailContext | None) -> None:
        asset_ids = _unique_strings(
            [
                *source_asset_ids_from_config(node.output_json or {}),
                *source_asset_ids_from_config(node.config_json or {}),
            ]
        )
        if not asset_ids:
            self._add_node_unavailable(
                node,
                reason=SOURCE_UNAVAILABLE_EMPTY_OUTPUT,
                kind="source_asset",
                tail_context=tail_context,
            )
            return
        for asset_id in asset_ids:
            self._collect_source_asset(node, asset_id, tail_context=tail_context)

    def _collect_generated_images(self, node: WorkflowNode, *, tail_context: _TailContext | None) -> None:
        output = _output_dict(node)
        poster_ids = _poster_ids_from_output(output)
        copy_set_id = _optional_text(output.get("copy_set_id"))
        collected = False
        for poster_id in poster_ids:
            collected = True
            self._collect_poster_variant(node, poster_id, copy_set_id=copy_set_id, tail_context=tail_context)

        if not poster_ids:
            asset_ids = _unique_strings(
                [
                    *source_asset_ids_from_config(output),
                    *[item for item in output.get("filled_source_asset_ids", []) if isinstance(item, str)],
                ]
            )
            for asset_id in asset_ids:
                collected = True
                self._collect_source_asset(node, asset_id, tail_context=tail_context)
        if not collected:
            self._add_node_unavailable(
                node,
                reason=SOURCE_UNAVAILABLE_EMPTY_OUTPUT,
                kind="poster",
                tail_context=tail_context,
            )

    def _collect_tail_splitter(self, node: WorkflowNode) -> None:
        output = read_tail_splitter_output(node.output_json)
        latest_plan = output.latest_plan
        collected = False
        if latest_plan is not None:
            collected = True
            self._add_available(
                DeckSourceItem(
                    source_item_id=f"node:{node.id}:tail_plan:{latest_plan.plan_id}",
                    workflow_node_id=node.id,
                    workflow_node_title=node.title,
                    workflow_node_type=node.node_type.value,
                    kind="tail_plan",
                    group_id=f"node:{node.id}",
                    selected=True,
                    summary=_clip_text(
                        f"{latest_plan.source_summary}；"
                        f"{'；'.join(f'{item.title}: {item.visual_intent}' for item in latest_plan.items)}",
                        max_length=_SUMMARY_TEXT_LIMIT,
                    ),
                )
            )
        nodes_by_id = {item.id: item for item in self.workflow.nodes}
        for batch in output.applied_batches:
            collected = True
            for child_node_id in batch.node_ids:
                child = nodes_by_id.get(child_node_id)
                if child is None:
                    continue
                self.collect_node(
                    child,
                    tail_context=_TailContext(
                        tail_node_id=node.id,
                        batch_id=batch.batch_id,
                        item_id=_tail_item_id(child),
                    ),
                )
        if not collected:
            self._add_node_unavailable(
                node,
                reason=SOURCE_UNAVAILABLE_EMPTY_OUTPUT,
                kind="tail_plan",
                tail_context=None,
            )

    def _collect_source_asset(
        self,
        node: WorkflowNode,
        source_asset_id: str,
        *,
        tail_context: _TailContext | None,
    ) -> None:
        asset = self.session.get(SourceAsset, source_asset_id)
        source_item_id = _asset_source_item_id(node, source_asset_id, tail_context=tail_context)
        if (
            asset is None
            or asset.inspiration_id != self.workflow.inspiration_id
            or asset.kind != SourceAssetKind.REFERENCE_IMAGE
        ):
            self._add_unavailable(
                node,
                reason=SOURCE_UNAVAILABLE_MISSING_SOURCE_ASSET,
                kind="source_asset",
                source_item_id=source_item_id,
                source_asset_id=source_asset_id,
                tail_context=tail_context,
            )
            return
        if not asset.enabled:
            self._add_unavailable(
                node,
                reason=SOURCE_UNAVAILABLE_DISABLED_SOURCE_ASSET,
                kind="source_asset",
                source_item_id=source_item_id,
                source_asset_id=asset.id,
                summary=asset.disabled_reason,
                tail_context=tail_context,
            )
            return
        self._add_available(
            DeckSourceItem(
                source_item_id=source_item_id,
                workflow_node_id=node.id,
                workflow_node_title=node.title,
                workflow_node_type=node.node_type.value,
                kind="source_asset",
                group_id=_group_id(node, tail_context=tail_context),
                selected=True,
                summary=_asset_summary(asset),
                source_asset_id=asset.id,
                tail_batch_id=tail_context.batch_id if tail_context else None,
                tail_item_id=tail_context.item_id if tail_context else None,
            )
        )

    def _collect_poster_variant(
        self,
        node: WorkflowNode,
        poster_variant_id: str,
        *,
        copy_set_id: str | None,
        tail_context: _TailContext | None,
    ) -> None:
        poster = self.session.get(PosterVariant, poster_variant_id)
        source_item_id = _poster_source_item_id(node, poster_variant_id, tail_context=tail_context)
        if poster is None or poster.inspiration_id != self.workflow.inspiration_id:
            self._add_unavailable(
                node,
                reason=SOURCE_UNAVAILABLE_MISSING_POSTER_VARIANT,
                kind="poster",
                source_item_id=source_item_id,
                copy_set_id=copy_set_id,
                poster_variant_id=poster_variant_id,
                tail_context=tail_context,
            )
            return
        if not poster.enabled:
            self._add_unavailable(
                node,
                reason=SOURCE_UNAVAILABLE_DISABLED_POSTER_VARIANT,
                kind="poster",
                source_item_id=source_item_id,
                copy_set_id=copy_set_id or poster.copy_set_id,
                poster_variant_id=poster.id,
                summary=poster.disabled_reason,
                tail_context=tail_context,
            )
            return
        asset = lookup_source_asset_for_poster_variant(
            self.session,
            workflow=self.workflow,
            poster_variant_id=poster.id,
        )
        if asset is not None and not asset.enabled:
            self._add_unavailable(
                node,
                reason=SOURCE_UNAVAILABLE_DISABLED_SOURCE_ASSET,
                kind="poster",
                source_item_id=source_item_id,
                copy_set_id=copy_set_id or poster.copy_set_id,
                source_asset_id=asset.id,
                poster_variant_id=poster.id,
                summary=asset.disabled_reason,
                tail_context=tail_context,
            )
            return
        self._add_available(
            DeckSourceItem(
                source_item_id=source_item_id,
                workflow_node_id=node.id,
                workflow_node_title=node.title,
                workflow_node_type=node.node_type.value,
                kind="poster",
                group_id=_group_id(node, tail_context=tail_context),
                selected=True,
                summary=_poster_summary(poster),
                copy_set_id=copy_set_id or poster.copy_set_id,
                source_asset_id=asset.id if asset is not None else None,
                poster_variant_id=poster.id,
                tail_batch_id=tail_context.batch_id if tail_context else None,
                tail_item_id=tail_context.item_id if tail_context else None,
            )
        )

    def _add_available(self, item: DeckSourceItem) -> None:
        if item.source_item_id in self._available_ids:
            return
        self._available_ids.add(item.source_item_id)
        self.available_sources.append(
            DeckSourceItem(
                source_item_id=item.source_item_id,
                workflow_node_id=item.workflow_node_id,
                workflow_node_title=item.workflow_node_title,
                workflow_node_type=item.workflow_node_type,
                kind=item.kind,
                group_id=item.group_id,
                selected=item.source_item_id not in self.excluded_source_item_ids,
                summary=item.summary,
                copy_set_id=item.copy_set_id,
                source_asset_id=item.source_asset_id,
                poster_variant_id=item.poster_variant_id,
                tail_batch_id=item.tail_batch_id,
                tail_item_id=item.tail_item_id,
            )
        )

    def _add_node_unavailable(
        self,
        node: WorkflowNode,
        *,
        reason: str,
        kind: str | None,
        tail_context: _TailContext | None,
    ) -> None:
        source_item_id = _node_unavailable_source_item_id(node, reason=reason, tail_context=tail_context)
        self._add_unavailable(
            node,
            reason=reason,
            kind=kind,
            source_item_id=source_item_id,
            tail_context=tail_context,
        )

    def _add_unavailable(
        self,
        node: WorkflowNode,
        *,
        reason: str,
        kind: str | None,
        source_item_id: str,
        tail_context: _TailContext | None,
        summary: str | None = None,
        copy_set_id: str | None = None,
        source_asset_id: str | None = None,
        poster_variant_id: str | None = None,
    ) -> None:
        if source_item_id in self._unavailable_ids:
            return
        self._unavailable_ids.add(source_item_id)
        self.unavailable_sources.append(
            DeckUnavailableSource(
                source_item_id=source_item_id,
                workflow_node_id=node.id,
                workflow_node_title=node.title,
                workflow_node_type=node.node_type.value,
                reason=reason,
                kind=kind,
                summary=summary,
                copy_set_id=copy_set_id,
                source_asset_id=source_asset_id,
                poster_variant_id=poster_variant_id,
                tail_batch_id=tail_context.batch_id if tail_context else None,
                tail_item_id=tail_context.item_id if tail_context else None,
            )
        )


def _upstream_source_nodes(
    workflow: InspirationWorkflow,
    target_node_id: str,
    *,
    include_transitive: bool,
) -> list[WorkflowNode]:
    ordered_edges = sorted(workflow.edges, key=lambda item: (item.created_at, item.id))
    incoming_by_target: dict[str, list[str]] = {}
    for edge in ordered_edges:
        incoming_by_target.setdefault(edge.target_node_id, []).append(edge.source_node_id)

    nodes_by_id = {node.id: node for node in workflow.nodes}
    queue = list(dict.fromkeys(incoming_by_target.get(target_node_id, [])))
    seen: set[str] = set()
    source_nodes: list[WorkflowNode] = []
    while queue:
        node_id = queue.pop(0)
        if node_id in seen or node_id == target_node_id:
            continue
        seen.add(node_id)
        node = nodes_by_id.get(node_id)
        if node is not None:
            source_nodes.append(node)
        if include_transitive:
            queue.extend(incoming_by_target.get(node_id, []))
    return source_nodes


def _source_fingerprint(
    available_sources: list[DeckSourceItem],
    unavailable_sources: list[DeckUnavailableSource],
) -> str:
    payload = [
        item.fingerprint_payload(available=True)
        for item in available_sources
        if item.source_item_id not in {source.source_item_id for source in unavailable_sources}
    ]
    payload.extend(item.fingerprint_payload() for item in unavailable_sources)
    payload.sort(key=lambda item: item["source_item_id"])
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _build_model_summary(available_sources: list[DeckSourceItem]) -> str:
    selected_sources = [item for item in available_sources if item.selected]
    if not selected_sources:
        return "暂无可用于演示生成的画布来源。"
    lines = []
    for item in selected_sources[:_MODEL_SUMMARY_ITEM_LIMIT]:
        summary = f"：{item.summary}" if item.summary else ""
        lines.append(f"- {item.workflow_node_title} / {item.kind} / {item.source_item_id}{summary}")
    if len(selected_sources) > _MODEL_SUMMARY_ITEM_LIMIT:
        lines.append(f"- 另有 {len(selected_sources) - _MODEL_SUMMARY_ITEM_LIMIT} 个来源未展开")
    return "\n".join(lines)


def _build_planning_summary(
    available_sources: list[DeckSourceItem],
    *,
    planning_strategy: str,
    slide_count_mode: str,
    target_slide_count: int | None,
    group_by: Any,
    section_pages: Any,
    per_group_image_cap: int | None,
) -> _DeckPlanningSummary:
    selected_sources = [item for item in available_sources if item.selected]
    if not selected_sources:
        return _DeckPlanningSummary(
            planning_strategy=planning_strategy,
            slide_count_mode=slide_count_mode,
            target_slide_count=target_slide_count,
            group_by="source_node",
            section_pages=False,
            per_group_image_cap=0,
            primary_visual_source_ids=set(),
            overflow_visual_source_ids=set(),
            groups=[],
            summary_text="暂无可用于演示生成的画布来源。",
        )

    effective_group_by = _normalized_group_by(group_by, selected_sources=selected_sources)
    groups = _build_planning_groups(selected_sources, group_by=effective_group_by)
    effective_section_pages = _normalized_section_pages(
        section_pages,
        group_count=len(groups),
        planning_strategy=planning_strategy,
    )
    effective_cap = _effective_per_group_image_cap(
        groups,
        planning_strategy=planning_strategy,
        slide_count_mode=slide_count_mode,
        target_slide_count=target_slide_count,
        section_pages=effective_section_pages,
        explicit_per_group_image_cap=per_group_image_cap,
    )
    primary_visual_source_ids, overflow_visual_source_ids = _primary_and_overflow_visual_source_ids(
        groups,
        per_group_image_cap=effective_cap,
        planning_strategy=planning_strategy,
    )
    summary_text = _planning_summary_text(
        selected_sources,
        groups=groups,
        planning_strategy=planning_strategy,
        slide_count_mode=slide_count_mode,
        target_slide_count=target_slide_count,
        group_by=effective_group_by,
        section_pages=effective_section_pages,
        per_group_image_cap=effective_cap,
        primary_visual_source_ids=primary_visual_source_ids,
        overflow_visual_source_ids=overflow_visual_source_ids,
    )
    return _DeckPlanningSummary(
        planning_strategy=planning_strategy,
        slide_count_mode=slide_count_mode,
        target_slide_count=target_slide_count,
        group_by=effective_group_by,
        section_pages=effective_section_pages,
        per_group_image_cap=effective_cap,
        primary_visual_source_ids=primary_visual_source_ids,
        overflow_visual_source_ids=overflow_visual_source_ids,
        groups=groups,
        summary_text=summary_text,
    )


def _planning_summary_text(
    selected_sources: list[DeckSourceItem],
    *,
    groups: list[_DeckPlanningGroup],
    planning_strategy: str,
    slide_count_mode: str,
    target_slide_count: int | None,
    group_by: str,
    section_pages: bool,
    per_group_image_cap: int,
    primary_visual_source_ids: set[str],
    overflow_visual_source_ids: set[str],
) -> str:
    lines = [
        "规划草案：",
        f"- 策略：{_planning_strategy_label(planning_strategy)}",
        f"- 页数模式：{_slide_count_mode_label(slide_count_mode, target_slide_count=target_slide_count)}",
    ]
    text_sources = [item for item in selected_sources if not _is_visual_source(item)]
    visual_sources = [item for item in selected_sources if _is_visual_source(item)]

    if planning_strategy == "copy_led":
        lines.append(f"- 主线文案来源：{_source_reference_summary(text_sources)}")
        if visual_sources:
            lines.append(f"- 辅助图片来源：{_source_reference_summary(visual_sources)}")
    else:
        lines.append(
            f"- 主体分组：{group_by}，共 {len(groups)} 组，分节页：{'开启' if section_pages else '关闭'}，"
            f"每组代表图上限：{per_group_image_cap}"
        )
        if planning_strategy == "hybrid":
            lines.append(f"- 首尾文案主线：{_source_reference_summary(text_sources)}")
        elif text_sources:
            lines.append(f"- 配文种子来源：{_source_reference_summary(text_sources)}")
        lines.append("- 中段图片主线：")
        if not groups:
            lines.append("  - 当前没有可直接编排的图片来源")
        for group in groups[:_PLANNING_GROUP_ITEM_LIMIT]:
            primary_sources = [
                item for item in group.visual_sources if item.source_item_id in primary_visual_source_ids
            ]
            overflow_sources = [
                item for item in group.visual_sources if item.source_item_id in overflow_visual_source_ids
            ]
            caption_seed = _source_reference_summary(group.text_sources or text_sources, limit=2)
            lines.append(
                f"  - {group.label}：主线 {len(primary_sources)} 张"
                + (
                    f" [{', '.join(item.source_item_id for item in primary_sources)}]"
                    if primary_sources
                    else ""
                )
                + (f"；配文种子：{caption_seed}" if caption_seed else "")
            )
            if overflow_sources:
                lines.append(
                    f"    备选 {len(overflow_sources)} 张"
                    f" [{', '.join(item.source_item_id for item in overflow_sources)}]"
                )
        if len(groups) > _PLANNING_GROUP_ITEM_LIMIT:
            lines.append(f"  - 另有 {len(groups) - _PLANNING_GROUP_ITEM_LIMIT} 组未展开")
        if overflow_visual_source_ids:
            lines.append(f"- 备选图片：{len(overflow_visual_source_ids)} 张，可在编辑器中手动加入")

    ordered_sources = _ordered_sources_for_planning(
        selected_sources,
        planning_strategy=planning_strategy,
        primary_visual_source_ids=primary_visual_source_ids,
        overflow_visual_source_ids=overflow_visual_source_ids,
    )
    lines.append("")
    lines.append("来源清单：")
    lines.append(_build_model_summary(ordered_sources))
    return "\n".join(lines)


def _build_planning_groups(
    selected_sources: list[DeckSourceItem],
    *,
    group_by: str,
) -> list[_DeckPlanningGroup]:
    visual_sources = [item for item in selected_sources if _is_visual_source(item)]
    text_sources = [item for item in selected_sources if not _is_visual_source(item)]
    text_sources_by_group: dict[str, list[DeckSourceItem]] = {}
    for item in text_sources:
        text_sources_by_group.setdefault(_planning_group_key(item, group_by=group_by), []).append(item)

    groups: list[_DeckPlanningGroup] = []
    visual_sources_by_group: dict[str, list[DeckSourceItem]] = {}
    for item in visual_sources:
        visual_sources_by_group.setdefault(_planning_group_key(item, group_by=group_by), []).append(item)
    for group_key, grouped_visual_sources in visual_sources_by_group.items():
        groups.append(
            _DeckPlanningGroup(
                group_key=group_key,
                label=_planning_group_label(group_key, grouped_visual_sources),
                visual_sources=grouped_visual_sources,
                text_sources=text_sources_by_group.get(group_key, []),
            )
        )
    return groups


def _effective_per_group_image_cap(
    groups: list[_DeckPlanningGroup],
    *,
    planning_strategy: str,
    slide_count_mode: str,
    target_slide_count: int | None,
    section_pages: bool,
    explicit_per_group_image_cap: int | None,
) -> int:
    if not groups:
        return 0
    if explicit_per_group_image_cap is not None:
        return max(1, explicit_per_group_image_cap)
    if slide_count_mode != "target" or target_slide_count is None:
        return max(len(group.visual_sources) for group in groups)
    section_page_count = len(groups) if section_pages and planning_strategy in {"hybrid", "image_led"} else 0
    remaining = target_slide_count - _DEFAULT_SURROUNDING_PAGE_COUNT - section_page_count
    if remaining <= 0:
        return 1
    return max(1, remaining // max(1, len(groups)))


def _primary_and_overflow_visual_source_ids(
    groups: list[_DeckPlanningGroup],
    *,
    per_group_image_cap: int,
    planning_strategy: str,
) -> tuple[set[str], set[str]]:
    primary_visual_source_ids: set[str] = set()
    overflow_visual_source_ids: set[str] = set()
    if planning_strategy == "copy_led":
        return primary_visual_source_ids, {
            item.source_item_id for group in groups for item in group.visual_sources
        }
    for group in groups:
        for item in group.visual_sources[:per_group_image_cap]:
            primary_visual_source_ids.add(item.source_item_id)
        for item in group.visual_sources[per_group_image_cap:]:
            overflow_visual_source_ids.add(item.source_item_id)
    return primary_visual_source_ids, overflow_visual_source_ids


def _ordered_sources_for_planning(
    selected_sources: list[DeckSourceItem],
    *,
    planning_strategy: str,
    primary_visual_source_ids: set[str],
    overflow_visual_source_ids: set[str],
) -> list[DeckSourceItem]:
    def _sort_key(item: DeckSourceItem) -> tuple[int, int, str]:
        if not _is_visual_source(item):
            base_rank = 0 if planning_strategy in {"copy_led", "hybrid"} else 1
            return (base_rank, 0, item.source_item_id)
        if item.source_item_id in primary_visual_source_ids:
            return (1 if planning_strategy == "hybrid" else 0, 0, item.source_item_id)
        if item.source_item_id in overflow_visual_source_ids:
            return (2, 1, item.source_item_id)
        return (1, 1, item.source_item_id)

    return sorted(selected_sources, key=_sort_key)


def _apply_planning_roles(
    available_sources: list[DeckSourceItem],
    *,
    planning: _DeckPlanningSummary,
) -> list[DeckSourceItem]:
    primary_ids = planning.primary_visual_source_ids
    alternate_ids = planning.overflow_visual_source_ids
    updated_sources: list[DeckSourceItem] = []
    for item in available_sources:
        if _is_visual_source(item):
            if item.source_item_id in primary_ids:
                role = "primary"
            elif item.source_item_id in alternate_ids:
                role = "alternate"
            else:
                role = "primary"
        else:
            role = "supporting"
        updated_sources.append(replace(item, planning_role=role))
    return updated_sources


def _planning_group_summaries(
    groups: list[_DeckPlanningGroup],
    *,
    primary_visual_source_ids: set[str],
    overflow_visual_source_ids: set[str],
) -> list[dict[str, Any]]:
    summaries: list[dict[str, Any]] = []
    for group in groups:
        summaries.append(
            {
                "group_id": group.group_key,
                "label": group.label,
                "text_source_item_ids": [item.source_item_id for item in group.text_sources],
                "primary_visual_source_item_ids": [
                    item.source_item_id
                    for item in group.visual_sources
                    if item.source_item_id in primary_visual_source_ids
                ],
                "alternate_visual_source_item_ids": [
                    item.source_item_id
                    for item in group.visual_sources
                    if item.source_item_id in overflow_visual_source_ids
                ],
            }
        )
    return summaries


def _normalized_group_by(value: Any, *, selected_sources: list[DeckSourceItem]) -> str:
    normalized = _optional_text(value)
    has_tail_items = any(item.tail_item_id for item in selected_sources)
    if normalized == "source_node":
        return "source_node"
    if normalized == "manual":
        return "source_node"
    if normalized == "tail_item" and has_tail_items:
        return "tail_item"
    return "tail_item" if has_tail_items else "source_node"


def _normalized_group_by_value(value: Any) -> str:
    normalized = _optional_text(value)
    if normalized == "source_node":
        return "source_node"
    return "tail_item"


def _normalized_section_pages(value: Any, *, group_count: int, planning_strategy: str) -> bool:
    if planning_strategy == "copy_led" or group_count <= 1:
        return False
    if isinstance(value, bool):
        return value
    return True


def _optional_bool(value: Any) -> bool | None:
    return value if isinstance(value, bool) else None


def _bounded_per_group_image_cap(value: Any) -> int | None:
    number = _positive_int(value)
    if number is None:
        return None
    return max(1, min(12, number))


def _planning_group_key(item: DeckSourceItem, *, group_by: str) -> str:
    if group_by == "tail_item" and item.tail_item_id:
        return f"tail:{item.tail_item_id}"
    return f"node:{item.workflow_node_id}"


def _planning_group_label(group_key: str, items: list[DeckSourceItem]) -> str:
    tail_item_id = next((item.tail_item_id for item in items if item.tail_item_id), None)
    if tail_item_id:
        return f"tail_item:{tail_item_id}"
    return items[0].workflow_node_title if items else group_key


def _planning_strategy_label(value: str) -> str:
    if value == "copy_led":
        return "文案驱动"
    if value == "image_led":
        return "图片驱动"
    return "混合智能"


def _slide_count_mode_label(value: str, *, target_slide_count: int | None) -> str:
    if value == "target" and target_slide_count:
        return f"目标 {target_slide_count} 页"
    return "自动"


def _source_reference_summary(sources: list[DeckSourceItem], *, limit: int = 4) -> str:
    if not sources:
        return "无"
    labels = [
        f"{item.workflow_node_title}({item.source_item_id})"
        for item in sources[:limit]
    ]
    if len(sources) > limit:
        labels.append(f"另有 {len(sources) - limit} 个来源")
    return "；".join(labels)


def _is_visual_source(item: DeckSourceItem) -> bool:
    return item.kind in {"poster", "source_asset"}


def _unique_preserving_order(values: list[str]) -> list[str]:
    return list(dict.fromkeys(value for value in values if isinstance(value, str) and value.strip()))


def _deck_node_output_snapshot(
    *,
    deck_node: WorkflowNode,
    manifest: DeckSourceManifest,
    deck: Deck | None = None,
    last_action: str = "refresh_sources",
) -> dict[str, Any]:
    existing_output = deck_node.output_json if isinstance(deck_node.output_json, dict) else {}
    deck_id = deck.id if deck is not None else _optional_text((deck_node.config_json or {}).get("deck_id"))
    if deck_id is None:
        deck_id = _optional_text(existing_output.get("deck_id"))
    generated_slide_count = (
        _generated_slide_count(deck) if deck is not None else existing_output.get("generated_slide_count")
    )
    return _without_none(
        {
            **existing_output,
            "deck_id": deck_id,
            "deck_title": deck.title if deck is not None else existing_output.get("deck_title"),
            "deck_status": derived_deck_status(deck).value if deck is not None else existing_output.get("deck_status"),
            "slide_count": len(deck.slides) if deck is not None else existing_output.get("slide_count"),
            "generated_slide_count": generated_slide_count,
            "source_fingerprint": manifest.source_fingerprint,
            "source_stale": manifest.source_stale,
            "source_manifest": {
                "workflow_id": manifest.workflow_id,
                "workflow_node_ids": manifest.workflow_node_ids,
                "copy_set_ids": manifest.copy_set_ids,
                "source_asset_ids": manifest.source_asset_ids,
                "poster_variant_ids": manifest.poster_variant_ids,
                "tail_batch_ids": manifest.tail_batch_ids,
                "source_item_ids": sorted(item.source_item_id for item in manifest.available_sources),
            },
            "last_action": last_action,
        }
    )


def _outline_source_input(
    manifest: DeckSourceManifest,
    *,
    deck_title: str | None,
    manual_source_input: str | None,
    planning_strategy: str,
    slide_count_mode: str,
    target_slide_count: int | None,
    slide_context: list[_DeckOutlineContextSlide] | None = None,
) -> str:
    strategy_labels = {
        "hybrid": "混合智能：首尾文案驱动，中间主体优先按图片逐页组织",
        "copy_led": "文案驱动：优先按文案结构组织页面",
        "image_led": "图片驱动：优先按图片成果组织页面",
    }
    parts = [
        f"规划策略：{strategy_labels.get(planning_strategy, strategy_labels['hybrid'])}",
        "页数约束："
        + (
            f"尽量控制在 {target_slide_count} 页左右"
            if slide_count_mode == "target" and target_slide_count
            else "允许按素材自动决定页数"
        ),
        manifest.model_summary,
    ]
    normalized_title = _optional_text(deck_title)
    if normalized_title:
        parts.append(f"用户预设演示标题：{normalized_title}")
    normalized_manual = _optional_text(manual_source_input)
    if normalized_manual:
        parts.append(f"用户补充：{normalized_manual}")
    outline_context_summary = _outline_slide_context_summary(slide_context or [])
    if outline_context_summary:
        parts.append(outline_context_summary)
    return "\n\n".join(parts)


def _normalized_outline_slide_context(
    raw_slide_context: list[dict[str, Any]] | None,
    *,
    fallback_deck: Deck | None,
) -> list[_DeckOutlineContextSlide]:
    slides: list[_DeckOutlineContextSlide] = []
    if raw_slide_context:
        for item in raw_slide_context:
            if not isinstance(item, dict):
                continue
            title = _optional_text(item.get("title"))
            points = (
                [_optional_text(point) for point in item.get("points", [])]
                if isinstance(item.get("points"), list)
                else []
            )
            normalized_points = [point for point in points if point]
            if not title and not normalized_points:
                continue
            slides.append(
                _DeckOutlineContextSlide(
                    title=title or "未命名页面",
                    points=normalized_points,
                )
            )
    if slides or fallback_deck is None:
        return slides
    for slide in fallback_deck.slides:
        title = _optional_text(slide.title)
        points = [_optional_text(point) for point in (slide.points_json or [])]
        normalized_points = [point for point in points if point]
        if not title and not normalized_points:
            continue
        slides.append(
            _DeckOutlineContextSlide(
                title=title or "未命名页面",
                points=normalized_points,
            )
        )
    return slides


def _outline_slide_context_summary(slide_context: list[_DeckOutlineContextSlide]) -> str | None:
    if not slide_context:
        return None
    lines = ["当前演示草稿（供本次重新生成参考）："]
    for index, slide in enumerate(slide_context[:12], start=1):
        points_text = "；".join(slide.points[:4]) if slide.points else ""
        lines.append(
            f"- 第 {index} 页《{slide.title}》"
            + (f"：{points_text}" if points_text else "")
        )
    if len(slide_context) > 12:
        lines.append(f"- 另有 {len(slide_context) - 12} 页未展开")
    return "\n".join(lines)


def _normalized_planning_strategy(value: Any) -> str:
    normalized = _optional_text(value)
    if normalized in {"copy_led", "image_led"}:
        return normalized
    return "hybrid"


def _normalized_slide_count_mode(value: Any) -> str:
    normalized = _optional_text(value)
    if normalized == "target":
        return "target"
    return "auto"


def _positive_int(value: Any) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _generated_slide_count(deck: Deck) -> int:
    return sum(1 for slide in deck.slides if slide.image_storage_path)


def _collect_item_id_prefix(kind: str, backing_id: str, *, tail_context: _TailContext | None) -> str | None:
    if tail_context is not None and tail_context.item_id:
        return f"tail:{tail_context.item_id}:{kind}:{backing_id}"
    return None


def _context_source_item_id(node: WorkflowNode, *, tail_context: _TailContext | None) -> str:
    if tail_context is not None and tail_context.item_id:
        return f"tail:{tail_context.item_id}:context:{node.id}"
    return f"node:{node.id}:context"


def _copy_source_item_id(node: WorkflowNode, copy_set_id: str, *, tail_context: _TailContext | None) -> str:
    return (
        _collect_item_id_prefix("copy", copy_set_id, tail_context=tail_context)
        or f"node:{node.id}:copy:{copy_set_id}"
    )


def _asset_source_item_id(node: WorkflowNode, asset_id: str, *, tail_context: _TailContext | None) -> str:
    return _collect_item_id_prefix("asset", asset_id, tail_context=tail_context) or f"node:{node.id}:asset:{asset_id}"


def _poster_source_item_id(node: WorkflowNode, poster_id: str, *, tail_context: _TailContext | None) -> str:
    return (
        _collect_item_id_prefix("poster", poster_id, tail_context=tail_context)
        or f"node:{node.id}:poster:{poster_id}"
    )


def _node_unavailable_source_item_id(
    node: WorkflowNode,
    *,
    reason: str,
    tail_context: _TailContext | None,
) -> str:
    if tail_context is not None and tail_context.item_id:
        return f"tail:{tail_context.item_id}:node:{node.id}:{reason}"
    return f"node:{node.id}:{reason}"


def _group_id(node: WorkflowNode, *, tail_context: _TailContext | None) -> str:
    if tail_context is not None:
        if tail_context.item_id:
            return f"tail:{tail_context.item_id}"
        return f"tail:{tail_context.tail_node_id}:batch:{tail_context.batch_id}"
    return f"node:{node.id}"


def _tail_item_id(node: WorkflowNode) -> str | None:
    config = node.config_json or {}
    generated_by = config.get("generated_by")
    if isinstance(generated_by, dict):
        item_id = _optional_text(generated_by.get("item_id"))
        if item_id:
            return item_id
    tail_plan_item = config.get("tail_plan_item")
    if isinstance(tail_plan_item, dict):
        return _optional_text(tail_plan_item.get("id"))
    return None


def _poster_ids_from_output(output: dict[str, Any]) -> list[str]:
    raw = output.get("poster_variant_ids")
    if not isinstance(raw, list):
        raw = output.get("generated_poster_variant_ids")
    return _unique_strings(raw if isinstance(raw, list) else [])


def _copy_set_summary(copy_set: CopySet, *, fallback: str | None) -> str | None:
    if isinstance(copy_set.structured_payload, dict):
        try:
            return _clip_text(copy_payload_context_text(normalize_copy_payload(copy_set.structured_payload)))
        except ValueError:
            pass
    return _clip_text(fallback)


def _asset_summary(asset: SourceAsset) -> str:
    return f"{asset.original_filename} ({asset.mime_type})"


def _poster_summary(poster: PosterVariant) -> str:
    return f"{poster.template_name} ({poster.width}x{poster.height}, {poster.mime_type})"


def _default_kind_for_node_type(node_type: WorkflowNodeType) -> str:
    if node_type == WorkflowNodeType.COPY_GENERATION:
        return "copy"
    if node_type == WorkflowNodeType.REFERENCE_IMAGE:
        return "source_asset"
    if node_type == WorkflowNodeType.IMAGE_GENERATION:
        return "poster"
    if node_type == WorkflowNodeType.TAIL_SPLITTER:
        return "tail_plan"
    if node_type == WorkflowNodeType.INSPIRATION_CONTEXT:
        return "context"
    return "node"


def _output_dict(node: WorkflowNode) -> dict[str, Any]:
    return node.output_json if isinstance(node.output_json, dict) else {}


def _unique_strings(raw: list[Any]) -> list[str]:
    return list(dict.fromkeys(item for item in raw if isinstance(item, str) and item.strip()))


_UNMATCHED_SOURCE_ORDER_INDEX = 1_000_000_000


def _deck_source_order_node_token(node_id: str) -> str:
    return f"node:{node_id}"


def _deck_source_order_tail_token(tail_item_id: str) -> str:
    return f"tail:{tail_item_id}"


def _best_source_order_match(
    order_index: dict[str, int],
    *candidates: tuple[str | None, int],
) -> tuple[int, int] | None:
    best_match: tuple[int, int] | None = None
    for candidate, specificity in candidates:
        if candidate is None or candidate not in order_index:
            continue
        current = (order_index[candidate], specificity)
        if best_match is None or current < best_match:
            best_match = current
    return best_match


def _source_order_rank(
    source_item_id: str,
    workflow_node_id: str,
    tail_item_id: str | None,
    *,
    order_index: dict[str, int],
) -> tuple[int, int]:
    best_match = _best_source_order_match(
        order_index,
        (source_item_id, 0),
        (_deck_source_order_tail_token(tail_item_id) if tail_item_id else None, 1),
        (tail_item_id, 1),
        (_deck_source_order_node_token(workflow_node_id), 2),
        (workflow_node_id, 2),
    )

    return best_match or (_UNMATCHED_SOURCE_ORDER_INDEX, _UNMATCHED_SOURCE_ORDER_INDEX)


def _ordered_deck_source_items(items: list[DeckSourceItem], *, source_order: list[str]) -> list[DeckSourceItem]:
    if not items:
        return items
    order_index = {source_item_id: index for index, source_item_id in enumerate(source_order)}
    return sorted(
        items,
        key=lambda item: (
            *_source_order_rank(
                item.source_item_id,
                item.workflow_node_id,
                item.tail_item_id,
                order_index=order_index,
            ),
            item.workflow_node_title,
            item.source_item_id,
        ),
    )


def _ordered_unavailable_sources(
    items: list[DeckUnavailableSource],
    *,
    source_order: list[str],
) -> list[DeckUnavailableSource]:
    if not items:
        return items
    order_index = {source_item_id: index for index, source_item_id in enumerate(source_order)}
    return sorted(
        items,
        key=lambda item: (
            *_source_order_rank(
                item.source_item_id,
                item.workflow_node_id,
                item.tail_item_id,
                order_index=order_index,
            ),
            item.workflow_node_title,
            item.source_item_id,
        ),
    )


def _string_set(raw: Any) -> set[str]:
    if not isinstance(raw, list):
        return set()
    return {item for item in raw if isinstance(item, str) and item.strip()}


def _optional_text(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _clip_text(value: str | None, *, max_length: int = _SUMMARY_TEXT_LIMIT) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if len(normalized) <= max_length:
        return normalized
    return f"{normalized[: max_length - 1]}…"


def _without_none(payload: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in payload.items() if value is not None}
