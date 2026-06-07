import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  CalendarDays,
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
import { api, ApiError } from "../lib/api";
import { formatDateTime } from "../lib/format";
import type { TranslationKey } from "../lib/i18n";
import { useI18n } from "../lib/preferences";
import { useSessionState } from "../lib/session";
import type { UserUsageStat, UserUsageStatsSummary } from "../lib/types";

type QuickRangeId = "today" | "last7" | "last30" | "month";

interface UsageDateRange {
  start_date: string;
  end_date: string;
}

const QUICK_RANGE_IDS: QuickRangeId[] = ["today", "last7", "last30", "month"];
const QUICK_RANGE_LABEL_KEYS: Record<QuickRangeId, TranslationKey> = {
  today: "statusPage.quick.today",
  last7: "statusPage.quick.last7",
  last30: "statusPage.quick.last30",
  month: "statusPage.quick.month",
};

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

function quickDateRange(id: QuickRangeId): UsageDateRange {
  const today = shiftedDate(0);
  if (id === "last7") {
    return { start_date: toDateInputValue(shiftedDate(-6)), end_date: toDateInputValue(today) };
  }
  if (id === "last30") {
    return { start_date: toDateInputValue(shiftedDate(-29)), end_date: toDateInputValue(today) };
  }
  if (id === "month") {
    const monthStart = new Date(today);
    monthStart.setDate(1);
    return { start_date: toDateInputValue(monthStart), end_date: toDateInputValue(today) };
  }
  return { start_date: toDateInputValue(today), end_date: toDateInputValue(today) };
}

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
    <div className={`${PANEL_CLASS} p-4`}>
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

function UsageStatRow({ item }: { item: UserUsageStat }) {
  const { t } = useI18n();
  const rate = item.attempt_count > 0 ? `${Math.round((item.success_count / item.attempt_count) * 100)}%` : "0%";
  return (
    <div className="grid gap-3 px-5 py-4 text-sm md:grid-cols-[0.8fr_1fr_0.75fr_0.8fr_0.8fr_1fr]">
      <div className="font-semibold text-slate-950 dark:text-white">{item.stat_date}</div>
      <div className="min-w-0">
        <div className="truncate font-medium text-slate-700 dark:text-slate-200">
          {item.display_name || item.username}
        </div>
        <div className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{item.username}</div>
      </div>
      <div>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${purposeClassName(item.purpose)}`}>
          {item.purpose === "text" ? t("statusPage.purpose.text") : t("statusPage.purpose.image")}
        </span>
      </div>
      <div className="text-slate-600 dark:text-slate-300">
        <div className="text-xs text-slate-500 dark:text-slate-400">{t("usageStats.table.calls")}</div>
        <div className="mt-1 font-semibold">{item.attempt_count}</div>
      </div>
      <div className="text-slate-600 dark:text-slate-300">
        <div className="text-xs text-slate-500 dark:text-slate-400">{t("usageStats.table.successRate")}</div>
        <div className="mt-1 font-semibold">{rate}</div>
      </div>
      <div className="min-w-0 text-slate-600 dark:text-slate-300">
        <div className="text-xs text-slate-500 dark:text-slate-400">{t("usageStats.table.latest")}</div>
        <div className="mt-1 truncate font-medium">
          {formatDateTime(item.last_success_at ?? item.last_failure_at)}
        </div>
      </div>
    </div>
  );
}

export function UsageStatsPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSessionState();
  const isAdmin = Boolean(session?.user?.is_admin);
  const [range, setRange] = useState<UsageDateRange>(() => quickDateRange("today"));
  const [activeQuickRange, setActiveQuickRange] = useState<QuickRangeId | null>("today");
  const [selectedUserId, setSelectedUserId] = useState("");
  const rangeInvalid = range.start_date > range.end_date;

  const usageQuery = useQuery({
    queryKey: ["usage-stats", range.start_date, range.end_date, selectedUserId],
    queryFn: () =>
      api.getUsageStats({
        ...range,
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

  return (
    <div className="pf-app flex flex-col">
      <TopNav
        breadcrumbs={t("usageStats.breadcrumb")}
        onHome={() => navigate("/inspirations")}
        onLogout={() => logoutMutation.mutate()}
      />
      <main className="pf-page pf-page-wide flex-1">
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
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-950 dark:text-white">
                  <CalendarDays size={16} />
                  {t("statusPage.rangeTitle")}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {QUICK_RANGE_IDS.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setRange(quickDateRange(id));
                        setActiveQuickRange(id);
                      }}
                      className={`inline-flex h-9 items-center justify-center rounded-lg border px-3 text-sm font-semibold transition ${
                        activeQuickRange === id
                          ? "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-violet-400/35 dark:bg-violet-500/18 dark:text-violet-100"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-[#111b2d] dark:text-slate-300 dark:hover:bg-slate-800"
                      }`}
                    >
                      {t(QUICK_RANGE_LABEL_KEYS[id])}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                {isAdmin ? (
                  <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                    {t("usageStats.userFilter")}
                    <select
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
                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  {t("statusPage.startDate")}
                  <input
                    type="date"
                    value={range.start_date}
                    onChange={(event) => {
                      setRange((current) => ({ ...current, start_date: event.target.value }));
                      setActiveQuickRange(null);
                    }}
                    className={`${INPUT_CLASS} mt-1 w-full sm:w-40`}
                  />
                </label>
                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  {t("statusPage.endDate")}
                  <input
                    type="date"
                    value={range.end_date}
                    onChange={(event) => {
                      setRange((current) => ({ ...current, end_date: event.target.value }));
                      setActiveQuickRange(null);
                    }}
                    className={`${INPUT_CLASS} mt-1 w-full sm:w-40`}
                  />
                </label>
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

          <section className={`${PANEL_CLASS} overflow-hidden`}>
            <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-950 dark:text-white">
                  {t("usageStats.table.title")}
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {t("usageStats.table.description", {
                    start: usageQuery.data?.start_date ?? range.start_date,
                    end: usageQuery.data?.end_date ?? range.end_date,
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
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
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
      </main>
    </div>
  );
}
