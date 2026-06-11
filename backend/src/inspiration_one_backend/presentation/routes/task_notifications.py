from __future__ import annotations

import asyncio
import inspect
import logging
from dataclasses import dataclass

import redis.asyncio as redis_async
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status

from inspiration_one_backend.application.auth import ensure_auth_bootstrapped
from inspiration_one_backend.application.task_notifications import (
    TASK_NOTIFICATION_CHANNEL,
    TaskNotificationEvent,
    parse_task_notification_event,
)
from inspiration_one_backend.config import get_settings
from inspiration_one_backend.infrastructure.db.models import AuthUser
from inspiration_one_backend.infrastructure.db.session import get_session_factory

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/task-notifications", tags=["task-notifications"])


class TaskNotificationConnectionManager:
    def __init__(self) -> None:
        self._connections_by_user_id: dict[str, set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, *, user_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections_by_user_id.setdefault(user_id, set()).add(websocket)

    async def disconnect(self, *, user_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            connections = self._connections_by_user_id.get(user_id)
            if not connections:
                return
            connections.discard(websocket)
            if not connections:
                self._connections_by_user_id.pop(user_id, None)

    async def broadcast(self, event: TaskNotificationEvent) -> int:
        async with self._lock:
            connections = tuple(self._connections_by_user_id.get(event.owner_user_id, ()))
        if not connections:
            return 0

        sent_count = 0
        stale_connections: list[WebSocket] = []
        message = event.to_json()
        for websocket in connections:
            try:
                await websocket.send_text(message)
                sent_count += 1
            except RuntimeError:
                stale_connections.append(websocket)
        if stale_connections:
            async with self._lock:
                user_connections = self._connections_by_user_id.get(event.owner_user_id)
                if user_connections is not None:
                    for websocket in stale_connections:
                        user_connections.discard(websocket)
                    if not user_connections:
                        self._connections_by_user_id.pop(event.owner_user_id, None)
        return sent_count


task_notification_manager = TaskNotificationConnectionManager()


@dataclass(frozen=True, slots=True)
class TaskNotificationListenerHandle:
    stop_event: asyncio.Event
    task: asyncio.Task[None]

    async def stop(self) -> None:
        self.stop_event.set()
        self.task.cancel()
        try:
            await self.task
        except asyncio.CancelledError:
            return


@router.websocket("/ws")
async def task_notifications_websocket(websocket: WebSocket) -> None:
    current_user = _websocket_current_user(websocket)
    if current_user is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await task_notification_manager.connect(user_id=current_user.id, websocket=websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await task_notification_manager.disconnect(user_id=current_user.id, websocket=websocket)


def start_task_notification_listener(
    manager: TaskNotificationConnectionManager = task_notification_manager,
) -> TaskNotificationListenerHandle:
    stop_event = asyncio.Event()
    task = asyncio.create_task(_listen_for_task_notifications(stop_event=stop_event, manager=manager))
    return TaskNotificationListenerHandle(stop_event=stop_event, task=task)


def _websocket_current_user(websocket: WebSocket) -> AuthUser | None:
    user_id = websocket.session.get("user_id")
    if not user_id:
        return None
    factory = get_session_factory()
    with factory() as session:
        ensure_auth_bootstrapped(session)
        user = session.get(AuthUser, user_id)
        if user is None or user.archived_at is not None or not user.enabled:
            return None
        session.expunge(user)
        return user


async def _listen_for_task_notifications(
    *,
    stop_event: asyncio.Event,
    manager: TaskNotificationConnectionManager,
) -> None:
    while not stop_event.is_set():
        try:
            await _run_redis_pubsub_loop(stop_event=stop_event, manager=manager)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("任务通知 Redis 订阅失败，稍后重试")
            await _wait_for_stop_or_retry(stop_event, 2)


async def _run_redis_pubsub_loop(
    *,
    stop_event: asyncio.Event,
    manager: TaskNotificationConnectionManager,
) -> None:
    client = redis_async.Redis.from_url(get_settings().redis_url, decode_responses=True)
    pubsub = client.pubsub()
    try:
        await pubsub.subscribe(TASK_NOTIFICATION_CHANNEL)
        while not stop_event.is_set():
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if not message or message.get("type") != "message":
                continue
            event = parse_task_notification_event(message.get("data", ""))
            if event is not None:
                await manager.broadcast(event)
    finally:
        await _close_async_resource(pubsub)
        await _close_async_resource(client)


async def _wait_for_stop_or_retry(stop_event: asyncio.Event, seconds: float) -> None:
    try:
        await asyncio.wait_for(stop_event.wait(), timeout=seconds)
    except TimeoutError:
        return


async def _close_async_resource(resource: object) -> None:
    close = getattr(resource, "aclose", None) or getattr(resource, "close", None)
    if close is None:
        return
    result = close()
    if inspect.isawaitable(result):
        await result
