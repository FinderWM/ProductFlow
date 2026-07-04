import { AlertTriangle, CheckCircle2, Loader2, RotateCcw, XCircle } from "lucide-react";

import { actionButtonClassNameForAppearance, type LayoutActionAppearance } from "./layoutActionButtons";
import type { TranslationKey } from "../lib/i18n";
import { useEnhanceJob } from "../lib/hooks/useEnhanceJob";
import { useI18n } from "../lib/preferences";
import type { EnhanceJob, JobStatus } from "../lib/types";

interface EnhanceJobProgressProps {
  appearance: LayoutActionAppearance;
  jobId?: string | null;
  job?: EnhanceJob | null;
  onRetry?: (job: EnhanceJob) => void;
  compact?: boolean;
}

const STATUS_CONFIG: Record<
  JobStatus,
  { labelKey: TranslationKey; icon: typeof Loader2; className: string; barClassName: string }
> = {
  queued: {
    labelKey: "enhance.status.queued",
    icon: Loader2,
    className: "pf-hairline pf-surface-soft pf-ink-muted dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)] dark:text-[color:var(--pf-muted)]",
    barClassName: "bg-[color:var(--pf-border-soft)] dark:bg-[color:var(--pf-border-soft)]",
  },
  running: {
    labelKey: "enhance.status.running",
    icon: Loader2,
    className: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/35 dark:bg-blue-500/10 dark:text-blue-100",
    barClassName: "bg-blue-600 dark:bg-blue-300",
  },
  succeeded: {
    labelKey: "enhance.status.succeeded",
    icon: CheckCircle2,
    className:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/10 dark:text-emerald-100",
    barClassName: "bg-emerald-600 dark:bg-emerald-300",
  },
  failed: {
    labelKey: "enhance.status.failed",
    icon: AlertTriangle,
    className: "border-red-200 bg-red-50 text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-100",
    barClassName: "bg-red-600 dark:bg-red-300",
  },
  cancelled: {
    labelKey: "enhance.status.cancelled",
    icon: XCircle,
    className:
      "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-100",
    barClassName: "bg-amber-600 dark:bg-amber-300",
  },
};

export function EnhanceJobProgress({
  appearance,
  jobId,
  job: providedJob,
  onRetry,
  compact = false,
}: EnhanceJobProgressProps) {
  const { t } = useI18n();
  const jobQuery = useEnhanceJob(jobId, { enabled: !providedJob });
  const job = providedJob ?? jobQuery.data ?? null;

  if (!job) {
    return (
      <div className="flex items-center gap-2 text-sm pf-ink-muted dark:text-[color:var(--pf-muted)]">
        <Loader2 size={16} className="animate-spin" />
        {t("enhance.progress.loading")}
      </div>
    );
  }

  const config = STATUS_CONFIG[job.status];
  const Icon = config.icon;
  const total = Math.max(1, job.progress_total || 1);
  const completed = Math.min(total, Math.max(0, job.progress_completed || 0));
  const pct = job.status === "succeeded" ? 100 : Math.round((completed / total) * 100);
  const failed = job.status === "failed" || job.status === "cancelled";
  const retryActionClassName = actionButtonClassNameForAppearance(appearance, { preset: "secondary", size: "sm" });

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold ${config.className}`}>
          <Icon size={14} className={job.status === "queued" || job.status === "running" ? "animate-spin" : undefined} />
          {t(config.labelKey)}
        </span>
        <span className="text-xs font-medium pf-ink-muted dark:text-[color:var(--pf-muted)]">
          {t("enhance.progress.count", { completed, total, percent: pct })}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full pf-surface-soft dark:bg-[color:var(--pf-deep)]">
        <div className={`h-full rounded-full transition-all ${config.barClassName}`} style={{ width: `${pct}%` }} />
      </div>
      {job.last_error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-100">
          {job.last_error}
        </div>
      ) : null}
      {failed && onRetry ? (
        <button
          type="button"
          onClick={() => onRetry(job)}
          className={retryActionClassName}
        >
          <RotateCcw size={14} />
          {t("enhance.action.retry")}
        </button>
      ) : null}
    </div>
  );
}
