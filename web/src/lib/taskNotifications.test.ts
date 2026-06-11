import { describe, expect, it } from "vitest";

import {
  buildImageTaskTransitionNotification,
  buildTaskNotificationEventNotification,
  buildWorkflowRunTransitionNotification,
  parseTaskNotificationEvent,
} from "./taskNotifications";
import type { TranslateFunction } from "./preferences";
import type { ImageSessionGenerationTask, TaskNotificationEvent, WorkflowRunStatusSummary } from "./types";

const t = ((key, params = {}) => {
  const templates: Record<string, string> = {
    "notification.imageDone.title": "完成",
    "notification.imageDone.body": "{title} 已完成",
    "notification.imageFailed.title": "失败",
    "notification.imageFailed.body": "{title} 失败",
    "notification.imageFailed.bodyWithReason": "{title} 失败：{reason}",
    "notification.inspirationDone.title": "工作流完成",
    "notification.inspirationDone.body": "{name} 完成",
    "notification.inspirationFailed.title": "工作流失败",
    "notification.inspirationFailed.body": "{name} 失败",
    "notification.inspirationFailed.bodyWithReason": "{name} 失败：{reason}",
  };
  return (templates[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}) as TranslateFunction;

function task(overrides: Partial<ImageSessionGenerationTask>): ImageSessionGenerationTask {
  return {
    id: "task-1",
    session_id: "session-1",
    status: "running",
    prompt: "prompt",
    size: "1024x1024",
    base_asset_ids: [],
    base_asset_id: null,
    selected_reference_asset_ids: [],
    generation_config_mode: "auto",
    requested_generation_config_id: null,
    used_generation_config_id: null,
    resource_group_id: "group-1",
    resource_group: { id: "group-1", key: "default", name: "default" },
    generation_count: 1,
    completed_candidates: 0,
    active_candidate_index: null,
    progress_phase: null,
    progress_updated_at: null,
    provider_response_id: null,
    provider_response_status: null,
    progress_metadata: null,
    failure_reason: null,
    result_generation_group_id: null,
    tool_options: null,
    provider_notes: [],
    attempts: 0,
    is_retryable: true,
    is_cancelable: true,
    created_at: "2026-06-08T00:00:00Z",
    started_at: null,
    finished_at: null,
    queue_active_count: 0,
    queue_running_count: 0,
    queue_queued_count: 0,
    queue_max_concurrent_tasks: 3,
    queued_ahead_count: null,
    queue_position: null,
    ...overrides,
  };
}

function workflowRun(overrides: Partial<WorkflowRunStatusSummary>): WorkflowRunStatusSummary {
  return {
    id: "run-1",
    workflow_id: "workflow-1",
    status: "running",
    started_at: "2026-06-08T00:00:00Z",
    finished_at: null,
    failure_reason: null,
    progress_metadata: null,
    is_retryable: true,
    is_cancelable: true,
    queue_active_count: 0,
    queue_running_count: 0,
    queue_queued_count: 0,
    queue_max_concurrent_tasks: 3,
    queued_ahead_count: null,
    queue_position: null,
    node_runs: [],
    ...overrides,
  };
}

function taskEvent(overrides: Partial<TaskNotificationEvent>): TaskNotificationEvent {
  return {
    type: "task_notification",
    event_id: "event-1",
    task_kind: "image_session_generation",
    task_id: "task-1",
    owner_user_id: "user-1",
    status: "succeeded",
    title: "会话 A",
    failure_reason: null,
    finished_at: "2026-06-08T00:01:00Z",
    resource_id: "session-1",
    ...overrides,
  };
}

describe("buildImageTaskTransitionNotification", () => {
  it("builds an error notification when an active image task fails", () => {
    expect(
      buildImageTaskTransitionNotification(
        task({ status: "failed", failure_reason: "供应商拒绝" }),
        "running",
        "会话 A",
        t,
      ),
    ).toMatchObject({
      title: "失败",
      body: "会话 A 失败：供应商拒绝",
      variant: "error",
      autoClose: false,
      dedupeKey: "image-task-failed:task-1",
    });
  });

  it("keeps success notifications and ignores non-active transitions", () => {
    expect(buildImageTaskTransitionNotification(task({ status: "succeeded" }), "queued", "会话 A", t)).toMatchObject({
      title: "完成",
      body: "会话 A 已完成",
      variant: "success",
      autoClose: true,
      dedupeKey: "image-task-succeeded:task-1",
    });
    expect(buildImageTaskTransitionNotification(task({ status: "failed" }), "failed", "会话 A", t)).toBeNull();
    expect(buildImageTaskTransitionNotification(task({ status: "failed" }), undefined, "会话 A", t)).toBeNull();
  });
});

describe("buildWorkflowRunTransitionNotification", () => {
  it("builds workflow success and failure notifications from active transitions", () => {
    expect(
      buildWorkflowRunTransitionNotification(workflowRun({ status: "succeeded" }), "running", "灵感 A", t),
    ).toMatchObject({
      title: "工作流完成",
      body: "灵感 A 完成",
      variant: "success",
      autoClose: true,
      dedupeKey: "workflow-run-succeeded:run-1",
    });
    expect(
      buildWorkflowRunTransitionNotification(
        workflowRun({ status: "failed", failure_reason: "节点失败" }),
        "waiting_confirmation",
        "灵感 A",
        t,
      ),
    ).toMatchObject({
      title: "工作流失败",
      body: "灵感 A 失败：节点失败",
      variant: "error",
      autoClose: false,
      dedupeKey: "workflow-run-failed:run-1",
    });
    expect(buildWorkflowRunTransitionNotification(workflowRun({ status: "failed" }), undefined, "灵感 A", t)).toBeNull();
  });
});

describe("task notification websocket events", () => {
  it("parses valid websocket events and rejects unknown payloads", () => {
    const event = taskEvent({ status: "failed", failure_reason: "供应商拒绝" });
    expect(parseTaskNotificationEvent(JSON.stringify(event))).toEqual(event);
    expect(parseTaskNotificationEvent(JSON.stringify({ ...event, type: "other" }))).toBeNull();
    expect(parseTaskNotificationEvent(JSON.stringify({ ...event, status: "running" }))).toBeNull();
    expect(parseTaskNotificationEvent("not-json")).toBeNull();
  });

  it("builds websocket notifications and ignores cancelled events", () => {
    expect(buildTaskNotificationEventNotification(taskEvent({ status: "succeeded" }), t)).toMatchObject({
      title: "完成",
      body: "会话 A 已完成",
      variant: "success",
      autoClose: true,
      dedupeKey: "image-task-succeeded:task-1",
    });
    expect(
      buildTaskNotificationEventNotification(
        taskEvent({
          task_kind: "inspiration_workflow",
          task_id: "run-1",
          status: "failed",
          title: "灵感 A",
          failure_reason: "节点失败",
          resource_id: "inspiration-1",
        }),
        t,
      ),
    ).toMatchObject({
      title: "工作流失败",
      body: "灵感 A 失败：节点失败",
      variant: "error",
      autoClose: false,
      dedupeKey: "workflow-run-failed:run-1",
    });
    expect(buildTaskNotificationEventNotification(taskEvent({ status: "cancelled" }), t)).toBeNull();
  });
});
