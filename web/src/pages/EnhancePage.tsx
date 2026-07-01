import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Download,
  Eye,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Play,
  RefreshCw,
  Save,
  Sparkles,
  X,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { EnhanceJobProgress } from "../components/EnhanceJobProgress";
import { GalleryImagePreviewDialog } from "../components/GalleryImagePreviewDialog";
import { ResourceLibraryModal } from "../components/resource-library/ResourceLibraryModal";
import { TopNav } from "../components/TopNav";
import { api, ApiError } from "../lib/api";
import { compositeEnhanceTiles, enhanceTileCallCount, estimateEnhanceTileCallCount } from "../lib/enhanceCompositor";
import { formatDateTime } from "../lib/format";
import type { TranslationKey } from "../lib/i18n";
import { useI18n } from "../lib/preferences";
import type { CreateEnhanceJobInput, EnhanceJob, EnhanceStrategy, JobStatus, ResourceLibraryAsset } from "../lib/types";

const DIRECT_SIZE_PRESETS = [1024, 2048, 2560, 3072, 4096] as const;
const TILED_SCALES = [2, 3, 4] as const;
const ACTIVE_STATUSES = new Set(["queued", "running"]);
const PAGE_SIZE = 20;
const STATUS_FILTERS = ["all", "queued", "running", "succeeded", "failed", "cancelled"] as const;

type EnhanceStatusFilter = (typeof STATUS_FILTERS)[number];

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.detail : fallback;
}

function isActiveJob(job: EnhanceJob): boolean {
  return ACTIVE_STATUSES.has(job.status);
}

function jobStatusClass(job: EnhanceJob): string {
  if (job.status === "succeeded") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/10 dark:text-emerald-100";
  }
  if (job.status === "failed") {
    return "border-red-200 bg-red-50 text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-100";
  }
  if (job.status === "cancelled") {
    return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-100";
  }
  return "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/35 dark:bg-blue-500/10 dark:text-blue-100";
}

function enhanceStatusLabelKey(status: EnhanceJob["status"]): TranslationKey {
  switch (status) {
    case "queued":
      return "enhance.status.queued";
    case "running":
      return "enhance.status.running";
    case "succeeded":
      return "enhance.status.succeeded";
    case "failed":
      return "enhance.status.failed";
    case "cancelled":
      return "enhance.status.cancelled";
  }
}

export function EnhancePage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedJobId = searchParams.get("job");
  const [resourceModalOpen, setResourceModalOpen] = useState(false);
  const [sourceAsset, setSourceAsset] = useState<ResourceLibraryAsset | null>(null);
  const [strategy, setStrategy] = useState<EnhanceStrategy>("direct");
  const [directPreset, setDirectPreset] = useState<number | "custom">(2048);
  const [customWidth, setCustomWidth] = useState("2048");
  const [customHeight, setCustomHeight] = useState("2048");
  const [tiledScale, setTiledScale] = useState<(typeof TILED_SCALES)[number]>(2);
  const [autoSaveToLibrary, setAutoSaveToLibrary] = useState(true);
  const [statusFilter, setStatusFilter] = useState<EnhanceStatusFilter>("all");
  const [pageIndex, setPageIndex] = useState(0);
  const [localError, setLocalError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [cancelJob, setCancelJob] = useState<EnhanceJob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [compositingJobId, setCompositingJobId] = useState<string | null>(null);
  const [processedFinalJobIds, setProcessedFinalJobIds] = useState<Set<string>>(() => new Set());
  const [savedJobIds, setSavedJobIds] = useState<Set<string>>(() => new Set());
  const [sourceImageSize, setSourceImageSize] = useState<{ width: number; height: number } | null>(null);

  const runtimeQuery = useQuery({ queryKey: ["runtime-config"], queryFn: api.getRuntimeConfig });
  const statusQueryValue: JobStatus | null = statusFilter === "all" ? null : statusFilter;
  const pageOffset = pageIndex * PAGE_SIZE;
  const jobsQuery = useQuery({
    queryKey: ["enhance-jobs", statusQueryValue, pageOffset],
    queryFn: () => api.listEnhanceJobs({ limit: PAGE_SIZE, offset: pageOffset, status: statusQueryValue }),
    refetchInterval: (query) => (query.state.data?.items.some(isActiveJob) ? 1500 : false),
  });
  const selectedJobQuery = useQuery({
    queryKey: ["enhance-job", selectedJobId],
    queryFn: () => api.getEnhanceJob(selectedJobId ?? ""),
    enabled: Boolean(selectedJobId),
    refetchInterval: (query) => (query.state.data && !isActiveJob(query.state.data) ? false : 1500),
  });

  const jobs = jobsQuery.data?.items ?? [];
  const totalJobs = jobsQuery.data?.total ?? jobs.length;
  const totalPages = Math.max(1, Math.ceil(totalJobs / PAGE_SIZE));
  const selectedJob = selectedJobQuery.data ?? jobs.find((job) => job.id === selectedJobId) ?? jobs[0] ?? null;
  const maxDimension = runtimeQuery.data?.image_generation_max_dimension ?? 4096;
  const directWidth = directPreset === "custom" ? Number.parseInt(customWidth, 10) : directPreset;
  const directHeight = directPreset === "custom" ? Number.parseInt(customHeight, 10) : directPreset;
  const directSizeInvalid = !Number.isFinite(directWidth) || !Number.isFinite(directHeight) || directWidth <= 0 || directHeight <= 0;
  const directSizeTooLarge = directWidth > maxDimension || directHeight > maxDimension;
  const selectedCallCount = selectedJob?.result_manifest ? enhanceTileCallCount(selectedJob.result_manifest) : null;
  const tiledTileBaseSize = Math.min(1024, maxDimension);
  const estimatedTileCallCount = sourceImageSize
    ? estimateEnhanceTileCallCount({
        sourceWidth: sourceImageSize.width,
        sourceHeight: sourceImageSize.height,
        scale: tiledScale,
        tileBaseSize: tiledTileBaseSize,
      })
    : null;
  const estimatedTileCalls = sourceAsset
    ? t("enhance.tileCalls", { count: estimatedTileCallCount ?? t("common.unknown") })
    : "";

  const createMutation = useMutation({
    mutationFn: (input: CreateEnhanceJobInput) => api.createEnhanceJob(input),
    onSuccess: async (job) => {
      setLocalError("");
      setFeedback("");
      setSearchParams({ job: job.id });
      await queryClient.invalidateQueries({ queryKey: ["enhance-jobs"] });
    },
    onError: (error) => setLocalError(errorMessage(error, t("enhance.error.submitFailed"))),
  });
  const cancelMutation = useMutation({
    mutationFn: (jobId: string) => api.cancelEnhanceJob(jobId),
    onSuccess: async (job) => {
      setCancelJob(null);
      queryClient.setQueryData(["enhance-job", job.id], job);
      await queryClient.invalidateQueries({ queryKey: ["enhance-jobs"] });
    },
    onError: (error) => setLocalError(errorMessage(error, t("enhance.cancelFailed"))),
  });
  const uploadFinalMutation = useMutation({
    mutationFn: ({ jobId, blob }: { jobId: string; blob: Blob }) => api.uploadEnhanceJobFinal(jobId, blob),
    onSuccess: async (job) => {
      queryClient.setQueryData(["enhance-job", job.id], job);
      await queryClient.invalidateQueries({ queryKey: ["enhance-jobs"] });
    },
  });
  const saveMutation = useMutation({
    mutationFn: (jobId: string) => api.saveEnhanceJobToLibrary(jobId),
    onSuccess: (_asset, jobId) => {
      setSavedJobIds((previous) => new Set(previous).add(jobId));
      setFeedback(t("enhance.savedToLibrary"));
    },
    onError: (error) => setLocalError(errorMessage(error, t("enhance.saveFailed"))),
  });

  useEffect(() => {
    if (!sourceAsset) {
      setSourceImageSize(null);
      return;
    }
    let cancelled = false;
    setSourceImageSize(null);
    const image = new Image();
    image.onload = () => {
      if (!cancelled && image.naturalWidth > 0 && image.naturalHeight > 0) {
        setSourceImageSize({ width: image.naturalWidth, height: image.naturalHeight });
      }
    };
    image.onerror = () => {
      if (!cancelled) {
        setSourceImageSize(null);
      }
    };
    image.src = api.toApiUrl(sourceAsset.download_url);
    return () => {
      cancelled = true;
    };
  }, [sourceAsset]);

  useEffect(() => {
    if (!selectedJob || selectedJob.strategy !== "tiled" || selectedJob.status !== "succeeded") {
      return;
    }
    if (!selectedJob.result_manifest || selectedJob.result_manifest.final_status === "ready") {
      return;
    }
    if (processedFinalJobIds.has(selectedJob.id) || compositingJobId === selectedJob.id) {
      return;
    }
    setProcessedFinalJobIds((previous) => new Set(previous).add(selectedJob.id));
    setCompositingJobId(selectedJob.id);
    void compositeEnhanceTiles(selectedJob.result_manifest)
      .then((blob) => uploadFinalMutation.mutateAsync({ jobId: selectedJob.id, blob }))
      .then((job) => {
        if (autoSaveToLibrary) {
          saveMutation.mutate(job.id);
        }
      })
      .catch((error) => setLocalError(errorMessage(error, t("enhance.compositeFailed"))))
      .finally(() => setCompositingJobId(null));
  }, [autoSaveToLibrary, compositingJobId, processedFinalJobIds, saveMutation, selectedJob, t, uploadFinalMutation]);

  useEffect(() => {
    if (!selectedJob || selectedJob.status !== "succeeded" || !selectedJob.result_manifest?.final_download_url) {
      return;
    }
    if (autoSaveToLibrary && !savedJobIds.has(selectedJob.id)) {
      setSavedJobIds((previous) => new Set(previous).add(selectedJob.id));
      saveMutation.mutate(selectedJob.id);
    }
  }, [autoSaveToLibrary, saveMutation, savedJobIds, selectedJob]);

  function submitJob() {
    if (!sourceAsset) {
      setLocalError(t("enhance.error.selectSource"));
      return;
    }
    if (strategy === "direct" && directSizeInvalid) {
      setLocalError(t("enhance.error.invalidSize"));
      return;
    }
    if (strategy === "direct" && directSizeTooLarge) {
      setLocalError(t("enhance.error.sizeTooLarge"));
      return;
    }
    const params =
      strategy === "direct"
        ? { target_width: directWidth, target_height: directHeight }
        : { scale: tiledScale, tile_base_size: tiledTileBaseSize, overlap_pct: 10 };
    createMutation.mutate({
      source_kind: "resource_library_asset",
      source_ref: sourceAsset.id,
      strategy,
      params,
      generation_config_mode: "auto",
    });
  }

  function retryJob(job: EnhanceJob) {
    createMutation.mutate({
      source_kind: job.source_kind,
      source_ref: job.source_ref,
      strategy: job.strategy,
      params: job.params,
      resource_group_id: job.resource_group_id,
      generation_config_mode: job.generation_config_mode,
      generation_config_id: job.requested_generation_config_id,
    });
  }

  const finalUrl = selectedJob?.result_manifest?.final_download_url
    ? api.toApiUrl(selectedJob.result_manifest.final_download_url)
    : null;
  const sourcePreviewUrl = sourceAsset ? api.toApiUrl(sourceAsset.preview_url || sourceAsset.thumbnail_url) : null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950 dark:bg-[#060a12] dark:text-slate-100">
      <TopNav />
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 pb-10 pt-24 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-2 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div className="flex items-center gap-2 text-xl font-semibold">
            <Sparkles size={20} className="text-indigo-600 dark:text-violet-300" />
            <h1>{t("enhance.title")}</h1>
          </div>
          <p className="max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">{t("enhance.subtitle")}</p>
        </header>

        {localError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-100">
            {localError}
          </div>
        ) : null}
        {feedback ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/10 dark:text-emerald-100">
            {feedback}
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/50">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{t("enhance.sourceImage")}</h2>
            <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60">
              {sourcePreviewUrl ? (
                <img src={sourcePreviewUrl} alt="" className="aspect-video w-full object-cover" />
              ) : (
                <div className="flex aspect-video items-center justify-center text-slate-400">
                  <ImageIcon size={30} />
                </div>
              )}
            </div>
            <div className="mt-3 min-h-10 text-sm text-slate-600 dark:text-slate-300">
              {sourceAsset ? sourceAsset.original_filename : t("enhance.noSource")}
            </div>
            <button
              type="button"
              onClick={() => setResourceModalOpen(true)}
              className="pf-workspace-action-secondary mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold transition-all active:scale-[0.98]"
            >
              <ImageIcon size={16} />
              {sourceAsset ? t("enhance.changeSource") : t("enhance.selectSource")}
            </button>

            <div className="mt-5 space-y-3">
              <div className="text-sm font-semibold text-slate-900 dark:text-white">{t("enhance.strategy")}</div>
              <div className="grid grid-cols-2 gap-2">
                {(["direct", "tiled"] as EnhanceStrategy[]).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setStrategy(item)}
                    className={`rounded-lg border px-3 py-2 text-left text-sm font-semibold transition ${
                      strategy === item
                        ? "border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-violet-400/45 dark:bg-violet-500/15 dark:text-violet-100"
                        : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                    }`}
                  >
                    {t(item === "direct" ? "enhance.strategy.direct" : "enhance.strategy.tiled")}
                  </button>
                ))}
              </div>
              <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
                {t(strategy === "direct" ? "enhance.strategy.directHelp" : "enhance.strategy.tiledHelp")}
              </p>
            </div>

            {strategy === "direct" ? (
              <div className="mt-5 space-y-3">
                <div className="text-sm font-semibold text-slate-900 dark:text-white">{t("enhance.directSize")}</div>
                <div className="grid grid-cols-3 gap-2">
                  {DIRECT_SIZE_PRESETS.map((size) => {
                    const disabled = size > maxDimension;
                    return (
                      <button
                        key={size}
                        type="button"
                        disabled={disabled}
                        onClick={() => setDirectPreset(size)}
                        className={`h-9 rounded-lg border text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-45 ${
                          directPreset === size
                            ? "border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-violet-400/45 dark:bg-violet-500/15 dark:text-violet-100"
                            : "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                        }`}
                      >
                        {size}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setDirectPreset("custom")}
                    className={`h-9 rounded-lg border text-xs font-semibold ${
                      directPreset === "custom"
                        ? "border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-violet-400/45 dark:bg-violet-500/15 dark:text-violet-100"
                        : "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                    }`}
                  >
                    <Maximize2 size={13} className="mx-auto" />
                  </button>
                </div>
                {directPreset === "custom" ? (
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                      {t("enhance.customWidth")}
                      <input
                        value={customWidth}
                        onChange={(event) => setCustomWidth(event.target.value)}
                        className="pf-input-compact mt-1 w-full"
                        inputMode="numeric"
                      />
                    </label>
                    <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                      {t("enhance.customHeight")}
                      <input
                        value={customHeight}
                        onChange={(event) => setCustomHeight(event.target.value)}
                        className="pf-input-compact mt-1 w-full"
                        inputMode="numeric"
                      />
                    </label>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                <div className="text-sm font-semibold text-slate-900 dark:text-white">{t("enhance.tiledScale")}</div>
                <div className="grid grid-cols-3 gap-2">
                  {TILED_SCALES.map((scale) => (
                    <button
                      key={scale}
                      type="button"
                      onClick={() => setTiledScale(scale)}
                      className={`h-9 rounded-lg border text-xs font-semibold ${
                        tiledScale === scale
                          ? "border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-violet-400/45 dark:bg-violet-500/15 dark:text-violet-100"
                          : "border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                      }`}
                    >
                      {scale}x
                    </button>
                  ))}
                </div>
                {estimatedTileCalls ? <p className="text-xs text-slate-500 dark:text-slate-400">{estimatedTileCalls}</p> : null}
              </div>
            )}

            <label className="mt-5 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={autoSaveToLibrary}
                onChange={(event) => setAutoSaveToLibrary(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              {t("enhance.autoSaveToLibrary")}
            </label>

            <button
              type="button"
              onClick={submitJob}
              disabled={createMutation.isPending || !sourceAsset || (strategy === "direct" && (directSizeInvalid || directSizeTooLarge))}
              className="pf-workspace-action-primary mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {createMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
              {createMutation.isPending ? t("enhance.submitting") : t("enhance.submit")}
            </button>
          </section>

          <div className="grid min-h-[680px] gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(420px,1.05fr)]">
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/50">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{t("enhance.jobs")}</h2>
                <button
                  type="button"
                  onClick={() => jobsQuery.refetch()}
                  className="pf-workspace-action-secondary inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold"
                >
                  <RefreshCw size={14} />
                  {t("enhance.refresh")}
                </button>
              </div>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {STATUS_FILTERS.map((item) => {
                  const active = statusFilter === item;
                  const label =
                    item === "all" ? t("enhance.filter.all") : t(enhanceStatusLabelKey(item as JobStatus));
                  return (
                    <button
                      key={item}
                      type="button"
                      onClick={() => {
                        setStatusFilter(item);
                        setPageIndex(0);
                      }}
                      className={`h-8 rounded-lg border px-2.5 text-xs font-semibold transition ${
                        active
                          ? "border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-violet-400/45 dark:bg-violet-500/15 dark:text-violet-100"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              {jobsQuery.isLoading ? (
                <div className="flex min-h-40 items-center justify-center text-slate-400">
                  <Loader2 size={22} className="animate-spin" />
                </div>
              ) : jobsQuery.isError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-100">
                  {t("enhance.error.loadFailed")}
                </div>
              ) : jobs.length ? (
                <div className="space-y-2">
                  {jobs.map((job) => (
                    <button
                      key={job.id}
                      type="button"
                      onClick={() => setSearchParams({ job: job.id })}
                      className={`block w-full rounded-lg border p-3 text-left transition hover:bg-slate-50 dark:hover:bg-slate-900/70 ${
                        selectedJob?.id === job.id
                          ? "border-indigo-300 bg-indigo-50/60 dark:border-violet-400/45 dark:bg-violet-500/10"
                          : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950/40"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-slate-900 dark:text-white">
                          {t(job.strategy === "direct" ? "enhance.strategy.direct" : "enhance.strategy.tiled")}
                        </span>
                        <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${jobStatusClass(job)}`}>
                          {t(enhanceStatusLabelKey(job.status))}
                        </span>
                      </div>
                      <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        {job.source_width}x{job.source_height} · {formatDateTime(job.created_at)}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-40 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
                  {t("enhance.emptyJobs")}
                </div>
              )}
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <span>{t("enhance.paginationSummary", { page: pageIndex + 1, totalPages, total: totalJobs })}</span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPageIndex((page) => Math.max(0, page - 1))}
                    disabled={pageIndex <= 0 || jobsQuery.isFetching}
                    className="pf-workspace-action-secondary inline-flex h-8 items-center rounded-lg border px-2.5 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t("pagination.previous")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPageIndex((page) => page + 1)}
                    disabled={pageIndex + 1 >= totalPages || jobsQuery.isFetching}
                    className="pf-workspace-action-secondary inline-flex h-8 items-center rounded-lg border px-2.5 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t("pagination.next")}
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/50">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{t("enhance.detail")}</h2>
                {selectedJob && isActiveJob(selectedJob) ? (
                  <button
                    type="button"
                    onClick={() => setCancelJob(selectedJob)}
                    className="pf-danger-action inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold"
                  >
                    <X size={14} />
                    {t("enhance.cancel")}
                  </button>
                ) : null}
              </div>
              {selectedJob ? (
                <div className="space-y-4">
                  <EnhanceJobProgress job={selectedJob} onRetry={retryJob} />
                  <div className="grid grid-cols-2 gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <div>{t("enhance.createdAt")}: {formatDateTime(selectedJob.created_at)}</div>
                    <div>{t("enhance.updatedAt")}: {formatDateTime(selectedJob.updated_at)}</div>
                    <div>{t("enhance.size")}: {selectedJob.source_width}x{selectedJob.source_height}</div>
                    <div>{selectedCallCount ? t("enhance.tileCalls", { count: selectedCallCount }) : ""}</div>
                  </div>

                  <div>
                    <div className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">{t("enhance.preview")}</div>
                    <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/60">
                      {finalUrl ? (
                        <img src={finalUrl} alt="" className="max-h-[520px] w-full object-contain" />
                      ) : (
                        <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                          {compositingJobId === selectedJob.id ? <Loader2 size={22} className="animate-spin" /> : <ImageIcon size={28} />}
                          {compositingJobId === selectedJob.id ? t("enhance.compositing") : t("enhance.previewPending")}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {finalUrl ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setPreviewUrl(finalUrl)}
                          className="pf-workspace-action-secondary inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-semibold"
                        >
                          <Eye size={16} />
                          {t("enhance.openFinal")}
                        </button>
                        <a
                          href={finalUrl}
                          download
                          className="pf-workspace-action-secondary inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-semibold"
                        >
                          <Download size={16} />
                          {t("enhance.downloadFinal")}
                        </a>
                        <button
                          type="button"
                          onClick={() => saveMutation.mutate(selectedJob.id)}
                          disabled={saveMutation.isPending || savedJobIds.has(selectedJob.id)}
                          className="pf-workspace-action-primary inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {savedJobIds.has(selectedJob.id) ? <Check size={16} /> : <Save size={16} />}
                          {savedJobIds.has(selectedJob.id) ? t("enhance.savedToLibrary") : t("enhance.saveToLibrary")}
                        </button>
                      </>
                    ) : selectedJob.status === "succeeded" && selectedJob.result_manifest?.final_status === "pending_upload" ? (
                      <button
                        type="button"
                        onClick={() => {
                          setProcessedFinalJobIds((previous) => {
                            const next = new Set(previous);
                            next.delete(selectedJob.id);
                            return next;
                          });
                        }}
                        disabled={compositingJobId === selectedJob.id}
                        className="pf-workspace-action-secondary inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {compositingJobId === selectedJob.id ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                        {t("enhance.uploadFinal")}
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="flex min-h-80 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
                  {t("enhance.emptyJobs")}
                </div>
              )}
            </section>
          </div>
        </div>
      </main>

      <ResourceLibraryModal
        open={resourceModalOpen}
        onClose={() => setResourceModalOpen(false)}
        canRead
        selectLabel={t("enhance.selectSource")}
        onSelectAsset={(asset) => {
          setSourceAsset(asset);
          setResourceModalOpen(false);
        }}
        isAssetSelectable={(asset) => asset.kind === "image"}
        assetSelectDisabledTitle={t("enhance.resourceLibraryOnlyImages")}
      />
      <ConfirmDialog
        open={Boolean(cancelJob)}
        title={t("enhance.cancelTitle")}
        description={t("enhance.cancelDescription")}
        confirmLabel={t("enhance.cancel")}
        cancelLabel={t("common.cancel")}
        busy={cancelMutation.isPending}
        onConfirm={() => (cancelJob ? cancelMutation.mutate(cancelJob.id) : undefined)}
        onClose={() => setCancelJob(null)}
      />
      {previewUrl ? (
        <GalleryImagePreviewDialog
          ariaLabel={t("enhance.preview")}
          imageUrl={previewUrl}
          imageAlt={t("enhance.preview")}
          title={t("enhance.preview")}
          body={t("enhance.preview")}
          providerNotesTitle={t("enhance.detail")}
          downloadUrl={previewUrl}
          downloadLabel={t("enhance.downloadFinal")}
          closeLabel={t("common.close")}
          onClose={() => setPreviewUrl(null)}
        />
      ) : null}
    </div>
  );
}
