import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Download,
  Eye,
  Image as ImageIcon,
  Loader2,
  Play,
  RefreshCw,
  Save,
  Sparkles,
  X,
} from "lucide-react";
import { useSearchParams } from "react-router-dom";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { ClassicCheckbox, ClassicOptionToggle, ClassicSelectField } from "../components/classicInputs";
import { EnhanceJobProgress } from "../components/EnhanceJobProgress";
import { GalleryImagePreviewDialog } from "../components/GalleryImagePreviewDialog";
import { ImageSizePicker } from "../components/ImageSizePicker";
import { LayoutActionSurfaceButton } from "../components/LayoutActionSurfaceButton";
import { renderActionButtonInner } from "../components/actionButtonShared";
import {
  actionButtonClassNameForAppearance,
  actionButtonComponentForAppearance,
  type LayoutActionAppearance,
} from "../components/layoutActionButtons";
import { AsyncContent, AsyncErrorState, AsyncPausedState } from "../components/loading/AsyncContent";
import { SkeletonRows } from "../components/loading/Skeleton";
import { ResourceLibraryModal } from "../components/resource-library/ResourceLibraryModal";
import { TopNav } from "../components/TopNav";
import {
  WorkspaceCheckbox,
  WorkspaceOptionToggle,
  WorkspaceSelectField,
} from "../components/workspaceInputs";
import { api, ApiError } from "../lib/api";
import { asyncViewStateFromQuery } from "../lib/asyncViewState";
import { compositeEnhanceTiles, enhanceTileCallCount, estimateEnhanceTileCallCount } from "../lib/enhanceCompositor";
import { formatDateTime } from "../lib/format";
import { generationConfigOptionsForPurpose, generationConfigSelectionMaxDimension } from "../lib/generationConfigs";
import type { TranslationKey } from "../lib/i18n";
import { buildImageSizeOptions, imageSizeValueFromDimensions, parseImageSizeValue } from "../lib/imageSizes";
import { useI18n } from "../lib/preferences";
import { activeGenerationResourceGroupsInApiOrder, firstActiveGenerationResourceGroupId } from "../lib/resourceGroups";
import type { CreateEnhanceJobInput, EnhanceJob, EnhanceStrategy, JobStatus, ResourceLibraryAsset } from "../lib/types";
import { useUiLayoutScheme } from "../lib/uiLayoutSchemePreference";

const TILED_SCALES = [2, 3, 4] as const;
const ACTIVE_STATUSES = new Set(["queued", "running"]);
const PAGE_SIZE = 20;
const STATUS_FILTERS = ["all", "queued", "running", "succeeded", "failed", "cancelled"] as const;
const ENHANCE_FINAL_MAX_EDGE = 16_384;
const ENHANCE_FINAL_MAX_PIXELS = 120_000_000;

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
  const { activeScheme } = useUiLayoutScheme();
  const queryClient = useQueryClient();
  const workspaceSubpage = activeScheme === "workspace";
  const enhanceActionAppearance: LayoutActionAppearance = workspaceSubpage ? "workspace" : "classic";
  const ActionButton = actionButtonComponentForAppearance(enhanceActionAppearance);
  const enhanceDownloadActionClass = actionButtonClassNameForAppearance(enhanceActionAppearance, {
    preset: "secondary",
    size: "md",
  });
  const LayoutCheckbox = workspaceSubpage ? WorkspaceCheckbox : ClassicCheckbox;
  const LayoutOptionToggle = workspaceSubpage ? WorkspaceOptionToggle : ClassicOptionToggle;
  const LayoutSelectField = workspaceSubpage ? WorkspaceSelectField : ClassicSelectField;
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedJobId = searchParams.get("job");
  const [resourceModalOpen, setResourceModalOpen] = useState(false);
  const [sourceAsset, setSourceAsset] = useState<ResourceLibraryAsset | null>(null);
  const [strategy, setStrategy] = useState<EnhanceStrategy>("direct");
  const [directWidth, setDirectWidth] = useState("2048");
  const [directHeight, setDirectHeight] = useState("2048");
  const [tiledScale, setTiledScale] = useState<(typeof TILED_SCALES)[number]>(2);
  const [autoSaveToLibrary, setAutoSaveToLibrary] = useState(true);
  const [selectedResourceGroupId, setSelectedResourceGroupId] = useState<string>("");
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
  const generationResourceGroupsQuery = useQuery({
    queryKey: ["my-generation-resource-groups"],
    queryFn: api.listMyGenerationResourceGroups,
  });
  const generationConfigOptionsQuery = useQuery({
    queryKey: ["generation-config-options"],
    queryFn: api.listGenerationConfigOptions,
  });
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
  const jobsViewState = asyncViewStateFromQuery({
    active: true,
    data: jobsQuery.data,
    dataUpdatedAt: jobsQuery.dataUpdatedAt,
    isSuccess: jobsQuery.isSuccess,
    isError: jobsQuery.isError,
    fetchStatus: jobsQuery.fetchStatus,
    isEmpty: (data) => data.items.length === 0,
  });
  const totalJobs = jobsQuery.data?.total ?? jobs.length;
  const totalPages = Math.max(1, Math.ceil(totalJobs / PAGE_SIZE));
  const selectedJob = selectedJobQuery.data ?? jobs.find((job) => job.id === selectedJobId) ?? jobs[0] ?? null;
  const globalMaxDimension = runtimeQuery.data?.image_generation_max_dimension ?? 4096;
  const resourceGroups = activeGenerationResourceGroupsInApiOrder(generationResourceGroupsQuery.data);
  const selectedResourceGroup = resourceGroups.find((group) => group.id === selectedResourceGroupId) ?? null;
  const imageGenerationConfigOptions = generationConfigOptionsForPurpose(
    generationConfigOptionsQuery.data ?? [],
    "image",
    selectedResourceGroupId || null,
  );
  const maxDimension = generationConfigSelectionMaxDimension({
    mode: "auto",
    generationConfigId: null,
    resourceGroupId: selectedResourceGroupId || null,
    resourceGroupMaxDimension: selectedResourceGroup?.image_max_dimension,
    options: imageGenerationConfigOptions,
    globalMaxDimension,
  });
  const directSizeOptions = useMemo(() => buildImageSizeOptions(maxDimension), [maxDimension]);
  const directSizeValue = imageSizeValueFromDimensions(directWidth, directHeight, maxDimension) ?? "";
  const directSize = parseImageSizeValue(directSizeValue, maxDimension);
  const directSizeInvalid = directSize === null;
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
  const tiledFinalTooLarge = Boolean(
    sourceImageSize &&
      (sourceImageSize.width * tiledScale > ENHANCE_FINAL_MAX_EDGE ||
        sourceImageSize.height * tiledScale > ENHANCE_FINAL_MAX_EDGE ||
        sourceImageSize.width * tiledScale * sourceImageSize.height * tiledScale > ENHANCE_FINAL_MAX_PIXELS),
  );

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
    if (!generationResourceGroupsQuery.isFetched) {
      return;
    }
    if (!resourceGroups.length) {
      if (selectedResourceGroupId) {
        setSelectedResourceGroupId("");
      }
      return;
    }
    if (!selectedResourceGroupId || !resourceGroups.some((group) => group.id === selectedResourceGroupId)) {
      setSelectedResourceGroupId(firstActiveGenerationResourceGroupId(resourceGroups));
    }
  }, [generationResourceGroupsQuery.isFetched, resourceGroups, selectedResourceGroupId]);

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
    if (!selectedResourceGroupId) {
      setLocalError(t("enhance.error.resourceGroupRequired"));
      return;
    }
    if (strategy === "tiled" && tiledFinalTooLarge) {
      setLocalError(t("enhance.error.finalSizeTooLarge"));
      return;
    }
    let params: Record<string, unknown>;
    if (strategy === "direct") {
      if (!directSize) {
        setLocalError(t("enhance.error.invalidSize"));
        return;
      }
      params = { target_width: directSize.width, target_height: directSize.height };
    } else {
      params = { scale: tiledScale, tile_base_size: tiledTileBaseSize, overlap_pct: 10 };
    }
    createMutation.mutate({
      source_kind: "resource_library_asset",
      source_ref: sourceAsset.id,
      strategy,
      params,
      resource_group_id: selectedResourceGroupId,
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
    <div className="min-h-screen pf-surface-soft pf-ink dark:bg-[#060a12] dark:text-[color:var(--pf-muted)]">
      <TopNav />
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 pb-10 pt-24 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-2 border-b pf-hairline pb-4 dark:border-[color:var(--pf-border)]">
          <div className="flex items-center gap-2 text-xl font-semibold">
            <Sparkles size={20} className="text-indigo-600 dark:text-violet-300" />
            <h1>{t("enhance.title")}</h1>
          </div>
          <p className="max-w-3xl text-sm leading-6 pf-ink-muted dark:text-[color:var(--pf-muted)]">{t("enhance.subtitle")}</p>
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
          <section className="rounded-xl border pf-hairline pf-surface p-4 shadow-sm dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)]">
            <h2 className="text-sm font-semibold pf-ink dark:text-[#fff]">{t("enhance.sourceImage")}</h2>
            <div className="mt-3 overflow-hidden rounded-lg border pf-hairline pf-surface-soft dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)]">
              {sourcePreviewUrl ? (
                <img src={sourcePreviewUrl} alt="" className="aspect-video w-full object-cover" />
              ) : (
                <div className="flex aspect-video items-center justify-center pf-ink-muted">
                  <ImageIcon size={30} />
                </div>
              )}
            </div>
            <div className="mt-3 min-h-10 text-sm pf-ink-muted dark:text-[color:var(--pf-muted)]">
              {sourceAsset ? sourceAsset.original_filename : t("enhance.noSource")}
            </div>
            <ActionButton
              onClick={() => setResourceModalOpen(true)}
              preset="secondary"
              size="md"
              fullWidth
              className="mt-3"
              leadingIcon={<ImageIcon size={16} />}
            >
              {sourceAsset ? t("enhance.changeSource") : t("enhance.selectSource")}
            </ActionButton>

            <div className="mt-5 space-y-3">
              <div>
                <div className="mb-2 text-sm font-semibold pf-ink dark:text-[#fff]">{t("enhance.resourceGroup")}</div>
                <LayoutSelectField
                  value={selectedResourceGroupId}
                  options={[
                    {
                      value: "",
                      label: resourceGroups.length ? t("enhance.selectResourceGroup") : t("enhance.noResourceGroups"),
                      disabled: true,
                    },
                    ...resourceGroups.map((group) => ({
                      value: group.id,
                      label: group.name,
                    })),
                  ]}
                  onChange={setSelectedResourceGroupId}
                  ariaLabel={t("enhance.resourceGroup")}
                  size="compact"
                />
              </div>
              <div className="text-sm font-semibold pf-ink dark:text-[#fff]">{t("enhance.strategy")}</div>
              <div className="grid grid-cols-2 gap-2">
                {(["direct", "tiled"] as EnhanceStrategy[]).map((item) => (
                  <LayoutOptionToggle
                    key={item}
                    checked={strategy === item}
                    layout="card"
                    selectionMode="single"
                    name="enhance-strategy"
                    className="w-full items-center px-3 py-2 text-left text-sm font-semibold"
                    onChange={(checked) => {
                      if (checked) {
                        setStrategy(item);
                      }
                    }}
                  >
                    {t(item === "direct" ? "enhance.strategy.direct" : "enhance.strategy.tiled")}
                  </LayoutOptionToggle>
                ))}
              </div>
              <p className="text-xs leading-5 pf-ink-muted dark:text-[color:var(--pf-muted)]">
                {t(strategy === "direct" ? "enhance.strategy.directHelp" : "enhance.strategy.tiledHelp")}
              </p>
            </div>

            {strategy === "direct" ? (
              <div className="mt-5 space-y-3">
                <div className="text-sm font-semibold pf-ink dark:text-[#fff]">{t("enhance.directSize")}</div>
                <ImageSizePicker
                  value={directSizeValue}
                  presets={directSizeOptions}
                  maxDimension={maxDimension}
                  appearance={workspaceSubpage ? "workspace" : "classic"}
                  onChange={(value) => {
                    const parsed = parseImageSizeValue(value, maxDimension);
                    if (!parsed) {
                      return;
                    }
                    setDirectWidth(String(parsed.width));
                    setDirectHeight(String(parsed.height));
                    setLocalError("");
                  }}
                />
              </div>
            ) : (
              <div className="mt-5 space-y-3">
                <div className="text-sm font-semibold pf-ink dark:text-[#fff]">{t("enhance.tiledScale")}</div>
                  <div className="grid grid-cols-3 gap-2">
                    {TILED_SCALES.map((scale) => (
                    <LayoutOptionToggle
                      key={scale}
                      checked={tiledScale === scale}
                      selectionMode="single"
                      name="enhance-tiled-scale"
                      className="h-9 w-full justify-center text-xs font-semibold"
                      onChange={(checked) => {
                        if (checked) {
                          setTiledScale(scale);
                        }
                      }}
                    >
                      {scale}x
                    </LayoutOptionToggle>
                  ))}
                </div>
                {estimatedTileCalls ? <p className="text-xs pf-ink-muted dark:text-[color:var(--pf-muted)]">{estimatedTileCalls}</p> : null}
              </div>
            )}

            <LayoutCheckbox
              checked={autoSaveToLibrary}
              onChange={(event) => setAutoSaveToLibrary(event.target.checked)}
              wrapperClassName="mt-5 text-sm pf-ink-muted dark:text-[color:var(--pf-muted)]"
            >
              {t("enhance.autoSaveToLibrary")}
            </LayoutCheckbox>

            <ActionButton
              onClick={submitJob}
              disabled={
                createMutation.isPending ||
                !sourceAsset ||
                !selectedResourceGroupId ||
                (strategy === "direct" && directSizeInvalid) ||
                (strategy === "tiled" && tiledFinalTooLarge)
              }
              loading={createMutation.isPending}
              preset="primary"
              size="lg"
              fullWidth
              className="mt-5"
              leadingIcon={<Play size={16} />}
            >
              {createMutation.isPending ? t("enhance.submitting") : t("enhance.submit")}
            </ActionButton>
          </section>

          <div className="grid min-h-[680px] gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(420px,1.05fr)]">
            <section className="rounded-xl border pf-hairline pf-surface p-4 shadow-sm dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)]">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold pf-ink dark:text-[#fff]">{t("enhance.jobs")}</h2>
                <ActionButton
                  onClick={() => jobsQuery.refetch()}
                  preset="secondary"
                  size="sm"
                  leadingIcon={<RefreshCw size={14} />}
                >
                  {t("enhance.refresh")}
                </ActionButton>
              </div>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {STATUS_FILTERS.map((item) => {
                  const active = statusFilter === item;
                  const label =
                    item === "all" ? t("enhance.filter.all") : t(enhanceStatusLabelKey(item as JobStatus));
                  return (
                    <ActionButton
                      key={item}
                      onClick={() => {
                        setStatusFilter(item);
                        setPageIndex(0);
                      }}
                      aria-pressed={active}
                      preset="secondary"
                      size="sm"
                    >
                      {label}
                    </ActionButton>
                  );
                })}
              </div>
              <AsyncContent
                state={jobsViewState}
                refreshIntent="silent-poll"
                loadingLabel={t("enhance.progress.loading")}
                skeleton={<SkeletonRows count={5} />}
                initialError={(
                  <AsyncErrorState
                    title={t("enhance.error.loadFailed")}
                    retryLabel={t("common.retry")}
                    retryingLabel={t("app.loading")}
                    retrying={jobsViewState.fetch === "fetching"}
                    onRetry={() => void jobsQuery.refetch()}
                  />
                )}
                paused={(
                  <AsyncPausedState
                    title={t("app.requestPaused.title")}
                    message={t("app.requestPaused.message")}
                    retryLabel={t("common.retry")}
                    onRetry={() => void jobsQuery.refetch()}
                  />
                )}
                inactive={null}
                empty={(
                  <div className="flex min-h-40 items-center justify-center text-sm pf-ink-muted dark:text-[color:var(--pf-muted)]">
                    {t("enhance.emptyJobs")}
                  </div>
                )}
                refreshFeedback={jobsViewState.error === "refresh" ? (
                  <AsyncErrorState
                    className="pf-async-error mt-3 rounded-xl border px-4 py-3 text-sm"
                    title={t("enhance.error.loadFailed")}
                    retryLabel={t("common.retry")}
                    retryingLabel={t("app.loading")}
                    retrying={jobsViewState.fetch === "fetching"}
                    onRetry={() => void jobsQuery.refetch()}
                  />
                ) : jobsViewState.fetch === "paused" ? (
                  <AsyncPausedState
                    className="pf-async-paused mt-3 rounded-xl border px-4 py-3 text-sm"
                    title={t("app.requestPaused.title")}
                    message={t("app.requestPaused.message")}
                    retryLabel={t("common.retry")}
                    onRetry={() => void jobsQuery.refetch()}
                  />
                ) : null}
              >
                <div className="space-y-2">
                  {jobs.map((job) => (
                    <LayoutActionSurfaceButton
                      key={job.id}
                      type="button"
                      appearance={enhanceActionAppearance}
                      preset="secondary"
                      onClick={() => setSearchParams({ job: job.id })}
                      className={`block w-full p-3 text-left ${
                        selectedJob?.id === job.id
                          ? "border-indigo-300 bg-indigo-50/60 dark:border-violet-400/45 dark:bg-violet-500/10"
                          : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold pf-ink dark:text-[#fff]">
                          {t(job.strategy === "direct" ? "enhance.strategy.direct" : "enhance.strategy.tiled")}
                        </span>
                        <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${jobStatusClass(job)}`}>
                          {t(enhanceStatusLabelKey(job.status))}
                        </span>
                      </div>
                      <div className="mt-2 text-xs pf-ink-muted dark:text-[color:var(--pf-muted)]">
                        {job.source_width}x{job.source_height} · {formatDateTime(job.created_at)}
                      </div>
                    </LayoutActionSurfaceButton>
                  ))}
                </div>
              </AsyncContent>
              <div className="mt-3 flex items-center justify-between gap-2 border-t pf-hairline pt-3 text-xs pf-ink-muted dark:border-[color:var(--pf-border)] dark:text-[color:var(--pf-muted)]">
                <span>{t("enhance.paginationSummary", { page: pageIndex + 1, totalPages, total: totalJobs })}</span>
                <div className="flex gap-1.5">
                  <ActionButton
                    onClick={() => setPageIndex((page) => Math.max(0, page - 1))}
                    disabled={pageIndex <= 0 || jobsQuery.isFetching}
                    preset="secondary"
                    size="sm"
                  >
                    {t("pagination.previous")}
                  </ActionButton>
                  <ActionButton
                    onClick={() => setPageIndex((page) => page + 1)}
                    disabled={pageIndex + 1 >= totalPages || jobsQuery.isFetching}
                    preset="secondary"
                    size="sm"
                  >
                    {t("pagination.next")}
                  </ActionButton>
                </div>
              </div>
            </section>

            <section className="rounded-xl border pf-hairline pf-surface p-4 shadow-sm dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)]">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold pf-ink dark:text-[#fff]">{t("enhance.detail")}</h2>
                {selectedJob && isActiveJob(selectedJob) ? (
                  <ActionButton
                    onClick={() => setCancelJob(selectedJob)}
                    preset="danger"
                    size="sm"
                    leadingIcon={<X size={14} />}
                  >
                    {t("enhance.cancel")}
                  </ActionButton>
                ) : null}
              </div>
              {selectedJob ? (
                <div className="space-y-4">
                  <EnhanceJobProgress appearance={enhanceActionAppearance} job={selectedJob} onRetry={retryJob} />
                  <div className="grid grid-cols-2 gap-2 text-xs pf-ink-muted dark:text-[color:var(--pf-muted)]">
                    <div>{t("enhance.createdAt")}: {formatDateTime(selectedJob.created_at)}</div>
                    <div>{t("enhance.updatedAt")}: {formatDateTime(selectedJob.updated_at)}</div>
                    <div>{t("enhance.size")}: {selectedJob.source_width}x{selectedJob.source_height}</div>
                    <div>{selectedCallCount ? t("enhance.tileCalls", { count: selectedCallCount }) : ""}</div>
                  </div>

                  <div>
                    <div className="mb-2 text-sm font-semibold pf-ink dark:text-[#fff]">{t("enhance.preview")}</div>
                    <div className="overflow-hidden rounded-lg border pf-hairline pf-surface-soft dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)]">
                      {finalUrl ? (
                        <img src={finalUrl} alt="" className="max-h-[520px] w-full object-contain" />
                      ) : (
                        <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 text-sm pf-ink-muted dark:text-[color:var(--pf-muted)]">
                          {compositingJobId === selectedJob.id ? <Loader2 size={22} className="animate-spin" /> : <ImageIcon size={28} />}
                          {compositingJobId === selectedJob.id ? t("enhance.compositing") : t("enhance.previewPending")}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {finalUrl ? (
                      <>
                        <ActionButton
                          onClick={() => setPreviewUrl(finalUrl)}
                          preset="secondary"
                          size="md"
                          leadingIcon={<Eye size={16} />}
                        >
                          {t("enhance.openFinal")}
                        </ActionButton>
                        <a
                          href={finalUrl}
                          download
                          className={enhanceDownloadActionClass}
                        >
                          {renderActionButtonInner({
                            leadingIcon: <Download size={16} />,
                            label: t("enhance.downloadFinal"),
                          })}
                        </a>
                        <ActionButton
                          onClick={() => saveMutation.mutate(selectedJob.id)}
                          disabled={saveMutation.isPending || savedJobIds.has(selectedJob.id)}
                          loading={saveMutation.isPending && !savedJobIds.has(selectedJob.id)}
                          preset="primary"
                          size="md"
                          leadingIcon={savedJobIds.has(selectedJob.id) ? <Check size={16} /> : <Save size={16} />}
                        >
                          {savedJobIds.has(selectedJob.id) ? t("enhance.savedToLibrary") : t("enhance.saveToLibrary")}
                        </ActionButton>
                      </>
                    ) : selectedJob.status === "succeeded" && selectedJob.result_manifest?.final_status === "pending_upload" ? (
                      <ActionButton
                        onClick={() => {
                          setProcessedFinalJobIds((previous) => {
                            const next = new Set(previous);
                            next.delete(selectedJob.id);
                            return next;
                          });
                        }}
                        disabled={compositingJobId === selectedJob.id}
                        loading={compositingJobId === selectedJob.id}
                        preset="secondary"
                        size="md"
                        leadingIcon={<RefreshCw size={16} />}
                      >
                        {t("enhance.uploadFinal")}
                      </ActionButton>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="flex min-h-80 items-center justify-center text-sm pf-ink-muted dark:text-[color:var(--pf-muted)]">
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
        appearance={workspaceSubpage ? "workspace" : "classic"}
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
        appearance={enhanceActionAppearance}
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
          appearance={enhanceActionAppearance}
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
