import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Image as ImageIcon, Loader2, Save, X } from "lucide-react";

import { api, ApiError } from "../../lib/api";
import { useI18n } from "../../lib/preferences";
import type { ResourceLibraryAsset, ResourceLibraryGroup, ResourceLibrarySourceType } from "../../lib/types";

export interface ResourceLibrarySaveSource {
  source_type: ResourceLibrarySourceType;
  source_id: string;
  title?: string;
  thumbnail_url?: string | null;
}

interface SaveToResourceLibraryDialogProps {
  source: ResourceLibrarySaveSource | null;
  canWrite: boolean;
  onClose: () => void;
  onSaved?: (asset: ResourceLibraryAsset) => void;
}

const EMPTY_RESOURCE_LIBRARY_GROUPS: ResourceLibraryGroup[] = [];

export function SaveToResourceLibraryDialog({
  source,
  canWrite,
  onClose,
  onSaved,
}: SaveToResourceLibraryDialogProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const open = Boolean(source);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [error, setError] = useState("");

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
  const groups = groupsQuery.data?.items ?? EMPTY_RESOURCE_LIBRARY_GROUPS;
  const sourceStatus = sourceStatusQuery.data?.items[0] ?? null;
  const alreadySaved = Boolean(sourceStatus?.saved);
  const existingGroupIds = new Set(sourceStatus?.group_ids ?? []);

  useEffect(() => {
    if (!open) {
      setSelectedGroupIds([]);
      setError("");
    }
  }, [open]);

  useEffect(() => {
    setSelectedGroupIds([]);
  }, [source?.source_id, source?.source_type]);

  useEffect(() => {
    setSelectedGroupIds((current) => {
      const availableIds = new Set(groups.map((group) => group.id));
      const next = current.filter((groupId) => availableIds.has(groupId) && !existingGroupIds.has(groupId));
      return next.length === current.length && next.every((groupId, index) => groupId === current[index])
        ? current
        : next;
    });
  }, [groups, sourceStatus?.group_ids]);

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
    onSuccess: async (asset) => {
      setError("");
      await queryClient.invalidateQueries({ queryKey: ["resource-library-assets"] });
      await queryClient.invalidateQueries({ queryKey: ["resource-library-groups"] });
      await queryClient.invalidateQueries({ queryKey: ["resource-library-source-status"] });
      onSaved?.(asset);
      onClose();
    },
    onError: (mutationError) => {
      setError(mutationError instanceof ApiError ? mutationError.detail : t("resourceLibrary.saveFailed"));
    },
  });

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
      setError(t("resourceLibrary.groupRequired"));
      return;
    }
    saveMutation.mutate();
  }

  if (!open) {
    return null;
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("resourceLibrary.saveDialogTitle")}
      className="fixed inset-0 z-[82] flex items-center justify-center bg-slate-950/60 px-4 py-6 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saveMutation.isPending) {
          onClose();
        }
      }}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-slate-700 dark:bg-[#0f1726] dark:shadow-black/45">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="min-w-0">
            <div className="text-base font-semibold text-slate-950 dark:text-white">
              {t("resourceLibrary.saveDialogTitle")}
            </div>
            {source?.title ? (
              <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{source.title}</div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saveMutation.isPending}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950 disabled:opacity-60 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            aria-label={t("resourceLibrary.close")}
            title={t("resourceLibrary.close")}
          >
            <X size={18} />
          </button>
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
                  {alreadySaved ? t("resourceLibrary.alreadyInLibrary") : t("resourceLibrary.selectGroups")}
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
            {groupsQuery.isLoading ? (
              <div className="flex h-24 items-center justify-center text-slate-400">
                <Loader2 size={18} className="animate-spin" />
              </div>
            ) : groupsQuery.isError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200">
                {t("resourceLibrary.loadFailed")}
              </div>
            ) : groups.length ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {groups.map((group) => {
                  const alreadyLinked = existingGroupIds.has(group.id);
                  const selected = selectedGroupIds.includes(group.id);
                  return (
                    <label
                      key={group.id}
                      className={`flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium ${
                        alreadyLinked
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/10 dark:text-emerald-200"
                          : "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-950/55 dark:text-slate-200"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected || alreadyLinked}
                        onChange={(event) => toggleGroup(group.id, event.target.checked)}
                        disabled={!canWrite || saveMutation.isPending || alreadyLinked}
                        className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:opacity-70 dark:border-slate-600 dark:bg-slate-950 dark:text-violet-400 dark:focus:ring-violet-400"
                      />
                      <span className="min-w-0 truncate">{group.name}</span>
                      {alreadyLinked ? (
                        <span className="ml-auto shrink-0 text-[10px] font-semibold">
                          {t("resourceLibrary.alreadyInLibrary")}
                        </span>
                      ) : selected ? (
                        <Check size={14} className="ml-auto shrink-0 text-indigo-600 dark:text-violet-300" />
                      ) : null}
                    </label>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                {t("resourceLibrary.noGroups")}
              </div>
            )}
          </div>

          {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200">{error}</div> : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            disabled={saveMutation.isPending}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950/70 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={
              !canWrite ||
              !selectedGroupIds.length ||
              saveMutation.isPending ||
              groupsQuery.isLoading ||
              sourceStatusQuery.isLoading
            }
            className="inline-flex rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:opacity-60 dark:bg-violet-500/25 dark:text-violet-100 dark:ring-1 dark:ring-violet-400/40"
          >
            {saveMutation.isPending ? <Loader2 size={15} className="mr-2 animate-spin" /> : <Save size={15} className="mr-2" />}
            {t("resourceLibrary.saveToLibrary")}
          </button>
        </div>
      </div>
    </div>
  );
}
