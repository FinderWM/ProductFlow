from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from inspiration_one_backend.application.task_notifications import (
    TASK_NOTIFICATION_MESSAGE_TYPE,
    TaskNotificationEvent,
    image_session_generation_task_notification_event,
    parse_task_notification_event,
    workflow_run_notification_event,
)
from inspiration_one_backend.domain.enums import JobStatus, WorkflowRunStatus
from inspiration_one_backend.infrastructure.db.models import (
    AuthRole,
    AuthUser,
    ImageSession,
    ImageSessionGenerationTask,
    Inspiration,
    InspirationWorkflow,
    WorkflowRun,
)
from inspiration_one_backend.presentation.routes.task_notifications import TaskNotificationConnectionManager


class FakeWebSocket:
    def __init__(self) -> None:
        self.accepted = False
        self.messages: list[str] = []

    async def accept(self) -> None:
        self.accepted = True

    async def send_text(self, message: str) -> None:
        self.messages.append(message)


def test_task_notification_event_json_roundtrip() -> None:
    event = TaskNotificationEvent(
        type=TASK_NOTIFICATION_MESSAGE_TYPE,
        event_id="image-session-generation:task-1:failed:2026-06-11T00:00:00Z",
        task_kind="image_session_generation",
        task_id="task-1",
        owner_user_id="user-1",
        status="failed",
        title="会话 A",
        failure_reason="供应商拒绝",
        finished_at="2026-06-11T00:00:00Z",
        resource_id="session-1",
    )

    assert parse_task_notification_event(event.to_json()) == event
    assert parse_task_notification_event('{"type":"other"}') is None
    assert parse_task_notification_event("not-json") is None


def test_builds_image_session_generation_task_event(db_session: Session) -> None:
    _add_user(db_session, user_id="user-1")
    image_session = ImageSession(id="session-1", owner_user_id="user-1", title="会话 A")
    task = ImageSessionGenerationTask(
        id="task-1",
        session_id=image_session.id,
        status=JobStatus.FAILED,
        prompt="prompt",
        size="1024x1024",
        failure_reason="供应商拒绝",
        finished_at=datetime(2026, 6, 11, tzinfo=UTC),
    )
    db_session.add_all([image_session, task])
    db_session.commit()

    event = image_session_generation_task_notification_event(task)

    assert event is not None
    assert event.task_kind == "image_session_generation"
    assert event.owner_user_id == "user-1"
    assert event.status == "failed"
    assert event.title == "会话 A"
    assert event.failure_reason == "供应商拒绝"
    assert event.resource_id == "session-1"


def test_builds_workflow_run_notification_event(db_session: Session) -> None:
    _add_user(db_session, user_id="user-1")
    inspiration = Inspiration(id="inspiration-1", owner_user_id="user-1", name="灵感 A")
    workflow = InspirationWorkflow(id="workflow-1", inspiration_id=inspiration.id, title="工作流 A")
    run = WorkflowRun(
        id="run-1",
        workflow_id=workflow.id,
        status=WorkflowRunStatus.SUCCEEDED,
        finished_at=datetime(2026, 6, 11, tzinfo=UTC),
    )
    db_session.add_all([inspiration, workflow, run])
    db_session.commit()

    event = workflow_run_notification_event(run)

    assert event is not None
    assert event.task_kind == "inspiration_workflow"
    assert event.owner_user_id == "user-1"
    assert event.status == "succeeded"
    assert event.title == "灵感 A"
    assert event.resource_id == "inspiration-1"


def test_connection_manager_broadcasts_only_to_event_owner() -> None:
    async def run_case() -> None:
        manager = TaskNotificationConnectionManager()
        owner_socket = FakeWebSocket()
        other_socket = FakeWebSocket()
        await manager.connect(user_id="user-1", websocket=owner_socket)  # type: ignore[arg-type]
        await manager.connect(user_id="user-2", websocket=other_socket)  # type: ignore[arg-type]

        sent_count = await manager.broadcast(
            TaskNotificationEvent(
                type=TASK_NOTIFICATION_MESSAGE_TYPE,
                event_id="event-1",
                task_kind="image_session_generation",
                task_id="task-1",
                owner_user_id="user-1",
                status="succeeded",
                title="会话 A",
                failure_reason=None,
                finished_at="2026-06-11T00:00:00Z",
                resource_id="session-1",
            )
        )

        assert sent_count == 1
        assert owner_socket.accepted
        assert other_socket.accepted
        assert len(owner_socket.messages) == 1
        assert other_socket.messages == []

    asyncio.run(run_case())


def _add_user(session: Session, *, user_id: str) -> None:
    role = AuthRole(id=f"{user_id}-role", code=f"{user_id}-role", name="member")
    user = AuthUser(id=user_id, username=user_id, display_name=user_id, role_id=role.id)
    session.add_all([role, user])
