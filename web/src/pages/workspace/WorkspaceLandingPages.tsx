import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Image as ImageIcon,
  Loader2,
  MessageSquareText,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import { TopNav } from "../../components/TopNav";
import { api, ApiError } from "../../lib/api";
import { formatDateTime, formatDateTimeSeconds } from "../../lib/format";
import { parseImageSizeValue } from "../../lib/imageSizes";
import { useI18n } from "../../lib/preferences";
import {
  API_GALLERY_READ,
  API_IMAGE_CHAT_READ,
  API_INSPIRATIONS_READ,
  API_INSPIRATIONS_WRITE,
  API_STATUS_READ,
  API_USAGE_STATS_READ,
  hasSessionApiPermission,
  hasSessionMenuApiPermission,
} from "../../lib/rbac";
import { useSessionState } from "../../lib/session";
import type {
  GenerationResourceGroupTag,
  GalleryEntry,
  ImageSessionSummary,
  InspirationSummary,
  ResourceLibraryAsset,
  ResourceLibraryGroup,
  ResourceLibrarySourceType,
  UserUsageStatsSummary,
} from "../../lib/types";
import { galleryEntrySizeLabel } from "../gallery/helpers";
import { inspirationKeyInfo, inspirationMainThumbnailUrl } from "../InspirationListPage.helpers";

const WORKSPACE_MUTED_CARD_CLASS = "pf-workspace-card-soft rounded-lg";
const WORKSPACE_LATEST_FETCH_SIZE = 24;
const WORKSPACE_LATEST_VISIBLE_COUNT = 3;
const GALLERY_STRIP_PAGE_SIZE = 6;
const GALLERY_STRIP_SCROLL_SPEED_PX_PER_SECOND = 22;
const GALLERY_STRIP_STATIC_PAGE_DWELL_MS = 1400;
const GALLERY_STRIP_QUERY_GC_MS = 10_000;
const EMPTY_RESOURCE_LIBRARY_GROUPS: ResourceLibraryGroup[] = [];
const EMPTY_RESOURCE_LIBRARY_ASSETS: ResourceLibraryAsset[] = [];
const RESOURCE_LIBRARY_SOURCE_TYPES: ResourceLibrarySourceType[] = [
  "source_asset",
  "poster_variant",
  "image_session_asset",
  "upload",
];

function workspaceHasMenuAccess(
  session: ReturnType<typeof useSessionState>,
  menuCode: string,
  permissionCode: string,
): boolean {
  return hasSessionMenuApiPermission(session, menuCode, permissionCode);
}

function resourceLibrarySourceLabelKey(sourceType: ResourceLibrarySourceType) {
  switch (sourceType) {
    case "source_asset":
      return "resourceLibrary.source.sourceAsset";
    case "poster_variant":
      return "resourceLibrary.source.posterVariant";
    case "image_session_asset":
      return "resourceLibrary.source.imageSessionAsset";
    case "upload":
      return "resourceLibrary.source.upload";
    default:
      return "resourceLibrary.source.upload";
  }
}

function usageTodayRange() {
  const value = new Date();
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  const date = `${year}-${month}-${day}`;
  return { start_date: date, end_date: date };
}

function usageSuccessRate(summary: UserUsageStatsSummary | null | undefined): string {
  if (!summary || summary.attempt_count <= 0) {
    return "0%";
  }
  return `${Math.round((summary.success_count / summary.attempt_count) * 100)}%`;
}

export function isWorkspacePublicResourceGroup(
  resourceGroup: Pick<GenerationResourceGroupTag, "blur_images_by_default"> | null | undefined,
): boolean {
  return !resourceGroup?.blur_images_by_default;
}

export function workspaceVisibleInspirations(
  inspirations: InspirationSummary[],
  limit = WORKSPACE_LATEST_VISIBLE_COUNT,
): InspirationSummary[] {
  return inspirations
    .filter((inspiration) => isWorkspacePublicResourceGroup(inspiration.resource_group))
    .slice(0, limit);
}

export function workspaceVisibleImageSessions(
  sessions: ImageSessionSummary[],
  limit = WORKSPACE_LATEST_VISIBLE_COUNT,
): ImageSessionSummary[] {
  return sessions
    .filter((session) => isWorkspacePublicResourceGroup(session.latest_resource_group))
    .slice(0, limit);
}

export function workspaceImageChatWorkbenchPath({
  ownerUserId,
  resourceGroupId,
  sessionId,
}: {
  ownerUserId: string | null | undefined;
  resourceGroupId?: string | null;
  sessionId?: string | null;
}): string {
  if (!ownerUserId) {
    return "/image-chat/workbench";
  }
  const params = new URLSearchParams();
  params.set("resource_group_id", resourceGroupId ?? "");
  params.set("owner_user_id", ownerUserId);
  if (sessionId) {
    params.set("session_id", sessionId);
  }
  return `/image-chat/workbench?${params.toString()}`;
}

export function galleryEntryWorkspaceImageUrl(entry: Pick<GalleryEntry, "image">): string {
  return entry.image.thumbnail_url || entry.image.preview_url || entry.image.download_url;
}

export type WorkspacePreviewImageSource = {
  preview_url?: string | null;
  download_url?: string | null;
  actual_size?: string | null;
  size?: string | null;
};

export type WorkspaceArtImageOrientation = "portrait" | "landscape" | "square" | "unknown";

export type WorkspaceResolvedArtImage = {
  url: string;
  orientation: WorkspaceArtImageOrientation;
};

function workspaceArtImageOrientation(width: number, height: number): WorkspaceArtImageOrientation {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return "unknown";
  }
  if (height > width) {
    return "portrait";
  }
  if (width > height) {
    return "landscape";
  }
  return "square";
}

export function workspaceArtImageOrientationFromSize({
  actualSize,
  size,
}: {
  actualSize?: string | null;
  size?: string | null;
}): WorkspaceArtImageOrientation {
  const parsedSize = parseImageSizeValue(actualSize ?? "") ?? parseImageSizeValue(size ?? "");
  return parsedSize ? workspaceArtImageOrientation(parsedSize.width, parsedSize.height) : "unknown";
}

function workspaceNormalizeArtImageCandidates(
  sources: Array<WorkspacePreviewImageSource | null | undefined>,
): WorkspaceResolvedArtImage[] {
  return sources.flatMap((source) => {
    const imageUrl = source?.preview_url || source?.download_url;
    if (!imageUrl) {
      return [];
    }
    return [
      {
        url: imageUrl,
        orientation: workspaceArtImageOrientationFromSize({
          actualSize: source?.actual_size,
          size: source?.size,
        }),
      },
    ];
  });
}

export function workspacePreferredArtImage(
  sources: Array<WorkspacePreviewImageSource | null | undefined>,
): WorkspaceResolvedArtImage | null {
  const candidates = workspaceNormalizeArtImageCandidates(sources);
  return candidates.find((candidate) => candidate.orientation === "portrait") ?? candidates[0] ?? null;
}

export function workspaceFirstPreviewImageUrl(
  sources: Array<WorkspacePreviewImageSource | null | undefined>,
): string | null {
  return workspacePreferredArtImage(sources)?.url ?? null;
}

export function workspaceInspirationListThumbnailUrl(inspiration: InspirationSummary): string | null {
  return (
    inspirationMainThumbnailUrl(inspiration) ||
    inspiration.source_image_thumbnail_url ||
    inspiration.source_image_preview_url
  );
}

export function workspaceInspirationArtImageCandidates(inspirations: InspirationSummary[]): WorkspacePreviewImageSource[] {
  return inspirations.flatMap((inspiration) => [
    {
      preview_url: inspiration.latest_generated_image_preview_url,
      download_url: inspiration.latest_generated_image_download_url,
    },
    {
      preview_url: inspiration.source_image_preview_url,
      download_url: inspiration.source_image_download_url,
    },
  ]);
}

export function workspaceInspirationArtImageUrl(inspirations: InspirationSummary[]): string | null {
  return workspaceFirstPreviewImageUrl(workspaceInspirationArtImageCandidates(inspirations));
}

export function workspaceImageSessionListThumbnailUrl(
  session: Pick<ImageSessionSummary, "latest_generated_asset">,
): string | null {
  return session.latest_generated_asset?.thumbnail_url || session.latest_generated_asset?.preview_url || null;
}

export function workspaceImageSessionArtImageUrl(
  sessions: Array<Pick<ImageSessionSummary, "latest_generated_asset">>,
): string | null {
  return workspaceFirstPreviewImageUrl(workspaceImageSessionArtImageCandidates(sessions));
}

export function workspaceImageSessionArtImageCandidates(
  sessions: Array<Pick<ImageSessionSummary, "latest_generated_asset">>,
): WorkspacePreviewImageSource[] {
  return sessions.flatMap((session) => (session.latest_generated_asset ? [session.latest_generated_asset] : []));
}

export function workspaceGalleryArtImageCandidates(
  entries: Array<Pick<GalleryEntry, "actual_size" | "image" | "size">>,
): WorkspacePreviewImageSource[] {
  return entries.map((entry) => ({
    ...entry.image,
    actual_size: entry.actual_size,
    size: entry.size,
  }));
}

export function workspaceGalleryArtImageUrl(
  entries: Array<Pick<GalleryEntry, "actual_size" | "image" | "size">>,
): string | null {
  return workspaceFirstPreviewImageUrl(workspaceGalleryArtImageCandidates(entries));
}

export function workspaceResourceLibraryArtImageUrl(
  assets: Array<Pick<ResourceLibraryAsset, "preview_url" | "download_url">>,
): string | null {
  return workspaceFirstPreviewImageUrl(workspaceResourceLibraryArtImageCandidates(assets));
}

export function workspaceResourceLibraryArtImageCandidates(
  assets: Array<Pick<ResourceLibraryAsset, "preview_url" | "download_url">>,
): WorkspacePreviewImageSource[] {
  return assets;
}

export function nextWorkspaceGalleryLoopOffset({
  galleryOffset,
  hasNextGalleryPage,
  nextGalleryOffset,
}: {
  galleryOffset: number;
  hasNextGalleryPage: boolean;
  nextGalleryOffset: number | null;
}): number | null {
  if (hasNextGalleryPage && nextGalleryOffset !== null) {
    return nextGalleryOffset;
  }
  if (galleryOffset !== 0) {
    return 0;
  }
  return null;
}

export function workspaceGalleryRetainedOffsets({
  galleryOffset,
  loopTargetOffset,
}: {
  galleryOffset: number;
  loopTargetOffset: number | null;
}): number[] {
  return loopTargetOffset === null || loopTargetOffset === galleryOffset
    ? [galleryOffset]
    : [galleryOffset, loopTargetOffset];
}

export function WorkspacePageFrame({
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
      <main className="pf-workspace-page">
        <div className="pf-workspace-frame-shell">
          <div className="pf-workspace-frame">
            <div className="pf-workspace-app-top">
              <div className="pf-workspace-app-title">
                <span className="pf-workspace-weather-logo" aria-hidden="true" />
                <div>
                  <strong>{title}</strong>
                  <span>{eyebrow}</span>
                </div>
              </div>
            </div>
            {children}
          </div>
        </div>
        <p className="pf-workspace-caption mt-4">{description}</p>
      </main>
    </div>
  );
}

export function WorkspaceSubpageFrame({
  title,
  eyebrow,
  description,
  actions,
  children,
}: {
  title: string;
  eyebrow: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="pf-workspace-subpage flex-1">
      <div className="pf-workspace-subpage-frame-shell">
        <div className="pf-workspace-subpage-frame">
          <header className="pf-workspace-subpage-header flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <div className="pf-eyebrow mb-2">{eyebrow}</div>
              <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
              {description ? <p className="mt-2 max-w-3xl text-sm leading-6">{description}</p> : null}
            </div>
            {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
          </header>
          {children}
        </div>
      </div>
    </main>
  );
}

export function WorkspaceHandoffButton({
  children,
  onClick,
  disabled = false,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="pf-workspace-handoff-chip disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
      <span className="pf-workspace-item-arrow">
        <ArrowRight size={14} />
      </span>
    </button>
  );
}

export function WorkspaceLoadingState({ label }: { label: string }) {
  return (
    <div className={`${WORKSPACE_MUTED_CARD_CLASS} pf-workspace-muted flex min-h-48 items-center justify-center`}>
      <Loader2 size={22} className="animate-spin" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function WorkspaceErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-[22px] bg-red-500/10 px-4 py-3 text-sm font-medium text-red-700 dark:text-red-200">
      {message}
    </div>
  );
}

function WorkspaceLatestPlaceholder({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="pf-workspace-latest-thumb">
      <Icon size={22} />
    </span>
  );
}

export function WorkspaceLatestItem({
  title,
  detail,
  onOpen,
  thumbnailUrl,
  icon: Icon = ImageIcon,
}: {
  title: string;
  detail: string;
  onOpen?: () => void;
  thumbnailUrl?: string | null;
  icon?: LucideIcon;
}) {
  const content = (
    <>
      {thumbnailUrl ? (
        <span className="pf-workspace-latest-thumb">
          <img src={api.toApiUrl(thumbnailUrl)} alt="" loading="lazy" decoding="async" />
        </span>
      ) : (
        <WorkspaceLatestPlaceholder icon={Icon} />
      )}
      <span className="pf-workspace-latest-copy">
        <strong>{title}</strong>
        <span>{detail}</span>
      </span>
      <span className="pf-workspace-item-arrow">
        <ArrowRight size={14} />
      </span>
    </>
  );

  if (!onOpen) {
    return <div className="pf-workspace-latest-item">{content}</div>;
  }

  return (
    <button type="button" onClick={onOpen} className="pf-workspace-latest-item">
      {content}
    </button>
  );
}

function workspaceResolveArtImageCandidate(candidate: WorkspaceResolvedArtImage): Promise<WorkspaceResolvedArtImage> {
  if (candidate.orientation !== "unknown" || typeof Image === "undefined") {
    return Promise.resolve(candidate);
  }

  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      resolve({
        url: candidate.url,
        orientation: workspaceArtImageOrientation(image.naturalWidth, image.naturalHeight),
      });
    };
    image.onerror = () => resolve(candidate);
    image.src = api.toApiUrl(candidate.url);
  });
}

function useWorkspaceResolvedArtImage(
  imageCandidates: Array<WorkspacePreviewImageSource | null | undefined>,
): WorkspaceResolvedArtImage | null {
  const candidateKey = imageCandidates
    .map((candidate) =>
      [
        candidate?.preview_url ?? "",
        candidate?.download_url ?? "",
        candidate?.actual_size ?? "",
        candidate?.size ?? "",
      ].join(","),
    )
    .join("|");
  const knownImage = useMemo(() => workspacePreferredArtImage(imageCandidates), [candidateKey]);
  const [resolvedImage, setResolvedImage] = useState<WorkspaceResolvedArtImage | null>(knownImage);

  useEffect(() => {
    const candidates = workspaceNormalizeArtImageCandidates(imageCandidates);
    setResolvedImage(workspacePreferredArtImage(imageCandidates));
    if (!candidates.length || !candidates.some((candidate) => candidate.orientation === "unknown")) {
      return;
    }

    let cancelled = false;
    void Promise.all(candidates.map(workspaceResolveArtImageCandidate)).then((resolvedCandidates) => {
      if (cancelled) {
        return;
      }
      setResolvedImage(
        resolvedCandidates.find((candidate) => candidate.orientation === "portrait") ?? resolvedCandidates[0] ?? null,
      );
    });

    return () => {
      cancelled = true;
    };
  }, [candidateKey]);

  return resolvedImage;
}

function WorkspaceModuleArt({ imageCandidates = [] }: { imageCandidates?: WorkspacePreviewImageSource[] }) {
  const image = useWorkspaceResolvedArtImage(imageCandidates);
  const imageSrc = image ? api.toApiUrl(image.url) : null;
  const orientationClass = image ? ` pf-workspace-menu-summary-art--${image.orientation}` : "";

  return (
    <aside
      className={`pf-workspace-menu-summary-art${imageSrc ? " pf-workspace-menu-summary-art--image" : ""}${orientationClass}`}
      aria-hidden="true"
    >
      <div className="pf-workspace-menu-summary-art-motion">
        <span className="pf-workspace-menu-summary-art-ribbon pf-workspace-menu-summary-art-ribbon--one" />
        <span className="pf-workspace-menu-summary-art-ribbon pf-workspace-menu-summary-art-ribbon--two" />
        <span className="pf-workspace-menu-summary-art-ribbon pf-workspace-menu-summary-art-ribbon--three" />
      </div>
      {imageSrc ? (
        <img
          className="pf-workspace-menu-summary-art-image"
          src={imageSrc}
          alt=""
          loading="lazy"
          decoding="async"
        />
      ) : null}
    </aside>
  );
}

function WorkspaceInspirationsContent() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const session = useSessionState();
  const ownerUserId = session?.user?.id;
  const canWriteInspirations = hasSessionApiPermission(session, API_INSPIRATIONS_WRITE);
  const inspirationsQuery = useQuery({
    queryKey: ["workspace-inspirations-latest", ownerUserId],
    queryFn: () =>
      api.listInspirations({
        page: 1,
        page_size: WORKSPACE_LATEST_FETCH_SIZE,
        owner_user_id: ownerUserId,
      }),
    enabled: Boolean(ownerUserId),
    staleTime: 60_000,
  });
  const inspirations = workspaceVisibleInspirations(inspirationsQuery.data?.items ?? []);
  const total = inspirationsQuery.data?.total ?? 0;
  const copyReadyCount = inspirations.filter(
    (inspiration) => inspiration.workflow_state === "copy_ready" || inspiration.workflow_state === "poster_ready",
  ).length;
  const posterReadyCount = inspirations.filter((inspiration) => inspiration.workflow_state === "poster_ready").length;
  const artImageCandidates = workspaceInspirationArtImageCandidates(inspirations);

  return (
    <div className="pf-workspace-menu-landing">
        <section className="pf-workspace-menu-summary">
          <span className="pf-workspace-eyebrow">{t("inspirations.workspace.eyebrow")}</span>

          <div className="pf-workspace-latest-list">
            {inspirationsQuery.isLoading ? (
              <WorkspaceLoadingState label={t("app.loading")} />
            ) : inspirationsQuery.isError ? (
              <WorkspaceErrorState message={t("inspirations.loadFailed")} />
            ) : inspirations.length ? (
              inspirations.map((inspiration) => {
                const keyInfo = inspirationKeyInfo(inspiration);
                const detail =
                  keyInfo.kind === "text"
                    ? keyInfo.text
                    : `${inspiration.resource_group.name} / ${formatDateTimeSeconds(inspiration.updated_at)}`;
                return (
                  <WorkspaceLatestItem
                    key={inspiration.id}
                    title={inspiration.name}
                    detail={detail}
                    thumbnailUrl={workspaceInspirationListThumbnailUrl(inspiration)}
                    onOpen={() => navigate(`/inspirations/${inspiration.id}`)}
                  />
                );
              })
            ) : (
              <WorkspaceLatestItem
                title={t("inspirations.keyInfo.empty")}
                detail={t("inspirations.emptyDescription")}
                icon={Sparkles}
              />
            )}
          </div>

          <div className="pf-workspace-menu-summary-grid">
            {[
              { label: t("inspirations.totalMetric"), value: total },
              { label: t("inspirations.copyReadyMetric"), value: copyReadyCount },
              { label: t("inspirations.posterReadyMetric"), value: posterReadyCount },
            ].map((item) => (
              <div key={item.label} className="pf-workspace-menu-summary-card">
                <span className="pf-workspace-eyebrow">{item.label}</span>
                <h3>{item.value}</h3>
              </div>
            ))}
          </div>

          <div className="pf-workspace-section-actions">
            <WorkspaceHandoffButton onClick={() => navigate("/inspirations/all")}>
              {t("inspirations.workspace.more")}
            </WorkspaceHandoffButton>
            <WorkspaceHandoffButton
              onClick={() => navigate("/inspirations/new")}
              disabled={!canWriteInspirations}
              title={canWriteInspirations ? t("inspirations.new") : t("inspirations.writePermissionRequired")}
            >
              {t("inspirations.workspace.create")}
            </WorkspaceHandoffButton>
          </div>
        </section>
        <WorkspaceModuleArt imageCandidates={artImageCandidates} />
      </div>
  );
}

export function WorkspaceInspirationsPage() {
  const { t } = useI18n();

  return (
    <WorkspacePageFrame
      eyebrow={t("inspirations.workspace.eyebrow")}
      title={t("inspirations.workspace.title")}
      description={t("inspirations.workspace.description")}
    >
      <WorkspaceInspirationsContent />
    </WorkspacePageFrame>
  );
}

function WorkspaceImageChatContent({ subpage = false }: { subpage?: boolean } = {}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const session = useSessionState();
  const ownerUserId = session?.user?.id;
  const workbenchPath = workspaceImageChatWorkbenchPath({ ownerUserId });
  const sessionsQuery = useQuery({
    queryKey: ["workspace-image-sessions-latest", ownerUserId],
    queryFn: () => api.listImageSessions(undefined, { owner_user_id: ownerUserId }),
    enabled: Boolean(ownerUserId),
    staleTime: 60_000,
  });
  const sessions = workspaceVisibleImageSessions(sessionsQuery.data?.items ?? []);
  const artImageCandidates = workspaceImageSessionArtImageCandidates(sessions);

  return (
    <div className={`pf-workspace-menu-landing${subpage ? " pf-workspace-menu-landing--image-chat" : ""}`}>
        <section className="pf-workspace-menu-summary">
          <span className="pf-workspace-eyebrow">{t("chat.workspace.eyebrow")}</span>

          <div className="pf-workspace-latest-list">
            {sessionsQuery.isLoading ? (
              <WorkspaceLoadingState label={t("app.loading")} />
            ) : sessionsQuery.isError ? (
              <WorkspaceErrorState
                message={sessionsQuery.error instanceof ApiError ? sessionsQuery.error.detail : t("chat.createFailed")}
              />
            ) : sessions.length ? (
              sessions.map((imageSession) => (
                <WorkspaceLatestItem
                  key={imageSession.id}
                  title={imageSession.title}
                  detail={`${formatDateTime(imageSession.updated_at)} / ${t("chat.roundCount", { count: imageSession.rounds_count })}`}
                  icon={MessageSquareText}
                  thumbnailUrl={workspaceImageSessionListThumbnailUrl(imageSession)}
                  onOpen={() =>
                    navigate(
                      workspaceImageChatWorkbenchPath({
                        ownerUserId,
                        resourceGroupId: imageSession.latest_resource_group_id,
                        sessionId: imageSession.id,
                      }),
                    )
                  }
                />
              ))
            ) : (
              <WorkspaceLatestItem title={t("chat.noSessions")} detail={t("chat.workspace.latestDescription")} icon={MessageSquareText} />
            )}
          </div>

          <div className="pf-workspace-section-actions">
            <WorkspaceHandoffButton onClick={() => navigate(workbenchPath)}>
              {t("chat.workspace.more")}
            </WorkspaceHandoffButton>
            <WorkspaceHandoffButton onClick={() => navigate(workbenchPath)}>
              {t("chat.workspace.create")}
            </WorkspaceHandoffButton>
          </div>
        </section>
        <WorkspaceModuleArt imageCandidates={artImageCandidates} />
      </div>
  );
}

export function WorkspaceImageChatPage() {
  const { t } = useI18n();

  return (
    <WorkspacePageFrame
      eyebrow={t("chat.workspace.eyebrow")}
      title={t("chat.workspace.title")}
      description={t("chat.workspace.description")}
    >
      <WorkspaceImageChatContent subpage />
    </WorkspacePageFrame>
  );
}

function GalleryStripItem({
  entry,
  locale,
  showGenerationResourceGroup,
}: {
  entry: GalleryEntry;
  locale: ReturnType<typeof useI18n>["locale"];
  showGenerationResourceGroup: boolean;
}) {
  const label = entry.prompt ?? entry.image.original_filename;
  const metadata = showGenerationResourceGroup
    ? `${galleryEntrySizeLabel(entry, locale)} / ${entry.resource_group.name}`
    : galleryEntrySizeLabel(entry, locale);
  return (
    <article className="pf-workspace-gallery-strip-card" title={label}>
      <div className="pf-workspace-gallery-strip-core">
        <img
          src={api.toApiUrl(galleryEntryWorkspaceImageUrl(entry))}
          alt={label}
          loading="lazy"
          decoding="async"
        />
      </div>
      <span className="pf-workspace-muted mt-2 block truncate px-1 text-xs">
        {metadata}
      </span>
    </article>
  );
}

function WorkspaceGalleryContent() {
  const { locale, t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [galleryOffset, setGalleryOffset] = useState(0);
  const [galleryStripVisible, setGalleryStripVisible] = useState(false);
  const [galleryScrollMax, setGalleryScrollMax] = useState(0);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const runtimeConfigQuery = useQuery({
    queryKey: ["runtime-config"],
    queryFn: api.getRuntimeConfig,
  });
  const showGenerationResourceGroup = runtimeConfigQuery.data?.gallery_show_generation_resource_group ?? true;
  const galleryQuery = useQuery({
    queryKey: ["workspace-gallery-latest", galleryOffset],
    queryFn: () =>
      api.listGalleryEntries({
        limit: GALLERY_STRIP_PAGE_SIZE,
        offset: galleryOffset,
    }),
    staleTime: 60_000,
    gcTime: GALLERY_STRIP_QUERY_GC_MS,
  });
  const entries = galleryQuery.data?.items ?? [];
  const artImageCandidates = workspaceGalleryArtImageCandidates(entries);
  const galleryTotal = galleryQuery.data?.total ?? entries.length;
  const nextGalleryOffset = galleryQuery.data?.next_offset ?? null;
  const hasNextGalleryPage = Boolean(galleryQuery.data?.has_more && nextGalleryOffset !== null);
  const galleryLoopTargetOffset = nextWorkspaceGalleryLoopOffset({
    galleryOffset,
    hasNextGalleryPage,
    nextGalleryOffset,
  });

  useEffect(() => {
    stripRef.current?.scrollTo({ left: 0 });
  }, [galleryOffset]);

  useEffect(() => {
    const root = stripRef.current;
    if (!root || galleryQuery.isLoading || galleryQuery.isError || entries.length === 0) {
      setGalleryScrollMax(0);
      return;
    }

    const updateScrollMax = () => {
      const nextScrollMax = Math.max(0, root.scrollWidth - root.clientWidth);
      setGalleryScrollMax((current) => (current === nextScrollMax ? current : nextScrollMax));
    };

    updateScrollMax();
    window.addEventListener("resize", updateScrollMax);

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateScrollMax);
    resizeObserver?.observe(root);

    return () => {
      window.removeEventListener("resize", updateScrollMax);
      resizeObserver?.disconnect();
    };
  }, [entries.length, galleryQuery.isError, galleryQuery.isLoading]);

  useEffect(() => {
    const root = stripRef.current;
    if (!root || galleryQuery.isLoading || galleryQuery.isError || entries.length === 0) {
      setGalleryStripVisible(false);
      return;
    }

    if (typeof IntersectionObserver === "undefined") {
      setGalleryStripVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setGalleryStripVisible(entry.isIntersecting);
      },
      { threshold: 0.05 },
    );
    observer.observe(root);
    return () => observer.disconnect();
  }, [entries.length, galleryQuery.isError, galleryQuery.isLoading]);

  useEffect(() => {
    if (galleryLoopTargetOffset === null || galleryLoopTargetOffset === galleryOffset) {
      return;
    }
    void queryClient.prefetchQuery({
      queryKey: ["workspace-gallery-latest", galleryLoopTargetOffset],
      queryFn: () =>
        api.listGalleryEntries({
          limit: GALLERY_STRIP_PAGE_SIZE,
          offset: galleryLoopTargetOffset,
        }),
      staleTime: 60_000,
      gcTime: GALLERY_STRIP_QUERY_GC_MS,
    });
  }, [galleryLoopTargetOffset, galleryOffset, queryClient]);

  useEffect(() => {
    const retainedOffsets = new Set(
      workspaceGalleryRetainedOffsets({
        galleryOffset,
        loopTargetOffset: galleryLoopTargetOffset,
      }),
    );

    queryClient.removeQueries({
      queryKey: ["workspace-gallery-latest"],
      exact: false,
      predicate: (query) => {
        const queryOffset = query.queryKey[1];
        return typeof queryOffset === "number" && !retainedOffsets.has(queryOffset);
      },
    });
  }, [galleryLoopTargetOffset, galleryOffset, queryClient]);

  useEffect(() => {
    if (!galleryQuery.isFetching && entries.length === 0 && galleryOffset > 0) {
      setGalleryOffset(0);
    }
  }, [entries.length, galleryOffset, galleryQuery.isFetching]);

  useEffect(() => {
    const root = stripRef.current;
    if (!root || !galleryStripVisible || galleryQuery.isLoading || galleryQuery.isError || entries.length === 0) {
      return;
    }
    let animationFrame = 0;
    let lastTime = window.performance.now();
    let staticPageDwellMs = 0;
    let virtualScrollLeft = root.scrollLeft;
    const syncScrollPosition = () => {
      virtualScrollLeft = root.scrollLeft;
    };
    root.addEventListener("pointerdown", syncScrollPosition, { passive: true });
    root.addEventListener("touchstart", syncScrollPosition, { passive: true });
    root.addEventListener("wheel", syncScrollPosition, { passive: true });

    const tick = (time: number) => {
      const elapsed = Math.min(time - lastTime, 64);
      lastTime = time;

      if (galleryScrollMax <= 0) {
        if (galleryLoopTargetOffset === null) {
          return;
        }
        staticPageDwellMs += elapsed;
        if (staticPageDwellMs >= GALLERY_STRIP_STATIC_PAGE_DWELL_MS) {
          setGalleryOffset(galleryLoopTargetOffset);
          return;
        }
      } else {
        staticPageDwellMs = 0;
        virtualScrollLeft = Math.min(
          galleryScrollMax,
          virtualScrollLeft + (GALLERY_STRIP_SCROLL_SPEED_PX_PER_SECOND * elapsed) / 1000,
        );
        root.scrollLeft = virtualScrollLeft;
        if (virtualScrollLeft >= galleryScrollMax - 1) {
          if (galleryLoopTargetOffset !== null) {
            setGalleryOffset(galleryLoopTargetOffset);
            return;
          }
          virtualScrollLeft = 0;
          root.scrollLeft = 0;
        }
      }

      animationFrame = window.requestAnimationFrame(tick);
    };

    animationFrame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      root.removeEventListener("pointerdown", syncScrollPosition);
      root.removeEventListener("touchstart", syncScrollPosition);
      root.removeEventListener("wheel", syncScrollPosition);
    };
  }, [
    entries.length,
    galleryOffset,
    galleryQuery.isError,
    galleryQuery.isLoading,
    galleryLoopTargetOffset,
    galleryScrollMax,
    galleryStripVisible,
  ]);

  return (
    <div className="pf-workspace-menu-landing">
        <section className="pf-workspace-menu-summary">
          <span className="pf-workspace-eyebrow">{t("gallery.workspace.eyebrow")}</span>

          {galleryQuery.isLoading ? (
            <div className="mt-6">
              <WorkspaceLoadingState label={t("app.loading")} />
            </div>
          ) : galleryQuery.isError ? (
            <div className="mt-6">
              <WorkspaceErrorState message={t("gallery.loadFailed")} />
            </div>
          ) : entries.length ? (
            <div ref={stripRef} className="pf-workspace-gallery-strip">
              {entries.map((entry) => (
                <GalleryStripItem
                  key={entry.id}
                  entry={entry}
                  locale={locale}
                  showGenerationResourceGroup={showGenerationResourceGroup}
                />
              ))}
            </div>
          ) : (
            <WorkspaceLatestItem title={t("gallery.empty")} detail={t("gallery.workspace.latestDescription")} icon={ImageIcon} />
          )}

          <span className="pf-workspace-muted mt-2 inline-flex text-xs">
            {t("gallery.count", { count: galleryTotal })}
          </span>
          <div className="pf-workspace-section-actions">
            <WorkspaceHandoffButton onClick={() => navigate("/gallery/manage")}>
              {t("gallery.workspace.more")}
            </WorkspaceHandoffButton>
          </div>
        </section>
        <WorkspaceModuleArt imageCandidates={artImageCandidates} />
      </div>
  );
}

export function WorkspaceGalleryPage() {
  const { t } = useI18n();

  return (
    <WorkspacePageFrame
      eyebrow={t("gallery.workspace.eyebrow")}
      title={t("gallery.workspace.title")}
      description={t("gallery.workspace.description")}
    >
      <WorkspaceGalleryContent />
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

function WorkspaceStatusContent() {
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
    <div className="pf-workspace-menu-landing">
        <section className="pf-workspace-menu-summary">
          <span className="pf-workspace-eyebrow">{t("statusPage.workspace.eyebrow")}</span>

          {statusQuery.isLoading ? (
            <div className="mt-6">
              <WorkspaceLoadingState label={t("app.loading")} />
            </div>
          ) : statusQuery.isError ? (
            <div className="mt-6">
              <WorkspaceErrorState
                message={statusQuery.error instanceof ApiError ? statusQuery.error.detail : t("statusPage.loadFailed")}
              />
            </div>
          ) : (
            <div className="pf-workspace-menu-summary-grid">
              {[
                { label: t("statusPage.metric.todayTotal"), value: summary?.today_attempt_count ?? 0, detail: todaySplit },
                { label: t("statusPage.metric.todayText"), value: summary?.today_text_attempt_count ?? 0, detail: t("statusPage.purpose.text") },
                { label: t("statusPage.metric.todayImage"), value: summary?.today_image_attempt_count ?? 0, detail: t("statusPage.purpose.image") },
                { label: t("settings.generation.runningConfigs"), value: summary?.running_count ?? 0, detail: t("settings.generation.frozenConfigs") + ` ${summary?.frozen_count ?? 0}` },
              ].map((item) => (
                <div key={item.label} className="pf-workspace-menu-summary-card">
                  <span className="pf-workspace-eyebrow">{item.label}</span>
                  <h3>{item.value}</h3>
                  <p className="pf-workspace-caption">{item.detail}</p>
                </div>
              ))}
            </div>
          )}

          <div className="pf-workspace-section-actions">
            <WorkspaceHandoffButton onClick={() => navigate("/status/detail")}>
              {t("statusPage.workspace.detail")}
            </WorkspaceHandoffButton>
          </div>
        </section>
        <WorkspaceModuleArt />
      </div>
  );
}

export function WorkspaceStatusPage() {
  const { t } = useI18n();

  return (
    <WorkspacePageFrame
      eyebrow={t("statusPage.workspace.eyebrow")}
      title={t("statusPage.workspace.title")}
      description={t("statusPage.workspace.description")}
    >
      <WorkspaceStatusContent />
    </WorkspacePageFrame>
  );
}

export function WorkspaceUsageStatsContent() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const session = useSessionState();
  const isAdmin = Boolean(session?.user?.is_admin);
  const today = useMemo(usageTodayRange, []);
  const usageQuery = useQuery({
    queryKey: ["usage-stats", "workspace-summary", today.start_date, today.end_date],
    queryFn: () => api.getUsageStats(today),
    retry: false,
  });
  const summary = usageQuery.data?.summary;
  const items = (usageQuery.data?.items ?? []).slice(0, 3);
  const splitDetail = t("usageStats.metric.split", {
    text: summary?.text_attempt_count ?? 0,
    image: summary?.image_attempt_count ?? 0,
  });
  const scopeDetail = t("usageStats.workspace.scope", {
    start: usageQuery.data?.start_date ?? today.start_date,
    scope: isAdmin ? t("usageStats.workspace.scopeAllUsers") : t("usageStats.workspace.scopeCurrentUser"),
  });
  const riskDetail = t("usageStats.workspace.risk", {
    failure: summary?.failure_count ?? 0,
    timeout: summary?.timeout_count ?? 0,
    throttled: summary?.throttled_count ?? 0,
  });
  const lastSuccessDetail = t("usageStats.workspace.lastSuccess", {
    time: formatDateTime(summary?.last_success_at),
  });
  const lastFailureDetail = t("usageStats.workspace.lastFailure", {
    time: formatDateTime(summary?.last_failure_at),
  });
  const metrics = [
    { label: t("usageStats.metric.total"), value: summary?.attempt_count ?? 0, detail: splitDetail },
    {
      label: t("usageStats.metric.success"),
      value: summary?.success_count ?? 0,
      detail: t("usageStats.metric.successRate", { rate: usageSuccessRate(summary) }),
    },
    { label: t("usageStats.metric.text"), value: summary?.text_attempt_count ?? 0, detail: scopeDetail },
    { label: t("usageStats.metric.image"), value: summary?.image_attempt_count ?? 0, detail: riskDetail },
  ];

  return (
    <div className="pf-workspace-menu-landing">
      <section className="pf-workspace-menu-summary">
        <span className="pf-workspace-eyebrow">{t("usageStats.workspace.eyebrow")}</span>

        <div className="pf-workspace-latest-list">
          {usageQuery.isLoading ? (
            <WorkspaceLoadingState label={t("app.loading")} />
          ) : usageQuery.isError ? (
            <WorkspaceErrorState
              message={usageQuery.error instanceof ApiError ? usageQuery.error.detail : t("usageStats.loadFailed")}
            />
          ) : items.length ? (
            items.map((item) => {
              const rate = item.attempt_count > 0
                ? `${Math.round((item.success_count / item.attempt_count) * 100)}%`
                : "0%";
              const purposeLabel =
                item.purpose === "text" ? t("statusPage.purpose.text") : t("statusPage.purpose.image");
              return (
                <WorkspaceLatestItem
                  key={item.id}
                  title={item.display_name || item.username}
                  detail={`${item.stat_date} / ${purposeLabel} / ${rate}`}
                  icon={item.purpose === "text" ? MessageSquareText : ImageIcon}
                />
              );
            })
          ) : (
            <WorkspaceLatestItem
              title={t("usageStats.empty")}
              detail={`${lastSuccessDetail} / ${lastFailureDetail}`}
              icon={Sparkles}
            />
          )}
        </div>

        <div className="pf-workspace-menu-summary-grid">
          {metrics.map((item) => (
            <div key={item.label} className="pf-workspace-menu-summary-card">
              <span className="pf-workspace-eyebrow">{item.label}</span>
              <h3>{item.value}</h3>
              <p className="pf-workspace-caption">{item.detail}</p>
            </div>
          ))}
        </div>

        <div className="pf-workspace-section-actions">
          <WorkspaceHandoffButton onClick={() => navigate("/usage-stats/detail")}>
            {t("usageStats.workspace.detail")}
          </WorkspaceHandoffButton>
        </div>
      </section>
      <WorkspaceModuleArt />
    </div>
  );
}

function WorkspaceResourceLibraryContent() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const groupsQuery = useQuery({
    queryKey: ["resource-library-groups"],
    queryFn: api.listResourceLibraryGroups,
  });
  const assetsQuery = useQuery({
    queryKey: ["resource-library-assets", "all"],
    queryFn: () => api.listResourceLibraryAssets({ group_id: null }),
  });

  const groups = groupsQuery.data?.items ?? EMPTY_RESOURCE_LIBRARY_GROUPS;
  const assets = assetsQuery.data?.items ?? EMPTY_RESOURCE_LIBRARY_ASSETS;
  const latestAssets = assets.slice(0, 3);
  const artImageCandidates = workspaceResourceLibraryArtImageCandidates(latestAssets);
  const loading = groupsQuery.isLoading || assetsQuery.isLoading;
  const failed = groupsQuery.isError || assetsQuery.isError;

  const groupSummaryDetail = groups.length
    ? groups
        .slice(0, 2)
        .map((group) => `${group.name} ${assets.filter((asset) => asset.group_ids.includes(group.id)).length}`)
        .join(" / ")
    : t("resourceLibrary.noGroups");
  const sourceSummaryDetail = RESOURCE_LIBRARY_SOURCE_TYPES.map((sourceType) => ({
    sourceType,
    count: assets.filter((asset) => asset.source_type === sourceType).length,
  }))
    .filter((item) => item.count > 0)
    .slice(0, 2)
    .map((item) => `${t(resourceLibrarySourceLabelKey(item.sourceType))} ${item.count}`)
    .join(" / ");

  return (
    <div className="pf-workspace-menu-landing">
      <section className="pf-workspace-menu-summary">
        <span className="pf-workspace-eyebrow">{t("resourceLibrary.latestResources")}</span>

        <div className="pf-workspace-latest-list">
          {failed ? (
            <WorkspaceErrorState message={t("resourceLibrary.loadFailed")} />
          ) : loading ? (
            <WorkspaceLoadingState label={t("resourceLibrary.loading")} />
          ) : latestAssets.length ? (
            latestAssets.map((asset) => (
              <WorkspaceLatestItem
                key={asset.id}
                title={asset.original_filename}
                detail={`${t(resourceLibrarySourceLabelKey(asset.source_type))} / ${formatDateTime(asset.created_at)}`}
                thumbnailUrl={asset.thumbnail_url || asset.preview_url}
                onOpen={() => navigate("/resource-library/manage")}
              />
            ))
          ) : (
            <WorkspaceLatestItem
              title={t("resourceLibrary.empty")}
              detail={t("resourceLibrary.landingSubtitle")}
              icon={Sparkles}
            />
          )}
        </div>

        <div className="pf-workspace-menu-summary-grid">
          {[
            { label: t("resourceLibrary.groupSummary"), value: groups.length, detail: groupSummaryDetail },
            {
              label: t("resourceLibrary.sourceOverview"),
              value: assets.length,
              detail: sourceSummaryDetail || t("resourceLibrary.empty"),
            },
          ].map((item) => (
            <div key={item.label} className="pf-workspace-menu-summary-card">
              <span className="pf-workspace-eyebrow">{item.label}</span>
              <h3>{item.value}</h3>
              <p className="pf-workspace-caption">{item.detail}</p>
            </div>
          ))}
        </div>

        <div className="pf-workspace-section-actions">
          <WorkspaceHandoffButton onClick={() => navigate("/resource-library/manage")}>
            {t("resourceLibrary.moreResources")}
          </WorkspaceHandoffButton>
        </div>
      </section>
      <WorkspaceModuleArt imageCandidates={artImageCandidates} />
    </div>
  );
}

function WorkspaceHomeSection({
  id,
  eyebrow,
  title,
  description,
  children,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="pf-workspace-home-section">
      <div className="pf-workspace-home-section-head">
        <div>
          {eyebrow ? <span className="pf-workspace-eyebrow">{eyebrow}</span> : null}
          <h2>{title}</h2>
        </div>
        <p>{description}</p>
      </div>
      <div className="pf-workspace-frame-shell">
        <div className="pf-workspace-frame">
          {children}
        </div>
      </div>
    </section>
  );
}

function useWorkspaceHomeHashScroll() {
  const location = useLocation();

  useEffect(() => {
    const targetId = location.hash ? decodeURIComponent(location.hash.slice(1)) : "top";
    const target = document.getElementById(targetId);
    if (!target) {
      return;
    }
    window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [location.hash]);
}

export function WorkspaceHomePage() {
  const { t } = useI18n();
  const session = useSessionState();
  useWorkspaceHomeHashScroll();

  const canUseResourceLibrary = Boolean(session?.authenticated);
  const canReadInspirations = workspaceHasMenuAccess(session, "inspirations", API_INSPIRATIONS_READ);
  const canReadImageChat = workspaceHasMenuAccess(session, "image_chat", API_IMAGE_CHAT_READ);
  const canReadGallery = workspaceHasMenuAccess(session, "gallery", API_GALLERY_READ);
  const canReadStatus = workspaceHasMenuAccess(session, "status", API_STATUS_READ);
  const canReadUsageStats = workspaceHasMenuAccess(session, "usage_stats", API_USAGE_STATS_READ);

  return (
    <div className="pf-workspace min-h-screen">
      <TopNav />
      <main className="pf-workspace-home-page">
        <span id="top" className="pf-workspace-home-top-anchor" aria-hidden="true" />

        {canUseResourceLibrary ? (
          <WorkspaceHomeSection
            id="resource-library"
            title={t("resourceLibrary.title")}
            description={t("resourceLibrary.landingSubtitle")}
          >
            <WorkspaceResourceLibraryContent />
          </WorkspaceHomeSection>
        ) : null}

        {canReadInspirations ? (
          <WorkspaceHomeSection
            id="workspace"
            title={t("nav.inspirations")}
            description={t("inspirations.workspace.description")}
          >
            <WorkspaceInspirationsContent />
          </WorkspaceHomeSection>
        ) : null}

        {canReadImageChat ? (
          <WorkspaceHomeSection
            id="chat"
            title={t("nav.imageChat")}
            description={t("chat.workspace.description")}
          >
            <WorkspaceImageChatContent />
          </WorkspaceHomeSection>
        ) : null}

        {canReadGallery ? (
          <WorkspaceHomeSection
            id="gallery"
            title={t("nav.gallery")}
            description={t("gallery.workspace.description")}
          >
            <WorkspaceGalleryContent />
          </WorkspaceHomeSection>
        ) : null}

        {canReadStatus ? (
          <WorkspaceHomeSection
            id="status"
            title={t("nav.status")}
            description={t("statusPage.workspace.description")}
          >
            <WorkspaceStatusContent />
          </WorkspaceHomeSection>
        ) : null}

        {canReadUsageStats ? (
          <WorkspaceHomeSection
            id="usage-stats"
            title={t("nav.usageStats")}
            description={t("usageStats.workspace.description")}
          >
            <WorkspaceUsageStatsContent />
          </WorkspaceHomeSection>
        ) : null}
      </main>
    </div>
  );
}
