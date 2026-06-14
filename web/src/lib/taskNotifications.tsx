import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { api } from "./api";
import { useNotifications, type NotificationInput } from "./notifications";
import { useI18n, type TranslateFunction } from "./preferences";
import type {
  ImageSessionStatus,
  InspirationDetail,
  InspirationWorkflowStatus,
  JobStatus,
  TaskNotificationEvent,
  WorkflowRunStatus,
} from "./types";

function isWorkflowRunActive(status: WorkflowRunStatus): boolean {
  return status === "running" || status === "waiting_confirmation";
}

function isImageTaskActive(status: JobStatus): boolean {
  return status === "queued" || status === "running";
}

function queryKeyStartsWith(queryKey: readonly unknown[], prefix: string): boolean {
  return queryKey[0] === prefix;
}

export function buildImageTaskTransitionNotification(
  task: ImageSessionStatus["generation_tasks"][number],
  previousStatus: JobStatus | undefined,
  sessionTitle: string,
  t: TranslateFunction,
): NotificationInput | null {
  if (!previousStatus || !isImageTaskActive(previousStatus)) {
    return null;
  }
  if (task.status === "succeeded") {
    return {
      title: t("notification.imageDone.title"),
      body: t("notification.imageDone.body", { title: sessionTitle }),
      variant: "success",
      autoClose: true,
      dedupeKey: `image-task-succeeded:${task.id}`,
    };
  }
  if (task.status === "failed") {
    return {
      title: t("notification.imageFailed.title"),
      body: task.failure_reason
        ? t("notification.imageFailed.bodyWithReason", { title: sessionTitle, reason: task.failure_reason })
        : t("notification.imageFailed.body", { title: sessionTitle }),
      variant: "error",
      autoClose: false,
      dedupeKey: `image-task-failed:${task.id}`,
    };
  }
  return null;
}

export function buildWorkflowRunTransitionNotification(
  run: InspirationWorkflowStatus["runs"][number],
  previousStatus: WorkflowRunStatus | undefined,
  inspirationName: string,
  t: TranslateFunction,
): NotificationInput | null {
  if (!previousStatus || !isWorkflowRunActive(previousStatus)) {
    return null;
  }
  if (run.status === "succeeded") {
    return {
      title: t("notification.inspirationDone.title"),
      body: t("notification.inspirationDone.body", { name: inspirationName }),
      variant: "success",
      autoClose: true,
      dedupeKey: `workflow-run-succeeded:${run.id}`,
    };
  }
  if (run.status === "failed") {
    return {
      title: t("notification.inspirationFailed.title"),
      body: run.failure_reason
        ? t("notification.inspirationFailed.bodyWithReason", { name: inspirationName, reason: run.failure_reason })
        : t("notification.inspirationFailed.body", { name: inspirationName }),
      variant: "error",
      autoClose: false,
      dedupeKey: `workflow-run-failed:${run.id}`,
    };
  }
  return null;
}

export function buildTaskNotificationEventNotification(
  event: TaskNotificationEvent,
  t: TranslateFunction,
): NotificationInput | null {
  if (event.task_kind === "image_session_generation") {
    if (event.status === "succeeded") {
      return {
        title: t("notification.imageDone.title"),
        body: t("notification.imageDone.body", { title: event.title }),
        variant: "success",
        autoClose: true,
        dedupeKey: `image-task-succeeded:${event.task_id}`,
      };
    }
    if (event.status === "attempt_failed") {
      const body = imageAttemptFailedBody(event, t);
      return {
        title: t("notification.imageAttemptFailed.title"),
        body,
        bodyLines: buildAttemptFailedBodyLines(body, event, t),
        variant: "warning",
        autoClose: false,
        dedupeKey: `image-task-attempt-failed:${event.task_id}:${event.attempt ?? event.event_id}`,
      };
    }
    if (event.status === "failed") {
      const body = event.failure_reason
        ? t("notification.imageFailed.bodyWithReason", { title: event.title, reason: event.failure_reason })
        : t("notification.imageFailed.body", { title: event.title });
      return {
        title: t("notification.imageFailed.title"),
        body,
        bodyLines: buildTaskFailureBodyLines(body, event, t, { includeAttempt: true }),
        variant: "error",
        autoClose: false,
        dedupeKey: `image-task-failed:${event.task_id}`,
      };
    }
    return null;
  }

  if (event.task_kind === "inspiration_workflow") {
    if (event.status === "succeeded") {
      return {
        title: t("notification.inspirationDone.title"),
        body: t("notification.inspirationDone.body", { name: event.title }),
        variant: "success",
        autoClose: true,
        dedupeKey: `workflow-run-succeeded:${event.task_id}`,
      };
    }
    if (event.status === "failed") {
      const body = event.failure_reason
        ? t("notification.inspirationFailed.bodyWithReason", { name: event.title, reason: event.failure_reason })
        : t("notification.inspirationFailed.body", { name: event.title });
      return {
        title: t("notification.inspirationFailed.title"),
        body,
        bodyLines: buildTaskFailureBodyLines(body, event, t, { includeWorkflowNode: true }),
        variant: "error",
        autoClose: false,
        dedupeKey: `workflow-run-failed:${event.task_id}`,
      };
    }
  }
  return null;
}

export function parseTaskNotificationEvent(rawMessage: string): TaskNotificationEvent | null {
  let payload: unknown;
  try {
    payload = JSON.parse(rawMessage);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const record = payload as Record<string, unknown>;
  if (record.type !== "task_notification") {
    return null;
  }
  if (record.task_kind !== "image_session_generation" && record.task_kind !== "inspiration_workflow") {
    return null;
  }
  if (
    record.status !== "succeeded" &&
    record.status !== "failed" &&
    record.status !== "cancelled" &&
    record.status !== "attempt_failed"
  ) {
    return null;
  }
  const event_id = requiredString(record.event_id);
  const task_id = requiredString(record.task_id);
  const owner_user_id = requiredString(record.owner_user_id);
  const title = requiredString(record.title);
  const resource_id = requiredString(record.resource_id);
  if (!event_id || !task_id || !owner_user_id || !title || !resource_id) {
    return null;
  }
  return {
    type: "task_notification",
    event_id,
    task_kind: record.task_kind,
    task_id,
    owner_user_id,
    status: record.status,
    title,
    failure_reason: optionalString(record.failure_reason),
    finished_at: optionalString(record.finished_at),
    resource_id,
    generation_config_id: optionalString(record.generation_config_id),
    generation_config_name: optionalString(record.generation_config_name),
    resource_group_id: optionalString(record.resource_group_id),
    resource_group_name: optionalString(record.resource_group_name),
    attempt: optionalPositiveInteger(record.attempt),
    max_attempts: optionalPositiveInteger(record.max_attempts),
    next_attempt: optionalPositiveInteger(record.next_attempt),
    node_id: optionalString(record.node_id),
    node_title: optionalString(record.node_title),
  };
}

export function taskNotificationWebSocketUrl(): string | null {
  if (typeof window === "undefined" || !("WebSocket" in window)) {
    return null;
  }
  const url = new URL(api.toApiUrl("/api/task-notifications/ws"), window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function requiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function optionalPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function generationContextLine(event: TaskNotificationEvent, t: TranslateFunction): string | null {
  const context =
    event.generation_config_name ??
    event.generation_config_id ??
    event.resource_group_name ??
    event.resource_group_id;
  return context ? t("notification.generationContext", { context }) : null;
}

function imageAttemptFailedBody(event: TaskNotificationEvent, t: TranslateFunction): string {
  if (event.attempt && event.max_attempts) {
    return t("notification.imageAttemptFailed.body", {
      title: event.title,
      attempt: event.attempt,
      maxAttempts: event.max_attempts,
    });
  }
  if (event.attempt) {
    return t("notification.imageAttemptFailed.bodyWithoutMax", { title: event.title, attempt: event.attempt });
  }
  return t("notification.imageAttemptFailed.bodyUnknown", { title: event.title });
}

function buildAttemptFailedBodyLines(
  body: string,
  event: TaskNotificationEvent,
  t: TranslateFunction,
): NonNullable<NotificationInput["bodyLines"]> {
  const lines: NonNullable<NotificationInput["bodyLines"]> = [{ text: body, tone: "warning" }];
  if (event.next_attempt && event.max_attempts) {
    lines.push({
      text: t("notification.imageAttemptFailed.retryLine", {
        nextAttempt: event.next_attempt,
        maxAttempts: event.max_attempts,
      }),
      tone: "warning",
    });
  }
  const contextLine = generationContextLine(event, t);
  if (contextLine) {
    lines.push({ text: contextLine, tone: "muted" });
  }
  if (event.failure_reason) {
    lines.push({ text: t("notification.failureReasonLine", { reason: event.failure_reason }), tone: "danger" });
  }
  return lines;
}

function buildTaskFailureBodyLines(
  body: string,
  event: TaskNotificationEvent,
  t: TranslateFunction,
  options: { includeAttempt?: boolean; includeWorkflowNode?: boolean } = {},
): NotificationInput["bodyLines"] {
  const lines: NonNullable<NotificationInput["bodyLines"]> = [{ text: body }];
  if (options.includeWorkflowNode) {
    const node = event.node_title ?? event.node_id;
    if (node) {
      lines.push({ text: t("notification.workflowFailed.nodeLine", { node }), tone: "muted" });
    }
  }
  const contextLine = generationContextLine(event, t);
  if (contextLine) {
    lines.push({ text: contextLine, tone: "muted" });
  }
  if (options.includeAttempt && event.attempt) {
    lines.push({ text: t("notification.taskAttemptLine", { attempt: event.attempt }), tone: "muted" });
  }
  return lines.length > 1 ? lines : undefined;
}

function taskNotificationTransitionKey(event: TaskNotificationEvent): string {
  if (event.status === "attempt_failed") {
    return `${event.task_kind}:${event.task_id}:${event.status}:${event.attempt ?? event.event_id}`;
  }
  return `${event.task_kind}:${event.task_id}:${event.status}`;
}

export function TaskNotificationBridge({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient();
  const { notify } = useNotifications();
  const { t } = useI18n();
  const workflowRunStatusesRef = useRef<Map<string, WorkflowRunStatus>>(new Map());
  const imageTaskStatusesRef = useRef<Map<string, JobStatus>>(new Map());
  const notifiedWorkflowRunTransitionsRef = useRef<Set<string>>(new Set());
  const notifiedImageTaskTransitionsRef = useRef<Set<string>>(new Set());
  const notifiedWebSocketTransitionsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) {
      workflowRunStatusesRef.current.clear();
      imageTaskStatusesRef.current.clear();
      notifiedWorkflowRunTransitionsRef.current.clear();
      notifiedImageTaskTransitionsRef.current.clear();
      notifiedWebSocketTransitionsRef.current.clear();
      return undefined;
    }

    let closed = false;
    let reconnectTimer: number | null = null;
    let websocket: WebSocket | null = null;

    function clearReconnectTimer() {
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }

    function connect() {
      const url = taskNotificationWebSocketUrl();
      if (!url) {
        return;
      }
      websocket = new window.WebSocket(url);
      websocket.onmessage = (event) => {
        if (typeof event.data !== "string") {
          return;
        }
        const taskEvent = parseTaskNotificationEvent(event.data);
        if (!taskEvent) {
          return;
        }
        const notification = buildTaskNotificationEventNotification(taskEvent, t);
        if (!notification) {
          return;
        }
        const transitionKey = taskNotificationTransitionKey(taskEvent);
        if (notifiedWebSocketTransitionsRef.current.has(transitionKey)) {
          return;
        }
        notifiedWebSocketTransitionsRef.current.add(transitionKey);
        if (taskEvent.task_kind === "image_session_generation") {
          notifiedImageTaskTransitionsRef.current.add(
            taskEvent.status === "attempt_failed"
              ? taskNotificationTransitionKey(taskEvent)
              : `${taskEvent.task_id}:${taskEvent.status}`,
          );
        } else {
          notifiedWorkflowRunTransitionsRef.current.add(`${taskEvent.task_id}:${taskEvent.status}`);
        }
        notify(notification);
      };
      websocket.onclose = () => {
        if (closed) {
          return;
        }
        clearReconnectTimer();
        reconnectTimer = window.setTimeout(connect, 2000);
      };
      websocket.onerror = () => {
        websocket?.close();
      };
    }

    connect();
    return () => {
      closed = true;
      clearReconnectTimer();
      websocket?.close();
    };
  }, [enabled, notify, t]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    return queryClient.getQueryCache().subscribe((event) => {
      const queryKey = event.query.queryKey;
      if (!Array.isArray(queryKey)) {
        return;
      }

      if (queryKeyStartsWith(queryKey, "inspiration-workflow-status")) {
        const status = event.query.state.data as InspirationWorkflowStatus | undefined;
        if (!status) {
          return;
        }
        const inspiration = queryClient.getQueryData<InspirationDetail>(["inspiration", status.inspiration_id]);
        const inspirationName = inspiration?.name || status.title || t("notification.inspirationDone.fallbackName");
        for (const run of status.runs) {
          const previousStatus = workflowRunStatusesRef.current.get(run.id);
          const notification = buildWorkflowRunTransitionNotification(run, previousStatus, inspirationName, t);
          const notificationKey = notification ? `${run.id}:${run.status}` : null;
          if (notification && notificationKey && !notifiedWorkflowRunTransitionsRef.current.has(notificationKey)) {
            notifiedWorkflowRunTransitionsRef.current.add(notificationKey);
            notify(notification);
          }
          workflowRunStatusesRef.current.set(run.id, run.status);
        }
        return;
      }

      if (queryKeyStartsWith(queryKey, "image-session-status")) {
        const status = event.query.state.data as ImageSessionStatus | undefined;
        if (!status) {
          return;
        }
        for (const task of status.generation_tasks) {
          const previousStatus = imageTaskStatusesRef.current.get(task.id);
          const notification = buildImageTaskTransitionNotification(task, previousStatus, status.title, t);
          const notificationKey = notification ? `${task.id}:${task.status}` : null;
          if (notification && notificationKey && !notifiedImageTaskTransitionsRef.current.has(notificationKey)) {
            notifiedImageTaskTransitionsRef.current.add(notificationKey);
            notify(notification);
          }
          imageTaskStatusesRef.current.set(task.id, task.status);
        }
      }
    });
  }, [enabled, notify, queryClient, t]);

  return null;
}
