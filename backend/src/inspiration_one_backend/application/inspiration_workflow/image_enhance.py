from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from inspiration_one_backend.application.enhance.execution import (
    EnhanceExecutionRequest,
    execute_enhance_execution,
)
from inspiration_one_backend.application.enhance.strategy import (
    DirectParams,
    TiledParams,
    run_direct_strategy,
    run_tiled_strategy,
)
from inspiration_one_backend.application.generation_config_runtime import GenerationConfigSelection
from inspiration_one_backend.application.inspiration_workflow.artifacts import fill_reference_node, image_asset_output
from inspiration_one_backend.application.inspiration_workflow.context import (
    collect_incoming_context,
    downstream_reference_nodes,
    reference_assets_for_image_generation,
)
from inspiration_one_backend.application.inspiration_workflow.run_state import WorkflowSafeExecutionError
from inspiration_one_backend.application.time import now_utc
from inspiration_one_backend.domain.enums import EnhanceStrategy, SourceAssetKind
from inspiration_one_backend.domain.errors import BusinessValidationError
from inspiration_one_backend.infrastructure.db.models import (
    InspirationWorkflow,
    SourceAsset,
    WorkflowNode,
    WorkflowNodeRun,
    new_id,
)
from inspiration_one_backend.infrastructure.image.base import image_dimensions_from_bytes, infer_extension
from inspiration_one_backend.infrastructure.storage import LocalStorage


def normalize_image_enhance_config(config_json: dict[str, Any] | None) -> dict[str, Any]:
    config = dict(config_json or {})
    strategy = str(config.get("strategy") or EnhanceStrategy.DIRECT.value).strip().lower()
    if strategy not in {EnhanceStrategy.DIRECT.value, EnhanceStrategy.TILED.value}:
        raise BusinessValidationError("图片增强策略不支持")
    params = config.get("params")
    params = dict(params) if isinstance(params, dict) else {}
    if strategy == EnhanceStrategy.DIRECT.value:
        params.setdefault("target_width", 1024)
        params.setdefault("target_height", 1024)
    else:
        params.setdefault("scale", 2)
        params.setdefault("tile_base_size", 1024)
        params.setdefault("overlap_pct", 10)
    config["strategy"] = strategy
    config["params"] = params
    return config


def execute_workflow_image_enhance(
    session: Session,
    *,
    workflow: InspirationWorkflow,
    node: WorkflowNode,
    node_run_id: str | None = None,
    generation_config_selection: GenerationConfigSelection,
) -> dict[str, Any]:
    config = normalize_image_enhance_config(node.config_json)
    source = _select_source_asset(session, workflow=workflow, node=node)
    storage = LocalStorage()
    source_bytes = storage.resolve(storage.object_key_for(source)).read_bytes()
    source_dimensions = image_dimensions_from_bytes(source_bytes)
    if source_dimensions is None:
        raise WorkflowSafeExecutionError(
            "图片增强输入不是可解码图片",
            retryable=False,
            retry_hint="revise_input",
            failure_category="invalid_node_config",
        )
    # Shared enhance execution claims runtime generation config through an independent session.
    # Commit the current workflow transaction first so SQLite and other multi-session runtimes do not hold a write lock.
    session.commit()

    try:
        strategy = EnhanceStrategy(config["strategy"])
        outcome = execute_enhance_execution(
            EnhanceExecutionRequest(
                session=session,
                owner_user_id=workflow.inspiration.owner_user_id,
                strategy=strategy,
                params=dict(config["params"]),
                generation_config_selection=generation_config_selection,
                source_image_bytes=source_bytes,
                source_mime=source.mime_type or "image/png",
                source_width=source_dimensions[0],
                source_height=source_dimensions[1],
                output_prefix=f"enhance/workflow/{node.id}/{new_id()}",
                strategy_runner=lambda ctx, normalized_params: _run_workflow_strategy(
                    ctx,
                    strategy=strategy,
                    params=normalized_params,
                ),
                storage=storage,
                reference_limit=2,
                quality_prompt=_optional_text(config.get("quality_prompt")),
                progress_callback=(
                    lambda completed, total: _persist_node_run_progress(
                        session,
                        node_run_id=node_run_id,
                        completed=completed,
                        total=total,
                    )
                    if node_run_id
                    else None
                ),
            )
        )
        result = outcome.result
        used_generation_config_id = outcome.used_generation_config_id
        used_resource_group_id = outcome.used_resource_group_id
        if not result.final_image_ref:
            raise WorkflowSafeExecutionError("图片增强结果不存在", retryable=True)
        enhanced_asset = _create_enhanced_source_asset(
            session,
            workflow=workflow,
            storage=storage,
            final_ref=result.final_image_ref,
            fallback_mime=source.mime_type or "image/png",
        )
        filled_reference_node_ids: list[str] = []
        for reference_node in downstream_reference_nodes(workflow, node.id):
            fill_reference_node(reference_node, enhanced_asset)
            filled_reference_node_ids.append(reference_node.id)
        workflow.inspiration.updated_at = now_utc()
        output = image_asset_output(
            [enhanced_asset],
            summary="图片增强完成",
            role="enhanced_image",
            label=node.title,
        )
        output.update(
            {
                "filled_source_asset_ids": [enhanced_asset.id],
                "filled_reference_node_ids": filled_reference_node_ids,
                "strategy": strategy.value,
                "params": dict(outcome.normalized_params),
                "source_asset_id": source.id,
                "target_count": len(filled_reference_node_ids),
                "generation_config_id": used_generation_config_id,
                "resource_group_id": used_resource_group_id,
                "final_width": result.final_width,
                "final_height": result.final_height,
            }
        )
        return output
    except BaseException:  # noqa: BLE001
        session.rollback()
        raise


def _select_source_asset(session: Session, *, workflow: InspirationWorkflow, node: WorkflowNode) -> SourceAsset:
    configured_ids = _configured_source_asset_ids(node.config_json or {})
    if configured_ids:
        assets = list(reference_assets_for_image_generation(session, workflow, configured_ids[:1], []))
    else:
        incoming_context = collect_incoming_context(workflow, node.id)
        assets = reference_assets_for_image_generation(
            session,
            workflow,
            incoming_context.image_asset_ids,
            incoming_context.poster_variant_ids,
        )
    if not assets:
        raise WorkflowSafeExecutionError(
            "图片增强节点需要连接 1 张图片",
            retryable=False,
            retry_hint="revise_input",
            failure_category="missing_input",
        )
    return assets[0]


def _create_enhanced_source_asset(
    session: Session,
    *,
    workflow: InspirationWorkflow,
    storage: LocalStorage,
    final_ref: str,
    fallback_mime: str,
) -> SourceAsset:
    _final_path, mime_type = storage.resolve_for_variant(final_ref, "original", fallback_media_type=fallback_mime)
    asset = SourceAsset(
        inspiration_id=workflow.inspiration_id,
        kind=SourceAssetKind.REFERENCE_IMAGE,
        original_filename=f"enhance-{new_id()}{infer_extension(mime_type)}",
        mime_type=mime_type,
        **storage.metadata_for(final_ref).as_model_kwargs(),
    )
    session.add(asset)
    session.flush()
    return asset


def _configured_source_asset_ids(config: dict[str, Any]) -> list[str]:
    raw = config.get("source_asset_ids")
    if isinstance(raw, list):
        return [item for item in raw if isinstance(item, str)]
    if isinstance(raw, str):
        return [raw]
    single = config.get("source_asset_id")
    return [single] if isinstance(single, str) else []


def _persist_node_run_progress(session: Session, *, node_run_id: str, completed: int, total: int) -> None:
    node_run = session.get(WorkflowNodeRun, node_run_id)
    if node_run is None:
        return
    node_run.output_json = {"progress": {"completed": max(0, completed), "total": max(1, total)}}
    session.commit()


def _optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def _run_workflow_strategy(
    ctx,
    *,
    strategy: EnhanceStrategy,
    params: dict[str, Any],
):
    if strategy == EnhanceStrategy.DIRECT:
        return run_direct_strategy(
            ctx,
            DirectParams(
                target_width=int(params["target_width"]),
                target_height=int(params["target_height"]),
            ),
        )
    return run_tiled_strategy(
        ctx,
        TiledParams(
            scale=int(params["scale"]),
            tile_base_size=int(params["tile_base_size"]),
            overlap_pct=int(params.get("overlap_pct") or 10),
        ),
        backend_stitch=True,
    )
