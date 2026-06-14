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
    "notification.imageAttemptFailed.title": "重试中",
    "notification.imageAttemptFailed.body": "{title} 第 {attempt}/{maxAttempts} 次失败",
    "notification.imageAttemptFailed.bodyWithoutMax": "{title} 第 {attempt} 次失败",
    "notification.imageAttemptFailed.bodyUnknown": "{title} 本次失败",
    "notification.imageAttemptFailed.retryLine": "将进入第 {nextAttempt}/{maxAttempts} 次",
    "notification.failureReasonLine": "失败原因：{reason}",
    "notification.generationContext": "生成设置：{context}",
    "notification.workflowFailed.nodeLine": "失败节点：{node}",
    "notification.taskAttemptLine": "尝试次数：第 {attempt} 次",
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
    generation_config_id: null,
    generation_config_name: null,
    resource_group_id: null,
    resource_group_name: null,
    attempt: null,
    max_attempts: null,
    next_attempt: null,
    node_id: null,
    node_title: null,
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

  it("parses attempt-failed websocket events and backfills legacy optional fields", () => {
    const event = taskEvent({
      status: "attempt_failed",
      failure_reason: "供应商超时",
      generation_config_name: "图片配置 A",
      attempt: 1,
      max_attempts: 3,
      next_attempt: 2,
      finished_at: null,
    });
    expect(parseTaskNotificationEvent(JSON.stringify(event))).toEqual(event);
    expect(
      parseTaskNotificationEvent(
        JSON.stringify({
          type: "task_notification",
          event_id: "legacy-event",
          task_kind: "image_session_generation",
          task_id: "task-1",
          owner_user_id: "user-1",
          status: "failed",
          title: "会话 A",
          failure_reason: "供应商拒绝",
          finished_at: "2026-06-08T00:01:00Z",
          resource_id: "session-1",
        }),
      ),
    ).toMatchObject({
      generation_config_id: null,
      generation_config_name: null,
      attempt: null,
      max_attempts: null,
      next_attempt: null,
    });
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
          generation_config_name: "文案配置 A",
          node_title: "卖点文案",
        }),
        t,
      ),
    ).toMatchObject({
      title: "工作流失败",
      body: "灵感 A 失败：节点失败",
      bodyLines: [
        { text: "灵感 A 失败：节点失败" },
        { text: "失败节点：卖点文案", tone: "muted" },
        { text: "生成设置：文案配置 A", tone: "muted" },
      ],
      variant: "error",
      autoClose: false,
      dedupeKey: "workflow-run-failed:run-1",
    });
    expect(buildTaskNotificationEventNotification(taskEvent({ status: "cancelled" }), t)).toBeNull();
  });

  it("builds warning notifications for failed image attempts", () => {
    expect(
      buildTaskNotificationEventNotification(
        taskEvent({
          status: "attempt_failed",
          failure_reason: "供应商超时",
          generation_config_name: "图片配置 A",
          attempt: 1,
          max_attempts: 3,
          next_attempt: 2,
          finished_at: null,
        }),
        t,
      ),
    ).toMatchObject({
      title: "重试中",
      body: "会话 A 第 1/3 次失败",
      bodyLines: [
        { text: "会话 A 第 1/3 次失败", tone: "warning" },
        { text: "将进入第 2/3 次", tone: "warning" },
        { text: "生成设置：图片配置 A", tone: "muted" },
        { text: "失败原因：供应商超时", tone: "danger" },
      ],
      variant: "warning",
      autoClose: false,
      dedupeKey: "image-task-attempt-failed:task-1:1",
    });
  });
});
