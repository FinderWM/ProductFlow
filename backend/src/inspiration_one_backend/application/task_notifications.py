from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from typing import Any, Literal

import redis
from sqlalchemy.orm import Session, object_session

from inspiration_one_backend.config import get_settings
from inspiration_one_backend.domain.enums import JobStatus, WorkflowRunStatus
from inspiration_one_backend.infrastructure.db.models import (
    GenerationConfig,
    GenerationResourceGroup,
    ImageSessionGenerationTask,
    WorkflowNodeRun,
    WorkflowRun,
)

logger = logging.getLogger(__name__)

TASK_NOTIFICATION_CHANNEL = "inspiration-one:task-notifications"
TASK_NOTIFICATION_MESSAGE_TYPE = "task_notification"

TaskNotificationKind = Literal["image_session_generation", "inspiration_workflow"]
TaskNotificationStatus = Literal["succeeded", "failed", "cancelled", "attempt_failed"]


@dataclass(frozen=True, slots=True)
class TaskNotificationEvent:
    type: Literal["task_notification"]
    event_id: str
    task_kind: TaskNotificationKind
    task_id: str
    owner_user_id: str
    status: TaskNotificationStatus
    title: str
    failure_reason: str | None
    finished_at: str | None
    resource_id: str
    generation_config_id: str | None = None
    generation_config_name: str | None = None
    resource_group_id: str | None = None
    resource_group_name: str | None = None
    attempt: int | None = None
    max_attempts: int | None = None
    next_attempt: int | None = None
    node_id: str | None = None
    node_title: str | None = None

    def to_json(self) -> str:
        return json.dumps(asdict(self), ensure_ascii=False, separators=(",", ":"))


def parse_task_notification_event(raw_message: bytes | str) -> TaskNotificationEvent | None:
    try:
        payload = json.loads(raw_message.decode("utf-8") if isinstance(raw_message, bytes) else raw_message)
    except (UnicodeDecodeError, json.JSONDecodeError, TypeError):
        logger.warning("任务通知消息解析失败")
        return None

    if not isinstance(payload, dict):
        return None
    if payload.get("type") != TASK_NOTIFICATION_MESSAGE_TYPE:
        return None
    task_kind = payload.get("task_kind")
    status = payload.get("status")
    if task_kind not in {"image_session_generation", "inspiration_workflow"}:
        return None
    if status not in {"succeeded", "failed", "cancelled", "attempt_failed"}:
        return None

    required_strings = ("event_id", "task_id", "owner_user_id", "title", "resource_id")
    if any(not isinstance(payload.get(key), str) or not payload[key].strip() for key in required_strings):
        return None
    failure_reason = payload.get("failure_reason")
    finished_at = payload.get("finished_at")
    return TaskNotificationEvent(
        type=TASK_NOTIFICATION_MESSAGE_TYPE,
        event_id=payload["event_id"],
        task_kind=task_kind,
        task_id=payload["task_id"],
        owner_user_id=payload["owner_user_id"],
        status=status,
        title=payload["title"],
        failure_reason=failure_reason if isinstance(failure_reason, str) and failure_reason else None,
        finished_at=finished_at if isinstance(finished_at, str) and finished_at else None,
        resource_id=payload["resource_id"],
        generation_config_id=_optional_string(payload.get("generation_config_id")),
        generation_config_name=_optional_string(payload.get("generation_config_name")),
        resource_group_id=_optional_string(payload.get("resource_group_id")),
        resource_group_name=_optional_string(payload.get("resource_group_name")),
        attempt=_optional_positive_int(payload.get("attempt")),
        max_attempts=_optional_positive_int(payload.get("max_attempts")),
        next_attempt=_optional_positive_int(payload.get("next_attempt")),
        node_id=_optional_string(payload.get("node_id")),
        node_title=_optional_string(payload.get("node_title")),
    )


def image_session_generation_task_notification_event(
    task: ImageSessionGenerationTask,
) -> TaskNotificationEvent | None:
    status = _task_status(task.status)
    if status is None or task.session is None:
        return None
    finished_at = _datetime_to_json(task.finished_at)
    generation_config_id, generation_config_name, resource_group_id, resource_group_name = _image_task_context(task)
    return TaskNotificationEvent(
        type=TASK_NOTIFICATION_MESSAGE_TYPE,
        event_id=_event_id("image-session-generation", task.id, status, finished_at),
        task_kind="image_session_generation",
        task_id=task.id,
        owner_user_id=task.session.owner_user_id,
        status=status,
        title=task.session.title,
        failure_reason=task.failure_reason,
        finished_at=finished_at,
        resource_id=task.session_id,
        generation_config_id=generation_config_id,
        generation_config_name=generation_config_name,
        resource_group_id=resource_group_id,
        resource_group_name=resource_group_name,
        attempt=_positive_int(task.attempts),
    )


def image_session_generation_attempt_failed_notification_event(
    task: ImageSessionGenerationTask,
    *,
    reason: str,
    attempt: int,
    max_attempts: int,
) -> TaskNotificationEvent | None:
    if task.session is None:
        return None
    failed_attempt = _positive_int(attempt)
    max_attempt_count = _positive_int(max_attempts)
    if failed_attempt is None or max_attempt_count is None:
        return None
    generation_config_id, generation_config_name, resource_group_id, resource_group_name = _image_task_context(task)
    return TaskNotificationEvent(
        type=TASK_NOTIFICATION_MESSAGE_TYPE,
        event_id=f"image-session-generation:{task.id}:attempt_failed:{failed_attempt}",
        task_kind="image_session_generation",
        task_id=task.id,
        owner_user_id=task.session.owner_user_id,
        status="attempt_failed",
        title=task.session.title,
        failure_reason=reason[:1000] if reason else None,
        finished_at=None,
        resource_id=task.session_id,
        generation_config_id=generation_config_id,
        generation_config_name=generation_config_name,
        resource_group_id=resource_group_id,
        resource_group_name=resource_group_name,
        attempt=failed_attempt,
        max_attempts=max_attempt_count,
        next_attempt=min(failed_attempt + 1, max_attempt_count),
    )


def workflow_run_notification_event(run: WorkflowRun) -> TaskNotificationEvent | None:
    status = _workflow_status(run.status)
    if status is None or run.workflow is None or run.workflow.inspiration is None:
        return None
    inspiration = run.workflow.inspiration
    finished_at = _datetime_to_json(run.finished_at)
    workflow_context = _failed_workflow_node_context(run)
    generation_config_id, generation_config_name = _generation_config_context(
        object_session(run),
        workflow_context["generation_config_id"],
    )
    resource_group_id, resource_group_name = _resource_group_context(
        object_session(run),
        workflow_context["resource_group_id"],
    )
    return TaskNotificationEvent(
        type=TASK_NOTIFICATION_MESSAGE_TYPE,
        event_id=_event_id("inspiration-workflow", run.id, status, finished_at),
        task_kind="inspiration_workflow",
        task_id=run.id,
        owner_user_id=inspiration.owner_user_id,
        status=status,
        title=inspiration.name or run.workflow.title,
        failure_reason=run.failure_reason,
        finished_at=finished_at,
        resource_id=inspiration.id,
        generation_config_id=generation_config_id,
        generation_config_name=generation_config_name,
        resource_group_id=resource_group_id,
        resource_group_name=resource_group_name,
        node_id=workflow_context["node_id"],
        node_title=workflow_context["node_title"],
    )


def publish_task_notification_event(event: TaskNotificationEvent) -> None:
    client = redis.Redis.from_url(get_settings().redis_url, decode_responses=True)
    try:
        client.publish(TASK_NOTIFICATION_CHANNEL, event.to_json())
    finally:
        client.close()


def publish_task_notification_event_safely(event: TaskNotificationEvent | None) -> None:
    if event is None:
        return
    try:
        publish_task_notification_event(event)
    except Exception:  # noqa: BLE001
        logger.exception("发布任务通知失败: event_id=%s", event.event_id)


def publish_image_session_generation_task_notification_safely(task: ImageSessionGenerationTask) -> None:
    publish_task_notification_event_safely(image_session_generation_task_notification_event(task))


def publish_image_session_generation_attempt_failed_notification_safely(
    task: ImageSessionGenerationTask,
    *,
    reason: str,
    attempt: int,
    max_attempts: int,
) -> None:
    publish_task_notification_event_safely(
        image_session_generation_attempt_failed_notification_event(
            task,
            reason=reason,
            attempt=attempt,
            max_attempts=max_attempts,
        )
    )


def publish_workflow_run_notification_safely(run: WorkflowRun) -> None:
    publish_task_notification_event_safely(workflow_run_notification_event(run))


def _task_status(status: JobStatus | str) -> TaskNotificationStatus | None:
    value = status.value if isinstance(status, JobStatus) else status
    if value in {"succeeded", "failed", "cancelled"}:
        return value  # type: ignore[return-value]
    return None


def _workflow_status(status: WorkflowRunStatus | str) -> TaskNotificationStatus | None:
    value = status.value if isinstance(status, WorkflowRunStatus) else status
    if value in {"succeeded", "failed", "cancelled"}:
        return value  # type: ignore[return-value]
    return None


def _image_task_context(
    task: ImageSessionGenerationTask,
) -> tuple[str | None, str | None, str | None, str | None]:
    session = object_session(task)
    generation_config_id = _optional_string(task.used_generation_config_id) or _optional_string(
        task.requested_generation_config_id
    )
    resource_group_id = _optional_string(task.resource_group_id)
    generation_config_id, generation_config_name = _generation_config_context(session, generation_config_id)
    resource_group_id, resource_group_name = _resource_group_context(session, resource_group_id)
    return generation_config_id, generation_config_name, resource_group_id, resource_group_name


def _failed_workflow_node_context(run: WorkflowRun) -> dict[str, str | None]:
    node_run = _failed_workflow_node_run(run)
    if node_run is None:
        return {
            "generation_config_id": None,
            "resource_group_id": None,
            "node_id": None,
            "node_title": None,
        }
    node = node_run.node
    output_json = node_run.output_json if isinstance(node_run.output_json, dict) else None
    config_json = node.config_json if node is not None and isinstance(node.config_json, dict) else None
    generation_config_id = _string_from_mapping(output_json, "generation_config_id")
    if generation_config_id is None and _string_from_mapping(config_json, "generation_config_mode") == "manual":
        generation_config_id = _string_from_mapping(config_json, "generation_config_id")
    resource_group_id = (
        _optional_string(node_run.resource_group_id)
        or _string_from_mapping(output_json, "resource_group_id")
        or _string_from_mapping(config_json, "resource_group_id")
    )
    return {
        "generation_config_id": generation_config_id,
        "resource_group_id": resource_group_id,
        "node_id": node_run.node_id,
        "node_title": _optional_string(node.title if node is not None else None),
    }


def _failed_workflow_node_run(run: WorkflowRun) -> WorkflowNodeRun | None:
    failed_node_runs = [node_run for node_run in run.node_runs if _enum_value(node_run.status) == "failed"]
    if not failed_node_runs:
        return None
    return next(
        (node_run for node_run in failed_node_runs if node_run.failure_reason != "上游节点失败"),
        failed_node_runs[0],
    )


def _generation_config_context(
    session: Session | None,
    generation_config_id: str | None,
) -> tuple[str | None, str | None]:
    generation_config_id = _optional_string(generation_config_id)
    if generation_config_id is None:
        return None, None
    if session is None:
        return generation_config_id, None
    generation_config = session.get(GenerationConfig, generation_config_id)
    if generation_config is None:
        return generation_config_id, None
    return generation_config_id, _optional_string(generation_config.name)


def _resource_group_context(
    session: Session | None,
    resource_group_id: str | None,
) -> tuple[str | None, str | None]:
    resource_group_id = _optional_string(resource_group_id)
    if resource_group_id is None:
        return None, None
    if session is None:
        return resource_group_id, None
    resource_group = session.get(GenerationResourceGroup, resource_group_id)
    if resource_group is None:
        return resource_group_id, None
    return resource_group_id, _optional_string(resource_group.name)


def _string_from_mapping(payload: dict[str, Any] | None, key: str) -> str | None:
    if payload is None:
        return None
    return _optional_string(payload.get(key))


def _enum_value(value: object) -> str:
    raw_value = getattr(value, "value", value)
    return raw_value if isinstance(raw_value, str) else ""


def _optional_string(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _optional_positive_int(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) and value > 0 else None


def _positive_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        parsed = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _datetime_to_json(value: datetime | None) -> str | None:
    if value is None:
        return None
    aware = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    return aware.isoformat().replace("+00:00", "Z")


def _event_id(prefix: str, task_id: str, status: str, finished_at: str | None) -> str:
    return f"{prefix}:{task_id}:{status}:{finished_at or 'no-finished-at'}"
