import {
  useEffect,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Image as ImageIcon,
  MoreHorizontal,
  Plus,
  Search,
  Archive,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { SelectField } from "../components/SelectField";
import {
  getResourceBlockedActionTitle,
  isResourceBlocked,
  isResourceDeleted,
  ResourceMetaBadges,
} from "../components/ResourceGovernance";
import { StatusPill } from "../components/StatusPill";
import { TopNav } from "../components/TopNav";
import { api, ApiError } from "../lib/api";
import { formatDateTimeSeconds, formatPrice } from "../lib/format";
import type { TranslationKey } from "../lib/i18n";
import { useI18n } from "../lib/preferences";
import { API_INSPIRATIONS_WRITE, hasSessionApiPermission } from "../lib/rbac";
import { activeGenerationResourceGroupsInApiOrder, firstActiveGenerationResourceGroupId } from "../lib/resourceGroups";
import { useSessionState } from "../lib/session";
import type { GenerationResourceGroup, InspirationSummary, RbacUser, SessionUser } from "../lib/types";
import { inspirationKeyInfo, inspirationMainThumbnailUrl } from "./InspirationListPage.helpers";

const PAGE_SIZE = 12;
const INSPIRATION_LIST_STALE_TIME_MS = 60_000;
const RUNTIME_CONFIG_STALE_TIME_MS = 5 * 60_000;
const RBAC_USERS_STALE_TIME_MS = 5 * 60_000;
const INSPIRATION_OPEN_DELAY_MS = 90;
const PRESS_CANCEL_DISTANCE_PX = 8;
const MOBILE_DELETE_ACTION_WIDTH_PX = 96;
const MOBILE_DELETE_OPEN_THRESHOLD_PX = 42;
const HOVER_IMAGE_PREVIEW_SIZE_PX = 224;
const HOVER_IMAGE_PREVIEW_GAP_PX = 12;
const SEARCH_PANEL_SINGLE_ROW_WIDTH_PX = 920;
const ADMIN_SEARCH_PANEL_SINGLE_ROW_WIDTH_PX = 1_220;

type InspirationQuickRangeId = "day" | "week" | "month";

interface InspirationSearchFilters {
  title: string;
  updated_from: string;
  updated_to: string;
  owner_user_id: string;
  only_deleted: boolean;
}

const EMPTY_INSPIRATION_SEARCH: InspirationSearchFilters = {
  title: "",
  updated_from: "",
  updated_to: "",
  owner_user_id: "",
  only_deleted: false,
};

const INSPIRATION_QUICK_RANGE_IDS: InspirationQuickRangeId[] = ["day", "week", "month"];
const INSPIRATION_QUICK_RANGE_LABEL_KEYS: Record<InspirationQuickRangeId, TranslationKey> = {
  day: "inspirations.search.quick.day",
  week: "inspirations.search.quick.week",
  month: "inspirations.search.quick.month",
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toDateInputValue(value: Date): string {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftedDate(days: number): Date {
  const value = new Date();
  value.setHours(0, 0, 0, 0);
  value.setDate(value.getDate() + days);
  return value;
}

function quickInspirationDateRange(id: InspirationQuickRangeId): Pick<InspirationSearchFilters, "updated_from" | "updated_to"> {
  const today = shiftedDate(0);
  if (id === "week") {
    return { updated_from: toDateInputValue(shiftedDate(-6)), updated_to: toDateInputValue(today) };
  }
  if (id === "month") {
    const monthStart = new Date(today);
    monthStart.setDate(1);
    return { updated_from: toDateInputValue(monthStart), updated_to: toDateInputValue(today) };
  }
  return { updated_from: toDateInputValue(today), updated_to: toDateInputValue(today) };
}

function normalizeInspirationSearchFilters(filters: InspirationSearchFilters): InspirationSearchFilters {
  return {
    title: filters.title.trim(),
    updated_from: filters.updated_from,
    updated_to: filters.updated_to,
    owner_user_id: filters.owner_user_id,
    only_deleted: Boolean(filters.only_deleted),
  };
}

function hasInspirationSearchFilters(filters: InspirationSearchFilters): boolean {
  return Boolean(filters.title || filters.updated_from || filters.updated_to || filters.owner_user_id || filters.only_deleted);
}

function countInspirationSearchFilters(filters: InspirationSearchFilters): number {
  return [
    filters.title.trim(),
    filters.updated_from || filters.updated_to ? "updated_range" : "",
    filters.owner_user_id,
    filters.only_deleted ? "only_deleted" : "",
  ].filter(Boolean).length;
}

function isAdminViewingOtherOwner(
  user: { id: string; is_admin: boolean } | null | undefined,
  ownerUserId: string | null | undefined,
): boolean {
  return Boolean(user?.is_admin && ownerUserId && user.id !== ownerUserId);
}

function usePressOpen(onOpen: () => void) {
  const [pressed, setPressed] = useState(false);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const cancelledRef = useRef(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }
  }, []);

  const cancelPress = () => {
    cancelledRef.current = true;
    startPointRef.current = null;
    setPressed(false);
  };

  const scheduleOpen = () => {
    if (cancelledRef.current) {
      cancelPress();
      return;
    }
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      setPressed(false);
      onOpen();
    }, INSPIRATION_OPEN_DELAY_MS);
  };

  return {
    pressed,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setPressed(true);
        scheduleOpen();
      }
    },
    onPointerCancel: cancelPress,
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) {
        return;
      }
      cancelledRef.current = false;
      startPointRef.current = { x: event.clientX, y: event.clientY };
      setPressed(true);
    },
    onPointerLeave: cancelPress,
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const startPoint = startPointRef.current;
      if (!startPoint) {
        return;
      }
      const moved = Math.hypot(event.clientX - startPoint.x, event.clientY - startPoint.y);
      if (moved > PRESS_CANCEL_DISTANCE_PX) {
        cancelPress();
      }
    },
    onPointerUp: () => {
      if (!startPointRef.current) {
        cancelPress();
        return;
      }
      startPointRef.current = null;
      scheduleOpen();
    },
  };
}

export function InspirationListPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSessionState();
  const currentUser = session?.user ?? null;
  const isAdmin = Boolean(currentUser?.is_admin);
  const canWriteInspirations = hasSessionApiPermission(session, API_INSPIRATIONS_WRITE);
  const [page, setPage] = useState(1);
  const [searchDraft, setSearchDraft] = useState<InspirationSearchFilters>(EMPTY_INSPIRATION_SEARCH);
  const [activeSearch, setActiveSearch] = useState<InspirationSearchFilters>(EMPTY_INSPIRATION_SEARCH);
  const [adminOwnerFilterInitialized, setAdminOwnerFilterInitialized] = useState(false);
  const [selectedResourceGroupId, setSelectedResourceGroupId] = useState<string | null>(null);
  const [ownerSearch, setOwnerSearch] = useState("");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [pendingDeleteInspiration, setPendingDeleteInspiration] = useState<InspirationSummary | null>(null);
  const deferredOwnerSearch = useDeferredValue(ownerSearch.trim());
  const inspirationsQuery = useQuery({
    queryKey: ["inspirations", selectedResourceGroupId, page, PAGE_SIZE, activeSearch],
    queryFn: () =>
      api.listInspirations({
        resource_group_id: selectedResourceGroupId || null,
        page,
        page_size: PAGE_SIZE,
        title: activeSearch.title || undefined,
        updated_from: activeSearch.updated_from || undefined,
        updated_to: activeSearch.updated_to || undefined,
        owner_user_id: isAdmin ? activeSearch.owner_user_id || undefined : undefined,
        only_deleted: isAdmin && activeSearch.only_deleted,
      }),
    enabled: selectedResourceGroupId !== null && (!isAdmin || adminOwnerFilterInitialized),
    placeholderData: keepPreviousData,
    staleTime: INSPIRATION_LIST_STALE_TIME_MS,
  });
  const generationResourceGroupsQuery = useQuery({
    queryKey: ["my-generation-resource-groups"],
    queryFn: api.listMyGenerationResourceGroups,
    staleTime: RUNTIME_CONFIG_STALE_TIME_MS,
  });
  const rbacUsersQuery = useQuery({
    queryKey: ["rbac-users", "inspiration-owner-filter", deferredOwnerSearch],
    queryFn: () => api.listRbacUsers({ page_size: 30, query: deferredOwnerSearch || undefined }),
    enabled: isAdmin,
    retry: false,
    staleTime: RBAC_USERS_STALE_TIME_MS,
  });
  const runtimeConfigQuery = useQuery({
    queryKey: ["runtime-config"],
    queryFn: api.getRuntimeConfig,
    staleTime: RUNTIME_CONFIG_STALE_TIME_MS,
  });
  const inspirations = inspirationsQuery.data?.items ?? [];
  const resourceGroups = useMemo<GenerationResourceGroup[]>(
    () => activeGenerationResourceGroupsInApiOrder(generationResourceGroupsQuery.data),
    [generationResourceGroupsQuery.data],
  );
  const total = inspirationsQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const deletionEnabled = runtimeConfigQuery.data?.deletion_enabled ?? false;
  const posterReadyCount = inspirations.filter((inspiration) => inspiration.workflow_state === "poster_ready").length;
  const copyReadyCount = inspirations.filter(
    (inspiration) => inspiration.workflow_state === "copy_ready" || inspiration.workflow_state === "poster_ready",
  ).length;
  const searchActive = hasInspirationSearchFilters(activeSearch);
  const searchDraftActive = hasInspirationSearchFilters(searchDraft);
  const searchFilterCount = countInspirationSearchFilters(searchDraft) || countInspirationSearchFilters(activeSearch);
  const rbacUsers = rbacUsersQuery.data?.items ?? [];

  useEffect(() => {
    if (!isAdmin || !currentUser?.id || adminOwnerFilterInitialized) {
      return;
    }
    setSearchDraft((current) => (current.owner_user_id ? current : { ...current, owner_user_id: currentUser.id }));
    setActiveSearch((current) => (current.owner_user_id ? current : { ...current, owner_user_id: currentUser.id }));
    setAdminOwnerFilterInitialized(true);
    setPage(1);
  }, [adminOwnerFilterInitialized, currentUser?.id, isAdmin]);

  useEffect(() => {
    if (inspirationsQuery.data && page > totalPages) {
      setPage(totalPages);
    }
  }, [page, inspirationsQuery.data, totalPages]);

  useEffect(() => {
    if (!generationResourceGroupsQuery.isFetched) {
      return;
    }
    if (!resourceGroups.length) {
      if (selectedResourceGroupId === null) {
        setSelectedResourceGroupId("");
        setPage(1);
      }
      return;
    }
    if (selectedResourceGroupId === null || (selectedResourceGroupId && !resourceGroups.some((group) => group.id === selectedResourceGroupId))) {
      setSelectedResourceGroupId(firstActiveGenerationResourceGroupId(resourceGroups));
      setPage(1);
    }
  }, [generationResourceGroupsQuery.isFetched, resourceGroups, selectedResourceGroupId]);

  const logoutMutation = useMutation({
    mutationFn: api.destroySession,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      navigate("/login", { replace: true });
    },
  });

  const deleteInspirationMutation = useMutation({
    mutationFn: (inspirationId: string) => api.deleteInspiration(inspirationId),
    onSuccess: async () => {
      setDeleteError("");
      setPendingDeleteInspiration(null);
      await queryClient.invalidateQueries({ queryKey: ["inspirations"] });
      if (inspirations.length === 1 && page > 1) {
        setPage((current) => Math.max(1, current - 1));
      }
    },
    onError: (mutationError) => {
      setPendingDeleteInspiration(null);
      setDeleteError(mutationError instanceof ApiError ? mutationError.detail : t("inspirations.deleteFailed"));
    },
  });

  const handleDeleteInspiration = (inspiration: InspirationSummary) => {
    if (!canWriteInspirations) {
      setDeleteError(t("inspirations.writePermissionRequired"));
      return;
    }
    if (!deletionEnabled) {
      setDeleteError(t("inspirations.deleteDisabled"));
      return;
    }
    if (isResourceBlocked(inspiration)) {
      setDeleteError(t("resource.blockedAction"));
      return;
    }
    if (isResourceDeleted(inspiration)) {
      setDeleteError(t("resource.deleted"));
      return;
    }
    if (isAdminViewingOtherOwner(session?.user, inspiration.owner_user_id ?? null)) {
      setDeleteError(t("resource.adminReadonlyAction"));
      return;
    }
    setPendingDeleteInspiration(inspiration);
  };

  const submitSearch = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const nextSearch = normalizeInspirationSearchFilters(searchDraft);
    setSearchDraft(nextSearch);
    setActiveSearch(nextSearch);
    setPage(1);
    setMobileSearchOpen(false);
  };

  const clearSearch = () => {
    setSearchDraft(EMPTY_INSPIRATION_SEARCH);
    setActiveSearch(EMPTY_INSPIRATION_SEARCH);
    setPage(1);
    setMobileSearchOpen(false);
  };

  const applyQuickRange = (rangeId: InspirationQuickRangeId) => {
    const range = quickInspirationDateRange(rangeId);
    setSearchDraft((current) => ({ ...current, ...range }));
  };

  return (
    <div className="pf-app flex flex-col">
      <TopNav
        onHome={() => navigate("/inspirations")}
        onLogout={() => logoutMutation.mutate()}
      />

      <main className="pf-page flex flex-1">
        <div className="w-full space-y-4 lg:space-y-6">
          <section className="pf-panel px-4 py-4 md:hidden">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400 dark:text-slate-500">
                  {t("inspirations.heroEyebrow")}
                </div>
                <h1 className="mt-1 truncate text-xl font-semibold tracking-tight text-zinc-900 dark:text-white">
                  {t("inspirations.listTitle")}
                </h1>
                <p className="mt-1 text-xs text-zinc-500 dark:text-slate-400">
                  {t("inspirations.paginationSummary", { page, totalPages, total })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate("/inspirations/new")}
                disabled={!canWriteInspirations}
                aria-label={t("inspirations.new")}
                title={canWriteInspirations ? t("inspirations.new") : t("inspirations.writePermissionRequired")}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm shadow-indigo-600/20 transition-colors active:scale-[0.98] hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-gradient-to-r dark:from-indigo-500 dark:to-violet-500 dark:shadow-violet-900/35 dark:ring-1 dark:ring-violet-300/35 dark:focus-visible:ring-violet-400 dark:focus-visible:ring-offset-slate-950"
              >
                <Plus size={18} aria-hidden="true" />
              </button>
            </div>
          </section>

          <section className="pf-panel hidden overflow-hidden md:block">
            <div className="grid gap-5 p-5 md:grid-cols-[minmax(0,1.1fr)_minmax(17rem,0.9fr)] md:items-end lg:grid-cols-[1.35fr_1fr] lg:gap-8 lg:p-6 xl:p-7">
              <div>
                <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-400 dark:text-slate-500">
                  {t("inspirations.heroEyebrow")}
                </div>
                <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-white">{t("inspirations.title")}</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">
                  {t("inspirations.description")}
                </p>
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => navigate("/inspirations/new")}
                    disabled={!canWriteInspirations}
                    title={canWriteInspirations ? t("inspirations.new") : t("inspirations.writePermissionRequired")}
                    className="inline-flex items-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/20 transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-gradient-to-r dark:from-indigo-500 dark:to-violet-500 dark:shadow-violet-900/35 dark:ring-1 dark:ring-violet-300/35"
                  >
                    <Plus size={16} className="mr-1.5" /> {t("inspirations.new")}
                  </button>
                </div>
              </div>
              <div className="grid gap-2 self-end lg:grid-cols-3 xl:gap-3">
                <MetricCard label={t("inspirations.totalMetric")} value={total} />
                <MetricCard label={t("inspirations.copyReadyMetric")} value={copyReadyCount} />
                <MetricCard label={t("inspirations.posterReadyMetric")} value={posterReadyCount} />
              </div>
            </div>
          </section>

          {deleteError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200">
              {deleteError}
            </div>
          ) : null}

          <InspirationSearchPanel
            draft={searchDraft}
            isAdmin={isAdmin}
            currentUser={currentUser}
            users={rbacUsers}
            usersLoading={rbacUsersQuery.isFetching}
            ownerSearch={ownerSearch}
            onOwnerSearchChange={setOwnerSearch}
            resourceGroups={resourceGroups}
            resourceGroupsLoading={generationResourceGroupsQuery.isLoading}
            selectedResourceGroupId={selectedResourceGroupId ?? ""}
            active={searchDraftActive || searchActive}
            activeCount={searchFilterCount}
            fetching={inspirationsQuery.isFetching}
            mobileOpen={mobileSearchOpen}
            onChange={setSearchDraft}
            onClear={clearSearch}
            onMobileToggle={() => setMobileSearchOpen((current) => !current)}
            onResourceGroupChange={(value) => {
              setSelectedResourceGroupId(value);
              setPage(1);
            }}
            onQuickRange={applyQuickRange}
            onSubmit={submitSearch}
          />

          {generationResourceGroupsQuery.isLoading || inspirationsQuery.isLoading ? (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2 lg:hidden">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700/85 dark:bg-[#0f1726]"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 shrink-0 rounded-lg animate-shimmer" />
                      <div className="flex-1 space-y-2">
                        <div className="h-4 w-2/3 animate-shimmer" />
                        <div className="h-3.5 w-1/2 animate-shimmer" />
                      </div>
                    </div>
                    <div className="flex justify-between border-t border-slate-100 pt-3 dark:border-slate-800">
                      <div className="h-5 w-20 rounded-full animate-shimmer" />
                      <div className="h-4 w-24 animate-shimmer" />
                    </div>
                  </div>
                ))}
              </div>

              <div className="pf-table-panel hidden lg:block">
                <table className="w-full table-fixed border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 dark:border-slate-700/80 dark:bg-[#151f33]">
                      <th className="w-[32%] px-5 py-3 font-medium text-zinc-500 dark:text-slate-300">{t("inspirations.table.inspiration")}</th>
                      <th className="w-[25%] px-5 py-3 font-medium text-zinc-500 dark:text-slate-300">{t("inspirations.table.keyInfo")}</th>
                      <th className="w-[15%] px-5 py-3 font-medium text-zinc-500 dark:text-slate-300">{t("inspirations.table.state")}</th>
                      <th className="w-[15%] px-5 py-3 font-medium text-zinc-500 dark:text-slate-300">{t("inspirations.table.updated")}</th>
                      <th className="w-[13%] px-5 py-3 text-right font-medium text-zinc-500 dark:text-slate-300">{t("inspirations.table.actions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-slate-800">
                    {[1, 2, 3, 4].map((i) => (
                      <tr key={i}>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 shrink-0 rounded-lg animate-shimmer" />
                            <div className="flex-1 space-y-2">
                              <div className="h-4 w-1/3 animate-shimmer" />
                              <div className="h-3.5 w-1/2 animate-shimmer" />
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <div className="h-6 w-20 rounded-full animate-shimmer" />
                        </td>
                        <td className="px-5 py-4">
                          <div className="h-6 w-20 rounded-full animate-shimmer" />
                        </td>
                        <td className="px-5 py-4">
                          <div className="h-4 w-24 animate-shimmer" />
                        </td>
                        <td className="px-5 py-4 text-right">
                          <div className="ml-auto h-5 w-24 animate-shimmer" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : generationResourceGroupsQuery.isError || inspirationsQuery.isError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200">
              {t("inspirations.loadFailed")}
            </div>
          ) : inspirations.length ? (
            <>
              <div className="grid gap-3 md:grid-cols-2 lg:hidden">
                {inspirations.map((inspiration) => {
                  const deleteBlockedTitle = isAdminViewingOtherOwner(session?.user, inspiration.owner_user_id ?? null)
                    ? t("resource.adminReadonlyAction")
                    : null;
                  return (
                    <InspirationMobileCard
                      key={inspiration.id}
                      inspiration={inspiration}
                      className={inspirations.length === 1 ? "md:col-span-2" : undefined}
                      deletionEnabled={deletionEnabled}
                      deleteBlockedTitle={
                        canWriteInspirations ? deleteBlockedTitle : t("inspirations.writePermissionRequired")
                      }
                      isDeleting={deleteInspirationMutation.isPending}
                      onOpen={() => navigate(`/inspirations/${inspiration.id}`)}
                      onDelete={() => handleDeleteInspiration(inspiration)}
                    />
                  );
                })}
              </div>

              <div className="pf-table-panel hidden lg:block">
                <table className="w-full table-fixed border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/70 dark:border-slate-700/80 dark:bg-[#151f33]">
                      <th className="w-[32%] px-5 py-3 font-medium text-zinc-500 dark:text-slate-300">{t("inspirations.table.inspiration")}</th>
                      <th className="w-[25%] px-5 py-3 font-medium text-zinc-500 dark:text-slate-300">{t("inspirations.table.keyInfo")}</th>
                      <th className="w-[15%] px-5 py-3 font-medium text-zinc-500 dark:text-slate-300">{t("inspirations.table.state")}</th>
                      <th className="w-[15%] px-5 py-3 font-medium text-zinc-500 dark:text-slate-300">{t("inspirations.table.updated")}</th>
                      <th className="w-[13%] px-5 py-3 text-right font-medium text-zinc-500 dark:text-slate-300">{t("inspirations.table.actions")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-slate-800">
                    {inspirations.map((inspiration) => {
                      const deleteBlockedTitle = isAdminViewingOtherOwner(session?.user, inspiration.owner_user_id ?? null)
                        ? t("resource.adminReadonlyAction")
                        : null;
                      return (
                        <InspirationTableRow
                          key={inspiration.id}
                          inspiration={inspiration}
                          deletionEnabled={deletionEnabled}
                          deleteBlockedTitle={
                            canWriteInspirations ? deleteBlockedTitle : t("inspirations.writePermissionRequired")
                          }
                          isDeleting={deleteInspirationMutation.isPending}
                          onOpen={() => navigate(`/inspirations/${inspiration.id}`)}
                          onDelete={() => handleDeleteInspiration(inspiration)}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : searchActive ? (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-14 text-center dark:border-slate-700/80 dark:bg-[#0f1726]">
              <Search className="mx-auto mb-3 text-zinc-300 dark:text-slate-500" size={32} />
              <div className="font-medium text-zinc-900 dark:text-white">{t("inspirations.search.emptyTitle")}</div>
              <p className="mt-1 text-sm text-zinc-500 dark:text-slate-400">{t("inspirations.search.emptyDescription")}</p>
              <button
                type="button"
                onClick={clearSearch}
                className="mt-5 inline-flex items-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-violet-500/10"
              >
                <X size={16} className="mr-1.5" /> {t("inspirations.search.clear")}
              </button>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center dark:border-slate-700/80 dark:bg-[#0f1726]">
              <ImageIcon className="mx-auto mb-3 text-zinc-300 dark:text-slate-500" size={32} />
              <div className="font-medium text-zinc-900 dark:text-white">{t("inspirations.emptyTitle")}</div>
              <p className="mt-1 text-sm text-zinc-500 dark:text-slate-400">{t("inspirations.emptyDescription")}</p>
              <button
                type="button"
                onClick={() => navigate("/inspirations/new")}
                disabled={!canWriteInspirations}
                title={canWriteInspirations ? t("inspirations.new") : t("inspirations.writePermissionRequired")}
                className="mt-5 inline-flex items-center rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-indigo-600/20 hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-gradient-to-r dark:from-indigo-500 dark:to-violet-500 dark:shadow-violet-900/35"
              >
                <Plus size={16} className="mr-1.5" /> {t("inspirations.new")}
              </button>
            </div>
          )}

          {inspirations.length ? (
            <div className="hidden justify-end md:flex">
              <Pagination page={page} totalPages={totalPages} onPageChange={setPage} disabled={inspirationsQuery.isFetching} />
            </div>
          ) : null}
        </div>
      </main>
      {inspirations.length ? (
        <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-40 flex justify-center px-4 md:hidden">
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} disabled={inspirationsQuery.isFetching} floating />
        </div>
      ) : null}
      <ConfirmDialog
        open={Boolean(pendingDeleteInspiration)}
        title={t("inspirations.deleteConfirmTitle")}
        description={
          pendingDeleteInspiration ? t("inspirations.deleteConfirm", { name: pendingDeleteInspiration.name }) : ""
        }
        confirmLabel={t("inspirations.delete")}
        cancelLabel={t("common.cancel")}
        busy={deleteInspirationMutation.isPending}
        onClose={() => setPendingDeleteInspiration(null)}
        onConfirm={() => {
          if (pendingDeleteInspiration) {
            deleteInspirationMutation.mutate(pendingDeleteInspiration.id);
          }
        }}
      />
    </div>
  );
}

function InspirationMobileCard({
  inspiration,
  className = "",
  deletionEnabled,
  deleteBlockedTitle = null,
  isDeleting,
  onOpen,
  onDelete,
}: {
  inspiration: InspirationSummary;
  className?: string;
  deletionEnabled: boolean;
  deleteBlockedTitle?: string | null;
  isDeleting: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const inspirationBlocked = isResourceBlocked(inspiration);
  const inspirationDeleted = isResourceDeleted(inspiration);
  const metadata = [
    inspiration.category,
    inspiration.price ? formatPrice(inspiration.price) : null,
    inspiration.source_image_filename,
  ].filter(Boolean);
  const metadataText = metadata.join(" / ");
  const pressOpen = usePressOpen(onOpen);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const dragOffsetRef = useRef(0);
  const swipeRef = useRef<{
    startX: number;
    startY: number;
    dragging: boolean;
    startOpen: boolean;
  } | null>(null);
  const handleDeleteClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onDelete();
  };
  const cancelSwipe = () => {
    swipeRef.current = null;
    const nextOffset = deleteOpen ? -MOBILE_DELETE_ACTION_WIDTH_PX : 0;
    dragOffsetRef.current = nextOffset;
    setDragOffset(nextOffset);
  };
  const currentOffset = deleteOpen ? -MOBILE_DELETE_ACTION_WIDTH_PX : 0;
  const dragging = Boolean(swipeRef.current?.dragging);
  const visualOffset = dragging ? dragOffset : currentOffset;
  const deleteOpacity = Math.min(Math.abs(visualOffset) / MOBILE_DELETE_ACTION_WIDTH_PX, 1);

  return (
    <article
      role="button"
      tabIndex={0}
      aria-label={t("inspirations.openInspiration", { name: inspiration.name })}
      onKeyDown={pressOpen.onKeyDown}
      onPointerCancel={() => {
        cancelSwipe();
        pressOpen.onPointerCancel();
      }}
      onPointerDown={(event) => {
        if (event.currentTarget.hasPointerCapture?.(event.pointerId) === false) {
          try {
            event.currentTarget.setPointerCapture?.(event.pointerId);
          } catch {
            // Synthetic pointer events in tests/devtools may not have an active pointer.
          }
        }
        swipeRef.current = {
          startX: event.clientX,
          startY: event.clientY,
          dragging: false,
          startOpen: deleteOpen,
        };
        dragOffsetRef.current = deleteOpen ? -MOBILE_DELETE_ACTION_WIDTH_PX : 0;
        pressOpen.onPointerDown(event);
      }}
      onPointerLeave={() => {
        if (swipeRef.current?.dragging) {
          return;
        }
        cancelSwipe();
        pressOpen.onPointerLeave();
      }}
      onPointerMove={(event) => {
        const swipe = swipeRef.current;
        if (!swipe) {
          pressOpen.onPointerMove(event);
          return;
        }
        const deltaX = event.clientX - swipe.startX;
        const deltaY = event.clientY - swipe.startY;
        if (!swipe.dragging && Math.abs(deltaX) > PRESS_CANCEL_DISTANCE_PX && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
          swipe.dragging = true;
          pressOpen.onPointerCancel();
        }
        if (swipe.dragging) {
          const baseOffset = swipe.startOpen ? -MOBILE_DELETE_ACTION_WIDTH_PX : 0;
          const nextOffset = clamp(baseOffset + deltaX, -MOBILE_DELETE_ACTION_WIDTH_PX, 0);
          dragOffsetRef.current = nextOffset;
          setDragOffset(nextOffset);
          return;
        }
        pressOpen.onPointerMove(event);
      }}
      onPointerUp={(event) => {
        const swipe = swipeRef.current;
        if (swipe?.dragging) {
          const nextOpen = dragOffsetRef.current < -MOBILE_DELETE_OPEN_THRESHOLD_PX;
          const nextOffset = nextOpen ? -MOBILE_DELETE_ACTION_WIDTH_PX : 0;
          setDeleteOpen(nextOpen);
          dragOffsetRef.current = nextOffset;
          setDragOffset(nextOffset);
          swipeRef.current = null;
          pressOpen.onPointerCancel();
          event.preventDefault();
          return;
        }
        swipeRef.current = null;
        if (deleteOpen) {
          setDeleteOpen(false);
          pressOpen.onPointerCancel();
          return;
        }
        pressOpen.onPointerUp();
      }}
      className={`relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm shadow-slate-200/50 outline-none [contain-intrinsic-size:144px] [content-visibility:auto] focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 dark:border-slate-700/80 dark:bg-[#0f1726] dark:shadow-[0_14px_38px_rgba(0,0,0,0.22)] dark:focus-visible:ring-violet-400 dark:focus-visible:ring-offset-slate-950 ${className}`}
    >
      <button
        type="button"
        onClick={handleDeleteClick}
        onPointerDown={(event) => event.stopPropagation()}
        disabled={isDeleting || !deletionEnabled || inspirationBlocked || inspirationDeleted || Boolean(deleteBlockedTitle)}
        aria-label={
          inspirationDeleted
            ? t("resource.deleted")
            : inspirationBlocked
            ? getResourceBlockedActionTitle(inspiration, t("resource.blockedAction"))
            : deleteBlockedTitle
            ? deleteBlockedTitle
            : deletionEnabled
            ? t("inspirations.deleteInspiration", { name: inspiration.name })
            : t("inspirations.deleteDisabled")
        }
        title={
          inspirationDeleted
            ? t("resource.deleted")
            : inspirationBlocked
            ? getResourceBlockedActionTitle(inspiration, t("resource.blockedAction"))
            : deleteBlockedTitle
              ? deleteBlockedTitle
            : deletionEnabled
              ? t("inspirations.delete")
              : t("inspirations.deleteDisabled")
        }
        className="group/delete absolute inset-y-0 right-0 flex w-24 items-center justify-center border-l border-amber-300/60 bg-amber-500 text-sm font-semibold text-white transition-[background-color,filter] hover:bg-amber-600 hover:brightness-105 active:bg-amber-700 disabled:bg-amber-500/45 dark:border-amber-200/25 dark:bg-amber-500/80 dark:hover:bg-amber-500 dark:active:bg-amber-600"
        style={{ opacity: deleteOpacity, pointerEvents: deleteOpen ? "auto" : "none" }}
      >
        <Archive size={17} className="mr-1.5 shrink-0 transition-transform group-hover/delete:scale-110 group-active/delete:scale-95" aria-hidden="true" />
        <span className="whitespace-nowrap">{t("inspirations.delete")}</span>
      </button>
      <div
        className={`cursor-pointer select-none rounded-l-2xl bg-white p-3 transition-[transform,background-color,box-shadow] dark:bg-[#0f1726] ${
          dragging ? "duration-0" : "duration-150"
        } ${
        pressOpen.pressed
          ? "scale-[0.985] bg-indigo-50/70 shadow-indigo-900/10 dark:bg-violet-500/14"
          : "hover:bg-indigo-50/30 dark:hover:bg-violet-500/10"
      }`}
        style={{ transform: `translateX(${visualOffset}px)` }}
      >
      <div className="flex min-w-0 gap-3">
        <InspirationThumbnail inspiration={inspiration} compact />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-h-11 min-w-0 flex-1 pr-1 text-left">
              <span className="block truncate text-sm font-semibold text-slate-950 dark:text-slate-100" title={inspiration.name}>
                {inspiration.name}
              </span>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <ResourceGroupBadge name={inspiration.resource_group.name} />
                <ResourceMetaBadges resource={inspiration} />
              </div>
              <span className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-slate-400">
                <span>{t("inspirations.table.updated")}</span>
                <span className="font-mono tabular-nums">{formatDateTimeSeconds(inspiration.updated_at)}</span>
              </span>
            </div>
            <StatusPill status={inspiration.workflow_state} />
          </div>

          {metadata.length ? (
            <div className="mt-1.5 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-slate-400">
              <MoreHorizontal size={14} className="shrink-0 text-zinc-300 dark:text-slate-600" aria-hidden="true" />
              <span className="min-w-0 truncate" title={metadataText}>
                {metadataText}
              </span>
            </div>
          ) : null}
          <InspirationKeyInfoCell inspiration={inspiration} compact />
        </div>
      </div>
      </div>
    </article>
  );
}

function InspirationTableRow({
  inspiration,
  deletionEnabled,
  deleteBlockedTitle = null,
  isDeleting,
  onOpen,
  onDelete,
}: {
  inspiration: InspirationSummary;
  deletionEnabled: boolean;
  deleteBlockedTitle?: string | null;
  isDeleting: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const inspirationBlocked = isResourceBlocked(inspiration);
  const inspirationDeleted = isResourceDeleted(inspiration);
  const pressOpen = usePressOpen(onOpen);
  const handleDeleteClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onDelete();
  };

  return (
    <tr
      role="button"
      tabIndex={0}
      aria-label={t("inspirations.openInspiration", { name: inspiration.name })}
      onKeyDown={pressOpen.onKeyDown}
      onPointerCancel={pressOpen.onPointerCancel}
      onPointerDown={pressOpen.onPointerDown}
      onPointerLeave={pressOpen.onPointerLeave}
      onPointerMove={pressOpen.onPointerMove}
      onPointerUp={pressOpen.onPointerUp}
      className={`group cursor-pointer outline-none transition-[background-color,box-shadow] duration-150 hover:bg-indigo-50/30 focus-visible:bg-indigo-50/45 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 dark:hover:bg-violet-500/10 dark:focus-visible:bg-violet-500/12 dark:focus-visible:ring-violet-400 ${
        pressOpen.pressed
          ? "bg-indigo-50/70 shadow-[inset_3px_0_0_rgb(79_70_229)] dark:bg-violet-500/16 dark:shadow-[inset_3px_0_0_rgb(167_139_250)]"
          : ""
      }`}
    >
      <td className="px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <InspirationThumbnail inspiration={inspiration} />
          <div className="min-w-0 flex-1">
            <div className="block max-w-full truncate text-left font-medium text-slate-950 transition-colors group-hover:text-indigo-700 dark:text-slate-100 dark:group-hover:text-violet-200" title={inspiration.name}>
              {inspiration.name}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <ResourceGroupBadge name={inspiration.resource_group.name} />
              <ResourceMetaBadges resource={inspiration} />
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-slate-400">
              {inspiration.category ? <span className="min-w-0 max-w-full truncate">{inspiration.category}</span> : null}
              {inspiration.price ? <span className="shrink-0">{formatPrice(inspiration.price)}</span> : null}
              {inspiration.source_image_filename ? (
                <span className="min-w-0 max-w-full truncate" title={inspiration.source_image_filename}>
                  {inspiration.source_image_filename}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </td>
      <td className="px-5 py-4">
        <InspirationKeyInfoCell inspiration={inspiration} />
      </td>
      <td className="px-5 py-4">
        <StatusPill status={inspiration.workflow_state} />
      </td>
      <td className="px-5 py-4 font-mono text-xs text-zinc-500 dark:text-slate-400">
        {formatDateTimeSeconds(inspiration.updated_at)}
      </td>
      <td className="px-5 py-4 text-right">
        <div className="flex items-center justify-end opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <button
            type="button"
            onClick={handleDeleteClick}
            onPointerDown={(event) => event.stopPropagation()}
            disabled={isDeleting || !deletionEnabled || inspirationBlocked || inspirationDeleted || Boolean(deleteBlockedTitle)}
            title={
              inspirationDeleted
                ? t("resource.deleted")
                : inspirationBlocked
                ? getResourceBlockedActionTitle(inspiration, t("resource.blockedAction"))
                : deleteBlockedTitle
                  ? deleteBlockedTitle
                : deletionEnabled
                  ? t("inspirations.delete")
                  : t("inspirations.deleteDisabled")
            }
            className="inline-flex items-center rounded-md px-2 py-1.5 text-sm font-medium text-amber-600 transition-colors hover:bg-amber-50 hover:text-amber-700 disabled:opacity-50 dark:text-amber-300 dark:hover:bg-amber-500/10 dark:hover:text-amber-100"
          >
            <Archive size={14} className="mr-1" /> {t("inspirations.delete")}
          </button>
        </div>
      </td>
    </tr>
  );
}

function ResourceGroupBadge({ name }: { name: string }) {
  return (
    <span className="inline-flex max-w-full items-center rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 dark:border-violet-400/35 dark:bg-violet-500/12 dark:text-violet-100">
      <span className="truncate">{name}</span>
    </span>
  );
}

function InspirationSearchPanel({
  draft,
  isAdmin,
  currentUser,
  users,
  usersLoading,
  ownerSearch,
  resourceGroups,
  resourceGroupsLoading,
  selectedResourceGroupId,
  active,
  activeCount,
  fetching,
  mobileOpen,
  onChange,
  onClear,
  onMobileToggle,
  onOwnerSearchChange,
  onResourceGroupChange,
  onQuickRange,
  onSubmit,
}: {
  draft: InspirationSearchFilters;
  isAdmin: boolean;
  currentUser: SessionUser | null;
  users: RbacUser[];
  usersLoading: boolean;
  ownerSearch: string;
  resourceGroups: GenerationResourceGroup[];
  resourceGroupsLoading: boolean;
  selectedResourceGroupId: string;
  active: boolean;
  activeCount: number;
  fetching: boolean;
  mobileOpen: boolean;
  onChange: (filters: InspirationSearchFilters) => void;
  onClear: () => void;
  onMobileToggle: () => void;
  onOwnerSearchChange: (value: string) => void;
  onResourceGroupChange: (resourceGroupId: string) => void;
  onQuickRange: (rangeId: InspirationQuickRangeId) => void;
  onSubmit: (event?: FormEvent<HTMLFormElement>) => void;
}) {
  const { t } = useI18n();
  const panelRef = useRef<HTMLFormElement | null>(null);
  const [singleRowLayoutAvailable, setSingleRowLayoutAvailable] = useState(false);
  const fieldClassName =
    "h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 shadow-sm " +
    "outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 " +
    "dark:border-slate-700 dark:bg-[#0f1726] dark:text-slate-100 dark:focus:border-violet-400";
  const labelClassName = "text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500";
  const selectedResourceGroup = resourceGroups.find((group) => group.id === selectedResourceGroupId);
  const selectedOwner = users.find((user) => user.id === draft.owner_user_id);
  const selectedOwnerLabel = selectedOwner
    ? selectedOwner.display_name || selectedOwner.username
    : currentUser && currentUser.id === draft.owner_user_id
      ? currentUser.display_name || currentUser.username
      : draft.owner_user_id;
  const ownerOptions = [
    { value: "", label: t("inspirations.search.allOwners") },
    ...(currentUser && !users.some((user) => user.id === currentUser.id)
      ? [{ value: currentUser.id, label: `${currentUser.display_name || currentUser.username} (${currentUser.username})` }]
      : []),
    ...users.map((user) => ({
      value: user.id,
      label: `${user.display_name || user.username} (${user.username})`,
    })),
  ];
  const dateRangeSummary =
    draft.updated_from || draft.updated_to ? `${draft.updated_from || "..."} - ${draft.updated_to || "..."}` : "";
  const compactSummaryItems = [
    {
      key: "resource-group",
      label: t("inspirations.resourceGroupFilter"),
      value:
        selectedResourceGroup?.name ??
        (resourceGroupsLoading && !selectedResourceGroupId
          ? t("app.loading")
          : selectedResourceGroupId || t("inspirations.allResourceGroups")),
    },
    draft.title.trim()
      ? {
          key: "title",
          label: t("inspirations.search.title"),
          value: draft.title.trim(),
        }
      : null,
    dateRangeSummary
      ? {
          key: "updated-range",
          label: t("inspirations.search.updatedRange"),
          value: dateRangeSummary,
        }
      : null,
    isAdmin && draft.owner_user_id
      ? {
          key: "owner",
          label: t("inspirations.search.owner"),
          value: selectedOwnerLabel,
        }
      : null,
    isAdmin && draft.only_deleted
      ? {
          key: "only-deleted",
          label: t("inspirations.search.onlyDeleted"),
        }
      : null,
  ].filter((item): item is { key: string; label: string; value?: string } => Boolean(item));
  const compactLayout = !singleRowLayoutAvailable;
  const fieldsOpen = singleRowLayoutAvailable || mobileOpen;
  const gridClassName = singleRowLayoutAvailable
    ? isAdmin
      ? "grid-cols-[minmax(13rem,1.25fr)_minmax(18rem,1fr)_minmax(10rem,0.75fr)_minmax(10rem,0.75fr)_minmax(8.5rem,auto)_auto] items-end"
      : "grid-cols-[minmax(13rem,1.25fr)_minmax(18rem,1fr)_minmax(10rem,0.75fr)_auto] items-end"
    : "md:grid-cols-2";

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) {
      return;
    }

    const minWidth = isAdmin ? ADMIN_SEARCH_PANEL_SINGLE_ROW_WIDTH_PX : SEARCH_PANEL_SINGLE_ROW_WIDTH_PX;
    const updateLayout = () => {
      setSingleRowLayoutAvailable(panel.clientWidth >= minWidth);
    };

    updateLayout();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateLayout);
      return () => window.removeEventListener("resize", updateLayout);
    }

    const observer = new ResizeObserver(updateLayout);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [isAdmin]);

  return (
    <form ref={panelRef} onSubmit={onSubmit} className="pf-panel overflow-visible px-4 py-3 md:px-5 lg:py-4">
      <div className={`${compactLayout ? "flex" : "hidden"} items-center gap-2`}>
        <button
          type="button"
          onClick={onMobileToggle}
          aria-expanded={mobileOpen}
          aria-controls="inspiration-search-fields"
          aria-label={mobileOpen ? t("inspirations.search.collapse") : t("inspirations.search.expand")}
          className="flex min-w-0 flex-1 items-start gap-3 rounded-xl px-1.5 py-1 text-left transition-colors active:scale-[0.99] hover:bg-slate-50 dark:hover:bg-violet-500/10"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-violet-500/14 dark:text-violet-200">
            <Search size={16} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-slate-950 dark:text-white">
              {t("inspirations.search.panelTitle")}
            </span>
            <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">
              {activeCount > 0
                ? t("inspirations.search.activeCount", { count: activeCount })
                : t("inspirations.search.collapsedHint")}
            </span>
            <span className="mt-2 flex max-h-[3.75rem] flex-wrap gap-1.5 overflow-hidden">
              {compactSummaryItems.map((item) => (
                <span
                  key={item.key}
                  className="inline-flex max-w-full items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
                >
                  <span className="shrink-0 text-slate-400 dark:text-slate-500">{item.label}</span>
                  {item.value ? (
                    <>
                      <span className="mx-1 shrink-0 text-slate-300 dark:text-slate-600">:</span>
                      <span className="min-w-0 truncate">{item.value}</span>
                    </>
                  ) : null}
                </span>
              ))}
            </span>
          </span>
          <ChevronDown
            size={17}
            className={`mt-2 shrink-0 text-slate-400 transition-transform duration-150 dark:text-slate-500 ${
              mobileOpen ? "rotate-180" : ""
            }`}
            aria-hidden="true"
          />
        </button>
        {active ? (
          <button
            type="button"
            onClick={onClear}
            disabled={fetching}
            aria-label={t("inspirations.search.clear")}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-800 active:scale-[0.98] disabled:opacity-45 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-violet-500/10 dark:hover:text-white"
          >
            <X size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>

      <div id="inspiration-search-fields" className={`${fieldsOpen ? "block" : "hidden"} ${compactLayout ? "mt-4" : "mt-0"}`}>
        <div
          className={`grid gap-4 ${gridClassName}`}
        >
          <label className={`min-w-0 space-y-2 ${singleRowLayoutAvailable ? "" : "md:col-span-2"}`}>
            <span className={labelClassName}>{t("inspirations.search.title")}</span>
            <div className="relative">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
                aria-hidden="true"
              />
              <input
                value={draft.title}
                onChange={(event) => onChange({ ...draft, title: event.target.value })}
                placeholder={t("inspirations.search.titlePlaceholder")}
                className={`${fieldClassName} pl-9`}
              />
            </div>
          </label>

          <fieldset className="min-w-0 space-y-2">
            <legend className={labelClassName}>{t("inspirations.search.updatedRange")}</legend>
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-xl border border-slate-200 bg-white px-2 py-1.5 shadow-sm dark:border-slate-700 dark:bg-[#0f1726]">
              <label className="sr-only" htmlFor="inspiration-updated-from">
                {t("inspirations.search.updatedFrom")}
              </label>
              <input
                id="inspiration-updated-from"
                type="date"
                value={draft.updated_from}
                onChange={(event) => onChange({ ...draft, updated_from: event.target.value })}
                className="h-8 min-w-0 rounded-lg border-0 bg-transparent px-1.5 text-sm font-medium text-slate-900 outline-none focus:bg-indigo-50/70 focus:ring-2 focus:ring-indigo-500/15 dark:text-slate-100 dark:focus:bg-violet-500/10 dark:focus:ring-violet-400/30"
              />
              <span className="text-xs font-semibold text-slate-300 dark:text-slate-600" aria-hidden="true">
                -
              </span>
              <label className="sr-only" htmlFor="inspiration-updated-to">
                {t("inspirations.search.updatedTo")}
              </label>
              <input
                id="inspiration-updated-to"
                type="date"
                value={draft.updated_to}
                onChange={(event) => onChange({ ...draft, updated_to: event.target.value })}
                className="h-8 min-w-0 rounded-lg border-0 bg-transparent px-1.5 text-sm font-medium text-slate-900 outline-none focus:bg-indigo-50/70 focus:ring-2 focus:ring-indigo-500/15 dark:text-slate-100 dark:focus:bg-violet-500/10 dark:focus:ring-violet-400/30"
              />
            </div>
          </fieldset>

          {isAdmin ? (
            <label className="space-y-2">
              <span className={labelClassName}>{t("inspirations.search.owner")}</span>
              <SelectField
                value={draft.owner_user_id}
                options={ownerOptions}
                onChange={(value) => onChange({ ...draft, owner_user_id: value })}
                ariaLabel={t("inspirations.search.owner")}
                searchValue={ownerSearch}
                onSearchChange={onOwnerSearchChange}
                searchPlaceholder={t("inspirations.search.ownerSearchPlaceholder")}
                searchAriaLabel={t("inspirations.search.ownerSearch")}
                searchLoading={usersLoading}
                searchLoadingLabel={t("app.loading")}
                radius="xl"
                visualSize="md"
              />
            </label>
          ) : null}

          <label className="space-y-2">
            <span className={labelClassName}>{t("inspirations.resourceGroupFilter")}</span>
            <select
              value={selectedResourceGroupId}
              onChange={(event) => onResourceGroupChange(event.target.value)}
              disabled={resourceGroupsLoading}
              className={fieldClassName}
            >
              <option value="">{t("inspirations.allResourceGroups")}</option>
              {resourceGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>

          {isAdmin ? (
            <label className="flex h-11 items-center gap-2 self-end rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-[#0f1726] dark:text-slate-200">
              <input
                type="checkbox"
                checked={draft.only_deleted}
                onChange={(event) => onChange({ ...draft, only_deleted: event.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-600 dark:bg-slate-950 dark:text-violet-400 dark:focus:ring-violet-400"
              />
              <span className="truncate">{t("inspirations.search.onlyDeleted")}</span>
            </label>
          ) : null}

          <div
            className={`flex shrink-0 flex-wrap items-center gap-2 ${
              singleRowLayoutAvailable ? "justify-start" : "md:col-span-2 md:justify-end"
            }`}
          >
            <button
              type="submit"
              disabled={fetching}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm shadow-indigo-600/20 transition hover:bg-indigo-500 disabled:opacity-50 dark:bg-violet-500 dark:hover:bg-violet-400"
            >
              <Search size={16} className="mr-1.5" /> {t("inspirations.search.submit")}
            </button>
            <button
              type="button"
              onClick={onClear}
              disabled={!active || fetching}
              className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-45 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-violet-500/10"
            >
              <X size={16} className="mr-1.5" /> {t("inspirations.search.clear")}
            </button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span className="font-medium">{t("inspirations.search.quickLabel")}</span>
          {INSPIRATION_QUICK_RANGE_IDS.map((rangeId) => (
            <button
              key={rangeId}
              type="button"
              onClick={() => onQuickRange(rangeId)}
              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-600 transition hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:hover:border-violet-400/50 dark:hover:bg-violet-500/12 dark:hover:text-violet-100"
            >
              {t(INSPIRATION_QUICK_RANGE_LABEL_KEYS[rangeId])}
            </button>
          ))}
        </div>
      </div>
    </form>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="pf-panel-soft flex min-w-0 items-end gap-3 px-3 py-2.5 lg:block lg:py-3 xl:px-4">
      <div className="shrink-0 text-2xl font-semibold leading-none tracking-tight text-slate-950 dark:text-white lg:leading-normal">{value}</div>
      <div className="min-w-0 translate-y-[-1px] truncate text-[11px] font-semibold uppercase leading-none tracking-wider text-slate-400 dark:text-slate-500 lg:mt-1 lg:translate-y-0 lg:leading-normal">{label}</div>
    </div>
  );
}

function hoverImagePreviewGeometry(anchorRect: DOMRect) {
  if (typeof window === "undefined") {
    return {
      size: HOVER_IMAGE_PREVIEW_SIZE_PX,
      top: anchorRect.top,
      left: anchorRect.right + HOVER_IMAGE_PREVIEW_GAP_PX,
    };
  }
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const size = Math.max(
    140,
    Math.min(
      HOVER_IMAGE_PREVIEW_SIZE_PX,
      viewportWidth - HOVER_IMAGE_PREVIEW_GAP_PX * 2,
      viewportHeight - HOVER_IMAGE_PREVIEW_GAP_PX * 2,
    ),
  );
  const rightSideLeft = anchorRect.right + HOVER_IMAGE_PREVIEW_GAP_PX;
  const leftSideLeft = anchorRect.left - size - HOVER_IMAGE_PREVIEW_GAP_PX;
  const preferredLeft =
    rightSideLeft + size <= viewportWidth - HOVER_IMAGE_PREVIEW_GAP_PX ? rightSideLeft : leftSideLeft;
  return {
    size,
    top: clamp(
      anchorRect.top + anchorRect.height / 2 - size / 2,
      HOVER_IMAGE_PREVIEW_GAP_PX,
      Math.max(HOVER_IMAGE_PREVIEW_GAP_PX, viewportHeight - size - HOVER_IMAGE_PREVIEW_GAP_PX),
    ),
    left: clamp(
      preferredLeft,
      HOVER_IMAGE_PREVIEW_GAP_PX,
      Math.max(HOVER_IMAGE_PREVIEW_GAP_PX, viewportWidth - size - HOVER_IMAGE_PREVIEW_GAP_PX),
    ),
  };
}

function HoverImagePreview({ imageUrl, anchorRect }: { imageUrl: string; anchorRect: DOMRect }) {
  const geometry = hoverImagePreviewGeometry(anchorRect);
  return (
    <div
      className="pointer-events-none fixed z-40 rounded-2xl border border-white/80 bg-white/95 p-1 shadow-[0_18px_45px_rgba(15,23,42,0.22)] backdrop-blur dark:border-slate-700/90 dark:bg-slate-950/95 dark:shadow-[0_22px_50px_rgba(0,0,0,0.48)]"
      style={{
        top: geometry.top,
        left: geometry.left,
        width: geometry.size,
        height: geometry.size,
      }}
      aria-hidden="true"
    >
      <img src={api.toApiUrl(imageUrl)} alt="" className="h-full w-full rounded-xl object-cover" decoding="async" />
    </div>
  );
}

function HoverableImageFrame({
  imageUrl,
  previewUrl,
  alt,
  className,
  iconSize,
}: {
  imageUrl: string | null;
  previewUrl?: string | null;
  alt: string;
  className: string;
  iconSize: number;
}) {
  const [failed, setFailed] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const shouldShowImage = Boolean(imageUrl) && !failed;
  const hoverPreviewUrl = previewUrl ?? imageUrl;

  const showPreview = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || !shouldShowImage) {
      return;
    }
    setAnchorRect(event.currentTarget.getBoundingClientRect());
  };

  const hidePreview = () => setAnchorRect(null);

  return (
    <div
      className={className}
      onPointerEnter={showPreview}
      onPointerLeave={hidePreview}
      onPointerCancel={hidePreview}
    >
      {shouldShowImage && imageUrl ? (
        <img
          src={api.toApiUrl(imageUrl)}
          alt={alt}
          className="h-full w-full object-cover"
          decoding="async"
          loading="lazy"
          onError={() => {
            setFailed(true);
            hidePreview();
          }}
        />
      ) : (
        <ImageIcon size={iconSize} strokeWidth={1.5} />
      )}
      {shouldShowImage && hoverPreviewUrl && anchorRect ? (
        <HoverImagePreview imageUrl={hoverPreviewUrl} anchorRect={anchorRect} />
      ) : null}
    </div>
  );
}

function InspirationKeyInfoCell({ inspiration, compact = false }: { inspiration: InspirationSummary; compact?: boolean }) {
  const { t } = useI18n();
  const info = inspirationKeyInfo(inspiration);

  if (info.kind === "image") {
    const title = info.filename ?? t("inspirations.keyInfo.startImage");
    return (
      <div
        className={`flex min-w-0 items-center gap-2 text-xs text-zinc-500 dark:text-slate-400 ${
          compact ? "mt-2" : ""
        }`}
        title={title}
      >
        <HoverableImageFrame
          imageUrl={info.thumbnailUrl}
          previewUrl={info.previewUrl}
          alt={t("inspirations.keyInfo.startImageAlt", { name: inspiration.name })}
          iconSize={15}
          className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100 text-slate-400 dark:border-slate-700 dark:bg-[#0b1220] dark:text-slate-500"
        />
        {!compact && info.filename ? (
          <span className="min-w-0 truncate" title={info.filename}>
            {info.filename}
          </span>
        ) : null}
      </div>
    );
  }

  if (info.kind === "text") {
    return (
      <div
        className={`flex min-w-0 items-center text-xs font-medium text-slate-600 dark:text-slate-300 ${
          compact ? "mt-2" : ""
        }`}
        title={info.text}
      >
        <span className={`block min-w-0 max-w-full truncate leading-5 ${compact ? "text-xs" : "text-sm"}`}>
          {info.text}
        </span>
      </div>
    );
  }

  return (
    <div
      className={`flex min-w-0 items-center text-xs text-zinc-400 dark:text-slate-500 ${compact ? "mt-2" : ""}`}
    >
      <span className="truncate">{t("inspirations.keyInfo.empty")}</span>
    </div>
  );
}

function InspirationThumbnail({ inspiration, compact = false }: { inspiration: InspirationSummary; compact?: boolean }) {
  const thumbUrl = inspirationMainThumbnailUrl(inspiration);
  const previewUrl = inspiration.latest_generated_image_preview_url ?? inspiration.latest_generated_image_thumbnail_url;

  return (
    <HoverableImageFrame
      imageUrl={thumbUrl}
      previewUrl={previewUrl}
      alt={inspiration.name}
      iconSize={18}
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-100 text-slate-400 shadow-sm dark:border-slate-700 dark:bg-[#0b1220] dark:text-slate-500 ${
        compact ? "h-20 w-20" : "h-16 w-16"
      }`}
    />
  );
}

function Pagination({
  page,
  totalPages,
  onPageChange,
  disabled,
  floating = false,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  disabled: boolean;
  floating?: boolean;
}) {
  const { t } = useI18n();
  const [draftPage, setDraftPage] = useState(String(page));

  useEffect(() => {
    setDraftPage(String(page));
  }, [page]);

  const commitPage = () => {
    const numericPage = Number.parseInt(draftPage, 10);
    if (!Number.isFinite(numericPage)) {
      setDraftPage(String(page));
      return;
    }
    const nextPage = Math.min(totalPages, Math.max(1, numericPage));
    setDraftPage(String(nextPage));
    if (nextPage !== page) {
      onPageChange(nextPage);
    }
  };

  return (
    <div
      className={`inline-flex items-center gap-2 border p-1 shadow-sm ${
        floating
          ? "rounded-2xl border-slate-200/85 bg-white/95 shadow-[0_16px_44px_rgba(15,23,42,0.18)] backdrop-blur dark:border-slate-700/90 dark:bg-slate-950/94 dark:shadow-[0_18px_46px_rgba(0,0,0,0.42)]"
          : "rounded-lg border-zinc-200 bg-white dark:border-slate-700/80 dark:bg-[#151f33] dark:shadow-black/20"
      }`}
    >
      <button
        type="button"
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={disabled || page <= 1}
        className="inline-flex min-h-11 items-center rounded-md px-3 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-violet-500/15 dark:hover:text-white xl:min-h-0 xl:px-2.5 xl:py-1.5"
      >
        <ArrowLeft size={13} className="mr-1" /> {t("pagination.previous")}
      </button>
      <label className="flex items-center gap-1.5 px-1 text-xs tabular-nums text-zinc-500 dark:text-slate-400">
        <span className="sr-only">{t("pagination.pageInput")}</span>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={draftPage}
          disabled={disabled}
          onBlur={commitPage}
          onChange={(event) => setDraftPage(event.target.value.replace(/\D/g, ""))}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
            if (event.key === "Escape") {
              setDraftPage(String(page));
              event.currentTarget.blur();
            }
          }}
          className="h-8 w-11 rounded-md border border-slate-200 bg-white px-1.5 text-center text-xs font-semibold tabular-nums text-slate-700 outline-none transition-colors focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:focus:border-violet-400 dark:focus:ring-violet-400/20 xl:h-7"
          aria-label={t("pagination.pageInput")}
        />
        <span>/</span>
        <span>{totalPages}</span>
      </label>
      <button
        type="button"
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        disabled={disabled || page >= totalPages}
        className="inline-flex min-h-11 items-center rounded-md px-3 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-violet-500/15 dark:hover:text-white xl:min-h-0 xl:px-2.5 xl:py-1.5"
      >
        {t("pagination.next")} <ArrowRight size={13} className="ml-1" />
      </button>
    </div>
  );
}
