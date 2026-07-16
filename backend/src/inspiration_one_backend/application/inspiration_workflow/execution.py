from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from dramatiq.middleware.time_limit import TimeLimitExceeded
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from inspiration_one_backend.application.admission import generation_capacity_pool_for_workflow_node_type
from inspiration_one_backend.application.auth import require_generation_resource_group_for_user
from inspiration_one_backend.application.contracts import InspirationInput, ReferenceImageInput, TailSplitPlanInput
from inspiration_one_backend.application.copy_payloads import (
    normalize_copy_node_config,
    normalize_copy_payload,
)
from inspiration_one_backend.application.generation_config_runtime import (
    GenerationConfigSelection,
    GenerationConfigWaitError,
    claim_runtime_generation_config,
    generation_config_selection_from_config,
    generation_failure_is_throttled,
    generation_failure_is_timeout,
    generation_failure_reason,
    release_runtime_generation_config,
)
from inspiration_one_backend.application.inspiration_workflow import graph as inspiration_workflow_graph
from inspiration_one_backend.application.inspiration_workflow.artifacts import (
    copy_node_output,
    image_asset_output,
)
from inspiration_one_backend.application.inspiration_workflow.context import (
    collect_incoming_context,
    effective_inspiration_context,
    find_source_asset,
    inspiration_context_output,
    instruction_with_upstream_text,
    optional_config_text,
    reference_image_inputs_for_copy,
    reference_image_inputs_for_tail,
    source_asset_ids_from_config,
)
from inspiration_one_backend.application.inspiration_workflow.image_enhance import execute_workflow_image_enhance
from inspiration_one_backend.application.inspiration_workflow.image_generation import (
    execute_workflow_image_generation,
)
from inspiration_one_backend.application.inspiration_workflow.mutations import get_or_create_inspiration_workflow
from inspiration_one_backend.application.inspiration_workflow.query import WorkflowQueryService
from inspiration_one_backend.application.inspiration_workflow.run_state import (
    WORKFLOW_CANCELLED_REASON,
    WorkflowSafeExecutionError,
    claim_workflow_node_run,
    mark_workflow_node_run_failed,
    mark_workflow_run_cancelled,
    mark_workflow_run_failed,
    requeue_workflow_node_run_after_capacity_wait,
    workflow_node_failed_run_is_retryable,
    workflow_run_failure_context,
    workflow_run_failure_progress_metadata,
)
from inspiration_one_backend.application.inspiration_workflow.tail_confirmation import (
    append_pending_tail_confirmation,
    run_has_pending_tail_confirmations,
    workflow_run_is_user_active,
)
from inspiration_one_backend.application.inspiration_workflow.tail_splitter import (
    build_tail_split_plan_output,
    read_tail_splitter_config_for_runtime,
)
from inspiration_one_backend.application.inspiration_workflow_dependencies import (
    WorkflowExecutionDependencies,
    default_workflow_execution_dependencies,
)
from inspiration_one_backend.application.queue_submission import enqueue_or_mark_failed
from inspiration_one_backend.application.task_notifications import publish_workflow_run_notification_safely
from inspiration_one_backend.application.time import now_utc
from inspiration_one_backend.domain.durable_generation_tasks import WORKFLOW_RUN_GENERATION_TASK_CONTRACT
from inspiration_one_backend.domain.enums import (
    CopyStatus,
    WorkflowNodeStatus,
    WorkflowNodeType,
    WorkflowRunStatus,
)
from inspiration_one_backend.domain.errors import BusinessError, BusinessValidationError, NotFoundError
from inspiration_one_backend.domain.workflow_rules import (
    WorkflowRuleEdge,
    WorkflowRuleNode,
    ready_workflow_node_ids,
    selected_node_execution_plan,
    should_execute_missing_upstream,
)
from inspiration_one_backend.infrastructure.db.models import (
    CopySet,
    CreativeBrief,
    GenerationConfig,
    InspirationWorkflow,
    WorkflowNode,
    WorkflowNodeRun,
    WorkflowRun,
)
from inspiration_one_backend.infrastructure.db.session import get_session_factory
from inspiration_one_backend.infrastructure.provider_config import (
    IMAGE_PURPOSE,
    TEXT_PURPOSE,
    ensure_provider_config_bootstrapped,
    generation_config_resource_group_ids,
)
from inspiration_one_backend.infrastructure.queue import enqueue_workflow_node_run, enqueue_workflow_run
from inspiration_one_backend.infrastructure.storage import LocalStorage

logger = logging.getLogger(__name__)

COPY_PROVIDER_CONTRACT_MAX_ATTEMPTS = 2
WORKFLOW_SOURCE_IMAGE_MAX_BYTES = 10 * 1024 * 1024
WORKFLOW_RESOURCE_GROUP_NODE_TYPES = frozenset(
    {
        WorkflowNodeType.COPY_GENERATION,
        WorkflowNodeType.TAIL_SPLITTER,
        WorkflowNodeType.IMAGE_GENERATION,
        WorkflowNodeType.IMAGE_ENHANCE,
    }
)
RUNNABLE_WORKFLOW_NODE_TYPES = frozenset(
    {
        WorkflowNodeType.INSPIRATION_CONTEXT,
        WorkflowNodeType.REFERENCE_IMAGE,
        WorkflowNodeType.COPY_GENERATION,
        WorkflowNodeType.TAIL_SPLITTER,
        WorkflowNodeType.IMAGE_GENERATION,
        WorkflowNodeType.IMAGE_ENHANCE,
    }
)


@dataclass(frozen=True, slots=True)
class WorkflowRunKickoff:
    workflow: InspirationWorkflow
    run_id: str
    created: bool
    should_enqueue: bool


def _active_workflow_run(workflow: InspirationWorkflow) -> WorkflowRun | None:
    return next(
        (
            run
            for run in sorted(workflow.runs, key=lambda item: item.started_at, reverse=True)
            if workflow_run_is_user_active(run.status)
        ),
        None,
    )


def _workflow_run_overlaps_nodes(run: WorkflowRun, node_ids: set[str]) -> bool:
    return any(node_run.node_id in node_ids for node_run in run.node_runs)


def _active_workflow_run_for_nodes(workflow: InspirationWorkflow, node_ids: set[str]) -> WorkflowRun | None:
    return next(
        (
            run
            for run in sorted(workflow.runs, key=lambda item: item.started_at, reverse=True)
            if workflow_run_is_user_active(run.status) and _workflow_run_overlaps_nodes(run, node_ids)
        ),
        None,
    )


def _workflow_run_should_enqueue(run: WorkflowRun) -> bool:
    if not WORKFLOW_RUN_GENERATION_TASK_CONTRACT.is_running(run.status):
        return False
    if any(WORKFLOW_RUN_GENERATION_TASK_CONTRACT.execution_is_running(node_run.status) for node_run in run.node_runs):
        return False
    has_queued_node_run = any(
        WORKFLOW_RUN_GENERATION_TASK_CONTRACT.execution_is_queued(node_run.status) for node_run in run.node_runs
    )
    return has_queued_node_run or (
        bool(run.node_runs) and all(node_run.status == WorkflowNodeStatus.SUCCEEDED for node_run in run.node_runs)
    )


def _latest_failed_workflow_run(workflow: InspirationWorkflow) -> WorkflowRun | None:
    return next(
        (
            run
            for run in sorted(workflow.runs, key=lambda item: item.started_at, reverse=True)
            if run.status == WorkflowRunStatus.FAILED
        ),
        None,
    )


def _workflow_run_retry_node_ids(run: WorkflowRun) -> set[str] | None:
    retry_node_ids = {
        node_run.node_id
        for node_run in run.node_runs
        if node_run.status == WorkflowNodeStatus.FAILED
        and node_run.failure_reason != WORKFLOW_CANCELLED_REASON
        and _workflow_node_is_runnable(node_run.node)
    }
    if not retry_node_ids:
        return None
    ordered_nodes = [
        node for node in inspiration_workflow_graph.topological_nodes(run.workflow) if _workflow_node_is_runnable(node)
    ]
    if len(retry_node_ids) == len(ordered_nodes):
        return None
    return retry_node_ids


def _workflow_node_is_runnable(node: WorkflowNode) -> bool:
    return node.node_type in RUNNABLE_WORKFLOW_NODE_TYPES


def _runnable_node_ids(workflow: InspirationWorkflow, node_ids: set[str]) -> set[str]:
    runnable_ids = {node.id for node in workflow.nodes if _workflow_node_is_runnable(node)}
    return node_ids & runnable_ids


def _generation_resource_group_config_error(message: str, *, for_execution: bool) -> BusinessValidationError:
    if for_execution:
        raise WorkflowSafeExecutionError(
            message,
            retryable=False,
            retry_hint="revise_input",
            failure_category="invalid_node_config",
        )
    raise BusinessValidationError(message)


def _workflow_generation_config_selection(
    raw_config: dict[str, Any] | None,
    *,
    for_execution: bool = False,
) -> GenerationConfigSelection:
    selection = generation_config_selection_from_config(raw_config)
    if not selection.resource_group_id:
        _generation_resource_group_config_error("请选择供应商生成分组", for_execution=for_execution)
    if selection.mode == "manual" and not selection.generation_config_id:
        _generation_resource_group_config_error("手动指定生成配置时必须选择配置", for_execution=for_execution)
    return selection


def _workflow_generation_config_purpose(node_type: WorkflowNodeType) -> str:
    if node_type in {WorkflowNodeType.IMAGE_GENERATION, WorkflowNodeType.IMAGE_ENHANCE}:
        return IMAGE_PURPOSE
    return TEXT_PURPOSE


def _workflow_generation_config_purpose_error(node_type: WorkflowNodeType) -> str:
    if node_type == WorkflowNodeType.IMAGE_GENERATION:
        return "生图节点只能使用图片生成配置"
    if node_type == WorkflowNodeType.IMAGE_ENHANCE:
        return "图片增强节点只能使用图片生成配置"
    if node_type == WorkflowNodeType.TAIL_SPLITTER:
        return "尾巴节点只能使用文案生成配置"
    return "文案节点只能使用文案生成配置"


def _validate_manual_workflow_generation_config_selection(
    session: Session,
    *,
    selection: GenerationConfigSelection,
    purpose: str,
    purpose_error_message: str,
    for_execution: bool = False,
) -> None:
    if selection.mode != "manual":
        return
    if not selection.generation_config_id:
        _generation_resource_group_config_error("手动指定生成配置时必须选择配置", for_execution=for_execution)
    generation_config = session.get(GenerationConfig, selection.generation_config_id)
    if generation_config is None or generation_config.archived_at is not None:
        _generation_resource_group_config_error("生成配置不存在", for_execution=for_execution)
    if generation_config.purpose != purpose:
        _generation_resource_group_config_error(purpose_error_message, for_execution=for_execution)
    if selection.resource_group_id not in generation_config_resource_group_ids(generation_config):
        _generation_resource_group_config_error(
            "手动指定的生成配置不属于当前供应商生成分组",
            for_execution=for_execution,
        )


def _validate_workflow_generation_resource_groups(
    session: Session,
    *,
    workflow: InspirationWorkflow,
    node_ids_to_run: set[str],
    actor_user_id: str | None,
    actor_is_admin: bool,
) -> None:
    for node in workflow.nodes:
        if node.id not in node_ids_to_run or node.node_type not in WORKFLOW_RESOURCE_GROUP_NODE_TYPES:
            continue
        selection = _workflow_generation_config_selection(node.config_json)
        group = require_generation_resource_group_for_user(
            session,
            user_id=actor_user_id,
            is_admin=actor_is_admin,
            resource_group_id=selection.resource_group_id,
        )
        authorized_selection = GenerationConfigSelection(
            mode=selection.mode,
            generation_config_id=selection.generation_config_id,
            resource_group_id=group.id,
        )
        _validate_manual_workflow_generation_config_selection(
            session,
            selection=authorized_selection,
            purpose=_workflow_generation_config_purpose(node.node_type),
            purpose_error_message=_workflow_generation_config_purpose_error(node.node_type),
        )


def _workflow_generation_config_selection_for_execution(
    session: Session,
    *,
    workflow: InspirationWorkflow,
    node: WorkflowNode,
) -> GenerationConfigSelection:
    selection = _workflow_generation_config_selection(node.config_json, for_execution=True)
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
    _validate_manual_workflow_generation_config_selection(
        session,
        selection=authorized_selection,
        purpose=_workflow_generation_config_purpose(node.node_type),
        purpose_error_message=_workflow_generation_config_purpose_error(node.node_type),
        for_execution=True,
    )
    return authorized_selection


def start_inspiration_workflow_run(
    session: Session,
    *,
    inspiration_id: str,
    start_node_id: str | None = None,
    start_mode: str = "from_node",
    progress_metadata: dict[str, Any] | None = None,
    node_ids_to_run_override: set[str] | None = None,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
) -> WorkflowRunKickoff:
    ensure_provider_config_bootstrapped(session)
    workflow = get_or_create_inspiration_workflow(session, inspiration_id)
    session.expire(workflow, ["nodes", "edges", "runs"])
    ordered_nodes = inspiration_workflow_graph.topological_nodes(workflow)
    if start_node_id is not None:
        start_node = next((node for node in workflow.nodes if node.id == start_node_id), None)
        if start_node is None:
            raise BusinessValidationError("工作流节点不属于当前灵感产物")
        if (
            start_node.status == WorkflowNodeStatus.FAILED
            and start_node.failure_reason != WORKFLOW_CANCELLED_REASON
            and not workflow_node_failed_run_is_retryable(start_node, workflow.runs)
        ):
            raise BusinessValidationError("该工作流节点不可重试")
    elif start_mode == "after_node":
        raise BusinessValidationError("从节点后运行需要选择起始节点")
    node_ids_to_run = (
        node_ids_to_run_override
        if node_ids_to_run_override is not None
        else _node_ids_to_run(session, workflow, start_node_id, start_mode=start_mode)
    )
    node_ids_to_run = _runnable_node_ids(workflow, node_ids_to_run)
    node_ids_to_run = _exclude_generated_nodes_for_running_tails(workflow, node_ids_to_run)
    if not node_ids_to_run:
        raise BusinessValidationError("工作流没有可运行节点")
    validation_actor_user_id = actor_user_id or workflow.inspiration.owner_user_id
    validation_actor_is_admin = actor_is_admin or (
        actor_user_id is None and bool(workflow.inspiration.owner and workflow.inspiration.owner.is_admin)
    )
    _validate_workflow_generation_resource_groups(
        session,
        workflow=workflow,
        node_ids_to_run=node_ids_to_run,
        actor_user_id=validation_actor_user_id,
        actor_is_admin=validation_actor_is_admin,
    )
    active_run = _active_workflow_run_for_nodes(workflow, node_ids_to_run)
    if active_run is not None:
        return WorkflowRunKickoff(
            workflow=workflow,
            run_id=active_run.id,
            created=False,
            should_enqueue=_workflow_run_should_enqueue(active_run),
        )

    next_progress_metadata = dict(progress_metadata or {})
    next_progress_metadata.setdefault("run_mode", "selected" if start_node_id is not None else "full")
    if start_node_id is not None:
        next_progress_metadata.setdefault("start_node_id", start_node_id)
        next_progress_metadata.setdefault("start_mode", start_mode)
    run = WorkflowRun(
        workflow_id=workflow.id,
        status=WorkflowRunStatus.RUNNING,
        progress_metadata=next_progress_metadata or None,
    )
    logger.info(
        "创建灵感产物工作流运行: inspiration_id=%s workflow_id=%s start_node_id=%s",
        inspiration_id,
        workflow.id,
        start_node_id,
    )
    session.add(run)
    session.flush()
    for node in ordered_nodes:
        if node.id not in node_ids_to_run:
            continue
        node.status = WorkflowNodeStatus.QUEUED
        node.failure_reason = None
        node.last_run_at = now_utc()
        session.add(
            WorkflowNodeRun(
                workflow_run_id=run.id,
                node_id=node.id,
                status=WorkflowNodeStatus.QUEUED,
            )
        )
    workflow.updated_at = now_utc()
    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        workflow = inspiration_workflow_graph.get_workflow_or_raise(session, workflow.id)
        active_run = _active_workflow_run_for_nodes(workflow, node_ids_to_run)
        if active_run is not None:
            return WorkflowRunKickoff(
                workflow=workflow,
                run_id=active_run.id,
                created=False,
                should_enqueue=_workflow_run_should_enqueue(active_run),
            )
        raise
    session.expire_all()
    return WorkflowRunKickoff(
        workflow=inspiration_workflow_graph.get_workflow_or_raise(session, workflow.id),
        run_id=run.id,
        created=True,
        should_enqueue=True,
    )


def retry_inspiration_workflow_run(
    session: Session,
    *,
    inspiration_id: str,
    run_id: str | None = None,
    enqueue: Callable[[str], None] | None = None,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
) -> InspirationWorkflow:
    workflow = get_or_create_inspiration_workflow(session, inspiration_id)
    run = session.get(WorkflowRun, run_id) if run_id else _latest_failed_workflow_run(workflow)
    if run is None or run.workflow_id != workflow.id:
        raise NotFoundError("工作流运行不存在")
    if run.status != WorkflowRunStatus.FAILED:
        raise BusinessValidationError("只有失败的工作流运行可以重试")
    if not run.is_retryable:
        raise BusinessValidationError("该工作流运行不可重试")
    retry_node_ids = _workflow_run_retry_node_ids(run)
    node_ids_to_run = retry_node_ids if retry_node_ids is not None else _node_ids_to_run(session, workflow, None)
    if _active_workflow_run_for_nodes(workflow, node_ids_to_run) is not None:
        raise BusinessValidationError("相关节点运行中，不能重试")
    kickoff = start_inspiration_workflow_run(
        session,
        inspiration_id=inspiration_id,
        progress_metadata=_workflow_run_retry_progress_metadata(run),
        node_ids_to_run_override=retry_node_ids,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )
    if kickoff.should_enqueue:
        enqueue_or_mark_failed(
            kickoff.run_id,
            enqueue=lambda task_id: (enqueue or enqueue_workflow_run)(task_id),
            mark_failed=lambda task_id, reason: mark_workflow_run_enqueue_failed(
                session,
                run_id=task_id,
                reason=reason,
            ),
        )
        session.expire_all()
        return inspiration_workflow_graph.get_workflow_or_raise(session, kickoff.workflow.id)
    return kickoff.workflow


def submit_failed_workflow_nodes_run(
    session: Session,
    *,
    inspiration_id: str,
    enqueue: Callable[[str], None] | None = None,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
) -> InspirationWorkflow:
    workflow = get_or_create_inspiration_workflow(session, inspiration_id)
    node_ids_to_run = _failed_workflow_node_ids_to_retry(workflow)
    if _active_workflow_run_for_nodes(workflow, node_ids_to_run) is not None:
        raise BusinessValidationError("相关节点运行中，不能重试")
    kickoff = start_inspiration_workflow_run(
        session,
        inspiration_id=inspiration_id,
        progress_metadata={
            "run_mode": "failed_nodes",
            "manual_retry": True,
            "retry_node_ids": sorted(node_ids_to_run),
        },
        node_ids_to_run_override=node_ids_to_run,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )
    if kickoff.should_enqueue:
        enqueue_or_mark_failed(
            kickoff.run_id,
            enqueue=enqueue or enqueue_workflow_run,
            mark_failed=lambda run_id, reason: mark_workflow_run_enqueue_failed(
                session,
                run_id=run_id,
                reason=reason,
            ),
        )
        session.expire_all()
        return inspiration_workflow_graph.get_workflow_or_raise(session, kickoff.workflow.id)
    return kickoff.workflow


def cancel_inspiration_workflow_run(
    session: Session,
    *,
    inspiration_id: str,
    run_id: str | None = None,
) -> InspirationWorkflow:
    workflow = get_or_create_inspiration_workflow(session, inspiration_id)
    run = session.get(WorkflowRun, run_id) if run_id else _active_workflow_run(workflow)
    if run is None or run.workflow_id != workflow.id:
        raise NotFoundError("工作流运行不存在")
    if run.status == WorkflowRunStatus.CANCELLED:
        return inspiration_workflow_graph.get_workflow_or_raise(session, workflow.id)
    if run.status in {WorkflowRunStatus.SUCCEEDED, WorkflowRunStatus.FAILED}:
        raise BusinessValidationError("已结束的工作流运行不能取消")
    mark_workflow_run_cancelled(session, run_id=run.id)
    session.expire_all()
    return inspiration_workflow_graph.get_workflow_or_raise(session, workflow.id)


def run_inspiration_workflow(
    session: Session,
    *,
    inspiration_id: str,
    start_node_id: str | None = None,
    start_mode: str = "from_node",
    dependencies: WorkflowExecutionDependencies | None = None,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
) -> InspirationWorkflow:
    kickoff = start_inspiration_workflow_run(
        session,
        inspiration_id=inspiration_id,
        start_node_id=start_node_id,
        start_mode=start_mode,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )
    if kickoff.created:
        _execute_inspiration_workflow_run(
            session,
            run_id=kickoff.run_id,
            dependencies=dependencies,
            enqueue_node_run=lambda node_run_id: _execute_workflow_node_run(
                session,
                node_run_id=node_run_id,
                dependencies=dependencies,
                schedule_after_finish=False,
            ),
            return_after_dispatch=False,
        )
        session.expire_all()
        return inspiration_workflow_graph.get_workflow_or_raise(session, kickoff.workflow.id)
    return kickoff.workflow


def submit_inspiration_workflow_run(
    session: Session,
    *,
    inspiration_id: str,
    start_node_id: str | None = None,
    start_mode: str = "from_node",
    enqueue: Callable[[str], None] | None = None,
    progress_metadata: dict[str, Any] | None = None,
    actor_user_id: str | None = None,
    actor_is_admin: bool = False,
) -> InspirationWorkflow:
    kickoff = start_inspiration_workflow_run(
        session,
        inspiration_id=inspiration_id,
        start_node_id=start_node_id,
        start_mode=start_mode,
        progress_metadata=progress_metadata,
        actor_user_id=actor_user_id,
        actor_is_admin=actor_is_admin,
    )
    if kickoff.should_enqueue:
        enqueue_or_mark_failed(
            kickoff.run_id,
            enqueue=enqueue or enqueue_workflow_run,
            mark_failed=lambda run_id, reason: mark_workflow_run_enqueue_failed(
                session,
                run_id=run_id,
                reason=reason,
            ),
        )
    return kickoff.workflow


def _workflow_run_retry_progress_metadata(run: WorkflowRun) -> dict[str, Any] | None:
    if not run.failure_reason:
        return None
    previous = run.progress_metadata if isinstance(run.progress_metadata, dict) else {}
    metadata = workflow_run_failure_progress_metadata(reason=run.failure_reason, retryable=run.is_retryable)
    if isinstance(previous.get("last_failure_category"), str):
        metadata["last_failure_category"] = previous["last_failure_category"]
    if isinstance(previous.get("retry_hint"), str):
        metadata["retry_hint"] = previous["retry_hint"]
    if isinstance(previous.get("run_mode"), str):
        metadata["run_mode"] = previous["run_mode"]
    if isinstance(previous.get("start_node_id"), str):
        metadata["start_node_id"] = previous["start_node_id"]
    metadata["source_run_id"] = run.id
    metadata["manual_retry"] = True
    return metadata


def _failed_workflow_node_ids_to_retry(workflow: InspirationWorkflow) -> set[str]:
    failed_nodes = [
        node
        for node in workflow.nodes
        if node.status == WorkflowNodeStatus.FAILED and node.failure_reason != WORKFLOW_CANCELLED_REASON
        and _workflow_node_is_runnable(node)
    ]
    if not failed_nodes:
        raise BusinessValidationError("画布没有可重新运行的失败节点")
    non_retryable_nodes = [
        node for node in failed_nodes if not workflow_node_failed_run_is_retryable(node, workflow.runs)
    ]
    if non_retryable_nodes:
        raise BusinessValidationError("存在不可重试的失败节点，请调整节点设置或全局重试次数后重试")
    return {node.id for node in failed_nodes}


def _workflow_run_mode(run: WorkflowRun) -> str:
    metadata = run.progress_metadata if isinstance(run.progress_metadata, dict) else {}
    mode = metadata.get("run_mode")
    if mode in {"full", "selected"}:
        return str(mode)
    return "full" if len(run.node_runs) >= len(run.workflow.nodes) else "selected"


def execute_inspiration_workflow_run(
    run_id: str,
    *,
    dependencies: WorkflowExecutionDependencies | None = None,
) -> None:
    session_factory = get_session_factory()
    session = session_factory()
    try:
        try:
            _execute_inspiration_workflow_run(session, run_id=run_id, dependencies=dependencies)
        except TimeLimitExceeded as exc:
            session.rollback()
            failure = workflow_run_failure_context(exc)
            mark_workflow_run_failed(
                session,
                run_id=run_id,
                failed_node_id=None,
                **failure,
            )
        except Exception as exc:  # noqa: BLE001
            session.rollback()
            failure = workflow_run_failure_context(exc)
            mark_workflow_run_failed(
                session,
                run_id=run_id,
                failed_node_id=None,
                **failure,
            )
    finally:
        session.close()


def execute_inspiration_workflow_node_run(
    node_run_id: str,
    *,
    dependencies: WorkflowExecutionDependencies | None = None,
) -> None:
    session_factory = get_session_factory()
    session = session_factory()
    try:
        try:
            _execute_workflow_node_run(session, node_run_id=node_run_id, dependencies=dependencies)
        except TimeLimitExceeded as exc:
            session.rollback()
            _mark_node_run_failed_and_schedule(session, node_run_id=node_run_id, exc=exc)
        except Exception as exc:  # noqa: BLE001
            session.rollback()
            _mark_node_run_failed_and_schedule(session, node_run_id=node_run_id, exc=exc)
    finally:
        session.close()


def mark_workflow_run_enqueue_failed(session: Session, *, run_id: str, reason: str) -> None:
    """Mark a just-created workflow run failed when its durable queue message cannot be sent."""

    mark_workflow_run_failed(
        session,
        run_id=run_id,
        failed_node_id=None,
        reason=reason[:1000],
    )


def _execute_inspiration_workflow_run(
    session: Session,
    *,
    run_id: str,
    dependencies: WorkflowExecutionDependencies | None = None,
    enqueue_node_run: Callable[[str], None] | None = None,
    return_after_dispatch: bool = True,
) -> None:
    dispatch_node_run = enqueue_node_run or enqueue_workflow_node_run
    queries = WorkflowQueryService(session)
    run = session.get(WorkflowRun, run_id)
    if run is None:
        return
    if not WORKFLOW_RUN_GENERATION_TASK_CONTRACT.is_running(run.status):
        return
    workflow = queries.get_workflow_or_raise(run.workflow_id)
    rule_nodes = _workflow_rule_nodes(workflow)
    rule_edges = _workflow_rule_edges(workflow)

    while True:
        session.expire(run, ["status", "node_runs"])
        session.refresh(run)
        if run.status == WorkflowRunStatus.CANCELLED:
            return
        if not WORKFLOW_RUN_GENERATION_TASK_CONTRACT.is_running(run.status):
            return
        node_runs = list(run.node_runs)

        node_runs_by_node_id = {node_run.node_id: node_run for node_run in node_runs}
        queued_node_ids = {
            node_run.node_id
            for node_run in node_runs
            if WORKFLOW_RUN_GENERATION_TASK_CONTRACT.execution_is_queued(node_run.status)
        }
        succeeded_node_ids = {
            node_run.node_id for node_run in node_runs if node_run.status == WorkflowNodeStatus.SUCCEEDED
        }
        if _finalize_workflow_run_if_terminal(session, run=run):
            return

        ready_node_ids = ready_workflow_node_ids(
            nodes=rule_nodes,
            edges=rule_edges,
            run_node_ids=node_runs_by_node_id.keys(),
            queued_node_ids=queued_node_ids,
            succeeded_node_ids=succeeded_node_ids,
        )
        if ready_node_ids:
            for ready_node_id in ready_node_ids:
                node_run = node_runs_by_node_id.get(ready_node_id)
                if node_run is None:
                    continue
                try:
                    dispatch_node_run(node_run.id)
                except Exception as exc:  # noqa: BLE001
                    logger.exception("工作流节点运行入队失败: workflow_node_run_id=%s", node_run.id)
                    failure = workflow_run_failure_context(exc)
                    mark_workflow_run_failed(session, run_id=run_id, failed_node_id=None, **failure)
                    return
            if return_after_dispatch:
                return
            continue

        if _mark_blocked_workflow_node_runs_failed(session, run=run, workflow=workflow):
            continue
        if any(WORKFLOW_RUN_GENERATION_TASK_CONTRACT.execution_is_running(node_run.status) for node_run in node_runs):
            return
        mark_workflow_run_failed(
            session,
            run_id=run_id,
            failed_node_id=None,
            reason="工作流调度失败：没有可执行的就绪节点",
        )
        return


def _execute_workflow_node_run(
    session: Session,
    *,
    node_run_id: str,
    dependencies: WorkflowExecutionDependencies | None = None,
    schedule_after_finish: bool = True,
) -> None:
    queries = WorkflowQueryService(session)
    node_run = session.get(WorkflowNodeRun, node_run_id)
    if node_run is None:
        return
    run = node_run.workflow_run
    if not WORKFLOW_RUN_GENERATION_TASK_CONTRACT.is_running(run.status):
        return
    if not WORKFLOW_RUN_GENERATION_TASK_CONTRACT.execution_is_queued(node_run.status):
        return
    workflow = queries.get_workflow_or_raise(run.workflow_id)
    node = queries.get_node_or_raise(node_run.node_id)
    claim = claim_workflow_node_run(
        session,
        node_run_id=node_run.id,
        node_id=node.id,
        capacity_pool=generation_capacity_pool_for_workflow_node_type(node.node_type),
    )
    if not claim.claimed:
        if claim.should_requeue:
            requeue_workflow_node_run_after_capacity_wait(node_run_id)
        return
    node = queries.get_node_or_raise(node_run.node_id)
    node_run = session.get(WorkflowNodeRun, node_run_id)
    if node_run is None:
        return
    try:
        logger.info(
            "开始执行工作流节点: run_id=%s node_id=%s node_type=%s",
            run.id,
            node.id,
            node.node_type.value,
        )
        output = _execute_node(
            session,
            workflow_id=workflow.id,
            node=node,
            node_run_id=node_run_id,
            dependencies=dependencies,
        )
    except GenerationConfigWaitError:
        session.rollback()
        _reset_workflow_node_run_for_generation_config_wait(session, node_run_id=node_run_id)
        if schedule_after_finish:
            requeue_workflow_node_run_after_capacity_wait(node_run_id)
        return
    except TimeLimitExceeded as exc:
        session.rollback()
        _mark_node_run_failed_and_schedule(
            session,
            node_run_id=node_run_id,
            exc=exc,
            schedule_after_finish=schedule_after_finish,
        )
        return
    except Exception as exc:  # noqa: BLE001
        session.rollback()
        _mark_node_run_failed_and_schedule(
            session,
            node_run_id=node_run_id,
            exc=exc,
            schedule_after_finish=schedule_after_finish,
        )
        return

    session.refresh(run)
    node_run = session.get(WorkflowNodeRun, node_run_id)
    if node_run is None:
        session.rollback()
        return
    session.refresh(node_run)
    if run.status == WorkflowRunStatus.CANCELLED:
        session.rollback()
        return
    if not WORKFLOW_RUN_GENERATION_TASK_CONTRACT.is_running(run.status):
        session.rollback()
        return
    if not WORKFLOW_RUN_GENERATION_TASK_CONTRACT.execution_is_running(node_run.status):
        session.rollback()
        return

    node.output_json = output
    node.status = WorkflowNodeStatus.SUCCEEDED
    node.failure_reason = None
    node.last_run_at = now_utc()
    node_run.status = WorkflowNodeStatus.SUCCEEDED
    node_run.output_json = output
    node_run.copy_set_id = output.get("copy_set_id")
    output_resource_group_id = output.get("resource_group_id")
    node_run.resource_group_id = output_resource_group_id
    if isinstance(output.get("generated_poster_variant_ids"), list):
        poster_ids = output["generated_poster_variant_ids"]
    else:
        poster_ids = output.get("poster_variant_ids") if isinstance(output.get("poster_variant_ids"), list) else []
    node_run.poster_variant_id = poster_ids[0] if poster_ids else output.get("poster_variant_id")
    node_run.image_session_asset_id = output.get("image_session_asset_id")
    node_run.finished_at = now_utc()
    if node.node_type == WorkflowNodeType.TAIL_SPLITTER:
        _append_tail_pending_confirmation_from_output(run=run, node=node, node_run=node_run, output=output)
    if isinstance(output_resource_group_id, str) and output_resource_group_id.strip():
        workflow.inspiration.resource_group_id = output_resource_group_id.strip()
        workflow.inspiration.updated_at = now_utc()
    workflow.updated_at = now_utc()
    session.commit()
    logger.info("工作流节点执行成功: run_id=%s node_id=%s", run.id, node.id)
    if schedule_after_finish:
        _enqueue_workflow_run_safely(run.id)


def _reset_workflow_node_run_for_generation_config_wait(session: Session, *, node_run_id: str) -> None:
    node_run = session.get(WorkflowNodeRun, node_run_id)
    if node_run is None:
        return
    if not WORKFLOW_RUN_GENERATION_TASK_CONTRACT.execution_is_running(node_run.status):
        return
    now = now_utc()
    node_run.status = WORKFLOW_RUN_GENERATION_TASK_CONTRACT.execution_queued_statuses[0]
    node_run.failure_reason = None
    node_run.finished_at = None
    node_run.started_at = now
    node = session.get(WorkflowNode, node_run.node_id)
    if node is not None:
        node.status = WorkflowNodeStatus.QUEUED
        node.failure_reason = None
        node.last_run_at = now
    session.commit()


def _mark_node_run_failed_and_schedule(
    session: Session,
    *,
    node_run_id: str,
    exc: BaseException,
    schedule_after_finish: bool = True,
) -> None:
    failure = workflow_run_failure_context(exc)
    run_id = mark_workflow_node_run_failed(session, node_run_id=node_run_id, **failure)
    if run_id is not None and schedule_after_finish:
        _enqueue_workflow_run_safely(run_id)


def _enqueue_workflow_run_safely(run_id: str) -> None:
    try:
        enqueue_workflow_run(run_id)
    except Exception:  # noqa: BLE001
        logger.exception("工作流节点完成后调度运行失败: workflow_run_id=%s", run_id)


def _workflow_rule_nodes(workflow: InspirationWorkflow) -> list[WorkflowRuleNode]:
    return [
        WorkflowRuleNode(
            id=node.id,
            node_type=node.node_type,
            position_x=node.position_x,
            config_json=node.config_json,
        )
        for node in workflow.nodes
    ]


def _workflow_rule_edges(workflow: InspirationWorkflow) -> list[WorkflowRuleEdge]:
    return [
        WorkflowRuleEdge(source_node_id=edge.source_node_id, target_node_id=edge.target_node_id)
        for edge in workflow.edges
    ]


def _incoming_node_ids_by_target(rule_edges: list[WorkflowRuleEdge]) -> dict[str, list[str]]:
    incoming: dict[str, list[str]] = {}
    for edge in rule_edges:
        incoming.setdefault(edge.target_node_id, []).append(edge.source_node_id)
    return incoming


def _mark_blocked_workflow_node_runs_failed(
    session: Session,
    *,
    run: WorkflowRun,
    workflow: InspirationWorkflow,
) -> bool:
    incoming = _incoming_node_ids_by_target(_workflow_rule_edges(workflow))
    run_node_ids = {node_run.node_id for node_run in run.node_runs}
    failed_node_ids = {node_run.node_id for node_run in run.node_runs if node_run.status == WorkflowNodeStatus.FAILED}
    changed = False
    while True:
        changed_this_pass = False
        now = now_utc()
        for node_run in run.node_runs:
            if not WORKFLOW_RUN_GENERATION_TASK_CONTRACT.execution_is_queued(node_run.status):
                continue
            has_failed_upstream = any(
                source_id in run_node_ids and source_id in failed_node_ids
                for source_id in incoming.get(node_run.node_id, [])
            )
            if not has_failed_upstream:
                continue
            node = session.get(WorkflowNode, node_run.node_id)
            if node is not None:
                node.status = WorkflowNodeStatus.FAILED
                node.failure_reason = "上游节点失败"
                node.last_run_at = now
            node_run.status = WorkflowNodeStatus.FAILED
            node_run.failure_reason = "上游节点失败"
            node_run.finished_at = now
            failed_node_ids.add(node_run.node_id)
            changed = True
            changed_this_pass = True
        if not changed_this_pass:
            break
    if changed:
        run.workflow.updated_at = now_utc()
        session.commit()
    return changed


def _finalize_workflow_run_if_terminal(session: Session, *, run: WorkflowRun) -> bool:
    node_runs = list(run.node_runs)
    if any(
        WORKFLOW_RUN_GENERATION_TASK_CONTRACT.execution_is_queued(node_run.status)
        or WORKFLOW_RUN_GENERATION_TASK_CONTRACT.execution_is_running(node_run.status)
        for node_run in node_runs
    ):
        return False
    now = now_utc()
    if node_runs and all(node_run.status == WorkflowNodeStatus.SUCCEEDED for node_run in node_runs):
        if run_has_pending_tail_confirmations(run):
            run.status = WorkflowRunStatus.WAITING_CONFIRMATION
            run.failure_reason = None
            run.finished_at = None
            run.workflow.updated_at = now
            logger.info("工作流等待尾巴确认: run_id=%s workflow_id=%s", run.id, run.workflow_id)
            session.commit()
            return True
        run.status = WorkflowRunStatus.SUCCEEDED
        run.finished_at = now
        run.workflow.updated_at = now
        logger.info("工作流运行成功: run_id=%s workflow_id=%s", run.id, run.workflow_id)
        session.commit()
        publish_workflow_run_notification_safely(run)
        return True
    failed_node_run = next(
        (
            node_run
            for node_run in node_runs
            if node_run.status == WorkflowNodeStatus.FAILED and node_run.failure_reason != "上游节点失败"
        ),
        None,
    ) or next((node_run for node_run in node_runs if node_run.status == WorkflowNodeStatus.FAILED), None)
    reason = (
        failed_node_run.failure_reason if failed_node_run and failed_node_run.failure_reason else "工作流部分节点失败"
    )
    failure_metadata = run.progress_metadata if isinstance(run.progress_metadata, dict) else {}
    is_retryable = failure_metadata.get("last_failure_retryable")
    if not isinstance(is_retryable, bool):
        is_retryable = True
    retry_hint = failure_metadata.get("retry_hint")
    failure_category = failure_metadata.get("last_failure_category")
    metadata_reason = failure_metadata.get("last_failure_reason")
    if is_retryable is False and isinstance(metadata_reason, str):
        reason = metadata_reason
    run.status = WorkflowRunStatus.FAILED
    run.failure_reason = reason
    run.is_retryable = is_retryable
    run.progress_metadata = workflow_run_failure_progress_metadata(
        reason=reason,
        retryable=is_retryable,
        retry_hint=retry_hint if isinstance(retry_hint, str) else None,
        failure_category=failure_category if isinstance(failure_category, str) else None,
    )
    run.finished_at = now
    run.workflow.updated_at = now
    logger.warning("工作流运行失败: run_id=%s reason=%s", run.id, reason)
    session.commit()
    publish_workflow_run_notification_safely(run)
    return True


def _append_tail_pending_confirmation_from_output(
    *,
    run: WorkflowRun,
    node: WorkflowNode,
    node_run: WorkflowNodeRun,
    output: dict[str, Any],
) -> None:
    latest_plan = output.get("latest_plan")
    if not isinstance(latest_plan, dict):
        return
    plan_id = latest_plan.get("plan_id")
    if not isinstance(plan_id, str) or not plan_id.strip():
        return
    append_pending_tail_confirmation(
        run,
        tail_node_id=node.id,
        plan_id=plan_id,
        node_run_id=node_run.id,
    )


def _node_ids_to_run(
    session: Session,
    workflow: InspirationWorkflow,
    start_node_id: str | None,
    *,
    start_mode: str = "from_node",
) -> set[str]:
    if start_node_id is None:
        return _runnable_node_ids(workflow, {node.id for node in workflow.nodes})
    if start_mode not in {"from_node", "after_node"}:
        raise BusinessValidationError("工作流运行模式不支持")
    rule_nodes = [
        WorkflowRuleNode(
            id=node.id,
            node_type=node.node_type,
            position_x=node.position_x,
            config_json=node.config_json,
        )
        for node in workflow.nodes
    ]
    rule_edges = [
        WorkflowRuleEdge(source_node_id=edge.source_node_id, target_node_id=edge.target_node_id)
        for edge in workflow.edges
    ]
    nodes_by_id = {node.id: node for node in workflow.nodes}
    if start_node_id not in nodes_by_id:
        raise BusinessValidationError("工作流节点不属于当前灵感产物")
    reusable_edges: set[tuple[str, str]] = set()
    for edge in workflow.edges:
        source_node = nodes_by_id.get(edge.source_node_id)
        target_node = nodes_by_id.get(edge.target_node_id)
        if source_node is None or target_node is None:
            raise BusinessValidationError("工作流连线引用了不存在的节点")
        if _node_has_reusable_output(session, workflow, source_node, target_node=target_node):
            reusable_edges.add((edge.source_node_id, edge.target_node_id))
    if start_mode == "after_node":
        downstream_node_ids = _downstream_node_ids(workflow, start_node_id)
        if not downstream_node_ids:
            return set()
        reusable_edges_with_start = {
            *reusable_edges,
            *{
                (edge.source_node_id, edge.target_node_id)
                for edge in workflow.edges
                if edge.source_node_id == start_node_id
            },
        }
        node_ids_to_run: set[str] = set()
        for downstream_node_id in downstream_node_ids:
            node_ids_to_run.update(
                selected_node_execution_plan(
                    nodes=rule_nodes,
                    edges=rule_edges,
                    start_node_id=downstream_node_id,
                    reusable_edges=reusable_edges_with_start,
                )
            )
        node_ids_to_run.discard(start_node_id)
        return _runnable_node_ids(workflow, node_ids_to_run)
    return _runnable_node_ids(
        workflow,
        selected_node_execution_plan(
        nodes=rule_nodes,
        edges=rule_edges,
        start_node_id=start_node_id,
        reusable_edges=reusable_edges,
        ),
    )


def _downstream_node_ids(workflow: InspirationWorkflow, start_node_id: str) -> set[str]:
    outgoing: dict[str, list[str]] = {}
    for edge in workflow.edges:
        outgoing.setdefault(edge.source_node_id, []).append(edge.target_node_id)
    seen: set[str] = set()
    pending = list(outgoing.get(start_node_id, []))
    while pending:
        node_id = pending.pop()
        if node_id in seen:
            continue
        seen.add(node_id)
        pending.extend(outgoing.get(node_id, []))
    return seen


def _exclude_generated_nodes_for_running_tails(
    workflow: InspirationWorkflow,
    node_ids_to_run: set[str],
) -> set[str]:
    running_tail_node_ids = {
        node.id
        for node in workflow.nodes
        if node.id in node_ids_to_run and node.node_type == WorkflowNodeType.TAIL_SPLITTER
    }
    if not running_tail_node_ids:
        return node_ids_to_run
    generated_node_ids = {
        node.id for node in workflow.nodes if _generated_tail_node_id(node.config_json) in running_tail_node_ids
    }
    return node_ids_to_run - generated_node_ids


def _generated_tail_node_id(config_json: dict[str, Any] | None) -> str | None:
    if not isinstance(config_json, dict):
        return None
    generated_by = config_json.get("generated_by")
    if not isinstance(generated_by, dict):
        return None
    tail_node_id = generated_by.get("tail_node_id")
    return tail_node_id if isinstance(tail_node_id, str) else None


def _node_has_reusable_output(
    session: Session,
    workflow: InspirationWorkflow,
    node: WorkflowNode,
    *,
    target_node: WorkflowNode | None = None,
) -> bool:
    queries = WorkflowQueryService(session)
    if node.node_type == WorkflowNodeType.INSPIRATION_CONTEXT:
        return True
    if node.status != WorkflowNodeStatus.SUCCEEDED:
        return False
    output = node.output_json or {}
    if node.node_type == WorkflowNodeType.REFERENCE_IMAGE:
        return _node_has_valid_reference_assets(session, workflow.inspiration_id, node)
    if node.node_type == WorkflowNodeType.COPY_GENERATION:
        copy_set_id = output.get("copy_set_id")
        if not isinstance(copy_set_id, str):
            return False
        return queries.copy_set_for_inspiration(copy_set_id, workflow.inspiration_id) is not None
    if node.node_type == WorkflowNodeType.TAIL_SPLITTER:
        latest_plan = output.get("latest_plan")
        return isinstance(latest_plan, dict) and isinstance(latest_plan.get("plan_id"), str)
    if node.node_type in {WorkflowNodeType.IMAGE_GENERATION, WorkflowNodeType.IMAGE_ENHANCE}:
        if target_node is not None and target_node.node_type == WorkflowNodeType.REFERENCE_IMAGE:
            return _image_generation_filled_reference_target(
                session,
                workflow=workflow,
                image_node=node,
                reference_node=target_node,
            )
        poster_ids = output.get("poster_variant_ids")
        if not isinstance(poster_ids, list):
            poster_ids = output.get("generated_poster_variant_ids")
        filled_ids = output.get("filled_source_asset_ids")
        source_asset_ids = source_asset_ids_from_config(output)
        if isinstance(filled_ids, list):
            source_asset_ids.extend(item for item in filled_ids if isinstance(item, str))
        has_source_assets = _valid_source_asset_ids(session, workflow.inspiration_id, source_asset_ids)
        has_posters = False
        if isinstance(poster_ids, list):
            posters = queries.posters_by_ids([item for item in poster_ids if isinstance(item, str)])
            has_posters = any(poster.inspiration_id == workflow.inspiration_id for poster in posters)
        return has_source_assets or has_posters
    return False


def _image_generation_filled_reference_target(
    session: Session,
    *,
    workflow: InspirationWorkflow,
    image_node: WorkflowNode,
    reference_node: WorkflowNode,
) -> bool:
    """Return whether an image node's previous output satisfies a specific reference slot edge."""
    output = image_node.output_json or {}
    filled_reference_node_ids = output.get("filled_reference_node_ids")
    output_names_target = isinstance(filled_reference_node_ids, list) and reference_node.id in filled_reference_node_ids
    target_has_assets = _node_has_valid_reference_assets(session, workflow.inspiration_id, reference_node)
    if output_names_target:
        return target_has_assets
    # Older outputs may not name filled reference nodes. The target slot itself is still authoritative: if it
    # already exposes a live first-class image artifact, the upstream image node does not need to rerun.
    return target_has_assets


def _node_has_valid_reference_assets(session: Session, inspiration_id: str, node: WorkflowNode) -> bool:
    asset_ids = list(
        dict.fromkeys(
            [
                *source_asset_ids_from_config(node.output_json or {}),
                *source_asset_ids_from_config(node.config_json or {}),
            ]
        )
    )
    return _valid_source_asset_ids(session, inspiration_id, asset_ids)


def _valid_source_asset_ids(session: Session, inspiration_id: str, asset_ids: list[str]) -> bool:
    return WorkflowQueryService(session).has_any_source_asset_for_inspiration(inspiration_id, asset_ids)


def _should_execute_missing_upstream(source_node: WorkflowNode, target_node: WorkflowNode) -> bool:
    return should_execute_missing_upstream(
        WorkflowRuleNode(
            id=source_node.id,
            node_type=source_node.node_type,
            position_x=source_node.position_x,
            config_json=source_node.config_json,
        ),
        WorkflowRuleNode(
            id=target_node.id,
            node_type=target_node.node_type,
            position_x=target_node.position_x,
            config_json=target_node.config_json,
        ),
    )


def _execute_node(
    session: Session,
    *,
    workflow_id: str,
    node: WorkflowNode,
    node_run_id: str | None = None,
    dependencies: WorkflowExecutionDependencies | None = None,
) -> dict[str, Any]:
    workflow = inspiration_workflow_graph.get_workflow_or_raise(session, workflow_id)
    dependencies = dependencies or default_workflow_execution_dependencies()
    if node.node_type == WorkflowNodeType.INSPIRATION_CONTEXT:
        return _execute_inspiration_context(workflow, node)
    if node.node_type == WorkflowNodeType.REFERENCE_IMAGE:
        return _execute_reference_image(session, workflow=workflow, node=node)
    if node.node_type == WorkflowNodeType.COPY_GENERATION:
        return _execute_copy_generation(session, workflow=workflow, node=node, dependencies=dependencies)
    if node.node_type == WorkflowNodeType.TAIL_SPLITTER:
        return _execute_tail_splitter(session, workflow=workflow, node=node, dependencies=dependencies)
    if node.node_type == WorkflowNodeType.IMAGE_GENERATION:
        return execute_workflow_image_generation(session, workflow=workflow, node=node, dependencies=dependencies)
    if node.node_type == WorkflowNodeType.IMAGE_ENHANCE:
        return execute_workflow_image_enhance(
            session,
            workflow=workflow,
            node=node,
            node_run_id=node_run_id,
            generation_config_selection=_workflow_generation_config_selection_for_execution(
                session,
                workflow=workflow,
                node=node,
            ),
        )
    if node.node_type == WorkflowNodeType.DECK_GENERATION:
        raise WorkflowSafeExecutionError(
            "请在画布演示节点中编辑",
            retryable=False,
            retry_hint="revise_input",
            failure_category="invalid_node_type",
        )
    raise BusinessValidationError("工作流节点类型不支持")


def _execute_inspiration_context(workflow: InspirationWorkflow, node: WorkflowNode) -> dict[str, Any]:
    return inspiration_context_output(workflow.inspiration, node, workflow=workflow)


def _execute_reference_image(session: Session, *, workflow: InspirationWorkflow, node: WorkflowNode) -> dict[str, Any]:
    asset_ids = source_asset_ids_from_config(node.config_json)
    assets = WorkflowQueryService(session).source_assets_by_ids(asset_ids)
    assets = [asset for asset in assets if asset.inspiration_id == workflow.inspiration_id]
    if not assets:
        return image_asset_output([], summary="参考图为空")
    return image_asset_output(
        assets,
        summary=f"参考图 {len(assets)} 张",
        role=optional_config_text(node.config_json, "role"),
        label=optional_config_text(node.config_json, "label") or node.title,
    )


def _execute_copy_generation(
    session: Session,
    *,
    workflow: InspirationWorkflow,
    node: WorkflowNode,
    dependencies: WorkflowExecutionDependencies | None = None,
) -> dict[str, Any]:
    dependencies = dependencies or default_workflow_execution_dependencies()
    inspiration = workflow.inspiration
    inspiration_context = effective_inspiration_context(workflow, node.id)
    has_inspiration_context = any(value not in (None, {}, []) for value in inspiration_context.values())
    existing_output = node.output_json or {}
    existing_copy_set_id = existing_output.get("copy_set_id")
    if existing_output.get("manual_edit") is True and isinstance(existing_copy_set_id, str):
        copy_set = session.get(CopySet, existing_copy_set_id)
        if copy_set is not None and copy_set.inspiration_id == inspiration.id:
            return copy_node_output(copy_set, creative_brief_id=copy_set.creative_brief_id, manual_edit=True)

    storage = LocalStorage()
    source = find_source_asset(inspiration) if has_inspiration_context else None
    source_image = (
        ReferenceImageInput(
            bytes_data=storage.read_bytes(storage.object_key_for(source), max_bytes=WORKFLOW_SOURCE_IMAGE_MAX_BYTES),
            mime_type=source.mime_type,
            filename=source.original_filename,
            role="灵感主图",
            label="灵感主图",
            source_key=storage.object_key_for(source),
        )
        if source is not None
        else None
    )
    inspiration_input = InspirationInput(
        name=inspiration_context["name"] or "自由创作",
        category=inspiration_context["category"],
        price=inspiration_context["price"],
        source_note=inspiration_context["source_note"],
        source_image=source_image,
    )
    incoming_context = collect_incoming_context(workflow, node.id)
    reference_images = reference_image_inputs_for_copy(
        session,
        workflow=workflow,
        node_id=node.id,
        storage=storage,
        incoming_context=incoming_context,
    )
    config = _normalize_copy_node_config_for_execution(node.config_json)
    instruction = instruction_with_upstream_text(
        config.instruction,
        incoming_context,
    )
    config = config.model_copy(update={"instruction": instruction})
    generation_config_selection = _workflow_generation_config_selection_for_execution(
        session,
        workflow=workflow,
        node=node,
    )
    runtime_claim = claim_runtime_generation_config(
        purpose="text",
        selection=generation_config_selection,
        require_image_understanding=bool(inspiration_input.source_image or reference_images),
        session=session,
    )
    try:
        provider = dependencies.text_provider(runtime_claim.generation_config_id, session=session)
        brief_payload, brief_model = _generate_brief_with_provider(provider, inspiration_input, node_id=node.id)
        copy_payload, copy_model = _generate_copy_with_provider(
            provider,
            inspiration_input,
            brief_payload,
            config=config,
            reference_images=reference_images,
            node_id=node.id,
        )
    except BaseException as exc:  # noqa: BLE001
        session.rollback()
        release_runtime_generation_config(
            runtime_claim,
            success=False,
            user_id=inspiration.owner_user_id,
            generated_unit_count=0,
            failure_reason=generation_failure_reason(exc),
            timeout=generation_failure_is_timeout(exc),
            throttled=generation_failure_is_throttled(exc),
        )
        raise
    release_runtime_generation_config(
        runtime_claim,
        success=True,
        session=session,
        user_id=inspiration.owner_user_id,
        generated_unit_count=2,
    )
    brief = CreativeBrief(
        inspiration_id=inspiration.id,
        payload=brief_payload.model_dump(),
        provider_name=provider.provider_name,
        model_name=brief_model,
        prompt_version=provider.prompt_version,
        resource_group_id=runtime_claim.resource_group_id,
    )
    session.add(brief)
    session.flush()

    structured_payload = copy_payload.model_dump(mode="json")
    copy_set = CopySet(
        inspiration_id=inspiration.id,
        creative_brief_id=brief.id,
        status=CopyStatus.DRAFT,
        structured_payload=structured_payload,
        model_structured_payload=structured_payload,
        provider_name=provider.provider_name,
        model_name=copy_model,
        prompt_version=provider.prompt_version,
        resource_group_id=runtime_claim.resource_group_id,
    )
    session.add(copy_set)
    session.flush()
    inspiration.updated_at = now_utc()
    output = copy_node_output(copy_set, creative_brief_id=brief.id)
    output["instruction"] = instruction
    output["context_summary"] = {
        "inspiration_context": inspiration_context,
        "reference_image_count": len(reference_images),
        "upstream_text_count": len(incoming_context.text_contexts),
    }
    output["context_sources"] = incoming_context.text_sources[:8]
    output["generation_config_id"] = runtime_claim.generation_config_id
    output["resource_group_id"] = runtime_claim.resource_group_id
    return output


def _execute_tail_splitter(
    session: Session,
    *,
    workflow: InspirationWorkflow,
    node: WorkflowNode,
    dependencies: WorkflowExecutionDependencies | None = None,
) -> dict[str, Any]:
    dependencies = dependencies or default_workflow_execution_dependencies()
    inspiration = workflow.inspiration
    storage = LocalStorage()
    config = _normalize_tail_splitter_config_for_execution(node.config_json)
    inspiration_context = effective_inspiration_context(workflow, node.id, include_transitive=True)
    incoming_context = collect_incoming_context(workflow, node.id, include_transitive_inspiration_context=True)
    reference_images = reference_image_inputs_for_tail(
        session,
        workflow=workflow,
        node_id=node.id,
        storage=storage,
        incoming_context=incoming_context,
    )
    payload = TailSplitPlanInput(
        inspiration_name=inspiration_context["name"] or inspiration.name or "自由创作",
        category=inspiration_context["category"],
        price=inspiration_context["price"],
        source_note=inspiration_context["source_note"],
        source_text=config.source_text,
        description=config.description,
        upstream_text_contexts=incoming_context.text_contexts,
        reference_images=reference_images,
        max_items=config.max_items,
    )
    generation_config_selection = _workflow_generation_config_selection_for_execution(
        session,
        workflow=workflow,
        node=node,
    )
    runtime_claim = claim_runtime_generation_config(
        purpose="text",
        selection=generation_config_selection,
        require_image_understanding=bool(reference_images),
        session=session,
    )
    try:
        provider = dependencies.text_provider(runtime_claim.generation_config_id, session=session)
        draft, model_name = _call_text_provider_with_payload_retry(
            lambda: provider.generate_tail_split_plan(payload),
            operation="tail_split",
            node_id=node.id,
        )
    except BaseException as exc:  # noqa: BLE001
        session.rollback()
        release_runtime_generation_config(
            runtime_claim,
            success=False,
            user_id=inspiration.owner_user_id,
            generated_unit_count=0,
            failure_reason=generation_failure_reason(exc),
            timeout=generation_failure_is_timeout(exc),
            throttled=generation_failure_is_throttled(exc),
        )
        raise
    release_runtime_generation_config(
        runtime_claim,
        success=True,
        session=session,
        user_id=inspiration.owner_user_id,
        generated_unit_count=len(draft.items),
    )
    output = build_tail_split_plan_output(draft, existing_output_json=node.output_json).model_dump(mode="json")
    output["context_summary"] = {
        "inspiration_context": inspiration_context,
        "upstream_text_count": len(incoming_context.text_contexts),
        "reference_image_count": len(reference_images),
        "source_text_length": len(config.source_text),
    }
    output["context_sources"] = incoming_context.text_sources[:8]
    output["generation_config_id"] = runtime_claim.generation_config_id
    output["resource_group_id"] = runtime_claim.resource_group_id
    output["provider_name"] = provider.provider_name
    output["model_name"] = model_name
    output["prompt_version"] = provider.prompt_version
    return output


def _normalize_copy_node_config_for_execution(raw_config: dict[str, Any] | None):
    try:
        return normalize_copy_node_config(raw_config)
    except (ValidationError, ValueError) as exc:
        raise WorkflowSafeExecutionError(
            "文案节点配置无效，请调整节点设置后重试",
            retryable=False,
            retry_hint="revise_input",
            failure_category="invalid_node_config",
        ) from exc


def _normalize_tail_splitter_config_for_execution(raw_config: dict[str, Any] | None):
    try:
        return read_tail_splitter_config_for_runtime(raw_config)
    except ValueError as exc:
        detail = str(exc) or "尾巴节点配置无效，请调整节点设置后重试"
        raise WorkflowSafeExecutionError(
            detail,
            retryable=False,
            retry_hint="revise_input",
            failure_category="invalid_node_config",
        ) from exc


def _generate_brief_with_provider(
    provider: Any,
    inspiration_input: InspirationInput,
    *,
    node_id: str,
) -> tuple[Any, str]:
    return _call_text_provider_with_payload_retry(
        lambda: provider.generate_brief(inspiration_input),
        operation="brief",
        node_id=node_id,
    )


def _generate_copy_with_provider(
    provider: Any,
    inspiration_input: InspirationInput,
    brief_payload: Any,
    *,
    config: Any,
    reference_images: list[Any],
    node_id: str | None = None,
) -> tuple[Any, str]:
    def generate_once() -> tuple[Any, str]:
        copy_payload, model_name = provider.generate_copy(
            inspiration_input,
            brief_payload,
            config=config,
            reference_images=reference_images,
        )
        return normalize_copy_payload(copy_payload.model_dump(mode="json"), fallback_purpose=config.purpose), model_name

    return _call_text_provider_with_payload_retry(
        generate_once,
        operation="copy",
        node_id=node_id,
    )


def _call_text_provider_with_payload_retry(
    call: Callable[[], tuple[Any, str]],
    *,
    operation: str,
    node_id: str | None,
) -> tuple[Any, str]:
    for attempt in range(1, COPY_PROVIDER_CONTRACT_MAX_ATTEMPTS + 1):
        try:
            return call()
        except (ValidationError, ValueError) as exc:
            if isinstance(exc, BusinessError) or attempt >= COPY_PROVIDER_CONTRACT_MAX_ATTEMPTS:
                raise
            logger.warning(
                "文案 provider 返回字段不匹配，准备重试: operation=%s node_id=%s attempt=%s max_attempts=%s "
                "error_class=%s",
                operation,
                node_id,
                attempt,
                COPY_PROVIDER_CONTRACT_MAX_ATTEMPTS,
                exc.__class__.__name__,
            )
    raise RuntimeError("unreachable text provider retry state")
