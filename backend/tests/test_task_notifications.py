from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from inspiration_one_backend.application.task_notifications import (
    TASK_NOTIFICATION_MESSAGE_TYPE,
    TaskNotificationEvent,
    image_session_generation_attempt_failed_notification_event,
    image_session_generation_task_notification_event,
    parse_task_notification_event,
    workflow_run_notification_event,
)
from inspiration_one_backend.domain.enums import JobStatus, WorkflowNodeStatus, WorkflowNodeType, WorkflowRunStatus
from inspiration_one_backend.infrastructure.db.models import (
    AuthRole,
    AuthUser,
    GenerationConfig,
    GenerationResourceGroup,
    ImageSession,
    ImageSessionGenerationTask,
    Inspiration,
    InspirationWorkflow,
    WorkflowNode,
    WorkflowNodeRun,
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


def test_task_notification_event_attempt_failed_json_roundtrip() -> None:
    event = TaskNotificationEvent(
        type=TASK_NOTIFICATION_MESSAGE_TYPE,
        event_id="image-session-generation:task-1:attempt_failed:1",
        task_kind="image_session_generation",
        task_id="task-1",
        owner_user_id="user-1",
        status="attempt_failed",
        title="会话 A",
        failure_reason="供应商超时",
        finished_at=None,
        resource_id="session-1",
        generation_config_id="config-1",
        generation_config_name="图片配置 A",
        resource_group_id="group-1",
        resource_group_name="默认分组",
        attempt=1,
        max_attempts=3,
        next_attempt=2,
    )

    assert parse_task_notification_event(event.to_json()) == event
    assert parse_task_notification_event(event.to_json().replace('"attempt_failed"', '"running"')) is None


def test_builds_image_session_generation_task_event(db_session: Session) -> None:
    _add_user(db_session, user_id="user-1")
    group = GenerationResourceGroup(id="group-1", key="default", name="默认分组")
    config = GenerationConfig(
        id="config-1",
        purpose="image",
        name="图片配置 A",
        provider_kind="mock",
        resource_group_id=group.id,
    )
    image_session = ImageSession(
        id="session-1",
        owner_user_id="user-1",
        title="会话 A",
        resource_group_id=group.id,
    )
    task = ImageSessionGenerationTask(
        id="task-1",
        session_id=image_session.id,
        status=JobStatus.FAILED,
        prompt="prompt",
        size="1024x1024",
        used_generation_config_id=config.id,
        resource_group_id=group.id,
        failure_reason="供应商拒绝",
        finished_at=datetime(2026, 6, 11, tzinfo=UTC),
        attempts=3,
    )
    db_session.add_all([group, config, image_session, task])
    db_session.commit()

    event = image_session_generation_task_notification_event(task)

    assert event is not None
    assert event.task_kind == "image_session_generation"
    assert event.owner_user_id == "user-1"
    assert event.status == "failed"
    assert event.title == "会话 A"
    assert event.failure_reason == "供应商拒绝"
    assert event.resource_id == "session-1"
    assert event.generation_config_id == "config-1"
    assert event.generation_config_name == "图片配置 A"
    assert event.resource_group_id == "group-1"
    assert event.resource_group_name == "默认分组"
    assert event.attempt == 3


def test_builds_image_session_generation_attempt_failed_event(db_session: Session) -> None:
    _add_user(db_session, user_id="user-1")
    group = GenerationResourceGroup(id="group-1", key="default", name="默认分组")
    config = GenerationConfig(
        id="config-1",
        purpose="image",
        name="图片配置 A",
        provider_kind="mock",
        resource_group_id=group.id,
    )
    image_session = ImageSession(
        id="session-1",
        owner_user_id="user-1",
        title="会话 A",
        resource_group_id=group.id,
    )
    task = ImageSessionGenerationTask(
        id="task-1",
        session_id=image_session.id,
        status=JobStatus.QUEUED,
        prompt="prompt",
        size="1024x1024",
        used_generation_config_id=config.id,
        resource_group_id=group.id,
        attempts=1,
    )
    db_session.add_all([group, config, image_session, task])
    db_session.commit()

    event = image_session_generation_attempt_failed_notification_event(
        task,
        reason="供应商超时",
        attempt=1,
        max_attempts=3,
    )

    assert event is not None
    assert event.status == "attempt_failed"
    assert event.event_id == "image-session-generation:task-1:attempt_failed:1"
    assert event.failure_reason == "供应商超时"
    assert event.generation_config_name == "图片配置 A"
    assert event.resource_group_name == "默认分组"
    assert event.attempt == 1
    assert event.max_attempts == 3
    assert event.next_attempt == 2


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


def test_builds_workflow_run_notification_event_with_failed_node_context(db_session: Session) -> None:
    _add_user(db_session, user_id="user-1")
    group = GenerationResourceGroup(id="group-1", key="default", name="默认分组")
    config = GenerationConfig(
        id="config-1",
        purpose="image",
        name="图片配置 A",
        provider_kind="mock",
        resource_group_id=group.id,
    )
    inspiration = Inspiration(id="inspiration-1", owner_user_id="user-1", name="灵感 A")
    workflow = InspirationWorkflow(id="workflow-1", inspiration_id=inspiration.id, title="工作流 A")
    node = WorkflowNode(
        id="node-1",
        workflow_id=workflow.id,
        node_type=WorkflowNodeType.IMAGE_GENERATION,
        title="主图生成",
        config_json={
            "generation_config_mode": "manual",
            "generation_config_id": config.id,
            "resource_group_id": group.id,
        },
        status=WorkflowNodeStatus.FAILED,
        failure_reason="供应商拒绝",
    )
    run = WorkflowRun(
        id="run-1",
        workflow_id=workflow.id,
        status=WorkflowRunStatus.FAILED,
        failure_reason="供应商拒绝",
        finished_at=datetime(2026, 6, 11, tzinfo=UTC),
    )
    node_run = WorkflowNodeRun(
        id="node-run-1",
        workflow_run_id=run.id,
        node_id=node.id,
        status=WorkflowNodeStatus.FAILED,
        failure_reason="供应商拒绝",
        resource_group_id=group.id,
        finished_at=datetime(2026, 6, 11, tzinfo=UTC),
    )
    db_session.add_all([group, config, inspiration, workflow, node, run, node_run])
    db_session.commit()

    event = workflow_run_notification_event(run)

    assert event is not None
    assert event.status == "failed"
    assert event.node_id == "node-1"
    assert event.node_title == "主图生成"
    assert event.generation_config_id == "config-1"
    assert event.generation_config_name == "图片配置 A"
    assert event.resource_group_id == "group-1"
    assert event.resource_group_name == "默认分组"


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
