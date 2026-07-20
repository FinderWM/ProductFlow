import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Code2, Download, Eye, FileCode2, RefreshCw, Sparkles } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { ClassicOptionToggle, ClassicSwitch, ClassicTextInput, ClassicTextarea } from "../components/classicInputs";
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
  WorkspaceOptionToggle,
  WorkspaceSwitch,
  WorkspaceTextInput,
  WorkspaceTextarea,
} from "../components/workspaceInputs";
import { api, ApiError } from "../lib/api";
import { asyncViewStateFromQuery } from "../lib/asyncViewState";
import { formatDateTime } from "../lib/format";
import type { TranslationKey } from "../lib/i18n";
import { useI18n } from "../lib/preferences";
import type {
  CreateImageToCodeJobInput,
  ImageToCodeArtifact,
  ImageToCodeDeliveryMode,
  ImageToCodeFidelityMode,
  ImageToCodeJob,
  ImageToCodePageType,
  JobStatus,
  ResourceLibraryAsset,
} from "../lib/types";
import { useUiLayoutScheme } from "../lib/uiLayoutSchemePreference";

const PAGE_SIZE = 20;
const ACTIVE_STATUSES = new Set<JobStatus>(["queued", "running"]);
const STATUS_FILTERS = ["all", "queued", "running", "succeeded", "failed", "cancelled"] as const;
const DELIVERY_MODES = ["static_site", "figma_export", "both"] as const satisfies readonly ImageToCodeDeliveryMode[];
const PAGE_TYPES = ["landing", "marketing", "editorial"] as const satisfies readonly ImageToCodePageType[];
const FIDELITY_MODES = ["balanced", "visual_first", "structure_first"] as const satisfies readonly ImageToCodeFidelityMode[];

type ImageToCodeStatusFilter = (typeof STATUS_FILTERS)[number];

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.detail : fallback;
}

function isActiveJob(job: Pick<ImageToCodeJob, "status">): boolean {
  return ACTIVE_STATUSES.has(job.status);
}

function statusLabelKey(status: JobStatus): TranslationKey {
  switch (status) {
    case "queued":
      return "imageToCode.status.queued";
    case "running":
      return "imageToCode.status.running";
    case "succeeded":
      return "imageToCode.status.succeeded";
    case "failed":
      return "imageToCode.status.failed";
    case "cancelled":
      return "imageToCode.status.cancelled";
  }
}

function statusFilterLabelKey(status: ImageToCodeStatusFilter): TranslationKey {
  switch (status) {
    case "all":
      return "imageToCode.filter.all";
    case "queued":
      return "imageToCode.status.queued";
    case "running":
      return "imageToCode.status.running";
    case "succeeded":
      return "imageToCode.status.succeeded";
    case "failed":
      return "imageToCode.status.failed";
    case "cancelled":
      return "imageToCode.status.cancelled";
  }
}

function deliveryModeLabelKey(mode: ImageToCodeDeliveryMode): TranslationKey {
  switch (mode) {
    case "static_site":
      return "imageToCode.delivery.staticSite";
    case "figma_export":
      return "imageToCode.delivery.figmaExport";
    case "both":
      return "imageToCode.delivery.both";
  }
}

function deliveryModeDescriptionKey(mode: ImageToCodeDeliveryMode): TranslationKey {
  switch (mode) {
    case "static_site":
      return "imageToCode.delivery.staticSiteDescription";
    case "figma_export":
      return "imageToCode.delivery.figmaExportDescription";
    case "both":
      return "imageToCode.delivery.bothDescription";
  }
}

function pageTypeLabelKey(mode: ImageToCodePageType): TranslationKey {
  switch (mode) {
    case "landing":
      return "imageToCode.pageType.landing";
    case "marketing":
      return "imageToCode.pageType.marketing";
    case "editorial":
      return "imageToCode.pageType.editorial";
  }
}

function fidelityModeLabelKey(mode: ImageToCodeFidelityMode): TranslationKey {
  switch (mode) {
    case "balanced":
      return "imageToCode.fidelity.balanced";
    case "visual_first":
      return "imageToCode.fidelity.visualFirst";
    case "structure_first":
      return "imageToCode.fidelity.structureFirst";
  }
}

function statusClassName(status: JobStatus): string {
  if (status === "succeeded") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/10 dark:text-emerald-100";
  }
  if (status === "failed") {
    return "border-red-200 bg-red-50 text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-100";
  }
  if (status === "cancelled") {
    return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-100";
  }
  return "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-400/35 dark:bg-blue-500/10 dark:text-blue-100";
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }
  const units = ["KB", "MB", "GB"];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function artifactPriority(artifact: ImageToCodeArtifact): number {
  switch (artifact.type) {
    case "site_zip":
      return 0;
    case "figma_import_zip":
      return 1;
    case "site_index_html":
      return 2;
    case "layers_manifest":
      return 3;
    case "delivery_report_md":
      return 4;
    case "delivery_report_json":
      return 5;
    case "figma_layer_spec":
      return 6;
    case "figma_readme":
      return 7;
    case "preview_image":
      return 8;
    case "source_snapshot":
      return 9;
  }
}

export function ImageToCodePage() {
  const { activeScheme } = useUiLayoutScheme();
  return <ImageToCodePageContent workspaceSubpage={activeScheme === "workspace"} />;
}

function ImageToCodePageContent({ workspaceSubpage }: { workspaceSubpage: boolean }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const LayoutOptionToggle = workspaceSubpage ? WorkspaceOptionToggle : ClassicOptionToggle;
  const LayoutSwitch = workspaceSubpage ? WorkspaceSwitch : ClassicSwitch;
  const LayoutTextInput = workspaceSubpage ? WorkspaceTextInput : ClassicTextInput;
  const LayoutTextarea = workspaceSubpage ? WorkspaceTextarea : ClassicTextarea;
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedJobId = searchParams.get("job");
  const [resourceModalOpen, setResourceModalOpen] = useState(false);
  const [sourceAsset, setSourceAsset] = useState<ResourceLibraryAsset | null>(null);
  const [deliveryMode, setDeliveryMode] = useState<ImageToCodeDeliveryMode>("both");
  const [pageType, setPageType] = useState<ImageToCodePageType>("landing");
  const [fidelityMode, setFidelityMode] = useState<ImageToCodeFidelityMode>("balanced");
  const [responsiveShell, setResponsiveShell] = useState(true);
  const [exportHdPreview, setExportHdPreview] = useState(true);
  const [notes, setNotes] = useState("");
  const [statusFilter, setStatusFilter] = useState<ImageToCodeStatusFilter>("all");
  const [pageIndex, setPageIndex] = useState(0);
  const [localError, setLocalError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [cancelJob, setCancelJob] = useState<ImageToCodeJob | null>(null);

  const statusQueryValue: JobStatus | null = statusFilter === "all" ? null : statusFilter;
  const pageOffset = pageIndex * PAGE_SIZE;
  const jobsQuery = useQuery({
    queryKey: ["image-to-code-jobs", statusQueryValue, pageOffset],
    queryFn: () => api.listImageToCodeJobs({ limit: PAGE_SIZE, offset: pageOffset, status: statusQueryValue }),
    refetchInterval: (query) => (query.state.data?.items.some(isActiveJob) ? 1500 : false),
  });
  const selectedJobQuery = useQuery({
    queryKey: ["image-to-code-job", selectedJobId],
    queryFn: () => api.getImageToCodeJob(selectedJobId ?? ""),
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
  const sortedArtifacts = useMemo(
    () =>
      [...(selectedJob?.result_manifest?.artifacts ?? [])].sort(
        (left, right) => artifactPriority(left) - artifactPriority(right),
      ),
    [selectedJob?.result_manifest?.artifacts],
  );
  const previewUrl = selectedJob?.result_manifest?.preview?.preview_available
    ? api.toApiUrl(selectedJob.result_manifest.preview.site_preview_url)
    : null;
  const previewImageUrl = selectedJob?.result_manifest?.preview?.preview_image_url
    ? api.toApiUrl(selectedJob.result_manifest.preview.preview_image_url)
    : null;

  const createMutation = useMutation({
    mutationFn: (input: CreateImageToCodeJobInput) => api.createImageToCodeJob(input),
    onSuccess: async (job) => {
      setLocalError("");
      setFeedback(t("imageToCode.feedback.created"));
      queryClient.setQueryData(["image-to-code-job", job.id], job);
      setSearchParams({ job: job.id });
      await queryClient.invalidateQueries({ queryKey: ["image-to-code-jobs"] });
    },
    onError: (error) => setLocalError(errorMessage(error, t("imageToCode.error.submitFailed"))),
  });
  const cancelMutation = useMutation({
    mutationFn: (jobId: string) => api.cancelImageToCodeJob(jobId),
    onSuccess: async (job) => {
      setCancelJob(null);
      setLocalError("");
      setFeedback(t("imageToCode.feedback.cancelled"));
      queryClient.setQueryData(["image-to-code-job", job.id], job);
      await queryClient.invalidateQueries({ queryKey: ["image-to-code-jobs"] });
    },
    onError: (error) => setLocalError(errorMessage(error, t("imageToCode.error.cancelFailed"))),
  });
  const retryMutation = useMutation({
    mutationFn: (jobId: string) => api.retryImageToCodeJob(jobId),
    onSuccess: async (job) => {
      setLocalError("");
      setFeedback(t("imageToCode.feedback.retried"));
      queryClient.setQueryData(["image-to-code-job", job.id], job);
      setSearchParams({ job: job.id });
      await queryClient.invalidateQueries({ queryKey: ["image-to-code-jobs"] });
    },
    onError: (error) => setLocalError(errorMessage(error, t("imageToCode.error.retryFailed"))),
  });
  const logoutMutation = useMutation({
    mutationFn: api.destroySession,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    },
  });

  useEffect(() => {
    setPageIndex(0);
  }, [statusFilter]);

  function submitJob() {
    if (!sourceAsset) {
      setLocalError(t("imageToCode.error.selectSource"));
      return;
    }
    setLocalError("");
    setFeedback("");
    createMutation.mutate({
      source_kind: "resource_library_asset",
      source_ref: sourceAsset.id,
      delivery_mode: deliveryMode,
      page_type: pageType,
      fidelity_mode: fidelityMode,
      responsive_shell: responsiveShell,
      export_hd_preview: exportHdPreview,
      notes: notes.trim() || null,
    });
  }

  function selectJob(jobId: string) {
    setSearchParams({ job: jobId });
  }

  function openPreviewInNewTab(url: string) {
    window.open(url, "_blank", "noopener,noreferrer");
  }

  const pageShellClassName = workspaceSubpage ? "pf-workspace pf-settings-workspace" : "pf-app";
  const mainClassName = workspaceSubpage
    ? "pf-workspace-subpage flex-1"
    : "mx-auto max-w-7xl px-4 pb-10 pt-4 sm:px-6 lg:px-8";
  const headerClassName = workspaceSubpage
    ? "pf-workspace-subpage-header flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"
    : "mb-4 flex flex-col gap-4 rounded-2xl border pf-hairline pf-surface px-4 py-4 shadow-sm dark:border-[color:var(--pf-border)] dark:bg-[#0f1726] lg:flex-row lg:items-end lg:justify-between";
  const panelClassName = workspaceSubpage
    ? "pf-workspace-card-soft space-y-4 rounded-[24px] p-4"
    : "space-y-4 rounded-2xl border pf-hairline pf-surface p-4 shadow-sm dark:border-[color:var(--pf-border)] dark:bg-[#0f1726]";
  const imageToCodeActionAppearance: LayoutActionAppearance = workspaceSubpage ? "workspace" : "classic";
  const PageActionButton = actionButtonComponentForAppearance(imageToCodeActionAppearance);
  const pageActionButtonClassName = (options?: Parameters<typeof actionButtonClassNameForAppearance>[1]) =>
    actionButtonClassNameForAppearance(imageToCodeActionAppearance, options);
  const artifactLinkClassName = pageActionButtonClassName({ preset: "secondary", size: "sm" });

  return (
    <div className={`${pageShellClassName} min-h-screen pf-ink dark:text-[color:var(--pf-muted)]`}>
      <TopNav
        breadcrumbs={t("imageToCode.title")}
        onHome={() => navigate("/inspirations")}
        onLogout={() => logoutMutation.mutate()}
      />
      <main className={mainClassName}>
        <div className={workspaceSubpage ? "pf-workspace-subpage-frame-shell" : "contents"}>
          <div className={workspaceSubpage ? "pf-workspace-subpage-frame" : "contents"}>
            <section className={headerClassName}>
              <div className="min-w-0">
                {workspaceSubpage ? <div className="pf-eyebrow mb-2">{t("imageToCode.eyebrow")}</div> : null}
                <div className="flex items-center gap-2 text-lg font-semibold">
                  <Code2 size={20} className="text-emerald-600 dark:text-emerald-300" />
                  <span>{t("imageToCode.title")}</span>
                </div>
                <p className="mt-2 max-w-3xl text-sm leading-6 pf-ink-muted dark:text-[color:var(--pf-muted)]">
                  {t("imageToCode.subtitle")}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <PageActionButton
                  onClick={() => setResourceModalOpen(true)}
                  preset="secondary"
                  size="md"
                  leadingIcon={<Eye size={16} />}
                >
                  {sourceAsset ? t("imageToCode.changeSource") : t("imageToCode.selectSource")}
                </PageActionButton>
                <PageActionButton
                  onClick={submitJob}
                  preset="primary"
                  size="md"
                  loading={createMutation.isPending}
                  leadingIcon={<Sparkles size={16} />}
                >
                  {t("imageToCode.submit")}
                </PageActionButton>
              </div>
            </section>

            {localError ? (
              <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-100">
                {localError}
              </div>
            ) : null}
            {feedback ? (
              <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/10 dark:text-emerald-100">
                {feedback}
              </div>
            ) : null}

            <div className="grid gap-4 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
              <section className={panelClassName}>
                <div className="space-y-2">
                  <div className="text-sm font-semibold pf-ink dark:text-[#fff]">{t("imageToCode.source")}</div>
                  <LayoutTextInput
                    value={sourceAsset?.original_filename ?? ""}
                    readOnly
                    placeholder={t("imageToCode.noSource")}
                    aria-label={t("imageToCode.source")}
                  />
                  <div className="flex flex-wrap gap-2">
                    <PageActionButton
                      onClick={() => setResourceModalOpen(true)}
                      preset="secondary"
                      size="md"
                      leadingIcon={<FileCode2 size={16} />}
                    >
                      {sourceAsset ? t("imageToCode.changeSource") : t("imageToCode.selectSource")}
                    </PageActionButton>
                  </div>
                </div>

                {sourceAsset ? (
                  <div className="overflow-hidden rounded-2xl border pf-hairline pf-surface-soft dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)]">
                    <img
                      src={api.toApiUrl(sourceAsset.preview_url)}
                      alt={sourceAsset.original_filename}
                      className="aspect-[4/3] w-full object-cover"
                    />
                    <div className="space-y-1 px-4 py-3 text-xs pf-ink-muted dark:text-[color:var(--pf-muted)]">
                      <div>{sourceAsset.original_filename}</div>
                      <div>{sourceAsset.mime_type}</div>
                      <div>
                        {sourceAsset.groups.length
                          ? sourceAsset.groups.map((group) => group.name).join(" / ")
                          : t("imageToCode.sourceUngrouped")}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex min-h-40 items-center justify-center rounded-2xl border border-dashed pf-hairline pf-surface-soft px-4 text-sm pf-ink-muted dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)] dark:text-[color:var(--pf-muted)]">
                    {t("imageToCode.noSourceHint")}
                  </div>
                )}

                <div className="space-y-2">
                  <div className="text-sm font-semibold pf-ink dark:text-[#fff]">{t("imageToCode.deliveryMode")}</div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {DELIVERY_MODES.map((mode) => (
                      <LayoutOptionToggle
                        key={mode}
                        checked={deliveryMode === mode}
                        layout="card"
                        selectionMode="single"
                        onChange={() => setDeliveryMode(mode)}
                      >
                        <div className="min-w-0">
                          <div className="font-semibold pf-ink dark:text-[#fff]">{t(deliveryModeLabelKey(mode))}</div>
                          <div className="mt-1 text-xs font-normal leading-5 pf-ink-muted dark:text-[color:var(--pf-muted)]">
                            {t(deliveryModeDescriptionKey(mode))}
                          </div>
                        </div>
                      </LayoutOptionToggle>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-semibold pf-ink dark:text-[#fff]">{t("imageToCode.pageType")}</div>
                  <div className="flex flex-wrap gap-2">
                    {PAGE_TYPES.map((mode) => (
                      <LayoutOptionToggle
                        key={mode}
                        checked={pageType === mode}
                        selectionMode="single"
                        onChange={() => setPageType(mode)}
                      >
                        {t(pageTypeLabelKey(mode))}
                      </LayoutOptionToggle>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-semibold pf-ink dark:text-[#fff]">{t("imageToCode.fidelityMode")}</div>
                  <div className="flex flex-wrap gap-2">
                    {FIDELITY_MODES.map((mode) => (
                      <LayoutOptionToggle
                        key={mode}
                        checked={fidelityMode === mode}
                        selectionMode="single"
                        onChange={() => setFidelityMode(mode)}
                      >
                        {t(fidelityModeLabelKey(mode))}
                      </LayoutOptionToggle>
                    ))}
                  </div>
                </div>

                <div className="grid gap-2">
                  <LayoutSwitch checked={responsiveShell} onChange={setResponsiveShell}>
                    {t("imageToCode.responsiveShell")}
                  </LayoutSwitch>
                  <LayoutSwitch checked={exportHdPreview} onChange={setExportHdPreview}>
                    {t("imageToCode.exportHdPreview")}
                  </LayoutSwitch>
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-semibold pf-ink dark:text-[#fff]">{t("imageToCode.notes")}</div>
                  <LayoutTextarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder={t("imageToCode.notesPlaceholder")}
                    autosize
                    minRows={4}
                    maxRows={8}
                  />
                </div>

                <PageActionButton
                  onClick={submitJob}
                  preset="primary"
                  size="lg"
                  fullWidth
                  loading={createMutation.isPending}
                  leadingIcon={<Sparkles size={16} />}
                >
                  {t("imageToCode.submit")}
                </PageActionButton>
              </section>

              <div className="space-y-4">
                <section className={panelClassName}>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="text-sm font-semibold pf-ink dark:text-[#fff]">{t("imageToCode.jobs")}</div>
                      <div className="mt-1 text-xs pf-ink-muted dark:text-[color:var(--pf-muted)]">
                        {t("imageToCode.paginationSummary", {
                          page: pageIndex + 1,
                          totalPages,
                          total: totalJobs,
                        })}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {STATUS_FILTERS.map((value) => (
                        <LayoutOptionToggle
                          key={value}
                          checked={statusFilter === value}
                          selectionMode="single"
                          onChange={() => setStatusFilter(value)}
                        >
                          {t(statusFilterLabelKey(value))}
                        </LayoutOptionToggle>
                      ))}
                    </div>
                  </div>

                  <AsyncContent
                    state={jobsViewState}
                    refreshIntent="silent-poll"
                    loadingLabel={t("app.loading")}
                    skeleton={<SkeletonRows count={5} />}
                    initialError={(
                      <AsyncErrorState
                        title={t("imageToCode.error.loadFailed")}
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
                      <div className="flex min-h-40 items-center justify-center rounded-2xl border border-dashed pf-hairline pf-surface-soft px-4 text-sm pf-ink-muted dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)] dark:text-[color:var(--pf-muted)]">
                        {t("imageToCode.emptyJobs")}
                      </div>
                    )}
                    refreshFeedback={jobsViewState.error === "refresh" ? (
                      <AsyncErrorState
                        className="pf-async-error mt-3 rounded-xl border px-4 py-3 text-sm"
                        title={t("imageToCode.error.loadFailed")}
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
                      {jobs.map((job) => {
                        const selected = job.id === selectedJob?.id;
                        const total = Math.max(1, job.progress_total || 1);
                        const completed = Math.min(total, Math.max(0, job.progress_completed || 0));
                        const pct = job.status === "succeeded" ? 100 : Math.round((completed / total) * 100);
                        return (
                          <LayoutActionSurfaceButton
                            key={job.id}
                            type="button"
                            appearance={imageToCodeActionAppearance}
                            preset="secondary"
                            onClick={() => selectJob(job.id)}
                            className={`w-full p-4 text-left ${
                              selected
                                ? "border-emerald-300 bg-emerald-50/85 shadow-sm dark:border-emerald-400/40 dark:bg-emerald-500/10"
                                : ""
                            }`}
                          >
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold pf-ink dark:text-[#fff]">
                                  {job.result_manifest?.static_site?.page_title || job.source_ref}
                                </div>
                                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs pf-ink-muted dark:text-[color:var(--pf-muted)]">
                                  <span>{formatDateTime(job.created_at)}</span>
                                  <span>{t(deliveryModeLabelKey(job.delivery_mode))}</span>
                                  <span>{t(pageTypeLabelKey(job.params.page_type as ImageToCodePageType))}</span>
                                  <span>{job.source_width}x{job.source_height}</span>
                                </div>
                              </div>
                              <span className={`inline-flex h-7 shrink-0 items-center rounded-lg border px-2.5 text-xs font-semibold ${statusClassName(job.status)}`}>
                                {t(statusLabelKey(job.status))}
                              </span>
                            </div>
                            <div className="mt-3 h-2 overflow-hidden rounded-full pf-surface-soft dark:bg-[color:var(--pf-deep)]">
                              <div
                                className={`h-full rounded-full transition-all ${
                                  job.status === "failed"
                                    ? "bg-red-500 dark:bg-red-300"
                                    : job.status === "cancelled"
                                      ? "bg-amber-500 dark:bg-amber-300"
                                      : job.status === "succeeded"
                                        ? "bg-emerald-500 dark:bg-emerald-300"
                                        : "bg-blue-500 dark:bg-blue-300"
                                }`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs pf-ink-muted dark:text-[color:var(--pf-muted)]">
                              <span>{t("imageToCode.progress", { completed, total, percent: pct })}</span>
                              {job.progress_phase ? <span>{job.progress_phase}</span> : null}
                            </div>
                          </LayoutActionSurfaceButton>
                        );
                      })}
                      <div className="flex items-center justify-between gap-2 pt-1">
                        <PageActionButton
                          onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
                          preset="secondary"
                          size="sm"
                          disabled={pageIndex <= 0}
                        >
                          {t("imageToCode.previousPage")}
                        </PageActionButton>
                        <PageActionButton
                          onClick={() => setPageIndex((current) => (current + 1 < totalPages ? current + 1 : current))}
                          preset="secondary"
                          size="sm"
                          disabled={pageIndex + 1 >= totalPages}
                        >
                          {t("imageToCode.nextPage")}
                        </PageActionButton>
                      </div>
                    </div>
                  </AsyncContent>
                </section>

                <section className={panelClassName}>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="text-sm font-semibold pf-ink dark:text-[#fff]">{t("imageToCode.detail")}</div>
                      <div className="mt-1 text-xs pf-ink-muted dark:text-[color:var(--pf-muted)]">
                        {selectedJob ? selectedJob.id : t("imageToCode.emptyDetail")}
                      </div>
                    </div>
                    {selectedJob ? (
                      <div className="flex flex-wrap gap-2">
                        {previewUrl ? (
                          <PageActionButton
                            type="button"
                            onClick={() => openPreviewInNewTab(previewUrl)}
                            preset="secondary"
                            size="md"
                            leadingIcon={<Eye size={16} />}
                          >
                            {t("imageToCode.openPreview")}
                          </PageActionButton>
                        ) : null}
                        {isActiveJob(selectedJob) ? (
                          <PageActionButton
                            onClick={() => setCancelJob(selectedJob)}
                            preset="danger"
                            size="md"
                            leadingIcon={<RefreshCw size={16} />}
                          >
                            {t("imageToCode.cancel")}
                          </PageActionButton>
                        ) : (
                          <PageActionButton
                            onClick={() => retryMutation.mutate(selectedJob.id)}
                            preset="secondary"
                            size="md"
                            loading={retryMutation.isPending && retryMutation.variables === selectedJob.id}
                            leadingIcon={<RefreshCw size={16} />}
                          >
                            {t("imageToCode.retry")}
                          </PageActionButton>
                        )}
                      </div>
                    ) : null}
                  </div>

                  {selectedJob ? (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className={`inline-flex h-7 items-center rounded-lg border px-2.5 text-xs font-semibold ${statusClassName(selectedJob.status)}`}>
                          {t(statusLabelKey(selectedJob.status))}
                        </span>
                        <span className="text-xs font-medium pf-ink-muted dark:text-[color:var(--pf-muted)]">
                          {t("imageToCode.progress", {
                            completed: Math.min(Math.max(0, selectedJob.progress_completed || 0), Math.max(1, selectedJob.progress_total || 1)),
                            total: Math.max(1, selectedJob.progress_total || 1),
                            percent:
                              selectedJob.status === "succeeded"
                                ? 100
                                : Math.round(
                                    (Math.min(Math.max(0, selectedJob.progress_completed || 0), Math.max(1, selectedJob.progress_total || 1)) /
                                      Math.max(1, selectedJob.progress_total || 1)) *
                                      100,
                                  ),
                          })}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full pf-surface-soft dark:bg-[color:var(--pf-deep)]">
                        <div
                          className={`h-full rounded-full transition-all ${
                            selectedJob.status === "failed"
                              ? "bg-red-500 dark:bg-red-300"
                              : selectedJob.status === "cancelled"
                                ? "bg-amber-500 dark:bg-amber-300"
                                : selectedJob.status === "succeeded"
                                  ? "bg-emerald-500 dark:bg-emerald-300"
                                  : "bg-blue-500 dark:bg-blue-300"
                          }`}
                          style={{
                            width: `${
                              selectedJob.status === "succeeded"
                                ? 100
                                : Math.round(
                                    (Math.min(Math.max(0, selectedJob.progress_completed || 0), Math.max(1, selectedJob.progress_total || 1)) /
                                      Math.max(1, selectedJob.progress_total || 1)) *
                                      100,
                                  )
                            }%`,
                          }}
                        />
                      </div>
                      {selectedJob.last_error ? (
                        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-100">
                          {selectedJob.last_error}
                        </div>
                      ) : null}

                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <SummaryCard
                          title={t("imageToCode.summary.delivery")}
                          value={t(deliveryModeLabelKey(selectedJob.delivery_mode))}
                          detail={t(pageTypeLabelKey(selectedJob.params.page_type as ImageToCodePageType))}
                        />
                        <SummaryCard
                          title={t("imageToCode.summary.fidelity")}
                          value={t(fidelityModeLabelKey(selectedJob.params.fidelity_mode as ImageToCodeFidelityMode))}
                          detail={selectedJob.progress_phase || t("imageToCode.summary.phaseEmpty")}
                        />
                        <SummaryCard
                          title={t("imageToCode.summary.source")}
                          value={`${selectedJob.source_width}x${selectedJob.source_height}`}
                          detail={selectedJob.source_mime_type}
                        />
                        <SummaryCard
                          title={t("imageToCode.summary.updated")}
                          value={formatDateTime(selectedJob.updated_at)}
                          detail={selectedJob.finished_at ? formatDateTime(selectedJob.finished_at) : t("imageToCode.summary.notFinished")}
                        />
                      </div>

                      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
                        <div className="space-y-3">
                          <div className="text-sm font-semibold pf-ink dark:text-[#fff]">{t("imageToCode.preview")}</div>
                          <div className="overflow-hidden rounded-2xl border pf-hairline pf-surface-soft dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)]">
                            {previewImageUrl ? (
                              <img src={previewImageUrl} alt={t("imageToCode.preview")} className="aspect-[4/3] w-full object-cover" />
                            ) : (
                              <div className="flex min-h-48 items-center justify-center px-4 text-sm pf-ink-muted dark:text-[color:var(--pf-muted)]">
                                {t("imageToCode.previewPending")}
                              </div>
                            )}
                          </div>
                          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-1">
                            <SummaryCard
                              title={t("imageToCode.summary.sections")}
                              value={String(selectedJob.result_manifest?.static_site?.section_count ?? 0)}
                              detail={t("imageToCode.summary.siteAssets", {
                                count: selectedJob.result_manifest?.static_site?.site_asset_count ?? 0,
                              })}
                            />
                            <SummaryCard
                              title={t("imageToCode.summary.artifacts")}
                              value={String(sortedArtifacts.length)}
                              detail={selectedJob.result_manifest?.warnings?.length ? t("imageToCode.summary.hasWarnings") : t("imageToCode.summary.noWarnings")}
                            />
                          </div>
                          {selectedJob.result_manifest?.figma_export ? (
                            <SummaryCard
                              title={t("imageToCode.figmaSummary")}
                              value={t("imageToCode.figmaNodes", {
                                count: selectedJob.result_manifest.figma_export.node_count,
                              })}
                              detail={t("imageToCode.figmaWarnings", {
                                count: selectedJob.result_manifest.figma_export.warning_count,
                              })}
                            />
                          ) : null}
                        </div>

                        <div className="space-y-4">
                          <div className="space-y-2">
                            <div className="text-sm font-semibold pf-ink dark:text-[#fff]">{t("imageToCode.livePreview")}</div>
                            <div className="overflow-hidden rounded-2xl border pf-hairline pf-surface dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)]">
                              {previewUrl ? (
                                <iframe
                                  src={previewUrl}
                                  title={t("imageToCode.livePreview")}
                                  sandbox=""
                                  loading="lazy"
                                  className="h-[560px] w-full pf-surface"
                                />
                              ) : (
                                <div className="flex min-h-[420px] items-center justify-center px-6 text-center text-sm pf-ink-muted dark:text-[color:var(--pf-muted)]">
                                  {t("imageToCode.previewUnavailable")}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="space-y-2">
                            <div className="text-sm font-semibold pf-ink dark:text-[#fff]">{t("imageToCode.artifacts")}</div>
                            {sortedArtifacts.length ? (
                              <div className="space-y-2">
                                {sortedArtifacts.map((artifact) => (
                                  <div
                                    key={artifact.id}
                                    className="flex flex-col gap-3 rounded-2xl border pf-hairline pf-surface-soft px-4 py-3 dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)] lg:flex-row lg:items-center lg:justify-between"
                                  >
                                    <div className="min-w-0">
                                      <div className="truncate text-sm font-semibold pf-ink dark:text-[#fff]">{artifact.label}</div>
                                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs pf-ink-muted dark:text-[color:var(--pf-muted)]">
                                        <span>{artifact.filename}</span>
                                        <span>{artifact.mime_type}</span>
                                        <span>{formatBytes(artifact.size_bytes)}</span>
                                      </div>
                                    </div>
                                    <a
                                      href={api.toApiUrl(artifact.download_url)}
                                      target="_blank"
                                      rel="noreferrer"
                                      className={artifactLinkClassName}
                                    >
                                      {renderActionButtonInner({
                                        leadingIcon: <Download size={15} />,
                                        label: t("imageToCode.downloadArtifact"),
                                      })}
                                    </a>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="rounded-2xl border border-dashed pf-hairline pf-surface-soft px-4 py-6 text-sm pf-ink-muted dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)] dark:text-[color:var(--pf-muted)]">
                                {t("imageToCode.emptyArtifacts")}
                              </div>
                            )}
                          </div>

                          {selectedJob.result_manifest?.warnings?.length ? (
                            <div className="space-y-2">
                              <div className="text-sm font-semibold pf-ink dark:text-[#fff]">{t("imageToCode.warnings")}</div>
                              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-100">
                                <ul className="space-y-2">
                                  {selectedJob.result_manifest.warnings.map((warning, index) => (
                                    <li key={`${warning}-${index}`}>{warning}</li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex min-h-60 items-center justify-center rounded-2xl border border-dashed pf-hairline pf-surface-soft px-4 text-sm pf-ink-muted dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)] dark:text-[color:var(--pf-muted)]">
                      {t("imageToCode.emptyDetail")}
                    </div>
                  )}
                </section>
              </div>
            </div>
          </div>
        </div>
      </main>

      <ResourceLibraryModal
        open={resourceModalOpen}
        onClose={() => setResourceModalOpen(false)}
        canRead
        appearance={workspaceSubpage ? "workspace" : "classic"}
        selectLabel={t("imageToCode.useResource")}
        onSelectAsset={(asset) => {
          setSourceAsset(asset);
          setResourceModalOpen(false);
        }}
        isAssetSelectable={(asset) => asset.kind === "image"}
        assetSelectDisabledTitle={t("imageToCode.resourceLibraryOnlyImages")}
      />
      <ConfirmDialog
        open={Boolean(cancelJob)}
        appearance={imageToCodeActionAppearance}
        title={t("imageToCode.cancelTitle")}
        description={t("imageToCode.cancelDescription")}
        confirmLabel={t("imageToCode.cancel")}
        cancelLabel={t("common.cancel")}
        busy={cancelMutation.isPending}
        onConfirm={() => (cancelJob ? cancelMutation.mutate(cancelJob.id) : undefined)}
        onClose={() => setCancelJob(null)}
      />
    </div>
  );
}

function SummaryCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border pf-hairline pf-surface-soft px-4 py-3 dark:border-[color:var(--pf-border)] dark:bg-[color:var(--pf-deep)]">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] pf-ink-muted dark:text-[color:var(--pf-muted)]">{title}</div>
      <div className="mt-2 text-base font-semibold pf-ink dark:text-[#fff]">{value}</div>
      <div className="mt-1 text-xs leading-5 pf-ink-muted dark:text-[color:var(--pf-muted)]">{detail}</div>
    </div>
  );
}
