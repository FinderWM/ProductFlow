import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowRight, Download, Eye, Loader2, Pencil, Plus, Save, Trees } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { GalleryImagePreviewDialog } from "../components/GalleryImagePreviewDialog";
import { ResourceBlockedNotice, ResourceMetaBadges, isResourceBlocked } from "../components/ResourceGovernance";
import { TopNav } from "../components/TopNav";
import { api, ApiError } from "../lib/api";
import { formatDateTime } from "../lib/format";
import type { TranslationKey } from "../lib/i18n";
import { useI18n } from "../lib/preferences";
import type { ResourceLibraryAsset, ResourceLibraryGroup, ResourceLibrarySourceType } from "../lib/types";
import { useUiLayoutScheme } from "../lib/uiLayoutSchemePreference";

type PendingArchive =
  | { kind: "asset"; id: string; name: string }
  | { kind: "group"; id: string; name: string };

const EMPTY_RESOURCE_LIBRARY_GROUPS: ResourceLibraryGroup[] = [];
const EMPTY_RESOURCE_LIBRARY_ASSETS: ResourceLibraryAsset[] = [];
const RESOURCE_LIBRARY_SOURCE_TYPES: ResourceLibrarySourceType[] = [
  "source_asset",
  "poster_variant",
  "image_session_asset",
  "upload",
];

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.detail : fallback;
}

function sameIds(left: string[], right: string[]): boolean {
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.length === rightSorted.length && leftSorted.every((value, index) => value === rightSorted[index]);
}

function groupIdsForAsset(asset: ResourceLibraryAsset, groups: ResourceLibraryGroup[]): string[] {
  const availableIds = new Set(groups.map((group) => group.id));
  return asset.group_ids.filter((groupId) => availableIds.has(groupId));
}

function resourceLibrarySourceLabelKey(sourceType: ResourceLibrarySourceType): TranslationKey {
  switch (sourceType) {
    case "source_asset":
      return "resourceLibrary.source.sourceAsset";
    case "poster_variant":
      return "resourceLibrary.source.posterVariant";
    case "image_session_asset":
      return "resourceLibrary.source.imageSessionAsset";
    case "upload":
      return "resourceLibrary.source.upload";
    default:
      return "resourceLibrary.source.upload";
  }
}

function ResourceLibraryWorkspaceLanding() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logoutMutation = useMutation({
    mutationFn: api.destroySession,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    },
  });
  const groupsQuery = useQuery({
    queryKey: ["resource-library-groups"],
    queryFn: api.listResourceLibraryGroups,
  });
  const assetsQuery = useQuery({
    queryKey: ["resource-library-assets", "all"],
    queryFn: () => api.listResourceLibraryAssets({ group_id: null }),
  });

  const groups = groupsQuery.data?.items ?? EMPTY_RESOURCE_LIBRARY_GROUPS;
  const assets = assetsQuery.data?.items ?? EMPTY_RESOURCE_LIBRARY_ASSETS;
  const latestAssets = assets.slice(0, 3);
  const loading = groupsQuery.isLoading || assetsQuery.isLoading;
  const failed = groupsQuery.isError || assetsQuery.isError;

  const groupAssetCounts = useMemo(() => {
    const counts = new Map(groups.map((group) => [group.id, 0]));
    for (const asset of assets) {
      for (const groupId of asset.group_ids) {
        if (counts.has(groupId)) {
          counts.set(groupId, (counts.get(groupId) ?? 0) + 1);
        }
      }
    }
    return groups.slice(0, 4).map((group) => ({
      group,
      count: counts.get(group.id) ?? 0,
    }));
  }, [assets, groups]);

  const sourceCounts = useMemo(
    () =>
      RESOURCE_LIBRARY_SOURCE_TYPES.map((sourceType) => ({
        sourceType,
        count: assets.filter((asset) => asset.source_type === sourceType).length,
      })),
    [assets],
  );

  const openManagePage = () => navigate("/resource-library/manage");

  return (
    <div className="pf-workspace min-h-screen">
      <TopNav
        breadcrumbs={t("resourceLibrary.title")}
        onHome={() => navigate("/inspirations")}
        onLogout={() => logoutMutation.mutate()}
      />
      <main className="mx-auto max-w-6xl px-4 pb-10 pt-6 sm:px-6 lg:px-8">
        <section className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="pf-workspace-card rounded-lg px-5 py-5">
            <div className="pf-workspace-accent flex items-center gap-2 text-sm font-semibold">
              <Trees size={18} />
              <span>{t("resourceLibrary.title")}</span>
            </div>
            <h1 className="pf-workspace-title mt-3 text-2xl font-semibold tracking-normal">
              {t("resourceLibrary.landingTitle")}
            </h1>
            <p className="pf-workspace-copy mt-2 max-w-2xl text-sm leading-6">
              {t("resourceLibrary.landingSubtitle")}
            </p>
          </div>

          <div className="pf-workspace-card grid grid-cols-3 gap-2 rounded-lg p-3">
            {[
              { label: t("resourceLibrary.groups"), value: groups.length },
              { label: t("resourceLibrary.assets"), value: assets.length },
              { label: t("resourceLibrary.reusableAssets"), value: latestAssets.length },
            ].map((item) => (
              <div key={item.label} className="pf-workspace-card-soft rounded-lg px-3 py-3">
                <div className="pf-workspace-muted text-xs font-medium">{item.label}</div>
                <div className="pf-workspace-title mt-2 text-xl font-semibold">{item.value}</div>
              </div>
            ))}
          </div>
        </section>

        {failed ? (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200">
            {t("resourceLibrary.loadFailed")}
          </div>
        ) : null}

        <section className="pf-workspace-card rounded-lg p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="pf-workspace-title text-base font-semibold">
                {t("resourceLibrary.latestResources")}
              </h2>
              <p className="pf-workspace-muted mt-1 text-sm">
                {t("resourceLibrary.latestResourcesDescription")}
              </p>
            </div>
          </div>

          {loading ? (
            <div className="pf-workspace-card-soft pf-workspace-muted mt-4 flex min-h-48 items-center justify-center rounded-lg">
              <Loader2 size={22} className="animate-spin" />
            </div>
          ) : latestAssets.length ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {latestAssets.map((asset) => (
                <article
                  key={asset.id}
                  className="pf-workspace-card-soft overflow-hidden rounded-lg"
                >
                  <img
                    src={api.toApiUrl(asset.thumbnail_url)}
                    alt={asset.original_filename}
                    loading="lazy"
                    decoding="async"
                    className="aspect-[4/3] w-full object-cover"
                  />
                  <div className="space-y-2 p-3">
                    <div className="pf-workspace-title truncate text-sm font-semibold">
                      {asset.original_filename}
                    </div>
                    <div className="pf-workspace-muted flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="pf-workspace-chip rounded-full px-2 py-0.5 font-medium">
                        {t(resourceLibrarySourceLabelKey(asset.source_type))}
                      </span>
                      <span>{formatDateTime(asset.created_at)}</span>
                    </div>
                    <ResourceMetaBadges resource={asset} showReason />
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="pf-workspace-card-soft pf-workspace-muted mt-4 flex min-h-48 flex-col items-center justify-center gap-3 rounded-lg border-dashed px-6 py-10 text-center text-sm">
              <Trees size={24} className="pf-workspace-accent" />
              <div>{t("resourceLibrary.empty")}</div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openManagePage}
              className="pf-workspace-action-primary inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold transition-colors"
            >
              {t("resourceLibrary.manageLibrary")}
              <ArrowRight size={15} className="ml-2" />
            </button>
            <button
              type="button"
              onClick={openManagePage}
              className="pf-workspace-action-secondary inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold transition-colors"
            >
              {t("resourceLibrary.moreResources")}
              <ArrowRight size={15} className="ml-2" />
            </button>
          </div>
        </section>

        <section className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="pf-workspace-card rounded-lg p-4">
            <h2 className="pf-workspace-title text-base font-semibold">
              {t("resourceLibrary.groupSummary")}
            </h2>
            <div className="mt-3 grid gap-2">
              {groupAssetCounts.length ? (
                groupAssetCounts.map(({ group, count }) => (
                  <div
                    key={group.id}
                    className="pf-workspace-card-soft flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm"
                  >
                    <span className="pf-workspace-title min-w-0 truncate font-medium">{group.name}</span>
                    <span className="pf-workspace-muted shrink-0 text-xs font-semibold">
                      {t("resourceLibrary.assetCount", { count })}
                    </span>
                  </div>
                ))
              ) : (
                <div className="pf-workspace-card-soft pf-workspace-muted rounded-lg border-dashed px-3 py-4 text-sm">
                  {t("resourceLibrary.noGroups")}
                </div>
              )}
            </div>
          </div>

          <div className="pf-workspace-card rounded-lg p-4">
            <h2 className="pf-workspace-title text-base font-semibold">
              {t("resourceLibrary.sourceOverview")}
            </h2>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {sourceCounts.map((item) => (
                <div key={item.sourceType} className="pf-workspace-card-soft rounded-lg px-3 py-3">
                  <div className="pf-workspace-muted text-xs font-medium">
                    {t(resourceLibrarySourceLabelKey(item.sourceType))}
                  </div>
                  <div className="pf-workspace-title mt-2 text-lg font-semibold">{item.count}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

interface ResourceLibraryPageProps {
  mode?: "auto" | "manage";
}

export function ResourceLibraryPage({ mode = "auto" }: ResourceLibraryPageProps) {
  const { activeScheme } = useUiLayoutScheme();

  if (activeScheme === "workspace" && mode !== "manage") {
    return <ResourceLibraryWorkspaceLanding />;
  }

  return <ResourceLibraryManagePage subpage={mode === "manage"} />;
}

function ResourceLibraryManagePage({ subpage = false }: { subpage?: boolean }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState("");
  const [assetGroupDrafts, setAssetGroupDrafts] = useState<Record<string, string[]>>({});
  const [previewAsset, setPreviewAsset] = useState<ResourceLibraryAsset | null>(null);
  const [pendingArchive, setPendingArchive] = useState<PendingArchive | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const groupsQuery = useQuery({
    queryKey: ["resource-library-groups"],
    queryFn: api.listResourceLibraryGroups,
  });
  const groups = groupsQuery.data?.items ?? EMPTY_RESOURCE_LIBRARY_GROUPS;
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? null;

  const assetsQuery = useQuery({
    queryKey: ["resource-library-assets", selectedGroupId || "all"],
    queryFn: () => api.listResourceLibraryAssets({ group_id: selectedGroupId || null }),
  });
  const assets = assetsQuery.data?.items ?? EMPTY_RESOURCE_LIBRARY_ASSETS;

  useEffect(() => {
    if (selectedGroupId && groupsQuery.isSuccess && !groups.some((group) => group.id === selectedGroupId)) {
      setSelectedGroupId("");
    }
  }, [groups, groupsQuery.isSuccess, selectedGroupId]);

  useEffect(() => {
    setAssetGroupDrafts((current) => {
      const next: Record<string, string[]> = {};
      const availableIds = new Set(groups.map((group) => group.id));
      for (const asset of assets) {
        const currentDraft = current[asset.id]?.filter((groupId) => availableIds.has(groupId));
        next[asset.id] = currentDraft?.length ? currentDraft : groupIdsForAsset(asset, groups);
      }
      return next;
    });
  }, [assets, groups]);

  const createGroupMutation = useMutation({
    mutationFn: (name: string) => api.createResourceLibraryGroup({ name, sort_order: groups.length }),
    onSuccess: async (group) => {
      setNewGroupName("");
      setSelectedGroupId(group.id);
      setMessage(t("resourceLibrary.groupCreated"));
      setError("");
      await queryClient.invalidateQueries({ queryKey: ["resource-library-groups"] });
    },
    onError: (mutationError) => {
      setMessage("");
      setError(errorMessage(mutationError, t("resourceLibrary.createGroupFailed")));
    },
  });

  const updateGroupMutation = useMutation({
    mutationFn: (input: { groupId: string; name: string }) =>
      api.updateResourceLibraryGroup(input.groupId, { name: input.name }),
    onSuccess: async () => {
      setEditingGroupId(null);
      setEditingGroupName("");
      setMessage(t("resourceLibrary.groupUpdated"));
      setError("");
      await queryClient.invalidateQueries({ queryKey: ["resource-library-groups"] });
      await queryClient.invalidateQueries({ queryKey: ["resource-library-assets"] });
    },
    onError: (mutationError) => {
      setMessage("");
      setError(errorMessage(mutationError, t("resourceLibrary.updateGroupFailed")));
    },
  });

  const archiveGroupMutation = useMutation({
    mutationFn: (groupId: string) => api.archiveResourceLibraryGroup(groupId),
    onSuccess: async (_, groupId) => {
      if (selectedGroupId === groupId) {
        setSelectedGroupId("");
      }
      setPendingArchive(null);
      setMessage(t("resourceLibrary.groupArchived"));
      setError("");
      await queryClient.invalidateQueries({ queryKey: ["resource-library-groups"] });
      await queryClient.invalidateQueries({ queryKey: ["resource-library-assets"] });
    },
    onError: (mutationError) => {
      setMessage("");
      setError(errorMessage(mutationError, t("resourceLibrary.archiveGroupFailed")));
    },
  });

  const updateAssetGroupsMutation = useMutation({
    mutationFn: (input: { assetId: string; group_ids: string[] }) =>
      api.updateResourceLibraryAssetGroups(input.assetId, { group_ids: input.group_ids }),
    onSuccess: async (asset) => {
      setAssetGroupDrafts((current) => ({ ...current, [asset.id]: asset.group_ids }));
      setMessage(t("resourceLibrary.assetGroupsUpdated"));
      setError("");
      await queryClient.invalidateQueries({ queryKey: ["resource-library-assets"] });
      await queryClient.invalidateQueries({ queryKey: ["resource-library-source-status"] });
    },
    onError: (mutationError) => {
      setMessage("");
      setError(errorMessage(mutationError, t("resourceLibrary.updateAssetGroupsFailed")));
    },
  });

  const archiveAssetMutation = useMutation({
    mutationFn: (assetId: string) => api.archiveResourceLibraryAsset(assetId),
    onSuccess: async () => {
      setPendingArchive(null);
      setPreviewAsset(null);
      setMessage(t("resourceLibrary.assetArchived"));
      setError("");
      await queryClient.invalidateQueries({ queryKey: ["resource-library-assets"] });
      await queryClient.invalidateQueries({ queryKey: ["resource-library-source-status"] });
    },
    onError: (mutationError) => {
      setMessage("");
      setError(errorMessage(mutationError, t("resourceLibrary.archiveAssetFailed")));
    },
  });
  const logoutMutation = useMutation({
    mutationFn: api.destroySession,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    },
  });

  const assetCountLabel = useMemo(() => {
    if (assetsQuery.isLoading) {
      return t("resourceLibrary.loading");
    }
    return t("resourceLibrary.assetCount", { count: assets.length });
  }, [assets.length, assetsQuery.isLoading, t]);

  function handleCreateGroup() {
    const name = newGroupName.trim();
    if (!name) {
      return;
    }
    createGroupMutation.mutate(name);
  }

  function handleSaveGroupName(groupId: string) {
    const name = editingGroupName.trim();
    if (!name) {
      return;
    }
    updateGroupMutation.mutate({ groupId, name });
  }

  function setAssetGroupChecked(asset: ResourceLibraryAsset, groupId: string, checked: boolean) {
    setAssetGroupDrafts((current) => {
      const existing = current[asset.id] ?? groupIdsForAsset(asset, groups);
      const next = checked ? [...new Set([...existing, groupId])] : existing.filter((id) => id !== groupId);
      return { ...current, [asset.id]: next };
    });
  }

  function handleSaveAssetGroups(asset: ResourceLibraryAsset) {
    const draft = assetGroupDrafts[asset.id] ?? [];
    if (!draft.length) {
      setMessage("");
      setError(t("resourceLibrary.groupRequired"));
      return;
    }
    updateAssetGroupsMutation.mutate({ assetId: asset.id, group_ids: draft });
  }

  function pendingArchiveBusy(): boolean {
    if (!pendingArchive) {
      return false;
    }
    if (pendingArchive.kind === "asset") {
      return archiveAssetMutation.isPending && archiveAssetMutation.variables === pendingArchive.id;
    }
    return archiveGroupMutation.isPending && archiveGroupMutation.variables === pendingArchive.id;
  }

  function confirmPendingArchive() {
    if (!pendingArchive) {
      return;
    }
    if (pendingArchive.kind === "asset") {
      archiveAssetMutation.mutate(pendingArchive.id);
      return;
    }
    archiveGroupMutation.mutate(pendingArchive.id);
  }

  return (
    <div className="pf-app min-h-screen text-slate-950 dark:text-slate-100">
      <TopNav
        breadcrumbs={subpage ? t("resourceLibrary.manageTitle") : t("resourceLibrary.title")}
        onHome={() => navigate("/inspirations")}
        onLogout={() => logoutMutation.mutate()}
      />
      <main className="mx-auto max-w-7xl px-4 pb-10 pt-4 sm:px-6 lg:px-8">
        <section className="mb-4 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-4 shadow-sm dark:border-slate-800 dark:bg-[#0f1726] sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <Trees size={20} className="text-emerald-600 dark:text-emerald-300" />
              <span>{subpage ? t("resourceLibrary.manageTitle") : t("resourceLibrary.title")}</span>
            </div>
            <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {(selectedGroup ? selectedGroup.name : t("resourceLibrary.allGroups")) + " · " + assetCountLabel}
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-2 sm:w-80">
            <div className="flex gap-2">
              <input
                id="resource-library-new-group-name"
                name="resource-library-new-group-name"
                value={newGroupName}
                onChange={(event) => setNewGroupName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleCreateGroup();
                  }
                }}
                placeholder={t("resourceLibrary.groupNamePlaceholder")}
                className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-violet-400 dark:focus:ring-violet-400/20"
              />
              <button
                type="button"
                onClick={handleCreateGroup}
                disabled={!newGroupName.trim() || createGroupMutation.isPending}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-950 text-white transition-colors hover:bg-indigo-700 disabled:opacity-60 dark:bg-violet-500/25 dark:text-violet-100 dark:ring-1 dark:ring-violet-400/40"
                aria-label={t("resourceLibrary.createGroup")}
                title={t("resourceLibrary.createGroup")}
              >
                {createGroupMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
              </button>
            </div>
          </div>
        </section>

        {message ? (
          <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/10 dark:text-emerald-200">
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200">
            {error}
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-[#0f1726]">
            <div className="mb-2 text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
              {t("resourceLibrary.groups")}
            </div>
            <div className="space-y-1">
              <button
                type="button"
                onClick={() => setSelectedGroupId("")}
                className={`flex h-10 w-full items-center rounded-lg px-3 text-left text-sm font-semibold ${
                  !selectedGroupId
                    ? "bg-slate-950 text-white dark:bg-violet-500/25 dark:text-violet-100 dark:ring-1 dark:ring-violet-400/40"
                    : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                }`}
              >
                {t("resourceLibrary.allGroups")}
              </button>
              {groups.map((group) => {
                const editing = editingGroupId === group.id;
                return (
                  <div
                    key={group.id}
                    className={`rounded-lg ${
                      selectedGroupId === group.id
                        ? "bg-slate-950 text-white dark:bg-violet-500/25 dark:text-violet-100 dark:ring-1 dark:ring-violet-400/40"
                        : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                    }`}
                  >
                    {editing ? (
                      <div className="space-y-2 p-2">
                        <input
                          id={`resource-library-edit-group-${group.id}`}
                          name={`resource-library-edit-group-${group.id}`}
                          value={editingGroupName}
                          onChange={(event) => setEditingGroupName(event.target.value)}
                          className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-900 outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                        />
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingGroupId(null);
                              setEditingGroupName("");
                            }}
                            className="rounded-md px-2 py-1 text-xs font-semibold"
                          >
                            {t("common.cancel")}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSaveGroupName(group.id)}
                            disabled={!editingGroupName.trim() || updateGroupMutation.isPending}
                            className="inline-flex rounded-md bg-white px-2 py-1 text-xs font-semibold text-slate-950 disabled:opacity-60 dark:bg-slate-950 dark:text-white"
                          >
                            {updateGroupMutation.isPending && updateGroupMutation.variables?.groupId === group.id ? (
                              <Loader2 size={12} className="mr-1 animate-spin" />
                            ) : null}
                            {t("common.save")}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-10 items-center">
                        <button
                          type="button"
                          onClick={() => setSelectedGroupId(group.id)}
                          className="min-w-0 flex-1 truncate px-3 text-left text-sm font-semibold"
                        >
                          {group.name}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingGroupId(group.id);
                            setEditingGroupName(group.name);
                          }}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-slate-200/70 dark:hover:bg-slate-700"
                          aria-label={t("resourceLibrary.renameGroup")}
                          title={t("resourceLibrary.renameGroup")}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingArchive({ kind: "group", id: group.id, name: group.name })}
                          className="mr-1 inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-200"
                          aria-label={t("resourceLibrary.archiveGroup")}
                          title={t("resourceLibrary.archiveGroup")}
                        >
                          <Archive size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </aside>

          <section className="min-w-0">
            {assetsQuery.isLoading || groupsQuery.isLoading ? (
              <div className="flex min-h-[360px] items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 dark:border-slate-800 dark:bg-[#0f1726]">
                <Loader2 size={24} className="animate-spin" />
              </div>
            ) : assetsQuery.isError || groupsQuery.isError ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200">
                {t("resourceLibrary.loadFailed")}
              </div>
            ) : assets.length ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {assets.map((asset) => {
                  const draftGroupIds = assetGroupDrafts[asset.id] ?? groupIdsForAsset(asset, groups);
                  const originalGroupIds = groupIdsForAsset(asset, groups);
                  const dirty = !sameIds(draftGroupIds, originalGroupIds);
                  const assetBlocked = isResourceBlocked(asset);
                  return (
                    <article
                      key={asset.id}
                      className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-[#0f1726]"
                    >
                      <button
                        type="button"
                        onClick={() => setPreviewAsset(asset)}
                        className="block w-full bg-slate-100 dark:bg-slate-950"
                        aria-label={t("detail.previewImage", { alt: asset.original_filename })}
                        title={t("common.preview")}
                      >
                        <img
                          src={api.toApiUrl(asset.thumbnail_url)}
                          alt={asset.original_filename}
                          loading="lazy"
                          decoding="async"
                          className="aspect-square w-full object-cover"
                        />
                      </button>
                      <div className="space-y-3 p-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                            {asset.original_filename}
                          </div>
                          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {formatDateTime(asset.created_at)}
                          </div>
                        </div>
                        <ResourceMetaBadges resource={asset} showReason />
                        <div className="grid gap-2">
                          {groups.map((group) => {
                            const checkboxId = `resource-library-asset-${asset.id}-group-${group.id}`;
                            return (
                            <label
                              key={group.id}
                              htmlFor={checkboxId}
                              className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-950/55 dark:text-slate-200"
                            >
                              <input
                                id={checkboxId}
                                name={`resource-library-asset-${asset.id}-groups`}
                                type="checkbox"
                                checked={draftGroupIds.includes(group.id)}
                                onChange={(event) => setAssetGroupChecked(asset, group.id, event.target.checked)}
                                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-950 dark:text-violet-400 dark:focus:ring-violet-400"
                              />
                              <span className="min-w-0 truncate">{group.name}</span>
                            </label>
                            );
                          })}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setPreviewAsset(asset)}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                            aria-label={t("common.preview")}
                            title={t("common.preview")}
                          >
                            <Eye size={15} />
                          </button>
                          <a
                            href={api.toApiUrl(asset.download_url)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                            aria-label={t("common.download")}
                            title={t("common.download")}
                          >
                            <Download size={15} />
                          </a>
                          <button
                            type="button"
                            onClick={() => handleSaveAssetGroups(asset)}
                            disabled={
                              !dirty ||
                              !draftGroupIds.length ||
                              assetBlocked ||
                              (updateAssetGroupsMutation.isPending &&
                                updateAssetGroupsMutation.variables?.assetId === asset.id)
                            }
                            className="inline-flex h-9 min-w-0 flex-1 items-center justify-center rounded-lg bg-slate-950 px-3 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60 dark:bg-violet-500/25 dark:text-violet-100 dark:ring-1 dark:ring-violet-400/40"
                          >
                            {updateAssetGroupsMutation.isPending &&
                            updateAssetGroupsMutation.variables?.assetId === asset.id ? (
                              <Loader2 size={14} className="mr-1.5 animate-spin" />
                            ) : (
                              <Save size={14} className="mr-1.5" />
                            )}
                            {t("common.save")}
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingArchive({ kind: "asset", id: asset.id, name: asset.original_filename })}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-400/35 dark:text-red-200 dark:hover:bg-red-500/10"
                            aria-label={t("resourceLibrary.archiveAsset")}
                            title={t("resourceLibrary.archiveAsset")}
                          >
                            <Archive size={15} />
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-[#0f1726] dark:text-slate-400">
                <Trees size={24} className="text-emerald-600 dark:text-emerald-300" />
                <div>{t("resourceLibrary.empty")}</div>
              </div>
            )}
          </section>
        </div>
      </main>

      {previewAsset ? (
        <GalleryImagePreviewDialog
          ariaLabel={t("detail.previewImage", { alt: previewAsset.original_filename })}
          imageUrl={api.toApiUrl(previewAsset.preview_url)}
          imageAlt={previewAsset.original_filename}
          title={t("resourceLibrary.title")}
          subtitle={previewAsset.original_filename}
          body={
            <div className="space-y-3">
              <ResourceBlockedNotice resource={previewAsset} />
              <div>{previewAsset.original_filename}</div>
              <div className="flex flex-wrap gap-1">
                {previewAsset.groups.map((group) => (
                  <span
                    key={group.id}
                    className="rounded-full border border-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600"
                  >
                    {group.name}
                  </span>
                ))}
              </div>
            </div>
          }
          metadataRows={[
            { label: t("resourceLibrary.groups"), value: previewAsset.groups.map((group) => group.name).join(" / ") },
            { label: t("chat.generatedAt"), value: formatDateTime(previewAsset.created_at) },
          ]}
          providerNotesTitle={t("gallery.providerNotes")}
          downloadUrl={previewAsset.download_url}
          downloadLabel={t("common.download")}
          closeLabel={t("resourceLibrary.close")}
          onClose={() => setPreviewAsset(null)}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingArchive)}
        title={
          pendingArchive?.kind === "group"
            ? t("resourceLibrary.archiveGroup")
            : t("resourceLibrary.archiveAsset")
        }
        description={
          pendingArchive?.kind === "group"
            ? t("resourceLibrary.archiveGroupConfirm", { name: pendingArchive?.name ?? "" })
            : t("resourceLibrary.archiveAssetConfirm", { name: pendingArchive?.name ?? "" })
        }
        confirmLabel={t("resourceLibrary.archive")}
        cancelLabel={t("common.cancel")}
        busy={pendingArchiveBusy()}
        onConfirm={confirmPendingArchive}
        onClose={() => {
          if (!pendingArchiveBusy()) {
            setPendingArchive(null);
          }
        }}
      />
    </div>
  );
}
