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
    if (event.status === "failed") {
      return {
        title: t("notification.imageFailed.title"),
        body: event.failure_reason
          ? t("notification.imageFailed.bodyWithReason", { title: event.title, reason: event.failure_reason })
          : t("notification.imageFailed.body", { title: event.title }),
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
      return {
        title: t("notification.inspirationFailed.title"),
        body: event.failure_reason
          ? t("notification.inspirationFailed.bodyWithReason", { name: event.title, reason: event.failure_reason })
          : t("notification.inspirationFailed.body", { name: event.title }),
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
  if (record.status !== "succeeded" && record.status !== "failed" && record.status !== "cancelled") {
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

function taskNotificationTransitionKey(event: TaskNotificationEvent): string {
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
          notifiedImageTaskTransitionsRef.current.add(`${taskEvent.task_id}:${taskEvent.status}`);
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
