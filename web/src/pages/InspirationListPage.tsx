import {
  useEffect,
  useDeferredValue,
  useId,
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
import { useLocation, useNavigate } from "react-router-dom";

import { ClassicCheckbox, ClassicSelectField, ClassicTextInput } from "../components/classicInputs";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { LayoutActionSurfaceButton } from "../components/LayoutActionSurfaceButton";
import {
  actionButtonComponentForAppearance,
  transparentActionToneVars,
} from "../components/layoutActionButtons";
import { SensitiveImageOverlay, sensitiveImageClassName } from "../components/SensitiveImageMask";
import {
  ClassicDateTimeRangeField,
  WorkspaceDateTimeRangeField,
  datePartFromDateTimeLocal,
  workspaceQuickDateTimeRange,
  type WorkspaceQuickRangeId,
} from "../components/WorkspaceDateTimeRangeField";
import {
  getResourceBlockedActionTitle,
  isResourceBlocked,
  isResourceDeleted,
  ResourceMetaBadges,
} from "../components/ResourceGovernance";
import { StatusPill } from "../components/StatusPill";
import { TopNav } from "../components/TopNav";
import { WorkspaceCheckbox, WorkspaceSelectField, WorkspaceTextInput } from "../components/workspaceInputs";
import { api, ApiError } from "../lib/api";
import { formatDateTimeSeconds, formatPrice } from "../lib/format";
import { useI18n } from "../lib/preferences";
import { API_INSPIRATIONS_WRITE, hasSessionApiPermission } from "../lib/rbac";
import { activeGenerationResourceGroupsInApiOrder, firstActiveGenerationResourceGroupId } from "../lib/resourceGroups";
import { useSensitiveImageMaskPreference } from "../lib/sensitiveImagePreferences";
import { shouldMaskSensitiveImage, shouldShowSensitiveImageMaskPreference } from "../lib/sensitiveImages";
import { useSessionState } from "../lib/session";
import type { GenerationResourceGroup, InspirationSummary, RbacUser, SessionUser } from "../lib/types";
import { useUiLayoutScheme } from "../lib/uiLayoutSchemePreference";
import { inspirationKeyInfo, inspirationMainThumbnailUrl } from "./InspirationListPage.helpers";
import { WorkspaceSubpageFrame } from "./workspace/WorkspaceLandingPages";

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

interface InspirationListRestoreState {
  page: number;
  searchDraft: InspirationSearchFilters;
  activeSearch: InspirationSearchFilters;
  resourceGroupDraftId?: string | null;
  selectedResourceGroupId: string | null;
  ownerSearch: string;
  mobileSearchOpen: boolean;
}

interface InspirationCreateReturnState {
  source: "inspiration-list";
  returnTo: string;
  listState: InspirationListRestoreState;
}

interface InspirationListLocationState {
  restoreInspirationListState?: InspirationListRestoreState;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function inspirationActionButtonComponent(workspaceSubpage: boolean) {
  return actionButtonComponentForAppearance(workspaceSubpage ? "workspace" : "classic");
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

function isInspirationSearchFilters(value: unknown): value is InspirationSearchFilters {
  if (!value || typeof value !== "object") {
    return false;
  }
  const filters = value as InspirationSearchFilters;
  return (
    typeof filters.title === "string" &&
    typeof filters.updated_from === "string" &&
    typeof filters.updated_to === "string" &&
    typeof filters.owner_user_id === "string" &&
    typeof filters.only_deleted === "boolean"
  );
}

function restoredInspirationListState(value: unknown): InspirationListRestoreState | null {
  const state = (value as InspirationListLocationState | null)?.restoreInspirationListState;
  if (!state || typeof state !== "object") {
    return null;
  }
  if (!isInspirationSearchFilters(state.searchDraft) || !isInspirationSearchFilters(state.activeSearch)) {
    return null;
  }
  return {
    page: Number.isFinite(state.page) ? Math.max(1, Math.floor(state.page)) : 1,
    searchDraft: state.searchDraft,
    activeSearch: state.activeSearch,
    resourceGroupDraftId:
      typeof state.resourceGroupDraftId === "string" || state.resourceGroupDraftId === null
        ? state.resourceGroupDraftId
        : undefined,
    selectedResourceGroupId:
      typeof state.selectedResourceGroupId === "string" || state.selectedResourceGroupId === null
        ? state.selectedResourceGroupId
        : null,
    ownerSearch: typeof state.ownerSearch === "string" ? state.ownerSearch : "",
    mobileSearchOpen: Boolean(state.mobileSearchOpen),
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

interface InspirationListPageProps {
  mode?: "auto" | "full";
}

export function InspirationListPage({ mode = "auto" }: InspirationListPageProps = {}) {
  return <InspirationFullListPage workspaceSubpage={mode === "full"} />;
}

function InspirationFullListPage({ workspaceSubpage }: { workspaceSubpage: boolean }) {
  const { t } = useI18n();
  const { activeScheme } = useUiLayoutScheme();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const session = useSessionState();
  const currentUser = session?.user ?? null;
  const isAdmin = Boolean(currentUser?.is_admin);
  const canWriteInspirations = hasSessionApiPermission(session, API_INSPIRATIONS_WRITE);
  const restoredListStateRef = useRef(restoredInspirationListState(location.state));
  const hasRestoredListState = restoredListStateRef.current !== null;
  const [page, setPage] = useState(() => restoredListStateRef.current?.page ?? 1);
  const [searchDraft, setSearchDraft] = useState<InspirationSearchFilters>(
    () => restoredListStateRef.current?.searchDraft ?? EMPTY_INSPIRATION_SEARCH,
  );
  const [activeSearch, setActiveSearch] = useState<InspirationSearchFilters>(
    () => restoredListStateRef.current?.activeSearch ?? EMPTY_INSPIRATION_SEARCH,
  );
  const [adminOwnerFilterInitialized, setAdminOwnerFilterInitialized] = useState(() => hasRestoredListState);
  const [selectedResourceGroupId, setSelectedResourceGroupId] = useState<string | null>(
    () => restoredListStateRef.current?.selectedResourceGroupId ?? null,
  );
  const [resourceGroupDraftId, setResourceGroupDraftId] = useState<string | null>(
    () => restoredListStateRef.current?.resourceGroupDraftId ?? restoredListStateRef.current?.selectedResourceGroupId ?? null,
  );
  const [ownerSearch, setOwnerSearch] = useState(() => restoredListStateRef.current?.ownerSearch ?? "");
  const [mobileSearchOpen, setMobileSearchOpen] = useState(
    () => restoredListStateRef.current?.mobileSearchOpen ?? false,
  );
  const [deleteError, setDeleteError] = useState("");
  const [pendingDeleteInspiration, setPendingDeleteInspiration] = useState<InspirationSummary | null>(null);
  const [maskSensitiveImages, setMaskSensitiveImages] = useSensitiveImageMaskPreference("inspirations");
  const deferredOwnerSearch = useDeferredValue(ownerSearch.trim());
  const inspirationsQuery = useQuery({
    queryKey: ["inspirations", selectedResourceGroupId, page, PAGE_SIZE, activeSearch],
    queryFn: () =>
      api.listInspirations({
        resource_group_id: selectedResourceGroupId || null,
        page,
        page_size: PAGE_SIZE,
        title: activeSearch.title || undefined,
        updated_from: activeSearch.updated_from ? datePartFromDateTimeLocal(activeSearch.updated_from) : undefined,
        updated_to: activeSearch.updated_to ? datePartFromDateTimeLocal(activeSearch.updated_to) : undefined,
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
        setResourceGroupDraftId("");
        if (!hasRestoredListState) {
          setPage(1);
        }
      }
      return;
    }
    if (selectedResourceGroupId === null || (selectedResourceGroupId && !resourceGroups.some((group) => group.id === selectedResourceGroupId))) {
      const firstResourceGroupId = firstActiveGenerationResourceGroupId(resourceGroups);
      setSelectedResourceGroupId(firstResourceGroupId);
      setResourceGroupDraftId(firstResourceGroupId);
      if (!hasRestoredListState) {
        setPage(1);
      }
    }
    if (resourceGroupDraftId && !resourceGroups.some((group) => group.id === resourceGroupDraftId)) {
      setResourceGroupDraftId(firstActiveGenerationResourceGroupId(resourceGroups));
    }
  }, [generationResourceGroupsQuery.isFetched, hasRestoredListState, resourceGroupDraftId, resourceGroups, selectedResourceGroupId]);

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
    setSelectedResourceGroupId(resourceGroupDraftId ?? "");
    setPage(1);
    setMobileSearchOpen(false);
  };

  const clearSearch = () => {
    setSearchDraft(EMPTY_INSPIRATION_SEARCH);
    setActiveSearch(EMPTY_INSPIRATION_SEARCH);
    setResourceGroupDraftId("");
    setSelectedResourceGroupId("");
    setPage(1);
    setMobileSearchOpen(false);
  };

  const currentListReturnState = (): InspirationCreateReturnState => ({
    source: "inspiration-list",
    returnTo: `${location.pathname}${location.search}${location.hash}`,
    listState: {
      page,
      searchDraft,
      activeSearch,
      resourceGroupDraftId,
      selectedResourceGroupId,
      ownerSearch,
      mobileSearchOpen,
    },
  });

  const openCreateInspiration = () => {
    navigate("/inspirations/new", { state: currentListReturnState() });
  };

  const applyQuickRange = (rangeId: WorkspaceQuickRangeId) => {
    const range = workspaceQuickDateTimeRange(rangeId);
    setSearchDraft((current) => ({ ...current, updated_from: range.start_date, updated_to: range.end_date }));
  };
  const isWorkspaceSubpage = activeScheme === "workspace" && workspaceSubpage;
  const PageActionButton = inspirationActionButtonComponent(isWorkspaceSubpage);
  const newInspirationButton = (
    <PageActionButton
      onClick={openCreateInspiration}
      disabled={!canWriteInspirations}
      title={canWriteInspirations ? t("inspirations.new") : t("inspirations.writePermissionRequired")}
      preset="primary"
      size="lg"
      leadingIcon={<Plus size={16} />}
    >
      {t("inspirations.new")}
    </PageActionButton>
  );

  const listContent = (
    <div className="w-full space-y-4 lg:space-y-6">
      {isWorkspaceSubpage ? (
        <div className="grid gap-2 md:grid-cols-3 xl:gap-3">
          <MetricCard label={t("inspirations.totalMetric")} value={total} />
          <MetricCard label={t("inspirations.copyReadyMetric")} value={copyReadyCount} />
          <MetricCard label={t("inspirations.posterReadyMetric")} value={posterReadyCount} />
        </div>
      ) : (
        <>
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
              <PageActionButton
                onClick={openCreateInspiration}
                disabled={!canWriteInspirations}
                aria-label={t("inspirations.new")}
                title={canWriteInspirations ? t("inspirations.new") : t("inspirations.writePermissionRequired")}
                preset="primary"
                size="icon-lg"
                leadingIcon={<Plus size={18} aria-hidden="true" />}
              />
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
                <div className="mt-5 flex flex-wrap items-center gap-3">{newInspirationButton}</div>
              </div>
              <div className="grid gap-2 self-end lg:grid-cols-3 xl:gap-3">
                <MetricCard label={t("inspirations.totalMetric")} value={total} />
                <MetricCard label={t("inspirations.copyReadyMetric")} value={copyReadyCount} />
                <MetricCard label={t("inspirations.posterReadyMetric")} value={posterReadyCount} />
              </div>
            </div>
          </section>
        </>
      )}

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
        selectedResourceGroupId={resourceGroupDraftId ?? ""}
        maskSensitiveImages={maskSensitiveImages}
        active={searchDraftActive || searchActive}
        activeCount={searchFilterCount}
        fetching={inspirationsQuery.isFetching}
        mobileOpen={mobileSearchOpen}
        workspaceSubpage={isWorkspaceSubpage}
        onChange={setSearchDraft}
        onClear={clearSearch}
        onMobileToggle={() => setMobileSearchOpen((current) => !current)}
        onResourceGroupChange={setResourceGroupDraftId}
        onMaskSensitiveImagesChange={setMaskSensitiveImages}
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
                      workspaceSubpage={isWorkspaceSubpage}
                      maskSensitiveImages={maskSensitiveImages}
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
                          workspaceSubpage={isWorkspaceSubpage}
                          maskSensitiveImages={maskSensitiveImages}
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
              <PageActionButton
                onClick={clearSearch}
                preset="secondary"
                size="lg"
                leadingIcon={<X size={16} />}
                className="mt-5"
              >
                {t("inspirations.search.clear")}
              </PageActionButton>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-16 text-center dark:border-slate-700/80 dark:bg-[#0f1726]">
              <ImageIcon className="mx-auto mb-3 text-zinc-300 dark:text-slate-500" size={32} />
              <div className="font-medium text-zinc-900 dark:text-white">{t("inspirations.emptyTitle")}</div>
              <p className="mt-1 text-sm text-zinc-500 dark:text-slate-400">{t("inspirations.emptyDescription")}</p>
              <PageActionButton
                onClick={openCreateInspiration}
                disabled={!canWriteInspirations}
                title={canWriteInspirations ? t("inspirations.new") : t("inspirations.writePermissionRequired")}
                preset="primary"
                size="lg"
                leadingIcon={<Plus size={16} />}
                className="mt-5"
              >
                {t("inspirations.new")}
              </PageActionButton>
            </div>
          )}

          {inspirations.length ? (
            <div className="hidden justify-end md:flex">
              <Pagination
                page={page}
                totalPages={totalPages}
                onPageChange={setPage}
                disabled={inspirationsQuery.isFetching}
                workspaceSubpage={isWorkspaceSubpage}
              />
            </div>
          ) : null}
    </div>
  );

  return (
    <div className={`${isWorkspaceSubpage ? "pf-workspace" : "pf-app"} flex flex-col`}>
      <TopNav
        onHome={() => navigate("/inspirations")}
        onLogout={() => logoutMutation.mutate()}
      />

      {isWorkspaceSubpage ? (
        <WorkspaceSubpageFrame
          eyebrow={t("inspirations.heroEyebrow")}
          title={t("inspirations.listTitle")}
          description={t("inspirations.description")}
          actions={newInspirationButton}
        >
          {listContent}
        </WorkspaceSubpageFrame>
      ) : (
        <main className="pf-page flex flex-1">
          {listContent}
        </main>
      )}
      {inspirations.length ? (
        <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-40 flex justify-center px-4 md:hidden">
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            disabled={inspirationsQuery.isFetching}
            floating
            workspaceSubpage={isWorkspaceSubpage}
          />
        </div>
      ) : null}
      <ConfirmDialog
        open={Boolean(pendingDeleteInspiration)}
        appearance={isWorkspaceSubpage ? "workspace" : "classic"}
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
  workspaceSubpage = false,
  maskSensitiveImages,
  deletionEnabled,
  deleteBlockedTitle = null,
  isDeleting,
  onOpen,
  onDelete,
}: {
  inspiration: InspirationSummary;
  className?: string;
  workspaceSubpage?: boolean;
  maskSensitiveImages: boolean;
  deletionEnabled: boolean;
  deleteBlockedTitle?: string | null;
  isDeleting: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const PageActionButton = inspirationActionButtonComponent(workspaceSubpage);
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
      <div
        className="absolute inset-y-0 right-0 flex w-24 items-center justify-center border-l border-amber-200/70 bg-amber-50/80 dark:border-amber-200/20 dark:bg-amber-500/10"
        style={{ opacity: deleteOpacity, pointerEvents: deleteOpen ? "auto" : "none" }}
      >
        <PageActionButton
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
          preset="danger"
          size="sm"
          className="min-w-[4.25rem]"
          leadingIcon={<Archive size={14} aria-hidden="true" />}
        >
          {t("inspirations.delete")}
        </PageActionButton>
      </div>
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
        <InspirationThumbnail inspiration={inspiration} compact maskSensitiveImages={maskSensitiveImages} />
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
          <InspirationKeyInfoCell inspiration={inspiration} compact maskSensitiveImages={maskSensitiveImages} />
        </div>
      </div>
      </div>
    </article>
  );
}

function InspirationTableRow({
  inspiration,
  workspaceSubpage = false,
  maskSensitiveImages,
  deletionEnabled,
  deleteBlockedTitle = null,
  isDeleting,
  onOpen,
  onDelete,
}: {
  inspiration: InspirationSummary;
  workspaceSubpage?: boolean;
  maskSensitiveImages: boolean;
  deletionEnabled: boolean;
  deleteBlockedTitle?: string | null;
  isDeleting: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const PageActionButton = inspirationActionButtonComponent(workspaceSubpage);
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
          <InspirationThumbnail inspiration={inspiration} maskSensitiveImages={maskSensitiveImages} />
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
        <InspirationKeyInfoCell inspiration={inspiration} maskSensitiveImages={maskSensitiveImages} />
      </td>
      <td className="px-5 py-4">
        <StatusPill status={inspiration.workflow_state} />
      </td>
      <td className="px-5 py-4 font-mono text-xs text-zinc-500 dark:text-slate-400">
        {formatDateTimeSeconds(inspiration.updated_at)}
      </td>
      <td className="px-5 py-4 text-right">
        <div className="flex items-center justify-end opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <PageActionButton
            onClick={handleDeleteClick}
            onPointerDown={(event) => event.stopPropagation()}
            disabled={isDeleting || !deletionEnabled || inspirationBlocked || inspirationDeleted || Boolean(deleteBlockedTitle)}
            aria-label={t("inspirations.deleteInspiration", { name: inspiration.name })}
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
            preset="danger"
            size="sm"
            leadingIcon={<Archive size={14} aria-hidden="true" />}
          >
            {t("inspirations.delete")}
          </PageActionButton>
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
  maskSensitiveImages,
  active,
  activeCount,
  fetching,
  mobileOpen,
  workspaceSubpage = false,
  onChange,
  onClear,
  onMobileToggle,
  onOwnerSearchChange,
  onResourceGroupChange,
  onMaskSensitiveImagesChange,
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
  maskSensitiveImages: boolean;
  active: boolean;
  activeCount: number;
  fetching: boolean;
  mobileOpen: boolean;
  workspaceSubpage?: boolean;
  onChange: (filters: InspirationSearchFilters) => void;
  onClear: () => void;
  onMobileToggle: () => void;
  onOwnerSearchChange: (value: string) => void;
  onResourceGroupChange: (resourceGroupId: string) => void;
  onMaskSensitiveImagesChange: (enabled: boolean) => void;
  onQuickRange: (rangeId: WorkspaceQuickRangeId) => void;
  onSubmit: (event?: FormEvent<HTMLFormElement>) => void;
}) {
  const { t } = useI18n();
  const PageActionButton = inspirationActionButtonComponent(workspaceSubpage);
  const actionAppearance = workspaceSubpage ? "workspace" : "classic";
  const panelRef = useRef<HTMLFormElement | null>(null);
  const [singleRowLayoutAvailable, setSingleRowLayoutAvailable] = useState(false);
  const labelClassName = "text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500";
  const selectedResourceGroup = resourceGroups.find((group) => group.id === selectedResourceGroupId);
  const showSensitiveImageMaskPreference = shouldShowSensitiveImageMaskPreference(
    selectedResourceGroupId,
    resourceGroups,
  );
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
    draft.updated_from || draft.updated_to
      ? `${(draft.updated_from || "...").replace("T", " ")} - ${(draft.updated_to || "...").replace("T", " ")}`
      : "";
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
      ? "grid-cols-[minmax(13rem,1fr)_minmax(30rem,1.45fr)_minmax(10rem,0.75fr)_minmax(10rem,0.75fr)_minmax(8.5rem,auto)] items-end"
      : "grid-cols-[minmax(13rem,1fr)_minmax(30rem,1.45fr)_minmax(10rem,0.75fr)] items-end"
    : "md:grid-cols-2";
  const searchToggleToneVars = {
    ...transparentActionToneVars,
    "--pf-action-bg-hover": "color-mix(in srgb, var(--pf-panel-soft) 88%, transparent)",
  } as const;

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
        <LayoutActionSurfaceButton
          type="button"
          appearance={actionAppearance}
          preset="secondary"
          onClick={onMobileToggle}
          aria-expanded={mobileOpen}
          aria-controls="inspiration-search-fields"
          aria-label={mobileOpen ? t("inspirations.search.collapse") : t("inspirations.search.expand")}
          toneVars={searchToggleToneVars}
          className="flex min-w-0 flex-1 items-start gap-3 rounded-xl border-0 px-1.5 py-1 text-left shadow-none"
          style={{ display: "flex" }}
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
        </LayoutActionSurfaceButton>
        {active ? (
          <PageActionButton
            onClick={onClear}
            disabled={fetching}
            aria-label={t("inspirations.search.clear")}
            title={t("inspirations.search.clear")}
            preset="secondary"
            size="icon-lg"
            className="shrink-0"
            leadingIcon={<X size={16} aria-hidden="true" />}
          />
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
              {workspaceSubpage ? (
                <WorkspaceTextInput
                  id="inspiration-search-title"
                  name="inspiration_search_title"
                  value={draft.title}
                  onChange={(event) => onChange({ ...draft, title: event.target.value })}
                  placeholder={t("inspirations.search.titlePlaceholder")}
                  className="pl-9"
                />
              ) : (
                <ClassicTextInput
                  id="inspiration-search-title"
                  name="inspiration_search_title"
                  value={draft.title}
                  onChange={(event) => onChange({ ...draft, title: event.target.value })}
                  placeholder={t("inspirations.search.titlePlaceholder")}
                  size="tall"
                  className="pl-9"
                />
              )}
            </div>
          </label>

          {workspaceSubpage ? (
            <WorkspaceDateTimeRangeField
              idPrefix="inspiration-updated-range"
              value={{ start_date: draft.updated_from, end_date: draft.updated_to }}
              onChange={(range) => onChange({ ...draft, updated_from: range.start_date, updated_to: range.end_date })}
              onQuickRangeChange={onQuickRange}
            />
          ) : (
            <ClassicDateTimeRangeField
              idPrefix="inspiration-updated-range"
              value={{ start_date: draft.updated_from, end_date: draft.updated_to }}
              onChange={(range) => onChange({ ...draft, updated_from: range.start_date, updated_to: range.end_date })}
              onQuickRangeChange={onQuickRange}
            />
          )}

          {isAdmin ? (
            <label className="space-y-2">
              <span className={labelClassName}>{t("inspirations.search.owner")}</span>
              {workspaceSubpage ? (
                <WorkspaceSelectField
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
                  size="default"
                />
              ) : (
                <ClassicSelectField
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
                  size="default"
                />
              )}
            </label>
          ) : null}

          <label className="space-y-2">
            <span className={labelClassName}>{t("inspirations.resourceGroupFilter")}</span>
            {workspaceSubpage ? (
              <WorkspaceSelectField
                id="inspiration-resource-group-filter"
                value={selectedResourceGroupId}
                options={[
                  { value: "", label: t("inspirations.allResourceGroups") },
                  ...resourceGroups.map((group) => ({ value: group.id, label: group.name })),
                ]}
                onChange={onResourceGroupChange}
                ariaLabel={t("inspirations.resourceGroupFilter")}
                disabled={resourceGroupsLoading}
                size="default"
              />
            ) : (
              <ClassicSelectField
                id="inspiration-resource-group-filter"
                value={selectedResourceGroupId}
                options={[
                  { value: "", label: t("inspirations.allResourceGroups") },
                  ...resourceGroups.map((group) => ({ value: group.id, label: group.name })),
                ]}
                onChange={onResourceGroupChange}
                ariaLabel={t("inspirations.resourceGroupFilter")}
                disabled={resourceGroupsLoading}
                size="default"
              />
            )}
          </label>

          {isAdmin ? (
            workspaceSubpage ? (
              <WorkspaceCheckbox
                id="inspiration-only-deleted-filter"
                name="inspiration_only_deleted_filter"
                checked={draft.only_deleted}
                onChange={(event) => onChange({ ...draft, only_deleted: event.target.checked })}
                wrapperClassName="flex h-11 items-center gap-2 self-end rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-[#0f1726] dark:text-slate-200"
              >
                <span className="truncate">{t("inspirations.search.onlyDeleted")}</span>
              </WorkspaceCheckbox>
            ) : (
              <ClassicCheckbox
                id="inspiration-only-deleted-filter"
                name="inspiration_only_deleted_filter"
                checked={draft.only_deleted}
                onChange={(event) => onChange({ ...draft, only_deleted: event.target.checked })}
                wrapperClassName="flex h-11 items-center gap-2 self-end rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm dark:border-slate-700 dark:bg-[#0f1726] dark:text-slate-200"
                controlClassName="mt-0"
              >
                <span className="truncate">{t("inspirations.search.onlyDeleted")}</span>
              </ClassicCheckbox>
            )
          ) : null}
        </div>

        <div className="mt-4 flex shrink-0 justify-end gap-2">
          <PageActionButton type="submit" disabled={fetching} preset="primary" size="lg" leadingIcon={<Search size={16} />}>
            {t("inspirations.search.submit")}
          </PageActionButton>
          <PageActionButton
            onClick={onClear}
            disabled={!active || fetching}
            preset="secondary"
            size="lg"
            leadingIcon={<X size={16} />}
          >
            {t("inspirations.search.clear")}
          </PageActionButton>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          {showSensitiveImageMaskPreference ? (
            workspaceSubpage ? (
              <WorkspaceCheckbox
                id="inspiration-mask-sensitive-images"
                name="inspiration_mask_sensitive_images"
                checked={maskSensitiveImages}
                onChange={(event) => onMaskSensitiveImagesChange(event.target.checked)}
                wrapperClassName="inline-flex min-h-8 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 sm:ml-auto"
              >
                <span>{t("inspirations.maskSensitiveImages")}</span>
              </WorkspaceCheckbox>
            ) : (
              <ClassicCheckbox
                id="inspiration-mask-sensitive-images"
                name="inspiration_mask_sensitive_images"
                checked={maskSensitiveImages}
                onChange={(event) => onMaskSensitiveImagesChange(event.target.checked)}
                wrapperClassName="inline-flex min-h-8 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 sm:ml-auto"
                controlClassName="mt-0"
              >
                <span>{t("inspirations.maskSensitiveImages")}</span>
              </ClassicCheckbox>
            )
          ) : null}
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

function HoverImagePreview({
  imageUrl,
  anchorRect,
  masked,
}: {
  imageUrl: string;
  anchorRect: DOMRect;
  masked: boolean;
}) {
  const { t } = useI18n();
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
      <img
        src={api.toApiUrl(imageUrl)}
        alt=""
        className={sensitiveImageClassName(masked, "h-full w-full rounded-xl object-cover")}
        decoding="async"
      />
      <SensitiveImageOverlay masked={masked} label={t("common.sensitiveImageMasked")} />
    </div>
  );
}

function HoverableImageFrame({
  imageUrl,
  previewUrl,
  alt,
  className,
  iconSize,
  masked = false,
}: {
  imageUrl: string | null;
  previewUrl?: string | null;
  alt: string;
  className: string;
  iconSize: number;
  masked?: boolean;
}) {
  const { t } = useI18n();
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
      className={`${className} relative`}
      onPointerEnter={showPreview}
      onPointerLeave={hidePreview}
      onPointerCancel={hidePreview}
    >
      {shouldShowImage && imageUrl ? (
        <img
          src={api.toApiUrl(imageUrl)}
          alt={alt}
          className={sensitiveImageClassName(masked, "h-full w-full object-cover")}
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
      {shouldShowImage ? (
        <SensitiveImageOverlay masked={masked} label={t("common.sensitiveImageMasked")} />
      ) : null}
      {shouldShowImage && hoverPreviewUrl && anchorRect ? (
        <HoverImagePreview imageUrl={hoverPreviewUrl} anchorRect={anchorRect} masked={masked} />
      ) : null}
    </div>
  );
}

function InspirationKeyInfoCell({
  inspiration,
  compact = false,
  maskSensitiveImages,
}: {
  inspiration: InspirationSummary;
  compact?: boolean;
  maskSensitiveImages: boolean;
}) {
  const { t } = useI18n();
  const info = inspirationKeyInfo(inspiration);
  const masked = shouldMaskSensitiveImage(maskSensitiveImages, inspiration.resource_group);

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
          masked={masked}
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

function InspirationThumbnail({
  inspiration,
  compact = false,
  maskSensitiveImages,
}: {
  inspiration: InspirationSummary;
  compact?: boolean;
  maskSensitiveImages: boolean;
}) {
  const thumbUrl = inspirationMainThumbnailUrl(inspiration);
  const previewUrl = inspiration.latest_generated_image_preview_url ?? inspiration.latest_generated_image_thumbnail_url;
  const masked = shouldMaskSensitiveImage(maskSensitiveImages, inspiration.resource_group);

  return (
    <HoverableImageFrame
      imageUrl={thumbUrl}
      previewUrl={previewUrl}
      alt={inspiration.name}
      iconSize={18}
      masked={masked}
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
  workspaceSubpage = false,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  disabled: boolean;
  floating?: boolean;
  workspaceSubpage?: boolean;
}) {
  const { t } = useI18n();
  const PageActionButton = inspirationActionButtonComponent(workspaceSubpage);
  const pageInputId = useId();
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
      <PageActionButton
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={disabled || page <= 1}
        preset="secondary"
        size="md"
        leadingIcon={<ArrowLeft size={13} aria-hidden="true" />}
      >
        {t("pagination.previous")}
      </PageActionButton>
      <label className="flex items-center gap-1.5 px-1 text-xs tabular-nums text-zinc-500 dark:text-slate-400">
        <span className="sr-only">{t("pagination.pageInput")}</span>
        {workspaceSubpage ? (
          <WorkspaceTextInput
            id={pageInputId}
            name="inspiration_page"
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
            size="compact"
            className="h-8 w-11 px-1.5 text-center text-xs font-semibold tabular-nums xl:h-7"
            aria-label={t("pagination.pageInput")}
          />
        ) : (
          <ClassicTextInput
            id={pageInputId}
            name="inspiration_page"
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
            size="compact"
            className="w-11 px-1.5 text-center font-semibold tabular-nums disabled:opacity-50 xl:h-7"
            aria-label={t("pagination.pageInput")}
          />
        )}
        <span>/</span>
        <span>{totalPages}</span>
      </label>
      <PageActionButton
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        disabled={disabled || page >= totalPages}
        preset="secondary"
        size="md"
        trailingIcon={<ArrowRight size={13} aria-hidden="true" />}
      >
        {t("pagination.next")}
      </PageActionButton>
    </div>
  );
}
