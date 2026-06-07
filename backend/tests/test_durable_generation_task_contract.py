from __future__ import annotations

import pytest

from inspiration_one_backend.application.queue_submission import enqueue_or_mark_failed
from inspiration_one_backend.domain.durable_generation_tasks import (
    IMAGE_SESSION_GENERATION_TASK_CONTRACT,
    QUEUE_UNAVAILABLE_DETAIL,
    WORKFLOW_RUN_GENERATION_TASK_CONTRACT,
    assert_actor_uses_durable_generation_contract,
)
from inspiration_one_backend.domain.enums import JobStatus, WorkflowNodeStatus, WorkflowRunStatus
from inspiration_one_backend.domain.errors import QueueUnavailableError


def test_durable_generation_task_contract_keeps_workflow_and_image_models_separate() -> None:
    assert WORKFLOW_RUN_GENERATION_TASK_CONTRACT.durable_model_name == "WorkflowRun"
    assert IMAGE_SESSION_GENERATION_TASK_CONTRACT.durable_model_name == "ImageSessionGenerationTask"

    assert WORKFLOW_RUN_GENERATION_TASK_CONTRACT.is_active(WorkflowRunStatus.RUNNING)
    assert not WORKFLOW_RUN_GENERATION_TASK_CONTRACT.is_active(WorkflowRunStatus.WAITING_CONFIRMATION)
    assert WORKFLOW_RUN_GENERATION_TASK_CONTRACT.is_terminal(WorkflowRunStatus.SUCCEEDED)
    assert WORKFLOW_RUN_GENERATION_TASK_CONTRACT.is_terminal(WorkflowRunStatus.CANCELLED)
    assert not WORKFLOW_RUN_GENERATION_TASK_CONTRACT.is_terminal(WorkflowRunStatus.WAITING_CONFIRMATION)
    assert WORKFLOW_RUN_GENERATION_TASK_CONTRACT.execution_is_queued(WorkflowNodeStatus.QUEUED)
    assert WORKFLOW_RUN_GENERATION_TASK_CONTRACT.execution_is_running(WorkflowNodeStatus.RUNNING)

    assert IMAGE_SESSION_GENERATION_TASK_CONTRACT.is_active(JobStatus.QUEUED)
    assert IMAGE_SESSION_GENERATION_TASK_CONTRACT.is_active(JobStatus.RUNNING)
    assert IMAGE_SESSION_GENERATION_TASK_CONTRACT.is_queued(JobStatus.QUEUED)
    assert IMAGE_SESSION_GENERATION_TASK_CONTRACT.is_running(JobStatus.RUNNING)
    assert IMAGE_SESSION_GENERATION_TASK_CONTRACT.is_terminal(JobStatus.FAILED)
    assert IMAGE_SESSION_GENERATION_TASK_CONTRACT.is_terminal(JobStatus.CANCELLED)


def test_durable_generation_task_contract_matches_worker_actor_retry_policy(configured_env) -> None:
    from inspiration_one_backend.workers import (
        run_image_session_generation_task,
        run_inspiration_workflow_node_run,
        run_inspiration_workflow_run,
    )

    assert_actor_uses_durable_generation_contract(
        WORKFLOW_RUN_GENERATION_TASK_CONTRACT,
        run_inspiration_workflow_run,
    )
    assert_actor_uses_durable_generation_contract(
        WORKFLOW_RUN_GENERATION_TASK_CONTRACT,
        run_inspiration_workflow_node_run,
    )
    assert_actor_uses_durable_generation_contract(
        IMAGE_SESSION_GENERATION_TASK_CONTRACT,
        run_image_session_generation_task,
    )


def test_enqueue_or_mark_failed_uses_shared_durable_generation_failure_detail() -> None:
    marked: list[tuple[str, str]] = []

    def fail_enqueue(_: str) -> None:
        raise RuntimeError("redis unavailable")

    with pytest.raises(QueueUnavailableError) as exc_info:
        enqueue_or_mark_failed(
            "durable-task-id",
            enqueue=fail_enqueue,
            mark_failed=lambda task_id, reason: marked.append((task_id, reason)),
        )

    assert str(exc_info.value) == QUEUE_UNAVAILABLE_DETAIL
    assert marked == [("durable-task-id", QUEUE_UNAVAILABLE_DETAIL)]
