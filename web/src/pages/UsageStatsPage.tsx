import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  CheckCircle2,
  Image,
  Loader2,
  MessageSquareText,
  RefreshCw,
  User,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { TopNav } from "../components/TopNav";
import {
  WorkspaceDateTimeRangeField,
  dateRangeFromDateTimeRange,
  workspaceQuickDateTimeRange,
  type WorkspaceDateTimeRange,
  type WorkspaceQuickRangeId,
} from "../components/WorkspaceDateTimeRangeField";
import { api, ApiError } from "../lib/api";
import { formatDateTime } from "../lib/format";
import { useI18n } from "../lib/preferences";
import { useSessionState } from "../lib/session";
import type { UserUsageStat, UserUsageStatsSummary } from "../lib/types";
import { useUiLayoutScheme } from "../lib/uiLayoutSchemePreference";
import {
  WorkspacePageFrame,
  WorkspaceUsageStatsContent,
} from "./workspace/WorkspaceLandingPages";

const INPUT_CLASS =
  "h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 shadow-sm " +
  "outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15 " +
  "dark:border-slate-700 dark:bg-[#111b2d] dark:text-slate-100 dark:focus:border-violet-400";

const PANEL_CLASS =
  "pf-panel";

const PRIMARY_BUTTON_CLASS =
  "inline-flex h-10 items-center justify-center rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white " +
  "shadow-sm shadow-indigo-500/20 transition hover:bg-indigo-500 disabled:opacity-50 " +
  "dark:bg-violet-500 dark:hover:bg-violet-400";

function successRate(summary: UserUsageStatsSummary | null | undefined): string {
  if (!summary || summary.attempt_count <= 0) {
    return "0%";
  }
  return `${Math.round((summary.success_count / summary.attempt_count) * 100)}%`;
}

function purposeClassName(purpose: string): string {
  return purpose === "text"
    ? "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/35 dark:bg-sky-500/12 dark:text-sky-200"
    : "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 dark:border-fuchsia-400/35 dark:bg-fuchsia-500/12 dark:text-fuchsia-100";
}

function averageLatencyMs(summary: UserUsageStatsSummary | null | undefined): number {
  if (!summary || summary.success_count <= 0) {
    return 0;
  }
  return Math.round(summary.total_latency_ms / summary.success_count);
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string;
  value: number | string;
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

function UsageStatRow({ item, variant = "classic" }: { item: UserUsageStat; variant?: "classic" | "workspace" }) {
  const { t } = useI18n();
  const rate = item.attempt_count > 0 ? `${Math.round((item.success_count / item.attempt_count) * 100)}%` : "0%";
  const isWorkspace = variant === "workspace";
  const rowClassName = "grid gap-3 px-5 py-4 text-sm md:grid-cols-[0.8fr_1fr_0.75fr_0.8fr_0.8fr_1fr]";
  const titleClassName = isWorkspace ? "pf-workspace-title" : "text-slate-950 dark:text-white";
  const primaryClassName = isWorkspace ? "pf-workspace-title" : "text-slate-700 dark:text-slate-200";
  const mutedClassName = isWorkspace ? "pf-workspace-muted" : "text-slate-500 dark:text-slate-400";
  const bodyClassName = isWorkspace ? "pf-workspace-copy" : "text-slate-600 dark:text-slate-300";
  const purposeClasses = isWorkspace
    ? "pf-workspace-chip"
    : purposeClassName(item.purpose);

  return (
    <div className={rowClassName}>
      <div className={`${titleClassName} font-semibold`}>{item.stat_date}</div>
      <div className="min-w-0">
        <div className={`${primaryClassName} truncate font-medium`}>
          {item.display_name || item.username}
        </div>
        <div className={`${mutedClassName} mt-1 truncate text-xs`}>{item.username}</div>
      </div>
      <div>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${purposeClasses}`}>
          {item.purpose === "text" ? t("statusPage.purpose.text") : t("statusPage.purpose.image")}
        </span>
      </div>
      <div className={bodyClassName}>
        <div className={`${mutedClassName} text-xs`}>{t("usageStats.table.calls")}</div>
        <div className="mt-1 font-semibold">{item.attempt_count}</div>
      </div>
      <div className={bodyClassName}>
        <div className={`${mutedClassName} text-xs`}>{t("usageStats.table.successRate")}</div>
        <div className="mt-1 font-semibold">{rate}</div>
      </div>
      <div className={`${bodyClassName} min-w-0`}>
        <div className={`${mutedClassName} text-xs`}>{t("usageStats.table.latest")}</div>
        <div className="mt-1 truncate font-medium">
          {formatDateTime(item.last_success_at ?? item.last_failure_at)}
        </div>
      </div>
    </div>
  );
}

interface UsageStatsPageProps {
  mode?: "auto" | "detail";
}

function UsageStatsWorkspaceLanding() {
  const { t } = useI18n();

  return (
    <WorkspacePageFrame
      eyebrow={t("usageStats.workspace.eyebrow")}
      title={t("usageStats.workspace.title")}
      description={t("usageStats.workspace.description")}
    >
      <WorkspaceUsageStatsContent />
    </WorkspacePageFrame>
  );
}

export function UsageStatsPage({ mode = "auto" }: UsageStatsPageProps) {
  const { activeScheme } = useUiLayoutScheme();

  if (activeScheme === "workspace" && mode !== "detail") {
    return <UsageStatsWorkspaceLanding />;
  }

  return <UsageStatsDetailPage />;
}

function UsageStatsDetailPage() {
  const { t } = useI18n();
  const { activeScheme } = useUiLayoutScheme();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSessionState();
  const isAdmin = Boolean(session?.user?.is_admin);
  const [range, setRange] = useState<WorkspaceDateTimeRange>(() => workspaceQuickDateTimeRange("today"));
  const [activeQuickRange, setActiveQuickRange] = useState<WorkspaceQuickRangeId | null>("today");
  const [selectedUserId, setSelectedUserId] = useState("");
  const rangeInvalid = Boolean(range.start_date && range.end_date && range.start_date > range.end_date);
  const apiRange = dateRangeFromDateTimeRange(range);

  const usageQuery = useQuery({
    queryKey: ["usage-stats", apiRange.start_date, apiRange.end_date, selectedUserId],
    queryFn: () =>
      api.getUsageStats({
        ...apiRange,
        user_id: selectedUserId || undefined,
      }),
    enabled: !rangeInvalid,
    retry: false,
  });

  const logoutMutation = useMutation({
    mutationFn: api.destroySession,
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: ["usage-stats"] });
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      navigate("/login", { replace: true });
    },
  });

  const summary = usageQuery.data?.summary;
  const items = useMemo(() => usageQuery.data?.items ?? [], [usageQuery.data?.items]);
  const users = usageQuery.data?.users ?? [];
  const splitDetail = t("usageStats.metric.split", {
    text: summary?.text_attempt_count ?? 0,
    image: summary?.image_attempt_count ?? 0,
  });
  const isWorkspaceSubpage = activeScheme === "workspace";

  return (
    <div className={`${isWorkspaceSubpage ? "pf-workspace" : "pf-app"} flex flex-col`}>
      <TopNav
        breadcrumbs={t("usageStats.breadcrumb")}
        onHome={() => navigate("/inspirations")}
        onLogout={() => logoutMutation.mutate()}
      />
      <main className={isWorkspaceSubpage ? "pf-workspace-subpage flex-1" : "pf-page pf-page-wide flex-1"}>
        <div className={isWorkspaceSubpage ? "pf-workspace-subpage-frame-shell" : "contents"}>
          <div className={isWorkspaceSubpage ? "pf-workspace-subpage-frame" : "contents"}>
        <div className="pf-page-header">
          <div>
            <div className="pf-eyebrow mb-2 gap-1.5">
              <BarChart3 size={13} className="mr-1.5" />
              {t("usageStats.eyebrow")}
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-950 dark:text-white">
              {t("usageStats.title")}
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400">
              {t("usageStats.description")}
            </p>
          </div>
        </div>

        <div className="space-y-5">
          <section className={`${PANEL_CLASS} p-5`}>
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <WorkspaceDateTimeRangeField
                idPrefix="usage-stats-range"
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
                className="w-full xl:max-w-2xl"
              />
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                {isAdmin ? (
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    {t("usageStats.userFilter")}
                    <select
                      id="usage-stats-user-filter"
                      name="usage_stats_user_filter"
                      value={selectedUserId}
                      onChange={(event) => setSelectedUserId(event.target.value)}
                      className={`${INPUT_CLASS} mt-1 w-full sm:w-48`}
                    >
                      <option value="">{t("usageStats.allUsers")}</option>
                      {users.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.display_name || user.username}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <button
                  type="button"
                  onClick={() => void usageQuery.refetch()}
                  disabled={usageQuery.isFetching || rangeInvalid}
                  className={PRIMARY_BUTTON_CLASS}
                >
                  {usageQuery.isFetching ? (
                    <Loader2 size={14} className="mr-2 animate-spin" />
                  ) : (
                    <RefreshCw size={14} className="mr-2" />
                  )}
                  {t("statusPage.refresh")}
                </button>
              </div>
            </div>
            {rangeInvalid ? (
              <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200">
                {t("statusPage.invalidRange")}
              </div>
            ) : null}
          </section>

          {usageQuery.isError ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200">
              {usageQuery.error instanceof ApiError ? usageQuery.error.detail : t("usageStats.loadFailed")}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <MetricCard
              label={t("usageStats.metric.total")}
              value={summary?.attempt_count ?? 0}
              detail={splitDetail}
              icon={BarChart3}
            />
            <MetricCard
              label={t("usageStats.metric.success")}
              value={summary?.success_count ?? 0}
              detail={t("usageStats.metric.successRate", { rate: successRate(summary) })}
              icon={CheckCircle2}
            />
            <MetricCard
              label={t("usageStats.metric.text")}
              value={summary?.text_attempt_count ?? 0}
              icon={MessageSquareText}
            />
            <MetricCard
              label={t("usageStats.metric.image")}
              value={summary?.image_attempt_count ?? 0}
              icon={Image}
            />
            <MetricCard
              label={t("usageStats.metric.avgLatency")}
              value={`${averageLatencyMs(summary)} ms`}
              icon={RefreshCw}
            />
          </div>

          <section className={`${PANEL_CLASS} pf-governed-list-panel overflow-hidden`}>
            <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-950 dark:text-white">
                  {t("usageStats.table.title")}
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {t("usageStats.table.description", {
                    start: usageQuery.data?.start_date ?? apiRange.start_date,
                    end: usageQuery.data?.end_date ?? apiRange.end_date,
                  })}
                </p>
              </div>
              {usageQuery.isFetching ? (
                <span className="inline-flex items-center text-xs font-semibold text-slate-500 dark:text-slate-400">
                  <Loader2 size={13} className="mr-1.5 animate-spin" />
                  {t("app.loading")}
                </span>
              ) : null}
            </div>
            <div className="pf-gradient-divide">
              {items.length ? (
                items.map((item) => <UsageStatRow key={item.id} item={item} />)
              ) : (
                <div className="px-5 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                  <User size={22} className="mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                  {t("usageStats.empty")}
                </div>
              )}
            </div>
          </section>
        </div>
          </div>
        </div>
      </main>
    </div>
  );
}
