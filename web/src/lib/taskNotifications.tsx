import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useNotifications, type NotificationInput } from "./notifications";
import { useI18n, type TranslateFunction } from "./preferences";
import type {
  ImageSessionStatus,
  InspirationDetail,
  InspirationWorkflowStatus,
  JobStatus,
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

export function TaskNotificationBridge({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient();
  const { notify } = useNotifications();
  const { t } = useI18n();
  const workflowRunStatusesRef = useRef<Map<string, WorkflowRunStatus>>(new Map());
  const imageTaskStatusesRef = useRef<Map<string, JobStatus>>(new Map());
  const notifiedWorkflowRunIdsRef = useRef<Set<string>>(new Set());
  const notifiedImageTaskTransitionsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) {
      workflowRunStatusesRef.current.clear();
      imageTaskStatusesRef.current.clear();
      notifiedWorkflowRunIdsRef.current.clear();
      notifiedImageTaskTransitionsRef.current.clear();
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
          if (
            previousStatus &&
            isWorkflowRunActive(previousStatus) &&
            run.status === "succeeded" &&
            !notifiedWorkflowRunIdsRef.current.has(run.id)
          ) {
            notifiedWorkflowRunIdsRef.current.add(run.id);
            notify({
              title: t("notification.inspirationDone.title"),
              body: t("notification.inspirationDone.body", { name: inspirationName }),
              variant: "success",
              autoClose: true,
              dedupeKey: `workflow-run-succeeded:${run.id}`,
            });
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
