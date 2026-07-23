import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Ban,
  Flower2,
  Image as ImageIcon,
  Leaf,
  MessageSquareText,
  Sparkles,
  Trees,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { AsyncContent, AsyncErrorState, AsyncPausedState } from "../../components/loading/AsyncContent";
import { Skeleton } from "../../components/loading/Skeleton";
import { TopNav } from "../../components/TopNav";
import { api, ApiError } from "../../lib/api";
import {
  asyncViewStateFromQuery,
  combineAsyncViewStates,
  type AsyncViewState,
} from "../../lib/asyncViewState";
import { formatDateTime, formatDateTimeSeconds } from "../../lib/format";
import { parseImageSizeValue } from "../../lib/imageSizes";
import type { TranslationKey } from "../../lib/i18n";
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
import {
  WORKSPACE_MOTION_INVIEW_ATTR,
  workspaceContinuousMotionAllowed,
  workspaceGalleryClampOffset,
  workspaceGalleryMaxOffset,
  workspaceGalleryTrackTransform,
} from "../../lib/workspaceMotion";
import { galleryEntrySizeLabel } from "../gallery/helpers";
import { galleryAdminRemovedLabel } from "../gallery/moderation";
import { inspirationKeyInfo, inspirationMainThumbnailUrl } from "../InspirationListPage.helpers";

const WORKSPACE_LATEST_FETCH_SIZE = 24;
const WORKSPACE_LATEST_VISIBLE_COUNT = 3;
const GALLERY_STRIP_PAGE_SIZE = 6;
const GALLERY_STRIP_SCROLL_SPEED_PX_PER_SECOND = 22;
const GALLERY_STRIP_STATIC_PAGE_DWELL_MS = 1400;
const GALLERY_STRIP_QUERY_GC_MS = 10_000;
const WORKSPACE_HOME_ACTIVE_ANCHOR_TOLERANCE_PX = 24;
const WORKSPACE_HOME_COMPACT_EXPAND_DWELL_MS = 900;
const EMPTY_RESOURCE_LIBRARY_GROUPS: ResourceLibraryGroup[] = [];
const EMPTY_RESOURCE_LIBRARY_ASSETS: ResourceLibraryAsset[] = [];
const WORKSPACE_HOME_PATH = "/inspirations";
const RESOURCE_LIBRARY_SOURCE_TYPES: ResourceLibrarySourceType[] = [
  "source_asset",
  "poster_variant",
  "image_session_asset",
  "upload",
];
const WORKSPACE_HOME_ANCHORS = [
  { id: "gallery", labelKey: "nav.gallery" },
  { id: "resource-library", labelKey: "nav.resourceLibrary" },
  { id: "workspace", labelKey: "nav.inspirations" },
  { id: "chat", labelKey: "nav.imageChat" },
  { id: "status", labelKey: "nav.status" },
  { id: "usage-stats", labelKey: "nav.usageStats" },
] as const satisfies readonly { id: string; labelKey: TranslationKey }[];

export type WorkspaceHomeAnchorId = (typeof WORKSPACE_HOME_ANCHORS)[number]["id"];

export interface WorkspaceHomeAccess {
  resourceLibrary: boolean;
  inspirations: boolean;
  imageChat: boolean;
  gallery: boolean;
  status: boolean;
  usageStats: boolean;
}

const WORKSPACE_HOME_ANCHOR_ACCESS_KEYS: Record<WorkspaceHomeAnchorId, keyof WorkspaceHomeAccess> = {
  "resource-library": "resourceLibrary",
  workspace: "inspirations",
  chat: "imageChat",
  gallery: "gallery",
  status: "status",
  "usage-stats": "usageStats",
};

const WORKSPACE_HOME_ANCHOR_ICONS: Record<WorkspaceHomeAnchorId, LucideIcon> = {
  "resource-library": Trees,
  workspace: Flower2,
  chat: Leaf,
  gallery: ImageIcon,
  status: Activity,
  "usage-stats": BarChart3,
};

export function workspaceHomeAnchorPath(anchorId: WorkspaceHomeAnchorId): string {
  return `${WORKSPACE_HOME_PATH}#${anchorId}`;
}

export function workspaceHomeVisibleAnchorIds(access: WorkspaceHomeAccess): WorkspaceHomeAnchorId[] {
  return WORKSPACE_HOME_ANCHORS
    .filter((anchor) => access[WORKSPACE_HOME_ANCHOR_ACCESS_KEYS[anchor.id]])
    .map((anchor) => anchor.id);
}

export interface WorkspaceHomeSectionPosition {
  id: WorkspaceHomeAnchorId;
  top: number;
  bottom: number;
}

export function workspaceHomeAnchorSelectionOffset(viewportWidth: number): number {
  return viewportWidth <= 980 ? 94 : 112;
}

export function workspaceHomeActiveAnchorId(
  sections: WorkspaceHomeSectionPosition[],
  activationOffset: number,
): WorkspaceHomeAnchorId | null {
  const relaxedActivationOffset = activationOffset + WORKSPACE_HOME_ACTIVE_ANCHOR_TOLERANCE_PX;
  let activeAnchorId: WorkspaceHomeAnchorId | null = null;
  for (const section of sections) {
    if (section.top <= relaxedActivationOffset && section.bottom > activationOffset) {
      activeAnchorId = section.id;
    }
  }
  if (activeAnchorId) {
    return activeAnchorId;
  }
  return sections.some((section) => section.top > relaxedActivationOffset) ? null : sections.at(-1)?.id ?? null;
}

export function workspaceHomeQuickNavShouldCollapse({
  compactMode,
  expandedAnchorId,
  targetInsideQuickNav,
}: {
  compactMode: boolean;
  expandedAnchorId: WorkspaceHomeAnchorId | null;
  targetInsideQuickNav: boolean;
}): boolean {
  return compactMode && expandedAnchorId !== null && !targetInsideQuickNav;
}

function workspaceHomeAnchorIdFromHash(hash: string): WorkspaceHomeAnchorId | null {
  if (!hash) {
    return null;
  }
  const normalizedHash = hash.startsWith("#") ? hash.slice(1) : hash;
  let decodedHash = normalizedHash;
  try {
    decodedHash = decodeURIComponent(normalizedHash);
  } catch {
    decodedHash = normalizedHash;
  }
  return WORKSPACE_HOME_ANCHORS.some((anchor) => anchor.id === decodedHash)
    ? (decodedHash as WorkspaceHomeAnchorId)
    : null;
}

function workspaceHasMenuAccess(
  session: ReturnType<typeof useSessionState>,
  menuCode: string,
  permissionCode: string,
): boolean {
  return hasSessionMenuApiPermission(session, menuCode, permissionCode);
}

export function workspaceHomeGreetingKey(date = new Date()): TranslationKey {
  const hour = date.getHours();
  if (hour >= 18 || hour < 5) {
    return "workspaceHome.greeting.evening";
  }
  if (hour >= 12) {
    return "workspaceHome.greeting.afternoon";
  }
  return "workspaceHome.greeting.morning";
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
  createSession = false,
}: {
  ownerUserId: string | null | undefined;
  resourceGroupId?: string | null;
  sessionId?: string | null;
  createSession?: boolean;
}): string {
  const path = "/image-chat/workbench";
  const params = new URLSearchParams();
  const normalizedResourceGroupId = (resourceGroupId ?? "").trim();
  const normalizedOwnerUserId = (ownerUserId ?? "").trim();
  const normalizedSessionId = (sessionId ?? "").trim();
  if (normalizedResourceGroupId) {
    params.set("resource_group_id", normalizedResourceGroupId);
  }
  if (normalizedOwnerUserId) {
    params.set("owner_user_id", normalizedOwnerUserId);
  }
  if (normalizedSessionId) {
    params.set("session_id", normalizedSessionId);
  }
  if (createSession) {
    params.set("create_session", "1");
  }
  const suffix = params.toString();
  return suffix ? `${path}?${suffix}` : path;
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

type WorkspaceSkeletonProfile = "latest" | "metrics" | "gallery" | "summary";

function WorkspaceLatestRowsSkeleton() {
  return (
    <div className="pf-workspace-latest-list">
      {[1, 2, 3].map((item) => (
        <div key={item} className="pf-workspace-latest-item pointer-events-none">
          <Skeleton className="pf-workspace-latest-thumb" rounded="lg" />
          <span className="pf-workspace-latest-copy space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </span>
          <Skeleton className="h-7 w-7 shrink-0" rounded="lg" />
        </div>
      ))}
    </div>
  );
}

function WorkspaceMetricsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="pf-workspace-menu-summary-grid">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="pf-workspace-menu-summary-card space-y-3">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      ))}
    </div>
  );
}

export function WorkspaceRegionSkeleton({
  profile,
  metricCount,
}: {
  profile: WorkspaceSkeletonProfile;
  metricCount?: number;
}) {
  if (profile === "latest") {
    return <WorkspaceLatestRowsSkeleton />;
  }
  if (profile === "metrics") {
    return <WorkspaceMetricsSkeleton count={metricCount} />;
  }
  if (profile === "gallery") {
    return (
      <div className="pf-workspace-gallery-strip">
        <div className="pf-workspace-gallery-strip-track">
          {[1, 2, 3].map((item) => (
            <div key={item} className="pf-workspace-gallery-strip-card">
              <Skeleton className="pf-workspace-gallery-strip-core min-h-44 w-full" rounded="lg" />
              <Skeleton className="mx-1 mt-2 h-3 w-2/3" />
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <WorkspaceLatestRowsSkeleton />
      <WorkspaceMetricsSkeleton count={metricCount} />
    </div>
  );
}

export function WorkspaceErrorState({
  message,
  retryLabel,
  retryingLabel,
  retrying = false,
  onRetry,
}: {
  message: string;
  retryLabel?: string;
  retryingLabel?: string;
  retrying?: boolean;
  onRetry?: () => void;
}) {
  return (
    <AsyncErrorState
      className="rounded-lg border border-red-300/60 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-700 dark:border-red-400/30 dark:text-red-100"
      title={message}
      retryLabel={retryLabel}
      retryingLabel={retryingLabel}
      retrying={retrying}
      onRetry={onRetry}
    />
  );
}

function WorkspaceRefreshErrorState({ message, retryLabel, onRetry }: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-amber-300/60 bg-amber-400/10 px-3 py-2 text-xs font-medium text-amber-900 dark:border-amber-300/25 dark:text-amber-100">
      <span>{message}</span>
      <button type="button" className="shrink-0 font-semibold underline" onClick={onRetry}>{retryLabel}</button>
    </div>
  );
}

function WorkspaceAsyncRegion({
  state,
  loadingLabel,
  errorMessage,
  retryLabel,
  pausedTitle,
  pausedMessage,
  profile,
  metricCount,
  empty,
  children,
  className,
  onRetry,
}: {
  state: AsyncViewState;
  loadingLabel: string;
  errorMessage: string;
  retryLabel: string;
  pausedTitle: string;
  pausedMessage: string;
  profile: WorkspaceSkeletonProfile;
  metricCount?: number;
  empty: ReactNode;
  children: ReactNode;
  className?: string;
  onRetry: () => void;
}) {
  const initialError = (
    <WorkspaceErrorState
      message={errorMessage}
      retryLabel={retryLabel}
      retryingLabel={loadingLabel}
      retrying={state.fetch === "fetching"}
      onRetry={onRetry}
    />
  );
  return (
    <AsyncContent
      state={state}
      refreshIntent="background"
      loadingLabel={loadingLabel}
      skeleton={<WorkspaceRegionSkeleton profile={profile} metricCount={metricCount} />}
      initialError={initialError}
      initialIdle={initialError}
      paused={(
        <AsyncPausedState
          title={pausedTitle}
          message={pausedMessage}
          retryLabel={retryLabel}
          onRetry={onRetry}
        />
      )}
      inactive={<WorkspaceErrorState message={errorMessage} />}
      empty={empty}
      refreshFeedback={
        state.error === "refresh"
          ? <WorkspaceRefreshErrorState message={errorMessage} retryLabel={retryLabel} onRetry={onRetry} />
          : null
      }
      className={className}
    >
      {children}
    </AsyncContent>
  );
}

function WorkspaceMetricCard({ label, value, detail }: { label: string; value: ReactNode; detail: string }) {
  return (
    <div className="pf-workspace-menu-summary-card">
      <span className="pf-workspace-eyebrow">{label}</span>
      <h3>{value}</h3>
      <p className="pf-workspace-caption">{detail}</p>
    </div>
  );
}

function WorkspaceMetricCardRegion({
  state,
  label,
  value,
  detail,
  loadingLabel,
  errorMessage,
  retryLabel,
  pausedTitle,
  pausedMessage,
  onRetry,
}: {
  state: AsyncViewState;
  label: string;
  value: ReactNode;
  detail: string;
  loadingLabel: string;
  errorMessage: string;
  retryLabel: string;
  pausedTitle: string;
  pausedMessage: string;
  onRetry: () => void;
}) {
  const content = <WorkspaceMetricCard label={label} value={value} detail={detail} />;
  const initialError = (
    <div className="pf-workspace-menu-summary-card">
      <WorkspaceErrorState
        message={errorMessage}
        retryLabel={retryLabel}
        retryingLabel={loadingLabel}
        retrying={state.fetch === "fetching"}
        onRetry={onRetry}
      />
    </div>
  );
  return (
    <AsyncContent
      state={state}
      refreshIntent="background"
      loadingLabel={loadingLabel}
      skeleton={(
        <div className="pf-workspace-menu-summary-card space-y-3">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-3 w-4/5" />
        </div>
      )}
      initialError={initialError}
      initialIdle={initialError}
      paused={(
        <div className="pf-workspace-menu-summary-card">
          <AsyncPausedState
            title={pausedTitle}
            message={pausedMessage}
            retryLabel={retryLabel}
            onRetry={onRetry}
          />
        </div>
      )}
      inactive={initialError}
      empty={content}
      refreshFeedback={
        state.error === "refresh"
          ? <WorkspaceRefreshErrorState message={errorMessage} retryLabel={retryLabel} onRetry={onRetry} />
          : null
      }
    >
      {content}
    </AsyncContent>
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

function useWorkspaceMotionInView(
  ref: RefObject<HTMLElement | null>,
  enabled = true,
  observeKey: string | number | boolean | null = null,
): boolean {
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setInView(false);
      const node = ref.current;
      node?.removeAttribute(WORKSPACE_MOTION_INVIEW_ATTR);
      return;
    }

    const node = ref.current;
    if (!node) {
      setInView(false);
      return;
    }

    if (typeof IntersectionObserver === "undefined") {
      node.setAttribute(WORKSPACE_MOTION_INVIEW_ATTR, "");
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          node.setAttribute(WORKSPACE_MOTION_INVIEW_ATTR, "");
        } else {
          node.removeAttribute(WORKSPACE_MOTION_INVIEW_ATTR);
        }
        setInView(entry.isIntersecting);
      },
      { rootMargin: "64px 0px", threshold: 0.05 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      node.removeAttribute(WORKSPACE_MOTION_INVIEW_ATTR);
    };
  }, [enabled, observeKey, ref]);

  return enabled && inView;
}

function useDocumentMotionVisible(): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document === "undefined" ? true : !document.hidden,
  );

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    const sync = () => setVisible(!document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  return visible;
}

function WorkspaceModuleArt({ imageCandidates = [] }: { imageCandidates?: WorkspacePreviewImageSource[] }) {
  const artRef = useRef<HTMLElement | null>(null);
  const image = useWorkspaceResolvedArtImage(imageCandidates);
  const imageSrc = image ? api.toApiUrl(image.url) : null;
  const orientationClass = image ? ` pf-workspace-menu-summary-art--${image.orientation}` : "";
  useWorkspaceMotionInView(artRef, true, imageSrc ?? "decorative");

  return (
    <aside
      ref={artRef}
      className={`pf-workspace-menu-summary-art${imageSrc ? " pf-workspace-menu-summary-art--image" : ""}${orientationClass}`}
      aria-hidden="true"
    >
      {!imageSrc ? (
        <div className="pf-workspace-menu-summary-art-motion">
          <span className="pf-workspace-menu-summary-art-ribbon pf-workspace-menu-summary-art-ribbon--one" />
          <span className="pf-workspace-menu-summary-art-ribbon pf-workspace-menu-summary-art-ribbon--two" />
          <span className="pf-workspace-menu-summary-art-ribbon pf-workspace-menu-summary-art-ribbon--three" />
        </div>
      ) : null}
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
  const inspirationsState = asyncViewStateFromQuery({
    active: Boolean(ownerUserId),
    data: inspirationsQuery.data,
    dataUpdatedAt: inspirationsQuery.dataUpdatedAt,
    isSuccess: inspirationsQuery.isSuccess,
    isError: inspirationsQuery.isError,
    fetchStatus: inspirationsQuery.fetchStatus,
    isEmpty: (data) => workspaceVisibleInspirations(data.items).length === 0,
  });
  const inspirations = workspaceVisibleInspirations(inspirationsQuery.data?.items ?? []);
  const total = inspirationsQuery.data?.total ?? 0;
  const copyReadyCount = inspirations.filter(
    (inspiration) => inspiration.workflow_state === "copy_ready" || inspiration.workflow_state === "poster_ready",
  ).length;
  const posterReadyCount = inspirations.filter((inspiration) => inspiration.workflow_state === "poster_ready").length;
  const artImageCandidates = workspaceInspirationArtImageCandidates(inspirations);
  const inspirationMetrics = [
    { label: t("inspirations.totalMetric"), value: total },
    { label: t("inspirations.copyReadyMetric"), value: copyReadyCount },
    { label: t("inspirations.posterReadyMetric"), value: posterReadyCount },
  ];
  const metricsContent = (
    <div className="pf-workspace-menu-summary-grid">
      {inspirationMetrics.map((item) => (
        <div key={item.label} className="pf-workspace-menu-summary-card">
          <span className="pf-workspace-eyebrow">{item.label}</span>
          <h3>{item.value}</h3>
        </div>
      ))}
    </div>
  );

  return (
    <div className="pf-workspace-menu-landing">
        <section className="pf-workspace-menu-summary">
          <span className="pf-workspace-eyebrow">{t("inspirations.workspace.eyebrow")}</span>

          <WorkspaceAsyncRegion
            state={inspirationsState}
            loadingLabel={t("app.loading")}
            errorMessage={t("inspirations.loadFailed")}
            retryLabel={t("common.retry")}
            pausedTitle={t("app.requestPaused.title")}
            pausedMessage={t("app.requestPaused.message")}
            profile="summary"
            metricCount={3}
            onRetry={() => void inspirationsQuery.refetch()}
            className="space-y-6"
            empty={(
              <>
                <div className="pf-workspace-latest-list">
                  <WorkspaceLatestItem
                    title={t("inspirations.keyInfo.empty")}
                    detail={t("inspirations.emptyDescription")}
                    icon={Sparkles}
                  />
                </div>
                {metricsContent}
              </>
            )}
          >
            <div className="pf-workspace-latest-list">
              {inspirations.map((inspiration) => {
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
              })}
            </div>
            {metricsContent}
          </WorkspaceAsyncRegion>

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
  const createSessionPath = workspaceImageChatWorkbenchPath({ ownerUserId, createSession: true });
  const sessionsQuery = useQuery({
    queryKey: ["workspace-image-sessions-latest", ownerUserId],
    queryFn: () => api.listImageSessions(undefined, { owner_user_id: ownerUserId }),
    enabled: Boolean(ownerUserId),
    staleTime: 60_000,
  });
  const sessionsState = asyncViewStateFromQuery({
    active: Boolean(ownerUserId),
    data: sessionsQuery.data,
    dataUpdatedAt: sessionsQuery.dataUpdatedAt,
    isSuccess: sessionsQuery.isSuccess,
    isError: sessionsQuery.isError,
    fetchStatus: sessionsQuery.fetchStatus,
    isEmpty: (data) => workspaceVisibleImageSessions(data.items).length === 0,
  });
  const sessions = workspaceVisibleImageSessions(sessionsQuery.data?.items ?? []);
  const artImageCandidates = workspaceImageSessionArtImageCandidates(sessions);
  const sessionsErrorMessage =
    sessionsQuery.error instanceof ApiError ? sessionsQuery.error.detail : t("chat.loadSessionsFailed");

  return (
    <div className={`pf-workspace-menu-landing${subpage ? " pf-workspace-menu-landing--image-chat" : ""}`}>
        <section className="pf-workspace-menu-summary">
          <span className="pf-workspace-eyebrow">{t("chat.workspace.eyebrow")}</span>

          <WorkspaceAsyncRegion
            state={sessionsState}
            loadingLabel={t("app.loading")}
            errorMessage={sessionsErrorMessage}
            retryLabel={t("common.retry")}
            pausedTitle={t("app.requestPaused.title")}
            pausedMessage={t("app.requestPaused.message")}
            profile="latest"
            onRetry={() => void sessionsQuery.refetch()}
            empty={(
              <div className="pf-workspace-latest-list">
                <WorkspaceLatestItem
                  title={t("chat.noSessions")}
                  detail={t("chat.workspace.latestDescription")}
                  icon={MessageSquareText}
                />
              </div>
            )}
          >
            <div className="pf-workspace-latest-list">
              {sessions.map((imageSession) => (
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
              ))}
            </div>
          </WorkspaceAsyncRegion>

          <div className="pf-workspace-section-actions">
            <WorkspaceHandoffButton onClick={() => navigate(workbenchPath)}>
              {t("chat.workspace.more")}
            </WorkspaceHandoffButton>
            <WorkspaceHandoffButton onClick={() => navigate(createSessionPath)}>
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
  const { t } = useI18n();
  const label = entry.prompt ?? entry.image.original_filename;
  const adminRemovedLabel = galleryAdminRemovedLabel(entry, t);
  const title = adminRemovedLabel ? `${label} / ${adminRemovedLabel}` : label;
  const metadata = showGenerationResourceGroup
    ? `${galleryEntrySizeLabel(entry, locale)} / ${entry.resource_group.name}`
    : galleryEntrySizeLabel(entry, locale);
  return (
    <article className="pf-workspace-gallery-strip-card" title={title} aria-label={title}>
      <div className="pf-workspace-gallery-strip-core relative">
        <img
          src={api.toApiUrl(galleryEntryWorkspaceImageUrl(entry))}
          alt={label}
          loading="lazy"
          decoding="async"
          className={adminRemovedLabel ? "opacity-55 grayscale" : undefined}
        />
        {adminRemovedLabel ? (
          <span className="absolute left-3 top-3 inline-flex max-w-[calc(100%-1.5rem)] items-center rounded-md border border-red-200 bg-red-50/95 px-2 py-1 text-[11px] font-semibold text-red-700 shadow-sm dark:border-red-400/35 dark:bg-red-500/15 dark:text-red-100">
            <Ban size={12} className="mr-1.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{adminRemovedLabel}</span>
          </span>
        ) : null}
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
  const documentVisible = useDocumentMotionVisible();
  const [galleryOffset, setGalleryOffset] = useState(0);
  const [galleryScrollMax, setGalleryScrollMax] = useState(0);
  const [autoScrollPaused, setAutoScrollPaused] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const trackOffsetRef = useRef(0);
  const runtimeConfigQuery = useQuery({
    queryKey: ["runtime-config"],
    queryFn: api.getRuntimeConfig,
  });
  const showGenerationResourceGroup = runtimeConfigQuery.data?.gallery_show_generation_resource_group ?? true;
  const galleryQuery = useQuery({
    queryKey: ["workspace-gallery-latest", galleryOffset],
    queryFn: () =>
      api.listGalleryEntries({
        include_disabled: false,
        limit: GALLERY_STRIP_PAGE_SIZE,
        offset: galleryOffset,
      }),
    staleTime: 60_000,
    gcTime: GALLERY_STRIP_QUERY_GC_MS,
    placeholderData: keepPreviousData,
  });
  const galleryState = asyncViewStateFromQuery({
    active: true,
    data: galleryQuery.data,
    dataUpdatedAt: galleryQuery.dataUpdatedAt,
    isSuccess: galleryQuery.isSuccess,
    isError: galleryQuery.isError,
    fetchStatus: galleryQuery.fetchStatus,
    isEmpty: (data) => data.items.length === 0,
  });
  const entries = galleryQuery.data?.items ?? [];
  const artImageCandidates = workspaceGalleryArtImageCandidates(entries);
  const galleryTotal = galleryQuery.data?.total ?? entries.length;
  const nextGalleryOffset = galleryQuery.data?.next_offset ?? null;
  const hasNextGalleryPage = Boolean(galleryQuery.data?.has_more && nextGalleryOffset !== null);
  const galleryLoopTargetOffset = galleryQuery.isPlaceholderData
    ? null
    : nextWorkspaceGalleryLoopOffset({
        galleryOffset,
        hasNextGalleryPage,
        nextGalleryOffset,
      });
  const galleryInteractionReady =
    galleryState.content === "ready" && !galleryQuery.isPlaceholderData;
  const galleryErrorMessage =
    galleryQuery.error instanceof ApiError ? galleryQuery.error.detail : t("gallery.loadFailed");
  const galleryStripVisible = useWorkspaceMotionInView(
    viewportRef,
    galleryInteractionReady && entries.length > 0,
    `${galleryOffset}:${entries.length}:${galleryState.content}`,
  );
  const motionAllowed = workspaceContinuousMotionAllowed({
    inView: galleryStripVisible,
    documentHidden: !documentVisible,
  });

  const applyTrackOffset = useCallback((offsetPx: number, maxOffset = galleryScrollMax) => {
    const track = trackRef.current;
    const nextOffset = workspaceGalleryClampOffset(offsetPx, maxOffset);
    trackOffsetRef.current = nextOffset;
    if (track) {
      track.style.transform = workspaceGalleryTrackTransform(nextOffset);
    }
    return nextOffset;
  }, [galleryScrollMax]);

  useEffect(() => {
    applyTrackOffset(0);
  }, [applyTrackOffset, galleryOffset]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track || !galleryInteractionReady || entries.length === 0) {
      setGalleryScrollMax(0);
      return;
    }

    const updateScrollMax = () => {
      const nextScrollMax = workspaceGalleryMaxOffset(track.scrollWidth, viewport.clientWidth);
      setGalleryScrollMax((current) => (current === nextScrollMax ? current : nextScrollMax));
      applyTrackOffset(trackOffsetRef.current, nextScrollMax);
    };

    updateScrollMax();
    window.addEventListener("resize", updateScrollMax);

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateScrollMax);
    resizeObserver?.observe(viewport);
    resizeObserver?.observe(track);

    return () => {
      window.removeEventListener("resize", updateScrollMax);
      resizeObserver?.disconnect();
    };
  }, [applyTrackOffset, entries.length, galleryInteractionReady, galleryOffset]);

  useEffect(() => {
    if (galleryLoopTargetOffset === null || galleryLoopTargetOffset === galleryOffset) {
      return;
    }
    void queryClient.prefetchQuery({
      queryKey: ["workspace-gallery-latest", galleryLoopTargetOffset],
      queryFn: () =>
        api.listGalleryEntries({
          include_disabled: false,
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
    if (galleryState.content === "empty" && !galleryQuery.isPlaceholderData && galleryOffset > 0) {
      setGalleryOffset(0);
    }
  }, [galleryOffset, galleryQuery.isPlaceholderData, galleryState.content]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !galleryInteractionReady || entries.length === 0) {
      return;
    }

    const pause = () => setAutoScrollPaused(true);
    const resume = () => setAutoScrollPaused(false);
    viewport.addEventListener("pointerenter", pause);
    viewport.addEventListener("pointerleave", resume);
    viewport.addEventListener("focusin", pause);
    viewport.addEventListener("focusout", resume);
    return () => {
      viewport.removeEventListener("pointerenter", pause);
      viewport.removeEventListener("pointerleave", resume);
      viewport.removeEventListener("focusin", pause);
      viewport.removeEventListener("focusout", resume);
    };
  }, [entries.length, galleryInteractionReady]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !galleryInteractionReady || entries.length === 0) {
      return;
    }

    let dragging = false;
    let pointerId: number | null = null;
    let startX = 0;
    let startOffset = 0;

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }
      dragging = true;
      pointerId = event.pointerId;
      startX = event.clientX;
      startOffset = trackOffsetRef.current;
      setAutoScrollPaused(true);
      viewport.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!dragging || event.pointerId !== pointerId) {
        return;
      }
      applyTrackOffset(startOffset - (event.clientX - startX));
    };
    const endDrag = (event: PointerEvent) => {
      if (!dragging || event.pointerId !== pointerId) {
        return;
      }
      dragging = false;
      pointerId = null;
      if (viewport.hasPointerCapture(event.pointerId)) {
        viewport.releasePointerCapture(event.pointerId);
      }
      // Keep paused while the pointer remains over the strip (hover / focus pause owns resume).
      if (!viewport.matches(":hover") && !viewport.contains(document.activeElement)) {
        setAutoScrollPaused(false);
      }
    };

    viewport.addEventListener("pointerdown", onPointerDown);
    viewport.addEventListener("pointermove", onPointerMove);
    viewport.addEventListener("pointerup", endDrag);
    viewport.addEventListener("pointercancel", endDrag);
    return () => {
      viewport.removeEventListener("pointerdown", onPointerDown);
      viewport.removeEventListener("pointermove", onPointerMove);
      viewport.removeEventListener("pointerup", endDrag);
      viewport.removeEventListener("pointercancel", endDrag);
    };
  }, [applyTrackOffset, entries.length, galleryInteractionReady]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !galleryInteractionReady || entries.length === 0) {
      return;
    }

    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) < Math.abs(event.deltaY) && Math.abs(event.deltaX) < 1) {
        return;
      }
      event.preventDefault();
      applyTrackOffset(trackOffsetRef.current + event.deltaX + event.deltaY);
    };

    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [applyTrackOffset, entries.length, galleryInteractionReady]);

  useEffect(() => {
    if (!motionAllowed || autoScrollPaused || !galleryInteractionReady || entries.length === 0) {
      return;
    }
    let animationFrame = 0;
    let lastTime = window.performance.now();
    let staticPageDwellMs = 0;

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
        const nextOffset = applyTrackOffset(
          trackOffsetRef.current + (GALLERY_STRIP_SCROLL_SPEED_PX_PER_SECOND * elapsed) / 1000,
        );
        if (nextOffset >= galleryScrollMax - 1) {
          if (galleryLoopTargetOffset !== null) {
            setGalleryOffset(galleryLoopTargetOffset);
            return;
          }
          applyTrackOffset(0);
        }
      }

      animationFrame = window.requestAnimationFrame(tick);
    };

    animationFrame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [
    applyTrackOffset,
    autoScrollPaused,
    entries.length,
    galleryInteractionReady,
    galleryLoopTargetOffset,
    galleryOffset,
    galleryScrollMax,
    motionAllowed,
  ]);

  return (
    <div className="pf-workspace-menu-landing">
        <section className="pf-workspace-menu-summary">
          <span className="pf-workspace-eyebrow">{t("gallery.workspace.eyebrow")}</span>

          <WorkspaceAsyncRegion
            state={galleryState}
            loadingLabel={t("app.loading")}
            errorMessage={galleryErrorMessage}
            retryLabel={t("common.retry")}
            pausedTitle={t("app.requestPaused.title")}
            pausedMessage={t("app.requestPaused.message")}
            profile="gallery"
            onRetry={() => void galleryQuery.refetch()}
            className="mt-6"
            empty={(
              <>
                <WorkspaceLatestItem
                  title={t("gallery.empty")}
                  detail={t("gallery.workspace.latestDescription")}
                  icon={ImageIcon}
                />
                <span className="pf-workspace-muted mt-2 inline-flex text-xs">
                  {t("gallery.count", { count: galleryTotal })}
                </span>
              </>
            )}
          >
            <div ref={viewportRef} className="pf-workspace-gallery-strip">
              <div ref={trackRef} className="pf-workspace-gallery-strip-track">
                {entries.map((entry) => (
                  <GalleryStripItem
                    key={entry.id}
                    entry={entry}
                    locale={locale}
                    showGenerationResourceGroup={showGenerationResourceGroup}
                  />
                ))}
              </div>
            </div>
            <span className="pf-workspace-muted mt-2 inline-flex text-xs">
              {t("gallery.count", { count: galleryTotal })}
            </span>
          </WorkspaceAsyncRegion>
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
  const statusState = asyncViewStateFromQuery({
    active: true,
    data: statusQuery.data,
    dataUpdatedAt: statusQuery.dataUpdatedAt,
    isSuccess: statusQuery.isSuccess,
    isError: statusQuery.isError,
    fetchStatus: statusQuery.fetchStatus,
    isEmpty: () => false,
  });
  const summary = statusQuery.data;
  const todaySplit = t("statusPage.todaySplit", {
    text: summary?.today_text_attempt_count ?? 0,
    image: summary?.today_image_attempt_count ?? 0,
  });
  const statusErrorMessage =
    statusQuery.error instanceof ApiError ? statusQuery.error.detail : t("statusPage.loadFailed");
  const statusMetrics = (
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
  );

  return (
    <div className="pf-workspace-menu-landing">
        <section className="pf-workspace-menu-summary">
          <span className="pf-workspace-eyebrow">{t("statusPage.workspace.eyebrow")}</span>

          <WorkspaceAsyncRegion
            state={statusState}
            loadingLabel={t("app.loading")}
            errorMessage={statusErrorMessage}
            retryLabel={t("common.retry")}
            pausedTitle={t("app.requestPaused.title")}
            pausedMessage={t("app.requestPaused.message")}
            profile="metrics"
            metricCount={4}
            onRetry={() => void statusQuery.refetch()}
            className="mt-6"
            empty={statusMetrics}
          >
            {statusMetrics}
          </WorkspaceAsyncRegion>

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
  const usageState = asyncViewStateFromQuery({
    active: true,
    data: usageQuery.data,
    dataUpdatedAt: usageQuery.dataUpdatedAt,
    isSuccess: usageQuery.isSuccess,
    isError: usageQuery.isError,
    fetchStatus: usageQuery.fetchStatus,
    isEmpty: (data) => data.items.length === 0,
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
  const usageErrorMessage =
    usageQuery.error instanceof ApiError ? usageQuery.error.detail : t("usageStats.loadFailed");
  const usageMetricsContent = (
    <div className="pf-workspace-menu-summary-grid">
      {metrics.map((item) => (
        <div key={item.label} className="pf-workspace-menu-summary-card">
          <span className="pf-workspace-eyebrow">{item.label}</span>
          <h3>{item.value}</h3>
          <p className="pf-workspace-caption">{item.detail}</p>
        </div>
      ))}
    </div>
  );

  return (
    <div className="pf-workspace-menu-landing">
      <section className="pf-workspace-menu-summary">
        <span className="pf-workspace-eyebrow">{t("usageStats.workspace.eyebrow")}</span>

        <WorkspaceAsyncRegion
          state={usageState}
          loadingLabel={t("app.loading")}
          errorMessage={usageErrorMessage}
          retryLabel={t("common.retry")}
          pausedTitle={t("app.requestPaused.title")}
          pausedMessage={t("app.requestPaused.message")}
          profile="summary"
          metricCount={4}
          onRetry={() => void usageQuery.refetch()}
          className="space-y-6"
          empty={(
            <>
              <div className="pf-workspace-latest-list">
                <WorkspaceLatestItem
                  title={t("usageStats.empty")}
                  detail={`${lastSuccessDetail} / ${lastFailureDetail}`}
                  icon={Sparkles}
                />
              </div>
              {usageMetricsContent}
            </>
          )}
        >
          <div className="pf-workspace-latest-list">
            {items.map((item) => {
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
            })}
          </div>
          {usageMetricsContent}
        </WorkspaceAsyncRegion>

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
  const groupsState = asyncViewStateFromQuery({
    active: true,
    data: groupsQuery.data,
    dataUpdatedAt: groupsQuery.dataUpdatedAt,
    isSuccess: groupsQuery.isSuccess,
    isError: groupsQuery.isError,
    fetchStatus: groupsQuery.fetchStatus,
    isEmpty: (data) => data.items.length === 0,
  });
  const assetsState = asyncViewStateFromQuery({
    active: true,
    data: assetsQuery.data,
    dataUpdatedAt: assetsQuery.dataUpdatedAt,
    isSuccess: assetsQuery.isSuccess,
    isError: assetsQuery.isError,
    fetchStatus: assetsQuery.fetchStatus,
    isEmpty: (data) => data.items.length === 0,
  });
  const groupMetricState = combineAsyncViewStates({
    active: true,
    critical: [groupsState, assetsState],
    isEmpty: false,
  });

  const groups = groupsQuery.data?.items ?? EMPTY_RESOURCE_LIBRARY_GROUPS;
  const assets = assetsQuery.data?.items ?? EMPTY_RESOURCE_LIBRARY_ASSETS;
  const latestAssets = assets.slice(0, 3);
  const artImageCandidates = workspaceResourceLibraryArtImageCandidates(latestAssets);

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

        <WorkspaceAsyncRegion
          state={assetsState}
          loadingLabel={t("resourceLibrary.loading")}
          errorMessage={t("resourceLibrary.loadFailed")}
          retryLabel={t("common.retry")}
          pausedTitle={t("app.requestPaused.title")}
          pausedMessage={t("app.requestPaused.message")}
          profile="latest"
          onRetry={() => void assetsQuery.refetch()}
          empty={(
            <div className="pf-workspace-latest-list">
              <WorkspaceLatestItem
                title={t("resourceLibrary.empty")}
                detail={t("resourceLibrary.landingSubtitle")}
                icon={Sparkles}
              />
            </div>
          )}
        >
          <div className="pf-workspace-latest-list">
            {latestAssets.map((asset) => (
              <WorkspaceLatestItem
                key={asset.id}
                title={asset.original_filename}
                detail={`${t(resourceLibrarySourceLabelKey(asset.source_type))} / ${formatDateTime(asset.created_at)}`}
                thumbnailUrl={asset.thumbnail_url || asset.preview_url}
                onOpen={() => navigate("/resource-library/manage")}
              />
            ))}
          </div>
        </WorkspaceAsyncRegion>

        <div className="pf-workspace-menu-summary-grid">
          <WorkspaceMetricCardRegion
            state={groupMetricState}
            label={t("resourceLibrary.groupSummary")}
            value={groups.length}
            detail={groupSummaryDetail}
            loadingLabel={t("resourceLibrary.loading")}
            errorMessage={t("resourceLibrary.loadFailed")}
            retryLabel={t("common.retry")}
            pausedTitle={t("app.requestPaused.title")}
            pausedMessage={t("app.requestPaused.message")}
            onRetry={() => void Promise.all([groupsQuery.refetch(), assetsQuery.refetch()])}
          />
          <WorkspaceMetricCardRegion
            state={assetsState}
            label={t("resourceLibrary.sourceOverview")}
            value={assets.length}
            detail={sourceSummaryDetail || t("resourceLibrary.empty")}
            loadingLabel={t("resourceLibrary.loading")}
            errorMessage={t("resourceLibrary.loadFailed")}
            retryLabel={t("common.retry")}
            pausedTitle={t("app.requestPaused.title")}
            pausedMessage={t("app.requestPaused.message")}
            onRetry={() => void assetsQuery.refetch()}
          />
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

function WorkspaceHomeQuickNav({ anchorIds }: { anchorIds: WorkspaceHomeAnchorId[] }) {
  const { t } = useI18n();
  const activeAnchorId = useWorkspaceHomeActiveAnchor(anchorIds);
  const quickNavRef = useRef<HTMLElement | null>(null);
  const { expandedAnchorId, handleAnchorClick, handleAnchorPointerDown } = useWorkspaceHomeQuickNavExpansion(
    anchorIds,
    quickNavRef,
  );

  if (!anchorIds.length) {
    return null;
  }

  return (
    <nav ref={quickNavRef} className="pf-workspace-quick-nav" aria-label={t("workspaceHome.quickNav")}>
      <div className="pf-workspace-quick-nav-list">
        {anchorIds.map((anchorId) => {
          const anchor = WORKSPACE_HOME_ANCHORS.find((item) => item.id === anchorId);
          if (!anchor) {
            return null;
          }
          const Icon = WORKSPACE_HOME_ANCHOR_ICONS[anchorId];
          const label = t(anchor.labelKey);
          const active = activeAnchorId === anchorId;
          return (
            <Link
              key={anchorId}
              to={workspaceHomeAnchorPath(anchorId)}
              aria-current={active ? "location" : undefined}
              className={`pf-workspace-quick-nav-item${expandedAnchorId === anchorId ? " is-expanded" : ""}${active ? " is-active" : ""}`}
              title={label}
              onPointerDown={() => handleAnchorPointerDown(anchorId)}
              onClick={() => handleAnchorClick(anchorId)}
            >
              <span className="pf-workspace-quick-nav-text">{label}</span>
              <span className="pf-workspace-quick-nav-icon" aria-hidden="true">
                <Icon size={16} />
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function useWorkspaceHomeActiveAnchor(anchorIds: WorkspaceHomeAnchorId[]): WorkspaceHomeAnchorId | null {
  const location = useLocation();
  const anchorIdsKey = anchorIds.join("|");
  const [activeAnchorId, setActiveAnchorId] = useState<WorkspaceHomeAnchorId | null>(() =>
    workspaceHomeAnchorIdFromHash(location.hash),
  );

  useEffect(() => {
    const orderedAnchorIds = anchorIdsKey
      ? (anchorIdsKey.split("|").filter(Boolean) as WorkspaceHomeAnchorId[])
      : [];
    if (!orderedAnchorIds.length || typeof window === "undefined") {
      setActiveAnchorId(null);
      return;
    }

    let animationFrame = 0;
    const updateActiveAnchor = () => {
      animationFrame = 0;
      const sections = orderedAnchorIds.flatMap((anchorId) => {
        const element = document.getElementById(anchorId);
        if (!element) {
          return [];
        }
        const rect = element.getBoundingClientRect();
        return [{ id: anchorId, top: rect.top, bottom: rect.bottom }];
      });
      const nextActiveAnchorId = workspaceHomeActiveAnchorId(
        sections,
        workspaceHomeAnchorSelectionOffset(window.innerWidth),
      );
      setActiveAnchorId((current) => (current === nextActiveAnchorId ? current : nextActiveAnchorId));
    };
    const scheduleUpdate = () => {
      if (animationFrame !== 0) {
        return;
      }
      animationFrame = window.requestAnimationFrame(updateActiveAnchor);
    };

    scheduleUpdate();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      if (animationFrame !== 0) {
        window.cancelAnimationFrame(animationFrame);
      }
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [anchorIdsKey, location.hash]);

  return activeAnchorId;
}

function useWorkspaceHomeQuickNavExpansion(
  anchorIds: WorkspaceHomeAnchorId[],
  quickNavRef: RefObject<HTMLElement | null>,
) {
  const anchorIdsKey = anchorIds.join("|");
  const [compactMode, setCompactMode] = useState(false);
  const [expandedAnchorId, setExpandedAnchorId] = useState<WorkspaceHomeAnchorId | null>(null);
  const collapseTimerRef = useRef<number | null>(null);

  const clearCollapseTimer = useCallback(() => {
    if (collapseTimerRef.current !== null && typeof window !== "undefined") {
      window.clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
  }, []);

  const expandAnchor = useCallback((anchorId: WorkspaceHomeAnchorId) => {
    if (!compactMode || typeof window === "undefined") {
      return;
    }
    clearCollapseTimer();
    setExpandedAnchorId(anchorId);
    collapseTimerRef.current = window.setTimeout(() => {
      setExpandedAnchorId((current) => (current === anchorId ? null : current));
      collapseTimerRef.current = null;
    }, WORKSPACE_HOME_COMPACT_EXPAND_DWELL_MS);
  }, [clearCollapseTimer, compactMode]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 980px)");
    const syncCompactMode = () => {
      const nextCompactMode = mediaQuery.matches;
      setCompactMode(nextCompactMode);
      if (!nextCompactMode) {
        clearCollapseTimer();
        setExpandedAnchorId(null);
      }
    };

    syncCompactMode();
    mediaQuery.addEventListener("change", syncCompactMode);
    return () => mediaQuery.removeEventListener("change", syncCompactMode);
  }, [clearCollapseTimer]);

  useEffect(() => {
    if (!expandedAnchorId) {
      return;
    }
    const visibleAnchorIds = anchorIdsKey ? anchorIdsKey.split("|") : [];
    if (!visibleAnchorIds.includes(expandedAnchorId)) {
      clearCollapseTimer();
      setExpandedAnchorId(null);
    }
  }, [anchorIdsKey, clearCollapseTimer, expandedAnchorId]);

  useEffect(() => {
    if (!compactMode || !expandedAnchorId || typeof window === "undefined") {
      return;
    }

    const collapseExpandedAnchor = () => {
      clearCollapseTimer();
      setExpandedAnchorId(null);
    };
    const collapseExpandedAnchorOnPointerDown = (event: PointerEvent) => {
      const quickNavRoot = quickNavRef.current;
      const eventTarget = event.target;
      const targetInsideQuickNav = eventTarget instanceof Node && Boolean(quickNavRoot?.contains(eventTarget));
      if (
        !workspaceHomeQuickNavShouldCollapse({
          compactMode,
          expandedAnchorId,
          targetInsideQuickNav,
        })
      ) {
        return;
      }
      collapseExpandedAnchor();
    };

    window.addEventListener("pointerdown", collapseExpandedAnchorOnPointerDown, true);
    window.addEventListener("touchmove", collapseExpandedAnchor, { passive: true });
    window.addEventListener("wheel", collapseExpandedAnchor, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", collapseExpandedAnchorOnPointerDown, true);
      window.removeEventListener("touchmove", collapseExpandedAnchor);
      window.removeEventListener("wheel", collapseExpandedAnchor);
    };
  }, [clearCollapseTimer, compactMode, expandedAnchorId, quickNavRef]);

  useEffect(
    () => () => {
      clearCollapseTimer();
    },
    [clearCollapseTimer],
  );

  return {
    expandedAnchorId,
    handleAnchorPointerDown: (anchorId: WorkspaceHomeAnchorId) => {
      expandAnchor(anchorId);
    },
    handleAnchorClick: (anchorId: WorkspaceHomeAnchorId) => {
      expandAnchor(anchorId);
    },
  };
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
  const accountName = session?.user?.display_name || session?.user?.username || t("workspaceHome.greeting.defaultName");
  const greeting = t(workspaceHomeGreetingKey(), { name: accountName });
  const quickNavAnchorIds = workspaceHomeVisibleAnchorIds({
    resourceLibrary: canUseResourceLibrary,
    inspirations: canReadInspirations,
    imageChat: canReadImageChat,
    gallery: canReadGallery,
    status: canReadStatus,
    usageStats: canReadUsageStats,
  });

  return (
    <div className="pf-workspace min-h-screen">
      <TopNav />
      <main className="pf-workspace-home-page">
        <WorkspaceHomeQuickNav anchorIds={quickNavAnchorIds} />
        <span id="top" className="pf-workspace-home-top-anchor" aria-hidden="true" />
        <div className="pf-workspace-home-greeting" aria-label={greeting}>
          {greeting}
        </div>

        {canReadGallery ? (
          <WorkspaceHomeSection
            id="gallery"
            title={t("nav.gallery")}
            description={t("gallery.workspace.description")}
          >
            <WorkspaceGalleryContent />
          </WorkspaceHomeSection>
        ) : null}

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
