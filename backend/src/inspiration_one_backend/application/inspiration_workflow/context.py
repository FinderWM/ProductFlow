from __future__ import annotations

import math
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from inspiration_one_backend.application.contracts import ReferenceImageInput
from inspiration_one_backend.application.copy_payloads import copy_payload_context_text, normalize_copy_payload
from inspiration_one_backend.application.image_generation_core import (
    normalize_image_generation_tool_options,
    unique_image_generation_references,
)
from inspiration_one_backend.config import normalize_image_generation_size
from inspiration_one_backend.domain.enums import (
    PosterKind,
    SourceAssetKind,
    WorkflowNodeType,
)
from inspiration_one_backend.domain.errors import BusinessValidationError
from inspiration_one_backend.infrastructure.db.models import (
    Inspiration,
    InspirationWorkflow,
    PosterVariant,
    SourceAsset,
    WorkflowNode,
)
from inspiration_one_backend.infrastructure.storage import LocalStorage

_UNRESOLVED_PLACEHOLDER_PATTERN = re.compile(r"^\{[A-Za-z_][A-Za-z0-9_]*\}$")
INSPIRATION_CONTEXT_MARKDOWN_TEXT_MAX_LENGTH = 50_000
INSPIRATION_CONTEXT_ENTRY_TYPES = frozenset({"image", "copy", "tail", "blank"})
INSPIRATION_CONTEXT_DYNAMIC_FIELDS_KEY = "dynamic_fields"
DEPRECATED_INSPIRATION_CONTEXT_CONFIG_KEYS = frozenset({"category", "price"})
INSPIRATION_CONTEXT_MARKDOWN_TEXT_FIELD_NAMES = {
    "long_text": "长文案内容",
    "source_note": "备注",
}
INSPIRATION_CONTEXT_TEXT_KEYS = (
    "name",
    "owner_id",
    "long_text",
    "source_note",
    "image_source_asset_id",
    "document_source_asset_id",
    "document_filename",
    "document_mime_type",
    "document_text",
)
REFERENCE_IMAGE_MAX_BYTES = 10 * 1024 * 1024


def find_source_asset(inspiration: Inspiration) -> SourceAsset | None:
    return next((asset for asset in inspiration.source_assets if asset.kind == SourceAssetKind.ORIGINAL_IMAGE), None)


def normalize_inspiration_context_config(config_json: dict[str, Any] | None) -> dict[str, Any]:
    config = dict(config_json or {})
    for key in DEPRECATED_INSPIRATION_CONTEXT_CONFIG_KEYS:
        config.pop(key, None)
    for key in INSPIRATION_CONTEXT_TEXT_KEYS:
        if key in config:
            config[key] = _normalize_nullable_text(
                config.get(key),
                field_name=INSPIRATION_CONTEXT_MARKDOWN_TEXT_FIELD_NAMES.get(key),
                max_length=INSPIRATION_CONTEXT_MARKDOWN_TEXT_MAX_LENGTH
                if key in INSPIRATION_CONTEXT_MARKDOWN_TEXT_FIELD_NAMES
                else None,
            )
    if "entry_type" in config:
        config["entry_type"] = _normalize_inspiration_context_entry_type(config.get("entry_type"), strict=True)
    if "long_text" not in config and "source_note" in config:
        config["long_text"] = config["source_note"]
    if "image_source_asset_id" not in config:
        legacy_image_id = _first_source_asset_id(config)
        if legacy_image_id is not None:
            config["image_source_asset_id"] = legacy_image_id
    config[INSPIRATION_CONTEXT_DYNAMIC_FIELDS_KEY] = normalize_inspiration_context_dynamic_fields(
        config.get(INSPIRATION_CONTEXT_DYNAMIC_FIELDS_KEY, {})
    )
    return config


def normalize_inspiration_context_dynamic_fields(raw: Any) -> dict[str, str | int | float | bool | None]:
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise BusinessValidationError("动态信息必须是 JSON 对象")
    normalized: dict[str, str | int | float | bool | None] = {}
    for key, value in raw.items():
        if not isinstance(key, str) or not key.strip():
            raise BusinessValidationError("动态信息 key 不能为空")
        clean_key = key.strip()
        if isinstance(value, str):
            normalized[clean_key] = value.strip()
            continue
        if isinstance(value, bool) or value is None:
            normalized[clean_key] = value
            continue
        if isinstance(value, int):
            normalized[clean_key] = value
            continue
        if isinstance(value, float) and math.isfinite(value):
            normalized[clean_key] = value
            continue
        raise BusinessValidationError("动态信息只支持字符串、数字、布尔值或 null")
    return normalized


def inspiration_context_values(
    inspiration: Inspiration,
    node: WorkflowNode | None = None,
    *,
    workflow: InspirationWorkflow | None = None,
) -> dict[str, Any]:
    config = normalize_inspiration_context_config(node.config_json if node is not None else {})
    output = node.output_json or {}
    source = find_source_asset(inspiration)
    legacy_source_note = _configured_text(
        config,
        "source_note",
        fallback=_output_text(output, "source_note", fallback=inspiration.source_note),
    )
    long_text = _configured_text(
        config,
        "long_text",
        fallback=_output_text(output, "long_text", fallback=legacy_source_note),
    )
    source_note = legacy_source_note or long_text
    image_source_asset_id = (
        _configured_text(config, "image_source_asset_id")
        or _output_text(output, "image_source_asset_id")
        or _output_text(output, "source_asset_id")
        or (source.id if source is not None else None)
    )
    dynamic_fields = config.get(INSPIRATION_CONTEXT_DYNAMIC_FIELDS_KEY)
    if not dynamic_fields and isinstance(output.get(INSPIRATION_CONTEXT_DYNAMIC_FIELDS_KEY), dict):
        dynamic_fields = normalize_inspiration_context_dynamic_fields(
            output.get(INSPIRATION_CONTEXT_DYNAMIC_FIELDS_KEY)
        )
    return {
        "inspiration_id": inspiration.id,
        "owner_id": _configured_text(
            config,
            "owner_id",
            fallback=_output_text(output, "owner_id", fallback=inspiration.id),
        ),
        "entry_type": _inspiration_context_entry_type(config=config, output=output, workflow=workflow),
        "name": _configured_text(config, "name", fallback=inspiration.name) or inspiration.name,
        "category": None,
        "price": None,
        "source_note": source_note,
        "long_text": long_text or source_note,
        "image_source_asset_id": image_source_asset_id,
        "document_source_asset_id": _configured_text(
            config,
            "document_source_asset_id",
            fallback=_output_text(output, "document_source_asset_id"),
        ),
        "document_filename": _configured_text(
            config,
            "document_filename",
            fallback=_output_text(output, "document_filename"),
        ),
        "document_mime_type": _configured_text(
            config,
            "document_mime_type",
            fallback=_output_text(output, "document_mime_type"),
        ),
        "document_text": _configured_text(config, "document_text", fallback=_output_text(output, "document_text")),
        INSPIRATION_CONTEXT_DYNAMIC_FIELDS_KEY: dynamic_fields or {},
    }


def inspiration_context_output(
    inspiration: Inspiration,
    node: WorkflowNode,
    *,
    workflow: InspirationWorkflow | None = None,
) -> dict[str, Any]:
    context = inspiration_context_values(inspiration, node, workflow=workflow)
    image_source_asset_id = context["image_source_asset_id"]
    source_asset_ids = (
        [image_source_asset_id] if isinstance(image_source_asset_id, str) and image_source_asset_id else []
    )
    return {
        **context,
        "source_asset_id": image_source_asset_id,
        "source_asset_ids": source_asset_ids,
        "summary": "上下文已读取。",
    }


def _empty_inspiration_context() -> dict[str, Any]:
    return {
        "inspiration_id": None,
        "owner_id": None,
        "entry_type": None,
        "name": None,
        "category": None,
        "price": None,
        "source_note": None,
        "long_text": None,
        "image_source_asset_id": None,
        "document_source_asset_id": None,
        "document_filename": None,
        "document_mime_type": None,
        "document_text": None,
        INSPIRATION_CONTEXT_DYNAMIC_FIELDS_KEY: {},
    }


def _direct_source_nodes(workflow: InspirationWorkflow, target_node_id: str) -> list[WorkflowNode]:
    ordered_edges = sorted(
        [edge for edge in workflow.edges if edge.target_node_id == target_node_id],
        key=lambda item: (item.created_at, item.id),
    )
    incoming_sources = list(dict.fromkeys(edge.source_node_id for edge in ordered_edges))
    nodes_by_id = {node.id: node for node in workflow.nodes}
    return [nodes_by_id[source_id] for source_id in incoming_sources if source_id in nodes_by_id]


def _upstream_nodes_of_type(
    workflow: InspirationWorkflow,
    target_node_id: str,
    node_type: WorkflowNodeType,
) -> list[WorkflowNode]:
    ordered_edges = sorted(workflow.edges, key=lambda item: (item.created_at, item.id))
    incoming_by_target: dict[str, list[str]] = {}
    for edge in ordered_edges:
        incoming_by_target.setdefault(edge.target_node_id, []).append(edge.source_node_id)

    nodes_by_id = {node.id: node for node in workflow.nodes}
    queue = list(incoming_by_target.get(target_node_id, []))
    seen: set[str] = set()
    matched: list[WorkflowNode] = []
    while queue:
        source_id = queue.pop(0)
        if source_id in seen:
            continue
        seen.add(source_id)
        source_node = nodes_by_id.get(source_id)
        if source_node is not None and source_node.node_type == node_type:
            matched.append(source_node)
        queue.extend(incoming_by_target.get(source_id, []))
    return matched


def effective_inspiration_context(
    workflow: InspirationWorkflow,
    target_node_id: str,
    *,
    include_transitive: bool = False,
) -> dict[str, Any]:
    incoming_context_nodes = (
        _upstream_nodes_of_type(workflow, target_node_id, WorkflowNodeType.INSPIRATION_CONTEXT)
        if include_transitive
        else [
            node
            for node in _direct_source_nodes(workflow, target_node_id)
            if node.node_type == WorkflowNodeType.INSPIRATION_CONTEXT
        ]
    )
    if not incoming_context_nodes:
        return _empty_inspiration_context()

    inspiration = workflow.inspiration
    node = sorted(incoming_context_nodes, key=lambda item: item.last_run_at or item.updated_at, reverse=True)[0]
    return inspiration_context_values(inspiration, node, workflow=workflow)


def _normalize_nullable_text(
    value: Any,
    *,
    field_name: str | None = None,
    max_length: int | None = None,
) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        normalized = value.strip()
    else:
        normalized = str(value)
    if not normalized:
        return None
    if max_length is not None and len(normalized) > max_length:
        raise BusinessValidationError(f"{field_name or '文本'}不能超过 {max_length} 个字符")
    return normalized


def _normalize_inspiration_context_entry_type(value: Any, *, strict: bool = False) -> str | None:
    if value is None:
        return None
    normalized = value.strip().lower() if isinstance(value, str) else str(value).strip().lower()
    if not normalized:
        return None
    if normalized in INSPIRATION_CONTEXT_ENTRY_TYPES:
        return normalized
    if strict:
        raise BusinessValidationError("上下文入口类型不支持")
    return None


def _inspiration_context_entry_type(
    *,
    config: dict[str, Any],
    output: dict[str, Any],
    workflow: InspirationWorkflow | None,
) -> str:
    return (
        _normalize_inspiration_context_entry_type(config.get("entry_type"))
        or _normalize_inspiration_context_entry_type(getattr(workflow, "initial_entry_mode", None))
        or _normalize_inspiration_context_entry_type(output.get("entry_type"))
        or "image"
    )


def _first_source_asset_id(config: dict[str, Any]) -> str | None:
    raw_ids = config.get("source_asset_ids")
    if isinstance(raw_ids, list):
        return next((item for item in raw_ids if isinstance(item, str) and item.strip()), None)
    if isinstance(raw_ids, str) and raw_ids.strip():
        return raw_ids.strip()
    raw_id = config.get("source_asset_id")
    return raw_id.strip() if isinstance(raw_id, str) and raw_id.strip() else None


def _configured_text(config: dict[str, Any], key: str, *, fallback: str | None = None) -> str | None:
    if key not in config:
        return fallback
    value = config.get(key)
    if value is None:
        return None
    if isinstance(value, str):
        normalized = value.strip()
        if _UNRESOLVED_PLACEHOLDER_PATTERN.fullmatch(normalized):
            return fallback
        return normalized or None
    return str(value)


def _output_text(output: dict[str, Any], key: str, *, fallback: str | None = None) -> str | None:
    value = output.get(key)
    if isinstance(value, str):
        return value.strip() or None
    return fallback


def source_asset_ids_from_config(config: dict[str, Any]) -> list[str]:
    image_source_asset_id = config.get("image_source_asset_id")
    image_source_asset_ids = [image_source_asset_id] if isinstance(image_source_asset_id, str) else []
    raw = config.get("source_asset_ids")
    if isinstance(raw, str):
        return [*image_source_asset_ids, raw]
    if isinstance(raw, list):
        return [*image_source_asset_ids, *[item for item in raw if isinstance(item, str)]]
    single = config.get("source_asset_id")
    return [*image_source_asset_ids, single] if isinstance(single, str) else image_source_asset_ids


def optional_config_text(config: dict[str, Any], key: str) -> str | None:
    value = config.get(key)
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def poster_kind_from_config(config: dict[str, Any]) -> PosterKind:
    raw = config.get("poster_kind")
    if raw is None:
        return PosterKind.MAIN_IMAGE
    try:
        return PosterKind(str(raw))
    except ValueError as exc:
        raise BusinessValidationError("生图节点包含不支持的图片类型") from exc


def image_size_from_config(config: dict[str, Any]) -> str | None:
    raw = config.get("size")
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None
    return normalize_image_generation_size(raw, label="生图尺寸")


def image_tool_options_from_config(config: dict[str, Any]) -> dict[str, Any] | None:
    raw = config.get("tool_options")
    if not isinstance(raw, dict):
        return None
    return normalize_image_generation_tool_options(raw)


class IncomingContext:
    def __init__(self) -> None:
        self.copy_set_id: str | None = None
        self.image_asset_ids: list[str] = []
        self.poster_variant_ids: list[str] = []
        self.text_contexts: list[str] = []
        self.text_sources: list[dict[str, str]] = []

    def append_text(self, *, node: WorkflowNode, label: str, text: str) -> None:
        normalized = text.strip()
        if not normalized or normalized in self.text_contexts:
            return
        self.text_contexts.append(normalized)
        self.text_sources.append(
            {
                "node_id": node.id,
                "node_type": node.node_type.value,
                "node_title": node.title,
                "label": label,
                "text": normalized,
            }
        )


def collect_incoming_context(
    workflow: InspirationWorkflow,
    node_id: str,
    *,
    include_transitive_inspiration_context: bool = False,
) -> IncomingContext:
    context = IncomingContext()
    candidates = _direct_source_nodes(workflow, node_id)
    if include_transitive_inspiration_context:
        candidate_ids = {node.id for node in candidates}
        inspiration_context_ancestors = [
            node
            for node in _upstream_nodes_of_type(workflow, node_id, WorkflowNodeType.INSPIRATION_CONTEXT)
            if node.id not in candidate_ids
        ]
        candidates = [*inspiration_context_ancestors, *candidates]
    for candidate in candidates:
        output = candidate.output_json or {}
        if context.copy_set_id is None and isinstance(output.get("copy_set_id"), str):
            context.copy_set_id = output["copy_set_id"]
        if candidate.node_type in {
            WorkflowNodeType.REFERENCE_IMAGE,
            WorkflowNodeType.IMAGE_GENERATION,
            WorkflowNodeType.IMAGE_ENHANCE,
        }:
            for key in ("source_asset_ids", "image_asset_ids", "reference_asset_ids"):
                raw_ids = output.get(key)
                if isinstance(raw_ids, list):
                    context.image_asset_ids.extend(item for item in raw_ids if isinstance(item, str))
                elif isinstance(raw_ids, str):
                    context.image_asset_ids.append(raw_ids)
            raw_poster_ids = output.get("poster_variant_ids")
            if isinstance(raw_poster_ids, list):
                context.poster_variant_ids.extend(item for item in raw_poster_ids if isinstance(item, str))
            elif isinstance(raw_poster_ids, str):
                context.poster_variant_ids.append(raw_poster_ids)
            raw_images = output.get("images")
            images = raw_images if isinstance(raw_images, list) else []
            for image in images:
                if not isinstance(image, dict):
                    continue
                label = str(image.get("label") or image.get("filename") or candidate.title)
                role = str(image.get("role") or "参考图")
                filename = str(image.get("filename") or "")
                suffix = f"，文件：{filename}" if filename else ""
                context.append_text(node=candidate, label="参考图", text=f"参考图：{label}（角色：{role}{suffix}）")
        if candidate.node_type == WorkflowNodeType.COPY_GENERATION:
            structured_payload = output.get("structured_payload")
            if not isinstance(structured_payload, dict):
                continue
            context.append_text(
                node=candidate,
                label="文案",
                text=copy_payload_context_text(normalize_copy_payload(structured_payload)),
            )
        elif candidate.node_type == WorkflowNodeType.INSPIRATION_CONTEXT:
            inspiration_context = inspiration_context_values(workflow.inspiration, candidate, workflow=workflow)
            inspiration_source_asset_ids = (
                [inspiration_context["image_source_asset_id"]]
                if isinstance(inspiration_context["image_source_asset_id"], str)
                else []
            )
            context.image_asset_ids.extend(item for item in inspiration_source_asset_ids if item)
            inspiration_source_assets = [
                asset for asset in workflow.inspiration.source_assets if asset.id in inspiration_source_asset_ids
            ]
            original_image_assets = [
                asset for asset in inspiration_source_assets if asset.kind == SourceAssetKind.ORIGINAL_IMAGE
            ]
            context_image_assets = [
                asset for asset in inspiration_source_assets if asset.kind == SourceAssetKind.CONTEXT_IMAGE
            ]
            if original_image_assets:
                image_labels = "、".join(asset.original_filename or "灵感产物图" for asset in original_image_assets)
                context.append_text(node=candidate, label="灵感产物图", text=f"灵感产物图：{image_labels}")
            if context_image_assets:
                image_labels = "、".join(asset.original_filename or "上下文图片" for asset in context_image_assets)
                context.append_text(node=candidate, label="上下文图片", text=f"上下文图片：{image_labels}")
            context_parts = [
                f"名称：{inspiration_context['name']}" if inspiration_context["name"] else "",
                f"所属 ID：{inspiration_context['owner_id']}" if inspiration_context["owner_id"] else "",
                f"入口类型：{inspiration_context['entry_type']}" if inspiration_context["entry_type"] else "",
                f"长文案：{inspiration_context['long_text']}" if inspiration_context["long_text"] else "",
                _dynamic_fields_context_text(inspiration_context.get(INSPIRATION_CONTEXT_DYNAMIC_FIELDS_KEY)),
            ]
            context.append_text(
                node=candidate,
                label="上下文",
                text="；".join(part for part in context_parts if part),
            )
            if inspiration_context["document_text"]:
                document_label = inspiration_context["document_filename"] or "上下文文档"
                context.append_text(
                    node=candidate,
                    label="上下文文档",
                    text=f"文档：{document_label}\n{inspiration_context['document_text']}",
                )
        else:
            summary = _output_text(output, "summary")
            if summary:
                context.append_text(node=candidate, label="摘要", text=summary)
    context.image_asset_ids = list(dict.fromkeys(context.image_asset_ids))
    context.poster_variant_ids = list(dict.fromkeys(context.poster_variant_ids))
    return context


def reference_assets_for_image_generation(
    session: Session,
    workflow: InspirationWorkflow,
    incoming_source_asset_ids: list[str],
    incoming_poster_variant_ids: list[str],
) -> list[SourceAsset]:
    inspiration = workflow.inspiration
    assets: list[SourceAsset] = []
    if incoming_source_asset_ids:
        fetched = list(session.scalars(select(SourceAsset).where(SourceAsset.id.in_(incoming_source_asset_ids))))
        assets.extend(asset for asset in fetched if asset.inspiration_id == inspiration.id)
    if incoming_poster_variant_ids:
        posters = list(session.scalars(select(PosterVariant).where(PosterVariant.id.in_(incoming_poster_variant_ids))))
        for poster in posters:
            assets.append(
                SourceAsset(
                    id=poster.id,
                    inspiration_id=poster.inspiration_id,
                    kind=SourceAssetKind.REFERENCE_IMAGE,
                    original_filename=f"{poster.kind.value}.png",
                    mime_type=poster.mime_type,
                    storage_path=poster.storage_path,
                    storage_backend=poster.storage_backend,
                    storage_bucket=poster.storage_bucket,
                    storage_object_key=poster.storage_object_key,
                )
            )
    return unique_image_generation_references(assets)


def reference_image_inputs_for_copy(
    session: Session,
    *,
    workflow: InspirationWorkflow,
    node_id: str,
    storage: LocalStorage,
    incoming_context: IncomingContext | None = None,
) -> list[ReferenceImageInput]:
    nodes_by_id = {node.id: node for node in workflow.nodes}
    reference_nodes = [
        nodes_by_id[edge.source_node_id]
        for edge in workflow.edges
        if edge.target_node_id == node_id
        and edge.source_node_id in nodes_by_id
        and nodes_by_id[edge.source_node_id].node_type == WorkflowNodeType.REFERENCE_IMAGE
    ]
    inputs: list[ReferenceImageInput] = []
    seen_asset_ids: set[str] = set()
    for reference_node in reference_nodes:
        asset_ids = list(
            dict.fromkeys(
                [
                    *source_asset_ids_from_config(reference_node.config_json or {}),
                    *source_asset_ids_from_config(reference_node.output_json or {}),
                ]
            )
        )
        if not asset_ids:
            continue
        assets = list(session.scalars(select(SourceAsset).where(SourceAsset.id.in_(asset_ids))))
        role = optional_config_text(reference_node.config_json or {}, "role")
        label = optional_config_text(reference_node.config_json or {}, "label") or reference_node.title
        for asset in assets:
            if asset.inspiration_id != workflow.inspiration_id or asset.id in seen_asset_ids:
                continue
            seen_asset_ids.add(asset.id)
            inputs.append(
                ReferenceImageInput(
                    bytes_data=storage.read_bytes(storage.object_key_for(asset), max_bytes=REFERENCE_IMAGE_MAX_BYTES),
                    mime_type=asset.mime_type,
                    filename=asset.original_filename,
                    role=role,
                    label=label,
                    source_key=storage.object_key_for(asset),
                )
            )
    incoming_asset_ids = incoming_context.image_asset_ids if incoming_context is not None else []
    if incoming_asset_ids:
        context_assets = list(
            session.scalars(
                select(SourceAsset).where(
                    SourceAsset.id.in_(incoming_asset_ids),
                    SourceAsset.kind == SourceAssetKind.CONTEXT_IMAGE,
                )
            )
        )
        context_assets_by_id = {
            asset.id: asset for asset in context_assets if asset.inspiration_id == workflow.inspiration_id
        }
        for asset_id in incoming_asset_ids:
            asset = context_assets_by_id.get(asset_id)
            if asset is None or asset.id in seen_asset_ids:
                continue
            seen_asset_ids.add(asset.id)
            inputs.append(
                ReferenceImageInput(
                    bytes_data=storage.read_bytes(storage.object_key_for(asset), max_bytes=REFERENCE_IMAGE_MAX_BYTES),
                    mime_type=asset.mime_type,
                    filename=asset.original_filename,
                    role="context",
                    label=asset.original_filename,
                    source_key=storage.object_key_for(asset),
                )
            )
    return inputs


def reference_image_inputs_for_tail(
    session: Session,
    *,
    workflow: InspirationWorkflow,
    node_id: str,
    storage: LocalStorage,
    incoming_context: IncomingContext | None = None,
) -> list[ReferenceImageInput]:
    context = incoming_context or collect_incoming_context(
        workflow,
        node_id,
        include_transitive_inspiration_context=True,
    )
    if not context.image_asset_ids:
        return []
    assets = list(session.scalars(select(SourceAsset).where(SourceAsset.id.in_(context.image_asset_ids))))
    assets_by_id = {asset.id: asset for asset in assets if asset.inspiration_id == workflow.inspiration_id}
    inputs: list[ReferenceImageInput] = []
    for asset_id in context.image_asset_ids:
        asset = assets_by_id.get(asset_id)
        if asset is None:
            continue
        inputs.append(
            ReferenceImageInput(
                bytes_data=storage.read_bytes(storage.object_key_for(asset), max_bytes=REFERENCE_IMAGE_MAX_BYTES),
                mime_type=asset.mime_type,
                filename=asset.original_filename,
                role="reference",
                label=asset.original_filename,
                source_key=storage.object_key_for(asset),
            )
        )
    return inputs


def downstream_reference_nodes(workflow: InspirationWorkflow, node_id: str) -> list[WorkflowNode]:
    target_ids = list(dict.fromkeys(edge.target_node_id for edge in workflow.edges if edge.source_node_id == node_id))
    nodes_by_id = {node.id: node for node in workflow.nodes}
    return [
        nodes_by_id[target_id]
        for target_id in target_ids
        if target_id in nodes_by_id and nodes_by_id[target_id].node_type == WorkflowNodeType.REFERENCE_IMAGE
    ]


def image_instruction_with_context(node: WorkflowNode, text_contexts: list[str]) -> str | None:
    instruction = optional_config_text(node.config_json, "instruction")
    compact_contexts = [item for item in text_contexts if item and item != instruction][:8]
    if not compact_contexts:
        return instruction
    joined = "；".join(compact_contexts)
    if instruction:
        return f"{instruction}\n上游文本上下文：{joined}"
    return f"上游文本上下文：{joined}"


def instruction_with_upstream_text(instruction: str | None, incoming_context: IncomingContext) -> str | None:
    compact_contexts = [item for item in incoming_context.text_contexts if item and item != instruction][:8]
    if not compact_contexts:
        return instruction
    joined = "；".join(compact_contexts)
    if instruction:
        return f"{instruction}\n上游文本上下文：{joined}"
    return f"上游文本上下文：{joined}"


def _dynamic_fields_context_text(raw: Any) -> str:
    if not isinstance(raw, dict) or not raw:
        return ""
    pairs = [f"{key}：{_stringify_dynamic_field_value(value)}" for key, value in raw.items()]
    return f"动态信息：{'；'.join(pairs)}"


def _stringify_dynamic_field_value(value: Any) -> str:
    if value is True:
        return "true"
    if value is False:
        return "false"
    if value is None:
        return "null"
    return str(value)
