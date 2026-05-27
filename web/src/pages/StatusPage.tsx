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
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { TopNav } from "../components/TopNav";
import { api, ApiError } from "../lib/api";
import { formatDateTime } from "../lib/format";
import type { TranslationKey } from "../lib/i18n";
import type { GenerationConfigStatAggregate, GenerationConfigStatusConfig } from "../lib/types";
import { useI18n } from "../lib/preferences";

type QuickRangeId = "today" | "last7" | "last30" | "month";

interface StatusDateRange {
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
  "rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-200/60 " +
  "dark:border-slate-800 dark:bg-[#0f1726] dark:shadow-black/25";

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

function quickDateRange(id: QuickRangeId): StatusDateRange {
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

function ConfigStatusRow({ config }: { config: GenerationConfigStatusConfig }) {
  const { t } = useI18n();
  const activeFrozen = isActiveFrozenUntil(config.state?.frozen_until);
  const statusText = activeFrozen && config.state?.frozen_until
    ? t("statusPage.table.frozenUntil", { time: formatDateTime(config.state.frozen_until) })
    : config.enabled
      ? t("settings.generation.healthy")
      : t("settings.provider.disabled");
  const failureText = config.state?.last_failure_reason ?? statusText;

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
        <div className="truncate text-xs text-slate-500 dark:text-slate-400">{failureText}</div>
      </div>
    </div>
  );
}

export function StatusPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [range, setRange] = useState<StatusDateRange>(() => quickDateRange("today"));
  const [activeQuickRange, setActiveQuickRange] = useState<QuickRangeId | null>("today");
  const rangeInvalid = range.start_date > range.end_date;

  const statusQuery = useQuery({
    queryKey: ["generation-config-status", range.start_date, range.end_date],
    queryFn: () => api.getGenerationConfigStatus(range),
    enabled: !rangeInvalid,
    retry: false,
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
  const configs = useMemo(() => summary?.configs ?? [], [summary]);
  const todaySplit = t("statusPage.todaySplit", {
    text: summary?.today_text_attempt_count ?? 0,
    image: summary?.today_image_attempt_count ?? 0,
  });

  return (
    <div className="flex min-h-screen flex-col bg-white dark:bg-[#060a12] dark:text-slate-100">
      <TopNav
        breadcrumbs={t("statusPage.breadcrumb")}
        onHome={() => navigate("/products")}
        onLogout={() => logoutMutation.mutate()}
      />
      <main className="mx-auto w-full max-w-[1440px] flex-1 px-5 py-8 pb-24 sm:px-8 lg:px-10 lg:py-10">
        <div className="mb-8">
          <div>
            <div className="mb-2 inline-flex items-center rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700 dark:border-violet-400/35 dark:bg-violet-500/15 dark:text-violet-100">
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
                    onClick={() => void statusQuery.refetch()}
                    disabled={statusQuery.isFetching || rangeInvalid}
                    className={PRIMARY_BUTTON_CLASS}
                  >
                    {statusQuery.isFetching ? (
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

            {statusQuery.isLoading ? (
              <div className="flex justify-center py-20 text-zinc-400 dark:text-slate-500">
                <Loader2 size={22} className="animate-spin" />
              </div>
            ) : statusQuery.isError ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200">
                {statusQuery.error instanceof ApiError ? statusQuery.error.detail : t("statusPage.loadFailed")}
              </div>
            ) : null}

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

            <section className={`${PANEL_CLASS} overflow-hidden`}>
              <div className="flex flex-col gap-2 border-b border-slate-100 px-5 py-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold text-slate-950 dark:text-white">
                    {t("settings.generation.statusTitle")}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {t("statusPage.tableDescription", {
                      start: summary?.start_date ?? range.start_date,
                      end: summary?.end_date ?? range.end_date,
                    })}
                  </p>
                </div>
                {statusQuery.isFetching ? (
                  <span className="inline-flex items-center text-xs font-semibold text-slate-500 dark:text-slate-400">
                    <Loader2 size={13} className="mr-1.5 animate-spin" />
                    {t("app.loading")}
                  </span>
                ) : null}
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {configs.length ? (
                  configs.map((config) => <ConfigStatusRow key={config.id} config={config} />)
                ) : (
                  <div className="px-5 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                    <CheckCircle2 size={22} className="mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                    {t("settings.generation.emptyStatus")}
                  </div>
                )}
              </div>
            </section>
        </div>
      </main>
    </div>
  );
}
