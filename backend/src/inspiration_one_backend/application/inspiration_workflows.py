from __future__ import annotations

from typing import TYPE_CHECKING

from inspiration_one_backend.application.inspiration_workflow.execution import (
    WorkflowRunKickoff,
    cancel_inspiration_workflow_run,
    execute_inspiration_workflow_node_run,
    execute_inspiration_workflow_run,
    mark_workflow_run_enqueue_failed,
    retry_inspiration_workflow_run,
    run_inspiration_workflow,
    start_inspiration_workflow_run,
    submit_failed_workflow_nodes_run,
    submit_inspiration_workflow_run,
)
from inspiration_one_backend.application.inspiration_workflow.graph import (
    get_active_workflow_status as _get_active_workflow_status,
)
from inspiration_one_backend.application.inspiration_workflow.graph import (
    latest_workflow_runs as _latest_workflow_runs,
)
from inspiration_one_backend.application.inspiration_workflow.mutations import (
    AppliedWorkflowTemplateGroup,
    apply_node_group_template_to_workflow,
    apply_tail_split_plan,
    bind_workflow_node_image,
    clear_workflow_node_image,
    create_workflow_edge,
    create_workflow_node,
    delete_workflow_edge,
    delete_workflow_node,
    duplicate_workflow_node_group,
    get_or_create_inspiration_workflow,
    materialize_node_group_template_to_workflow,
    normalize_workflow_node_config,
    update_workflow_copy_set,
    update_workflow_node,
    upload_workflow_node_document,
    upload_workflow_node_image,
)
from inspiration_one_backend.application.inspiration_workflow.user_templates import (
    archive_canvas_template_category,
    archive_global_canvas_template,
    archive_user_canvas_template,
    copy_user_canvas_template_to_global,
    create_canvas_template_category,
    create_global_canvas_template,
    create_user_canvas_template_from_active_workflow,
    create_user_canvas_template_from_workflow_nodes,
    list_canvas_template_categories,
    list_canvas_template_categories_for_management,
    list_canvas_templates,
    list_canvas_templates_for_management,
    rename_user_canvas_template,
    restore_canvas_template_category,
    restore_global_canvas_template,
    restore_user_canvas_template,
    review_user_canvas_template,
    update_canvas_template_category,
    update_global_canvas_template,
)

if TYPE_CHECKING:
    from inspiration_one_backend.application.inspiration_workflow.graph import InspirationWorkflowStatusSnapshot
    from inspiration_one_backend.infrastructure.db.models import InspirationWorkflow, WorkflowRun


def latest_workflow_runs(workflow: InspirationWorkflow, limit: int = 10) -> list[WorkflowRun]:
    return _latest_workflow_runs(workflow, limit=limit)


def get_inspiration_workflow_status(session, inspiration_id: str) -> InspirationWorkflowStatusSnapshot:
    return _get_active_workflow_status(session, inspiration_id)


__all__ = [
    "WorkflowRunKickoff",
    "AppliedWorkflowTemplateGroup",
    "apply_tail_split_plan",
    "apply_node_group_template_to_workflow",
    "archive_user_canvas_template",
    "archive_canvas_template_category",
    "archive_global_canvas_template",
    "bind_workflow_node_image",
    "clear_workflow_node_image",
    "copy_user_canvas_template_to_global",
    "create_canvas_template_category",
    "create_global_canvas_template",
    "create_user_canvas_template_from_active_workflow",
    "create_user_canvas_template_from_workflow_nodes",
    "cancel_inspiration_workflow_run",
    "create_workflow_edge",
    "create_workflow_node",
    "delete_workflow_edge",
    "delete_workflow_node",
    "duplicate_workflow_node_group",
    "execute_inspiration_workflow_run",
    "execute_inspiration_workflow_node_run",
    "get_or_create_inspiration_workflow",
    "get_inspiration_workflow_status",
    "latest_workflow_runs",
    "list_canvas_template_categories",
    "list_canvas_template_categories_for_management",
    "list_canvas_templates",
    "list_canvas_templates_for_management",
    "mark_workflow_run_enqueue_failed",
    "materialize_node_group_template_to_workflow",
    "normalize_workflow_node_config",
    "retry_inspiration_workflow_run",
    "rename_user_canvas_template",
    "restore_canvas_template_category",
    "restore_global_canvas_template",
    "restore_user_canvas_template",
    "review_user_canvas_template",
    "run_inspiration_workflow",
    "start_inspiration_workflow_run",
    "submit_failed_workflow_nodes_run",
    "submit_inspiration_workflow_run",
    "update_canvas_template_category",
    "update_global_canvas_template",
    "update_workflow_copy_set",
    "update_workflow_node",
    "upload_workflow_node_document",
    "upload_workflow_node_image",
]
