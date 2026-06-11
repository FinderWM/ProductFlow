from __future__ import annotations

import json
import logging
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from typing import Literal

import redis

from inspiration_one_backend.config import get_settings
from inspiration_one_backend.domain.enums import JobStatus, WorkflowRunStatus
from inspiration_one_backend.infrastructure.db.models import ImageSessionGenerationTask, WorkflowRun

logger = logging.getLogger(__name__)

TASK_NOTIFICATION_CHANNEL = "inspiration-one:task-notifications"
TASK_NOTIFICATION_MESSAGE_TYPE = "task_notification"

TaskNotificationKind = Literal["image_session_generation", "inspiration_workflow"]
TaskNotificationStatus = Literal["succeeded", "failed", "cancelled"]


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
    if status not in {"succeeded", "failed", "cancelled"}:
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
    )


def image_session_generation_task_notification_event(
    task: ImageSessionGenerationTask,
) -> TaskNotificationEvent | None:
    status = _task_status(task.status)
    if status is None or task.session is None:
        return None
    finished_at = _datetime_to_json(task.finished_at)
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
    )


def workflow_run_notification_event(run: WorkflowRun) -> TaskNotificationEvent | None:
    status = _workflow_status(run.status)
    if status is None or run.workflow is None or run.workflow.inspiration is None:
        return None
    inspiration = run.workflow.inspiration
    finished_at = _datetime_to_json(run.finished_at)
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


def _datetime_to_json(value: datetime | None) -> str | None:
    if value is None:
        return None
    aware = value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    return aware.isoformat().replace("+00:00", "Z")


def _event_id(prefix: str, task_id: str, status: str, finished_at: str | None) -> str:
    return f"{prefix}:{task_id}:{status}:{finished_at or 'no-finished-at'}"
