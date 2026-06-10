import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  CalendarDays,
  Image as ImageIcon,
  Loader2,
  MessageSquareText,
  Sparkles,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import { ResourceMetaBadges } from "../../components/ResourceGovernance";
import { SensitiveImageOverlay, sensitiveImageClassName } from "../../components/SensitiveImageMask";
import { StatusPill } from "../../components/StatusPill";
import { TopNav } from "../../components/TopNav";
import { api, ApiError } from "../../lib/api";
import { formatDateTime, formatDateTimeSeconds } from "../../lib/format";
import { useI18n } from "../../lib/preferences";
import { API_INSPIRATIONS_WRITE, hasSessionApiPermission } from "../../lib/rbac";
import { useSensitiveImageMaskPreference } from "../../lib/sensitiveImagePreferences";
import { shouldMaskSensitiveImage } from "../../lib/sensitiveImages";
import { useSessionState } from "../../lib/session";
import type { GalleryEntry, ImageSessionSummary, InspirationSummary } from "../../lib/types";
import { galleryEntrySizeLabel } from "../gallery/helpers";
import { inspirationKeyInfo, inspirationMainThumbnailUrl } from "../InspirationListPage.helpers";

const WORKSPACE_CARD_CLASS = "pf-workspace-card rounded-lg";
const WORKSPACE_MUTED_CARD_CLASS = "pf-workspace-card-soft rounded-lg";
const GALLERY_STRIP_PAGE_SIZE = 6;

function WorkspacePageFrame({
  title,
  eyebrow,
  description,
  children,
}: {
  title: string;
  eyebrow: string;
  description: string;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const logoutMutation = useMutation({
    mutationFn: api.destroySession,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    },
  });

  return (
    <div className="pf-workspace min-h-screen">
      <TopNav onLogout={() => logoutMutation.mutate()} />
      <main className="mx-auto max-w-6xl px-4 pb-10 pt-6 sm:px-6 lg:px-8">
        <section className={`${WORKSPACE_CARD_CLASS} mb-5 px-5 py-5`}>
          <div className="pf-workspace-accent text-xs font-semibold uppercase tracking-[0.16em]">
            {eyebrow}
          </div>
          <h1 className="pf-workspace-title mt-3 text-2xl font-semibold tracking-normal">
            {title}
          </h1>
          <p className="pf-workspace-copy mt-2 max-w-3xl text-sm leading-6">
            {description}
          </p>
        </section>
        {children}
      </main>
    </div>
  );
}

function WorkspaceActionButton({
  children,
  onClick,
  disabled = false,
  title,
  variant = "primary",
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  variant?: "primary" | "secondary";
}) {
  const className =
    variant === "primary"
      ? "pf-workspace-action-primary"
      : "pf-workspace-action-secondary";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {children}
      <ArrowRight size={15} className="ml-2" />
    </button>
  );
}

function WorkspaceLoadingState({ label }: { label: string }) {
  return (
    <div className={`${WORKSPACE_MUTED_CARD_CLASS} pf-workspace-muted flex min-h-48 items-center justify-center`}>
      <Loader2 size={22} className="animate-spin" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

function WorkspaceErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200">
      {message}
    </div>
  );
}

function InspirationPreviewCard({
  inspiration,
  maskSensitiveImages,
  onOpen,
}: {
  inspiration: InspirationSummary;
  maskSensitiveImages: boolean;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const thumbnailUrl = inspirationMainThumbnailUrl(inspiration);
  const keyInfo = inspirationKeyInfo(inspiration);
  const shouldMaskThumbnail = shouldMaskSensitiveImage(maskSensitiveImages, inspiration.resource_group);
  const keyInfoText =
    keyInfo.kind === "text"
      ? keyInfo.text
      : keyInfo.kind === "image"
        ? keyInfo.filename ?? t("inspirations.keyInfo.startImage")
        : t("inspirations.keyInfo.empty");

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`${WORKSPACE_MUTED_CARD_CLASS} group overflow-hidden text-left transition-transform hover:-translate-y-0.5`}
    >
      <div className="pf-workspace-media-frame relative aspect-[4/3]">
        {thumbnailUrl ? (
          <>
            <img
              src={api.toApiUrl(thumbnailUrl)}
              alt={inspiration.name}
              loading="lazy"
              decoding="async"
              className={sensitiveImageClassName(
                shouldMaskThumbnail,
                "h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]",
              )}
            />
            <SensitiveImageOverlay masked={shouldMaskThumbnail} label={t("common.sensitiveImageMasked")} />
          </>
        ) : (
          <div className="pf-workspace-subtle flex h-full items-center justify-center">
            <ImageIcon size={28} />
          </div>
        )}
      </div>
      <div className="space-y-2 p-3">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="pf-workspace-title truncate text-sm font-semibold">{inspiration.name}</div>
            <div className="pf-workspace-muted mt-1 truncate text-xs">
              {formatDateTimeSeconds(inspiration.updated_at)}
            </div>
          </div>
          <StatusPill status={inspiration.workflow_state} />
        </div>
        <div className="pf-workspace-muted flex flex-wrap items-center gap-1.5 text-xs">
          <span className="pf-workspace-chip rounded-full px-2 py-0.5 font-medium">
            {inspiration.resource_group.name}
          </span>
          <ResourceMetaBadges resource={inspiration} />
        </div>
        <div className="pf-workspace-muted line-clamp-2 text-xs leading-5">
          {keyInfoText}
        </div>
      </div>
    </button>
  );
}

export function WorkspaceInspirationsPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const session = useSessionState();
  const canWriteInspirations = hasSessionApiPermission(session, API_INSPIRATIONS_WRITE);
  const [maskSensitiveImages] = useSensitiveImageMaskPreference("inspirations");
  const inspirationsQuery = useQuery({
    queryKey: ["workspace-inspirations-latest"],
    queryFn: () => api.listInspirations({ page: 1, page_size: 3 }),
    staleTime: 60_000,
  });
  const inspirations = inspirationsQuery.data?.items ?? [];
  const total = inspirationsQuery.data?.total ?? 0;
  const copyReadyCount = inspirations.filter(
    (inspiration) => inspiration.workflow_state === "copy_ready" || inspiration.workflow_state === "poster_ready",
  ).length;
  const posterReadyCount = inspirations.filter((inspiration) => inspiration.workflow_state === "poster_ready").length;

  return (
    <WorkspacePageFrame
      eyebrow={t("inspirations.workspace.eyebrow")}
      title={t("inspirations.workspace.title")}
      description={t("inspirations.workspace.description")}
    >
      <section className="mb-4 grid gap-3 sm:grid-cols-3">
        {[
          { label: t("inspirations.totalMetric"), value: total },
          { label: t("inspirations.copyReadyMetric"), value: copyReadyCount },
          { label: t("inspirations.posterReadyMetric"), value: posterReadyCount },
        ].map((item) => (
          <div key={item.label} className={`${WORKSPACE_CARD_CLASS} p-4`}>
            <div className="pf-workspace-muted text-xs font-medium">{item.label}</div>
            <div className="pf-workspace-title mt-2 text-2xl font-semibold">{item.value}</div>
          </div>
        ))}
      </section>

      <section className={`${WORKSPACE_CARD_CLASS} p-4`}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="pf-workspace-title text-base font-semibold">
              {t("inspirations.workspace.latestTitle")}
            </h2>
            <p className="pf-workspace-muted mt-1 text-sm">
              {t("inspirations.workspace.latestDescription")}
            </p>
          </div>
        </div>

        {inspirationsQuery.isLoading ? (
          <div className="mt-4">
            <WorkspaceLoadingState label={t("app.loading")} />
          </div>
        ) : inspirationsQuery.isError ? (
          <div className="mt-4">
            <WorkspaceErrorState message={t("inspirations.loadFailed")} />
          </div>
        ) : inspirations.length ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {inspirations.map((inspiration) => (
              <InspirationPreviewCard
                key={inspiration.id}
                inspiration={inspiration}
                maskSensitiveImages={maskSensitiveImages}
                onOpen={() => navigate(`/inspirations/${inspiration.id}`)}
              />
            ))}
          </div>
        ) : (
          <div className={`${WORKSPACE_MUTED_CARD_CLASS} pf-workspace-muted mt-4 flex min-h-44 flex-col items-center justify-center border-dashed px-6 py-8 text-center text-sm`}>
            <Sparkles size={24} className="pf-workspace-accent mb-3" />
            {t("inspirations.emptyDescription")}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <WorkspaceActionButton onClick={() => navigate("/inspirations/all")}>
            {t("inspirations.workspace.more")}
          </WorkspaceActionButton>
          <WorkspaceActionButton
            variant="secondary"
            onClick={() => navigate("/inspirations/new")}
            disabled={!canWriteInspirations}
            title={canWriteInspirations ? t("inspirations.new") : t("inspirations.writePermissionRequired")}
          >
            {t("inspirations.workspace.create")}
          </WorkspaceActionButton>
        </div>
      </section>
    </WorkspacePageFrame>
  );
}

function ImageSessionPreviewCard({ session, onOpen }: { session: ImageSessionSummary; onOpen: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`${WORKSPACE_MUTED_CARD_CLASS} min-h-36 p-4 text-left transition-transform hover:-translate-y-0.5`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="pf-workspace-title truncate text-sm font-semibold">{session.title}</div>
          <div className="pf-workspace-muted mt-1 text-xs">{formatDateTime(session.updated_at)}</div>
        </div>
        <span className="pf-workspace-icon inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
          <MessageSquareText size={17} />
        </span>
      </div>
      <div className="pf-workspace-muted mt-4 flex flex-wrap gap-1.5 text-xs">
        <span className="pf-workspace-chip rounded-full px-2 py-0.5 font-medium">
          {session.latest_resource_group?.name ?? t("inspirations.keyInfo.empty")}
        </span>
        <span>{t("chat.roundCount", { count: session.rounds_count })}</span>
      </div>
    </button>
  );
}

export function WorkspaceImageChatPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const sessionsQuery = useQuery({
    queryKey: ["workspace-image-sessions-latest"],
    queryFn: () => api.listImageSessions(undefined),
    staleTime: 60_000,
  });
  const sessions = (sessionsQuery.data?.items ?? []).slice(0, 3);

  return (
    <WorkspacePageFrame
      eyebrow={t("chat.workspace.eyebrow")}
      title={t("chat.workspace.title")}
      description={t("chat.workspace.description")}
    >
      <section className={`${WORKSPACE_CARD_CLASS} p-4`}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="pf-workspace-title text-base font-semibold">
              {t("chat.workspace.latestTitle")}
            </h2>
            <p className="pf-workspace-muted mt-1 text-sm">
              {t("chat.workspace.latestDescription")}
            </p>
          </div>
        </div>

        {sessionsQuery.isLoading ? (
          <div className="mt-4">
            <WorkspaceLoadingState label={t("app.loading")} />
          </div>
        ) : sessionsQuery.isError ? (
          <div className="mt-4">
            <WorkspaceErrorState
              message={sessionsQuery.error instanceof ApiError ? sessionsQuery.error.detail : t("chat.createFailed")}
            />
          </div>
        ) : sessions.length ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {sessions.map((session) => (
              <ImageSessionPreviewCard
                key={session.id}
                session={session}
                onOpen={() => navigate("/image-chat/workbench")}
              />
            ))}
          </div>
        ) : (
          <div className={`${WORKSPACE_MUTED_CARD_CLASS} pf-workspace-muted mt-4 flex min-h-44 flex-col items-center justify-center border-dashed px-6 py-8 text-center text-sm`}>
            <MessageSquareText size={24} className="pf-workspace-accent mb-3" />
            {t("chat.noSessions")}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <WorkspaceActionButton onClick={() => navigate("/image-chat/workbench")}>
            {t("chat.workspace.more")}
          </WorkspaceActionButton>
          <WorkspaceActionButton variant="secondary" onClick={() => navigate("/image-chat/workbench")}>
            {t("chat.workspace.create")}
          </WorkspaceActionButton>
        </div>
      </section>
    </WorkspacePageFrame>
  );
}

function GalleryStripItem({ entry, locale }: { entry: GalleryEntry; locale: ReturnType<typeof useI18n>["locale"] }) {
  const label = entry.prompt ?? entry.image.original_filename;
  return (
    <article className={`${WORKSPACE_MUTED_CARD_CLASS} min-w-[220px] overflow-hidden sm:min-w-[260px]`}>
      <img
        src={api.toApiUrl(entry.image.thumbnail_url)}
        alt={label}
        loading="lazy"
        decoding="async"
        className="pf-workspace-media-frame aspect-[4/3] w-full object-contain"
      />
      <div className="space-y-2 p-3">
        <div className="pf-workspace-title line-clamp-2 min-h-10 text-sm font-semibold leading-5">
          {label}
        </div>
        <div className="pf-workspace-muted flex flex-wrap items-center gap-1.5 text-xs">
          <span>{galleryEntrySizeLabel(entry, locale)}</span>
          <span>{entry.resource_group.name}</span>
        </div>
        <ResourceMetaBadges resource={entry} />
      </div>
    </article>
  );
}

export function WorkspaceGalleryPage() {
  const { locale, t } = useI18n();
  const navigate = useNavigate();
  const stripRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const galleryQuery = useInfiniteQuery({
    queryKey: ["workspace-gallery-latest"],
    queryFn: ({ pageParam }) =>
      api.listGalleryEntries({
        limit: GALLERY_STRIP_PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.next_offset ?? undefined,
    staleTime: 60_000,
  });
  const entries = galleryQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = galleryQuery;

  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) {
      return;
    }
    const root = stripRef.current;
    const target = loadMoreRef.current;
    if (!root || !target) {
      return;
    }
    if (typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver(
      (observedEntries) => {
        if (observedEntries.some((entry) => entry.isIntersecting)) {
          void fetchNextPage();
        }
      },
      {
        root,
        rootMargin: "0px 96px 0px 0px",
        threshold: 0.1,
      },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  return (
    <WorkspacePageFrame
      eyebrow={t("gallery.workspace.eyebrow")}
      title={t("gallery.workspace.title")}
      description={t("gallery.workspace.description")}
    >
      <section className={`${WORKSPACE_CARD_CLASS} p-4`}>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="pf-workspace-title text-base font-semibold">
              {t("gallery.workspace.latestTitle")}
            </h2>
            <p className="pf-workspace-muted mt-1 text-sm">
              {t("gallery.workspace.latestDescription")}
            </p>
          </div>
          <span className="pf-workspace-muted text-sm font-medium">
            {t("gallery.count", { count: entries.length })}
          </span>
        </div>

        {galleryQuery.isLoading ? (
          <div className="mt-4">
            <WorkspaceLoadingState label={t("app.loading")} />
          </div>
        ) : galleryQuery.isError ? (
          <div className="mt-4">
            <WorkspaceErrorState message={t("gallery.loadFailed")} />
          </div>
        ) : entries.length ? (
          <div ref={stripRef} className="mt-4 flex gap-3 overflow-x-auto overscroll-x-contain pb-3 [scrollbar-width:thin]">
            {entries.map((entry) => (
              <GalleryStripItem key={entry.id} entry={entry} locale={locale} />
            ))}
            {hasNextPage ? (
              <div
                ref={loadMoreRef}
                className={`${WORKSPACE_MUTED_CARD_CLASS} pf-workspace-muted flex min-w-[180px] items-center justify-center px-5 text-center text-sm`}
                aria-live="polite"
              >
                <button
                  type="button"
                  onClick={() => void fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg px-3 font-semibold transition-colors hover:opacity-80 disabled:cursor-wait disabled:opacity-60"
                >
                  {isFetchingNextPage ? (
                    <Loader2 size={16} className="pf-workspace-accent animate-spin" />
                  ) : (
                    <ArrowRight size={16} className="pf-workspace-accent" />
                  )}
                  {isFetchingNextPage ? t("gallery.workspace.loadingMore") : t("gallery.workspace.loadMore")}
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className={`${WORKSPACE_MUTED_CARD_CLASS} pf-workspace-muted mt-4 flex min-h-44 flex-col items-center justify-center border-dashed px-6 py-8 text-center text-sm`}>
            <ImageIcon size={24} className="pf-workspace-accent mb-3" />
            {t("gallery.empty")}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <WorkspaceActionButton onClick={() => navigate("/gallery/manage")}>
            {t("gallery.workspace.more")}
          </WorkspaceActionButton>
        </div>
      </section>
    </WorkspacePageFrame>
  );
}

function todayDateRange() {
  const value = new Date();
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function WorkspaceStatusPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const today = useMemo(todayDateRange, []);
  const statusQuery = useQuery({
    queryKey: ["workspace-generation-config-status", today],
    queryFn: () => api.getGenerationConfigStatus({ start_date: today, end_date: today }),
    retry: false,
  });
  const summary = statusQuery.data;
  const todaySplit = t("statusPage.todaySplit", {
    text: summary?.today_text_attempt_count ?? 0,
    image: summary?.today_image_attempt_count ?? 0,
  });

  return (
    <WorkspacePageFrame
      eyebrow={t("statusPage.workspace.eyebrow")}
      title={t("statusPage.workspace.title")}
      description={t("statusPage.workspace.description")}
    >
      <section className={`${WORKSPACE_CARD_CLASS} p-4`}>
        {statusQuery.isLoading ? (
          <WorkspaceLoadingState label={t("app.loading")} />
        ) : statusQuery.isError ? (
          <WorkspaceErrorState
            message={statusQuery.error instanceof ApiError ? statusQuery.error.detail : t("statusPage.loadFailed")}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                label: t("statusPage.metric.todayTotal"),
                value: summary?.today_attempt_count ?? 0,
                detail: todaySplit,
                icon: Activity,
              },
              {
                label: t("statusPage.metric.todayText"),
                value: summary?.today_text_attempt_count ?? 0,
                detail: t("statusPage.purpose.text"),
                icon: MessageSquareText,
              },
              {
                label: t("statusPage.metric.todayImage"),
                value: summary?.today_image_attempt_count ?? 0,
                detail: t("statusPage.purpose.image"),
                icon: ImageIcon,
              },
              {
                label: t("settings.generation.runningConfigs"),
                value: summary?.running_count ?? 0,
                detail: t("settings.generation.frozenConfigs") + ` ${summary?.frozen_count ?? 0}`,
                icon: CalendarDays,
              },
            ].map((item) => (
              <div key={item.label} className={WORKSPACE_MUTED_CARD_CLASS + " p-4"}>
                <div className="flex items-center justify-between gap-3">
                  <div className="pf-workspace-muted text-xs font-medium">{item.label}</div>
                  <span className="pf-workspace-icon inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
                    <item.icon size={15} />
                  </span>
                </div>
                <div className="pf-workspace-title mt-3 text-2xl font-semibold">{item.value}</div>
                <div className="pf-workspace-muted mt-1 truncate text-xs">{item.detail}</div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <WorkspaceActionButton onClick={() => navigate("/status/detail")}>
            {t("statusPage.workspace.detail")}
          </WorkspaceActionButton>
        </div>
      </section>
    </WorkspacePageFrame>
  );
}
