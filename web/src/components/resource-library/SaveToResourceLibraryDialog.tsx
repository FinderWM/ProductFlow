import { useEffect, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CheckCircle2, Image as ImageIcon, Save, X } from "lucide-react";

import { api, ApiError } from "../../lib/api";
import {
  asyncViewPhase,
  asyncViewStateFromQuery,
  combineAsyncViewStates,
} from "../../lib/asyncViewState";
import { useI18n } from "../../lib/preferences";
import type { ResourceLibraryAsset, ResourceLibraryGroup, ResourceLibrarySourceType } from "../../lib/types";
import type { ActionButtonPreset } from "../ActionButton";
import { actionButtonComponentForAppearance } from "../layoutActionButtons";
import { AsyncContent, AsyncErrorState, AsyncPausedState } from "../loading/AsyncContent";
import { Skeleton } from "../loading/Skeleton";
import { ModalShell } from "../ModalShell";
import { WorkspaceOptionToggle } from "../workspaceInputs";

type SaveToResourceLibraryDialogAppearance = "classic" | "workspace";

export interface ResourceLibrarySaveSource {
  source_type: ResourceLibrarySourceType;
  source_id: string;
  title?: string;
  thumbnail_url?: string | null;
}

interface SaveToResourceLibraryDialogProps {
  source: ResourceLibrarySaveSource | null;
  canWrite: boolean;
  appearance?: SaveToResourceLibraryDialogAppearance;
  saveButtonPreset?: ActionButtonPreset;
  onClose: () => void;
  onSaved?: (asset: ResourceLibraryAsset) => void;
}

const EMPTY_RESOURCE_LIBRARY_GROUPS: ResourceLibraryGroup[] = [];
const RESOURCE_LIBRARY_SAVE_FEEDBACK_AUTO_DISMISS_MS = 1000;

function ResourceLibrarySaveFeedbackDialog({
  successMessage,
  errorMessage,
  appearance,
  onCloseSuccess,
  onCloseError,
}: {
  successMessage: string;
  errorMessage: string;
  appearance: SaveToResourceLibraryDialogAppearance;
  onCloseSuccess: () => void;
  onCloseError: () => void;
}) {
  const { t } = useI18n();
  const ActionButtonComponent = actionButtonComponentForAppearance(appearance);
  const titleId = useId();
  const descriptionId = useId();
  const open = Boolean(successMessage || errorMessage);
  const isError = Boolean(errorMessage);
  const message = errorMessage || successMessage;

  if (!open) {
    return null;
  }

  const Icon = isError ? X : CheckCircle2;

  return (
    <ModalShell
      open={open}
      role={isError ? "alertdialog" : "dialog"}
      onClose={isError ? onCloseError : onCloseSuccess}
      ariaLabelledBy={titleId}
      ariaDescribedBy={descriptionId}
      overlayClassName="z-[120] bg-slate-950/45 px-4 py-6 backdrop-blur-sm"
      panelClassName="w-full max-w-sm overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-slate-700/80 dark:bg-[#0f1726] dark:shadow-black/45 animate-spring-pop-in"
    >
        <div className="flex items-start gap-3 px-5 py-5">
          <div
            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              isError
                ? "bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-200"
                : "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-200"
            }`}
          >
            <Icon size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-semibold text-slate-950 dark:text-white">
              {isError ? t("settings.operationFailed") : t("settings.operationSucceeded")}
            </h2>
            <p id={descriptionId} className="mt-2 break-words text-sm leading-6 text-slate-600 dark:text-slate-300">
              {message}
            </p>
          </div>
          {isError ? (
            <ActionButtonComponent
              preset="secondary"
              size="icon-md"
              onClick={onCloseError}
              aria-label={t("resourceLibrary.close")}
              title={t("resourceLibrary.close")}
              leadingIcon={<X size={16} />}
            >
            </ActionButtonComponent>
          ) : null}
        </div>
    </ModalShell>
  );
}

export function SaveToResourceLibraryDialog({
  source,
  canWrite,
  appearance = "classic",
  saveButtonPreset = "primary",
  onClose,
  onSaved,
}: SaveToResourceLibraryDialogProps) {
  const { t } = useI18n();
  const ActionButtonComponent = actionButtonComponentForAppearance(appearance);
  const queryClient = useQueryClient();
  const open = Boolean(source);
  const titleId = useId();
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [successMessage, setSuccessMessage] = useState("");
  const [feedbackError, setFeedbackError] = useState("");

  const groupsQuery = useQuery({
    queryKey: ["resource-library-groups"],
    queryFn: api.listResourceLibraryGroups,
    enabled: open && canWrite,
  });
  const sourceStatusQuery = useQuery({
    queryKey: ["resource-library-source-status", source?.source_type ?? "", source?.source_id ?? ""],
    queryFn: () =>
      api.listResourceLibrarySourceStatus({
        source_type: source!.source_type,
        source_ids: [source!.source_id],
      }),
    enabled: open && canWrite && Boolean(source),
  });
  const groupsState = asyncViewStateFromQuery({
    active: open && canWrite,
    data: groupsQuery.data,
    dataUpdatedAt: groupsQuery.dataUpdatedAt,
    isSuccess: groupsQuery.isSuccess,
    isError: groupsQuery.isError,
    fetchStatus: groupsQuery.fetchStatus,
    isEmpty: (data) => data.items.length === 0,
  });
  const sourceStatusState = asyncViewStateFromQuery({
    active: open && canWrite && Boolean(source),
    data: sourceStatusQuery.data,
    dataUpdatedAt: sourceStatusQuery.dataUpdatedAt,
    isSuccess: sourceStatusQuery.isSuccess,
    isError: sourceStatusQuery.isError,
    fetchStatus: sourceStatusQuery.fetchStatus,
    isEmpty: () => false,
  });
  const sourceStatusPhase = asyncViewPhase(sourceStatusState);
  const dialogDataState = combineAsyncViewStates({
    active: open && canWrite && Boolean(source),
    critical: [groupsState, sourceStatusState],
    isEmpty: (groupsQuery.data?.items.length ?? 0) === 0,
  });
  const dialogDataPhase = asyncViewPhase(dialogDataState);
  const groups = groupsQuery.data?.items ?? EMPTY_RESOURCE_LIBRARY_GROUPS;
  const sourceStatus = sourceStatusQuery.data?.items[0] ?? null;
  const alreadySaved = Boolean(sourceStatus?.saved);
  const existingGroupIds = new Set(sourceStatus?.group_ids ?? []);

  useEffect(() => {
    if (!open) {
      setSelectedGroupIds([]);
      setSuccessMessage("");
      setFeedbackError("");
    }
  }, [open]);

  useEffect(() => {
    setSelectedGroupIds([]);
  }, [source?.source_id, source?.source_type]);

  useEffect(() => {
    if (dialogDataPhase !== "ready" && dialogDataPhase !== "empty") {
      return;
    }
    setSelectedGroupIds((current) => {
      const availableIds = new Set(groups.map((group) => group.id));
      const next = current.filter((groupId) => availableIds.has(groupId) && !existingGroupIds.has(groupId));
      return next.length === current.length && next.every((groupId, index) => groupId === current[index])
        ? current
        : next;
    });
  }, [dialogDataPhase, groups, sourceStatus?.group_ids]);

  function retryDialogData() {
    void Promise.all([groupsQuery.refetch(), sourceStatusQuery.refetch()]);
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      if (!source) {
        throw new ApiError(400, t("resourceLibrary.saveFailed"));
      }
      if (!selectedGroupIds.length) {
        throw new ApiError(400, t("resourceLibrary.groupRequired"));
      }
      return api.saveResourceLibraryAsset({
        source_type: source.source_type,
        source_id: source.source_id,
        group_ids: selectedGroupIds,
      });
    },
    onSuccess: (asset) => {
      setFeedbackError("");
      setSuccessMessage(t("resourceLibrary.saved"));
      onSaved?.(asset);
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["resource-library-assets"] }),
        queryClient.invalidateQueries({ queryKey: ["resource-library-groups"] }),
        queryClient.invalidateQueries({ queryKey: ["resource-library-source-status"] }),
      ]);
    },
    onError: (mutationError) => {
      setSuccessMessage("");
      setFeedbackError(mutationError instanceof ApiError ? mutationError.detail : t("resourceLibrary.saveFailed"));
    },
  });

  useEffect(() => {
    if (!successMessage) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setSuccessMessage("");
      onClose();
    }, RESOURCE_LIBRARY_SAVE_FEEDBACK_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [onClose, successMessage]);

  function toggleGroup(groupId: string, checked: boolean) {
    setSelectedGroupIds((current) => {
      if (checked) {
        return [...new Set([...current, groupId])];
      }
      return current.filter((id) => id !== groupId);
    });
  }

  function handleSave() {
    if (!selectedGroupIds.length) {
      setSuccessMessage("");
      setFeedbackError(t("resourceLibrary.groupRequired"));
      return;
    }
    saveMutation.mutate();
  }

  if (!open) {
    return null;
  }

  const dialogDataErrorMessage =
    sourceStatusQuery.isError && sourceStatusState.content === "none"
      ? t("resourceLibrary.sourceStatusLoadFailed")
      : t("resourceLibrary.loadFailed");

  const dialog = (
    <>
      <ModalShell
        open={open}
        onClose={onClose}
        closeDisabled={saveMutation.isPending || Boolean(successMessage || feedbackError)}
        ariaLabelledBy={titleId}
        overlayClassName="pf-settings-workspace z-[110] bg-slate-950/60 px-4 py-6 backdrop-blur-sm"
        panelClassName="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-slate-700 dark:bg-[#0f1726] dark:shadow-black/45"
      >
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <div className="min-w-0">
              <div id={titleId} className="text-base font-semibold text-slate-950 dark:text-white">
                {t("resourceLibrary.saveDialogTitle")}
              </div>
              {source?.title ? (
                <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{source.title}</div>
              ) : null}
            </div>
            <ActionButtonComponent
              preset="secondary"
              size="icon-md"
              onClick={onClose}
              disabled={saveMutation.isPending}
              aria-label={t("resourceLibrary.close")}
              title={t("resourceLibrary.close")}
              leadingIcon={<X size={18} />}
            >
            </ActionButtonComponent>
          </div>

          <div className="space-y-4 px-5 py-4">
            {!canWrite ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-200">
                {t("resourceLibrary.permissionWriteRequired")}
              </div>
            ) : null}
            {source?.thumbnail_url ? (
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950/45">
                <img
                  src={api.toApiUrl(source.thumbnail_url)}
                  alt={source.title ?? t("resourceLibrary.saveToLibrary")}
                  className="h-16 w-16 shrink-0 rounded-lg object-cover"
                />
                <div className="min-w-0 text-sm font-medium text-slate-800 dark:text-slate-100">
                  <div className="truncate">{source.title ?? t("resourceLibrary.saveToLibrary")}</div>
                  <div className="mt-1 text-xs font-normal text-slate-500 dark:text-slate-400">
                    {sourceStatusPhase === "loading" ? (
                      <Skeleton className="h-3 w-32" />
                    ) : sourceStatusPhase === "paused" ? (
                      t("app.requestPaused.title")
                    ) : sourceStatusPhase === "initial-error" || sourceStatusPhase === "initial-idle" ? (
                      t("resourceLibrary.sourceStatusLoadFailed")
                    ) : alreadySaved ? (
                      t("resourceLibrary.alreadyInLibrary")
                    ) : (
                      t("resourceLibrary.selectGroups")
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-slate-500 dark:border-slate-700 dark:bg-slate-950/45 dark:text-slate-300">
                <ImageIcon size={20} />
                <span className="text-sm">{t("resourceLibrary.selectGroups")}</span>
              </div>
            )}

            <div>
              <div className="mb-2 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
                {t("resourceLibrary.groups")}
              </div>
              <AsyncContent
                state={dialogDataState}
                refreshIntent="background"
                loadingLabel={t("resourceLibrary.loading")}
                skeleton={(
                  <div className="grid gap-2 sm:grid-cols-2">
                    {[1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-10 w-full" rounded="lg" />)}
                  </div>
                )}
                initialError={(
                  <AsyncErrorState
                    title={dialogDataErrorMessage}
                    retryLabel={t("common.retry")}
                    retryingLabel={t("resourceLibrary.loading")}
                    retrying={dialogDataState.fetch === "fetching"}
                    onRetry={retryDialogData}
                  />
                )}
                paused={(
                  <AsyncPausedState
                    title={t("app.requestPaused.title")}
                    message={t("app.requestPaused.message")}
                    retryLabel={t("common.retry")}
                    onRetry={retryDialogData}
                  />
                )}
                inactive={null}
                empty={(
                  <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                    {t("resourceLibrary.noGroups")}
                  </div>
                )}
                refreshFeedback={
                  dialogDataState.error === "refresh" ? (
                    <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-100">
                      <span>{dialogDataErrorMessage}</span>
                      <button type="button" className="font-semibold underline" onClick={retryDialogData}>
                        {t("common.retry")}
                      </button>
                    </div>
                  ) : null
                }
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  {groups.map((group) => {
                    const alreadyLinked = existingGroupIds.has(group.id);
                    const selected = selectedGroupIds.includes(group.id);
                    return (
                      <WorkspaceOptionToggle
                        key={group.id}
                        checked={selected || alreadyLinked}
                        disabled={!canWrite || saveMutation.isPending || alreadyLinked}
                        layout="card"
                        className={`min-h-10 w-full items-center px-3 py-2 text-sm font-medium ${
                          alreadyLinked
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/10 dark:text-emerald-200"
                            : "justify-between"
                        }`}
                        onChange={(checked) => toggleGroup(group.id, checked)}
                      >
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          <span className="min-w-0 flex-1 whitespace-normal break-words leading-5">{group.name}</span>
                          {alreadyLinked ? (
                            <span className="shrink-0 text-[10px] font-semibold">
                              {t("resourceLibrary.alreadyInLibrary")}
                            </span>
                          ) : selected ? (
                            <Check
                              size={14}
                              className="shrink-0 text-[var(--pf-accent,#047857)] dark:text-[var(--pf-accent,#a7f3d0)]"
                            />
                          ) : null}
                        </span>
                      </WorkspaceOptionToggle>
                    );
                  })}
                </div>
              </AsyncContent>
            </div>
          </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
          <ActionButtonComponent
            preset="secondary"
            size="md"
            onClick={onClose}
            disabled={saveMutation.isPending}
          >
            {t("common.cancel")}
          </ActionButtonComponent>
          <ActionButtonComponent
            preset={saveButtonPreset}
            size="md"
            onClick={handleSave}
            disabled={
              !canWrite ||
              !selectedGroupIds.length ||
              saveMutation.isPending ||
              dialogDataPhase !== "ready"
            }
            loading={saveMutation.isPending}
            leadingIcon={<Save size={15} />}
          >
            {t("resourceLibrary.saveToLibrary")}
          </ActionButtonComponent>
        </div>
      </ModalShell>
    <ResourceLibrarySaveFeedbackDialog
      successMessage={successMessage}
      errorMessage={feedbackError}
      appearance={appearance}
      onCloseSuccess={() => {
        setSuccessMessage("");
        onClose();
      }}
      onCloseError={() => setFeedbackError("")}
    />
    </>
  );

  return dialog;
}
