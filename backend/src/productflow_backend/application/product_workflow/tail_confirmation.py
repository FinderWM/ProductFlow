from __future__ import annotations

from typing import Any

from productflow_backend.domain.enums import WorkflowRunStatus
from productflow_backend.infrastructure.db.models import WorkflowRun

PENDING_TAIL_CONFIRMATIONS_KEY = "pending_tail_confirmations"


def workflow_run_is_user_active(status: WorkflowRunStatus | str) -> bool:
    value = status.value if isinstance(status, WorkflowRunStatus) else status
    return value in {WorkflowRunStatus.RUNNING.value, WorkflowRunStatus.WAITING_CONFIRMATION.value}


def run_pending_tail_confirmations(run: WorkflowRun) -> list[dict[str, str]]:
    return pending_tail_confirmations(run.progress_metadata)


def pending_tail_confirmations(metadata: dict[str, Any] | None) -> list[dict[str, str]]:
    if not isinstance(metadata, dict):
        return []
    raw_items = metadata.get(PENDING_TAIL_CONFIRMATIONS_KEY)
    if not isinstance(raw_items, list):
        return []
    items: list[dict[str, str]] = []
    for raw_item in raw_items:
        if not isinstance(raw_item, dict):
            continue
        tail_node_id = raw_item.get("tail_node_id")
        plan_id = raw_item.get("plan_id")
        node_run_id = raw_item.get("node_run_id")
        if not isinstance(tail_node_id, str) or not isinstance(plan_id, str) or not isinstance(node_run_id, str):
            continue
        items.append({"tail_node_id": tail_node_id, "plan_id": plan_id, "node_run_id": node_run_id})
    return items


def run_has_pending_tail_confirmations(run: WorkflowRun) -> bool:
    return bool(run_pending_tail_confirmations(run))


def run_has_pending_tail_confirmation(run: WorkflowRun, *, tail_node_id: str, plan_id: str) -> bool:
    return any(
        item["tail_node_id"] == tail_node_id and item["plan_id"] == plan_id
        for item in run_pending_tail_confirmations(run)
    )


def append_pending_tail_confirmation(
    run: WorkflowRun,
    *,
    tail_node_id: str,
    plan_id: str,
    node_run_id: str,
) -> None:
    metadata = dict(run.progress_metadata or {})
    items = [
        item
        for item in pending_tail_confirmations(metadata)
        if item["tail_node_id"] != tail_node_id or item["plan_id"] != plan_id
    ]
    items.append({"tail_node_id": tail_node_id, "plan_id": plan_id, "node_run_id": node_run_id})
    metadata[PENDING_TAIL_CONFIRMATIONS_KEY] = items
    run.progress_metadata = metadata


def remove_pending_tail_confirmation(run: WorkflowRun, *, tail_node_id: str, plan_id: str) -> bool:
    metadata = dict(run.progress_metadata or {})
    current = pending_tail_confirmations(metadata)
    next_items = [
        item for item in current if item["tail_node_id"] != tail_node_id or item["plan_id"] != plan_id
    ]
    if len(next_items) == len(current):
        return False
    if next_items:
        metadata[PENDING_TAIL_CONFIRMATIONS_KEY] = next_items
    else:
        metadata.pop(PENDING_TAIL_CONFIRMATIONS_KEY, None)
    run.progress_metadata = metadata or None
    return True
