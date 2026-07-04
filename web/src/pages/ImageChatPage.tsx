import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Drawer } from "vaul";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  GalleryHorizontalEnd,
  History,
  Image as ImageIcon,
  Layers3,
  Loader2,
  Menu,
  Pencil,
  Plus,
  Save,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { ConfirmDialog } from "../components/ConfirmDialog";
import { EnhanceJobProgress } from "../components/EnhanceJobProgress";
import { GalleryTagPickerDialog } from "../components/GalleryTagPickerDialog";
import { GalleryImagePreviewDialog } from "../components/GalleryImagePreviewDialog";
import { ImageGenerationSettingsPanel } from "../components/ImageGenerationSettingsPanel";
import { ImageGenerationSettingsTabs, type ImageGenerationSettingsTab } from "../components/ImageGenerationSettingsTabs";
import { ImageToolControls } from "../components/ImageToolControls";
import { ModalShell } from "../components/ModalShell";
import { ParameterHelpLabel } from "../components/ParameterHelp";
import { PromptPreviewDialog, type PromptPreview } from "../components/PromptPreviewDialog";
import {
  actionButtonClassNameForAppearance,
  actionButtonComponentForAppearance,
  actionButtonToneStyle,
  actionSurfaceClassNameForAppearance,
  transparentActionToneVars,
  type ActionButtonToneVars,
  type LayoutActionAppearance,
} from "../components/layoutActionButtons";
import {
  getResourceBlockedActionTitle,
  isResourceBlocked,
  ResourceBlockedNotice,
  ResourceMetaBadges,
} from "../components/ResourceGovernance";
import { ResourceLibraryModal } from "../components/resource-library/ResourceLibraryModal";
import {
  SaveToResourceLibraryDialog,
  type ResourceLibrarySaveSource,
} from "../components/resource-library/SaveToResourceLibraryDialog";
import { TopNav } from "../components/TopNav";
import {
  ClassicCheckbox,
  ClassicSelectField,
  ClassicTextInput,
  ClassicTextarea,
} from "../components/classicInputs";
import {
  WorkspaceCheckbox,
  WorkspaceSelectField,
  WorkspaceTextInput,
  WorkspaceTextarea,
} from "../components/workspaceInputs";
import { api, ApiError } from "../lib/api";
import { copyTextToClipboard } from "../lib/clipboard";
import { compositeEnhanceTiles, estimateEnhanceTileCallCount } from "../lib/enhanceCompositor";
import { formatDateTime } from "../lib/format";
import {
  generationConfigOptionLabel,
  generationConfigOptionsForPurpose,
  generationConfigSelectionMaxDimension,
} from "../lib/generationConfigs";
import { useEnhanceJob } from "../lib/hooks/useEnhanceJob";
import { DEFAULT_IMAGE_TOOL_ALLOWED_FIELDS } from "../lib/imageToolOptions";
import { useI18n } from "../lib/preferences";
import { activeGenerationResourceGroupsInApiOrder, firstActiveGenerationResourceGroupId } from "../lib/resourceGroups";
import { useSensitiveImageMaskPreference } from "../lib/sensitiveImagePreferences";
import { shouldShowSensitiveImageMaskPreference } from "../lib/sensitiveImages";
import {
  API_ENHANCE_GENERATE,
  API_GALLERY_WRITE,
  API_IMAGE_CHAT_GENERATE,
  API_IMAGE_CHAT_WRITE,
  API_INSPIRATIONS_WRITE,
  hasSessionApiPermission,
} from "../lib/rbac";
import { useSessionState } from "../lib/session";
import { DEFAULT_IMAGE_GENERATION_MAX_DIMENSION, buildImageSizeOptions } from "../lib/imageSizes";
import { useUiLayoutScheme } from "../lib/uiLayoutSchemePreference";
import { imageRoundSizeLabel, placeholderStatusClass, placeholderStatusLabel } from "./image-chat/display";
import { ImageChatHistoryPanel } from "./image-chat/ImageChatHistoryPanel";
import { ImageChatMainStage } from "./image-chat/ImageChatMainStage";
import { ImageChatSessionList } from "./image-chat/ImageChatSessionList";
import { InspirationAssociationPanel, SessionReferencePanel } from "./image-chat/ReferencePanels";
import {
  HISTORY_PANEL_DEFAULT_HEIGHT,
  HISTORY_PANEL_MIN_HEIGHT,
  LEFT_PANEL_DEFAULT_WIDTH,
  LEFT_PANEL_MIN_WIDTH,
  RIGHT_PANEL_DEFAULT_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
  clampImageChatPanelLayout,
  clampPanelSize,
  getHistoryPanelMaxHeight,
  getLeftPanelMaxWidth,
  getRightPanelMaxWidth,
} from "./image-chat/resizableLayout";
import {
  buildImageGenerationSubmitSignature,
  buildImageSessionHistoryTree,
  addImageBaseAssetIds,
  canStartImageSessionNewRound,
  clampGenerationCount,
  clampImageGenerationTaskCandidateCount,
  compactImageToolOptions,
  effectiveImageGenerationSubmitCount,
  findImageHistoryPlaceholder,
  imageChatSessionFilterRouteStateFromSearchParams,
  imageGenerationTaskSubmitPayload,
  imageSessionNewRoundDefaultResourceGroupId,
  isImageSessionGenerationTaskActive,
  isImageSessionGenerationTaskCancelable,
  isImageSessionGenerationTaskRegeneratable,
  isImageSessionGenerationTaskRetryable,
  legacyBaseAssetIdFromBaseAssetIds,
  latestImageSessionGenerationState,
  mergeImageSessionStatusIntoDetail,
  removeImageBaseAssetId,
  reconcileImageSessionSelection,
  selectSubmittedImageGenerationTaskPlaceholderId,
  shouldBlockDuplicateGenerationSubmit,
  shouldRefreshImageSessionDetailFromStatus,
  uniqueImageAssetIds,
} from "./image-chat/branching";
import type {
  ImageGenerationSubmitGuard,
  ImageGenerationSubmitPayload,
} from "./image-chat/branching";
import type {
  GenerationConfigOption,
  GenerationConfigSelectionMode,
  GenerationResourceGroup,
  CreateEnhanceJobInput,
  EnhanceJob,
  EnhanceStrategy,
  ImageSessionDetail,
  ImageSessionAsset,
  ImageSessionRound,
  ImageSessionGenerationTask,
  ImageSessionListResponse,
  ImageSessionSummary,
  ImageSessionStatus,
  ImageToolOptions,
  ModerationFields,
  ResourceLibraryAsset,
  SessionUser,
  SourceAsset,
} from "../lib/types";

const DUPLICATE_GENERATION_SUBMIT_WINDOW_MS = 1800;
const DEFAULT_IMAGE_SESSION_MAX_BASE_IMAGES = 6;
const DESKTOP_RESIZABLE_LAYOUT_QUERY = "(min-width: 1024px)";
const INSPIRATION_PICKER_LIST_STALE_TIME_MS = 60_000;
const RUNTIME_CONFIG_STALE_TIME_MS = 5 * 60_000;
const RBAC_USERS_STALE_TIME_MS = 5 * 60_000;
const IMAGE_CHAT_GENERATION_COUNT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const IMAGE_CHAT_ENHANCE_DIRECT_PRESETS = [1024, 2048, 2560, 3072, 4096] as const;
const IMAGE_CHAT_ENHANCE_SCALES = [2, 3, 4] as const;
const ENHANCE_FINAL_MAX_EDGE = 16_384;
const ENHANCE_FINAL_MAX_PIXELS = 120_000_000;

type ImageChatResizeTarget = "left" | "right" | "history";
type ImageChatGenerationDraftMode = "new_round" | "retry";
type ImageChatMode = "normal" | "enhance";

interface ImageChatRouteState {
  selectedSessionId: string | null;
  selectedGeneratedAssetId: string | null;
  selectedTaskPlaceholderId: string | null;
  selectedBaseAssetIds: string[];
  branchBaseAssetId: string | null;
  selectedReferenceAssetIds: string[];
  generationCount: number;
  draft: string;
  size: string;
  toolOptions: ImageToolOptions;
  settingsTab: ImageGenerationSettingsTab;
  targetInspirationId: string;
  selectedResourceGroupId: string | null;
  selectedSessionResourceGroupId: string | null;
  selectedSessionOwnerUserId: string;
  onlyDeletedSessions: boolean;
}

const imageChatRouteStateCache = new Map<string, ImageChatRouteState>();

function getImageChatRouteStateScope(inspirationId: string | undefined): string {
  return inspirationId ? `inspiration:${inspirationId}` : "standalone";
}

function readImageChatRouteState(scope: string): ImageChatRouteState | undefined {
  const cached = imageChatRouteStateCache.get(scope);
  if (!cached) {
    return undefined;
  }
  return {
    ...cached,
    selectedBaseAssetIds: [...(cached.selectedBaseAssetIds ?? [])],
    selectedReferenceAssetIds: [...cached.selectedReferenceAssetIds],
    toolOptions: { ...cached.toolOptions },
  };
}

function writeImageChatRouteState(scope: string, state: ImageChatRouteState) {
  imageChatRouteStateCache.set(scope, {
    ...state,
    selectedBaseAssetIds: [...state.selectedBaseAssetIds],
    selectedReferenceAssetIds: [...state.selectedReferenceAssetIds],
    toolOptions: { ...state.toolOptions },
  });
}

function isDesktopImageChatLayout(): boolean {
  return typeof window !== "undefined" && window.matchMedia(DESKTOP_RESIZABLE_LAYOUT_QUERY).matches;
}

function getSessionReferenceAssets(imageSession: ImageSessionDetail | undefined): ImageSessionAsset[] {
  return imageSession?.assets.filter((asset) => asset.kind === "reference_upload") ?? [];
}

function firstBlockedResource(resources: Array<ModerationFields | null | undefined>): ModerationFields | null {
  return resources.find((resource) => isResourceBlocked(resource)) ?? null;
}

function isAdminReadonlyResource(
  user: { id: string; is_admin: boolean } | null | undefined,
  resource: { owner_user_id?: string | null } | null | undefined,
): boolean {
  return Boolean(user?.is_admin && resource?.owner_user_id && user.id !== resource.owner_user_id);
}

function hasAdminReadonlyResource(
  user: { id: string; is_admin: boolean } | null | undefined,
  resources: Array<{ owner_user_id?: string | null } | null | undefined>,
): boolean {
  return resources.some((resource) => isAdminReadonlyResource(user, resource));
}

function resourceGroupOptionLabel(group: GenerationResourceGroup, disabledLabel: string): string {
  const markers = [!group.enabled ? disabledLabel : ""].filter(Boolean);
  const suffix = markers.length ? ` (${markers.join(" · ")})` : "";
  return `${group.name}${suffix}`;
}

function ownerOptionLabel(user: Pick<SessionUser, "display_name" | "username">): string {
  return `${user.display_name || user.username} (${user.username})`;
}

type PendingDeleteAction =
  | { kind: "session"; sessionId: string }
  | { kind: "inspirationReference"; assetId: string }
  | { kind: "sessionReference"; sessionId: string; assetId: string };

interface ReferenceImagePreview {
  asset: ImageSessionAsset | SourceAsset;
  title: string;
}

function assertImageChatActionAllowed(blockedTitle: string | null) {
  if (blockedTitle) {
    throw new ApiError(403, blockedTitle);
  }
}

interface ImageChatPageProps {
  mode?: "auto" | "workbench";
}

export function ImageChatPage(props: ImageChatPageProps = {}) {
  void props.mode;
  return <ImageChatWorkbenchPage />;
}

function ImageChatWorkbenchPage() {
  const { t } = useI18n();
  const { activeScheme } = useUiLayoutScheme();
  const sessionState = useSessionState();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { inspirationId } = useParams();
  const isInspirationMode = Boolean(inspirationId);
  const routeStateScope = getImageChatRouteStateScope(inspirationId);
  const initialRouteState = useMemo<Partial<ImageChatRouteState> | undefined>(() => {
    const cached = readImageChatRouteState(routeStateScope);
    const sessionFilterRouteState = imageChatSessionFilterRouteStateFromSearchParams(searchParams);
    if (!sessionFilterRouteState) {
      return cached;
    }
    return {
      ...cached,
      ...sessionFilterRouteState,
    };
  }, [routeStateScope, searchParams]);
  const pendingGeneratedRoundCountRef = useRef<number | null>(null);
  const duplicateSubmitGuardRef = useRef<ImageGenerationSubmitGuard | null>(null);
  const createSessionRouteIntentConsumedRef = useRef(false);
  const pendingCreatedSessionIdRef = useRef<string | null>(null);
  const mobileSessionButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileHistoryButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobileSettingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const createSessionDialogTitleId = useId();
  const createSessionDialogDescriptionId = useId();
  const workspaceSubpage = activeScheme === "workspace";
  const actionAppearance: LayoutActionAppearance = workspaceSubpage ? "workspace" : "classic";
  const inputAppearance = workspaceSubpage ? "workspace" : "classic";
  const ActionButton = actionButtonComponentForAppearance(actionAppearance);
  const LayoutCheckbox = workspaceSubpage ? WorkspaceCheckbox : ClassicCheckbox;
  const LayoutSelectField = workspaceSubpage ? WorkspaceSelectField : ClassicSelectField;
  const LayoutTextInput = workspaceSubpage ? WorkspaceTextInput : ClassicTextInput;
  const LayoutTextarea = workspaceSubpage ? WorkspaceTextarea : ClassicTextarea;
  const secondaryIconCompactButtonClassName = actionButtonClassNameForAppearance(actionAppearance, {
    preset: "secondary",
    size: "icon-sm",
  });
  const dangerIconCompactButtonClassName = actionButtonClassNameForAppearance(actionAppearance, {
    preset: "danger",
    size: "icon-sm",
  });
  const previewSurfaceClassName = actionSurfaceClassNameForAppearance(actionAppearance, {
    preset: "secondary",
    focusWithin: true,
    className: "block w-full rounded-none border-0 shadow-none",
  });
  const ghostSurfaceToneVars: ActionButtonToneVars = {
    ...transparentActionToneVars,
    "--pf-action-bg-hover": "color-mix(in srgb, var(--pf-panel) 88%, transparent)",
  };
  const resizeHandleToneVars: ActionButtonToneVars = {
    ...transparentActionToneVars,
    "--pf-action-bg-hover": "color-mix(in srgb, var(--pf-accent) 14%, transparent)",
  };

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    () => initialRouteState?.selectedSessionId ?? null,
  );
  const [selectedGeneratedAssetId, setSelectedGeneratedAssetId] = useState<string | null>(
    () => initialRouteState?.selectedGeneratedAssetId ?? null,
  );
  const [selectedTaskPlaceholderId, setSelectedTaskPlaceholderId] = useState<string | null>(
    () => initialRouteState?.selectedTaskPlaceholderId ?? null,
  );
  const [selectedBaseAssetIds, setSelectedBaseAssetIds] = useState<string[]>(() => {
    const cached = initialRouteState;
    return uniqueImageAssetIds([
      ...(cached?.selectedBaseAssetIds ?? []),
      cached?.branchBaseAssetId,
      ...(cached?.selectedReferenceAssetIds ?? []),
    ]);
  });
  const [lastExplicitHistoryAssetId, setLastExplicitHistoryAssetId] = useState<string | null>(
    () => initialRouteState?.selectedGeneratedAssetId ?? null,
  );
  const [generationCount, setGenerationCount] = useState(
    () => initialRouteState?.generationCount ?? 1,
  );
  const [draft, setDraft] = useState(() => initialRouteState?.draft ?? "");
  const [size, setSize] = useState(() => initialRouteState?.size ?? "1024x1024");
  const [toolOptions, setToolOptions] = useState<ImageToolOptions>(
    () => initialRouteState?.toolOptions ?? {},
  );
  const [settingsTab, setSettingsTab] = useState<ImageGenerationSettingsTab>(
    () => initialRouteState?.settingsTab ?? "basic",
  );
  const [promptPolishConfigMode, setPromptPolishConfigMode] = useState<GenerationConfigSelectionMode>("auto");
  const [promptPolishConfigId, setPromptPolishConfigId] = useState<string | null>(null);
  const [generationConfigMode, setGenerationConfigMode] = useState<GenerationConfigSelectionMode>("auto");
  const [generationConfigId, setGenerationConfigId] = useState<string | null>(null);
  const [chatMode, setChatMode] = useState<ImageChatMode>("normal");
  const [enhanceSourceAssetId, setEnhanceSourceAssetId] = useState("");
  const [enhanceStrategy, setEnhanceStrategy] = useState<EnhanceStrategy>("direct");
  const [enhanceDirectWidth, setEnhanceDirectWidth] = useState("2048");
  const [enhanceDirectHeight, setEnhanceDirectHeight] = useState("2048");
  const [enhanceScale, setEnhanceScale] = useState<(typeof IMAGE_CHAT_ENHANCE_SCALES)[number]>(2);
  const [enhanceTileBaseSize, setEnhanceTileBaseSize] = useState("1024");
  const [activeEnhanceJobId, setActiveEnhanceJobId] = useState<string | null>(null);
  const [processingEnhanceJobId, setProcessingEnhanceJobId] = useState<string | null>(null);
  const [attachedEnhanceJobIds, setAttachedEnhanceJobIds] = useState<Set<string>>(() => new Set());
  const [failedEnhanceAttachJobIds, setFailedEnhanceAttachJobIds] = useState<Set<string>>(() => new Set());
  const [savedEnhanceJobIds, setSavedEnhanceJobIds] = useState<Set<string>>(() => new Set());
  const [enhanceSourceImageSize, setEnhanceSourceImageSize] = useState<{ width: number; height: number } | null>(null);
  const [selectedResourceGroupId, setSelectedResourceGroupId] = useState<string | null>(
    () => initialRouteState?.selectedResourceGroupId ?? null,
  );
  const [selectedSessionResourceGroupId, setSelectedSessionResourceGroupId] = useState<string | null>(
    () => initialRouteState?.selectedSessionResourceGroupId ?? null,
  );
  const [selectedSessionOwnerUserId, setSelectedSessionOwnerUserId] = useState(
    () => initialRouteState?.selectedSessionOwnerUserId ?? "",
  );
  const [sessionOwnerFilterInitialized, setSessionOwnerFilterInitialized] = useState(
    () => initialRouteState !== undefined,
  );
  const [selectedSessionOwnerSearch, setSelectedSessionOwnerSearch] = useState("");
  const [onlyDeletedSessions, setOnlyDeletedSessions] = useState(
    () => initialRouteState?.onlyDeletedSessions ?? false,
  );
  const [sessionFiltersExpanded, setSessionFiltersExpanded] = useState(false);
  const [createSessionDialogOpen, setCreateSessionDialogOpen] = useState(false);
  const [createSessionResourceGroupId, setCreateSessionResourceGroupId] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [renameEnabled, setRenameEnabled] = useState(false);
  const [targetInspirationId, setTargetInspirationId] = useState(
    () => initialRouteState?.targetInspirationId ?? "",
  );
  const [promptPreview, setPromptPreview] = useState<PromptPreview | null>(null);
  const [polishedPrompt, setPolishedPrompt] = useState("");
  const [previewRound, setPreviewRound] = useState<ImageSessionRound | null>(null);
  const [previewPromptCopyState, setPreviewPromptCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [referencePreview, setReferencePreview] = useState<ReferenceImagePreview | null>(null);
  const [resourceLibraryOpen, setResourceLibraryOpen] = useState(false);
  const [resourceLibrarySaveSource, setResourceLibrarySaveSource] = useState<ResourceLibrarySaveSource | null>(null);
  const [pendingDeleteAction, setPendingDeleteAction] =
    useState<PendingDeleteAction | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [leftPanelWidth, setLeftPanelWidth] = useState(LEFT_PANEL_DEFAULT_WIDTH);
  const [rightPanelWidth, setRightPanelWidth] = useState(RIGHT_PANEL_DEFAULT_WIDTH);
  const [historyPanelHeight, setHistoryPanelHeight] = useState(HISTORY_PANEL_DEFAULT_HEIGHT);
  const [mobileSessionDrawerOpen, setMobileSessionDrawerOpen] = useState(false);
  const [mobileHistoryDrawerOpen, setMobileHistoryDrawerOpen] = useState(false);
  const [mobileGenerationSheetOpen, setMobileGenerationSheetOpen] = useState(false);
  const [newRoundChoiceOpen, setNewRoundChoiceOpen] = useState(false);
  const [generationDraftMode, setGenerationDraftMode] = useState<ImageChatGenerationDraftMode | null>(null);
  const [retryGenerationTaskId, setRetryGenerationTaskId] = useState<string | null>(null);
  const [galleryTagPickerAsset, setGalleryTagPickerAsset] = useState<ImageSessionAsset | null>(null);
  const [galleryTagPickerError, setGalleryTagPickerError] = useState("");

  const leftPanelStyle = {
    "--image-chat-left-panel-width": `${leftPanelWidth}px`,
  } as CSSProperties;
  const rightPanelStyle = {
    "--image-chat-right-panel-width": `${rightPanelWidth}px`,
  } as CSSProperties;
  const historyPanelStyle = {
    "--image-chat-history-panel-height": `${historyPanelHeight}px`,
  } as CSSProperties;
  const currentUser = sessionState?.user ?? null;
  const [maskSensitiveImages, setMaskSensitiveImages] = useSensitiveImageMaskPreference("image-chat");
  const isAdmin = Boolean(currentUser?.is_admin);

  useEffect(() => {
    if (!isAdmin || !currentUser?.id || sessionOwnerFilterInitialized) {
      return;
    }
    setSelectedSessionOwnerUserId((current) => current || currentUser.id);
    setSessionOwnerFilterInitialized(true);
  }, [currentUser?.id, isAdmin, sessionOwnerFilterInitialized]);

  useEffect(() => {
    writeImageChatRouteState(routeStateScope, {
      selectedSessionId,
      selectedGeneratedAssetId,
      selectedTaskPlaceholderId,
      selectedBaseAssetIds,
      branchBaseAssetId: legacyBaseAssetIdFromBaseAssetIds(selectedBaseAssetIds),
      selectedReferenceAssetIds: selectedBaseAssetIds,
      generationCount,
      draft,
      size,
      toolOptions,
      settingsTab,
      targetInspirationId,
      selectedResourceGroupId,
      selectedSessionResourceGroupId,
      selectedSessionOwnerUserId,
      onlyDeletedSessions,
    });
  }, [
    draft,
    generationCount,
    routeStateScope,
    selectedBaseAssetIds,
    selectedGeneratedAssetId,
    selectedResourceGroupId,
    selectedSessionOwnerUserId,
    selectedSessionResourceGroupId,
    selectedSessionId,
    selectedTaskPlaceholderId,
    onlyDeletedSessions,
    settingsTab,
    size,
    targetInspirationId,
    toolOptions,
  ]);

  useEffect(() => {
    function clampPanelSizesToViewport() {
      if (!window.matchMedia(DESKTOP_RESIZABLE_LAYOUT_QUERY).matches) {
        return;
      }
      const nextLayout = clampImageChatPanelLayout(
        {
          leftPanelWidth,
          rightPanelWidth,
          historyPanelHeight,
        },
        {
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        },
      );
      if (nextLayout.leftPanelWidth !== leftPanelWidth) {
        setLeftPanelWidth(nextLayout.leftPanelWidth);
      }
      if (nextLayout.rightPanelWidth !== rightPanelWidth) {
        setRightPanelWidth(nextLayout.rightPanelWidth);
      }
      if (nextLayout.historyPanelHeight !== historyPanelHeight) {
        setHistoryPanelHeight(nextLayout.historyPanelHeight);
      }
    }

    clampPanelSizesToViewport();
    window.addEventListener("resize", clampPanelSizesToViewport);
    return () => window.removeEventListener("resize", clampPanelSizesToViewport);
  }, [historyPanelHeight, leftPanelWidth, rightPanelWidth]);

  useEffect(() => {
    const desktopLayoutQuery = window.matchMedia(DESKTOP_RESIZABLE_LAYOUT_QUERY);
    const closeMobileSurfacesOnDesktop = () => {
      if (!desktopLayoutQuery.matches) {
        return;
      }
      setMobileSessionDrawerOpen(false);
      setMobileHistoryDrawerOpen(false);
      setMobileGenerationSheetOpen(false);
    };
    closeMobileSurfacesOnDesktop();
    desktopLayoutQuery.addEventListener("change", closeMobileSurfacesOnDesktop);
    return () => desktopLayoutQuery.removeEventListener("change", closeMobileSurfacesOnDesktop);
  }, []);

  const deferredSessionOwnerSearch = useDeferredValue(selectedSessionOwnerSearch.trim());
  const sessionListScope = inspirationId ?? "standalone";
  const sessionListQueryKey = [
    "image-sessions",
    sessionListScope,
    selectedSessionResourceGroupId,
    isAdmin ? selectedSessionOwnerUserId : "",
    isAdmin && onlyDeletedSessions,
  ] as const;
  const sessionsQuery = useQuery({
    queryKey: sessionListQueryKey,
    queryFn: () =>
      api.listImageSessions(inspirationId, {
        resource_group_id: selectedSessionResourceGroupId || null,
        owner_user_id: isAdmin ? selectedSessionOwnerUserId || undefined : undefined,
        only_deleted: isAdmin && onlyDeletedSessions,
      }),
    enabled: selectedSessionResourceGroupId !== null && (!isAdmin || sessionOwnerFilterInitialized),
  });

  const sessionItems = sessionsQuery.data?.items ?? [];
  const selectedSessionSummary = useMemo<ImageSessionSummary | null>(
    () => sessionItems.find((item) => item.id === selectedSessionId) ?? null,
    [selectedSessionId, sessionItems],
  );

  const inspirationQuery = useQuery({
    queryKey: ["inspiration", inspirationId],
    queryFn: () => api.getInspiration(inspirationId!),
    enabled: isInspirationMode,
  });

  const inspirationsQuery = useQuery({
    queryKey: ["inspirations", selectedResourceGroupId],
    queryFn: () =>
      api.listInspirations({
        resource_group_id: selectedResourceGroupId ?? "",
        page_size: 100,
      }),
    enabled: !isInspirationMode && Boolean(selectedResourceGroupId),
    placeholderData: keepPreviousData,
    staleTime: INSPIRATION_PICKER_LIST_STALE_TIME_MS,
  });
  const runtimeConfigQuery = useQuery({
    queryKey: ["runtime-config"],
    queryFn: api.getRuntimeConfig,
    staleTime: RUNTIME_CONFIG_STALE_TIME_MS,
  });
  const generationResourceGroupsQuery = useQuery({
    queryKey: ["my-generation-resource-groups"],
    queryFn: api.listMyGenerationResourceGroups,
    staleTime: RUNTIME_CONFIG_STALE_TIME_MS,
  });
  const generationConfigOptionsQuery = useQuery({
    queryKey: ["generation-config-options"],
    queryFn: api.listGenerationConfigOptions,
    staleTime: RUNTIME_CONFIG_STALE_TIME_MS,
  });
  const galleryTagsQuery = useQuery({
    queryKey: ["gallery-tags", "active"],
    queryFn: () => api.listGalleryTags(),
    enabled: Boolean(galleryTagPickerAsset),
    staleTime: RUNTIME_CONFIG_STALE_TIME_MS,
  });
  const rbacUsersQuery = useQuery({
    queryKey: ["rbac-users", "image-session-owner-filter", deferredSessionOwnerSearch],
    queryFn: () => api.listRbacUsers({ page_size: 30, query: deferredSessionOwnerSearch || undefined }),
    enabled: isAdmin,
    retry: false,
    staleTime: RBAC_USERS_STALE_TIME_MS,
  });

  const inspirations = inspirationsQuery.data?.items ?? [];
  const rbacUsers = rbacUsersQuery.data?.items ?? [];
  const globalImageGenerationMaxDimension =
    runtimeConfigQuery.data?.image_generation_max_dimension ?? DEFAULT_IMAGE_GENERATION_MAX_DIMENSION;
  const generationConfigOptions = generationConfigOptionsQuery.data ?? [];
  const resourceGroups = useMemo(
    () => activeGenerationResourceGroupsInApiOrder(generationResourceGroupsQuery.data),
    [generationResourceGroupsQuery.data],
  );
  const selectedResourceGroup = useMemo(
    () => resourceGroups.find((group) => group.id === selectedResourceGroupId) ?? null,
    [resourceGroups, selectedResourceGroupId],
  );
  const promptPolishConfigOptions = useMemo(
    () => generationConfigOptionsForPurpose(generationConfigOptions, "text", selectedResourceGroupId),
    [generationConfigOptions, selectedResourceGroupId],
  );
  const imageGenerationConfigOptions = useMemo(
    () => generationConfigOptionsForPurpose(generationConfigOptions, "image", selectedResourceGroupId),
    [generationConfigOptions, selectedResourceGroupId],
  );

  const effectiveMaxDimension = useMemo(() => {
    return generationConfigSelectionMaxDimension({
      mode: generationConfigMode,
      generationConfigId,
      resourceGroupId: selectedResourceGroupId,
      resourceGroupMaxDimension: selectedResourceGroup?.image_max_dimension,
      options: imageGenerationConfigOptions,
      globalMaxDimension: globalImageGenerationMaxDimension,
    });
  }, [
    generationConfigMode,
    generationConfigId,
    selectedResourceGroupId,
    selectedResourceGroup,
    imageGenerationConfigOptions,
    globalImageGenerationMaxDimension,
  ]);

  const imageGenerationMaxDimension = effectiveMaxDimension;
  const maxSelectedBaseImageCount = Math.max(
    0,
    Math.round(runtimeConfigQuery.data?.image_session_max_base_images ?? DEFAULT_IMAGE_SESSION_MAX_BASE_IMAGES),
  );
  const imageToolAllowedFields = runtimeConfigQuery.data?.image_tool_allowed_fields ?? DEFAULT_IMAGE_TOOL_ALLOWED_FIELDS;
  const deletionEnabled = runtimeConfigQuery.data?.deletion_enabled ?? false;
  const galleryEntryTagMaxSelection = Math.max(
    1,
    Math.floor(runtimeConfigQuery.data?.gallery_entry_tag_max_selection ?? 10),
  );
  const galleryTagRequiredOnSave = runtimeConfigQuery.data?.gallery_tag_required_on_save ?? false;
  const galleryTags = galleryTagsQuery.data ?? [];
  const sizeOptions = useMemo(() => buildImageSizeOptions(imageGenerationMaxDimension), [imageGenerationMaxDimension]);
  const currentInspiration = isInspirationMode
    ? (inspirationQuery.data ?? null)
    : (inspirations.find((inspiration) => inspiration.id === targetInspirationId) ?? null);
  const currentInspirationBlocked = isResourceBlocked(currentInspiration);
  const currentInspirationAdminReadonly = isAdminReadonlyResource(currentUser, currentInspiration);
  const adminReadonlyActionTitle = t("resource.adminReadonlyAction");
  const canWriteImageChat = hasSessionApiPermission(sessionState, API_IMAGE_CHAT_WRITE);
  const canGenerateImageChat = hasSessionApiPermission(sessionState, API_IMAGE_CHAT_GENERATE);
  const canGenerateEnhance = hasSessionApiPermission(sessionState, API_ENHANCE_GENERATE);
  const canWriteGallery = hasSessionApiPermission(sessionState, API_GALLERY_WRITE);
  const canWriteInspirations = hasSessionApiPermission(sessionState, API_INSPIRATIONS_WRITE);
  const imageChatWritePermissionTitle = canWriteImageChat ? null : t("chat.permission.imageChatWriteRequired");
  const imageChatGeneratePermissionTitle = canGenerateImageChat ? null : t("chat.permission.imageChatGenerateRequired");
  const enhanceGeneratePermissionTitle = canGenerateEnhance ? null : t("chat.permission.enhanceGenerateRequired");
  const galleryWritePermissionTitle = canWriteGallery ? null : t("chat.permission.galleryWriteRequired");
  const inspirationsWritePermissionTitle = canWriteInspirations ? null : t("chat.permission.inspirationsWriteRequired");
  const createSessionBlockedTitle =
    isInspirationMode && currentInspirationBlocked
      ? blockedActionMessage(currentInspiration)
      : isInspirationMode && currentInspirationAdminReadonly
        ? adminReadonlyActionTitle
        : imageChatWritePermissionTitle;

  function blockedActionMessage(resource: ModerationFields | null | undefined) {
    return getResourceBlockedActionTitle(resource, t("resource.blockedAction"));
  }

  useEffect(() => {
    if (!generationResourceGroupsQuery.isFetched) {
      return;
    }
    if (!resourceGroups.length) {
      if (selectedResourceGroupId) {
        setSelectedResourceGroupId(null);
      }
      if (selectedSessionResourceGroupId === null) {
        setSelectedSessionResourceGroupId("");
      }
      return;
    }
    if (!selectedResourceGroupId || !resourceGroups.some((group) => group.id === selectedResourceGroupId)) {
      setSelectedResourceGroupId(firstActiveGenerationResourceGroupId(resourceGroups));
    }
    if (
      selectedSessionResourceGroupId === null ||
      (selectedSessionResourceGroupId && !resourceGroups.some((group) => group.id === selectedSessionResourceGroupId))
    ) {
      setSelectedSessionResourceGroupId(firstActiveGenerationResourceGroupId(resourceGroups));
    }
  }, [
    generationResourceGroupsQuery.isFetched,
    resourceGroups,
    selectedResourceGroupId,
    selectedSessionResourceGroupId,
  ]);

  useEffect(() => {
    if (promptPolishConfigMode !== "manual") {
      if (promptPolishConfigId) {
        setPromptPolishConfigId(null);
      }
      return;
    }
    if (!generationConfigOptionsQuery.isFetched || !promptPolishConfigId) {
      return;
    }
    if (!promptPolishConfigOptions.some((config) => config.id === promptPolishConfigId)) {
      setPromptPolishConfigMode("auto");
      setPromptPolishConfigId(null);
    }
  }, [
    generationConfigOptionsQuery.isFetched,
    promptPolishConfigId,
    promptPolishConfigMode,
    promptPolishConfigOptions,
  ]);

  useEffect(() => {
    if (generationConfigMode !== "manual") {
      if (generationConfigId) {
        setGenerationConfigId(null);
      }
      return;
    }
    if (!generationConfigOptionsQuery.isFetched || !generationConfigId) {
      return;
    }
    if (!imageGenerationConfigOptions.some((config) => config.id === generationConfigId)) {
      setGenerationConfigMode("auto");
      setGenerationConfigId(null);
    }
  }, [
    generationConfigId,
    generationConfigMode,
    generationConfigOptionsQuery.isFetched,
    imageGenerationConfigOptions,
  ]);

  function resetImageSessionSelection() {
    setSelectedGeneratedAssetId(null);
    setSelectedTaskPlaceholderId(null);
    setSelectedBaseAssetIds([]);
    setLastExplicitHistoryAssetId(null);
    setGenerationDraftMode(null);
    setRetryGenerationTaskId(null);
    setPromptPolishConfigMode("auto");
    setPromptPolishConfigId(null);
    setGenerationConfigMode("auto");
    setGenerationConfigId(null);
    setEnhanceSourceAssetId("");
    setActiveEnhanceJobId(null);
    setProcessingEnhanceJobId(null);
    setFailedEnhanceAttachJobIds(new Set());
  }

  function handleGenerationResourceGroupChange(value: string) {
    setSelectedResourceGroupId(value || null);
  }

  function clearPendingCreatedSessionSelection() {
    pendingCreatedSessionIdRef.current = null;
  }

  function handleSelectSession(sessionId: string) {
    clearPendingCreatedSessionSelection();
    setSelectedSessionId(sessionId);
    resetImageSessionSelection();
    setSuccessMessage("");
    setErrorMessage("");
    setMobileSessionDrawerOpen(false);
  }

  function handleSessionResourceGroupFilterChange(value: string) {
    clearPendingCreatedSessionSelection();
    setSelectedSessionResourceGroupId(value);
  }

  function handleSessionOwnerFilterChange(value: string) {
    clearPendingCreatedSessionSelection();
    setSelectedSessionOwnerUserId(value);
  }

  function handleOnlyDeletedSessionsChange(value: boolean) {
    clearPendingCreatedSessionSelection();
    setOnlyDeletedSessions(value);
  }

  useEffect(() => {
    if (isInspirationMode || !inspirationsQuery.isFetched) {
      return;
    }
    if (!inspirations.length) {
      if (targetInspirationId) {
        setTargetInspirationId("");
      }
      return;
    }
    if (!targetInspirationId || !inspirations.some((inspiration) => inspiration.id === targetInspirationId)) {
      setTargetInspirationId(inspirations[0].id);
    }
  }, [inspirations, inspirationsQuery.isFetched, isInspirationMode, targetInspirationId]);

  function defaultCreateSessionResourceGroupId(): string {
    if (selectedResourceGroupId && resourceGroups.some((group) => group.id === selectedResourceGroupId)) {
      return selectedResourceGroupId;
    }
    if (
      selectedSessionResourceGroupId &&
      resourceGroups.some((group) => group.id === selectedSessionResourceGroupId)
    ) {
      return selectedSessionResourceGroupId;
    }
    return firstActiveGenerationResourceGroupId(resourceGroups);
  }

  function openCreateSessionDialog() {
    if (createSessionBlockedTitle) {
      setErrorMessage(createSessionBlockedTitle);
      return;
    }
    if (generationResourceGroupsQuery.isLoading) {
      return;
    }
    const defaultResourceGroupId = defaultCreateSessionResourceGroupId();
    if (!defaultResourceGroupId) {
      setErrorMessage(t("chat.noResourceGroups"));
      return;
    }
    setCreateSessionResourceGroupId(defaultResourceGroupId);
    setCreateSessionDialogOpen(true);
    setSuccessMessage("");
    setErrorMessage("");
  }

  useEffect(() => {
    if (createSessionRouteIntentConsumedRef.current || searchParams.get("create_session") !== "1") {
      return;
    }
    if (!generationResourceGroupsQuery.isFetched) {
      return;
    }
    createSessionRouteIntentConsumedRef.current = true;
    openCreateSessionDialog();
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("create_session");
    setSearchParams(nextSearchParams, { replace: true });
  }, [generationResourceGroupsQuery.isFetched, searchParams, setSearchParams]);

  const createSessionMutation = useMutation({
    mutationFn: ({ resourceGroupId }: { resourceGroupId: string }) => {
      if (createSessionBlockedTitle) {
        throw new Error(createSessionBlockedTitle);
      }
      return api.createImageSession(
        inspirationId
          ? { inspiration_id: inspirationId, resource_group_id: resourceGroupId }
          : { resource_group_id: resourceGroupId },
      );
    },
    onSuccess: async (imageSession, variables) => {
      pendingCreatedSessionIdRef.current = imageSession.id;
      setSelectedSessionId(imageSession.id);
      setSelectedResourceGroupId(variables.resourceGroupId);
      setSelectedSessionResourceGroupId(variables.resourceGroupId);
      setCreateSessionDialogOpen(false);
      resetImageSessionSelection();
      queryClient.setQueryData(["image-session", imageSession.id], imageSession);
      await queryClient.invalidateQueries({ queryKey: ["image-sessions", sessionListScope] });
      setErrorMessage("");
    },
    onError: (error) => {
      setErrorMessage(
        error instanceof ApiError
          ? error.detail
          : error instanceof Error
            ? error.message
            : t("chat.createFailed"),
      );
    },
  });

  function handleConfirmCreateSession() {
    if (createSessionMutation.isPending) {
      return;
    }
    const resourceGroupId = createSessionResourceGroupId || defaultCreateSessionResourceGroupId();
    if (!resourceGroupId) {
      setErrorMessage(t("chat.resourceGroupRequired"));
      return;
    }
    createSessionMutation.mutate({ resourceGroupId });
  }

  useEffect(() => {
    if (!createSessionDialogOpen || createSessionMutation.isPending) {
      return undefined;
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setCreateSessionDialogOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [createSessionDialogOpen, createSessionMutation.isPending]);

  useEffect(() => {
    if (sessionsQuery.isLoading) {
      return;
    }
    if (selectedSessionId && sessionItems.some((item) => item.id === selectedSessionId)) {
      if (pendingCreatedSessionIdRef.current === selectedSessionId) {
        pendingCreatedSessionIdRef.current = null;
      }
      return;
    }
    // Newly created sessions are selected before the invalidated list refetch includes them.
    if (selectedSessionId && pendingCreatedSessionIdRef.current === selectedSessionId) {
      return;
    }
    if (sessionItems.length) {
      setSelectedSessionId(sessionItems[0].id);
      resetImageSessionSelection();
      return;
    }
    if (selectedSessionId) {
      setSelectedSessionId(null);
      resetImageSessionSelection();
    }
  }, [
    selectedSessionId,
    sessionItems,
    sessionsQuery.isLoading,
  ]);

  const sessionDetailQuery = useQuery({
    queryKey: ["image-session", selectedSessionId],
    queryFn: () => api.getImageSession(selectedSessionId!),
    enabled: Boolean(selectedSessionId),
  });

  const imageSession = sessionDetailQuery.data;
  const latestGenerationState = useMemo(
    () => latestImageSessionGenerationState(imageSession?.rounds ?? [], imageSession?.generation_tasks ?? []),
    [imageSession],
  );
  const historyBranches = useMemo(
    () => buildImageSessionHistoryTree(imageSession?.rounds ?? [], imageSession?.generation_tasks ?? []),
    [imageSession],
  );
  const sessionReferenceAssets = useMemo(() => getSessionReferenceAssets(imageSession), [imageSession]);
  const imageSessionAssetsById = useMemo(
    () => new Map((imageSession?.assets ?? []).map((asset) => [asset.id, asset])),
    [imageSession],
  );
  const enhanceSourceAssets = useMemo(
    () =>
      (imageSession?.assets ?? []).filter(
        (asset) => asset.kind === "generated_image" || asset.kind === "reference_upload",
      ),
    [imageSession],
  );
  const selectedEnhanceSourceAsset = enhanceSourceAssetId
    ? (imageSessionAssetsById.get(enhanceSourceAssetId) ?? null)
    : null;
  const selectedBaseAssets = selectedBaseAssetIds
    .map((assetId) => imageSessionAssetsById.get(assetId))
    .filter((asset): asset is ImageSessionAsset => Boolean(asset));
  const maxSelectedReferenceCount = maxSelectedBaseImageCount;
  const compactedToolOptions = useMemo(
    () => compactImageToolOptions(toolOptions, imageToolAllowedFields),
    [imageToolAllowedFields, toolOptions],
  );
  const submitGenerationCount = effectiveImageGenerationSubmitCount(generationCount, compactedToolOptions);
  const hasActiveGenerationTask = imageSession?.generation_tasks.some(isImageSessionGenerationTaskActive) ?? false;
  const activeEnhanceJobQuery = useEnhanceJob(activeEnhanceJobId);
  const activeEnhanceJob = activeEnhanceJobQuery.data ?? null;
  const activeEnhanceAttachedRound = useMemo(
    () => imageSession?.rounds.find((round) => round.provider_response_id === activeEnhanceJobId) ?? null,
    [activeEnhanceJobId, imageSession],
  );

  const sessionStatusQuery = useQuery({
    queryKey: ["image-session-status", selectedSessionId],
    queryFn: () => api.getImageSessionStatus(selectedSessionId!),
    enabled: Boolean(selectedSessionId && hasActiveGenerationTask),
    refetchInterval: (query) => {
      const data = query.state.data as ImageSessionStatus | undefined;
      return data?.has_active_generation_task ? 1500 : false;
    },
  });

  useEffect(() => {
    const status = sessionStatusQuery.data;
    if (!status || !selectedSessionId || status.id !== selectedSessionId) {
      return;
    }
    const detail = queryClient.getQueryData<ImageSessionDetail>(["image-session", status.id]);
    const shouldRefetchDetail = shouldRefreshImageSessionDetailFromStatus(detail, status);
    if (detail) {
      queryClient.setQueryData(["image-session", status.id], mergeImageSessionStatusIntoDetail(detail, status));
    }
    if (shouldRefetchDetail) {
      void queryClient.invalidateQueries({ queryKey: ["image-session", status.id] });
      void queryClient.invalidateQueries({ queryKey: ["image-sessions", sessionListScope] });
    }
  }, [queryClient, selectedSessionId, sessionListScope, sessionStatusQuery.data]);

  useEffect(() => {
    if (!imageSession) {
      return;
    }
    setTitleDraft(imageSession.title);
    const reconciled = reconcileImageSessionSelection({
      rounds: imageSession.rounds,
      generationTasks: imageSession.generation_tasks,
      historyBranches,
      selectedGeneratedAssetId,
      selectedTaskPlaceholderId,
      selectedBaseAssetIds,
      availableBaseAssetIds: imageSession.assets.map((asset) => asset.id),
      maxSelectedBaseCount: maxSelectedBaseImageCount,
      pendingGeneratedRoundCount: pendingGeneratedRoundCountRef.current,
    });

    if (reconciled.selectedGeneratedAssetId !== selectedGeneratedAssetId) {
      setSelectedGeneratedAssetId(reconciled.selectedGeneratedAssetId);
    }
    if (reconciled.selectedTaskPlaceholderId !== selectedTaskPlaceholderId) {
      setSelectedTaskPlaceholderId(reconciled.selectedTaskPlaceholderId);
    }
    if (reconciled.selectedBaseAssetIds !== selectedBaseAssetIds) {
      setSelectedBaseAssetIds(reconciled.selectedBaseAssetIds);
    }
    pendingGeneratedRoundCountRef.current = reconciled.pendingGeneratedRoundCount;

    if (reconciled.generatedRoundCompleted) {
      setGenerationDraftMode(null);
      setRetryGenerationTaskId(null);
      setSuccessMessage(t("chat.newCandidate"));
      setErrorMessage("");
    }
  }, [
    historyBranches,
    imageSession,
    maxSelectedBaseImageCount,
    selectedBaseAssetIds,
    selectedGeneratedAssetId,
    selectedTaskPlaceholderId,
  ]);

  const selectedRound = useMemo(() => {
    if (selectedTaskPlaceholderId) {
      return null;
    }
    if (!imageSession?.rounds.length) {
      return null;
    }
    return (
      imageSession.rounds.find((round) => round.generated_asset.id === selectedGeneratedAssetId) ?? imageSession.rounds.at(-1) ?? null
    );
  }, [imageSession, selectedGeneratedAssetId, selectedTaskPlaceholderId]);

  useEffect(() => {
    if (chatMode !== "enhance") {
      return;
    }
    if (enhanceSourceAssetId && enhanceSourceAssets.some((asset) => asset.id === enhanceSourceAssetId)) {
      return;
    }
    const selectedRoundAssetId = selectedRound?.generated_asset.id;
    const fallbackAssetId =
      (selectedRoundAssetId && enhanceSourceAssets.some((asset) => asset.id === selectedRoundAssetId)
        ? selectedRoundAssetId
        : enhanceSourceAssets[0]?.id) ?? "";
    setEnhanceSourceAssetId(fallbackAssetId);
  }, [chatMode, enhanceSourceAssetId, enhanceSourceAssets, selectedRound?.generated_asset.id]);

  useEffect(() => {
    if (chatMode !== "enhance" || !selectedEnhanceSourceAsset) {
      setEnhanceSourceImageSize(null);
      return;
    }
    let cancelled = false;
    setEnhanceSourceImageSize(null);
    const image = new Image();
    image.onload = () => {
      if (!cancelled && image.naturalWidth > 0 && image.naturalHeight > 0) {
        setEnhanceSourceImageSize({ width: image.naturalWidth, height: image.naturalHeight });
      }
    };
    image.onerror = () => {
      if (!cancelled) {
        setEnhanceSourceImageSize(null);
      }
    };
    image.src = api.toApiUrl(selectedEnhanceSourceAsset.download_url);
    return () => {
      cancelled = true;
    };
  }, [chatMode, selectedEnhanceSourceAsset]);

  const selectedPlaceholder = useMemo(
    () => findImageHistoryPlaceholder(historyBranches, selectedTaskPlaceholderId),
    [historyBranches, selectedTaskPlaceholderId],
  );
  const selectedGeneratedResourceStatusQuery = useQuery({
    queryKey: ["resource-library-source-status", "image_session_asset", selectedRound?.generated_asset.id ?? ""],
    queryFn: () =>
      api.listResourceLibrarySourceStatus({
        source_type: "image_session_asset",
        source_ids: [selectedRound!.generated_asset.id],
      }),
    enabled: Boolean(selectedRound?.generated_asset.id),
  });
  const selectedGeneratedSavedToResourceLibrary = Boolean(
    selectedGeneratedResourceStatusQuery.data?.items[0]?.saved,
  );
  const selectedGeneratedSavedToGallery = Boolean(selectedRound?.generated_asset.gallery_saved);
  const activePreviewRound =
    previewRound && imageSession?.rounds.some((round) => round.id === previewRound.id) ? previewRound : null;

  useEffect(() => {
    setPreviewPromptCopyState("idle");
  }, [activePreviewRound?.id]);

  useEffect(() => {
    if (previewPromptCopyState === "idle") {
      return;
    }
    const timer = window.setTimeout(() => setPreviewPromptCopyState("idle"), 1600);
    return () => window.clearTimeout(timer);
  }, [previewPromptCopyState]);

  const selectedRoundIsBase = Boolean(
    selectedRound && selectedBaseAssetIds.includes(selectedRound.generated_asset.id),
  );
  const generationDraftOpen = latestGenerationState.status === "empty" || generationDraftMode !== null;
  const generationDraftGateMessage =
    generationDraftOpen
      ? ""
      : latestGenerationState.status === "succeeded"
        ? t("chat.newRoundRequired")
        : latestGenerationState.status === "failed"
          ? t("chat.retryCurrentFailedRoundRequired")
          : latestGenerationState.status === "cancelled"
            ? t("chat.taskCancelled")
          : latestGenerationState.status === "active" || latestGenerationState.status === "refreshing"
            ? t("chat.currentRoundActive")
            : t("chat.newRoundUnavailable");
  const baseRequirementMessage = "";
  const resourceGroupRequirementMessage =
    generationDraftOpen && !selectedResourceGroupId ? t("chat.resourceGroupRequired") : "";

  const sourceImage = useMemo(
    () => inspirationQuery.data?.source_assets.find((asset) => asset.kind === "original_image") ?? null,
    [inspirationQuery.data],
  );

  const inspirationReferenceImages = useMemo(
    () => inspirationQuery.data?.source_assets.filter((asset) => asset.kind === "reference_image") ?? [],
    [inspirationQuery.data],
  );
  const selectedBaseBlockedResource = firstBlockedResource(selectedBaseAssets);
  const generationBlockedResource = firstBlockedResource([
    imageSession,
    isInspirationMode ? currentInspiration : null,
    selectedBaseBlockedResource,
  ]);
  const generationAdminReadonly = hasAdminReadonlyResource(currentUser, [
    imageSession,
    isInspirationMode ? currentInspiration : null,
    ...selectedBaseAssets,
  ]);
  const selectedResultBlockedResource = firstBlockedResource([
    imageSession,
    selectedRound?.generated_asset,
  ]);
  const selectedResultAdminReadonly = hasAdminReadonlyResource(currentUser, [
    imageSession,
    selectedRound?.generated_asset,
  ]);
  const sessionEditBlockedResource = firstBlockedResource([imageSession, isInspirationMode ? currentInspiration : null]);
  const sessionEditAdminReadonly = hasAdminReadonlyResource(currentUser, [imageSession, isInspirationMode ? currentInspiration : null]);
  const inspirationAttachBlockedResource = firstBlockedResource([imageSession, selectedRound?.generated_asset, currentInspiration]);
  const inspirationAttachAdminReadonly = hasAdminReadonlyResource(currentUser, [
    imageSession,
    selectedRound?.generated_asset,
    currentInspiration,
  ]);
  const sessionOrInspirationBlockedResource = firstBlockedResource([imageSession, isInspirationMode ? currentInspiration : null]);
  const inspirationReferenceEditBlockedTitle = currentInspirationAdminReadonly
    ? adminReadonlyActionTitle
    : inspirationsWritePermissionTitle;
  const generationBlockedTitle = generationBlockedResource
    ? blockedActionMessage(generationBlockedResource)
    : generationAdminReadonly
      ? adminReadonlyActionTitle
      : imageChatGeneratePermissionTitle;
  const generationSettingsBlockedTitle = generationAdminReadonly
    ? adminReadonlyActionTitle
    : imageChatGeneratePermissionTitle;
  const enhanceBlockedResource = firstBlockedResource([imageSession, selectedEnhanceSourceAsset]);
  const enhanceAdminReadonly = hasAdminReadonlyResource(currentUser, [imageSession, selectedEnhanceSourceAsset]);
  const enhanceBlockedTitle = enhanceBlockedResource
    ? blockedActionMessage(enhanceBlockedResource)
    : enhanceAdminReadonly
      ? adminReadonlyActionTitle
      : enhanceGeneratePermissionTitle;
  const enhanceSettingsBlockedTitle = enhanceAdminReadonly ? adminReadonlyActionTitle : enhanceGeneratePermissionTitle;
  const sessionEditBlockedTitle = sessionEditBlockedResource
    ? blockedActionMessage(sessionEditBlockedResource)
    : sessionEditAdminReadonly
      ? adminReadonlyActionTitle
      : imageChatWritePermissionTitle;
  const selectedResultResourceBlockedTitle = selectedResultBlockedResource
    ? blockedActionMessage(selectedResultBlockedResource)
    : null;
  const selectedResultBlockedTitle = selectedResultResourceBlockedTitle
    ? selectedResultResourceBlockedTitle
    : selectedResultAdminReadonly
      ? adminReadonlyActionTitle
      : galleryWritePermissionTitle;
  const resourceLibrarySaveGeneratedBlockedTitle = selectedResultResourceBlockedTitle
    ? selectedResultResourceBlockedTitle
    : selectedResultAdminReadonly
      ? adminReadonlyActionTitle
      : null;
  const resourceLibraryLoadReferenceBlockedTitle =
    !selectedSessionId
      ? t("chat.noSessions")
      : sessionEditBlockedTitle;
  const inspirationAttachBlockedTitle = inspirationAttachBlockedResource
    ? blockedActionMessage(inspirationAttachBlockedResource)
    : inspirationAttachAdminReadonly
      ? adminReadonlyActionTitle
      : imageChatWritePermissionTitle;
  const sessionListDeletionBlockedTitle =
    isInspirationMode && currentInspirationBlocked
      ? blockedActionMessage(currentInspiration)
      : isInspirationMode && currentInspirationAdminReadonly
        ? adminReadonlyActionTitle
        : imageChatWritePermissionTitle;
  const selectedPlaceholderActionBlockedTitle =
    selectedPlaceholder && latestGenerationState.task?.id !== selectedPlaceholder.task_id
      ? t("chat.historyRoundLocked")
      : generationBlockedTitle;
  const explicitHistoryBaseAvailable = Boolean(
    lastExplicitHistoryAssetId &&
      imageSession?.rounds.some((round) => round.generated_asset.id === lastExplicitHistoryAssetId),
  );
  const canStartNewRound = canStartImageSessionNewRound(latestGenerationState);
  const newRoundUnavailableTitle =
    latestGenerationState.status === "succeeded"
      ? ""
      : latestGenerationState.status === "failed"
        ? ""
        : latestGenerationState.status === "cancelled"
          ? ""
        : latestGenerationState.status === "active" || latestGenerationState.status === "refreshing"
          ? t("chat.currentRoundActive")
          : latestGenerationState.status === "empty"
            ? t("chat.firstRoundNotStarted")
            : t("chat.newRoundUnavailable");
  const newRoundBlockedTitle = generationSettingsBlockedTitle ?? newRoundUnavailableTitle;
  const newRoundDisabled =
    !canStartNewRound || Boolean(generationSettingsBlockedTitle || newRoundUnavailableTitle);

  const logoutMutation = useMutation({
    mutationFn: api.destroySession,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      navigate("/login", { replace: true });
    },
  });

  const renameSessionMutation = useMutation({
    mutationFn: (title: string) => {
      assertImageChatActionAllowed(sessionEditBlockedTitle);
      return api.updateImageSession(selectedSessionId!, { title });
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(["image-session", updated.id], updated);
      void queryClient.invalidateQueries({ queryKey: ["image-sessions", sessionListScope] });
      setRenameEnabled(false);
      setSuccessMessage(t("chat.renameSuccess"));
      setErrorMessage("");
    },
    onError: (error) => {
      setErrorMessage(error instanceof ApiError ? error.detail : t("chat.renameFailed"));
    },
  });

  const uploadReferenceMutation = useMutation({
    mutationFn: (input: { sessionId: string; files: File[] }) => {
      assertImageChatActionAllowed(sessionEditBlockedTitle);
      return api.addImageSessionReferenceImages(input.sessionId, input.files);
    },
    onSuccess: (updated, input) => {
      const previousReferenceIds = new Set(
        input.sessionId === selectedSessionId ? sessionReferenceAssets.map((asset) => asset.id) : [],
      );
      const uploadedReferenceIds = updated.assets
        .filter((asset) => asset.kind === "reference_upload" && !previousReferenceIds.has(asset.id))
        .map((asset) => asset.id);
      queryClient.setQueryData(["image-session", updated.id], updated);
      void queryClient.invalidateQueries({ queryKey: ["image-sessions", sessionListScope] });
      const isCurrentSession = updated.id === selectedSessionId;
      if (isCurrentSession && uploadedReferenceIds.length) {
        setSelectedBaseAssetIds((current) =>
          addImageBaseAssetIds(current, uploadedReferenceIds, maxSelectedBaseImageCount),
        );
      }
      if (isCurrentSession) {
        setSuccessMessage(t("chat.referenceUploaded"));
        setErrorMessage("");
      }
    },
    onError: (error) => {
      setErrorMessage(error instanceof ApiError ? error.detail : t("chat.referenceUploadFailed"));
    },
  });

  const deleteSessionReferenceMutation = useMutation({
    mutationFn: (input: { sessionId: string; assetId: string }) => {
      assertImageChatActionAllowed(sessionEditBlockedTitle);
      return api.deleteImageSessionReferenceImage(input.sessionId, input.assetId);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(["image-session", updated.id], updated);
      void queryClient.invalidateQueries({ queryKey: ["image-sessions", sessionListScope] });
      setPendingDeleteAction(null);
      const isCurrentSession = updated.id === selectedSessionId;
      if (isCurrentSession) {
        const availableIds = new Set(updated.assets.map((asset) => asset.id));
        setSelectedBaseAssetIds((current) =>
          uniqueImageAssetIds(current).filter((assetId) => availableIds.has(assetId)),
        );
        setSuccessMessage(t("chat.referenceDeleted"));
        setErrorMessage("");
      }
    },
    onError: (error) => {
      setPendingDeleteAction(null);
      setErrorMessage(error instanceof ApiError ? error.detail : t("chat.referenceDeleteFailed"));
    },
  });

  const deleteSessionMutation = useMutation({
    mutationFn: (sessionId: string) => {
      assertImageChatActionAllowed(sessionListDeletionBlockedTitle);
      return api.deleteImageSession(sessionId);
    },
    onSuccess: async (_response, deletedSessionId) => {
      const keepDeletedSessionVisible = isAdmin && onlyDeletedSessions;
      const remainingSessions = keepDeletedSessionVisible
        ? sessionItems
        : sessionItems.filter((item) => item.id !== deletedSessionId);
      setPendingDeleteAction(null);
      if (keepDeletedSessionVisible) {
        await queryClient.invalidateQueries({ queryKey: ["image-session", deletedSessionId] });
      } else {
        queryClient.setQueryData<ImageSessionListResponse>(
          sessionListQueryKey,
          (current) => current ? { ...current, items: current.items.filter((item) => item.id !== deletedSessionId) } : current,
        );
        queryClient.removeQueries({ queryKey: ["image-session", deletedSessionId] });
      }
      if (!keepDeletedSessionVisible && selectedSessionId === deletedSessionId) {
        setSelectedSessionId(remainingSessions[0]?.id ?? null);
        resetImageSessionSelection();
      }
      await queryClient.invalidateQueries({ queryKey: ["image-sessions", sessionListScope] });
      setSuccessMessage(t("chat.sessionDeleted"));
      setErrorMessage("");
    },
    onError: (error) => {
      setPendingDeleteAction(null);
      setErrorMessage(error instanceof ApiError ? error.detail : t("chat.sessionDeleteFailed"));
    },
  });

  const generateMutation = useMutation({
    mutationFn: (payload: ImageGenerationSubmitPayload) => {
      assertImageChatActionAllowed(generationBlockedTitle);
      return api.generateImageSessionRound(selectedSessionId!, payload);
    },
    onSuccess: (updated, variables) => {
      queryClient.setQueryData(["image-session", updated.id], updated);
      void queryClient.invalidateQueries({ queryKey: ["image-sessions", sessionListScope] });
      const placeholderId = selectSubmittedImageGenerationTaskPlaceholderId(updated.generation_tasks, variables);
      const submittedTask = placeholderId
        ? updated.generation_tasks.find((task) => placeholderId.startsWith(`task:${task.id}:`))
        : null;
      const submittedCount = submittedTask
        ? clampImageGenerationTaskCandidateCount(submittedTask.generation_count)
        : effectiveImageGenerationSubmitCount(variables.generation_count, variables.tool_options);
      if (placeholderId) {
        setSelectedTaskPlaceholderId(placeholderId);
        setSelectedGeneratedAssetId(null);
      }
      setGenerationDraftMode(null);
      setRetryGenerationTaskId(null);
      setGenerationConfigMode("auto");
      setGenerationConfigId(null);
      setDraft("");
      setSuccessMessage(
        submittedCount > 1
          ? t("chat.submittedCount", { count: submittedCount })
          : t("chat.submitted"),
      );
      setErrorMessage("");
    },
    onError: (error, variables) => {
      const signature = buildImageGenerationSubmitSignature(variables);
      if (duplicateSubmitGuardRef.current?.signature === signature) {
        duplicateSubmitGuardRef.current = null;
      }
      setErrorMessage(error instanceof ApiError ? error.detail : t("chat.generateFailed"));
    },
  });

  const polishPromptMutation = useMutation({
    mutationFn: (prompt: string) => {
      assertImageChatActionAllowed(generationSettingsBlockedTitle);
      return api.polishImageSessionPrompt({
        prompt,
        resource_group_id: selectedResourceGroupId ?? "",
        generation_config_mode: promptPolishConfigMode,
        generation_config_id: promptPolishConfigMode === "manual" ? promptPolishConfigId : null,
      });
    },
    onSuccess: (response) => {
      setPolishedPrompt(response.prompt);
      setSuccessMessage(t("chat.promptPolished"));
      setErrorMessage("");
    },
    onError: (error) => {
      setErrorMessage(error instanceof ApiError ? error.detail : t("chat.promptPolishFailed"));
    },
  });

  const cancelGenerationTaskMutation = useMutation({
    mutationFn: (input: { sessionId: string; taskId: string }) => {
      assertImageChatActionAllowed(generationBlockedTitle);
      return api.cancelImageSessionGenerationTask(input.sessionId, input.taskId);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(["image-session", updated.id], updated);
      void queryClient.invalidateQueries({ queryKey: ["image-session-status", updated.id] });
      void queryClient.invalidateQueries({ queryKey: ["image-sessions", sessionListScope] });
      setSuccessMessage(t("chat.cancelledTask"));
      setErrorMessage("");
    },
    onError: (error) => {
      setErrorMessage(error instanceof ApiError ? error.detail : t("chat.cancelFailed"));
    },
  });

  const createEnhanceMutation = useMutation({
    mutationFn: (input: CreateEnhanceJobInput) => {
      assertImageChatActionAllowed(enhanceBlockedTitle);
      return api.createEnhanceJob(input);
    },
    onSuccess: (job) => {
      queryClient.setQueryData(["enhance-job", job.id], job);
      setActiveEnhanceJobId(job.id);
      setAttachedEnhanceJobIds((previous) => {
        const next = new Set(previous);
        next.delete(job.id);
        return next;
      });
      setFailedEnhanceAttachJobIds((previous) => {
        const next = new Set(previous);
        next.delete(job.id);
        return next;
      });
      setSuccessMessage(t("chat.enhance.submitted"));
      setErrorMessage("");
    },
    onError: (error) => {
      setErrorMessage(error instanceof ApiError ? error.detail : t("chat.enhance.submitFailed"));
    },
  });

  const saveEnhanceJobMutation = useMutation({
    mutationFn: (jobId: string) => api.saveEnhanceJobToLibrary(jobId),
    onSuccess: (_asset, jobId) => {
      setSavedEnhanceJobIds((previous) => new Set(previous).add(jobId));
      setSuccessMessage(t("chat.enhance.savedToLibrary"));
      setErrorMessage("");
    },
    onError: (error) => {
      setErrorMessage(error instanceof ApiError ? error.detail : t("chat.enhance.saveFailed"));
    },
  });

  useEffect(() => {
    const job = activeEnhanceJob;
    if (!job || job.status !== "succeeded" || !job.result_manifest) {
      return;
    }
    if (
      attachedEnhanceJobIds.has(job.id) ||
      failedEnhanceAttachJobIds.has(job.id) ||
      processingEnhanceJobId === job.id
    ) {
      return;
    }
    const initialManifest = job.result_manifest;
    setProcessingEnhanceJobId(job.id);
    void (async () => {
      let readyJob: EnhanceJob = job;
      if (job.strategy === "tiled" && initialManifest.final_status !== "ready") {
        const blob = await compositeEnhanceTiles(initialManifest);
        readyJob = await api.uploadEnhanceJobFinal(job.id, blob);
        queryClient.setQueryData(["enhance-job", job.id], readyJob);
      }
      const updated = await api.attachEnhanceJobToImageSession(readyJob.id);
      queryClient.setQueryData(["image-session", updated.id], updated);
      await queryClient.invalidateQueries({ queryKey: ["image-sessions", sessionListScope] });
      const attachedRound = [...updated.rounds].reverse().find((round) => round.provider_response_id === readyJob.id);
      if (updated.id === selectedSessionId && attachedRound) {
        setSelectedTaskPlaceholderId(null);
        setSelectedGeneratedAssetId(attachedRound.generated_asset.id);
        setLastExplicitHistoryAssetId(attachedRound.generated_asset.id);
      }
      setAttachedEnhanceJobIds((previous) => new Set(previous).add(readyJob.id));
      setSuccessMessage(t("chat.enhance.attached"));
      setErrorMessage("");
    })()
      .catch((error) => {
        setFailedEnhanceAttachJobIds((previous) => new Set(previous).add(job.id));
        setErrorMessage(error instanceof ApiError ? error.detail : t("chat.enhance.attachFailed"));
      })
      .finally(() => setProcessingEnhanceJobId(null));
  }, [
    activeEnhanceJob,
    attachedEnhanceJobIds,
    failedEnhanceAttachJobIds,
    processingEnhanceJobId,
    queryClient,
    selectedSessionId,
    sessionListScope,
    t,
  ]);

  const promptPolishConfigRequirementMessage =
    promptPolishConfigMode === "manual" && !promptPolishConfigId ? t("chat.promptPolishConfigRequired") : null;
  const imageGenerationConfigRequirementMessage =
    generationConfigMode === "manual" && !generationConfigId ? t("chat.imageGenerationConfigRequired") : null;
  const enhanceDirectWidthValue = Number.parseInt(enhanceDirectWidth, 10);
  const enhanceDirectHeightValue = Number.parseInt(enhanceDirectHeight, 10);
  const enhanceTileBaseSizeValue = Number.parseInt(enhanceTileBaseSize, 10);
  const enhanceDirectSizeInvalid =
    !Number.isFinite(enhanceDirectWidthValue) ||
    !Number.isFinite(enhanceDirectHeightValue) ||
    enhanceDirectWidthValue <= 0 ||
    enhanceDirectHeightValue <= 0;
  const enhanceDirectSizeTooLarge =
    enhanceDirectWidthValue > imageGenerationMaxDimension ||
    enhanceDirectHeightValue > imageGenerationMaxDimension;
  const enhanceTileBaseSizeInvalid =
    !Number.isFinite(enhanceTileBaseSizeValue) ||
    enhanceTileBaseSizeValue <= 0 ||
    enhanceTileBaseSizeValue > imageGenerationMaxDimension;
  const enhanceTiledFinalSize =
    enhanceSourceImageSize && enhanceStrategy === "tiled"
      ? {
          width: enhanceSourceImageSize.width * enhanceScale,
          height: enhanceSourceImageSize.height * enhanceScale,
        }
      : null;
  const enhanceTiledFinalTooLarge = Boolean(
    enhanceTiledFinalSize &&
      (enhanceTiledFinalSize.width > ENHANCE_FINAL_MAX_EDGE ||
        enhanceTiledFinalSize.height > ENHANCE_FINAL_MAX_EDGE ||
        enhanceTiledFinalSize.width * enhanceTiledFinalSize.height > ENHANCE_FINAL_MAX_PIXELS),
  );
  const estimatedEnhanceTileCallCount =
    enhanceStrategy === "tiled" && !enhanceTileBaseSizeInvalid && enhanceSourceImageSize
      ? estimateEnhanceTileCallCount({
          sourceWidth: enhanceSourceImageSize.width,
          sourceHeight: enhanceSourceImageSize.height,
          scale: enhanceScale,
          tileBaseSize: enhanceTileBaseSizeValue,
        })
      : null;
  const enhanceSourceRequirementMessage =
    chatMode === "enhance" && !selectedEnhanceSourceAsset ? t("chat.enhance.sourceRequired") : "";
  const enhanceResourceGroupRequirementMessage =
    chatMode === "enhance" && !selectedResourceGroupId ? t("chat.resourceGroupRequired") : "";
  const enhanceConfigRequirementMessage =
    chatMode === "enhance" && generationConfigMode === "manual" && !generationConfigId
      ? t("chat.imageGenerationConfigRequired")
      : "";
  const enhanceParamRequirementMessage =
    chatMode !== "enhance"
      ? ""
      : enhanceStrategy === "direct" && enhanceDirectSizeInvalid
        ? t("chat.enhance.directSizeInvalid")
        : enhanceStrategy === "direct" && enhanceDirectSizeTooLarge
          ? t("chat.enhance.directSizeTooLarge")
          : enhanceStrategy === "tiled" && enhanceTileBaseSizeInvalid
            ? t("chat.enhance.tileBaseInvalid")
            : enhanceStrategy === "tiled" && enhanceTiledFinalTooLarge
              ? t("chat.enhance.finalSizeTooLarge")
            : "";
  const enhanceSubmitRequirementMessage =
    enhanceSourceRequirementMessage ||
    enhanceResourceGroupRequirementMessage ||
    enhanceConfigRequirementMessage ||
    enhanceParamRequirementMessage;
  const generationSubmitRequirementMessage =
    generationDraftGateMessage ||
    baseRequirementMessage ||
    resourceGroupRequirementMessage ||
    imageGenerationConfigRequirementMessage;
  const generateDisabled =
    !selectedSessionId ||
    !imageSession ||
    !generationDraftOpen ||
    !draft.trim() ||
    generateMutation.isPending ||
    Boolean(generationBlockedTitle) ||
    Boolean(generationSubmitRequirementMessage);
  const enhanceBusy = createEnhanceMutation.isPending || processingEnhanceJobId !== null;
  const enhanceSubmitDisabled =
    !selectedSessionId ||
    !imageSession ||
    enhanceBusy ||
    Boolean(enhanceBlockedTitle) ||
    Boolean(enhanceSubmitRequirementMessage);

  const attachMutation = useMutation({
    mutationFn: (payload: { assetId: string; target: "reference" | "main_source"; inspirationId?: string }) => {
      assertImageChatActionAllowed(inspirationAttachBlockedTitle);
      return api.attachImageSessionAssetToInspiration(selectedSessionId!, payload.assetId, {
        target: payload.target,
        inspiration_id: payload.inspirationId,
      });
    },
    onSuccess: async (response) => {
      setSuccessMessage(response.message);
      setErrorMessage("");
      await queryClient.invalidateQueries({ queryKey: ["inspirations"] });
      await queryClient.invalidateQueries({ queryKey: ["inspiration", response.inspiration_id] });
    },
    onError: (error) => {
      setErrorMessage(error instanceof ApiError ? error.detail : t("chat.saveInspirationFailed"));
    },
  });

  const saveGalleryMutation = useMutation({
    mutationFn: ({ assetId, tagIds }: { assetId: string; tagIds: string[] }) => {
      assertImageChatActionAllowed(selectedResultBlockedTitle);
      return api.saveGalleryEntry(assetId, { tag_ids: tagIds });
    },
    onSuccess: async (entry, variables) => {
      queryClient.setQueryData<ImageSessionDetail>(["image-session", entry.image_session_id], (current) => {
        if (!current) {
          return current;
        }
        const markAssetSavedToGallery = (asset: ImageSessionAsset): ImageSessionAsset =>
          asset.id === variables.assetId
            ? {
                ...asset,
                gallery_saved: true,
                gallery_entry_id: entry.id,
              }
            : asset;
        return {
          ...current,
          assets: current.assets.map(markAssetSavedToGallery),
          rounds: current.rounds.map((round) =>
            round.generated_asset.id === variables.assetId
              ? {
                  ...round,
                  generated_asset: markAssetSavedToGallery(round.generated_asset),
                }
              : round,
          ),
        };
      });
      setGalleryTagPickerAsset(null);
      setGalleryTagPickerError("");
      setSuccessMessage(t("chat.savedGallery"));
      setErrorMessage("");
      await queryClient.invalidateQueries({ queryKey: ["gallery"] });
      await queryClient.invalidateQueries({ queryKey: ["image-session", entry.image_session_id] });
    },
    onError: (error) => {
      const message = error instanceof ApiError ? error.detail : t("chat.saveGalleryFailed");
      setGalleryTagPickerError(message);
      setErrorMessage(message);
    },
  });

  const loadResourceLibraryReferenceMutation = useMutation({
    mutationFn: (assetId: string) => {
      assertImageChatActionAllowed(resourceLibraryLoadReferenceBlockedTitle);
      return api.loadResourceLibraryAssetToImageSession(assetId, {
        image_session_id: selectedSessionId!,
      });
    },
    onSuccess: (updated) => {
      const previousReferenceIds = new Set(sessionReferenceAssets.map((asset) => asset.id));
      const loadedReferenceIds = updated.assets
        .filter((asset) => asset.kind === "reference_upload" && !previousReferenceIds.has(asset.id))
        .map((asset) => asset.id);
      queryClient.setQueryData(["image-session", updated.id], updated);
      void queryClient.invalidateQueries({ queryKey: ["image-sessions", sessionListScope] });
      if (updated.id === selectedSessionId && loadedReferenceIds.length) {
        setSelectedBaseAssetIds((current) =>
          addImageBaseAssetIds(current, loadedReferenceIds, maxSelectedBaseImageCount),
        );
      }
      setResourceLibraryOpen(false);
      setSuccessMessage(t("resourceLibrary.loadToImageSession"));
      setErrorMessage("");
    },
    onError: (error) => {
      setErrorMessage(error instanceof ApiError ? error.detail : t("resourceLibrary.loadFailedAction"));
    },
  });

  const deleteInspirationReferenceMutation = useMutation({
    mutationFn: (assetId: string) => {
      assertImageChatActionAllowed(inspirationReferenceEditBlockedTitle);
      return api.deleteSourceAsset(assetId);
    },
    onSuccess: async (updated) => {
      queryClient.setQueryData(["inspiration", updated.id], updated);
      setPendingDeleteAction(null);
      await queryClient.invalidateQueries({ queryKey: ["inspiration", updated.id] });
      if (selectedSessionId) {
        await queryClient.invalidateQueries({ queryKey: ["image-session", selectedSessionId] });
      }
      setSuccessMessage(t("chat.inspirationReferenceDeleted"));
      setErrorMessage("");
    },
    onError: (error) => {
      setPendingDeleteAction(null);
      setErrorMessage(error instanceof ApiError ? error.detail : t("chat.inspirationReferenceDeleteFailed"));
    },
  });

  const createSessionNoResourceGroupTitle =
    generationResourceGroupsQuery.isFetched && !resourceGroups.length ? t("chat.noResourceGroups") : null;
  const createSessionButtonTitle = createSessionBlockedTitle ?? createSessionNoResourceGroupTitle ?? t("chat.newSession");
  const createSessionDisabled =
    createSessionMutation.isPending ||
    generationResourceGroupsQuery.isLoading ||
    Boolean(createSessionBlockedTitle) ||
    !resourceGroups.length;
  const renameSessionDisabled = !selectedSessionId || renameSessionMutation.isPending || Boolean(sessionEditBlockedTitle);
  const saveSelectedGalleryDisabled =
    saveGalleryMutation.isPending || selectedGeneratedSavedToGallery || Boolean(selectedResultBlockedTitle);
  const saveSelectedGalleryTitle = selectedGeneratedSavedToGallery
    ? t("chat.alreadyInGallery")
    : selectedResultBlockedTitle ?? t("chat.saveSelectedGallery");
  const saveSelectedResourceLibraryDisabled = Boolean(resourceLibrarySaveGeneratedBlockedTitle);
  const sessionDeletionEnabled = deletionEnabled;

  function handleGenerate() {
    const prompt = draft.trim();
    if (!selectedSessionId || !imageSession || !prompt || generateMutation.isPending) {
      return;
    }
    if (generationBlockedTitle) {
      setErrorMessage(generationBlockedTitle);
      return;
    }
    if (generationDraftGateMessage) {
      setErrorMessage(generationDraftGateMessage);
      return;
    }
    if (baseRequirementMessage) {
      setErrorMessage(baseRequirementMessage);
      return;
    }
    if (resourceGroupRequirementMessage) {
      setErrorMessage(resourceGroupRequirementMessage);
      return;
    }
    if (imageGenerationConfigRequirementMessage) {
      setErrorMessage(imageGenerationConfigRequirementMessage);
      return;
    }
    if (generationDraftMode === "retry" && !retryGenerationTaskId) {
      setErrorMessage(t("chat.retryCurrentFailedRoundRequired"));
      return;
    }
    const availableBaseAssetIds = new Set(imageSession.assets.map((asset) => asset.id));
    const selectedBaseIds = uniqueImageAssetIds(selectedBaseAssetIds)
      .filter((assetId) => availableBaseAssetIds.has(assetId))
      .slice(0, maxSelectedBaseImageCount);
    const selectedReferenceIds = selectedBaseIds.filter(
      (assetId) => imageSessionAssetsById.get(assetId)?.kind === "reference_upload",
    );
    const payload: ImageGenerationSubmitPayload = {
      prompt,
      size,
      base_asset_ids: selectedBaseIds,
      base_asset_id: legacyBaseAssetIdFromBaseAssetIds(selectedBaseIds),
      selected_reference_asset_ids: selectedReferenceIds,
      generation_count: clampGenerationCount(generationCount),
      tool_options: compactedToolOptions,
      resource_group_id: selectedResourceGroupId ?? "",
      generation_config_mode: generationConfigMode,
      generation_config_id: generationConfigMode === "manual" ? generationConfigId : null,
      retry_generation_task_id: generationDraftMode === "retry" ? retryGenerationTaskId : null,
    };
    const signature = buildImageGenerationSubmitSignature(payload);
    const now = Date.now();
    if (
      shouldBlockDuplicateGenerationSubmit(
        duplicateSubmitGuardRef.current,
        signature,
        now,
        DUPLICATE_GENERATION_SUBMIT_WINDOW_MS,
      )
    ) {
      setErrorMessage(t("chat.duplicateSubmit"));
      return;
    }
    duplicateSubmitGuardRef.current = { signature, submittedAt: now };
    pendingGeneratedRoundCountRef.current = imageSession?.rounds.length ?? 0;
    generateMutation.mutate(payload);
  }

  function handleSubmitEnhance() {
    if (!selectedSessionId || !imageSession || createEnhanceMutation.isPending || processingEnhanceJobId) {
      return;
    }
    if (enhanceBlockedTitle) {
      setErrorMessage(enhanceBlockedTitle);
      return;
    }
    if (enhanceSubmitRequirementMessage) {
      setErrorMessage(enhanceSubmitRequirementMessage);
      return;
    }
    if (!selectedEnhanceSourceAsset) {
      setErrorMessage(t("chat.enhance.sourceRequired"));
      return;
    }
    const params =
      enhanceStrategy === "direct"
        ? {
            target_width: enhanceDirectWidthValue,
            target_height: enhanceDirectHeightValue,
          }
        : {
            scale: enhanceScale,
            tile_base_size: enhanceTileBaseSizeValue,
            overlap_pct: 10,
          };
    createEnhanceMutation.mutate({
      source_kind: "image_session_asset",
      source_ref: selectedEnhanceSourceAsset.id,
      strategy: enhanceStrategy,
      params,
      resource_group_id: selectedResourceGroupId ?? "",
      generation_config_mode: generationConfigMode,
      generation_config_id: generationConfigMode === "manual" ? generationConfigId : null,
    });
  }

  function handleUseAttachedEnhanceAsBase() {
    const assetId = activeEnhanceAttachedRound?.generated_asset.id;
    if (!assetId) {
      return;
    }
    setSelectedBaseAssetIds(addImageBaseAssetIds([], [assetId], maxSelectedBaseImageCount));
    setGenerationDraftMode("new_round");
    setRetryGenerationTaskId(null);
    setChatMode("normal");
    setSuccessMessage(t("chat.enhance.baseApplied"));
    setErrorMessage("");
  }

  function handlePolishPrompt() {
    const prompt = draft.trim();
    if (!prompt || polishPromptMutation.isPending) {
      return;
    }
    if (generationSettingsBlockedTitle) {
      setErrorMessage(generationSettingsBlockedTitle);
      return;
    }
    if (resourceGroupRequirementMessage) {
      setErrorMessage(resourceGroupRequirementMessage);
      return;
    }
    if (promptPolishConfigRequirementMessage) {
      setErrorMessage(promptPolishConfigRequirementMessage);
      return;
    }
    polishPromptMutation.mutate(prompt);
  }

  function handleUsePolishedPrompt() {
    if (!polishedPrompt.trim()) {
      return;
    }
    if (generationSettingsBlockedTitle) {
      setErrorMessage(generationSettingsBlockedTitle);
      return;
    }
    setDraft(polishedPrompt);
    setPolishedPrompt("");
    setSuccessMessage(t("chat.promptPolishApplied"));
    setErrorMessage("");
  }

  function restoreGenerationTaskDraft(task: ImageSessionGenerationTask, mode: ImageChatGenerationDraftMode) {
    const payload = imageGenerationTaskSubmitPayload(task);
    setDraft(payload.prompt);
    setPolishedPrompt("");
    setSize(payload.size);
    setToolOptions(payload.tool_options ?? {});
    setGenerationCount(clampGenerationCount(payload.generation_count));
    setSelectedResourceGroupId(payload.resource_group_id || selectedResourceGroupId || null);
    setGenerationConfigMode(payload.generation_config_mode ?? "auto");
    setGenerationConfigId(
      payload.generation_config_mode === "manual" ? (payload.generation_config_id ?? null) : null,
    );
    setSelectedBaseAssetIds(
      addImageBaseAssetIds([], payload.base_asset_ids, maxSelectedBaseImageCount),
    );
    setSelectedTaskPlaceholderId(
      selectedPlaceholder?.task_id === task.id
        ? selectedPlaceholder.id
        : selectSubmittedImageGenerationTaskPlaceholderId([task], payload),
    );
    setSelectedGeneratedAssetId(null);
    setSettingsTab("basic");
    setGenerationDraftMode(mode);
    setRetryGenerationTaskId(mode === "retry" ? task.id : null);
  }

  function openMobileGenerationSheetOnCompactLayout() {
    setMobileGenerationSheetOpen(!isDesktopImageChatLayout());
  }

  function handleRetryGenerationTask(task: ImageSessionGenerationTask) {
    if (!selectedSessionId || !imageSession || !isImageSessionGenerationTaskRetryable(task)) {
      return;
    }
    if (latestGenerationState.task?.id !== task.id) {
      setErrorMessage(t("chat.historyRoundLocked"));
      return;
    }
    if (generationBlockedTitle) {
      setErrorMessage(generationBlockedTitle);
      return;
    }
    restoreGenerationTaskDraft(task, "retry");
    setSuccessMessage(t("chat.retrySettingsRestored"));
    setErrorMessage("");
    openMobileGenerationSheetOnCompactLayout();
  }

  function handleCancelGenerationTask(task: ImageSessionGenerationTask) {
    if (
      !selectedSessionId ||
      cancelGenerationTaskMutation.isPending ||
      !isImageSessionGenerationTaskCancelable(task)
    ) {
      return;
    }
    if (latestGenerationState.task?.id !== task.id) {
      setErrorMessage(t("chat.historyRoundLocked"));
      return;
    }
    if (generationBlockedTitle) {
      setErrorMessage(generationBlockedTitle);
      return;
    }
    cancelGenerationTaskMutation.mutate({ sessionId: selectedSessionId, taskId: task.id });
  }

  function handleRegenerateGenerationTask(task: ImageSessionGenerationTask) {
    if (
      !selectedSessionId ||
      !imageSession ||
      generateMutation.isPending ||
      !isImageSessionGenerationTaskRegeneratable(task)
    ) {
      return;
    }
    if (generationBlockedTitle) {
      setErrorMessage(generationBlockedTitle);
      return;
    }
    if (latestGenerationState.task?.id !== task.id) {
      setErrorMessage(t("chat.historyRoundLocked"));
      return;
    }
    pendingGeneratedRoundCountRef.current = imageSession.rounds.length;
    const payload = imageGenerationTaskSubmitPayload(task);
    generateMutation.mutate({
      ...payload,
      resource_group_id: payload.resource_group_id || selectedResourceGroupId || "",
    });
  }

  function handleStartNewRound() {
    if (!imageSession) {
      return;
    }
    if (newRoundBlockedTitle) {
      setErrorMessage(newRoundBlockedTitle);
      return;
    }
    const hasPreviousTask = imageSession.generation_tasks.length > 0;
    if (hasPreviousTask) {
      setNewRoundChoiceOpen(true);
      return;
    }
    startNewRoundFresh();
  }

  function startNewRoundFresh() {
    if (!imageSession) {
      return;
    }
    const nextBaseAssetIds =
      explicitHistoryBaseAvailable && lastExplicitHistoryAssetId ? [lastExplicitHistoryAssetId] : [];
    const defaultResourceGroupId = imageSessionNewRoundDefaultResourceGroupId({
      sessionSummary: selectedSessionSummary,
      imageSession,
    });
    if (defaultResourceGroupId && resourceGroups.some((group) => group.id === defaultResourceGroupId)) {
      setSelectedResourceGroupId(defaultResourceGroupId);
    }
    setSelectedTaskPlaceholderId(null);
    setSelectedBaseAssetIds(nextBaseAssetIds);
    setLastExplicitHistoryAssetId(null);
    setDraft("");
    setPolishedPrompt("");
    setSettingsTab("basic");
    setGenerationConfigMode("auto");
    setGenerationConfigId(null);
    setRetryGenerationTaskId(null);
    setGenerationDraftMode("new_round");
    setSuccessMessage(t("chat.newRoundReady"));
    setErrorMessage("");
    openMobileGenerationSheetOnCompactLayout();
  }

  function startNewRoundWithPreviousConfig() {
    if (!imageSession) {
      return;
    }
    const sortedTasks = [...imageSession.generation_tasks].sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
    );
    const task = sortedTasks[0];
    if (!task) {
      return;
    }
    const payload = imageGenerationTaskSubmitPayload(task);
    const nextBaseAssetIds =
      explicitHistoryBaseAvailable && lastExplicitHistoryAssetId ? [lastExplicitHistoryAssetId] : [];
    setSelectedTaskPlaceholderId(null);
    setSelectedBaseAssetIds(
      nextBaseAssetIds.length > 0
        ? nextBaseAssetIds
        : addImageBaseAssetIds([], payload.base_asset_ids, maxSelectedBaseImageCount),
    );
    setLastExplicitHistoryAssetId(null);
    setDraft("");
    setPolishedPrompt("");
    setSize(payload.size);
    setToolOptions(payload.tool_options ?? {});
    setGenerationCount(clampGenerationCount(payload.generation_count));
    setSelectedResourceGroupId(payload.resource_group_id || selectedResourceGroupId || null);
    setGenerationConfigMode(payload.generation_config_mode ?? "auto");
    setGenerationConfigId(
      payload.generation_config_mode === "manual" ? (payload.generation_config_id ?? null) : null,
    );
    setSettingsTab("basic");
    setRetryGenerationTaskId(null);
    setGenerationDraftMode("new_round");
    setSuccessMessage(t("chat.newRoundReady"));
    setErrorMessage("");
    openMobileGenerationSheetOnCompactLayout();
  }

  function handleRename() {
    const nextTitle = titleDraft.trim();
    if (!selectedSessionId || !nextTitle || nextTitle === imageSession?.title) {
      setRenameEnabled(false);
      return;
    }
    if (sessionEditBlockedTitle) {
      setErrorMessage(sessionEditBlockedTitle);
      return;
    }
    renameSessionMutation.mutate(nextTitle);
  }

  function handleAttach(target: "reference" | "main_source") {
    if (!selectedRound) {
      return;
    }
    if (!isInspirationMode && !targetInspirationId) {
      setErrorMessage(t("chat.selectInspirationFirst"));
      return;
    }
    if (inspirationAttachBlockedTitle) {
      setErrorMessage(inspirationAttachBlockedTitle);
      return;
    }
    attachMutation.mutate({
      assetId: selectedRound.generated_asset.id,
      target,
      inspirationId: isInspirationMode ? inspirationId : targetInspirationId,
    });
  }

  function handleSaveSelectedToGallery() {
    if (!selectedRound || saveGalleryMutation.isPending) {
      return;
    }
    if (selectedRound.generated_asset.gallery_saved) {
      setSuccessMessage(t("chat.alreadyInGallery"));
      setErrorMessage("");
      return;
    }
    if (selectedResultBlockedTitle) {
      setErrorMessage(selectedResultBlockedTitle);
      return;
    }
    setGalleryTagPickerAsset(selectedRound.generated_asset);
    setGalleryTagPickerError("");
  }

  function handleOpenResourceLibrary() {
    setResourceLibraryOpen(true);
  }

  function handleSaveSelectedToResourceLibrary() {
    if (!selectedRound) {
      return;
    }
    if (resourceLibrarySaveGeneratedBlockedTitle) {
      setErrorMessage(resourceLibrarySaveGeneratedBlockedTitle);
      return;
    }
    setResourceLibrarySaveSource({
      source_type: "image_session_asset",
      source_id: selectedRound.generated_asset.id,
      title: selectedRound.generated_asset.original_filename,
      thumbnail_url: selectedRound.generated_asset.thumbnail_url,
    });
  }

  function handleResourceLibraryAssetSelect(asset: ResourceLibraryAsset) {
    if (resourceLibraryLoadReferenceBlockedTitle) {
      setErrorMessage(resourceLibraryLoadReferenceBlockedTitle);
      return;
    }
    loadResourceLibraryReferenceMutation.mutate(asset.id);
  }

  function handleSelectHistoryRound(assetId: string) {
    setSelectedGeneratedAssetId(assetId);
    setSelectedTaskPlaceholderId(null);
    if (generationDraftMode === null) {
      setLastExplicitHistoryAssetId(assetId);
    }
    setSuccessMessage("");
    setErrorMessage("");
  }

  function handleAddHistoryRoundToBase(assetId: string) {
    if (generationDraftMode !== "new_round") {
      return;
    }
    if (!imageSession?.rounds.some((round) => round.generated_asset.id === assetId)) {
      return;
    }
    setSelectedBaseAssetIds((current) => {
      const next = addImageBaseAssetIds(current, [assetId], maxSelectedBaseImageCount);
      if (next.length === current.length && !current.includes(assetId)) {
        setErrorMessage(t("chat.baseLimitReached", { max: maxSelectedBaseImageCount }));
      } else {
        setErrorMessage("");
      }
      return next;
    });
  }

  function handleSelectHistoryPlaceholder(placeholderId: string) {
    setSelectedTaskPlaceholderId(placeholderId);
    setSelectedGeneratedAssetId(null);
  }

  function handleDeleteSession(sessionId: string) {
    if (deleteSessionMutation.isPending) {
      return;
    }
    if (!deletionEnabled) {
      setErrorMessage(t("chat.deleteDisabled"));
      return;
    }
    if (sessionListDeletionBlockedTitle) {
      setErrorMessage(sessionListDeletionBlockedTitle);
      return;
    }
    const session = sessionItems.find((item) => item.id === sessionId) ?? imageSession;
    if (isResourceBlocked(session)) {
      setErrorMessage(blockedActionMessage(session));
      return;
    }
    if (isAdminReadonlyResource(currentUser, session)) {
      setErrorMessage(adminReadonlyActionTitle);
      return;
    }
    setMobileSessionDrawerOpen(false);
    setPendingDeleteAction({ kind: "session", sessionId });
  }

  function handleDeleteInspirationReference(assetId: string) {
    if (deleteInspirationReferenceMutation.isPending) {
      return;
    }
    if (!deletionEnabled) {
      setErrorMessage(t("chat.deleteDisabled"));
      return;
    }
    const asset = inspirationReferenceImages.find((referenceImage) => referenceImage.id === assetId) ?? null;
    const blockedResource = firstBlockedResource([currentInspiration, asset]);
    if (blockedResource) {
      setErrorMessage(blockedActionMessage(blockedResource));
      return;
    }
    if (isAdminReadonlyResource(currentUser, currentInspiration)) {
      setErrorMessage(adminReadonlyActionTitle);
      return;
    }
    setPendingDeleteAction({ kind: "inspirationReference", assetId });
  }

  function handleReferenceToggle(assetId: string, checked: boolean) {
    const asset = sessionReferenceAssets.find((referenceAsset) => referenceAsset.id === assetId) ?? null;
    const blockedResource = firstBlockedResource([sessionEditBlockedResource, asset]);
    if (checked && blockedResource) {
      setErrorMessage(blockedActionMessage(blockedResource));
      return;
    }
    if (checked && hasAdminReadonlyResource(currentUser, [imageSession, isInspirationMode ? currentInspiration : null, asset])) {
      setErrorMessage(adminReadonlyActionTitle);
      return;
    }
    setSelectedBaseAssetIds((current) => {
      const next = checked
        ? addImageBaseAssetIds(current, [assetId], maxSelectedBaseImageCount)
        : removeImageBaseAssetId(current, assetId);
      if (checked && next.length === current.length && !current.includes(assetId)) {
        setErrorMessage(t("chat.baseLimitReached", { max: maxSelectedBaseImageCount }));
      } else {
        setErrorMessage("");
      }
      return next;
    });
  }

  function handleDeleteSessionReference(assetId: string) {
    if (!selectedSessionId || deleteSessionReferenceMutation.isPending) {
      return;
    }
    if (!deletionEnabled) {
      setErrorMessage(t("chat.deleteDisabled"));
      return;
    }
    const asset = sessionReferenceAssets.find((referenceAsset) => referenceAsset.id === assetId) ?? null;
    const blockedResource = firstBlockedResource([sessionEditBlockedResource, asset]);
    if (blockedResource) {
      setErrorMessage(blockedActionMessage(blockedResource));
      return;
    }
    if (hasAdminReadonlyResource(currentUser, [imageSession, isInspirationMode ? currentInspiration : null, asset])) {
      setErrorMessage(adminReadonlyActionTitle);
      return;
    }
    setPendingDeleteAction({ kind: "sessionReference", sessionId: selectedSessionId, assetId });
  }

  function handleUploadReferenceFiles(files: File[]) {
    if (!selectedSessionId || uploadReferenceMutation.isPending || files.length === 0) {
      return;
    }
    if (sessionEditBlockedTitle) {
      setErrorMessage(sessionEditBlockedTitle);
      return;
    }
    uploadReferenceMutation.mutate({ sessionId: selectedSessionId, files });
  }

  function handlePanelResizeStart(target: ImageChatResizeTarget, event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeftWidth = leftPanelWidth;
    const startRightWidth = rightPanelWidth;
    const startHistoryHeight = historyPanelHeight;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = target === "history" ? "row-resize" : "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (target === "left") {
        const maxWidth = getLeftPanelMaxWidth(window.innerWidth, startRightWidth);
        setLeftPanelWidth(clampPanelSize(startLeftWidth + moveEvent.clientX - startX, LEFT_PANEL_MIN_WIDTH, maxWidth));
        return;
      }
      if (target === "right") {
        const maxWidth = getRightPanelMaxWidth(window.innerWidth, startLeftWidth);
        setRightPanelWidth(clampPanelSize(startRightWidth + startX - moveEvent.clientX, RIGHT_PANEL_MIN_WIDTH, maxWidth));
        return;
      }
      const maxHeight = getHistoryPanelMaxHeight(window.innerHeight);
      setHistoryPanelHeight(clampPanelSize(startHistoryHeight + startY - moveEvent.clientY, HISTORY_PANEL_MIN_HEIGHT, maxHeight));
    };

    const finishResize = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);
  }

  function handleMobileEdgeSwipeStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      event.pointerType === "mouse" ||
      event.clientX > 24 ||
      mobileSessionDrawerOpen ||
      mobileHistoryDrawerOpen ||
      mobileGenerationSheetOpen
    ) {
      return;
    }
    const startX = event.clientX;
    const startY = event.clientY;
    const pointerId = event.pointerId;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }
      const deltaX = moveEvent.clientX - startX;
      const deltaY = Math.abs(moveEvent.clientY - startY);
      if (deltaX > 72 && deltaY < 48) {
        setMobileSessionDrawerOpen(true);
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", finishSwipe);
        window.removeEventListener("pointercancel", finishSwipe);
      }
    };
    const finishSwipe = (finishEvent: PointerEvent) => {
      if (finishEvent.pointerId !== pointerId) {
        return;
      }
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishSwipe);
      window.removeEventListener("pointercancel", finishSwipe);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishSwipe);
    window.addEventListener("pointercancel", finishSwipe);
  }

  function handleMobileSessionDrawerSwipeBackStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" || !mobileSessionDrawerOpen) {
      return;
    }
    const startX = event.clientX;
    const startY = event.clientY;
    const pointerId = event.pointerId;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) {
        return;
      }
      const deltaX = moveEvent.clientX - startX;
      const deltaY = Math.abs(moveEvent.clientY - startY);
      if (deltaX < -72 && deltaY < 48) {
        setMobileSessionDrawerOpen(false);
        mobileSessionButtonRef.current?.focus();
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", finishSwipe);
        window.removeEventListener("pointercancel", finishSwipe);
      }
    };
    const finishSwipe = (finishEvent: PointerEvent) => {
      if (finishEvent.pointerId !== pointerId) {
        return;
      }
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishSwipe);
      window.removeEventListener("pointercancel", finishSwipe);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishSwipe);
    window.addEventListener("pointercancel", finishSwipe);
  }

  function renderResultUsageSection() {
    return (
      <section className="space-y-3">
        <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-950 dark:text-white">
          <GalleryHorizontalEnd size={15} /> {t("chat.resultUsage")}
        </div>
        <InspirationAssociationPanel
          isInspirationMode={isInspirationMode}
          inspiration={inspirationQuery.data}
          inspirations={inspirations}
          targetInspirationId={targetInspirationId}
          sourceImage={sourceImage}
          referenceImages={inspirationReferenceImages}
          selectedRound={selectedRound}
          attachBusy={attachMutation.isPending}
          deletingReferenceAssetId={
            deleteInspirationReferenceMutation.isPending ? (deleteInspirationReferenceMutation.variables ?? null) : null
          }
          onTargetInspirationChange={setTargetInspirationId}
          onDeleteReference={handleDeleteInspirationReference}
          onPreviewReference={(asset) => setReferencePreview({ asset, title: t("detail.referenceImage") })}
          onAttach={handleAttach}
          saveBlockedTitle={inspirationAttachBlockedTitle}
          editBlockedTitle={inspirationReferenceEditBlockedTitle}
          t={t}
          appearance={actionAppearance}
        />
      </section>
    );
  }

  function renderResourceGroupSelector({ disabled = false }: { disabled?: boolean }) {
    return (
      <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-700 dark:bg-[#0b1220]">
        <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
          {t("chat.resourceGroup")}
        </div>
        <LayoutSelectField
          value={selectedResourceGroupId ?? ""}
          options={[
            {
              value: "",
              label: resourceGroups.length ? t("chat.selectResourceGroup") : t("chat.noResourceGroups"),
              disabled: true,
            },
            ...resourceGroups.map((group) => ({
              value: group.id,
              label: resourceGroupOptionLabel(group, t("chat.resourceGroupDisabled")),
              disabled: !group.enabled,
            })),
          ]}
          onChange={handleGenerationResourceGroupChange}
          ariaLabel={t("chat.resourceGroup")}
          disabled={disabled}
          size="compact"
        />
      </div>
    );
  }

  function renderGenerationConfigSelector({
    label,
    helpKey,
    mode,
    configId,
    options,
    onModeChange,
    onConfigIdChange,
    disabled = false,
  }: {
    label: string;
    helpKey: "imageChatPromptPolishConfig" | "imageGenerationConfig";
    mode: GenerationConfigSelectionMode;
    configId: string | null;
    options: GenerationConfigOption[];
    onModeChange: (mode: GenerationConfigSelectionMode) => void;
    onConfigIdChange: (configId: string | null) => void;
    disabled?: boolean;
  }) {
    const configOptions = [
      {
        value: "",
        label: options.length ? t("chat.selectGenerationConfig") : t("chat.noGenerationConfigs"),
        disabled: true,
      },
      ...options.map((config) => ({
        value: config.id,
        label: generationConfigOptionLabel(
          config,
          t("chat.generationConfigDisabled"),
          t("chat.generationConfigFrozen"),
        ),
        disabled: !config.enabled,
      })),
    ];
    return (
      <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-700 dark:bg-[#0b1220]">
        <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
          <ParameterHelpLabel label={label} helpKey={helpKey} uiType="imageChat" />
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <LayoutSelectField
            value={mode}
            options={[
              { value: "auto", label: t("chat.generationConfigAuto") },
              { value: "manual", label: t("chat.generationConfigManual") },
            ]}
            onChange={(value) => onModeChange(value === "manual" ? "manual" : "auto")}
            ariaLabel={label}
            disabled={disabled}
            size="compact"
          />
          <LayoutSelectField
            value={mode === "manual" ? (configId ?? "") : ""}
            options={configOptions}
            onChange={(value) => onConfigIdChange(value || null)}
            ariaLabel={label}
            disabled={disabled || mode !== "manual"}
            size="compact"
          />
        </div>
      </div>
    );
  }

  function renderSelectedBaseImagesPanel() {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700/80 dark:bg-[#151f33]">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-950 dark:text-white">
            <Layers3 size={15} />
            {t("chat.baseImages")}
          </div>
          <span className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-300">
            {t("chat.baseImageCount", { selected: selectedBaseAssetIds.length, max: maxSelectedBaseImageCount })}
          </span>
        </div>
        {selectedBaseAssets.length ? (
          <div className="grid grid-cols-4 gap-2">
            {selectedBaseAssets.map((asset) => (
              <div
                key={asset.id}
                className="group relative overflow-hidden rounded-xl border border-indigo-200 bg-slate-50 ring-2 ring-indigo-100 dark:border-violet-400/45 dark:bg-[#0b1220] dark:ring-violet-400/35"
              >
                <button
                  type="button"
                  onClick={() => setReferencePreview({ asset, title: t("chat.baseImages") })}
                  className={previewSurfaceClassName}
                  title={asset.original_filename}
                  aria-label={t("detail.previewImage", { alt: asset.original_filename })}
                  style={actionButtonToneStyle(transparentActionToneVars)}
                >
                  <img
                    src={api.toApiUrl(asset.thumbnail_url)}
                    alt={asset.original_filename}
                    loading="lazy"
                    decoding="async"
                    className="h-20 w-full object-cover"
                  />
                </button>
                <div className="absolute left-1 top-1 rounded-md bg-indigo-600 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow-sm dark:bg-violet-500/90">
                  {asset.kind === "generated_image" ? t("chat.historyImage") : t("chat.sessionReferenceShort")}
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedBaseAssetIds((current) => removeImageBaseAssetId(current, asset.id))}
                  disabled={Boolean(generationSettingsBlockedTitle)}
                  title={generationSettingsBlockedTitle ?? t("chat.removeBaseImage")}
                  aria-label={t("chat.removeBaseImage")}
                  className={`absolute right-1 top-1 bg-white/92 dark:bg-slate-950/90 ${dangerIconCompactButtonClassName}`}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-20 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 text-center text-xs leading-5 text-slate-500 dark:border-slate-700 dark:bg-[#0b1220] dark:text-slate-400">
            <ImageIcon size={16} className="mr-2 shrink-0" />
            {t("chat.noBaseImages")}
          </div>
        )}
      </div>
    );
  }

  function renderSessionResourceGroupFilter() {
    const selectedSessionResourceGroup = resourceGroups.find((group) => group.id === selectedSessionResourceGroupId);
    const showSensitiveImageMaskPreference = shouldShowSensitiveImageMaskPreference(
      selectedSessionResourceGroupId,
      resourceGroups,
    );
    const selectedSessionOwner = rbacUsers.find((user) => user.id === selectedSessionOwnerUserId);
    const selectedSessionOwnerLabel = selectedSessionOwner
      ? ownerOptionLabel(selectedSessionOwner)
      : currentUser && currentUser.id === selectedSessionOwnerUserId
        ? ownerOptionLabel(currentUser)
        : selectedSessionOwnerUserId;
    const sessionOwnerOptions = [
      { value: "", label: t("chat.allOwners") },
      ...(currentUser && !rbacUsers.some((user) => user.id === currentUser.id)
        ? [{ value: currentUser.id, label: ownerOptionLabel(currentUser) }]
        : []),
      ...rbacUsers.map((user) => ({
        value: user.id,
        label: ownerOptionLabel(user),
      })),
    ];
    const activeFilterCount = [
      selectedSessionResourceGroupId,
      isAdmin && selectedSessionOwnerUserId,
      isAdmin && onlyDeletedSessions,
    ].filter(Boolean).length;
    const collapsedSummary = [
      selectedSessionResourceGroup?.name ?? (selectedSessionResourceGroupId ? selectedSessionResourceGroupId : t("chat.allResourceGroups")),
      isAdmin ? selectedSessionOwnerLabel : "",
      isAdmin && onlyDeletedSessions ? t("chat.onlyDeletedSessions") : "",
    ]
      .filter(Boolean)
      .join(" · ");

    return (
      <div className="pf-image-chat-filter rounded-xl border border-slate-200 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-950/40">
        <button
          type="button"
          onClick={() => setSessionFiltersExpanded((expanded) => !expanded)}
          aria-expanded={sessionFiltersExpanded}
          aria-label={sessionFiltersExpanded ? t("chat.sessionFiltersCollapse") : t("chat.sessionFiltersExpand")}
          className={actionSurfaceClassNameForAppearance(actionAppearance, {
            preset: "secondary",
            focusWithin: true,
            className: "pf-image-chat-filter-toggle flex w-full items-center justify-between gap-3 border-0 px-3 py-2.5 text-left shadow-none",
          })}
          style={actionButtonToneStyle(ghostSurfaceToneVars)}
        >
          <span className="min-w-0">
            <span className="flex items-center gap-2">
              <span className="pf-workspace-title text-xs font-semibold text-slate-700 dark:text-slate-200">{t("chat.sessionFilters")}</span>
              {activeFilterCount ? (
                <span className="pf-workspace-chip rounded-full border border-indigo-100 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:border-violet-400/30 dark:bg-violet-500/12 dark:text-violet-100">
                  {t("chat.sessionFiltersActiveCount", { count: activeFilterCount })}
                </span>
              ) : null}
            </span>
            {!sessionFiltersExpanded ? (
              <span className="pf-workspace-muted mt-1 block truncate text-[11px] text-slate-500 dark:text-slate-400">
                {collapsedSummary || t("chat.sessionFiltersCollapsedHint")}
              </span>
            ) : null}
          </span>
          <ChevronDown
            size={16}
            className={`shrink-0 text-slate-400 transition-transform ${sessionFiltersExpanded ? "rotate-180" : ""}`}
          />
        </button>
        {sessionFiltersExpanded ? (
          <div className="pf-image-chat-filter-body space-y-2 border-t border-slate-200 px-3 py-3 dark:border-slate-700">
            <label className="block">
              <span className="pf-workspace-muted mb-1.5 block text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                {t("chat.sessionResourceGroupFilter")}
              </span>
              <LayoutSelectField
                value={selectedSessionResourceGroupId ?? ""}
                options={[
                  { value: "", label: t("chat.allResourceGroups") },
                  ...resourceGroups.map((group) => ({
                    value: group.id,
                    label: resourceGroupOptionLabel(group, t("chat.resourceGroupDisabled")),
                    disabled: !group.enabled,
                  })),
                ]}
                onChange={handleSessionResourceGroupFilterChange}
                ariaLabel={t("chat.sessionResourceGroupFilter")}
                disabled={generationResourceGroupsQuery.isLoading}
                size="compact"
              />
            </label>
            {showSensitiveImageMaskPreference ? (
              <LayoutCheckbox
                checked={maskSensitiveImages}
                onChange={(event) => setMaskSensitiveImages(event.target.checked)}
                variant="card"
                wrapperClassName="pf-image-chat-filter-check px-2.5 py-2 text-xs font-semibold"
              >
                {t("chat.maskSensitiveImages")}
              </LayoutCheckbox>
            ) : null}
            {isAdmin ? (
              <>
                <label className="block">
                  <span className="pf-workspace-muted mb-1.5 block text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    {t("chat.sessionOwnerFilter")}
                  </span>
                  <LayoutSelectField
                    value={selectedSessionOwnerUserId}
                    options={sessionOwnerOptions}
                    onChange={handleSessionOwnerFilterChange}
                    ariaLabel={t("chat.sessionOwnerFilter")}
                    searchValue={selectedSessionOwnerSearch}
                    onSearchChange={setSelectedSessionOwnerSearch}
                    searchPlaceholder={t("chat.ownerSearchPlaceholder")}
                    searchAriaLabel={t("chat.ownerSearch")}
                    searchLoading={rbacUsersQuery.isFetching}
                    searchLoadingLabel={t("app.loading")}
                    size="compact"
                  />
                </label>
                <LayoutCheckbox
                  checked={onlyDeletedSessions}
                  onChange={(event) => handleOnlyDeletedSessionsChange(event.target.checked)}
                  variant="card"
                  wrapperClassName="pf-image-chat-filter-check px-2.5 py-2 text-xs font-semibold"
                >
                  {t("chat.onlyDeletedSessions")}
                </LayoutCheckbox>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  function renderGenerationSettingsTabs(promptId: string) {
    return (
      <ImageGenerationSettingsTabs
        value={settingsTab}
        onChange={setSettingsTab}
        appearance={actionAppearance}
        basic={
          <div className="space-y-4">
            {renderSelectedBaseImagesPanel()}

            <SessionReferencePanel
              assets={sessionReferenceAssets}
              selectedAssetIds={selectedBaseAssetIds}
              maxSelectedCount={maxSelectedReferenceCount}
              uploadBusy={uploadReferenceMutation.isPending}
              deletingAssetId={
                deleteSessionReferenceMutation.isPending
                  ? (deleteSessionReferenceMutation.variables?.assetId ?? null)
                  : null
              }
              disabled={!selectedSessionId || Boolean(sessionEditBlockedTitle)}
              selectionDisabled={Boolean(generationSettingsBlockedTitle)}
              resourceLibraryDisabledTitle={resourceLibraryLoadReferenceBlockedTitle}
              onFiles={handleUploadReferenceFiles}
              onClipboardError={(message) => setErrorMessage(message)}
              onOpenResourceLibrary={handleOpenResourceLibrary}
              onToggle={handleReferenceToggle}
              onDelete={handleDeleteSessionReference}
              onPreview={(asset) => setReferencePreview({ asset, title: t("chat.sessionReferences") })}
              t={t}
              appearance={actionAppearance}
            />

            {renderResourceGroupSelector({ disabled: Boolean(generationSettingsBlockedTitle) })}
            {renderGenerationConfigSelector({
              label: t("chat.imageGenerationConfig"),
              helpKey: "imageGenerationConfig",
              mode: generationConfigMode,
              configId: generationConfigId,
              options: imageGenerationConfigOptions,
              onModeChange: setGenerationConfigMode,
              onConfigIdChange: setGenerationConfigId,
              disabled: Boolean(generationSettingsBlockedTitle),
            })}

            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-950 dark:text-white" htmlFor={promptId}>
                <ParameterHelpLabel label={t("chat.prompt")} helpKey="imageChatPrompt" uiType="imageChat" />
              </label>
              <LayoutTextarea
                id={promptId}
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setPolishedPrompt("");
                }}
                disabled={Boolean(generationSettingsBlockedTitle)}
                title={generationSettingsBlockedTitle ?? t("chat.prompt")}
                rows={6}
                placeholder={isInspirationMode ? t("chat.inspirationPromptPlaceholder") : t("chat.freePromptPlaceholder")}
                className={workspaceSubpage ? "rounded-2xl" : undefined}
              />
              <div className="mt-2 grid gap-2">
                {renderGenerationConfigSelector({
                  label: t("chat.promptPolishConfig"),
                  helpKey: "imageChatPromptPolishConfig",
                  mode: promptPolishConfigMode,
                  configId: promptPolishConfigId,
                  options: promptPolishConfigOptions,
                  onModeChange: setPromptPolishConfigMode,
                  onConfigIdChange: setPromptPolishConfigId,
                  disabled: Boolean(generationSettingsBlockedTitle),
                })}
                <ActionButton
                  preset="primary"
                  size="sm"
                  onClick={handlePolishPrompt}
                  disabled={
                    !draft.trim() ||
                    polishPromptMutation.isPending ||
                    Boolean(
                      generationSettingsBlockedTitle ||
                      resourceGroupRequirementMessage ||
                      promptPolishConfigRequirementMessage,
                    )
                  }
                  title={
                    generationSettingsBlockedTitle ??
                    resourceGroupRequirementMessage ??
                    promptPolishConfigRequirementMessage ??
                    t("chat.polishPrompt")
                  }
                  loading={polishPromptMutation.isPending}
                  leadingIcon={<Sparkles size={13} />}
                  fullWidth
                >
                  {t("chat.polishPrompt")}
                </ActionButton>
                {polishedPrompt ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs leading-5 text-emerald-800 dark:border-emerald-400/35 dark:bg-emerald-500/10 dark:text-emerald-100">
                    <div className="whitespace-pre-wrap">{polishedPrompt}</div>
                    <div className="mt-2 flex gap-2">
                      <ActionButton
                        preset="primary"
                        size="sm"
                        onClick={handleUsePolishedPrompt}
                        disabled={Boolean(generationSettingsBlockedTitle)}
                        title={generationSettingsBlockedTitle ?? t("chat.usePolishedPrompt")}
                      >
                        {t("chat.usePolishedPrompt")}
                      </ActionButton>
                      <ActionButton
                        preset="secondary"
                        size="sm"
                        onClick={() => setPolishedPrompt("")}
                      >
                        {t("common.cancel")}
                      </ActionButton>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <ImageGenerationSettingsPanel
              size={size}
              sizeOptions={sizeOptions}
              maxDimension={imageGenerationMaxDimension}
              toolOptions={toolOptions}
              allowedToolFields={imageToolAllowedFields}
              generationCount={generationCount}
              generationCountOptions={IMAGE_CHAT_GENERATION_COUNT_OPTIONS}
              onSizeChange={setSize}
              onToolOptionsChange={setToolOptions}
              onGenerationCountChange={(count) => setGenerationCount(clampGenerationCount(count))}
              showToolOptions={false}
              helpUiType="imageChat"
              disabled={Boolean(generationSettingsBlockedTitle)}
              appearance={inputAppearance}
            />
          </div>
        }
        advanced={
          <ImageToolControls
            value={toolOptions}
            allowedFields={imageToolAllowedFields}
            helpUiType="imageChat"
            onChange={setToolOptions}
            disabled={Boolean(generationSettingsBlockedTitle)}
            appearance={inputAppearance}
          />
        }
      />
    );
  }

  function renderModeToggle() {
    return (
      <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-[#0b1220]">
        {(["normal", "enhance"] as ImageChatMode[]).map((mode) => (
          <ActionButton
            key={mode}
            preset="secondary"
            size="sm"
            onClick={() => setChatMode(mode)}
            aria-pressed={chatMode === mode}
            className="h-9 w-full justify-center text-xs"
          >
            {t(mode === "normal" ? "chat.mode.normal" : "chat.mode.enhance")}
          </ActionButton>
        ))}
      </div>
    );
  }

  function renderEnhanceSettingsSection() {
    const sourceOptions = [
      {
        value: "",
        label: enhanceSourceAssets.length ? t("chat.enhance.selectSource") : t("chat.enhance.noSource"),
        disabled: true,
      },
      ...enhanceSourceAssets.map((asset) => ({
        value: asset.id,
        label: `${asset.kind === "generated_image" ? t("chat.historyImage") : t("chat.sessionReferenceShort")} · ${
          asset.original_filename
        }`,
      })),
    ];
    const activeJobFinalReady = activeEnhanceJob?.result_manifest?.final_status === "ready";
    const activeJobSaved = Boolean(activeEnhanceJobId && savedEnhanceJobIds.has(activeEnhanceJobId));
    return (
      <section className="space-y-3">
        <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-950 dark:text-white">
          <Settings size={15} /> {t("chat.enhance.settings")}
        </div>
        {renderModeToggle()}
        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700/80 dark:bg-[#151f33]">
          <div className="grid gap-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-200">
                {t("chat.enhance.source")}
              </span>
              <LayoutSelectField
                value={enhanceSourceAssetId}
                options={sourceOptions}
                onChange={setEnhanceSourceAssetId}
                ariaLabel={t("chat.enhance.source")}
                disabled={Boolean(enhanceSettingsBlockedTitle)}
                size="compact"
              />
            </label>
            {selectedEnhanceSourceAsset ? (
              <button
                type="button"
                onClick={() =>
                  setReferencePreview({
                    asset: selectedEnhanceSourceAsset,
                    title: t("chat.enhance.source"),
                  })
                }
                className={`${previewSurfaceClassName} overflow-hidden rounded-xl text-left`}
                style={actionButtonToneStyle(transparentActionToneVars)}
              >
                <img
                  src={api.toApiUrl(selectedEnhanceSourceAsset.thumbnail_url || selectedEnhanceSourceAsset.preview_url)}
                  alt={selectedEnhanceSourceAsset.original_filename}
                  className="h-28 w-full object-cover"
                />
              </button>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
              {t("chat.enhance.strategy")}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(["direct", "tiled"] as EnhanceStrategy[]).map((strategyOption) => (
                <ActionButton
                  key={strategyOption}
                  preset="secondary"
                  size="sm"
                  onClick={() => setEnhanceStrategy(strategyOption)}
                  disabled={Boolean(enhanceSettingsBlockedTitle)}
                  aria-pressed={enhanceStrategy === strategyOption}
                  className="h-9 w-full justify-center px-3 text-xs"
                >
                  {t(
                    strategyOption === "direct"
                      ? "chat.enhance.strategyDirect"
                      : "chat.enhance.strategyTiled",
                  )}
                </ActionButton>
              ))}
            </div>
          </div>

          {enhanceStrategy === "direct" ? (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                {IMAGE_CHAT_ENHANCE_DIRECT_PRESETS.map((preset) => (
                  <ActionButton
                    key={preset}
                    preset="secondary"
                    size="sm"
                    disabled={preset > imageGenerationMaxDimension || Boolean(enhanceSettingsBlockedTitle)}
                    onClick={() => {
                      setEnhanceDirectWidth(String(preset));
                      setEnhanceDirectHeight(String(preset));
                    }}
                    aria-pressed={enhanceDirectWidth === String(preset) && enhanceDirectHeight === String(preset)}
                    className="h-8 w-full justify-center text-xs"
                  >
                    {preset}
                  </ActionButton>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {t("chat.enhance.width")}
                  <LayoutTextInput
                    value={enhanceDirectWidth}
                    onChange={(event) => setEnhanceDirectWidth(event.target.value)}
                    size="compact"
                    className="mt-1"
                    inputMode="numeric"
                    disabled={Boolean(enhanceSettingsBlockedTitle)}
                  />
                </label>
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  {t("chat.enhance.height")}
                  <LayoutTextInput
                    value={enhanceDirectHeight}
                    onChange={(event) => setEnhanceDirectHeight(event.target.value)}
                    size="compact"
                    className="mt-1"
                    inputMode="numeric"
                    disabled={Boolean(enhanceSettingsBlockedTitle)}
                  />
                </label>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                {IMAGE_CHAT_ENHANCE_SCALES.map((scale) => (
                  <ActionButton
                    key={scale}
                    preset="secondary"
                    size="sm"
                    onClick={() => setEnhanceScale(scale)}
                    disabled={Boolean(enhanceSettingsBlockedTitle)}
                    aria-pressed={enhanceScale === scale}
                    className="h-8 w-full justify-center text-xs"
                  >
                    {scale}x
                  </ActionButton>
                ))}
              </div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-300">
                {t("chat.enhance.tileBaseSize")}
                <LayoutTextInput
                  value={enhanceTileBaseSize}
                  onChange={(event) => setEnhanceTileBaseSize(event.target.value)}
                  size="compact"
                  className="mt-1"
                  inputMode="numeric"
                  disabled={Boolean(enhanceSettingsBlockedTitle)}
                />
              </label>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t("chat.enhance.tileCalls", { count: estimatedEnhanceTileCallCount ?? t("common.unknown") })}
              </p>
            </div>
          )}

          {renderResourceGroupSelector({ disabled: Boolean(enhanceSettingsBlockedTitle) })}
          {renderGenerationConfigSelector({
            label: t("chat.imageGenerationConfig"),
            helpKey: "imageGenerationConfig",
            mode: generationConfigMode,
            configId: generationConfigId,
            options: imageGenerationConfigOptions,
            onModeChange: setGenerationConfigMode,
            onConfigIdChange: setGenerationConfigId,
            disabled: Boolean(enhanceSettingsBlockedTitle),
          })}

          {activeEnhanceJob ? (
            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-[#0b1220]">
              <EnhanceJobProgress appearance={actionAppearance} job={activeEnhanceJob} compact />
              {processingEnhanceJobId === activeEnhanceJob.id ? (
                <div className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-300">
                  <Loader2 size={14} className="animate-spin" />
                  {t("chat.enhance.processingFinal")}
                </div>
              ) : null}
              {activeEnhanceAttachedRound ? (
                <div className="flex flex-wrap gap-2">
                  <ActionButton
                    preset="primary"
                    size="sm"
                    onClick={handleUseAttachedEnhanceAsBase}
                    leadingIcon={<Layers3 size={14} />}
                  >
                    {t("chat.enhance.useAsBase")}
                  </ActionButton>
                  <ActionButton
                    preset="secondary"
                    size="sm"
                    onClick={() => activeEnhanceJobId && saveEnhanceJobMutation.mutate(activeEnhanceJobId)}
                    disabled={!activeJobFinalReady || saveEnhanceJobMutation.isPending || activeJobSaved}
                    loading={saveEnhanceJobMutation.isPending}
                    leadingIcon={activeJobSaved ? <Check size={14} /> : <Save size={14} />}
                  >
                    {activeJobSaved ? t("chat.enhance.savedToLibrary") : t("chat.enhance.saveToLibrary")}
                  </ActionButton>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  function renderGenerationSettingsSection(promptId: string) {
    if (chatMode === "enhance") {
      return renderEnhanceSettingsSection();
    }
    if (!generationDraftOpen) {
      return (
        <section className="space-y-3">
          <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-950 dark:text-white">
            <Settings size={15} /> {t("chat.generationSettings")}
          </div>
          {renderModeToggle()}
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm font-medium leading-6 text-slate-500 dark:border-slate-700 dark:bg-slate-950/45 dark:text-slate-300">
            {generationDraftGateMessage}
          </div>
        </section>
      );
    }
    return (
      <section className="space-y-3">
        <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-950 dark:text-white">
          <Settings size={15} /> {t("chat.generationSettings")}
        </div>
        {renderModeToggle()}
        {renderGenerationSettingsTabs(promptId)}
      </section>
    );
  }

  function renderActionSections(promptId: string) {
    const generationSettingsSection = renderGenerationSettingsSection(promptId);
    const resultUsageSection = renderResultUsageSection();
    return selectedRound ? (
      <>
        {resultUsageSection}
        {generationSettingsSection}
      </>
    ) : (
      <>
        {generationSettingsSection}
        {resultUsageSection}
      </>
    );
  }

  const selectedSessionTitle = imageSession?.title ?? t("chat.workbench");
  const selectedRoundSizeText = selectedRound
    ? t("gallery.sizeActualRequested", {
        actual: selectedRound.actual_size ?? selectedRound.size,
        requested: selectedRound.size,
      })
    : "";
  const selectedRoundCandidateText = selectedRound
    ? t("chat.candidate", { index: selectedRound.candidate_index, count: selectedRound.candidate_count })
    : "";
  const selectedPlaceholderCandidateText = selectedPlaceholder
    ? t("chat.candidate", { index: selectedPlaceholder.candidate_index, count: selectedPlaceholder.candidate_count })
    : "";
  const activePreviewPrompt = activePreviewRound?.prompt?.trim() ?? "";
  const previewPromptCopyTitle =
    previewPromptCopyState === "copied"
      ? t("gallery.promptCopied")
      : previewPromptCopyState === "failed"
        ? t("gallery.promptCopyFailed")
        : t("gallery.copyPrompt");
  const handleCopyPreviewPrompt = async () => {
    if (!activePreviewPrompt) {
      return;
    }
    try {
      await copyTextToClipboard(activePreviewPrompt);
      setPreviewPromptCopyState("copied");
    } catch {
      setPreviewPromptCopyState("failed");
    }
  };
  const stageInfoChipClass =
    "inline-flex min-w-0 max-w-full items-center rounded-lg border border-slate-200/90 bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-slate-600 shadow-sm shadow-slate-900/5 backdrop-blur-md dark:border-slate-600/70 dark:bg-slate-950/82 dark:text-slate-200";
  const selectedRoundStageInfo = selectedRound ? (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
      <span className={stageInfoChipClass} title={selectedRound.resource_group.name}>
        <span className="max-w-[10rem] truncate">{selectedRound.resource_group.name}</span>
      </span>
      <span className={stageInfoChipClass}>{selectedRoundSizeText}</span>
      <span className={stageInfoChipClass}>{selectedRoundCandidateText}</span>
      <span
        className={stageInfoChipClass}
        title={`${selectedRound.provider_name} · ${selectedRound.model_name}`}
      >
        <span className="max-w-[12rem] truncate">{selectedRound.model_name}</span>
      </span>
    </div>
  ) : selectedPlaceholder ? (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
      <span className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold shadow-sm backdrop-blur-md ${placeholderStatusClass(selectedPlaceholder)}`}>
        {placeholderStatusLabel(selectedPlaceholder, t)}
      </span>
      <span className={stageInfoChipClass}>{selectedPlaceholderCandidateText}</span>
    </div>
  ) : (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
      <span className={stageInfoChipClass}>{t("chat.waitingFirstResult")}</span>
    </div>
  );
  const selectedRoundStageActions = selectedRound ? (
    <a
      href={api.toApiUrl(selectedRound.generated_asset.download_url)}
      target="_blank"
      rel="noreferrer"
      title={selectedResultResourceBlockedTitle ?? t("chat.downloadCurrent")}
      aria-label={t("chat.downloadCurrent")}
      onClick={(event) => {
        if (selectedResultResourceBlockedTitle) {
          event.preventDefault();
          setErrorMessage(selectedResultResourceBlockedTitle);
        }
      }}
      className={`${secondaryIconCompactButtonClassName} w-8 bg-white/90 px-0 backdrop-blur-md aria-disabled:cursor-not-allowed aria-disabled:opacity-60 dark:bg-slate-950/82`}
      aria-disabled={Boolean(selectedResultResourceBlockedTitle)}
    >
      <Download size={14} />
    </a>
  ) : null;
  const renderSelectedRoundHeaderActions = () =>
    selectedRound ? (
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <ActionButton
          preset="secondary"
          size="sm"
          onClick={handleSaveSelectedToGallery}
          disabled={saveSelectedGalleryDisabled}
          title={saveSelectedGalleryTitle}
          aria-label={saveSelectedGalleryTitle}
          loading={saveGalleryMutation.isPending}
          leadingIcon={selectedGeneratedSavedToGallery ? <Check size={13} /> : <GalleryHorizontalEnd size={13} />}
          className="text-[11px]"
        >
          {selectedGeneratedSavedToGallery ? t("chat.alreadyInGallery") : t("chat.sendGallery")}
        </ActionButton>
        <ActionButton
          preset="primary"
          size="sm"
          onClick={handleSaveSelectedToResourceLibrary}
          disabled={saveSelectedResourceLibraryDisabled}
          title={resourceLibrarySaveGeneratedBlockedTitle ?? t("chat.resourceLibrary.saveGenerated")}
          aria-label={t("chat.resourceLibrary.saveGenerated")}
          leadingIcon={selectedGeneratedSavedToResourceLibrary ? <Check size={13} /> : <Save size={13} />}
          className="text-[11px]"
        >
          {selectedGeneratedSavedToResourceLibrary
            ? t("resourceLibrary.alreadyInLibrary")
            : t("chat.resourceLibrary.saveGenerated")}
        </ActionButton>
      </div>
    ) : null;
  const primaryBlockedResource = chatMode === "enhance" ? enhanceBlockedResource : generationBlockedResource;
  const primarySubmitRequirementMessage =
    chatMode === "enhance" ? enhanceSubmitRequirementMessage : generationSubmitRequirementMessage;
  const primaryActionDisabled = chatMode === "enhance" ? enhanceSubmitDisabled : generateDisabled;
  const primaryActionPending = chatMode === "enhance" ? enhanceBusy : generateMutation.isPending;
  const primaryActionTitle =
    chatMode === "enhance"
      ? enhanceBlockedTitle ?? (enhanceSubmitRequirementMessage || t("chat.enhance.start"))
      : generationBlockedTitle ?? (generationSubmitRequirementMessage || t("chat.startGenerate"));
  const primaryActionLabel =
    chatMode === "enhance"
      ? primaryActionPending
        ? t("chat.enhance.submitting")
        : t("chat.enhance.start")
      : generateMutation.isPending
        ? t("chat.submitting")
        : submitGenerationCount > 1
          ? t("chat.startGenerateCount", { count: submitGenerationCount })
          : t("chat.startGenerate");

  const pendingDeleteDialog = pendingDeleteAction
    ? {
        title:
          pendingDeleteAction.kind === "session"
            ? t("chat.confirmDeleteSessionTitle")
            : pendingDeleteAction.kind === "inspirationReference"
              ? t("chat.confirmDeleteInspirationReferenceTitle")
              : t("chat.confirmDeleteSessionReferenceTitle"),
        description:
          pendingDeleteAction.kind === "session"
            ? t("chat.confirmDeleteSession")
            : pendingDeleteAction.kind === "inspirationReference"
              ? t("chat.confirmDeleteInspirationReference")
              : t("chat.confirmDeleteSessionReference"),
        busy:
          pendingDeleteAction.kind === "session"
            ? deleteSessionMutation.isPending
            : pendingDeleteAction.kind === "inspirationReference"
              ? deleteInspirationReferenceMutation.isPending
              : deleteSessionReferenceMutation.isPending,
      }
    : null;

  return (
    <div className="pf-workspace pf-image-chat-workspace flex flex-col text-slate-900 dark:text-slate-100 lg:h-[100dvh] lg:overflow-hidden">
      <TopNav
        breadcrumbs={isInspirationMode ? `${inspirationQuery.data?.name ?? t("chat.inspirationFallback")} / ${t("chat.breadcrumb")}` : t("chat.breadcrumb")}
        onHome={() => navigate(isInspirationMode && inspirationId ? `/inspirations/${inspirationId}` : "/inspirations")}
        onLogout={() => logoutMutation.mutate()}
      />

      <main
        className="pf-image-chat-workspace-main flex min-h-0 flex-1 flex-col pb-[calc(8.5rem+env(safe-area-inset-bottom))] lg:flex-row lg:overflow-hidden lg:pb-0"
        onPointerDown={handleMobileEdgeSwipeStart}
      >
        <aside
          className="pf-workspace-tool-rail pf-image-chat-session-rail relative hidden w-full shrink-0 flex-col border-b border-slate-200 bg-white/95 dark:border-slate-700/80 dark:bg-[#0f1726] dark:shadow-[12px_0_36px_rgba(0,0,0,0.24)] dark:backdrop-blur-xl lg:flex lg:w-[var(--image-chat-left-panel-width)] lg:border-b-0 lg:border-r"
          style={leftPanelStyle}
        >
          <button
            type="button"
            aria-label={t("chat.resizeSessions")}
            title={t("chat.resizeSessionsTitle")}
            onPointerDown={(event) => handlePanelResizeStart("left", event)}
            className={actionSurfaceClassNameForAppearance(actionAppearance, {
              preset: "secondary",
              focusWithin: true,
              className:
                "absolute right-[-5px] top-0 z-20 hidden h-full w-3 cursor-col-resize items-center justify-center border-0 shadow-none lg:flex",
            })}
            style={actionButtonToneStyle(resizeHandleToneVars)}
          >
            <span className="h-12 w-1 rounded-full bg-slate-300 dark:bg-slate-600" />
          </button>
          <div className="pf-image-chat-session-header border-b border-slate-200 px-4 py-4 dark:border-slate-800 lg:px-8">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="pf-workspace-title text-sm font-semibold text-slate-950 dark:text-white">{t("chat.sessions")}</div>
                <div className="pf-workspace-muted mt-1 text-xs text-slate-500 dark:text-slate-400">{t("chat.count", { count: sessionItems.length })}</div>
              </div>
              <ActionButton
                preset="primary"
                size="lg"
                onClick={openCreateSessionDialog}
                disabled={createSessionDisabled}
                title={createSessionButtonTitle}
                aria-label={t("chat.newSession")}
                loading={createSessionMutation.isPending}
                leadingIcon={<Plus size={18} className="shrink-0" />}
                className="min-w-[5.5rem]"
              >
                {t("chat.newSessionShort")}
              </ActionButton>
            </div>
            <div className="mt-3">{renderSessionResourceGroupFilter()}</div>
          </div>

          <ImageChatSessionList
            items={sessionItems}
            isLoading={sessionsQuery.isLoading}
            selectedSessionId={selectedSessionId}
            deletingSessionId={deleteSessionMutation.isPending ? (deleteSessionMutation.variables ?? null) : null}
            deletionEnabled={sessionDeletionEnabled}
            deletionBlockedTitle={sessionListDeletionBlockedTitle}
            currentUser={currentUser}
            variant="desktop"
            appearance={actionAppearance}
            maskSensitiveImages={maskSensitiveImages}
            onSelectSession={handleSelectSession}
            onDeleteSession={handleDeleteSession}
            t={t}
          />
        </aside>

        <section className="pf-workspace-stage flex min-h-0 min-w-0 flex-1 flex-col lg:overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col p-3 pb-2">
            <div className="mb-3 flex items-center justify-between gap-1.5 lg:hidden">
              <ActionButton
                ref={mobileSessionButtonRef}
                preset="secondary"
                size="icon-lg"
                onClick={() => setMobileSessionDrawerOpen(true)}
                aria-label={t("chat.openSessionDrawer")}
                leadingIcon={<Menu size={18} />}
              >
              </ActionButton>
              <div className="min-w-0 flex-1 px-1 text-left">
                {renameEnabled ? (
                  <LayoutTextInput
                    value={titleDraft}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        handleRename();
                      }
                      if (event.key === "Escape") {
                        setRenameEnabled(false);
                        setTitleDraft(imageSession?.title ?? "");
                      }
                    }}
                    disabled={renameSessionMutation.isPending || Boolean(sessionEditBlockedTitle)}
                    title={sessionEditBlockedTitle ?? t("chat.rename")}
                    aria-label={t("chat.rename")}
                    size="default"
                    className="text-center font-semibold"
                  />
                ) : (
                  <>
                    <div className="truncate text-sm font-semibold text-slate-950 dark:text-white" title={selectedSessionTitle}>
                      {selectedSessionTitle}
                    </div>
                    {selectedRound ? (
                      <div className="mt-1 flex justify-end">{renderSelectedRoundHeaderActions()}</div>
                    ) : null}
                  </>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <ActionButton
                  preset="primary"
                  size="icon-lg"
                  onClick={() => {
                    if (renameEnabled) {
                      handleRename();
                      return;
                    }
                    setRenameEnabled(true);
                  }}
                  disabled={renameSessionDisabled}
                  title={sessionEditBlockedTitle ?? (renameEnabled ? t("chat.saveSessionName") : t("chat.rename"))}
                  aria-label={renameEnabled ? t("chat.saveSessionName") : t("chat.rename")}
                  loading={renameSessionMutation.isPending}
                  leadingIcon={renameEnabled ? <Save size={17} /> : <Pencil size={16} />}
                >
                </ActionButton>
                <ActionButton
                  ref={mobileHistoryButtonRef}
                  preset="secondary"
                  size="icon-lg"
                  onClick={() => setMobileHistoryDrawerOpen(true)}
                  aria-label={t("chat.openHistoryDrawer")}
                  leadingIcon={<History size={17} />}
                >
                </ActionButton>
              </div>
            </div>
            <div className="mb-3 flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="hidden min-w-0 flex-1 flex-wrap items-center gap-2 lg:flex">
                  <h1
                    className="max-w-[min(46rem,58vw)] truncate text-xl font-semibold tracking-tight text-slate-950 dark:text-white"
                    title={selectedSessionTitle}
                  >
                    {selectedSessionTitle}
                  </h1>
                  {selectedRoundIsBase ? (
                    <span className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full bg-indigo-600 px-3 text-xs font-semibold text-white shadow-sm shadow-indigo-500/20 dark:bg-violet-500/20 dark:text-violet-100 dark:ring-1 dark:ring-violet-400/40">
                      <Layers3 size={12} /> {t("chat.baseSelected")}
                    </span>
                  ) : null}
                </div>
                <div className="hidden shrink-0 justify-end lg:flex">{renderSelectedRoundHeaderActions()}</div>
              </div>
            </div>
            {sessionOrInspirationBlockedResource ? (
              <ResourceBlockedNotice resource={sessionOrInspirationBlockedResource} className="mb-3" />
            ) : null}

            <ImageChatMainStage
              sessionRounds={imageSession?.rounds ?? []}
              selectedRound={selectedRound}
              selectedPlaceholder={selectedPlaceholder}
              retryingTaskId={null}
              cancellingTaskId={cancelGenerationTaskMutation.isPending ? (cancelGenerationTaskMutation.variables?.taskId ?? null) : null}
              regenerating={generateMutation.isPending}
              appearance={actionAppearance}
              maskSensitiveImages={maskSensitiveImages}
              generationBlockedTitle={selectedPlaceholderActionBlockedTitle}
              stageInfo={selectedRoundStageInfo}
              stageActions={selectedRoundStageActions}
              onSelectRound={handleSelectHistoryRound}
              onPreviewRound={setPreviewRound}
              onRetryGenerationTask={handleRetryGenerationTask}
              onCancelGenerationTask={handleCancelGenerationTask}
              onRegenerateGenerationTask={handleRegenerateGenerationTask}
              t={t}
            />
            {selectedRound ? (
              <ResourceMetaBadges resource={selectedRound.generated_asset} className="mt-2" showReason />
            ) : null}
            {selectedResultBlockedResource ? (
              <ResourceBlockedNotice resource={selectedResultBlockedResource} className="mt-2" />
            ) : null}
            {selectedPlaceholder?.failure_reason ? (
              <div className="mt-2 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200">
                {selectedPlaceholder.failure_reason}
              </div>
            ) : selectedPlaceholder?.provider_notes.length ? (
              <div className="mt-2 flex flex-wrap gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-200">
                {selectedPlaceholder.provider_notes.map((note) => (
                  <span key={note}>{note}</span>
                ))}
              </div>
            ) : null}
          </div>

          <ImageChatHistoryPanel
            historyBranches={historyBranches}
            selectedGeneratedAssetId={selectedGeneratedAssetId}
            selectedTaskPlaceholderId={selectedTaskPlaceholderId}
            selectedBaseAssetIds={selectedBaseAssetIds}
            appearance={actionAppearance}
            style={historyPanelStyle}
            onResizeStart={(event) => handlePanelResizeStart("history", event)}
            onSelectRound={handleSelectHistoryRound}
            onAddRoundToBase={handleAddHistoryRoundToBase}
            onSelectPlaceholder={handleSelectHistoryPlaceholder}
            onStartNewRound={handleStartNewRound}
            newRoundDisabled={newRoundDisabled}
            newRoundActive={generationDraftMode === "new_round"}
            newRoundTitle={newRoundBlockedTitle || t("chat.newRound")}
            maskSensitiveImages={maskSensitiveImages}
            onPreviewPrompt={setPromptPreview}
            t={t}
          />
        </section>

        <aside
          className="pf-workspace-tool-rail relative hidden w-full shrink-0 flex-col border-t border-slate-200 bg-white dark:border-slate-700/80 dark:bg-[#0f1726] dark:shadow-[-12px_0_36px_rgba(0,0,0,0.24)] dark:backdrop-blur-xl lg:flex lg:w-[var(--image-chat-right-panel-width)] lg:border-l lg:border-t-0"
          style={rightPanelStyle}
        >
          <button
            type="button"
            aria-label={t("chat.resizeSettings")}
            title={t("chat.resizeSettingsTitle")}
            onPointerDown={(event) => handlePanelResizeStart("right", event)}
            className={actionSurfaceClassNameForAppearance(actionAppearance, {
              preset: "secondary",
              focusWithin: true,
              className:
                "absolute left-[-5px] top-0 z-20 hidden h-full w-3 cursor-col-resize items-center justify-center border-0 shadow-none lg:flex",
            })}
            style={actionButtonToneStyle(resizeHandleToneVars)}
          >
            <span className="h-12 w-1 rounded-full bg-slate-300 dark:bg-slate-600" />
          </button>
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-y-contain px-4 py-5 lg:px-5">
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-950 dark:text-white">
                    <Pencil size={15} /> {t("chat.sessionSettings")}
                  </div>
                </div>
                <ActionButton
                  preset="secondary"
                  size="sm"
                  onClick={() => setRenameEnabled((current) => !current)}
                  disabled={renameSessionDisabled}
                  title={sessionEditBlockedTitle ?? t("chat.rename")}
                  leadingIcon={<Pencil size={12} />}
                  className="h-8 px-2.5 text-xs"
                >
                  {t("chat.rename")}
                </ActionButton>
              </div>
              <div className="flex gap-2">
                <LayoutTextInput
                  value={titleDraft}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  disabled={!renameEnabled || renameSessionMutation.isPending || Boolean(sessionEditBlockedTitle)}
                  title={sessionEditBlockedTitle ?? t("chat.rename")}
                  size="default"
                />
                {renameEnabled ? (
                  <ActionButton
                    preset="primary"
                    size="icon-lg"
                    onClick={handleRename}
                    disabled={renameSessionMutation.isPending || Boolean(sessionEditBlockedTitle)}
                    title={sessionEditBlockedTitle ?? t("chat.saveSessionName")}
                    aria-label={t("chat.saveSessionName")}
                    loading={renameSessionMutation.isPending}
                    leadingIcon={<Save size={14} />}
                  >
                  </ActionButton>
                ) : null}
              </div>
            </div>

            {renderActionSections("image-chat-prompt")}

            <div className="space-y-4">
              {successMessage ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/10 dark:text-emerald-200">
                  {successMessage}
                </div>
              ) : null}
              {errorMessage ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200">{errorMessage}</div>
              ) : null}
            </div>
          </div>

          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-[0_-8px_24px_rgba(15,23,42,0.10)] backdrop-blur dark:border-slate-800 dark:bg-slate-950/90 dark:shadow-[0_-18px_40px_rgba(0,0,0,0.32)] lg:sticky lg:inset-x-auto lg:bottom-0 lg:p-4">
            {primaryBlockedResource ? (
              <ResourceBlockedNotice resource={primaryBlockedResource} className="mb-2" />
            ) : null}
            {primarySubmitRequirementMessage ? (
              <div className="mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-200">
                {primarySubmitRequirementMessage}
              </div>
            ) : null}
            <ActionButton
              preset="primary"
              size="lg"
              onClick={chatMode === "enhance" ? handleSubmitEnhance : handleGenerate}
              disabled={primaryActionDisabled}
              title={primaryActionTitle}
              fullWidth
              loading={primaryActionPending}
              leadingIcon={<Sparkles size={15} />}
              className="py-3.5"
            >
              {primaryActionLabel}
            </ActionButton>
          </div>
        </aside>
      </main>
      <Drawer.Root
        direction="left"
        open={mobileSessionDrawerOpen}
        onOpenChange={(open) => {
          setMobileSessionDrawerOpen(open);
          if (!open) {
            mobileSessionButtonRef.current?.focus();
          }
        }}
      >
        <Drawer.Portal>
          <Drawer.Overlay
            className="fixed inset-0 z-[70] bg-slate-950/45 backdrop-blur-[2px] lg:hidden"
            onWheel={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onTouchMove={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          />
          <Drawer.Content
            data-floating-root
            onPointerDown={(event) => {
              event.stopPropagation();
              handleMobileSessionDrawerSwipeBackStart(event);
            }}
            onClick={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
            onTouchMove={(event) => event.stopPropagation()}
            className="pf-workspace-tool-drawer pf-image-chat-session-drawer fixed inset-y-0 left-0 z-[71] flex w-[min(86vw,360px)] flex-col border-r border-slate-200 bg-white shadow-2xl outline-none dark:border-slate-700 dark:bg-[#0f1726] lg:hidden"
          >
            <Drawer.Title className="sr-only">{t("chat.mobileSessionDrawer")}</Drawer.Title>
            <div className="pf-image-chat-session-header border-b border-slate-200 px-4 py-4 dark:border-slate-800">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="pf-workspace-title text-sm font-semibold text-slate-950 dark:text-white">{t("chat.sessions")}</div>
                  <div className="pf-workspace-muted mt-1 text-xs text-slate-500 dark:text-slate-400">{t("chat.count", { count: sessionItems.length })}</div>
                </div>
                <div className="flex items-center gap-2">
                  <ActionButton
                    preset="primary"
                    size="lg"
                    onClick={openCreateSessionDialog}
                    disabled={createSessionDisabled}
                    title={createSessionButtonTitle}
                    aria-label={t("chat.newSession")}
                    loading={createSessionMutation.isPending}
                    leadingIcon={<Plus size={18} className="shrink-0" />}
                    className="min-w-[5.5rem]"
                  >
                    {t("chat.newSessionShort")}
                  </ActionButton>
                  <ActionButton
                    preset="secondary"
                    size="icon-lg"
                    aria-label={t("chat.closeSessionDrawer")}
                    onClick={() => {
                      setMobileSessionDrawerOpen(false);
                      mobileSessionButtonRef.current?.focus();
                    }}
                    leadingIcon={<X size={18} />}
                  >
                  </ActionButton>
                </div>
              </div>
              <div className="mt-3">{renderSessionResourceGroupFilter()}</div>
            </div>
            <ImageChatSessionList
              items={sessionItems}
              isLoading={sessionsQuery.isLoading}
              selectedSessionId={selectedSessionId}
              deletingSessionId={deleteSessionMutation.isPending ? (deleteSessionMutation.variables ?? null) : null}
            deletionEnabled={sessionDeletionEnabled}
            deletionBlockedTitle={sessionListDeletionBlockedTitle}
            currentUser={currentUser}
            variant="mobile"
            appearance={actionAppearance}
            maskSensitiveImages={maskSensitiveImages}
            onSelectSession={handleSelectSession}
            onDeleteSession={handleDeleteSession}
              t={t}
            />
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      <Drawer.Root
        direction="right"
        open={mobileHistoryDrawerOpen}
        onOpenChange={(open) => {
          setMobileHistoryDrawerOpen(open);
          if (!open) {
            mobileHistoryButtonRef.current?.focus();
          }
        }}
      >
        <Drawer.Portal>
          <Drawer.Overlay
            className="fixed inset-0 z-[70] bg-slate-950/45 backdrop-blur-[2px] lg:hidden"
            onWheel={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onTouchMove={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          />
          <Drawer.Content
            data-floating-root
            className="pf-workspace-tool-drawer fixed inset-y-0 right-0 z-[71] flex w-[7.75rem] flex-col border-l border-slate-200 bg-white shadow-2xl outline-none dark:border-slate-700 dark:bg-[#0f1726] lg:hidden"
            onClick={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
            onTouchMove={(event) => event.stopPropagation()}
          >
            <Drawer.Title className="sr-only">{t("chat.mobileHistoryDrawer")}</Drawer.Title>
            <div className="flex items-center justify-between gap-1 border-b border-slate-200 px-2 py-3 dark:border-slate-800">
              <div className="min-w-0 px-1">
                <div className="text-sm font-semibold text-slate-950 dark:text-white">{t("chat.history")}</div>
              </div>
              <ActionButton
                preset="secondary"
                size="icon-lg"
                aria-label={t("chat.closeHistoryDrawer")}
                onClick={() => {
                  setMobileHistoryDrawerOpen(false);
                  mobileHistoryButtonRef.current?.focus();
                }}
                leadingIcon={<X size={18} />}
              >
              </ActionButton>
            </div>
            <ImageChatHistoryPanel
              historyBranches={historyBranches}
              selectedGeneratedAssetId={selectedGeneratedAssetId}
              selectedTaskPlaceholderId={selectedTaskPlaceholderId}
              selectedBaseAssetIds={selectedBaseAssetIds}
              variant="mobileDrawer"
              appearance={actionAppearance}
              onSelectRound={handleSelectHistoryRound}
              onAddRoundToBase={handleAddHistoryRoundToBase}
              onSelectPlaceholder={handleSelectHistoryPlaceholder}
              onStartNewRound={handleStartNewRound}
              newRoundDisabled={newRoundDisabled}
              newRoundActive={generationDraftMode === "new_round"}
              newRoundTitle={newRoundBlockedTitle || t("chat.newRound")}
              maskSensitiveImages={maskSensitiveImages}
              onPreviewPrompt={setPromptPreview}
              t={t}
            />
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      <div className="fixed inset-x-0 z-40 px-3 lg:hidden" style={{ bottom: "calc(4.1rem + env(safe-area-inset-bottom))" }}>
        <div className="mx-auto flex max-w-2xl items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_-6px_18px_rgba(15,23,42,0.12)] dark:border-slate-700 dark:bg-slate-950 dark:shadow-[0_-12px_28px_rgba(0,0,0,0.30)]">
          <ActionButton
            ref={mobileSettingsButtonRef}
            preset="primary"
            size="lg"
            onClick={() => {
              if (!generationDraftOpen) {
                handleStartNewRound();
                return;
              }
              setMobileGenerationSheetOpen(true);
            }}
            disabled={!generationDraftOpen && newRoundDisabled}
            title={generationDraftOpen ? t("chat.openGenerationSheet") : (newRoundBlockedTitle || t("chat.newRound"))}
            className="min-h-11 w-full min-w-0 justify-between px-3 text-left [&_.pf-action-button__label]:flex [&_.pf-action-button__label]:min-w-0 [&_.pf-action-button__label]:flex-1 [&_.pf-action-button__label]:items-center"
            aria-label={generationDraftOpen ? t("chat.openGenerationSheet") : t("chat.newRound")}
            leadingIcon={<Sparkles size={17} className="shrink-0" />}
            trailingIcon={<ChevronRight size={17} className="shrink-0 text-indigo-100 dark:text-violet-100" />}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold leading-5">
                {generationDraftOpen ? t("chat.mobileGenerate") : t("chat.newRoundShort")}
              </span>
            </span>
          </ActionButton>
        </div>
      </div>

      <Drawer.Root
        direction="bottom"
        handleOnly
        open={mobileGenerationSheetOpen}
        onOpenChange={(open) => {
          setMobileGenerationSheetOpen(open);
          if (!open) {
            mobileSettingsButtonRef.current?.focus();
          }
        }}
      >
        <Drawer.Portal>
          <Drawer.Overlay
            className="fixed inset-0 z-[70] bg-slate-950/42 lg:hidden"
            onWheel={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onTouchMove={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          />
          <Drawer.Content
            data-floating-root
            className="pf-workspace-tool-drawer mobile-generation-sheet fixed inset-x-0 bottom-0 z-[71] flex max-h-[80dvh] flex-col rounded-t-[1.5rem] border-t border-slate-200 bg-white shadow-[0_-12px_34px_rgba(15,23,42,0.16)] outline-none dark:border-slate-700 dark:bg-[#0f1726] dark:shadow-[0_-18px_42px_rgba(0,0,0,0.34)] lg:hidden"
            onClick={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
            onTouchMove={(event) => event.stopPropagation()}
          >
            <Drawer.Title className="sr-only">{t("chat.mobileGenerationSheet")}</Drawer.Title>
            <Drawer.Handle className="mx-auto mt-2 flex h-7 w-24 items-center justify-center rounded-full text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-slate-500 dark:focus-visible:ring-violet-400">
              <span className="h-1.5 w-12 rounded-full bg-slate-300 dark:bg-slate-600" />
            </Drawer.Handle>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-y-contain px-4 pb-4 pt-2">
              {renderActionSections("image-chat-prompt-mobile")}

              <div className="mt-4 space-y-3">
                {successMessage ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-400/35 dark:bg-emerald-500/10 dark:text-emerald-200">
                    {successMessage}
                  </div>
                ) : null}
                {errorMessage ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-400/35 dark:bg-red-500/10 dark:text-red-200">{errorMessage}</div>
                ) : null}
              </div>
            </div>
            <div className="border-t border-slate-200 bg-white/96 p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] dark:border-slate-800 dark:bg-slate-950/94">
              {primaryBlockedResource ? (
                <ResourceBlockedNotice resource={primaryBlockedResource} className="mb-2" />
              ) : null}
              {primarySubmitRequirementMessage ? (
                <div className="mb-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 dark:border-amber-400/35 dark:bg-amber-500/10 dark:text-amber-200">
                  {primarySubmitRequirementMessage}
                </div>
              ) : null}
              <ActionButton
                preset="primary"
                size="lg"
                onClick={chatMode === "enhance" ? handleSubmitEnhance : handleGenerate}
                disabled={primaryActionDisabled}
                title={primaryActionTitle}
                fullWidth
                loading={primaryActionPending}
                leadingIcon={<Sparkles size={15} />}
                className="min-h-12"
              >
                {primaryActionLabel}
              </ActionButton>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
      {promptPreview ? (
        <PromptPreviewDialog appearance={actionAppearance} preview={promptPreview} onClose={() => setPromptPreview(null)} />
      ) : null}
      {activePreviewRound ? (
        <GalleryImagePreviewDialog
          appearance={actionAppearance}
          ariaLabel={t("chat.currentPreviewLabel")}
          imageUrl={api.toApiUrl(activePreviewRound.generated_asset.preview_url)}
          imageAlt={activePreviewRound.prompt || t("chat.currentResultAlt")}
          title={t("gallery.prompt")}
          subtitle={activePreviewRound.generated_asset.original_filename}
          body={
            <section className="space-y-3 whitespace-normal">
              <div className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-800 dark:text-slate-200">
                {activePreviewRound.prompt || t("gallery.noPrompt")}
              </div>
              <div className="flex items-center justify-end gap-2">
                {previewPromptCopyState !== "idle" ? (
                  <span
                    className={
                      previewPromptCopyState === "copied"
                        ? "text-[11px] font-semibold text-emerald-700 dark:text-emerald-300"
                        : "text-[11px] font-semibold text-red-700 dark:text-red-300"
                    }
                  >
                    {previewPromptCopyTitle}
                  </span>
                ) : null}
                <ActionButton
                  preset="secondary"
                  size="sm"
                  onClick={handleCopyPreviewPrompt}
                  disabled={!activePreviewPrompt}
                  title={previewPromptCopyTitle}
                  aria-label={t("gallery.copyPrompt")}
                  leadingIcon={previewPromptCopyState === "copied" ? <Check size={13} /> : <Copy size={13} />}
                  className="min-h-7 px-2.5 text-xs"
                >
                  {t("common.copy")}
                </ActionButton>
              </div>
            </section>
          }
          metadataRows={[
            { label: t("gallery.meta.size"), value: imageRoundSizeLabel(activePreviewRound, t) },
            {
              label: t("gallery.meta.model"),
              value:
                [activePreviewRound.provider_name, activePreviewRound.model_name].filter(Boolean).join(" / ") ||
                t("common.unknown"),
            },
            {
              label: t("gallery.meta.resourceGroup"),
              value: activePreviewRound.resource_group.name,
            },
            {
              label: t("gallery.meta.candidate"),
              value: `${activePreviewRound.candidate_index}/${activePreviewRound.candidate_count}`,
            },
            { label: t("chat.generatedAt"), value: formatDateTime(activePreviewRound.created_at) },
          ]}
          providerNotes={activePreviewRound.provider_notes}
          providerNotesTitle={t("gallery.providerNotes")}
          downloadUrl={activePreviewRound.generated_asset.download_url}
          downloadLabel={t("gallery.download")}
          closeLabel={t("gallery.closePreview")}
          onClose={() => setPreviewRound(null)}
        />
      ) : null}
      {referencePreview ? (
        <GalleryImagePreviewDialog
          appearance={actionAppearance}
          ariaLabel={t("detail.previewImage", { alt: referencePreview.asset.original_filename })}
          imageUrl={api.toApiUrl(referencePreview.asset.preview_url)}
          imageAlt={referencePreview.asset.original_filename}
          title={referencePreview.title}
          subtitle={referencePreview.asset.original_filename}
          body={
            <div className="space-y-3">
              <ResourceBlockedNotice resource={referencePreview.asset} />
              <div>{referencePreview.asset.original_filename}</div>
            </div>
          }
          providerNotesTitle={t("gallery.providerNotes")}
          downloadUrl={referencePreview.asset.download_url}
          downloadLabel={t("gallery.download")}
          closeLabel={t("gallery.closePreview")}
          onClose={() => setReferencePreview(null)}
        />
      ) : null}
      <ResourceLibraryModal
        open={resourceLibraryOpen}
        onClose={() => setResourceLibraryOpen(false)}
        appearance={actionAppearance}
        canRead
        onSelectAsset={handleResourceLibraryAssetSelect}
        selectLabel={t("resourceLibrary.loadToImageSession")}
        selectDisabled={Boolean(resourceLibraryLoadReferenceBlockedTitle)}
        selectDisabledTitle={resourceLibraryLoadReferenceBlockedTitle}
        selectingAssetId={loadResourceLibraryReferenceMutation.variables ?? null}
      />
      <SaveToResourceLibraryDialog
        appearance={actionAppearance}
        source={resourceLibrarySaveSource}
        canWrite={!resourceLibrarySaveGeneratedBlockedTitle}
        onClose={() => setResourceLibrarySaveSource(null)}
        onSaved={() => {
          setSuccessMessage(t("resourceLibrary.saved"));
          setErrorMessage("");
        }}
      />
      <GalleryTagPickerDialog
        open={Boolean(galleryTagPickerAsset)}
        appearance={actionAppearance}
        tags={galleryTags}
        loading={galleryTagsQuery.isLoading}
        initialSelectedTagIds={[]}
        maxSelection={galleryEntryTagMaxSelection}
        required={galleryTagRequiredOnSave}
        busy={saveGalleryMutation.isPending}
        error={galleryTagPickerError}
        onConfirm={(tagIds) => {
          if (!galleryTagPickerAsset) {
            return;
          }
          saveGalleryMutation.mutate({ assetId: galleryTagPickerAsset.id, tagIds });
        }}
        onClose={() => {
          if (!saveGalleryMutation.isPending) {
            setGalleryTagPickerAsset(null);
            setGalleryTagPickerError("");
          }
        }}
      />
      {createSessionDialogOpen ? (
        <ModalShell
          onClose={() => setCreateSessionDialogOpen(false)}
          closeDisabled={createSessionMutation.isPending}
          ariaLabelledBy={createSessionDialogTitleId}
          ariaDescribedBy={createSessionDialogDescriptionId}
          overlayClassName="z-[90] bg-slate-950/55 px-4 py-6 backdrop-blur-sm"
          panelClassName="w-full max-w-md overflow-visible rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-slate-700/80 dark:bg-[#0f1726] dark:shadow-black/45 animate-spring-pop-in"
        >
            <div className="flex items-start gap-3 px-5 pt-5">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-violet-500/15 dark:text-violet-200">
                <Sparkles size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id={createSessionDialogTitleId} className="text-base font-semibold text-slate-950 dark:text-white">
                  {t("chat.createSessionDialogTitle")}
                </h2>
                <p id={createSessionDialogDescriptionId} className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  {t("chat.createSessionDialogDescription")}
                </p>
                <label className="mt-4 block space-y-2">
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    {t("chat.resourceGroup")}
                  </span>
                  <LayoutSelectField
                    value={createSessionResourceGroupId}
                    options={[
                      {
                        value: "",
                        label: resourceGroups.length ? t("chat.selectResourceGroup") : t("chat.noResourceGroups"),
                        disabled: true,
                      },
                      ...resourceGroups.map((group) => ({
                        value: group.id,
                        label: resourceGroupOptionLabel(group, t("chat.resourceGroupDisabled")),
                        disabled: !group.enabled,
                      })),
                    ]}
                    onChange={setCreateSessionResourceGroupId}
                    ariaLabel={t("chat.resourceGroup")}
                    disabled={createSessionMutation.isPending || generationResourceGroupsQuery.isLoading}
                    size="compact"
                  />
                </label>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3 dark:border-slate-800 dark:bg-slate-950/45">
              <ActionButton
                preset="secondary"
                size="md"
                onClick={() => setCreateSessionDialogOpen(false)}
                disabled={createSessionMutation.isPending}
              >
                {t("common.cancel")}
              </ActionButton>
              <ActionButton
                preset="primary"
                size="md"
                onClick={handleConfirmCreateSession}
                disabled={createSessionMutation.isPending || !createSessionResourceGroupId}
                loading={createSessionMutation.isPending}
              >
                {t("chat.createSessionConfirm")}
              </ActionButton>
            </div>
        </ModalShell>
      ) : null}
      <ConfirmDialog
        open={Boolean(pendingDeleteDialog)}
        appearance={actionAppearance}
        title={pendingDeleteDialog?.title ?? ""}
        description={pendingDeleteDialog?.description ?? ""}
        confirmLabel={t("confirm.delete.confirm")}
        cancelLabel={t("common.cancel")}
        busy={pendingDeleteDialog?.busy ?? false}
        onClose={() => setPendingDeleteAction(null)}
        onConfirm={() => {
          if (!pendingDeleteAction) {
            return;
          }
          if (pendingDeleteAction.kind === "session") {
            if (sessionListDeletionBlockedTitle) {
              setErrorMessage(sessionListDeletionBlockedTitle);
              setPendingDeleteAction(null);
              return;
            }
            deleteSessionMutation.mutate(pendingDeleteAction.sessionId);
            return;
          }
          if (pendingDeleteAction.kind === "inspirationReference") {
            if (inspirationReferenceEditBlockedTitle) {
              setErrorMessage(inspirationReferenceEditBlockedTitle);
              setPendingDeleteAction(null);
              return;
            }
            deleteInspirationReferenceMutation.mutate(pendingDeleteAction.assetId);
            return;
          }
          if (sessionEditBlockedTitle) {
            setErrorMessage(sessionEditBlockedTitle);
            setPendingDeleteAction(null);
            return;
          }
          deleteSessionReferenceMutation.mutate({
            sessionId: pendingDeleteAction.sessionId,
            assetId: pendingDeleteAction.assetId,
          });
        }}
      />
      {newRoundChoiceOpen ? (
        <ModalShell
          open={newRoundChoiceOpen}
          onClose={() => setNewRoundChoiceOpen(false)}
          ariaLabelledBy="new-round-choice-title"
          overlayClassName="z-[90] bg-slate-950/55 px-4 py-6 backdrop-blur-sm"
          panelClassName="w-full max-w-sm overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl shadow-slate-950/20 dark:border-slate-700/80 dark:bg-[#0f1726] dark:shadow-black/45 animate-spring-pop-in"
        >
          <div className="px-5 pt-5 pb-2">
            <h2 id="new-round-choice-title" className="text-base font-semibold text-slate-950 dark:text-white">
              {t("chat.newRoundDialogTitle")}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              {t("chat.newRoundDialogDescription")}
            </p>
          </div>
          <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3 dark:border-slate-800 dark:bg-slate-950/45">
            <ActionButton
              preset="secondary"
              size="md"
              onClick={() => {
                setNewRoundChoiceOpen(false);
                startNewRoundFresh();
              }}
            >
              {t("chat.newRoundFreshConfig")}
            </ActionButton>
            <ActionButton
              preset="primary"
              size="md"
              onClick={() => {
                setNewRoundChoiceOpen(false);
                startNewRoundWithPreviousConfig();
              }}
            >
              {t("chat.newRoundReuseConfig")}
            </ActionButton>
          </div>
        </ModalShell>
      ) : null}
    </div>
  );

}
