import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  CalendarDays,
  CheckCircle2,
  Image,
  Loader2,
  LockKeyhole,
  MessageSquareText,
  RefreshCw,
  Search,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { ClassicTextInput } from "../components/classicInputs";
import { actionButtonComponentForAppearance } from "../components/layoutActionButtons";
import { AsyncContent, AsyncErrorState, AsyncPausedState } from "../components/loading/AsyncContent";
import { SkeletonMetrics, SkeletonRows } from "../components/loading/Skeleton";
import { TopNav } from "../components/TopNav";
import {
  ClassicDateTimeRangeField,
  WorkspaceDateTimeRangeField,
  dateRangeFromDateTimeRange,
  workspaceQuickDateTimeRange,
  type WorkspaceDateTimeRange,
  type WorkspaceQuickRangeId,
} from "../components/WorkspaceDateTimeRangeField";
import { WorkspaceTextInput } from "../components/workspaceInputs";
import { api, ApiError } from "../lib/api";
import { asyncViewStateFromQuery } from "../lib/asyncViewState";
import { formatDateTime } from "../lib/format";
import type { GenerationConfigStatAggregate, GenerationConfigStatusConfig } from "../lib/types";
import { useI18n } from "../lib/preferences";
import { useUiLayoutScheme } from "../lib/uiLayoutSchemePreference";

const PANEL_CLASS =
  "pf-panel";

function successRate(stat: GenerationConfigStatAggregate | null | undefined): string {
  if (!stat || stat.attempt_count <= 0) {
    return "0%";
  }
  return `${Math.round((stat.success_count / stat.attempt_count) * 100)}%`;
}

function isActiveFrozenUntil(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > Date.now();
}

function purposeClassName(purpose: string): string {
  return purpose === "text"
    ? "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/35 dark:bg-sky-500/12 dark:text-sky-200"
    : "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 dark:border-fuchsia-400/35 dark:bg-fuchsia-500/12 dark:text-fuchsia-100";
}

function statusClassName(config: GenerationConfigStatusConfig): string {
  if (isActiveFrozenUntil(config.state?.frozen_until)) {
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/35 dark:bg-amber-500/12 dark:text-amber-200";
  }
  if (!config.enabled) {
    return "border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300";
  }
  return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/12 dark:text-emerald-200";
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: number;
  detail?: string;
  icon: LucideIcon;
}) {
  return (
    <div className={`${PANEL_CLASS} pf-metric-card p-4`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-violet-500/15 dark:text-violet-200">
          <Icon size={15} />
        </span>
      </div>
      <div className="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">{value}</div>
      {detail ? <div className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{detail}</div> : null}
    </div>
  );
}

function ConfigStatusRow({ config }: { config: GenerationConfigStatusConfig }) {
  const { t } = useI18n();
  const activeFrozen = isActiveFrozenUntil(config.state?.frozen_until);
  const frozenUntilText = activeFrozen && config.state?.frozen_until
    ? t("statusPage.table.frozenUntil", { time: formatDateTime(config.state.frozen_until) })
    : null;
  const statusText = activeFrozen
    ? t("settings.generation.frozen")
    : config.enabled
      ? t("settings.generation.healthy")
      : t("settings.provider.disabled");
  const detailText = frozenUntilText ?? config.state?.last_failure_reason ?? statusText;
  const secondaryText = frozenUntilText ? config.state?.last_failure_reason : null;

  return (
    <div className="grid gap-3 px-5 py-4 text-sm md:grid-cols-[1.35fr_0.75fr_0.8fr_0.9fr_1fr]">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="truncate font-semibold text-slate-950 dark:text-white">{config.name}</div>
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${purposeClassName(config.purpose)}`}>
            {config.purpose === "text" ? t("statusPage.purpose.text") : t("statusPage.purpose.image")}
          </span>
        </div>
        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {config.provider_kind} · {t("settings.generation.priority")} {config.priority}
        </div>
      </div>
      <div className="text-slate-600 dark:text-slate-300">
        <div className="text-xs text-slate-500 dark:text-slate-400">{t("statusPage.table.concurrency")}</div>
        <div className="mt-1 font-semibold">
          {config.state?.current_concurrency ?? 0}/{config.max_concurrency}
        </div>
      </div>
      <div className="text-slate-600 dark:text-slate-300">
        <div className="text-xs text-slate-500 dark:text-slate-400">{t("statusPage.table.rangeCalls")}</div>
        <div className="mt-1 font-semibold">{config.range_stat.attempt_count}</div>
      </div>
      <div className="text-slate-600 dark:text-slate-300">
        <div className="text-xs text-slate-500 dark:text-slate-400">{t("statusPage.table.successRate")}</div>
        <div className="mt-1 font-semibold">{successRate(config.range_stat)}</div>
      </div>
      <div className="min-w-0 text-slate-600 dark:text-slate-300">
        <div className="mb-1 flex items-center gap-2">
          <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusClassName(config)}`}>
            {statusText}
          </span>
        </div>
        <div className="truncate text-xs text-slate-500 dark:text-slate-400">{detailText}</div>
        {secondaryText ? (
          <div className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{secondaryText}</div>
        ) : null}
      </div>
    </div>
  );
}

interface StatusPageProps {
  mode?: "auto" | "detail";
}

export function StatusPage({ mode = "auto" }: StatusPageProps = {}) {
  const { t } = useI18n();
  const { activeScheme } = useUiLayoutScheme();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [range, setRange] = useState<WorkspaceDateTimeRange>(() => workspaceQuickDateTimeRange("today"));
  const [appliedRange, setAppliedRange] = useState<WorkspaceDateTimeRange>(range);
  const [activeQuickRange, setActiveQuickRange] = useState<WorkspaceQuickRangeId | null>("today");
  const [configSearch, setConfigSearch] = useState("");
  const [userRefreshing, setUserRefreshing] = useState(false);
  const rangeInvalid = Boolean(range.start_date && range.end_date && range.start_date > range.end_date);
  const appliedRangeInvalid = Boolean(
    appliedRange.start_date && appliedRange.end_date && appliedRange.start_date > appliedRange.end_date,
  );
  const apiRange = dateRangeFromDateTimeRange(appliedRange);

  const statusQuery = useQuery({
    queryKey: ["generation-config-status", apiRange.start_date, apiRange.end_date],
    queryFn: () => api.getGenerationConfigStatus(apiRange),
    enabled: !appliedRangeInvalid,
    retry: false,
  });
  const statusViewState = asyncViewStateFromQuery({
    active: !appliedRangeInvalid,
    data: statusQuery.data,
    dataUpdatedAt: statusQuery.dataUpdatedAt,
    isSuccess: statusQuery.isSuccess,
    isError: statusQuery.isError,
    fetchStatus: statusQuery.fetchStatus,
    isEmpty: () => false,
  });

  const logoutMutation = useMutation({
    mutationFn: api.destroySession,
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: ["generation-config-status"] });
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      navigate("/login", { replace: true });
    },
  });

  const summary = statusQuery.data;
  const normalizedConfigSearch = configSearch.trim().toLowerCase();
  const configs = useMemo(() => {
    const source = summary?.configs ?? [];
    if (!normalizedConfigSearch) {
      return source;
    }
    return source.filter((config) => config.name.toLowerCase().includes(normalizedConfigSearch));
  }, [normalizedConfigSearch, summary]);
  const todaySplit = t("statusPage.todaySplit", {
    text: summary?.today_text_attempt_count ?? 0,
    image: summary?.today_image_attempt_count ?? 0,
  });
  const isWorkspaceSubpage = activeScheme === "workspace" && mode === "detail";
  const PageActionButton = actionButtonComponentForAppearance(isWorkspaceSubpage ? "workspace" : "classic");
  const refetchStatus = () => {
    setUserRefreshing(true);
    void statusQuery.refetch().finally(() => setUserRefreshing(false));
  };
  const refreshStatus = () => {
    if (range.start_date === appliedRange.start_date && range.end_date === appliedRange.end_date) {
      refetchStatus();
      return;
    }
    setUserRefreshing(false);
    setAppliedRange(range);
  };

  return (
    <div className={`${isWorkspaceSubpage ? "pf-workspace" : "pf-app"} flex flex-col`}>
      <TopNav
        breadcrumbs={t("statusPage.breadcrumb")}
        onHome={() => navigate("/inspirations")}
        onLogout={() => logoutMutation.mutate()}
      />
      <main className={isWorkspaceSubpage ? "pf-workspace-subpage flex-1" : "pf-page pf-page-wide flex-1"}>
        <div className={isWorkspaceSubpage ? "pf-workspace-subpage-frame-shell" : "contents"}>
          <div className={isWorkspaceSubpage ? "pf-workspace-subpage-frame" : "contents"}>
        <div className="pf-page-header">
          <div>
            <div className="pf-eyebrow mb-2 gap-1.5">
              <Activity size={13} className="mr-1.5" />
              {t("statusPage.eyebrow")}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
              {t("statusPage.title")}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400">
              {t("statusPage.description")}
            </p>
          </div>
        </div>

        <div className="space-y-5">
          <section className={`${PANEL_CLASS} p-5`}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              {isWorkspaceSubpage ? (
                <WorkspaceDateTimeRangeField
                  idPrefix="status-page-range"
                  value={range}
                  activeQuickRange={activeQuickRange}
                  onChange={(nextRange) => {
                    setRange(nextRange);
                    setActiveQuickRange(null);
                  }}
                  onQuickRangeChange={(id) => {
                    setRange(workspaceQuickDateTimeRange(id));
                    setActiveQuickRange(id);
                  }}
                  className="w-full lg:max-w-2xl"
                />
              ) : (
                <ClassicDateTimeRangeField
                  idPrefix="status-page-range"
                  value={range}
                  activeQuickRange={activeQuickRange}
                  onChange={(nextRange) => {
                    setRange(nextRange);
                    setActiveQuickRange(null);
                  }}
                  onQuickRangeChange={(id) => {
                    setRange(workspaceQuickDateTimeRange(id));
                    setActiveQuickRange(id);
                  }}
                  className="w-full lg:max-w-2xl"
                />
              )}
              <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-end">
                  <PageActionButton
                    onClick={refreshStatus}
                    disabled={rangeInvalid}
                    loading={userRefreshing && statusQuery.isFetching}
                    preset="primary"
                    size="md"
                    className="shrink-0"
                    leadingIcon={<RefreshCw size={14} />}
                  >
                    {t("statusPage.refresh")}
                  </PageActionButton>
                </div>
              </div>
              {rangeInvalid ? (
                <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200">
                  {t("statusPage.invalidRange")}
                </div>
              ) : null}
            </section>

            <AsyncContent
              state={statusViewState}
              refreshIntent={userRefreshing ? "user-refresh" : "parameter-change"}
              className="flex flex-col gap-5"
              loadingLabel={t("app.loading")}
              skeleton={(
                <div className="space-y-5">
                  <SkeletonMetrics count={6} className="xl:grid-cols-6" />
                  <section className={`${PANEL_CLASS} px-5`}>
                    <SkeletonRows count={6} />
                  </section>
                </div>
              )}
              initialError={(
                <AsyncErrorState
                  title={statusQuery.error instanceof ApiError ? statusQuery.error.detail : t("statusPage.loadFailed")}
                  retryLabel={t("common.retry")}
                  retryingLabel={t("app.loading")}
                  retrying={statusQuery.isFetching}
                  onRetry={() => {
                    void statusQuery.refetch();
                  }}
                />
              )}
              paused={(
                <AsyncPausedState
                  title={t("app.requestPaused.title")}
                  message={t("app.requestPaused.message")}
                  retryLabel={t("common.retry")}
                  onRetry={() => {
                    void statusQuery.refetch();
                  }}
                />
              )}
              empty={null}
              refreshFeedback={statusViewState.error === "refresh" ? (
                <AsyncErrorState
                  className="order-first rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-100"
                  title={statusQuery.error instanceof ApiError ? statusQuery.error.detail : t("statusPage.loadFailed")}
                  retryLabel={t("common.retry")}
                  retryingLabel={t("app.loading")}
                  retrying={statusQuery.isFetching}
                  onRetry={refetchStatus}
                />
              ) : null}
            >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              <MetricCard
                label={t("statusPage.metric.todayTotal")}
                value={summary?.today_attempt_count ?? 0}
                detail={todaySplit}
                icon={Activity}
              />
              <MetricCard
                label={t("statusPage.metric.todayText")}
                value={summary?.today_text_attempt_count ?? 0}
                icon={MessageSquareText}
              />
              <MetricCard
                label={t("statusPage.metric.todayImage")}
                value={summary?.today_image_attempt_count ?? 0}
                icon={Image}
              />
              <MetricCard
                label={t("statusPage.metric.rangeTotal")}
                value={summary?.range_attempt_count ?? 0}
                detail={t("statusPage.rangeSuccessFailure", {
                  success: summary?.range_success_count ?? 0,
                  failure: summary?.range_failure_count ?? 0,
                })}
                icon={CalendarDays}
              />
              <MetricCard
                label={t("settings.generation.runningConfigs")}
                value={summary?.running_count ?? 0}
                icon={RefreshCw}
              />
              <MetricCard
                label={t("settings.generation.frozenConfigs")}
                value={summary?.frozen_count ?? 0}
                icon={LockKeyhole}
              />
            </div>

            <section className={`${PANEL_CLASS} pf-governed-list-panel overflow-hidden`}>
              <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-base font-semibold text-slate-950 dark:text-white">
                    {t("settings.generation.statusTitle")}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {t("statusPage.tableDescription", {
                      start: summary?.start_date ?? apiRange.start_date,
                      end: summary?.end_date ?? apiRange.end_date,
                    })}
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                  <label className="relative min-w-0 sm:w-64">
                    <span className="sr-only">{t("statusPage.configSearch")}</span>
                    <Search
                      size={15}
                      className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />
                    {isWorkspaceSubpage ? (
                      <WorkspaceTextInput
                        type="search"
                        value={configSearch}
                        onChange={(event) => setConfigSearch(event.target.value)}
                        placeholder={t("statusPage.configSearchPlaceholder")}
                        className="pl-9"
                      />
                    ) : (
                      <ClassicTextInput
                        type="search"
                        value={configSearch}
                        onChange={(event) => setConfigSearch(event.target.value)}
                        placeholder={t("statusPage.configSearchPlaceholder")}
                        className="pl-9"
                      />
                    )}
                  </label>
                  {userRefreshing && statusQuery.isFetching ? (
                    <span className="inline-flex items-center text-xs font-semibold text-slate-500 dark:text-slate-400">
                      <Loader2 size={13} className="mr-1.5 animate-spin" />
                      {t("app.loading")}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="pf-gradient-divide">
                {configs.length ? (
                  configs.map((config) => <ConfigStatusRow key={config.id} config={config} />)
                ) : (
                  <div className="px-5 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                    <CheckCircle2 size={22} className="mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                    {normalizedConfigSearch ? t("statusPage.configSearchEmpty") : t("settings.generation.emptyStatus")}
                  </div>
                )}
              </div>
            </section>
            </AsyncContent>
        </div>
          </div>
        </div>
      </main>
    </div>
  );
}
