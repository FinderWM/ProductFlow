from __future__ import annotations

import logging
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from concurrent.futures import TimeoutError as FuturesTimeoutError
from pathlib import Path
from typing import Any

from dramatiq.middleware.time_limit import TimeLimitExceeded
from sqlalchemy.orm import Session

from inspiration_one_backend.application.auth import require_generation_resource_group_for_user
from inspiration_one_backend.application.contracts import PosterGenerationInput
from inspiration_one_backend.application.copy_payloads import copy_payload_context_text, normalize_copy_payload
from inspiration_one_backend.application.generation_config_runtime import (
    GenerationConfigSelection,
    claim_runtime_generation_config,
    generation_config_selection_from_config,
    generation_failure_is_throttled,
    generation_failure_is_timeout,
    generation_failure_reason,
    release_runtime_generation_config,
)
from inspiration_one_backend.application.image_generation_core import build_stored_image_reference_payload
from inspiration_one_backend.application.image_generation_failures import classify_image_generation_failure
from inspiration_one_backend.application.inspiration_workflow.artifacts import (
    GeneratedWorkflowImage,
    create_context_copy_set,
    fill_reference_node,
)
from inspiration_one_backend.application.inspiration_workflow.context import (
    collect_incoming_context,
    downstream_reference_nodes,
    effective_inspiration_context,
    image_instruction_with_context,
    image_size_from_config,
    image_tool_options_from_config,
    optional_config_text,
    poster_kind_from_config,
    reference_assets_for_image_generation,
)
from inspiration_one_backend.application.inspiration_workflow.run_state import WorkflowSafeExecutionError
from inspiration_one_backend.application.inspiration_workflow_dependencies import (
    PosterRendererFactory,
    WorkflowExecutionDependencies,
    default_workflow_execution_dependencies,
)
from inspiration_one_backend.application.time import now_utc
from inspiration_one_backend.config import get_runtime_settings
from inspiration_one_backend.domain.enums import PosterKind, SourceAssetKind
from inspiration_one_backend.domain.errors import BusinessValidationError
from inspiration_one_backend.infrastructure.db.models import (
    CopySet,
    GenerationConfig,
    InspirationWorkflow,
    PosterVariant,
    SourceAsset,
    WorkflowNode,
)
from inspiration_one_backend.infrastructure.image.base import ImageProvider, infer_extension
from inspiration_one_backend.infrastructure.provider_config import (
    IMAGE_PURPOSE,
    generation_config_resource_group_ids,
    is_real_image_provider_kind,
    resolve_image_provider_config,
)
from inspiration_one_backend.infrastructure.storage import LocalStorage

logger = logging.getLogger(__name__)

WORKFLOW_IMAGE_GENERATION_FAILURE = "图片生成失败，请稍后重试"
WORKFLOW_IMAGE_GENERATION_TIMEOUT_FAILURE = "图片生成超时，请稍后重试"
TAIL_SPLIT_PROMPT_SOURCE_LIMITS = {
    "public": (4, 1600),
    "manual": (6, 1400),
    "auxiliary": (4, 700),
}


class WorkflowImageGenerationTimeoutError(WorkflowSafeExecutionError):
    """Raised when workflow image provider calls exceed the project timeout boundary."""


class WorkflowImageGenerationProviderError(WorkflowSafeExecutionError):
    """Raised when workflow image provider failures must be hidden behind a safe user message."""


def workflow_image_generation_provider_timeout_seconds() -> float:
    return float(get_runtime_settings().workflow_image_generation_provider_timeout_seconds)


def effective_workflow_image_generation_mode(configured_mode: str, image_provider_kind: str | None) -> str:
    if is_real_image_provider_kind(image_provider_kind):
        return "generated"
    return configured_mode


def should_claim_workflow_image_generation_config(
    *,
    configured_mode: str,
    selection: GenerationConfigSelection,
    session: Session | None = None,
) -> bool:
    if selection.resource_group_id:
        return True
    if configured_mode == "generated" or selection.mode == "manual":
        return True
    provider_config = resolve_image_provider_config(
        generation_config_id=selection.generation_config_id,
        session=session,
    )
    return is_real_image_provider_kind(provider_config.provider_kind)


def call_with_timeout[T](call: Callable[[], T], *, timeout_seconds: float, timeout_message: str) -> T:
    executor = ThreadPoolExecutor(max_workers=1)
    future = executor.submit(call)
    try:
        result = future.result(timeout=timeout_seconds)
    except FuturesTimeoutError as exc:
        future.cancel()
        executor.shutdown(wait=False, cancel_futures=True)
        raise WorkflowImageGenerationTimeoutError(timeout_message) from exc
    except BaseException:
        future.cancel()
        executor.shutdown(wait=False, cancel_futures=True)
        raise
    else:
        executor.shutdown(wait=True)
        return result


def _is_workflow_context_copy_set(copy_set: CopySet) -> bool:
    if copy_set.provider_name == "workflow_context":
        return True
    payload = copy_set.structured_payload
    return isinstance(payload, dict) and payload.get("purpose") == "workflow_context"


def _generated_by(config_json: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(config_json, dict):
        return {}
    generated_by = config_json.get("generated_by")
    return generated_by if isinstance(generated_by, dict) else {}


def _tail_generated_image_trigger(node: WorkflowNode) -> dict[str, Any] | None:
    generated_by = _generated_by(node.config_json)
    if generated_by.get("role") != "image_trigger":
        return None
    tail_node_id = generated_by.get("tail_node_id")
    return generated_by if isinstance(tail_node_id, str) and tail_node_id else None


def _direct_source_nodes(workflow: InspirationWorkflow, target_node_id: str) -> list[WorkflowNode]:
    ordered_edges = sorted(
        [edge for edge in workflow.edges if edge.target_node_id == target_node_id],
        key=lambda item: (item.created_at, item.id),
    )
    source_ids = list(dict.fromkeys(edge.source_node_id for edge in ordered_edges))
    nodes_by_id = {node.id: node for node in workflow.nodes}
    return [nodes_by_id[source_id] for source_id in source_ids if source_id in nodes_by_id]


def _tail_public_source_role(source_node: WorkflowNode, *, tail_node_id: str) -> str | None:
    generated_by = _generated_by(source_node.config_json)
    if generated_by.get("tail_node_id") != tail_node_id:
        return None
    role = generated_by.get("role")
    return role if role in {"public_copy", "public_reference"} else None


def _compact_prompt_text(text: str, *, max_chars: int) -> str:
    compact = " ".join(text.split())
    if len(compact) <= max_chars:
        return compact
    return f"{compact[:max_chars].rstrip()}..."


def _format_prompt_sources(
    sources: list[dict[str, str]],
    *,
    max_sources: int,
    max_chars: int,
) -> str:
    lines: list[str] = []
    for source in sources[:max_sources]:
        node_title = source.get("node_title") or "上游节点"
        label = source.get("label") or "上下文"
        text = _compact_prompt_text(source.get("text", ""), max_chars=max_chars)
        if text:
            lines.append(f"- [{node_title} / {label}] {text}")
    return "\n".join(lines)


def _tail_split_image_instruction(
    *,
    workflow: InspirationWorkflow,
    node: WorkflowNode,
    incoming_text_sources: list[dict[str, str]],
) -> str | None:
    tail_generated = _tail_generated_image_trigger(node)
    if tail_generated is None:
        return image_instruction_with_context(node, [source["text"] for source in incoming_text_sources])

    instruction = optional_config_text(node.config_json, "instruction") or ""
    tail_node_id = str(tail_generated["tail_node_id"])
    direct_sources = _direct_source_nodes(workflow, node.id)

    public_node_ids: set[str] = set()
    generated_helper_node_ids: set[str] = set()
    for source_node in direct_sources:
        public_role = _tail_public_source_role(source_node, tail_node_id=tail_node_id)
        if public_role is None:
            continue
        generated_helper_node_ids.add(source_node.id)
        public_node_ids.add(source_node.id)

    manual_direct_node_ids = {
        source_node.id
        for source_node in direct_sources
        if source_node.id != tail_node_id and source_node.id not in generated_helper_node_ids
    }
    public_sources: list[dict[str, str]] = []
    manual_sources: list[dict[str, str]] = []
    auxiliary_sources: list[dict[str, str]] = []
    for source in incoming_text_sources:
        node_id = source.get("node_id")
        if node_id in public_node_ids:
            public_sources.append(source)
        elif node_id in manual_direct_node_ids:
            manual_sources.append(source)
        else:
            auxiliary_sources.append(source)

    public_max_sources, public_max_chars = TAIL_SPLIT_PROMPT_SOURCE_LIMITS["public"]
    manual_max_sources, manual_max_chars = TAIL_SPLIT_PROMPT_SOURCE_LIMITS["manual"]
    auxiliary_max_sources, auxiliary_max_chars = TAIL_SPLIT_PROMPT_SOURCE_LIMITS["auxiliary"]

    sections = [
        (
            "优先级规则（必须遵守）：\n"
            "P0 当前生图节点描述是这张 PPT 图片的唯一内容边界。\n"
            "P1 公共约束只控制整批图片的风格、版式、禁忌和一致性，不能新增 P0 没有要求展示的业务内容。\n"
            "P2 用户手动直连的辅助节点可用于当前图片的信息提取、局部复用或贴图，但仍不能突破 P0 的内容边界。\n"
            "P3 自动上游/全局资料只用于理解术语和核对事实，不指导构图、文字密度、流程节点、表格字段或画面元素。"
        ),
        f"P0 当前生图节点描述：\n{instruction or '未提供当前页画面描述。'}",
    ]

    formatted_public = _format_prompt_sources(
        public_sources,
        max_sources=public_max_sources,
        max_chars=public_max_chars,
    )
    if formatted_public:
        sections.append(f"P1 公共约束：\n{formatted_public}")

    formatted_manual = _format_prompt_sources(
        manual_sources,
        max_sources=manual_max_sources,
        max_chars=manual_max_chars,
    )
    if formatted_manual:
        sections.append(f"P2 用户手动直连辅助信息：\n{formatted_manual}")

    formatted_auxiliary = _format_prompt_sources(
        auxiliary_sources,
        max_sources=auxiliary_max_sources,
        max_chars=auxiliary_max_chars,
    )
    if formatted_auxiliary:
        sections.append(
            "P3 自动上游/全局资料（仅用于术语理解和事实核对，禁止直接画入）：\n"
            f"{formatted_auxiliary}"
        )

    sections.append(
        "执行要求：生成单张 PPT 辅助图；只呈现 P0 要求的主要简化信息；"
        "讲述人负责展开细节，图片不要补充 P0 未要求的流程、字段、表格、标题或业务分支。"
    )
    return "\n\n".join(sections)


def _workflow_image_generation_config_selection_for_execution(
    session: Session,
    *,
    workflow: InspirationWorkflow,
    node: WorkflowNode,
) -> GenerationConfigSelection:
    selection = generation_config_selection_from_config(node.config_json)
    if not selection.resource_group_id:
        raise WorkflowSafeExecutionError(
            "请选择供应商生成分组",
            retryable=False,
            retry_hint="revise_input",
            failure_category="invalid_node_config",
        )
    if selection.mode == "manual" and not selection.generation_config_id:
        raise WorkflowSafeExecutionError(
            "手动指定生成配置时必须选择配置",
            retryable=False,
            retry_hint="revise_input",
            failure_category="invalid_node_config",
        )
    inspiration = workflow.inspiration
    try:
        group = require_generation_resource_group_for_user(
            session,
            user_id=inspiration.owner_user_id,
            is_admin=bool(inspiration.owner and inspiration.owner.is_admin),
            resource_group_id=selection.resource_group_id,
        )
    except BusinessValidationError as exc:
        raise WorkflowSafeExecutionError(
            str(exc),
            retryable=False,
            retry_hint="check_settings",
            failure_category="invalid_node_config",
        ) from exc
    authorized_selection = GenerationConfigSelection(
        mode=selection.mode,
        generation_config_id=selection.generation_config_id,
        resource_group_id=group.id,
    )
    _validate_manual_image_generation_config_selection(session, selection=authorized_selection)
    return authorized_selection


def _validate_manual_image_generation_config_selection(
    session: Session,
    *,
    selection: GenerationConfigSelection,
) -> None:
    if selection.mode != "manual":
        return
    if not selection.generation_config_id:
        raise WorkflowSafeExecutionError(
            "手动指定生成配置时必须选择配置",
            retryable=False,
            retry_hint="revise_input",
            failure_category="invalid_node_config",
        )
    generation_config = session.get(GenerationConfig, selection.generation_config_id)
    if generation_config is None or generation_config.archived_at is not None:
        raise WorkflowSafeExecutionError(
            "生成配置不存在",
            retryable=False,
            retry_hint="revise_input",
            failure_category="invalid_node_config",
        )
    if generation_config.purpose != IMAGE_PURPOSE:
        raise WorkflowSafeExecutionError(
            "生图节点只能使用图片生成配置",
            retryable=False,
            retry_hint="revise_input",
            failure_category="invalid_node_config",
        )
    if selection.resource_group_id not in generation_config_resource_group_ids(generation_config):
        raise WorkflowSafeExecutionError(
            "手动指定的生成配置不属于当前供应商生成分组",
            retryable=False,
            retry_hint="revise_input",
            failure_category="invalid_node_config",
        )


def execute_workflow_image_generation(
    session: Session,
    *,
    workflow: InspirationWorkflow,
    node: WorkflowNode,
    dependencies: WorkflowExecutionDependencies | None = None,
) -> dict[str, object]:
    dependencies = dependencies or default_workflow_execution_dependencies()
    inspiration = workflow.inspiration
    settings = get_runtime_settings()
    kind = poster_kind_from_config(node.config_json)
    configured_generation_mode = settings.poster_generation_mode
    generation_config_selection = _workflow_image_generation_config_selection_for_execution(
        session,
        workflow=workflow,
        node=node,
    )
    runtime_claim = None
    used_generation_config_id: str | None = None
    used_resource_group_id: str | None = generation_config_selection.resource_group_id
    poster_generation_mode = configured_generation_mode
    if should_claim_workflow_image_generation_config(
        configured_mode=configured_generation_mode,
        selection=generation_config_selection,
        session=session,
    ):
        runtime_claim = claim_runtime_generation_config(
            purpose="image",
            selection=generation_config_selection,
            session=session,
        )
        used_generation_config_id = runtime_claim.generation_config_id
        used_resource_group_id = runtime_claim.resource_group_id
        poster_generation_mode = effective_workflow_image_generation_mode(
            configured_generation_mode,
            runtime_claim.claim.provider_kind,
        )
    provider_invoked = False
    incoming_context = collect_incoming_context(workflow, node.id, include_transitive_inspiration_context=True)
    try:
        inspiration_context = effective_inspiration_context(workflow, node.id, include_transitive=True)
        downstream_nodes = downstream_reference_nodes(workflow, node.id)
        if not downstream_nodes:
            raise BusinessValidationError("请先把生图节点连接到至少一个图片/参考图节点，再运行图片生成")

        linked_copy_set_id = optional_config_text(node.config_json, "copy_set_id") or incoming_context.copy_set_id
        copy_set = session.get(CopySet, linked_copy_set_id) if linked_copy_set_id else None
        has_linked_copy_input = (
            linked_copy_set_id is not None and copy_set is not None and copy_set.inspiration_id == inspiration.id
        )
        has_real_copy_context = (
            has_linked_copy_input
            and copy_set is not None
            and copy_set.inspiration_id == inspiration.id
            and not _is_workflow_context_copy_set(copy_set)
        )
        should_create_context_copy_set = copy_set is None or copy_set.inspiration_id != inspiration.id
        structured_copy_context = None
        if has_real_copy_context and isinstance(copy_set.structured_payload, dict):
            try:
                structured_copy_context = copy_payload_context_text(normalize_copy_payload(copy_set.structured_payload))
            except ValueError:
                structured_copy_context = None

        storage = LocalStorage()
        reference_assets = reference_assets_for_image_generation(
            session,
            workflow,
            incoming_context.image_asset_ids,
            incoming_context.poster_variant_ids,
        )
        reference_payload = build_stored_image_reference_payload(
            reference_assets,
            resolve_storage_path=storage.resolve,
        )
        instruction = _tail_split_image_instruction(
            workflow=workflow,
            node=node,
            incoming_text_sources=incoming_context.text_sources,
        )
        source_note = None if _tail_generated_image_trigger(node) is not None else inspiration_context["source_note"]
        render_input = PosterGenerationInput(
            copy_prompt_mode="copy" if structured_copy_context else "image_edit",
            inspiration_name=inspiration_context["name"] or "",
            category=inspiration_context["category"],
            price=inspiration_context["price"],
            source_note=source_note,
            instruction=instruction,
            image_size=image_size_from_config(node.config_json),
            tool_options=image_tool_options_from_config(node.config_json),
            structured_copy_context=structured_copy_context,
            source_image=reference_payload.source_image,
            reference_images=reference_payload.reference_images,
        )
        poster_ids: list[str] = []
        filled_source_asset_ids: list[str] = []
        filled_reference_node_ids: list[str] = []
        provider_results: list[dict[str, object]] = []
        image_providers: list[ImageProvider] | None = None
        if poster_generation_mode == "generated":
            if runtime_claim is None:
                raise RuntimeError("图片生成配置未初始化")
            first_provider = dependencies.image_provider(runtime_claim.generation_config_id, session=session)
            image_providers = [first_provider]
            provider_invoked = True
        generated_images = generate_workflow_images_concurrently(
            render_input=render_input,
            kind=kind,
            target_count=len(downstream_nodes),
            poster_generation_mode=poster_generation_mode,
            poster_font_path=settings.poster_font_path,
            image_providers=image_providers,
            renderer_factory=dependencies.poster_renderer,
        )
        release_runtime_generation_config(
            runtime_claim,
            success=poster_generation_mode == "generated",
            session=session,
            user_id=inspiration.owner_user_id,
            generated_unit_count=len(downstream_nodes) if poster_generation_mode == "generated" else 0,
            record_result=poster_generation_mode == "generated",
        )
        runtime_claim = None
        if should_create_context_copy_set:
            copy_set = create_context_copy_set(
                session, inspiration=inspiration, inspiration_context=inspiration_context, node=node
            )
            copy_set.resource_group_id = used_resource_group_id
        if copy_set is None:
            raise RuntimeError("图片生成缺少文案上下文")
        for generated_image, target_node in zip(generated_images, downstream_nodes, strict=True):
            content = generated_image.content
            mime_type = generated_image.mime_type
            relative_path = storage.save_generated_image(
                inspiration.id,
                f"workflow-{kind.value}-{generated_image.target_index}",
                content,
                suffix=infer_extension(mime_type),
            )
            poster = PosterVariant(
                inspiration_id=inspiration.id,
                copy_set_id=copy_set.id,
                kind=kind,
                template_name=generated_image.template_name,
                mime_type=mime_type,
                **storage.metadata_for(relative_path).as_model_kwargs(),
                resource_group_id=used_resource_group_id,
                width=generated_image.width,
                height=generated_image.height,
            )
            session.add(poster)
            session.flush()
            poster_ids.append(poster.id)

            filename = f"reference-{generated_image.target_index}{infer_extension(mime_type)}"
            reference_path = storage.save_reference_upload(inspiration.id, filename, content)
            storage_metadata = storage.metadata_for(reference_path)
            asset = SourceAsset(
                inspiration_id=inspiration.id,
                kind=SourceAssetKind.REFERENCE_IMAGE,
                original_filename=filename,
                mime_type=mime_type,
                **storage_metadata.as_model_kwargs(),
                source_poster_variant_id=poster.id,
            )
            session.add(asset)
            session.flush()
            filled_source_asset_ids.append(asset.id)
            filled_reference_node_ids.append(target_node.id)
            fill_reference_node(target_node, asset, source_poster_variant_id=poster.id)
            provider_result = {
                "target_index": generated_image.target_index,
                "provider_name": generated_image.provider_name,
                "model_name": generated_image.model_name,
                "generation_config_id": used_generation_config_id,
                "resource_group_id": used_resource_group_id,
                "provider_response_id": generated_image.provider_response_id,
                "provider_response_status": generated_image.provider_response_status,
            }
            if isinstance(generated_image.provider_output_json, dict):
                metadata = generated_image.provider_output_json.get("_inspiration_one")
                if isinstance(metadata, dict):
                    actual_size = metadata.get("actual_size")
                    notes = metadata.get("notes")
                    if isinstance(actual_size, str):
                        provider_result["actual_size"] = actual_size
                    if isinstance(notes, list):
                        provider_result["notes"] = [item for item in notes if isinstance(item, str)][:4]
            safe_provider_result = {key: value for key, value in provider_result.items() if value is not None}
            if safe_provider_result:
                provider_results.append(safe_provider_result)
        inspiration.updated_at = now_utc()
        return {
            "copy_set_id": copy_set.id,
            "generated_poster_variant_ids": poster_ids,
            "filled_source_asset_ids": filled_source_asset_ids,
            "filled_reference_node_ids": filled_reference_node_ids,
            "provider_results": provider_results,
            "target_count": len(downstream_nodes),
            "size": image_size_from_config(node.config_json),
            "instruction": optional_config_text(node.config_json, "instruction"),
            "context_summary": {
                "inspiration_context": inspiration_context,
                "copy_set_id": copy_set.id,
                "copy_prompt_mode": render_input.copy_prompt_mode,
                "upstream_text_count": len(incoming_context.text_contexts),
                "reference_image_count": len(incoming_context.image_asset_ids),
                "poster_variant_count": len(incoming_context.poster_variant_ids),
            },
            "context_sources": incoming_context.text_sources[:8],
            "generation_config_id": used_generation_config_id,
            "resource_group_id": used_resource_group_id,
            "summary": f"已填充 {len(filled_reference_node_ids)} 个参考图",
        }
    except BaseException as exc:  # noqa: BLE001
        session.rollback()
        release_runtime_generation_config(
            runtime_claim,
            success=False,
            user_id=inspiration.owner_user_id,
            generated_unit_count=0,
            failure_reason=generation_failure_reason(exc) if provider_invoked else None,
            timeout=generation_failure_is_timeout(exc),
            throttled=generation_failure_is_throttled(exc),
            record_result=provider_invoked,
        )
        raise


def generate_workflow_images_concurrently(
    *,
    render_input: PosterGenerationInput,
    kind: PosterKind,
    target_count: int,
    poster_generation_mode: str,
    poster_font_path: Path,
    image_providers: list[ImageProvider] | None,
    renderer_factory: PosterRendererFactory | None = None,
) -> list[GeneratedWorkflowImage]:
    if target_count <= 0:
        return []
    dependencies = default_workflow_execution_dependencies()
    renderer_factory = renderer_factory or dependencies.poster_renderer

    def generated_workflow_image_from_payload(
        *,
        target_index: int,
        image_provider: ImageProvider,
        generated_image,
        image_model: str,
    ) -> GeneratedWorkflowImage:
        return GeneratedWorkflowImage(
            target_index=target_index,
            content=generated_image.bytes_data,
            width=generated_image.width,
            height=generated_image.height,
            template_name=f"workflow:{image_provider.provider_name}:{generated_image.variant_label}:{image_model}",
            mime_type=generated_image.mime_type,
            provider_name=image_provider.provider_name,
            model_name=image_model,
            provider_response_id=generated_image.provider_response_id,
            provider_response_status=generated_image.provider_response_status,
            provider_output_json=generated_image.provider_output_json,
        )

    def raise_provider_error(exc: Exception, *, image_provider: ImageProvider, target_index: int) -> None:
        logger.warning(
            ("工作流图片供应商生成失败: target_index=%s provider=%s model=%s copy_prompt_mode=%s exception_class=%s"),
            target_index,
            getattr(image_provider, "provider_name", None),
            getattr(image_provider, "model", None),
            render_input.copy_prompt_mode,
            type(exc).__name__,
        )
        decision = classify_image_generation_failure(exc, generic_message=WORKFLOW_IMAGE_GENERATION_FAILURE)
        raise WorkflowImageGenerationProviderError(
            decision.reason,
            retryable=decision.retryable,
            retry_hint=decision.retry_hint,
            failure_category=decision.category,
        ) from exc

    if poster_generation_mode == "generated" and target_count > 1 and image_providers:
        image_provider = image_providers[0]
        batch_generate = getattr(image_provider, "generate_poster_images", None)
        if callable(batch_generate):

            def generate_batch() -> list[GeneratedWorkflowImage]:
                try:
                    generated_payloads = batch_generate(render_input, kind, target_count)
                except TimeLimitExceeded:
                    raise
                except WorkflowSafeExecutionError:
                    raise
                except Exception as exc:  # noqa: BLE001
                    raise_provider_error(exc, image_provider=image_provider, target_index=1)
                if len(generated_payloads) != target_count:
                    raise WorkflowImageGenerationProviderError(WORKFLOW_IMAGE_GENERATION_FAILURE, retryable=True)
                return [
                    generated_workflow_image_from_payload(
                        target_index=target_index,
                        image_provider=image_provider,
                        generated_image=generated_image,
                        image_model=image_model,
                    )
                    for target_index, (generated_image, image_model) in enumerate(generated_payloads, start=1)
                ]

            return call_with_timeout(
                generate_batch,
                timeout_seconds=workflow_image_generation_provider_timeout_seconds(),
                timeout_message=WORKFLOW_IMAGE_GENERATION_TIMEOUT_FAILURE,
            )

    def generate_one(target_index: int) -> GeneratedWorkflowImage:
        if poster_generation_mode == "generated":
            if image_providers is None:
                raise RuntimeError("图片生成供应商未初始化")
            image_provider = image_providers[min(target_index - 1, len(image_providers) - 1)]
            try:
                generated_image, image_model = image_provider.generate_poster_image(render_input, kind)
            except TimeLimitExceeded:
                raise
            except WorkflowSafeExecutionError:
                raise
            except Exception as exc:  # noqa: BLE001
                raise_provider_error(exc, image_provider=image_provider, target_index=target_index)
            return generated_workflow_image_from_payload(
                target_index=target_index,
                image_provider=image_provider,
                generated_image=generated_image,
                image_model=image_model,
            )

        renderer = renderer_factory(poster_font_path)
        return GeneratedWorkflowImage(
            target_index=target_index,
            content=renderer.render(render_input, kind),
            width=1080,
            height=1080 if kind == PosterKind.MAIN_IMAGE else 1440,
            template_name=f"workflow:{'default-main' if kind == PosterKind.MAIN_IMAGE else 'default-promo'}",
            mime_type="image/png",
        )

    if target_count == 1:
        if poster_generation_mode == "generated":
            return [
                call_with_timeout(
                    lambda: generate_one(1),
                    timeout_seconds=workflow_image_generation_provider_timeout_seconds(),
                    timeout_message=WORKFLOW_IMAGE_GENERATION_TIMEOUT_FAILURE,
                )
            ]
        return [generate_one(1)]
    if poster_generation_mode == "generated":
        timeout_seconds = workflow_image_generation_provider_timeout_seconds()
        return [
            call_with_timeout(
                lambda target_index=target_index: generate_one(target_index),
                timeout_seconds=timeout_seconds,
                timeout_message=WORKFLOW_IMAGE_GENERATION_TIMEOUT_FAILURE,
            )
            for target_index in range(1, target_count + 1)
        ]
    executor = ThreadPoolExecutor(max_workers=target_count)
    futures = {executor.submit(generate_one, target_index): target_index for target_index in range(1, target_count + 1)}
    results: dict[int, GeneratedWorkflowImage] = {}
    try:
        timeout = (
            workflow_image_generation_provider_timeout_seconds() if poster_generation_mode == "generated" else None
        )
        for future in as_completed(futures, timeout=timeout):
            target_index = futures[future]
            results[target_index] = future.result()
    except FuturesTimeoutError as exc:
        for future in futures:
            future.cancel()
        executor.shutdown(wait=False, cancel_futures=True)
        raise WorkflowImageGenerationTimeoutError(WORKFLOW_IMAGE_GENERATION_TIMEOUT_FAILURE) from exc
    except BaseException:
        for future in futures:
            future.cancel()
        executor.shutdown(wait=False, cancel_futures=True)
        raise
    else:
        executor.shutdown(wait=True)
    return [results[target_index] for target_index in range(1, target_count + 1)]
